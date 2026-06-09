import type OpenAI from "openai";

type AiPurpose = "chat" | "analysis";

type AiRuntimeConfig = {
  apiKey: string;
  baseURL?: string;
  defaultHeaders?: Record<string, string>;
  model: string;
  providerLabel: string;
};

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";

export function hasConfiguredAiProvider() {
  return Boolean(resolveAiRuntimeConfig("chat"));
}

export async function createOpenAICompatibleClient(purpose: AiPurpose) {
  const config = resolveAiRuntimeConfig(purpose);
  if (!config) return null;

  const { OpenAI } = await import("openai");
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    defaultHeaders: config.defaultHeaders,
    // Cap how long an AI call can block. The SDK default is 10 minutes with 2
    // retries; without a cap a slow provider can hang the analysis pipeline far
    // past any reverse-proxy timeout and surface as a 502. Overridable via env.
    timeout: Number(cleanEnv(process.env.TARASENSE_AI_TIMEOUT_MS)) || 25_000,
    maxRetries: Number(cleanEnv(process.env.TARASENSE_AI_MAX_RETRIES)) || 1,
  });

  return {
    client,
    model: config.model,
    providerLabel: config.providerLabel,
  };
}

export function parseJsonObjectResponse(raw: string) {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  return JSON.parse(candidate) as Record<string, unknown>;
}

function resolveAiRuntimeConfig(purpose: AiPurpose): AiRuntimeConfig | null {
  const openRouterKey = cleanEnv(process.env.OPENROUTER_API_KEY);
  const openAiKey = cleanEnv(process.env.OPENAI_API_KEY);
  const provider = cleanEnv(process.env.TARASENSE_AI_PROVIDER)?.toLowerCase();
  const useOpenRouter = provider === "openrouter" || Boolean(openRouterKey) || openAiKey?.startsWith("sk-or-");

  if (useOpenRouter) {
    const apiKey = openRouterKey ?? openAiKey;
    if (!apiKey) return null;

    return {
      apiKey,
      baseURL: cleanEnv(process.env.OPENROUTER_BASE_URL) ?? OPENROUTER_BASE_URL,
      defaultHeaders: buildOpenRouterHeaders(),
      model:
        modelForPurpose(purpose) ??
        cleanEnv(process.env.OPENROUTER_MODEL) ??
        cleanEnv(process.env.OPENAI_CHAT_MODEL) ??
        DEFAULT_OPENAI_MODEL,
      providerLabel: "OpenRouter",
    };
  }

  if (!openAiKey) return null;

  return {
    apiKey: openAiKey,
    baseURL: cleanEnv(process.env.OPENAI_BASE_URL),
    model: modelForPurpose(purpose) ?? cleanEnv(process.env.OPENAI_CHAT_MODEL) ?? DEFAULT_OPENAI_MODEL,
    providerLabel: "OpenAI-compatible",
  };
}

function modelForPurpose(purpose: AiPurpose) {
  if (purpose === "analysis") {
    return cleanEnv(process.env.TARASENSE_AI_ANALYSIS_MODEL) ?? cleanEnv(process.env.TARASENSE_AI_MODEL);
  }

  return cleanEnv(process.env.TARASENSE_AI_CHAT_MODEL) ?? cleanEnv(process.env.TARASENSE_AI_MODEL);
}

function buildOpenRouterHeaders() {
  const headers: Record<string, string> = {};
  const referer = cleanEnv(process.env.OPENROUTER_HTTP_REFERER);
  const title = cleanEnv(process.env.OPENROUTER_APP_TITLE) ?? "TARAsense";

  if (referer) headers["HTTP-Referer"] = referer;
  if (title) headers["X-Title"] = title;

  return headers;
}

function cleanEnv(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export type OpenAICompatibleClient = OpenAI;
