import type { ComputedModel } from "./engine";
import { buildRows } from "@/components/PnlTable";
import type { FinancialModel } from "./schema";
import type { DriverValues } from "./engine";

const cell = (v: string | number) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** A CSV that opens in Excel: the P&L by month, then the drivers and unit economics. */
export function toCsv(model: FinancialModel, result: ComputedModel, values: DriverValues): string {
  const out: (string | number)[][] = [];
  out.push([model.title, `Currency: ${model.currency}`]);
  out.push([]);
  out.push(["Line", ...result.rows.map((r) => `Month ${r.month}`), "Total"]);
  for (const row of buildRows(model)) {
    if (row.kind === "section") { out.push([row.label]); continue; }
    if (row.kind === "pct") {
      out.push([row.label, ...result.rows.map((r) => (r.revenue ? (r[row.num] / r.revenue).toFixed(4) : ""))]);
      continue;
    }
    const sign = row.kind !== "metric" && "cost" in row && row.cost ? -1 : 1;
    const vals = result.rows.map((r) => Math.round((r[row.id] ?? 0) * sign * 100) / 100);
    out.push([row.label, ...vals, Math.round(vals.reduce((a, b) => a + b, 0) * 100) / 100]);
  }
  out.push([]);
  out.push(["Driver", "Value", "Unit", "Source", "Why"]);
  for (const d of model.drivers) out.push([d.label, values[d.id] ?? d.value, d.unit, d.source === "user" ? "From prompt" : "AI estimate", d.rationale]);
  out.push([]);
  out.push(["Unit economics", "Value", "Formula"]);
  for (const u of model.unit_economics) out.push([u.label, result.unitEconomics[u.id], u.formula]);
  return out.map((r) => r.map(cell).join(",")).join("\r\n");
}

export function download(filename: string, text: string) {
  const blob = new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
