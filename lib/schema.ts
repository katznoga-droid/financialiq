import { z } from "zod";

// The structured result every AI provider must return. The AI designs the
// model (drivers + formulas); the app does all of the arithmetic.

const id = z.string().regex(/^[a-z][a-z0-9_]*$/, "ids must be snake_case, starting with a letter");

export const DriverUnit = z.enum(["currency", "percent", "count", "number", "months"]);

export const DriverSchema = z.object({
  id,
  label: z.string().min(1),
  value: z.number().finite(),
  unit: DriverUnit,
  min: z.number().finite(),
  max: z.number().finite(),
  step: z.number().positive().finite(),
  source: z.enum(["user", "ai"]),
  rationale: z.string().default(""),
  warning: z.string().nullish(),
});

export const MetricSchema = z.object({
  id,
  label: z.string().min(1),
  formula: z.string().min(1),
  format: z.enum(["currency", "count", "percent", "number"]).default("number"),
});

export const LineSchema = z.object({
  id,
  label: z.string().min(1),
  section: z.enum(["revenue", "cogs", "opex", "below"]),
  formula: z.string().min(1),
});

export const UnitEconSchema = z.object({
  id,
  label: z.string().min(1),
  formula: z.string().min(1),
  format: z.enum(["currency", "percent", "ratio", "months", "count", "number"]),
  better: z.enum(["higher", "lower", "neutral"]).default("neutral"),
  good_threshold: z.number().finite().nullish(),
  note: z.string().default(""),
});

export const FinancialModelSchema = z.object({
  title: z.string().min(1),
  currency: z.string().min(1).max(8),
  unit_name: z.string().min(1).default("customer"),
  drivers: z.array(DriverSchema).min(1).max(40),
  metrics: z.array(MetricSchema).max(30).default([]),
  lines: z.array(LineSchema).min(2).max(40),
  unit_economics: z.array(UnitEconSchema).min(1).max(12),
  summary_template: z.string().min(1),
  assumptions: z.array(z.string()).default([]),
});

export type Driver = z.infer<typeof DriverSchema>;
export type Metric = z.infer<typeof MetricSchema>;
export type Line = z.infer<typeof LineSchema>;
export type UnitEcon = z.infer<typeof UnitEconSchema>;
export type FinancialModel = z.infer<typeof FinancialModelSchema>;

/** Names the app computes itself and puts in scope for formulas. */
export const TOTAL_IDS = ["revenue", "cogs", "gross_profit", "opex", "ebitda", "below_total", "net_income"] as const;
export const RESERVED = new Set<string>([...TOTAL_IDS, "month"]);
