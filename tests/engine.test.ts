import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate, parse } from "../lib/formula";
import { compute, validateModel } from "../lib/engine";
import { EXAMPLE_MODEL } from "../lib/example";
import { FinancialModelSchema } from "../lib/schema";

const calc = (f: string, vars: Record<string, number> = {}) => evaluate(parse(f), { get: (n) => vars[n] ?? NaN });

test("formula arithmetic and precedence", () => {
  assert.equal(calc("1 + 2 * 3"), 7);
  assert.equal(calc("(1 + 2) * 3"), 9);
  assert.equal(calc("2 ^ 3 ^ 2"), 512);
  assert.equal(calc("-2 ^ 2"), -4);
  assert.equal(calc("10 - 4 - 3"), 3);
  assert.equal(calc("a * (1 - b)", { a: 100, b: 0.25 }), 75);
  assert.equal(calc("max(0, 5 - 8)"), 0);
  assert.equal(calc("if(3 > 2, 10, 20)"), 10);
  assert.equal(calc("round(2.345, 2)"), 2.35);
  assert.equal(calc("5 / 0"), 0);
});

test("formula rejects anything outside the grammar", () => {
  for (const bad of ["alert(1)", "a; b", "process.exit()", "x = 1", "`x`", "a[0]", ""]) {
    assert.throws(() => parse(bad), Error, bad);
  }
});

test("example model is valid and computes", () => {
  const model = FinancialModelSchema.parse(EXAMPLE_MODEL);
  assert.deepEqual(validateModel(model), []);
  const r = compute(model, {}, 12);
  assert.equal(r.errors.length, 0);
  assert.equal(r.rows.length, 12);
  // Month 1: 150 * 0.95 + 60 = 202.5 subscribers.
  assert.equal(r.rows[0].subscribers, 202.5);
  assert.equal(r.rows[0].revenue, 202.5 * 149);
  assert.ok(Math.abs(r.rows[0].gross_profit - (r.rows[0].revenue - r.rows[0].cogs)) < 1e-9);
  assert.ok(Math.abs(r.unitEconomics.ltv_cac - ((149 * 0.975 - 78) * 20) / 180) < 1e-9);
});

test("changing a driver recomputes", () => {
  const model = FinancialModelSchema.parse(EXAMPLE_MODEL);
  const base = compute(model, {}, 12);
  const pricier = compute(model, { price: 199 }, 12);
  assert.ok(pricier.rows[11].revenue > base.rows[11].revenue);
  assert.equal(compute(model, {}, 3).rows.length, 3);
});

test("validation catches undefined names and forward references", () => {
  const model = FinancialModelSchema.parse(EXAMPLE_MODEL);
  const broken = {
    ...model,
    metrics: [{ id: "a", label: "A", formula: "b + 1", format: "count" as const }, { id: "b", label: "B", formula: "nonsense * 2", format: "count" as const }],
  };
  const errs = validateModel(broken);
  assert.ok(errs.some((e) => e.includes('"b" is not defined')));
  assert.ok(errs.some((e) => e.includes('"nonsense"')));
});
