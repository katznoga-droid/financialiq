// Providers and the models offered for each. The curated lists lead with
// low-cost models; "Show all models" in the UI fetches the provider's full live
// list instead. Prices are approximate US$ per 1M input / output tokens
// (October 2026) and are shown only as a guide.

export type ProviderId = "anthropic" | "openai" | "openrouter";

export interface ModelOption {
  id: string;
  label: string;
  tier?: "cheap" | "mid" | "strong";
  price?: string;
}

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  envKey: string;
  defaultModel: string;
  models: ModelOption[];
}

export const PROVIDERS: ProviderInfo[] = [
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    envKey: "ANTHROPIC_API_KEY",
    defaultModel: "claude-haiku-5-5",
    models: [
      { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", tier: "cheap", price: "$0.10 / $0.50" },
      { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", tier: "cheap", price: "$1 / $5" },
      { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", tier: "mid", price: "$2 / $10" },
      { id: "claude-opus-5-5", label: "Claude Opus 5.5", tier: "strong", price: "$4 / $20" },
    ],
  },
  {
    id: "openai",
    label: "OpenAI",
    envKey: "OPENAI_API_KEY",
    defaultModel: "gpt-6-luna",
    models: [
      { id: "gpt-6-luna", label: "GPT-6 Luna", tier: "cheap", price: "$0.10 / $0.50" },
      { id: "gpt-5-nano", label: "GPT-5 nano", tier: "cheap", price: "$0.05 / $0.40" },
      { id: "gpt-4.1-mini", label: "GPT-4.1 mini", tier: "cheap", price: "$0.40 / $1.60" },
      { id: "gpt-5-mini", label: "GPT-5 mini", tier: "cheap", price: "$0.25 / $2" },
      { id: "gpt-6-sol", label: "GPT-6 Sol", tier: "strong", price: "$2 / $10" },
    ],
  },
  {
    id: "openrouter",
    label: "OpenRouter (Grok, Gemini, DeepSeek…)",
    envKey: "OPENROUTER_API_KEY",
    defaultModel: "deepseek/deepseek-v4-flash",
    models: [
      { id: "deepseek/deepseek-v4-flash", label: "DeepSeek V4 Flash", tier: "cheap", price: "$0.09 / $0.18" },
      { id: "google/gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite", tier: "cheap", price: "$0.10 / $0.40" },
      { id: "openai/gpt-6-luna", label: "GPT-6 Luna (via OpenRouter)", tier: "cheap", price: "$0.10 / $0.50" },
      { id: "anthropic/claude-haiku-5.5", label: "Claude Haiku 5.5 (via OpenRouter)", tier: "cheap", price: "$0.10 / $0.50" },
      { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B", tier: "cheap", price: "$0.15 / $0.60" },
      { id: "x-ai/grok-4.3", label: "Grok 4.3 (xAI)", tier: "mid", price: "$1.25 / $2.50" },
    ],
  },
];

export function providerInfo(id: string): ProviderInfo | undefined {
  return PROVIDERS.find((p) => p.id === id);
}
