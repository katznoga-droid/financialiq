import { NextResponse } from "next/server";
import { providerInfo } from "@/lib/catalog";
import { generateModel } from "@/lib/ai/generate";
import { ProviderError } from "@/lib/ai/providers";

export const maxDuration = 300;

export async function POST(req: Request) {
  let body: { provider?: string; model?: string; scenario?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const info = providerInfo(body.provider ?? "");
  const model = (body.model ?? "").trim();
  const scenario = (body.scenario ?? "").trim();
  if (!info) return NextResponse.json({ error: "Pick a provider." }, { status: 400 });
  if (!model) return NextResponse.json({ error: "Pick a model." }, { status: 400 });
  if (scenario.length < 20) return NextResponse.json({ error: "Describe the business in a little more detail first." }, { status: 400 });
  if (scenario.length > 8000) return NextResponse.json({ error: "The description is too long (8,000 characters at most)." }, { status: 400 });

  const started = Date.now();
  try {
    const result = await generateModel(info.id, model, scenario);
    return NextResponse.json({ ...result, provider: info.id, modelId: model, seconds: Math.round((Date.now() - started) / 1000) });
  } catch (e) {
    const status = e instanceof ProviderError ? e.status : 500;
    const message = e instanceof Error ? e.message : "Something went wrong.";
    console.error(`[generate] ${info.id}/${model} failed:`, message);
    return NextResponse.json({ error: message }, { status });
  }
}
