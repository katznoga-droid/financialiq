import { NextResponse } from "next/server";
import { providerInfo } from "@/lib/catalog";
import { sampleScenario } from "@/lib/ai/sample";
import { ProviderError } from "@/lib/ai/providers";

export const maxDuration = 120;

export async function POST(req: Request) {
  let body: { provider?: string; model?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const info = providerInfo(body.provider ?? "");
  const model = (body.model ?? "").trim();
  if (!info) return NextResponse.json({ error: "Pick a provider." }, { status: 400 });
  if (!model) return NextResponse.json({ error: "Pick a model." }, { status: 400 });

  try {
    return NextResponse.json(await sampleScenario(info.id, model));
  } catch (e) {
    const status = e instanceof ProviderError ? e.status : 500;
    const message = e instanceof Error ? e.message : "Something went wrong.";
    console.error(`[sample] ${info.id}/${model} failed:`, message);
    return NextResponse.json({ error: message }, { status });
  }
}
