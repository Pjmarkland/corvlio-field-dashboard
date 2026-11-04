import { createServer, type Server } from "node:http";
import express from "express";
import cors from "cors";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { corsOptions, isAllowedCorsOrigin, rejectUnexpectedOrigin } from "../../src/lib/corsPolicy";

let server: Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use(cors(corsOptions));
  app.use(rejectUnexpectedOrigin);
  app.get("/private", (_req, res) => res.json({ ok: true }));
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

afterEach(() => vi.unstubAllEnvs());

describe("credentialed CORS policy", () => {
  it("allows only the configured app origin and Capacitor localhost origins", () => {
    const env = { PUBLIC_API_BASE_URL: "https://app.example.test/dashboard" };
    expect(isAllowedCorsOrigin("https://app.example.test", env)).toBe(true);
    expect(isAllowedCorsOrigin("https://app.example.test.evil.test", env)).toBe(false);
    expect(isAllowedCorsOrigin("https://other.example.test", env)).toBe(false);
    expect(isAllowedCorsOrigin("http://localhost", env)).toBe(true);
    expect(isAllowedCorsOrigin("https://localhost", env)).toBe(true);
    expect(isAllowedCorsOrigin("http://localhost:4173", env)).toBe(false);
  });

  it("fails closed when no app origin is configured", () => {
    expect(isAllowedCorsOrigin("https://app.example.test", {})).toBe(false);
    expect(isAllowedCorsOrigin("https://app.example.test", {
      PUBLIC_API_BASE_URL: "javascript:alert(1)",
    })).toBe(false);
  });

  it("reflects credentials only for allowed origins and rejects other browser origins", async () => {
    vi.stubEnv("PUBLIC_API_BASE_URL", "https://app.example.test");
    const allowed = await fetch(`${base}/private`, { headers: { Origin: "https://app.example.test" } });
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get("access-control-allow-origin")).toBe("https://app.example.test");
    expect(allowed.headers.get("access-control-allow-credentials")).toBe("true");

    const rejected = await fetch(`${base}/private`, { headers: { Origin: "https://attacker.example" } });
    expect(rejected.status).toBe(403);
    expect(rejected.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("keeps same-origin preview requests working without adding them to credentialed CORS", async () => {
    const sameOrigin = await fetch(`${base}/private`, { headers: { Origin: base } });
    expect(sameOrigin.status).toBe(200);
    expect(sameOrigin.headers.get("access-control-allow-origin")).toBeNull();
  });
});
