export type ExtractionDiagnostic = {
  kind: "model_response" | "ai_failure" | "field";
  target: string;
  attempt?: number;
  field?: string;
  accepted?: boolean;
  reason: string;
  rawResponse?: string;
  sourceUrl?: string;
};
export type ExtractionObserver = (event: ExtractionDiagnostic) => void;

// Model responses are untrusted public-page data. Never log request headers,
// client configuration, provider error messages, environment values or credentials.
export function redactExtractionLog(text: string): string {
  return text
    .replace(/-----BEGIN[^-]*PRIVATE KEY-----[\s\S]*?-----END[^-]*PRIVATE KEY-----/g, "[REDACTED]")
    .replace(/\bAIza[\w-]+|\bya29\.[\w.-]+/g, "[REDACTED]")
    .replace(/\b(?:sk|rk)_(?:live|test)_[\w-]+|\bsk-[\w-]+|\bBearer\s+[\w.+/-]+/gi, "[REDACTED]")
    .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+\b/g, "[REDACTED]")
    .replace(/(["']?(?:api[ _-]?key|password|secret|access[_-]?token|refresh[_-]?token|authorization|cookie)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;&]+)/gi, '$1"[REDACTED]"')
    .replace(/([?&](?:token|key|signature|secret|password|credential|api[_-]?key)=)[^&\s"']+/gi, "$1[REDACTED]");
}

export function extractionDiagnostic(event: ExtractionDiagnostic, observer?: ExtractionObserver): void {
  const safe: ExtractionDiagnostic = {
    ...event,
    ...(event.rawResponse !== undefined ? { rawResponse: redactExtractionLog(event.rawResponse) } : {}),
    ...(event.sourceUrl ? { sourceUrl: redactExtractionLog(event.sourceUrl) } : {}),
  };
  observer?.(safe);
  if (process.env.NODE_ENV === "development") {
    console.info(JSON.stringify({ event: "website_extraction", ...safe }));
  }
}
