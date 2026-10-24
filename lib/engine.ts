import { evaluate, parse, references, type Node } from "./formula";
import { RESERVED, type FinancialModel, type Line } from "./schema";

export const MAX_MONTHS = 12;
const SECTION_ORDER: Line["section"][] = ["revenue", "cogs", "opex", "below"];

export type DriverValues = Record<string, number>;

export interface ComputedModel {
  months: number;
  /** One row per month: every metric, line and total by id. */
  rows: Record<string, number>[];
  unitEconomics: Record<string, number>;
  /** 1-based month when EBITDA first turns positive, or null. */
  breakEvenMonth: number | null;
  errors: string[];
}

/** Lines in the order they are evaluated: revenue, COGS, opex, then below EBITDA. */
export function orderedLines(model: FinancialModel): Line[] {
  return SECTION_ORDER.flatMap((s) => model.lines.filter((l) => l.section === s));
}

/** Totals that become available once a section has been computed. */
const TOTALS_AFTER: Record<Line["section"], string[]> = {
  revenue: ["revenue"],
  cogs: ["cogs", "gross_profit"],
  opex: ["opex", "ebitda"],
  below: ["below_total", "net_income"],
};

/**
 * Checks that a model the AI returned is internally consistent: unique ids,
 * formulas that parse, and every name a formula reads defined before it is
 * used. Returns human-readable problems (empty when the model is valid);
 * these are sent back to the AI when it has to retry.
 */
export function validateModel(model: FinancialModel): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  const all = [
    ...model.drivers.map((d) => d.id),
    ...model.metrics.map((m) => m.id),
    ...model.lines.map((l) => l.id),
    ...model.unit_economics.map((u) => u.id),
  ];
  for (const name of all) {
    if (RESERVED.has(name)) errors.push(`"${name}" is a reserved name (the app computes it); rename it.`);
    if (seen.has(name)) errors.push(`The id "${name}" is used more than once.`);
    seen.add(name);
  }
  for (const s of ["revenue", "cogs"] as const) {
    if (!model.lines.some((l) => l.section === s)) errors.push(`There must be at least one "${s}" line.`);
  }

  const drivers = new Set(model.drivers.map((d) => d.id));
  const seriesNames = new Set<string>([
    ...model.metrics.map((m) => m.id),
    ...model.lines.map((l) => l.id),
    ...RESERVED,
  ]);
  seriesNames.delete("month");

  function check(where: string, formula: string, available: Set<string>, allowPrev: boolean, allowAggregates: boolean) {
    let node: Node;
    try {
      node = parse(formula);
    } catch (e) {
      errors.push(`${where}: formula "${formula}" does not parse (${(e as Error).message}).`);
      return;
    }
    const usesPrev = /\bprev\s*\(/i.test(formula);
    const usesAgg = /\b(sum|avg|last|first)\s*\(/i.test(formula);
    if (usesPrev && !allowPrev) errors.push(`${where}: prev() is only allowed in metrics and P&L lines.`);
    if (usesAgg && !allowAggregates) errors.push(`${where}: sum()/avg()/last()/first() are only allowed in unit economics.`);
    const { direct, series } = references(node);
    for (const name of direct) {
      if (!available.has(name)) {
        const hint = seriesNames.has(name)
          ? allowAggregates
            ? ` Wrap it in sum(), avg(), last() or first().`
            : ` It is computed later; reorder, or use prev(${name}) for last month's value.`
          : "";
        errors.push(`${where}: "${name}" is not defined at this point.${hint}`);
      }
    }
    for (const name of series) {
      if (!seriesNames.has(name)) errors.push(`${where}: "${name}" inside prev()/sum()/... must be a metric, P&L line or total.`);
    }
  }

  const available = new Set<string>([...drivers, "month"]);
  for (const m of model.metrics) {
    check(`Metric "${m.id}"`, m.formula, available, true, false);
    available.add(m.id);
  }
  for (const section of SECTION_ORDER) {
    for (const l of model.lines.filter((x) => x.section === section)) {
      check(`Line "${l.id}"`, l.formula, available, true, false);
      available.add(l.id);
    }
    TOTALS_AFTER[section].forEach((t) => available.add(t));
  }

  const ueAvailable = new Set<string>(drivers);
  for (const u of model.unit_economics) {
    check(`Unit economics "${u.id}"`, u.formula, ueAvailable, false, true);
    ueAvailable.add(u.id);
  }
  return errors;
}

/** Driver value as formulas see it: percent drivers become fractions (5 → 0.05). */
export function scopeValue(model: FinancialModel, id: string, values: DriverValues): number {
  const d = model.drivers.find((x) => x.id === id);
  const v = values[id] ?? d?.value ?? 0;
  return d?.unit === "percent" ? v / 100 : v;
}

const parseCache = new Map<string, Node>();
function cachedParse(formula: string): Node {
  let n = parseCache.get(formula);
  if (!n) { n = parse(formula); parseCache.set(formula, n); }
  return n;
}

export function compute(model: FinancialModel, values: DriverValues, months: number): ComputedModel {
  const n = Math.max(1, Math.min(MAX_MONTHS, Math.round(months)));
  const errors: string[] = [];
  const driverScope: Record<string, number> = {};
  for (const d of model.drivers) driverScope[d.id] = scopeValue(model, d.id, values);

  const rows: Record<string, number>[] = [];
  const lines = orderedLines(model);

  const safe = (v: number) => (Number.isFinite(v) ? v : 0);

  for (let i = 0; i < n; i++) {
    const row: Record<string, number> = { month: i + 1 };
    const prevRow = rows[i - 1];
    const ctx = {
      get: (name: string) => (name in row ? row[name] : name in driverScope ? driverScope[name] : 0),
      series: (_fn: string, name: string, fallback: number | undefined) =>
        prevRow && name in prevRow ? prevRow[name] : (fallback ?? 0),
    };
    const run = (label: string, id: string, formula: string) => {
      try {
        row[id] = safe(evaluate(cachedParse(formula), ctx));
      } catch (e) {
        row[id] = 0;
        if (i === 0) errors.push(`${label}: ${(e as Error).message}`);
      }
    };
    for (const m of model.metrics) run(m.label, m.id, m.formula);
    for (const section of SECTION_ORDER) {
      for (const l of lines.filter((x) => x.section === section)) run(l.label, l.id, l.formula);
      const sum = (s: Line["section"]) => lines.filter((l) => l.section === s).reduce((a, l) => a + row[l.id], 0);
      if (section === "revenue") row.revenue = sum("revenue");
      if (section === "cogs") { row.cogs = sum("cogs"); row.gross_profit = row.revenue - row.cogs; }
      if (section === "opex") { row.opex = sum("opex"); row.ebitda = row.gross_profit - row.opex; }
      if (section === "below") { row.below_total = sum("below"); row.net_income = row.ebitda - row.below_total; }
    }
    rows.push(row);
  }

  const unitEconomics: Record<string, number> = {};
  const ueCtx = {
    get: (name: string) => (name in unitEconomics ? unitEconomics[name] : driverScope[name] ?? 0),
    series: (fn: string, name: string) => {
      const vals = rows.map((r) => r[name] ?? 0);
      if (fn === "sum") return vals.reduce((a, b) => a + b, 0);
      if (fn === "avg") return vals.reduce((a, b) => a + b, 0) / vals.length;
      if (fn === "last") return vals[vals.length - 1];
      if (fn === "first") return vals[0];
      return 0;
    },
  };
  for (const u of model.unit_economics) {
    try {
      const v = evaluate(cachedParse(u.formula), ueCtx);
      unitEconomics[u.id] = Number.isFinite(v) ? v : NaN;
    } catch (e) {
      unitEconomics[u.id] = NaN;
      errors.push(`${u.label}: ${(e as Error).message}`);
    }
  }

  const idx = rows.findIndex((r) => r.ebitda > 0);
  return { months: n, rows, unitEconomics, breakEvenMonth: idx < 0 ? null : idx + 1, errors };
}

/** Clamp driver ranges so the AI's value always sits inside its slider. */
export function normaliseModel(model: FinancialModel): FinancialModel {
  return {
    ...model,
    drivers: model.drivers.map((d) => {
      let { min, max } = d;
      if (min > max) [min, max] = [max, min];
      if (d.value < min) min = d.value;
      if (d.value > max) max = d.value;
      if (min === max) max = min + Math.max(1, Math.abs(min));
      const step = d.step > (max - min) ? (max - min) / 100 : d.step;
      return { ...d, min, max, step };
    }),
  };
}
