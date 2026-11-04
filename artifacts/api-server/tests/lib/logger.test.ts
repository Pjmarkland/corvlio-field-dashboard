import { describe, expect, it } from "vitest";
import { redactSensitiveLogValue } from "../../src/lib/logger";

describe("sensitive log value redaction", () => {
  it("masks phone and email text without logging the full values", () => {
    const value = redactSensitiveLogValue(
      "Caller +1 (415) 555-0198 emailed alex@example.test",
      ["message"],
    );

    expect(value).toBe("Caller ***0198 emailed ***@example.test");
  });

  it("fully redacts caller identity and native Clerk cookie fields", () => {
    expect(redactSensitiveLogValue("Jane Example", ["callerName"])).toBe("[Redacted]");
    expect(redactSensitiveLogValue("client-secret-cookie", ["x-native-clerk-client"])).toBe(
      "[Redacted]",
    );
  });

  it("removes non-string structured secrets rather than serializing them", () => {
    expect(redactSensitiveLogValue({ token: "secret" }, ["token"])).toBe("[Redacted]");
  });
});
