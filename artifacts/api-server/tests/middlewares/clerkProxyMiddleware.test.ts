import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

const proxyState = vi.hoisted(() => ({
  handler: vi.fn(),
  options: undefined as unknown,
}));

vi.mock("http-proxy-middleware", () => ({
  createProxyMiddleware: vi.fn((options: unknown) => {
    proxyState.options = options;
    return proxyState.handler;
  }),
}));

import {
  clerkProxyMiddleware,
  isValidNativeClerkClientCookie,
} from "../../src/middlewares/clerkProxyMiddleware";
import {
  DEFAULT_CLERK_FRONTEND_API_URL,
  getClerkFrontendApiUrl,
} from "../../src/middlewares/clerkFrontendApi";

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("CLERK_SECRET_KEY", "sk_test_placeholder");
  proxyState.handler.mockReset();
  proxyState.options = undefined;
});

describe("native Clerk proxy cookie validation", () => {
  it("defaults to Clerk's standard Frontend API and accepts the configured production Frontend API", () => {
    expect(getClerkFrontendApiUrl()).toBe(DEFAULT_CLERK_FRONTEND_API_URL);
    expect(getClerkFrontendApiUrl(" https://clerk.corvlio.com/ ")).toBe(
      "https://clerk.corvlio.com",
    );
  });

  it("rejects non-HTTPS or non-Clerk proxy targets", () => {
    expect(() => getClerkFrontendApiUrl("http://clerk.corvlio.com")).toThrow(
      "CLERK_FRONTEND_API_URL must be an HTTPS Clerk Frontend API origin.",
    );
    expect(() => getClerkFrontendApiUrl("https://attacker.example")).toThrow(
      "CLERK_FRONTEND_API_URL must be an HTTPS Clerk Frontend API origin.",
    );
  });

  it("routes Clerk proxy requests to the configured Frontend API", () => {
    vi.stubEnv("CLERK_FRONTEND_API_URL", "https://clerk.corvlio.com");

    clerkProxyMiddleware();

    expect((proxyState.options as { target: string }).target).toBe(
      "https://clerk.corvlio.com",
    );
  });

  it.each(["capacitor://localhost", "ionic://localhost"])(
    "marks %s Frontend API requests native and round-trips the client Authorization token",
    (origin) => {
      const middleware = clerkProxyMiddleware();
      const options = proxyState.options as {
        pathRewrite: (
          path: string,
          req: { headers: Record<string, string> },
        ) => string;
        on: {
          proxyReq: (
            proxyReq: {
              setHeader: ReturnType<typeof vi.fn>;
              removeHeader: ReturnType<typeof vi.fn>;
            },
            req: {
              url: string;
              headers: Record<string, string>;
              socket: { remoteAddress: string };
            },
          ) => void;
          proxyRes: (
            proxyRes: {
              headers: Record<string, string>;
              statusCode: number;
              on: ReturnType<typeof vi.fn>;
              pipe: ReturnType<typeof vi.fn>;
            },
            req: { method: string; headers: Record<string, string> },
            res: {
              writeHead: ReturnType<typeof vi.fn>;
              end: ReturnType<typeof vi.fn>;
              destroy: ReturnType<typeof vi.fn>;
            },
          ) => void;
        };
      };
      const path = "/api/__clerk/v1/client/sign_ups?strategy=email_code";

      expect(options.pathRewrite(path, { headers: { origin } })).toBe(
        "/v1/client/sign_ups?strategy=email_code&_is_native=1",
      );
      expect(options.pathRewrite("/api/__clerk/v1/client/sign_ins", { headers: { origin } })).toBe(
        "/v1/client/sign_ins?_is_native=1",
      );
      expect(options.pathRewrite(path, { headers: { origin: "https://corvlio.com" } })).toBe(
        "/v1/client/sign_ups?strategy=email_code",
      );
      expect(options.pathRewrite("/api/__clerk/npm/@clerk/clerk-js.js", { headers: { origin } })).toBe(
        "/npm/@clerk/clerk-js.js",
      );

      middleware(
        {
          method: "POST",
          url: "/api/__clerk/v1/client/sign_ups",
          headers: { origin, authorization: "Bearer client-token-test", host: "dashboard.example" },
        } as unknown as Request,
        {} as Response,
        vi.fn(),
      );

      const proxyReq = { setHeader: vi.fn(), removeHeader: vi.fn() };
      options.on.proxyReq(proxyReq, {
        url: "/api/__clerk/v1/client/sign_ups",
        headers: {
          origin,
          authorization: "Bearer client-token-test",
          host: "dashboard.example",
        },
        socket: { remoteAddress: "127.0.0.1" },
      });
      expect(proxyReq.setHeader).toHaveBeenCalledWith(
        "Authorization",
        "Bearer client-token-test",
      );
      expect(proxyReq.removeHeader).toHaveBeenCalledWith("Origin");
      expect(proxyReq.setHeader).not.toHaveBeenCalledWith("Origin", expect.anything());

      const downstream = {
        writeHead: vi.fn(),
        end: vi.fn(),
        destroy: vi.fn(),
      };
      options.on.proxyRes(
        {
          headers: {
            authorization: "Bearer client-token-next",
            "content-length": "0",
          },
          statusCode: 200,
          on: vi.fn(),
          pipe: vi.fn(),
        },
        { method: "GET", headers: { origin } },
        downstream,
      );
      const responseHeaders = downstream.writeHead.mock.calls[0]?.[1] as Record<string, string>;
      expect(responseHeaders.authorization).toBe("Bearer client-token-next");
      expect(responseHeaders["access-control-expose-headers"]).toContain("Authorization");
    },
  );

  it("accepts only bounded cookie values with a safe character set", () => {
    expect(isValidNativeClerkClientCookie("client_abc-123.%~")).toBe(true);
    expect(isValidNativeClerkClientCookie("")).toBe(false);
    expect(isValidNativeClerkClientCookie("client; Secure")).toBe(false);
    expect(isValidNativeClerkClientCookie("client\r\nCookie: injected")).toBe(false);
    expect(isValidNativeClerkClientCookie("a".repeat(4097))).toBe(false);
  });

  it("rejects malformed native cookie headers before proxying", () => {
    const middleware = clerkProxyMiddleware();
    const response = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as unknown as Response;

    middleware(
      {
        method: "GET",
        headers: {
          origin: "capacitor://localhost",
          "x-native-clerk-client": "bad\r\nvalue",
        },
      } as unknown as Request,
      response,
      vi.fn(),
    );

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith({
      error: "Invalid native Clerk client cookie",
    });
    expect(proxyState.handler).not.toHaveBeenCalled();
  });

  it("replaces any WebView-supplied __client cookie with the validated bridge value", () => {
    const middleware = clerkProxyMiddleware();
    middleware(
      {
        method: "GET",
        headers: {
          origin: "capacitor://localhost",
          "x-native-clerk-client": "client_valid-123",
        },
      } as unknown as Request,
      {} as Response,
      vi.fn(),
    );
    expect(proxyState.handler).toHaveBeenCalledOnce();

    const options = proxyState.options as {
      on: {
        proxyReq: (
          proxyReq: {
            setHeader: ReturnType<typeof vi.fn>;
            removeHeader: ReturnType<typeof vi.fn>;
          },
          req: {
            headers: Record<string, string>;
            socket: { remoteAddress: string };
          },
        ) => void;
      };
    };
    const proxyReq = { setHeader: vi.fn(), removeHeader: vi.fn() };
    options.on.proxyReq(proxyReq, {
      headers: {
        origin: "capacitor://localhost",
        host: "dashboard.example",
        cookie: "__client=forged; theme=dark",
        "x-native-clerk-client": "client_valid-123",
      },
      socket: { remoteAddress: "127.0.0.1" },
    });

    const cookieHeader = proxyReq.setHeader.mock.calls.find(
      ([name]) => name.toLowerCase() === "cookie",
    )?.[1];
    expect(cookieHeader).toBe("__client=client_valid-123");
    expect(proxyReq.removeHeader).toHaveBeenCalledWith("X-Native-Clerk-Client");
  });
});
