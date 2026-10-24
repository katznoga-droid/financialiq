"use client";

import { useState } from "react";
import type { ComputedModel } from "@/lib/engine";
import { compactMoney } from "@/lib/format";

const PINK = "#ff2fb3";
const BLUE = "#4f7cff";
const NEG = "#ff6b8b";
const GRID = "rgba(255,255,255,0.10)";
const AXIS = "rgba(255,255,255,0.35)";

/** Revenue → costs → net income for the whole plan or one month. */
export function Waterfall({ result, currency }: { result: ComputedModel; currency: string }) {
  const [period, setPeriod] = useState<number | "all">("all");
  const pick = (id: string) =>
    period === "all" ? result.rows.reduce((a, r) => a + (r[id] ?? 0), 0) : result.rows[Math.min(period, result.months) - 1]?.[id] ?? 0;

  const rev = pick("revenue"), cogs = pick("cogs"), opex = pick("opex"), below = pick("below_total"), net = pick("net_income");
  const gp = rev - cogs, ebitda = gp - opex;
  const steps = [
    { label: "Revenue", from: 0, to: rev, kind: "total" as const },
    { label: "COGS", from: rev, to: gp, kind: "cost" as const },
    { label: "Opex", from: gp, to: ebitda, kind: "cost" as const },
    ...(Math.abs(below) > 0.5 ? [{ label: "Dep., tax", from: ebitda, to: net, kind: "cost" as const }] : []),
    { label: "Net income", from: 0, to: net, kind: "total" as const },
  ];
  const W = 420, H = 240, top = 24, bottom = 26;
  const maxV = Math.max(rev, ...steps.map((s) => Math.max(s.from, s.to)), 1);
  const minV = Math.min(0, ...steps.map((s) => Math.min(s.from, s.to)));
  const y = (v: number) => top + ((maxV - v) / (maxV - minV || 1)) * (H - top - bottom);
  const slot = W / steps.length;

  return (
    <div className="chart">
      <div className="card-head">
        <h2>Where the money goes</h2>
        <div className="seg" role="group" aria-label="Period">
          <button type="button" aria-pressed={period === "all"} onClick={() => setPeriod("all")}>All</button>
          {result.rows.map((r) => (
            <button key={r.month} type="button" aria-pressed={period === r.month} onClick={() => setPeriod(r.month)}>M{r.month}</button>
          ))}
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Waterfall from revenue to net income">
        <defs>
          <linearGradient id="wfPos" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ff5fc8" /><stop offset="1" stopColor="#b026ff" /></linearGradient>
          <linearGradient id="wfCost" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#7aa0ff" /><stop offset="1" stopColor="#4f4bff" /></linearGradient>
        </defs>
        <line x1={0} x2={W} y1={y(0)} y2={y(0)} stroke={AXIS} />
        {steps.map((s, i) => {
          const hi = Math.max(s.from, s.to), lo = Math.min(s.from, s.to);
          const value = s.to - s.from;
          const fill = s.kind === "cost" ? "url(#wfCost)" : value < 0 ? NEG : "url(#wfPos)";
          const x = i * slot + slot * 0.18, w = slot * 0.64;
          const barTop = y(hi), h = Math.max(2, y(lo) - y(hi));
          const labelY = barTop - 7;
          return (
            <g key={s.label}>
              <rect x={x} y={barTop} width={w} height={h} rx={8} fill={fill} />
              <text x={x + w / 2} y={labelY} textAnchor="middle" className={value < 0 ? "val-neg" : "val"}>
                {compactMoney(s.kind === "cost" ? -Math.abs(value) : value, currency)}
              </text>
              <text x={x + w / 2} y={H - 6} textAnchor="middle">{s.label}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** Smooth curve through points (Catmull-Rom converted to cubic Béziers). */
function smooth(pts: [number, number][]): string {
  if (pts.length < 2) return pts.length ? `M${pts[0][0]},${pts[0][1]}` : "";
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${p2[0]},${p2[1]}`;
  }
  return d;
}

/** Monthly revenue and total costs as smooth areas, net income as a white line. */
export function Trend({ result, currency }: { result: ComputedModel; currency: string }) {
  const rows = result.rows;
  const W = 560, H = 240, left = 54, right = 10, top = 14, bottom = 24;
  const costs = rows.map((r) => r.cogs + r.opex + r.below_total);
  const maxV = Math.max(1, ...rows.map((r) => r.revenue), ...costs, ...rows.map((r) => r.net_income));
  const minV = Math.min(0, ...rows.map((r) => r.net_income));
  const y = (v: number) => top + ((maxV - v) / (maxV - minV || 1)) * (H - top - bottom);
  const x = (i: number) => (rows.length === 1 ? (left + W - right) / 2 : left + (i / (rows.length - 1)) * (W - left - right));
  const ticks = [maxV, maxV / 2, 0, ...(minV < 0 ? [minV] : [])];

  const series = (vals: number[]) => smooth(vals.map((v, i) => [x(i), y(v)]));
  const area = (vals: number[]) => `${series(vals)} L${x(vals.length - 1)},${y(0)} L${x(0)},${y(0)} Z`;
  const revenue = rows.map((r) => r.revenue);
  const net = rows.map((r) => r.net_income);

  return (
    <div className="chart">
      <div className="card-head">
        <h2>Month by month</h2>
        <div className="legend">
          <span><i className="swatch" style={{ background: PINK }} />Revenue</span>
          <span><i className="swatch" style={{ background: BLUE }} />Total costs</span>
          <span><i className="swatch" style={{ background: "#fff", height: 3 }} />Net income</span>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Monthly revenue, costs and net income">
        <defs>
          <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={PINK} stopOpacity=".55" /><stop offset="1" stopColor={PINK} stopOpacity="0" /></linearGradient>
          <linearGradient id="costFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={BLUE} stopOpacity=".45" /><stop offset="1" stopColor={BLUE} stopOpacity="0" /></linearGradient>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={left} x2={W - right} y1={y(t)} y2={y(t)} stroke={t === 0 ? AXIS : GRID} strokeDasharray={t === 0 ? undefined : "3 4"} />
            <text x={left - 8} y={y(t) + 4} textAnchor="end">{compactMoney(t, currency)}</text>
          </g>
        ))}
        <path d={area(costs)} fill="url(#costFill)" />
        <path d={series(costs)} fill="none" stroke={BLUE} strokeWidth={2.5} />
        <path d={area(revenue)} fill="url(#revFill)" />
        <path d={series(revenue)} fill="none" stroke={PINK} strokeWidth={2.5} />
        <path d={series(net)} fill="none" stroke="#fff" strokeWidth={2.5} />
        {rows.map((r, i) => (
          <g key={r.month}>
            <circle cx={x(i)} cy={y(r.net_income)} r={3.5} fill={r.net_income < 0 ? NEG : "#fff"}>
              <title>{`M${r.month}: revenue ${compactMoney(r.revenue, currency)}, costs ${compactMoney(costs[i], currency)}, net income ${compactMoney(r.net_income, currency)}`}</title>
            </circle>
            <text x={x(i)} y={H - 6} textAnchor="middle">M{r.month}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}
