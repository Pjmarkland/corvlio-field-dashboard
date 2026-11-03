import { describe, expect, it } from "vitest";
import { getAdminRetellWebhookUrls } from "../../src/lib/retellWebhookUrls";

describe("admin Retell webhook URLs", () => {
  it("builds production webhook URLs from PUBLIC_API_BASE_URL", () => {
    expect(getAdminRetellWebhookUrls({
      PUBLIC_API_BASE_URL: "https://field.example/api/",
      VITE_NATIVE_API_BASE_URL: "https://stale.example",
    })).toEqual({
      configured: true,
      preCallWebhookUrl: "https://field.example/api/webhooks/retell/pre-call",
      postCallWebhookUrl: "https://field.example/api/webhooks/retell/post-call",
    });
  });

  it("uses the existing native public-base setting when the server setting is absent", () => {
    expect(getAdminRetellWebhookUrls({
      VITE_NATIVE_API_BASE_URL: "https://field.example",
    }).postCallWebhookUrl).toBe("https://field.example/api/webhooks/retell/post-call");
  });

  it.each([
    {},
    { PUBLIC_API_BASE_URL: "http://field.example" },
    { PUBLIC_API_BASE_URL: "not a URL" },
    { PUBLIC_API_BASE_URL: "https://user:pass@field.example" },
  ])("does not provide URLs for missing or unsafe configuration", (env) => {
    expect(getAdminRetellWebhookUrls(env)).toEqual({
      configured: false,
      preCallWebhookUrl: null,
      postCallWebhookUrl: null,
    });
  });
});
