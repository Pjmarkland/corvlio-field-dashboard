import { describe, expect, it } from "vitest";
import { normalizeUsPhoneNumber } from "../../src/lib/usPhoneNumber";

describe("normalizeUsPhoneNumber", () => {
  it.each([
    ["8634463029", "+18634463029"],
    ["1-863-446-3029", "+18634463029"],
    ["+1 (863) 446-3029", "+18634463029"],
    ["+18634463029", "+18634463029"],
  ])("normalizes %s to E.164", (input, expected) => {
    expect(normalizeUsPhoneNumber(input)).toBe(expected);
  });

  it.each([
    "",
    "   ",
    "+44 20 7946 0958",
    "+1 163 446 3029",
    "+1 863 146 3029",
    "863446302",
    "28634463029",
    "863-446-3029 ext 2",
    "javascript:alert(1)",
  ])("rejects invalid or non-US input %j", (input) => {
    expect(normalizeUsPhoneNumber(input)).toBeNull();
  });
});
