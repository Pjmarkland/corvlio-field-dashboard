import { describe, expect, it } from "vitest";
import { extractRetellLead } from "../../src/lib/retellLeadData";
import { agentDraftPatch, llmDraftPatch } from "../../src/lib/retellDraftConfig";

describe("voice lead extraction compatibility", () => {
  it("stores an existing provider recording URL, without inventing or fetching a recording", () => {
    expect(extractRetellLead({ recording_url: "https://recordings.example.test/call.wav" }).recordingUrl)
      .toBe("https://recordings.example.test/call.wav");
    for (const value of [undefined, null, "", "javascript:alert(1)", "http://recordings.example.test/call.wav", "https://user:pass@example.test/audio"]) {
      expect(extractRetellLead({ recording_url: value }).recordingUrl).toBeNull();
    }
  });
  it.each([
    { "User name": "Sam", Issue: "Leaking pipe", Address: "12 Test St", Urgency: "today", Availability: "afternoon", User_phone: "+15551230000" },
    { caller_name: "Sam", issue_reason: "Leaking pipe", address: "12 Test St", urgency_level: "today", availability: "afternoon", callback_number: "+15551230000" },
    { CALLER_NAME: "Sam", ISSUE_REASON: "Leaking pipe", ADDRESS: "12 Test St", URGENCY_LEVEL: "today", AVAILABILITY: "afternoon", CALLBACK_NUMBER: "+15551230000" },
    { "USER NAME": "Sam", ISSUE: "Leaking pipe", ADDRESS: "12 Test St", URGENCY: "today", AVAILABILITY: "afternoon", USER_PHONE: "+15551230000" },
  ])("retains all captured fields from old/new/mixed-case analysis: %j", (analysis) => {
    expect(extractRetellLead({ from_number: "+15559990000", call_analysis: { custom_analysis_data: analysis } })).toMatchObject({
      callerName: "Sam", issueReason: "Leaking pipe", address: "12 Test St", urgencyLevel: "today", availability: "afternoon",
      phoneNumber: "+15551230000", callbackNumber: "+15551230000", callerId: "+15559990000",
    });
  });
  it("falls back to caller ID without pretending it was a spoken callback", () => {
    expect(extractRetellLead({ from_number: "+15559990000" })).toMatchObject({
      phoneNumber: "+15559990000", callerId: "+15559990000", callbackNumber: null,
    });
  });
  it("keeps numbers as text, including country code and leading zeros", () => {
    expect(extractRetellLead({ call_analysis: { custom_analysis_data: { callback_number: "+440012345678" } } }).callbackNumber).toBe("+440012345678");
  });
  it("uses captured legacy data when a new alias is blank", () => {
    expect(extractRetellLead({ call_analysis: { custom_analysis_data: { caller_name: "", "User name": "Sam" } } }).callerName).toBe("Sam");
  });
  it("saves partial transcript/summary before analysis, then reads authoritative summary", () => {
    const call = { transcript_object: [{ role: "agent", content: "How can I help?" }, { role: "user", content: "The pipe is leaking" }] };
    const partial = extractRetellLead(call);
    expect(partial.transcript).toContain("user: The pipe is leaking");
    expect(partial.summary).toBe("Partial call — The pipe is leaking");
    expect(partial.issueReason).toBe(partial.summary);
    expect(extractRetellLead({ ...call, call_analysis: { call_summary: "Caller reported a leaking pipe and hung up." } }).summary)
      .toBe("Caller reported a leaking pipe and hung up.");
  });
  it("the draft uses canonical extraction keys and a text callback, with no transfer destination", () => {
    expect(agentDraftPatch.post_call_analysis_data.map(v => v.name)).toEqual(expect.arrayContaining([
      "caller_name", "callback_number", "issue_reason", "address", "urgency_level", "availability",
    ]));
    expect(agentDraftPatch.post_call_analysis_data.find(v => v.name === "callback_number")?.type).toBe("string");
    expect(llmDraftPatch.general_tools.map(t => t.type)).toEqual(["end_call"]);
    expect(llmDraftPatch.general_prompt).toContain("CALLBACK NUMBER");
    expect(llmDraftPatch.general_prompt).toContain("{{business_hours}}");
    expect(llmDraftPatch.general_prompt).toContain("{{emergency_contact_info}}");
    expect(agentDraftPatch.voice_speed).toBe(1);
    expect(agentDraftPatch.ambient_sound).toBeNull();
  });
});