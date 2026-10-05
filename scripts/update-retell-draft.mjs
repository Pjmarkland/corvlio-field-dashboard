import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { collectRetellListItems } from "../artifacts/api-server/src/lib/retellListPagination.mjs";

// No publish endpoint, phone-number mutations, or calls are used by this script.
if (!process.env.REPLIT_DEV_DOMAIN || process.env.REPLIT_DEPLOYMENT || process.env.NODE_ENV === "production") {
  throw new Error("Development workspace only; refusing to update Retell from production");
}
const source = await readFile("artifacts/api-server/src/lib/retellDraftConfig.ts", "utf8");
const { agentDraftPatch: agentSettings, llmDraftPatch } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
if (!process.env.REPLIT_DEV_DOMAIN) throw new Error("Development domain is required; refusing to leave draft results pointed at production");
const agentDraftPatch = { ...agentSettings, webhook_url: `https://${process.env.REPLIT_DEV_DOMAIN}/api/webhooks/retell/post-call` };
const base = (process.env.RETELL_API_BASE_URL || "https://api.retellai.com").replace(/\/$/, "");
const id = process.env.RETELL_SHARED_AGENT_ID;
if (!id || !process.env.RETELL_API_KEY) throw new Error("Retell configuration is missing");
async function request(path, method = "GET", body) {
  const r = await fetch(base + path, {
    method, headers: { Authorization: `Bearer ${process.env.RETELL_API_KEY}`, "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`Retell ${method} ${path.split("?")[0].split("/")[1]} failed (${r.status}): ${await r.text()}`);
  return r.json();
}
const versions = await collectRetellListItems((paginationKey) => {
  const query = paginationKey === undefined ? "" : `?${new URLSearchParams({ pagination_key: paginationKey })}`;
  return request(`/list-agent-versions/${encodeURIComponent(id)}${query}`);
}, { allowLegacyArray: true });
const publishedVersion = versions.filter(v => v.is_published).sort((a,b) => b.version-a.version)[0]?.version;
const draftVersion = versions.filter(v => !v.is_published).sort((a,b) => b.version-a.version)[0]?.version;
assert.notEqual(publishedVersion, undefined, "No published baseline found");
assert.notEqual(draftVersion, undefined, "No unpublished draft found; refusing to modify a published version");
assert.notEqual(draftVersion, publishedVersion);
const getAgent = v => request(`/get-agent/${encodeURIComponent(id)}?version=${v}`);
const published = await getAgent(publishedVersion);
const draft = await getAgent(draftVersion);
assert.equal(draft.is_published, false);
assert.equal(draft.response_engine.type, "retell-llm");
const llmId = draft.response_engine.llm_id;
const llmVersion = draft.response_engine.version ?? draft.version;
const getLLM = (id, v) => request(`/get-retell-llm/${encodeURIComponent(id)}?version=${v}`);
const publishedLLM = await getLLM(published.response_engine.llm_id, published.response_engine.version ?? published.version);
const draftLLM = await getLLM(llmId, llmVersion);
assert.equal(draftLLM.is_published, false, "Draft agent references a published LLM; refusing to modify it");
const fingerprint = o => createHash("sha256").update(JSON.stringify(o)).digest("hex");
const before = { agent: fingerprint(published), llm: fingerprint(publishedLLM) };
console.log(JSON.stringify({ mode: process.argv.includes("--apply-draft") ? "apply draft only" : process.argv.includes("--apply-draft-agent") ? "apply agent draft only" : process.argv.includes("--verify-draft") ? "verify draft only" : "dry run",
  publishedVersion, draftVersion, llmVersion, agentFields: Object.keys(agentDraftPatch), llmFields: Object.keys(llmDraftPatch),
  retainedVoice: draft.voice_id, retainedModel: draftLLM.model }, null, 2));
if (process.argv.includes("--apply-draft") || process.argv.includes("--apply-draft-agent") || process.argv.includes("--verify-draft")) {
  if (process.argv.includes("--apply-draft")) {
    const llm = await request(`/update-retell-llm/${encodeURIComponent(llmId)}?version=${llmVersion}`, "PATCH", llmDraftPatch);
    assert.equal(llm.is_published, false);
    assert.equal(llm.version, llmVersion);
  }
  if (process.argv.includes("--apply-draft") || process.argv.includes("--apply-draft-agent")) {
    const agent = await request(`/update-agent/${encodeURIComponent(id)}?version=${draftVersion}`, "PATCH", agentDraftPatch);
    assert.equal(agent.is_published, false);
    assert.equal(agent.version, draftVersion);
  }
  const after = { agent: fingerprint(await getAgent(publishedVersion)),
    llm: fingerprint(await getLLM(published.response_engine.llm_id, published.response_engine.version ?? published.version)) };
  assert.deepEqual(after, before, "Published configuration unexpectedly changed");
  const confirmedAgent = await getAgent(draftVersion);
  const confirmedLLM = await getLLM(llmId, llmVersion);
  // Retell omits nullable fields from GET responses after they are cleared.
  for (const [k,v] of Object.entries(agentDraftPatch)) assert.deepEqual(v === null ? confirmedAgent[k] ?? null : confirmedAgent[k], v, `Draft agent field ${k} did not persist`);
  for (const [k,v] of Object.entries(llmDraftPatch)) assert.deepEqual(confirmedLLM[k], v, `Draft LLM field ${k} did not persist`);
  const report = { publishedUnchanged: true, publishedVersion, draftVersion, draftIsPublished: confirmedAgent.is_published,
    draftLLMVersion: llmVersion, draftLLMIsPublished: confirmedLLM.is_published,
    agentFields: Object.keys(agentDraftPatch), llmFields: Object.keys(llmDraftPatch),
    retainedVoice: confirmedAgent.voice_id, retainedModel: confirmedLLM.model };
  await mkdir(".local/retell-review", { recursive: true });
  await writeFile(".local/retell-review/draft-report.json", JSON.stringify(report, null, 2));
  console.log("Verified draft fields persisted and published agent/LLM are unchanged.");
}