import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const workspace = fileURLToPath(new URL("../../../../", import.meta.url));
// Execute the actual operational script with a fail-closed fetch replacement.
// No provider access, real credentials, publish, phone purchases, or calls.
function runScript(brokenPage = false) {
  const bootstrap = `
    globalThis.fetch = async (url, options) => {
      if (options.method !== 'GET') throw new Error('Provider mutation forbidden');
      const parsed = new URL(url);
      let data;
      if (parsed.pathname === '/list-agent-versions/fixture_agent') {
        const key = parsed.searchParams.get('pagination_key');
        if (key === null) data = {
          items: [{version: 1, is_published: true}],
          has_more: true, pagination_key: 'next /+?& page'
        };
        else if (key === 'next /+?& page') {
          if (${brokenPage}) throw new Error('Fixture second-page failure');
          data = {items: [{version: 4, is_published: false}], has_more: false};
        } else throw new Error('Unexpected cursor');
      } else if (parsed.pathname === '/get-agent/fixture_agent') {
        const version = Number(parsed.searchParams.get('version'));
        data = {version, is_published: version === 1, voice_id: 'fixture_voice',
          response_engine: {type: 'retell-llm', llm_id: 'fixture_llm', version}};
      } else if (parsed.pathname === '/get-retell-llm/fixture_llm') {
        const version = Number(parsed.searchParams.get('version'));
        data = {version, is_published: version === 1, model: 'fixture_model'};
      } else throw new Error('Unexpected provider endpoint');
      return {ok: true, json: async () => data};
    };
    await import('./scripts/update-retell-draft.mjs');
  `;
  return spawnSync(process.execPath, ["--input-type=module", "--eval", bootstrap], {
    cwd: workspace,
    env: { ...process.env, NODE_ENV: "test", REPLIT_DEPLOYMENT: "", REPLIT_DEV_DOMAIN: "development.example.com",
      RETELL_API_BASE_URL: "https://retell.invalid", RETELL_API_KEY: "fixture-not-a-secret", RETELL_SHARED_AGENT_ID: "fixture_agent" },
    encoding: "utf8", timeout: 10_000,
  });
}

describe("Retell draft script pagination", () => {
  it("finds the unpublished draft on a later page, in read-only dry-run mode", () => {
    const result = runScript();
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      mode: "dry run", publishedVersion: 1, draftVersion: 4, llmVersion: 4,
    });
  });
  it("stops rather than reviewing or updating a partial list after a later-page failure", () => {
    const result = runScript(true);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Fixture second-page failure");
    expect(result.stdout).toBe("");
  });
});
