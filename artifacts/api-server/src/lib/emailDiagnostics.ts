export function emailDiagnosis(error: string) {
  const text = error.replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\b(access_token|refresh_token|client_secret|password)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]").slice(0, 1200);
  if (/SERVICE_DISABLED|accessNotConfigured|Gmail API.*(?:not been used|disabled|not enabled)/i.test(text)) {
    return { error: text, cause: "Gmail API is not enabled in the Google Cloud project.", hint: "Enable the Gmail API for this Google Cloud project, then press Send test email", configuration: true };
  }
  if (/invalid_grant|token.*(?:expired|revoked)|(?:expired|revoked).*token/i.test(text)) {
    return { error: text, cause: "Google authorization expired or was revoked.", hint: "Reconnect Gmail authorization and replace the refresh token in Secrets, then send a test email.", configuration: true };
  }
  if (/insufficient.*(?:scope|permission)|ACCESS_TOKEN_SCOPE_INSUFFICIENT|wrong scope/i.test(text)) {
    return { error: text, cause: "Gmail authorization is missing the send permission.", hint: "Authorize Gmail with the gmail.send scope, then send a test email.", configuration: true };
  }
  if (/429|rateLimitExceeded|userRateLimitExceeded|quota|rate.limit/i.test(text)) {
    return { error: text, cause: "Google rate limit or sending quota was reached.", hint: "Wait for the limit to reset before sending a test or confirming a retry batch.", configuration: false };
  }
  return { error: text, cause: "Gmail sending failed.", hint: "Review the exact error below. Check Google account policy and Gmail configuration before retrying.", configuration: false };
}
