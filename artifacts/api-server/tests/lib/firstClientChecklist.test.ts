import { describe, expect, it } from "vitest";
import {
  FIRST_CLIENT_CHECKLIST_ITEMS,
  isFirstClientChecklistKey,
} from "../../src/lib/firstClientChecklist";

describe("first-client checklist", () => {
  it("contains the seven launch steps in a stable order", () => {
    expect(FIRST_CLIENT_CHECKLIST_ITEMS.map((item) => item.label)).toEqual([
      "Business details reviewed",
      "Plan assigned",
      "Payment confirmed",
      "Phone line provisioned",
      "My test call done",
      "Owner call forwarding set up and verified",
      "First-week check-in done",
    ]);
    expect(FIRST_CLIENT_CHECKLIST_ITEMS.every((item) => isFirstClientChecklistKey(item.key))).toBe(true);
  });

  it("rejects keys that are not part of the fixed checklist", () => {
    expect(isFirstClientChecklistKey("business_details_reviewed")).toBe(true);
    expect(isFirstClientChecklistKey("admin")).toBe(false);
    expect(isFirstClientChecklistKey("")).toBe(false);
  });
});
