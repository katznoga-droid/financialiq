"use client";

import { Fragment } from "react";
import type { ComputedModel } from "@/lib/engine";
import { accounting, currencySymbol, formatMetric } from "@/lib/format";
import type { FinancialModel, Line } from "@/lib/schema";

type Row =
  | { kind: "section"; label: string }
  | { kind: "metric"; id: string; label: string; format: string }
  | { kind: "line" | "total" | "grand"; id: string; label: string; cost?: boolean }
  | { kind: "pct"; label: string; num: string };

const SECTIONS: { section: Line["section"]; title: string; total?: { id: string; label: string }; after?: Row[] }[] = [
  { section: "revenue", title: "Revenue", total: { id: "revenue", label: "Total revenue" } },
  {
    section: "cogs", title: "Cost of goods sold", total: { id: "cogs", label: "Total COGS" },
    after: [{ kind: "total", id: "gross_profit", label: "Gross profit" }, { kind: "pct", label: "Gross margin", num: "gross_profit" }],
  },
  {
    section: "opex", title: "Operating expenses", total: { id: "opex", label: "Total operating expenses" },
    after: [{ kind: "grand", id: "ebitda", label: "EBITDA" }, { kind: "pct", label: "EBITDA margin", num: "ebitda" }],
  },
  { section: "below", title: "Below EBITDA" },
];

export function buildRows(model: FinancialModel): Row[] {
  const rows: Row[] = [];
  if (model.metrics.length) {
    rows.push({ kind: "section", label: "Operating metrics" });
    model.metrics.forEach((m) => rows.push({ kind: "metric", id: m.id, label: m.label, format: m.format }));
  }
  for (const s of SECTIONS) {
    const lines = model.lines.filter((l) => l.section === s.section);
    if (!lines.length && s.section === "below") continue;
    rows.push({ kind: "section", label: s.title });
    lines.forEach((l) => rows.push({ kind: "line", id: l.id, label: l.label, cost: s.section !== "revenue" }));
    if (s.total && lines.length > 1) rows.push({ kind: "total", id: s.total.id, label: s.total.label, cost: s.section !== "revenue" });
    s.after?.forEach((r) => rows.push(r));
  }
  rows.push({ kind: "grand", id: "net_income", label: "Net income" }, { kind: "pct", label: "Net margin", num: "net_income" });
  return rows;
}

export default function PnlTable({ model, result }: { model: FinancialModel; result: ComputedModel }) {
  const rows = buildRows(model);
  const total = (id: string) => result.rows.reduce((a, r) => a + (r[id] ?? 0), 0);
  const pct = (num: number, den: number) => (den ? `${((num / den) * 100).toFixed(1)}%` : "–");

  return (
    <div className="table-wrap">
      <table className="pnl">
        <thead>
          <tr>
            <th scope="col" style={{ textAlign: "left", position: "sticky", left: 0, zIndex: 1 }}>{currencySymbol(model.currency).trim()} · monthly</th>
            {result.rows.map((r) => <th scope="col" key={r.month}>M{r.month}</th>)}
            <th scope="col" className="total-col">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            if (row.kind === "section") {
              return <tr key={i} className="section"><th scope="row" colSpan={result.months + 2}>{row.label}</th></tr>;
            }
            if (row.kind === "pct") {
              return (
                <tr key={i} className="subtle">
                  <th scope="row" className="indent">{row.label}</th>
                  {result.rows.map((r) => <td key={r.month}>{pct(r[row.num], r.revenue)}</td>)}
                  <td className="total-col">{pct(total(row.num), total("revenue"))}</td>
                </tr>
              );
            }
            if (row.kind === "metric") {
              const isFlow = row.format === "currency" || /new|added|orders|sold|units|visits|leads/i.test(row.label);
              const agg = isFlow ? total(row.id) : result.rows[result.rows.length - 1]?.[row.id] ?? 0;
              return (
                <tr key={i} className="subtle">
                  <th scope="row" className="indent">{row.label}</th>
                  {result.rows.map((r) => <td key={r.month}>{formatMetric(row.format, r[row.id], model.currency)}</td>)}
                  <td className="total-col" title={isFlow ? "Sum over the plan" : "At the end of the plan"}>{formatMetric(row.format, agg, model.currency)}</td>
                </tr>
              );
            }
            const sign = row.kind === "line" && row.cost ? -1 : row.kind === "total" && row.cost ? -1 : 1;
            const cls = row.kind === "line" ? "" : row.kind;
            return (
              <Fragment key={i}>
                <tr className={cls}>
                  <th scope="row" className={row.kind === "line" ? "indent" : ""}>{row.label}</th>
                  {result.rows.map((r) => {
                    const v = (r[row.id] ?? 0) * sign;
                    return <td key={r.month} className={v < -0.5 ? "neg" : ""}>{accounting(v)}</td>;
                  })}
                  <td className={`total-col ${total(row.id) * sign < -0.5 ? "neg" : ""}`}>{accounting(total(row.id) * sign)}</td>
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
