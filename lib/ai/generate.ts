import "server-only";
import type { ProviderId } from "../catalog";
import { compute, normaliseModel, validateModel } from "../engine";
import { FinancialModelSchema, type FinancialModel } from "../schema";
import { repairPrompt, systemPrompt, userPrompt } from "./prompt";
import { chat, ProviderError, type ChatMessage } from "./providers";

const MAX_ATTEMPTS = 3;

/** Pull the first JSON object out of a reply, tolerating code fences or stray prose. */
export function extractJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try { return JSON.parse(trimmed); } catch { /* fall through */ }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
  throw new Error("The reply did not contain a JSON object.");
}

/** Schema check, consistency check and a trial calculation. Returns problems for the AI to fix. */
export function checkModel(raw: unknown): { model?: FinancialModel; problems: string[] } {
  const parsed = FinancialModelSchema.safeParse(raw);
  if (!parsed.success) {
    return { problems: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`) };
  }
  const model = normaliseModel(parsed.data);
  const problems = validateModel(model);
  if (problems.length) return { problems };
  const trial = compute(model, {}, 12);
  if (trial.errors.length) return { problems: trial.errors };
  return { model, problems: [] };
}

export async function generateModel(provider: ProviderId, model: string, scenario: string): Promise<{ model: FinancialModel; attempts: number }> {
  const system = systemPrompt();
  const messages: ChatMessage[] = [{ role: "user", content: userPrompt(scenario) }];
  let lastProblems: string[] = [];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const reply = await chat(provider, model, system, messages);
    let raw: unknown;
    try {
      raw = extractJson(reply);
    } catch (e) {
      lastProblems = [(e as Error).message];
    }
    if (raw !== undefined) {
      const result = checkModel(raw);
      if (result.model) return { model: result.model, attempts: attempt };
      lastProblems = result.problems;
    }
    messages.push({ role: "assistant", content: reply || "(empty reply)" }, { role: "user", content: repairPrompt(lastProblems) });
  }
  throw new ProviderError(
    `The model's answer still had problems after ${MAX_ATTEMPTS} tries, so it wasn't used. Try again or pick a stronger model. First problem: ${lastProblems[0] ?? "unknown"}`,
    422,
  );
}
