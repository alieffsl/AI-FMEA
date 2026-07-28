/**
 * AI client placeholder — reads env variables and provides the interface
 * for future AI API integration.
 */

export type AiClientConfig = {
  apiKey: string;
  endpoint: string;
  model: string;
};

export function getAiConfig(): AiClientConfig | null {
  const apiKey = import.meta.env.VITE_AI_API_KEY;
  const endpoint = import.meta.env.VITE_AI_ENDPOINT || "https://api.openai.com/v1/chat/completions";
  const model = import.meta.env.VITE_AI_MODEL || "gpt-4o";

  if (!apiKey) return null;

  return { apiKey, endpoint, model };
}

export function isAiConfigured(): boolean {
  return getAiConfig() !== null;
}
