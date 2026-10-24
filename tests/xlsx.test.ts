import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { HyperFormula } from "hyperformula";
import { compute, validateModel } from "../lib/engine";
import { EXAMPLE_MODEL } from "../lib/example";
import { FinancialModelSchema, type FinancialModel } from "../lib/schema";
import { buildWorkbook } from "../lib/xlsx";

// Writes the workbook to .xlsx bytes, reads it back, recalculates every formula
// with an independent spreadsheet engine and checks it against the app's numbers.
async function recalc(model: FinancialModel, values: Record<string, number>, months: number) {
  const result = compute(model, values, months);
  const buf = await buildWorkbook(model, result, values).xlsx.writeBuffer();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as ArrayBuffer);

  const sheets: Record<string, (string | number | null)[][]> = {};
  wb.eachSheet((ws) => {
    const grid: (string | number | null)[][] = [];
    ws.eachRow({ includeEmpty: true }, (row, r) => {
      const out: (string | number | null)[] = [];
      row.eachCell({ includeEmpty: true }, (cell, c) => {
        const v = cell.value as unknown;
        out[c - 1] = v && typeof v === "object" && "formula" in v ? `=${(v as { formula: string }).formula}`
          : typeof v === "number" || typeof v === "string" ? v : null;
      });
      grid[r - 1] = Array.from(out, (x) => x ?? null);
    });
    sheets[ws.name] = Array.from(grid, (x) => x ?? []);
  });
  const hf = HyperFormula.buildFromSheets(sheets, { licenseKey: "gpl-v3" });
  const ws = wb.getWorksheet("Monthly P&L")!;
  const read = (sheet: string, addr: string) => {
    const s = wb.getWorksheet(sheet)!;
    const cell = s.getCell(addr);
    return hf.getCellValue({ sheet: hf.getSheetId(sheet)!, row: Number(cell.row) - 1, col: Number(cell.col) - 1 });
  };
  const rowOf: Record<string, number> = {};
  ws.eachRow((row, r) => {
    const label = row.getCell(1).value;
    const all = [...model.metrics, ...model.lines];
    const hit = all.find((x) => x.label === label);
    if (hit) rowOf[hit.id] = r;
    for (const [id, l] of Object.entries({ revenue: "Total revenue", cogs: "Total COGS", gross_profit: "Gross profit", opex: "Total operating expenses", ebitda: "EBITDA", net_income: "Net income" }))
      if (label === l) rowOf[id] = r;
  });
  return { result, read, rowOf, hf, wb };
}

function close(a: unknown, b: number, what: string) {
  assert.equal(typeof a, "number", `${what}: got ${JSON.stringify(a)}`);
  const tol = Math.max(1e-6, Math.abs(b) * 1e-9);
  assert.ok(Math.abs((a as number) - b) <= tol, `${what}: Excel ${a} vs app ${b}`);
}

async function checkAll(model: FinancialModel, values: Record<string, number>, months: number) {
  const { result, read, rowOf } = await recalc(model, values, months);
  const ids = [...model.metrics.map((m) => m.id), ...model.lines.map((l) => l.id), "revenue", "cogs", "gross_profit", "opex", "ebitda", "net_income"];
  let checked = 0;
  for (const id of ids) {
    assert.ok(rowOf[id], `row for ${id}`);
    for (let m = 0; m < months; m++) {
      close(read("Monthly P&L", `${String.fromCharCode(66 + m)}${rowOf[id]}`), result.rows[m][id], `${id} month ${m + 1}`);
      checked++;
    }
  }
  model.unit_economics.forEach((u, i) => {
    const v = result.unitEconomics[u.id];
    if (Number.isFinite(v)) { close(read("Unit Economics", `B${5 + i}`), v, `unit economics ${u.id}`); checked++; }
  });
  return checked;
}

test("xlsx formulas reproduce the app's numbers for the example model", async () => {
  const model = FinancialModelSchema.parse(EXAMPLE_MODEL);
  assert.ok(await checkAll(model, {}, 12) > 100);
  // Changed drivers and a shorter horizon.
  await checkAll(model, { price: 199, churn: 7.5, acquisition_growth: 12, headcount: 5 }, 7);
});

test("xlsx translates every function and operator the formula language allows", async () => {
  const model = FinancialModelSchema.parse({
    title: "Edge cases", currency: "USD", unit_name: "unit",
    drivers: [
      { id: "base", label: "Base", value: 100, unit: "count", min: 0, max: 1000, step: 1, source: "ai" },
      { id: "g", label: "Growth", value: 12.5, unit: "percent", min: 0, max: 50, step: 0.5, source: "ai" },
      { id: "zero", label: "Zero", value: 0, unit: "number", min: 0, max: 10, step: 1, source: "ai" },
      { id: "start", label: "Launch month", value: 4, unit: "months", min: 1, max: 12, step: 1, source: "ai" },
    ],
    metrics: [
      { id: "units", label: "Units", formula: "if(month >= start && month != 9, ceil(base * (1 + g) ^ (month - 1) / 3), floor(base / 7))", format: "count" },
      { id: "stock", label: "Stock", formula: "prev(stock, base * 2) - units / 2 + clamp(month * 10, 20, 80)", format: "number" },
      { id: "neg", label: "Signed", formula: "-2 ^ 2 + -(month - 6) * 3 - -1 + abs(month - 6.5)", format: "number" },
    ],
    lines: [
      { id: "sales", label: "Sales", section: "revenue", formula: "units * 9.99 + round(stock / 3, 1) + max(0, neg) + min(month, 3, 2)" },
      { id: "fees", label: "Fees", section: "revenue", formula: "units / zero + if(month < 3 || month > 10, 50, 0) + (month == 6) * 7" },
      { id: "cost", label: "Cost", section: "cogs", formula: "revenue * 0.4 + 2 ^ 3 ^ 0.5" },
      { id: "staff", label: "Staff", section: "opex", formula: "1000 + prev(staff, 1000) * g / 4" },
      { id: "tax", label: "Tax", section: "below", formula: "max(0, ebitda) * 0.2" },
    ],
    unit_economics: [
      { id: "total_sales", label: "Total sales", formula: "sum(sales)", format: "currency" },
      { id: "avg_units", label: "Average units", formula: "avg(units)", format: "count" },
      { id: "growth_x", label: "Growth multiple", formula: "last(revenue) / first(revenue)", format: "ratio" },
      { id: "safe", label: "Safe division", formula: "total_sales / zero + base * g", format: "number" },
    ],
    summary_template: "x",
  });
  assert.deepEqual(validateModel(model), []);
  assert.ok(await checkAll(model, {}, 12) > 80);
  await checkAll(model, { zero: 3, start: 1, g: 0 }, 12);
});

test("xlsx inputs are the drivers, and editing one recalculates the P&L", async () => {
  const model = FinancialModelSchema.parse(EXAMPLE_MODEL);
  const { read, rowOf, hf, wb } = await recalc(model, {}, 12);
  const drivers = wb.getWorksheet("Drivers")!;
  const priceRow = model.drivers.findIndex((d) => d.id === "price") + 6;
  assert.equal(drivers.getCell(`B${priceRow}`).value, 149);
  const churnRow = model.drivers.findIndex((d) => d.id === "churn") + 6;
  assert.equal(drivers.getCell(`B${churnRow}`).value, 0.05);
  hf.setCellContents({ sheet: hf.getSheetId("Drivers")!, row: priceRow - 1, col: 1 }, 199);
  const expected = compute(model, { price: 199 }, 12);
  close(read("Monthly P&L", `M${rowOf.revenue}`), expected.rows[11].revenue, "revenue after editing price");
  close(read("Monthly P&L", `M${rowOf.net_income}`), expected.rows[11].net_income, "net income after editing price");
});
