import { describe, expect, it } from "vitest";
import { BUSINESS_NAME_MESSAGE, businessNameValidationError } from "../../src/lib/businessNameValidation";

describe("business name safety", () => {
  it.each([
    "Fuck Plumbing", "SHIT Repairs", "Bitch Services", "Asshole Heating",
    "Fucking Electric", "Bullshit Builders", "Motherfuckers LLC", "Cocksuckers LLC",
    "Nigger Repairs", "N1gg3r Repairs", "Faggot Plumbing", "F@gg0t Plumbing",
    "Sh!t Repairs", "F u c k Plumbing", "Fu ck Plumbing", "F.u.c.k Plumbing",
    "F_u_c_k Plumbing", "N 1 g g 3 r Repairs", "B i t c h Cleaning",
    "Fu\u200bck Plumbing", "Ｆｕｃｋ Plumbing", "Fück Plumbing", "Fuсk Plumbing",
    "Nazi Services", "Heil Hitler Builders", "Scunthorpe Fuck Plumbing",
    "Example Fictional Sample Fuck Plumbing",
    "Niggers Plumbing", "Cunts Electric", "F*cking Plumbing", "F*ckers LLC",
    "B1tch Repairs", "F4gg0t Plumbing", "Sh1t Repairs",
  ])("rejects offensive or disguised terms: %s", value => {
    expect(businessNameValidationError(value)).toBe(BUSINESS_NAME_MESSAGE);
  });
  it.each([
    "Corvlio", "Scunthorpe Plumbing", "Penistone Builders", "Dickson Electric",
    "Cockburn Heating", "Hancock & Sons", "Cassidy Repairs", "Sussex Services",
    "Dick’s Plumbing", "Hooker Heating", "Niger River Tours", "Montenegro Builders",
    "Classic Glass", "Canal Side Plumbing", "Sexton & Sons", "Assistant Electric",
    "Analysis Heating", "Pen Is Mighty Printing", "José García Repairs",
    "Müller & Söhne", "山田設備", "Harbor Electric Co.", "Fictional Sample Plumbing",
  ])("accepts real names without substring false positives: %s", value => {
    expect(businessNameValidationError(value)).toBeNull();
  });
  it.each(["", "   ", "a".repeat(161)])("rejects empty or oversized names", value => {
    expect(businessNameValidationError(value)).toContain("real business name");
  });
});
