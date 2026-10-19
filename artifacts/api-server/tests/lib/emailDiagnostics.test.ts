import {describe,it,expect} from "vitest";
import {emailDiagnosis} from "../../src/lib/emailDiagnostics";

describe("Gmail diagnosis",()=>{
  it.each(["Gmail API has not been used in project 1028015564678 before or it is disabled.",
    "Gmail API is not enabled for Google Cloud project 1028015564678."])("recognizes old and current disabled API errors",message=>{
    const d=emailDiagnosis(message);
    expect(d.configuration).toBe(true);
    expect(d.hint).toBe("Enable the Gmail API for this Google Cloud project, then press Send test email");
  });
  it.each(["invalid_grant","Refresh token expired","Token was revoked","ACCESS_TOKEN_SCOPE_INSUFFICIENT"])("stops configuration retries: %s",message=>{
    expect(emailDiagnosis(message).configuration).toBe(true);
  });
  it.each(["HTTP 429","userRateLimitExceeded","Gmail quota exceeded","HTTP 503","fetch failed"])("preserves transient retry behavior: %s",message=>{
    expect(emailDiagnosis(message).configuration).toBe(false);
  });
  it("removes credentials from surfaced diagnostics",()=>{
    expect(emailDiagnosis("access_token=secret Bearer token").error).not.toContain("=secret");
  });
});
