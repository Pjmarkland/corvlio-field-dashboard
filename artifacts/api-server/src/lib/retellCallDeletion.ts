export async function deleteRetellCall(
  callId: string,
  request: typeof fetch = fetch,
): Promise<void> {
  const apiKey = process.env.RETELL_API_KEY;
  if (!apiKey) throw new Error("Retell deletion is not configured");
  const response = await request(
    `https://api.retellai.com/v2/delete-call/${encodeURIComponent(callId)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiKey}` },
    },
  );
  // Retell returns 422 when the call is already absent. That is an idempotent
  // success for deletion and retention retries.
  if (response.status === 204 || response.status === 422) return;
  throw new Error(`Retell call deletion failed with status ${response.status}`);
}
