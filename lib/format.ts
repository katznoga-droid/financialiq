import type { Driver, UnitEcon } from "./schema";

export function currencySymbol(currency: string): string {
  try {
    const parts = new Intl.NumberFormat("en-US", { style: "currency", currency, currencyDisplay: "narrowSymbol" }).formatToParts(0);
    return parts.find((p) => p.type === "currency")?.value ?? currency + " ";
  } catch {
    return currency + " ";
  }
}

const int = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** 1234567 → 1,234,567; negatives in parentheses, the accounting way. */
export function accounting(n: number): string {
  if (!Number.isFinite(n)) return "–";
  const s = int.format(Math.abs(Math.round(n)));
  return n < -0.5 ? `(${s})` : s;
}

export function money(n: number, currency: string, digits = 0): string {
  if (!Number.isFinite(n)) return "n/a";
  const sym = currencySymbol(currency);
  const s = Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
  return n < 0 ? `(${sym}${s})` : `${sym}${s}`;
}

export function compactMoney(n: number, currency: string): string {
  if (!Number.isFinite(n)) return "n/a";
  const a = Math.abs(n);
  const sym = currencySymbol(currency);
  let s: string;
  if (a >= 1e9) s = (a / 1e9).toFixed(1) + "B";
  else if (a >= 1e6) s = (a / 1e6).toFixed(1) + "M";
  else if (a >= 1e4) s = Math.round(a / 1e3) + "k";
  else if (a >= 1e3) s = (a / 1e3).toFixed(1) + "k";
  else s = Math.round(a).toString();
  return n < 0 ? `(${sym}${s})` : `${sym}${s}`;
}

export function formatDriver(d: Driver, v: number, currency: string): string {
  switch (d.unit) {
    case "currency": return money(v, currency, Math.abs(v) < 10 ? 2 : 0);
    case "percent": return `${trim(v, 2)}%`;
    case "months": return `${trim(v, 1)} mo`;
    case "count": return int.format(v);
    default: return trim(v, 2);
  }
}

export function formatUnitEcon(u: Pick<UnitEcon, "format">, v: number, currency: string): string {
  if (!Number.isFinite(v)) return "n/a";
  switch (u.format) {
    case "currency": return money(v, currency, Math.abs(v) < 100 ? 2 : 0);
    case "percent": return `${trim(v * 100, 1)}%`;
    case "ratio": return `${trim(v, 1)}×`;
    case "months": return v < 0 ? "never" : `${trim(v, 1)} months`;
    case "count": return int.format(Math.ceil(v));
    default: return trim(v, 2);
  }
}

export function formatMetric(format: string, v: number, currency: string): string {
  if (format === "currency") return accounting(v);
  if (format === "percent") return `${trim(v * 100, 1)}%`;
  if (format === "count") return int.format(Math.round(v));
  void currency;
  return trim(v, 1);
}

function trim(v: number, digits: number): string {
  return Number(v.toFixed(digits)).toLocaleString("en-US", { maximumFractionDigits: digits });
}

/** Unit-economics status: good, bad or neutral, from the AI's threshold and direction. */
export function verdict(u: UnitEcon, v: number): "good" | "bad" | "neutral" {
  if (!Number.isFinite(v)) return "bad";
  if (u.good_threshold == null || u.better === "neutral") return "neutral";
  if (u.format === "months" && u.better === "lower" && v < 0) return "bad";
  return u.better === "higher" ? (v >= u.good_threshold ? "good" : "bad") : (v <= u.good_threshold ? "good" : "bad");
}
