import "server-only";
import { PROVIDERS, providerInfo, type ModelOption, type ProviderId } from "../catalog";

// One adapter per provider. Each takes a conversation and returns the model's
// raw text; generate.ts turns that into a validated FinancialModel. API keys are
// read on the server only and never sent to the browser.

export type ChatMessage = { role: "user" | "assistant"; content: string };

/** Per-call settings. Defaults suit a full model build: JSON mode and a large output budget. */
export type ChatOptions = { json?: boolean; maxTokens?: number };

export class ProviderError extends Error {
  constructor(message: string, public status = 502) {
    super(message);
  }
}

const TIMEOUT_MS = 240_000;

export function apiKey(provider: ProviderId): string | undefined {
  const info = providerInfo(provider);
  const v = info ? process.env[info.envKey]?.trim() : undefined;
  return v ? v : undefined;
}

export function configuredProviders(): Record<ProviderId, boolean> {
  return Object.fromEntries(PROVIDERS.map((p) => [p.id, !!apiKey(p.id)])) as Record<ProviderId, boolean>;
}

async function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    const err = e as Error;
    throw new ProviderError(err.name === "TimeoutError" ? "The model took too long to answer. Try again or pick a faster model." : `Could not reach the provider: ${err.message}`);
  }
  const text = await res.text();
  let json: any;
  try { json = JSON.parse(text); } catch { json = undefined; }
  if (!res.ok) {
    const msg = json?.error?.message ?? json?.message ?? text.slice(0, 300);
    throw new ProviderError(`${res.status}: ${msg}`, res.status === 401 || res.status === 403 ? 401 : 502);
  }
  return json;
}

async function callAnthropic(model: string, system: string, messages: ChatMessage[], key: string, opts: ChatOptions): Promise<string> {
  const json = await postJson(
    "https://api.anthropic.com/v1/messages",
    { "x-api-key": key, "anthropic-version": "2023-06-01" },
    { model, max_tokens: opts.maxTokens ?? 16000, system, messages },
  );
  const text = (json.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
  if (json.stop_reason === "max_tokens") throw new ProviderError("The model's answer was cut off. Try again or pick another model.");
  return text;
}

async function callOpenAICompatible(
  url: string,
  headers: Record<string, string>,
  model: string,
  system: string,
  messages: ChatMessage[],
  opts: ChatOptions,
): Promise<string> {
  const body: Record<string, unknown> = {
    model,
    messages: [{ role: "system", content: system }, ...messages],
  };
  if (opts.json !== false) body.response_format = { type: "json_object" };
  // OpenRouter reserves credit for the model's full output limit unless told
  // otherwise, which can fail on a small balance. A model JSON fits well within this.
  if (url.includes("openrouter")) body.max_tokens = opts.maxTokens ?? 12000;
  let json: any;
  try {
    json = await postJson(url, headers, body);
  } catch (e) {
    // Some models don't support JSON mode; ask again without it.
    if (e instanceof ProviderError && /response_format|json/i.test(e.message) && e.status !== 401) {
      delete body.response_format;
      json = await postJson(url, headers, body);
    } else throw e;
  }
  const choice = json.choices?.[0];
  if (!choice) throw new ProviderError(json.error?.message ?? "The provider returned no answer.");
  if (choice.finish_reason === "length") throw new ProviderError("The model's answer was cut off. Try again or pick another model.");
  return choice.message?.content ?? "";
}

export async function chat(provider: ProviderId, model: string, system: string, messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
  const key = apiKey(provider);
  if (!key) throw new ProviderError(`No API key for ${providerInfo(provider)?.label ?? provider}. Add it to .env.local and restart the app.`, 400);
  switch (provider) {
    case "anthropic":
      return callAnthropic(model, system, messages, key, opts);
    case "openai":
      return callOpenAICompatible("https://api.openai.com/v1/chat/completions", { authorization: `Bearer ${key}` }, model, system, messages, opts);
    case "openrouter":
      return callOpenAICompatible(
        "https://openrouter.ai/api/v1/chat/completions",
        { authorization: `Bearer ${key}`, "x-title": "FinancialIQ" },
        model,
        system,
        messages,
        opts,
      );
  }
}

/** The provider's full live model list, for "Show all models". */
export async function listModels(provider: ProviderId): Promise<ModelOption[]> {
  const key = apiKey(provider);
  if (!key) throw new ProviderError("No API key configured for this provider.", 400);
  const get = async (url: string, headers: Record<string, string>) => {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new ProviderError(`Could not list models (${res.status}).`);
    return res.json();
  };
  if (provider === "anthropic") {
    const j = await get("https://api.anthropic.com/v1/models?limit=100", { "x-api-key": key, "anthropic-version": "2023-06-01" });
    return j.data.map((m: any) => ({ id: m.id, label: m.display_name ?? m.id }));
  }
  if (provider === "openai") {
    const j = await get("https://api.openai.com/v1/models", { authorization: `Bearer ${key}` });
    return j.data
      .map((m: any) => m.id as string)
      .filter((id: string) => /^(gpt|o\d|chatgpt)/.test(id) && !/audio|realtime|tts|transcribe|image|search|instruct|codex|embedding|live/.test(id))
      .sort()
      .map((id: string) => ({ id, label: id }));
  }
  const j = await get("https://openrouter.ai/api/v1/models", { authorization: `Bearer ${key}` });
  return j.data
    .filter((m: any) => !String(m.id).endsWith(":batch"))
    .map((m: any) => {
      const inP = Number(m.pricing?.prompt) * 1e6;
      const outP = Number(m.pricing?.completion) * 1e6;
      const price = Number.isFinite(inP) && Number.isFinite(outP) ? `$${inP.toFixed(2)} / $${outP.toFixed(2)}` : undefined;
      return { id: m.id, label: m.name ?? m.id, price };
    })
    .sort((a: ModelOption, b: ModelOption) => a.label.localeCompare(b.label));
}
