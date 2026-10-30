import OpenAI from "openai";

let cachedClient: OpenAI | null | undefined;

export function getOpenAIClient(): OpenAI | null {
  if (cachedClient !== undefined) return cachedClient;

  const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  if (!baseURL || !apiKey) {
    cachedClient = null;
    return cachedClient;
  }

  cachedClient = new OpenAI({
    apiKey,
    baseURL,
    maxRetries: 0,
    timeout: 8_000,
  });
  return cachedClient;
}