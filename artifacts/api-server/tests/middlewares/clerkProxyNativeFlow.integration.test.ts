import express from "express";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/middlewares/clerkFrontendApi", () => ({
  getClerkFrontendApiUrl: () => process.env.TEST_CLERK_FRONTEND_API_URL,
}));

import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
} from "../../src/middlewares/clerkProxyMiddleware";

type UpstreamStep = {
  authorization?: string;
  setCookie?: string;
};

type CapturedRequest = {
  url: string;
  origin: string | undefined;
  authorization: string | undefined;
  cookie: string | undefined;
};

const NATIVE_ORIGIN = "capacitor://localhost";
const upstreamSteps: UpstreamStep[] = [];
const capturedRequests: CapturedRequest[] = [];
let upstreamServer: Server;
let proxyServer: Server;
let proxyUrl: string;

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
}

function serverUrl(server: Server): string {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test server did not bind to a TCP port.");
  }
  return `http://127.0.0.1:${address.port}`;
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

function respondToUpstream(
  req: IncomingMessage,
  res: ServerResponse,
): void {
  capturedRequests.push({
    url: req.url ?? "",
    origin: req.headers.origin,
    authorization: req.headers.authorization,
    cookie: req.headers.cookie,
  });
  const step = upstreamSteps.shift();
  if (!step) {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "No fake upstream response was queued." }));
    return;
  }

  res.setHeader("content-type", "application/json");
  if (step.authorization !== undefined) {
    res.setHeader("authorization", step.authorization);
  }
  if (step.setCookie !== undefined) {
    res.setHeader("set-cookie", step.setCookie);
  }
  res.end(JSON.stringify({ ok: true }));
}

async function postNative(path: string, clientToken?: string, authorization?: string) {
  const headers = new Headers({
    origin: NATIVE_ORIGIN,
    "content-type": "application/x-www-form-urlencoded",
    cookie: "__client=stale-webview-value; theme=dark",
  });
  if (clientToken !== undefined) {
    headers.set("X-Native-Clerk-Client", clientToken);
  }
  if (authorization !== undefined) {
    headers.set("Authorization", authorization);
  }
  return fetch(`${proxyUrl}${CLERK_PROXY_PATH}${path}`, {
    method: "POST",
    headers,
    body: "test=1",
  });
}

beforeAll(async () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("CLERK_SECRET_KEY", "sk_test_proxy-placeholder");

  upstreamServer = createServer(respondToUpstream);
  await listen(upstreamServer);
  vi.stubEnv("TEST_CLERK_FRONTEND_API_URL", serverUrl(upstreamServer));

  const app = express();
  app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
  proxyServer = createServer(app);
  await listen(proxyServer);
  proxyUrl = serverUrl(proxyServer);
});

beforeEach(() => {
  upstreamSteps.length = 0;
  capturedRequests.length = 0;
});

afterAll(async () => {
  if (proxyServer?.listening) await close(proxyServer);
  if (upstreamServer?.listening) await close(upstreamServer);
  vi.unstubAllEnvs();
});

describe("native Clerk proxy token bridge", () => {
  it("round-trips the client token through sign-up creation and email verification", async () => {
    upstreamSteps.push(
      { authorization: "signup-client-1" },
      { authorization: "Bearer signup-client-2" },
      { authorization: "Bearer signup-client-3" },
    );

    let response = await postNative("/v1/client/sign_ups?strategy=email_code");
    expect(response.status).toBe(200);
    let clientToken = response.headers.get("X-Native-Clerk-Client");
    expect(clientToken).toBe("signup-client-1");

    response = await postNative(
      "/v1/client/sign_ups/signup_test/prepare_verification",
      clientToken ?? undefined,
    );
    expect(response.status).toBe(200);
    clientToken = response.headers.get("X-Native-Clerk-Client");
    expect(clientToken).toBe("signup-client-2");

    response = await postNative(
      "/v1/client/sign_ups/signup_test/attempt_verification",
      clientToken ?? undefined,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Native-Clerk-Client")).toBe("signup-client-3");

    expect(capturedRequests).toHaveLength(3);
    expect(capturedRequests[0]?.authorization).toBeUndefined();
    expect(capturedRequests.slice(1).map((request) => request.authorization)).toEqual([
      "Bearer signup-client-1",
      "Bearer signup-client-2",
    ]);
    for (const request of capturedRequests) {
      expect(request.url).toContain("_is_native=1");
      expect(request.origin).toBeUndefined();
      expect(request.cookie).toBeUndefined();
    }
  });

  it("round-trips sign-in password and session token/touch requests", async () => {
    upstreamSteps.push(
      { authorization: "Bearer signin-client-1" },
      { authorization: "Bearer signin-client-2" },
      { authorization: "Bearer signin-client-3" },
      { authorization: "Bearer signin-client-4" },
    );

    let response = await postNative("/v1/client/sign_ins");
    expect(response.status).toBe(200);
    let clientToken = response.headers.get("X-Native-Clerk-Client");
    expect(clientToken).toBe("signin-client-1");

    response = await postNative(
      "/v1/client/sign_ins/signin_test/attempt_first_factor",
      clientToken ?? undefined,
    );
    expect(response.status).toBe(200);
    clientToken = response.headers.get("X-Native-Clerk-Client");
    expect(clientToken).toBe("signin-client-2");

    response = await postNative(
      "/v1/client/sessions/session_test/tokens",
      clientToken ?? undefined,
    );
    expect(response.status).toBe(200);
    clientToken = response.headers.get("X-Native-Clerk-Client");
    expect(clientToken).toBe("signin-client-3");

    response = await postNative(
      "/v1/client/sessions/session_test/touch",
      clientToken ?? undefined,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Native-Clerk-Client")).toBe("signin-client-4");

    expect(capturedRequests.map((request) => request.authorization)).toEqual([
      undefined,
      "Bearer signin-client-1",
      "Bearer signin-client-2",
      "Bearer signin-client-3",
    ]);
    for (const request of capturedRequests) {
      expect(request.url).toContain("_is_native=1");
      expect(request.origin).toBeUndefined();
      expect(request.cookie).toBeUndefined();
    }
  });

  it("keeps the __client Set-Cookie bridge as a fallback when no token header is returned", async () => {
    upstreamSteps.push({ setCookie: "__client=fallback-client-123; Path=/; HttpOnly" });

    const response = await postNative("/v1/client");

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Native-Clerk-Client")).toBe("fallback-client-123");
  });

  it("rejects an invalid upstream Authorization token and falls back to a valid __client cookie", async () => {
    upstreamSteps.push({
      authorization: "Bearer invalid token",
      setCookie: "__client=fallback-client-456; Path=/; HttpOnly",
    });

    const response = await postNative("/v1/client");

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Native-Clerk-Client")).toBe("fallback-client-456");
  });

  it("does not replace an app-supplied Authorization header with the bridged token", async () => {
    upstreamSteps.push({ authorization: "Bearer next-client" });

    const response = await postNative(
      "/v1/client/sign_ins/signin_test/attempt_first_factor",
      "saved-client",
      "Bearer app-supplied-client",
    );

    expect(response.status).toBe(200);
    expect(capturedRequests[0]?.authorization).toBe("Bearer app-supplied-client");
    expect(capturedRequests[0]?.cookie).toBeUndefined();
  });
});
