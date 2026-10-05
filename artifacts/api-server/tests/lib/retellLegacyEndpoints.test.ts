import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Retell's June 15, 2026 notice. Agent-version listing is still supported.
const retiredPaths = new Set([
  "/list-phone-numbers", "/list-retell-llms", "/list-conversation-flows",
  "/list-conversation-flow-components", "/list-batch-tests",
  "/list-test-case-definitions", "/list-test-runs",
  "/list-calls", "/v2/list-calls", "/list-chat", "/list-chats",
]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (entry.name === "node_modules" || entry.name === "dist") return [];
    const path = join(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.(?:[cm]?[jt]s)$/.test(path) ? [path] : [];
  });
}

describe("Retell legacy endpoint regression guard", () => {
  it("does not reference retired list endpoints in API or operational scripts", () => {
    const root = fileURLToPath(new URL("../../", import.meta.url));
    const paths = [...sourceFiles(join(root, "src")), ...sourceFiles(join(root, "../../scripts"))];
    const violations = paths.flatMap(path => {
      const endpoints = readFileSync(path, "utf8").match(/\/(?:v\d+\/)?list-[a-z-]+/g) ?? [];
      return endpoints.filter(endpoint => retiredPaths.has(endpoint)).map(endpoint => ({ path, endpoint }));
    });
    expect(violations).toEqual([]);
  });
});
