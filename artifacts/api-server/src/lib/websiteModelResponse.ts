import { extractionDiagnostic, type ExtractionObserver } from "./websiteDiagnostics";

/** One short-prompt retry for transport, empty response, bad JSON or bad shape. */
export async function websiteModelResponse(
  request: (shortPrompt: boolean) => Promise<string | null | undefined>,
  target: string, deadline: number, observer?: ExtractionObserver,
): Promise<Record<string, { value?: unknown; evidence?: unknown }>> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    let reason = "request_failed";
    try {
      if (Date.now() >= deadline) { reason = "deadline_exhausted"; throw new Error(reason); }
      const content = await request(attempt === 2);
      extractionDiagnostic({ kind: "model_response", target, attempt, reason: "received", rawResponse: content ?? "" }, observer);
      if (!content) { reason = "empty_response"; throw new Error(reason); }
      reason = "invalid_json";
      const parsed: unknown = JSON.parse(content);
      reason = "invalid_shape";
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(reason);
      return parsed as Record<string, { value?: unknown; evidence?: unknown }>;
    } catch {
      extractionDiagnostic({ kind: "ai_failure", target, attempt, reason }, observer);
      if (attempt === 2 || Date.now() >= deadline) throw new Error("Website extraction failed after its bounded retry");
    }
  }
  throw new Error("Website extraction unavailable");
}
