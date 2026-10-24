import ExcelJS from "exceljs";
import { orderedLines, type ComputedModel, type DriverValues } from "./engine";
import { parse, SERIES_FNS, type Node } from "./formula";
import { currencySymbol } from "./format";
import type { FinancialModel, Line, UnitEcon } from "./schema";

// A real Excel workbook: drivers are input cells, and every P&L and unit
// economics cell is a live Excel formula translated from the model's own
// formula language, so changing a driver in Excel recalculates everything.

const PNL = "Monthly P&L";
const PNL_REF = `'${PNL}'!`;
const DRV_REF = "Drivers!";

const C = {
  deep: "FF3B0A8F",
  violet: "FFB026FF",
  pink: "FFFF2FB3",
  ink: "FF1B1035",
  muted: "FF6E6390",
  sectionFill: "FFF4EEFF",
  sectionInk: "FF5B1BB0",
  grandFill: "FFEDE3FF",
  inputFill: "FFFFE6F5",
  inputInk: "FF1F3FD9",
  inputEdge: "FFFF8FD3",
  rule: "FFE4DCF5",
};

const ACCOUNTING = '#,##0;(#,##0);"–"';

const fill = (argb: string): ExcelJS.Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
const thin = (argb: string): Partial<ExcelJS.Border> => ({ style: "thin", color: { argb } });

/** Column letters for a 1-based column number. */
function col(n: number): string {
  let s = "";
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

// ---------------------------------------------------------------------------
// Formula translation: our formula language → Excel.
// Every node becomes an Excel string plus its precedence, so parentheses are
// added only where Excel would otherwise read it differently.

interface Scope {
  ref(name: string): string;
  prev(name: string, fallback: string | null): string;
  series(fn: string, name: string): string;
}

type Out = { s: string; p: number };
const ATOM = 10;
const wrap = (o: Out, min: number) => (o.p < min ? `(${o.s})` : o.s);

const CMP: Record<string, string> = { "<": "<", ">": ">", "<=": "<=", ">=": ">=", "==": "=", "!=": "<>" };

/** A condition for IF/AND/OR: comparisons stay as they are, numbers count as true when non-zero. */
function cond(n: Node, sc: Scope): string {
  if (n.k === "bin" && CMP[n.op]) return `${wrap(xl(n.a, sc), 5)}${CMP[n.op]}${wrap(xl(n.b, sc), 5)}`;
  if (n.k === "bin" && n.op === "&&") return `AND(${cond(n.a, sc)},${cond(n.b, sc)})`;
  if (n.k === "bin" && n.op === "||") return `OR(${cond(n.a, sc)},${cond(n.b, sc)})`;
  return `${wrap(xl(n, sc), 5)}<>0`;
}

function xl(n: Node, sc: Scope): Out {
  switch (n.k) {
    case "num": return { s: String(n.v), p: ATOM };
    case "ref": return { s: sc.ref(n.name), p: ATOM };
    case "neg": return { s: `-${wrap(xl(n.a, sc), ATOM)}`, p: 6 };
    case "bin": {
      const a = xl(n.a, sc);
      const b = xl(n.b, sc);
      switch (n.op) {
        case "+": case "-": return { s: `${wrap(a, 5)}${n.op}${wrap(b, 6)}`, p: 5 };
        case "*": return { s: `${wrap(a, 6)}*${wrap(b, 7)}`, p: 6 };
        // The app reads divide-by-zero as 0; IFERROR does the same in Excel.
        case "/": return n.b.k === "num" && n.b.v !== 0
          ? { s: `${wrap(a, 6)}/${wrap(b, 7)}`, p: 6 }
          : { s: `IFERROR(${wrap(a, 6)}/${wrap(b, 7)},0)`, p: ATOM };
        // Excel's ^ is left-associative and its minus binds tighter, so bracket both sides.
        case "^": return { s: `${wrap(a, ATOM)}^${wrap(b, ATOM)}`, p: 7 };
        default: return { s: `IF(${cond(n, sc)},1,0)`, p: ATOM };
      }
    }
    case "call": {
      if (SERIES_FNS.has(n.fn)) {
        const name = (n.args[0] as { name: string }).name;
        if (n.fn === "prev") return { s: sc.prev(name, n.args[1] ? xl(n.args[1], sc).s : null), p: ATOM };
        return { s: sc.series(n.fn, name), p: ATOM };
      }
      const args = n.args.map((a) => xl(a, sc).s);
      switch (n.fn) {
        case "min": return { s: `MIN(${args.join(",")})`, p: ATOM };
        case "max": return { s: `MAX(${args.join(",")})`, p: ATOM };
        case "abs": return { s: `ABS(${args[0]})`, p: ATOM };
        case "floor": return { s: `FLOOR(${args[0]},1)`, p: ATOM };
        case "ceil": return { s: `CEILING(${args[0]},1)`, p: ATOM };
        case "round": return { s: `ROUND(${args[0]},${args[1] ?? 0})`, p: ATOM };
        case "clamp": return { s: `MIN(MAX(${args[0]},${args[1]}),${args[2]})`, p: ATOM };
        case "if": return { s: `IF(${cond(n.args[0], sc)},${args[1]},${args[2] ?? 0})`, p: ATOM };
      }
      throw new Error(`Unknown function ${n.fn}`);
    }
  }
}

export function toExcelFormula(formula: string, sc: Scope): string {
  return xl(parse(formula), sc).s;
}

// ---------------------------------------------------------------------------
// Number formats

function quoteSym(sym: string) {
  return `"${sym.trim().replace(/"/g, "")}"`;
}

function decimals(v: number, max = 2) {
  for (let d = 0; d < max; d++) if (Math.abs(v * 10 ** d - Math.round(v * 10 ** d)) < 1e-9) return d;
  return max;
}

const fixed = (d: number) => (d ? `0.${"0".repeat(d)}` : "0");

function driverFormat(unit: string, value: number, sym: string): string {
  switch (unit) {
    case "currency": return `${sym}#,##0${Math.abs(value) < 10 ? ".00" : ""};(${sym}#,##0${Math.abs(value) < 10 ? ".00" : ""})`;
    case "percent": return `${fixed(decimals(value))}%`;
    case "months": return `${fixed(decimals(value, 1))}" mo"`;
    case "count": return "#,##0";
    default: return `#,##${fixed(decimals(value))}`;
  }
}

function ueFormat(u: UnitEcon, value: number, sym: string): string {
  switch (u.format) {
    case "currency": return Math.abs(value) < 100 ? `${sym}#,##0.00;(${sym}#,##0.00)` : `${sym}#,##0;(${sym}#,##0)`;
    case "percent": return "0.0%";
    case "ratio": return '0.0"×"';
    case "months": return '0.0" months";"never"';
    case "count": return "#,##0";
    default: return "#,##0.00";
  }
}

const METRIC_FORMAT: Record<string, string> = { currency: ACCOUNTING, percent: "0.0%", count: "#,##0", number: "#,##0.0" };

// ---------------------------------------------------------------------------

type PnlRow =
  | { kind: "section"; label: string }
  | { kind: "metric"; id: string; label: string; format: string; formula: string }
  | { kind: "line"; id: string; label: string; formula: string }
  | { kind: "total" | "grand"; id: string; label: string; note: string }
  | { kind: "pct"; label: string; num: string };

const SECTIONS: { section: Line["section"]; title: string; total: { id: string; label: string }; after: PnlRow[] }[] = [
  { section: "revenue", title: "Revenue", total: { id: "revenue", label: "Total revenue" }, after: [] },
  {
    section: "cogs", title: "Cost of goods sold", total: { id: "cogs", label: "Total COGS" },
    after: [
      { kind: "total", id: "gross_profit", label: "Gross profit", note: "revenue - cogs" },
      { kind: "pct", label: "Gross margin", num: "gross_profit" },
    ],
  },
  {
    section: "opex", title: "Operating expenses", total: { id: "opex", label: "Total operating expenses" },
    after: [
      { kind: "grand", id: "ebitda", label: "EBITDA", note: "gross_profit - opex" },
      { kind: "pct", label: "EBITDA margin", num: "ebitda" },
    ],
  },
  { section: "below", title: "Below EBITDA", total: { id: "below_total", label: "Total below EBITDA" }, after: [] },
];

/** The P&L rows of the sheet. Unlike the app's table, every section total gets a row, since formulas refer to it. */
function pnlRows(model: FinancialModel): PnlRow[] {
  const rows: PnlRow[] = [];
  if (model.metrics.length) {
    rows.push({ kind: "section", label: "Operating metrics" });
    model.metrics.forEach((m) => rows.push({ kind: "metric", id: m.id, label: m.label, format: m.format, formula: m.formula }));
  }
  const lines = orderedLines(model);
  for (const s of SECTIONS) {
    const ls = lines.filter((l) => l.section === s.section);
    if (!ls.length && s.section === "below") continue;
    rows.push({ kind: "section", label: s.title });
    ls.forEach((l) => rows.push({ kind: "line", id: l.id, label: l.label, formula: l.formula }));
    rows.push({ kind: "total", id: s.total.id, label: s.total.label, note: `sum of ${s.title.toLowerCase()}` });
    s.after.forEach((r) => rows.push(r));
  }
  rows.push(
    { kind: "grand", id: "net_income", label: "Net income", note: "ebitda - below EBITDA" },
    { kind: "pct", label: "Net margin", num: "net_income" },
  );
  return rows;
}

function banner(ws: ExcelJS.Worksheet, lastCol: number, title: string, subtitle: string) {
  ws.mergeCells(1, 1, 1, lastCol);
  ws.mergeCells(2, 1, 2, lastCol);
  const t = ws.getCell(1, 1);
  t.value = title;
  t.font = { name: "Calibri", size: 16, bold: true, color: { argb: "FFFFFFFF" } };
  t.fill = fill(C.deep);
  t.alignment = { vertical: "middle", indent: 1 };
  ws.getRow(1).height = 30;
  const s = ws.getCell(2, 1);
  s.value = subtitle;
  s.font = { name: "Calibri", size: 10, color: { argb: "FFFFFFFF" } };
  s.fill = fill(C.pink);
  s.alignment = { vertical: "middle", indent: 1 };
  ws.getRow(2).height = 18;
}

function headerRow(ws: ExcelJS.Worksheet, r: number, from: number, to: number) {
  const row = ws.getRow(r);
  row.height = 20;
  for (let c = from; c <= to; c++) {
    const cell = row.getCell(c);
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = fill(C.violet);
    cell.alignment = { vertical: "middle", horizontal: c === 1 ? "left" : "center", indent: c === 1 ? 1 : 0 };
  }
}

const noteFont: Partial<ExcelJS.Font> = { italic: true, size: 9, color: { argb: C.muted } };

export function buildWorkbook(model: FinancialModel, result: ComputedModel, values: DriverValues): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = "FinancialIQ";
  wb.created = new Date();
  wb.calcProperties.fullCalcOnLoad = true;
  const sym = quoteSym(currencySymbol(model.currency));
  const n = result.months;
  const valueOf = (id: string) => values[id] ?? model.drivers.find((d) => d.id === id)?.value ?? 0;

  // ---- Drivers ------------------------------------------------------------
  const dws = wb.addWorksheet("Drivers", { views: [{ state: "frozen", ySplit: 5, showGridLines: false }], properties: { tabColor: { argb: C.pink } } });
  dws.columns = [{ width: 38 }, { width: 16 }, { width: 11 }, { width: 13 }, { width: 13 }, { width: 14 }, { width: 70 }];
  banner(dws, 7, `FinancialIQ · ${model.title}`, `Drivers (${model.currency}). Pink cells are inputs: change them and the P&L and unit economics recalculate.`);
  dws.getRow(3).height = 6;
  const legend = dws.getCell(4, 1);
  legend.value = "Percent drivers are entered as percentages (type 5% or 0.05).";
  legend.font = noteFont;
  ["Driver", "Value", "Unit", "Low", "High", "Source", "Why this value"].forEach((h, i) => (dws.getCell(5, i + 1).value = h));
  headerRow(dws, 5, 1, 7);

  const driverCell: Record<string, string> = {};
  model.drivers.forEach((d, i) => {
    const r = 6 + i;
    const pct = d.unit === "percent" ? 100 : 1;
    const v = valueOf(d.id);
    const fmt = driverFormat(d.unit, v, sym);
    driverCell[d.id] = `${DRV_REF}$B$${r}`;
    const row = dws.getRow(r);
    row.values = [d.label, v / pct, d.unit, d.min / pct, d.max / pct, d.source === "user" ? "From prompt" : "AI estimate",
      [d.rationale, d.warning ? `⚠ ${d.warning}` : ""].filter(Boolean).join("  ")];
    row.getCell(1).alignment = { indent: 1 };
    const input = row.getCell(2);
    input.numFmt = fmt;
    input.font = { bold: true, color: { argb: C.inputInk } };
    input.fill = fill(C.inputFill);
    input.border = { top: thin(C.inputEdge), bottom: thin(C.inputEdge), left: thin(C.inputEdge), right: thin(C.inputEdge) };
    [4, 5].forEach((c) => { row.getCell(c).numFmt = fmt; row.getCell(c).font = { color: { argb: C.muted } }; });
    row.getCell(3).font = { color: { argb: C.muted } };
    row.getCell(6).font = { color: { argb: d.source === "user" ? C.sectionInk : C.muted } };
    row.getCell(7).font = { size: 10, color: { argb: d.warning ? "FFB45309" : C.muted } };
    row.getCell(7).alignment = { wrapText: true, vertical: "top" };
    for (let c = 1; c <= 7; c++) row.getCell(c).border = { ...row.getCell(c).border, bottom: thin(C.rule) };
  });

  if (model.assumptions.length) {
    let r = 7 + model.drivers.length;
    dws.getCell(r, 1).value = "Assumptions";
    dws.getCell(r, 1).font = { bold: true, color: { argb: C.sectionInk } };
    for (const a of model.assumptions) {
      dws.mergeCells(++r, 1, r, 7);
      dws.getCell(r, 1).value = `•  ${a}`;
      dws.getCell(r, 1).font = { size: 10, color: { argb: C.muted } };
    }
  }

  // ---- Monthly P&L --------------------------------------------------------
  const rows = pnlRows(model);
  const FIRST = 2;
  const LAST = FIRST + n - 1;
  const TOTAL = LAST + 1;
  const NOTE = TOTAL + 1;
  const HEAD = 4;
  const pws = wb.addWorksheet(PNL, { views: [{ state: "frozen", xSplit: 1, ySplit: HEAD, showGridLines: false }], properties: { tabColor: { argb: C.violet } } });
  pws.columns = [{ width: 36 }, ...Array.from({ length: n }, () => ({ width: 13 })), { width: 15 }, { width: 46 }];
  banner(pws, NOTE, `FinancialIQ · ${model.title}`, `Monthly P&L (${model.currency}). Every number is a formula on the Drivers sheet.`);
  pws.getRow(3).height = 6;

  pws.getCell(HEAD, 1).value = `${model.currency} · monthly`;
  for (let m = 1; m <= n; m++) {
    const c = pws.getCell(HEAD, FIRST + m - 1);
    c.value = m;
    c.numFmt = '"Month "0';
  }
  pws.getCell(HEAD, TOTAL).value = "Total";
  pws.getCell(HEAD, NOTE).value = "How it's calculated";
  headerRow(pws, HEAD, 1, NOTE);
  pws.getCell(HEAD, NOTE).alignment = { horizontal: "left", vertical: "middle" };

  const rowOf: Record<string, number> = {};
  rows.forEach((row, i) => { if ("id" in row) rowOf[row.id] = HEAD + 1 + i; });

  const pnlScope = (c: number): Scope => ({
    ref: (name) => {
      if (name === "month") return `${col(c)}$${HEAD}`;
      if (rowOf[name]) return `${col(c)}${rowOf[name]}`;
      return driverCell[name] ?? "0";
    },
    prev: (name, fallback) => (c > FIRST && rowOf[name] ? `${col(c - 1)}${rowOf[name]}` : fallback ?? "0"),
    series: () => "0",
  });

  const sectionLines = (s: Line["section"]) => orderedLines(model).filter((l) => l.section === s).map((l) => l.id);
  const totalFormula = (id: string, c: string): string => {
    const sum = (s: Line["section"]) => {
      const ids = sectionLines(s);
      if (!ids.length) return "0";
      const a = rowOf[ids[0]], b = rowOf[ids[ids.length - 1]];
      return a === b ? `${c}${a}` : `SUM(${c}${a}:${c}${b})`;
    };
    const at = (x: string) => (rowOf[x] ? `${c}${rowOf[x]}` : "0");
    switch (id) {
      case "revenue": return sum("revenue");
      case "cogs": return sum("cogs");
      case "gross_profit": return `${at("revenue")}-${at("cogs")}`;
      case "opex": return sum("opex");
      case "ebitda": return `${at("gross_profit")}-${at("opex")}`;
      case "below_total": return sum("below");
      case "net_income": return `${at("ebitda")}-${at("below_total")}`;
    }
    return "0";
  };

  const range = (r: number) => `${col(FIRST)}${r}:${col(LAST)}${r}`;

  rows.forEach((row, i) => {
    const r = HEAD + 1 + i;
    const xr = pws.getRow(r);
    const label = xr.getCell(1);
    label.value = row.label;

    if (row.kind === "section") {
      label.font = { bold: true, color: { argb: C.sectionInk } };
      for (let c = 1; c <= NOTE; c++) xr.getCell(c).fill = fill(C.sectionFill);
      label.alignment = { indent: 1 };
      return;
    }

    label.alignment = { indent: row.kind === "line" || row.kind === "metric" || row.kind === "pct" ? 2 : 1 };
    const fmt = row.kind === "metric" ? METRIC_FORMAT[row.format] ?? "#,##0.0" : row.kind === "pct" ? "0.0%" : ACCOUNTING;

    for (let m = 0; m < n; m++) {
      const c = FIRST + m;
      const letter = col(c);
      const data = result.rows[m];
      let formula: string;
      let cached: number | string;
      if (row.kind === "pct") {
        const rev = `${letter}${rowOf.revenue}`;
        formula = `IF(${rev}=0,"–",${letter}${rowOf[row.num]}/${rev})`;
        cached = data.revenue ? data[row.num] / data.revenue : "–";
      } else if (row.kind === "total" || row.kind === "grand") {
        formula = totalFormula(row.id, letter);
        cached = data[row.id] ?? 0;
      } else {
        formula = toExcelFormula("formula" in row ? row.formula : "0", pnlScope(c));
        cached = data[row.id] ?? 0;
      }
      const cell = xr.getCell(c);
      cell.value = { formula, result: cached } as ExcelJS.CellFormulaValue;
      cell.numFmt = fmt;
      cell.alignment = { horizontal: "right" };
    }

    // Total column: flows add up; stocks (subscribers, headcount) show the plan's last month.
    const tot = xr.getCell(TOTAL);
    const sumOf = (id: string) => result.rows.reduce((a, x) => a + (x[id] ?? 0), 0);
    if (row.kind === "pct") {
      const rev = `${col(TOTAL)}${rowOf.revenue}`;
      tot.value = { formula: `IF(${rev}=0,"–",${col(TOTAL)}${rowOf[row.num]}/${rev})`, result: sumOf("revenue") ? sumOf(row.num) / sumOf("revenue") : "–" } as ExcelJS.CellFormulaValue;
    } else if (row.kind === "metric" && !(row.format === "currency" || /new|added|orders|sold|units|visits|leads/i.test(row.label))) {
      tot.value = { formula: `${col(LAST)}${r}`, result: result.rows[n - 1]?.[row.id] ?? 0 } as ExcelJS.CellFormulaValue;
    } else {
      tot.value = { formula: `SUM(${range(r)})`, result: sumOf(row.id) } as ExcelJS.CellFormulaValue;
    }
    tot.numFmt = fmt;
    tot.font = { bold: true };
    tot.fill = fill(C.sectionFill);

    const note = xr.getCell(NOTE);
    note.value = row.kind === "pct" ? `${row.num} / revenue` : row.kind === "total" || row.kind === "grand" ? row.note : "formula" in row ? row.formula : "";
    note.font = noteFont;

    if (row.kind === "pct" || row.kind === "metric") {
      for (let c = 1; c < NOTE; c++) xr.getCell(c).font = { ...(c === TOTAL ? { bold: true } : {}), italic: row.kind === "pct", color: { argb: C.muted } };
    }
    if (row.kind === "total" || row.kind === "grand") {
      for (let c = 1; c < NOTE; c++) {
        const cell = xr.getCell(c);
        cell.font = { bold: true, color: { argb: C.ink } };
        cell.border = row.kind === "grand"
          ? { top: thin(C.deep), bottom: { style: "double", color: { argb: C.deep } } }
          : { top: thin(C.ink) };
        if (row.kind === "grand") cell.fill = fill(C.grandFill);
      }
    } else {
      for (let c = 1; c < NOTE; c++) xr.getCell(c).border = { bottom: thin(C.rule) };
    }
  });

  pws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };

  // ---- Unit economics -----------------------------------------------------
  const uws = wb.addWorksheet("Unit Economics", { views: [{ state: "frozen", ySplit: 4, showGridLines: false }], properties: { tabColor: { argb: C.deep } } });
  uws.columns = [{ width: 34 }, { width: 18 }, { width: 40 }, { width: 46 }];
  banner(uws, 4, `FinancialIQ · ${model.title}`, `Unit economics per ${model.unit_name}. Formulas read the Drivers and Monthly P&L sheets.`);
  uws.getRow(3).height = 6;
  ["Measure", "Value", "Note", "How it's calculated"].forEach((h, i) => (uws.getCell(4, i + 1).value = h));
  headerRow(uws, 4, 1, 4);

  const ueCell: Record<string, string> = {};
  model.unit_economics.forEach((u, i) => { ueCell[u.id] = `B${5 + i}`; });
  const ueScope: Scope = {
    ref: (name) => ueCell[name] ?? driverCell[name] ?? "0",
    prev: () => "0",
    series: (fn, name) => {
      const r = rowOf[name];
      if (!r) return "0";
      if (fn === "sum") return `SUM(${PNL_REF}${range(r)})`;
      if (fn === "avg") return `AVERAGE(${PNL_REF}${range(r)})`;
      if (fn === "last") return `${PNL_REF}${col(LAST)}${r}`;
      return `${PNL_REF}${col(FIRST)}${r}`;
    },
  };

  model.unit_economics.forEach((u, i) => {
    const r = 5 + i;
    const xr = uws.getRow(r);
    const v = result.unitEconomics[u.id];
    xr.getCell(1).value = u.label;
    xr.getCell(1).alignment = { indent: 1 };
    xr.getCell(1).font = { bold: true, color: { argb: C.ink } };
    const cell = xr.getCell(2);
    cell.value = { formula: toExcelFormula(u.formula, ueScope), result: Number.isFinite(v) ? v : 0 } as ExcelJS.CellFormulaValue;
    cell.numFmt = ueFormat(u, v, sym);
    cell.font = { bold: true, size: 12, color: { argb: C.deep } };
    cell.alignment = { horizontal: "right" };
    xr.getCell(3).value = [u.note, u.good_threshold != null && u.better !== "neutral" ? `target: ${u.better === "higher" ? "≥" : "≤"} ${u.good_threshold}` : ""].filter(Boolean).join(" · ");
    xr.getCell(3).font = { size: 10, color: { argb: C.muted } };
    xr.getCell(4).value = u.formula;
    xr.getCell(4).font = noteFont;
    for (let c = 1; c <= 4; c++) xr.getCell(c).border = { bottom: thin(C.rule) };
    xr.height = 20;
  });

  return wb;
}

export async function downloadXlsx(filename: string, model: FinancialModel, result: ComputedModel, values: DriverValues) {
  const buf = await buildWorkbook(model, result, values).xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
