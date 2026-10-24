import { NextResponse } from "next/server";
import { providerInfo } from "@/lib/catalog";
import { listModels, ProviderError } from "@/lib/ai/providers";

export async function GET(req: Request) {
  const info = providerInfo(new URL(req.url).searchParams.get("provider") ?? "");
  if (!info) return NextResponse.json({ error: "Unknown provider." }, { status: 400 });
  try {
    return NextResponse.json({ models: await listModels(info.id) });
  } catch (e) {
    const status = e instanceof ProviderError ? e.status : 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
