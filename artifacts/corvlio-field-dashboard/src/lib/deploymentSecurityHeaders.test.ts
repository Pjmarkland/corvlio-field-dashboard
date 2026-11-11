import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDashboardServer } from "../../server.mjs";

let root: string;
let server: ReturnType<typeof createDashboardServer>;
let baseUrl: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "corvlio-dashboard-security-"));
  await mkdir(join(root, "assets"));
  await writeFile(join(root, "index.html"), "<main>dashboard</main>");
  await writeFile(join(root, "assets", "app.js"), "export {};");
  server = createDashboardServer(root);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Security test server did not bind to a TCP port");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  await rm(root, { recursive: true, force: true });
});

describe("dashboard production security headers", () => {
  it("sets the CSP and browser security headers on SPA and static asset responses", async () => {
    for (const path of ["/", "/admin", "/assets/app.js"]) {
      const response = await fetch(`${baseUrl}${path}`, {
        headers: { Accept: path === "/assets/app.js" ? "*/*" : "text/html" },
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-security-policy")).toContain(
        "default-src 'self'",
      );
      expect(response.headers.get("content-security-policy")).toContain(
        "frame-ancestors 'none'",
      );
      expect(response.headers.get("content-security-policy")).toContain(
        "https://*.clerk.accounts.dev",
      );
      expect(response.headers.get("content-security-policy")).toContain(
        "https://fonts.googleapis.com",
      );
      expect(response.headers.get("content-security-policy")).toContain(
        "https://fonts.gstatic.com",
      );
      const connectSrc = response.headers
        .get("content-security-policy")
        ?.split(";")
        .find((directive) => directive.trim().startsWith("connect-src "));
      expect(connectSrc).toContain("https://zlymcdjkzfizwxjcmccs.supabase.co");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("x-frame-options")).toBe("DENY");
      expect(response.headers.get("referrer-policy")).toBe(
        "strict-origin-when-cross-origin",
      );
      expect(response.headers.get("permissions-policy")).toContain("camera=()");
    }
  });

  it("adds HSTS only when the reverse proxy reports HTTPS", async () => {
    const response = await fetch(`${baseUrl}/`, {
      headers: { Accept: "text/html", "x-forwarded-proto": "https" },
    });
    expect(response.headers.get("strict-transport-security")).toBe(
      "max-age=31536000",
    );
  });

  it("does not serve files outside the build directory or cache missing assets", async () => {
    const traversal = await fetch(`${baseUrl}/%2e%2e/corvlio-dashboard-secret.txt`);
    expect([403, 404]).toContain(traversal.status);
    expect(await traversal.text()).not.toContain("Internal server error");

    const missingAsset = await fetch(`${baseUrl}/assets/missing.js`);
    expect(missingAsset.status).toBe(404);
    expect(missingAsset.headers.get("content-security-policy")).toContain(
      "default-src 'self'",
    );
  });
});
