import type { FinancialModel } from "./schema";

// A worked example. The prompt shows it to the AI as a template, and the app
// opens on it so there is something to explore before the first generation.
export const EXAMPLE_MODEL: FinancialModel = {
  title: "Weekly coffee subscription, Tel Aviv",
  currency: "ILS",
  unit_name: "subscriber",
  drivers: [
    { id: "price", label: "Subscription price", value: 149, unit: "currency", min: 79, max: 249, step: 1, source: "user", rationale: "Given in the prompt.", warning: null },
    { id: "cost_to_serve", label: "Cost to serve per subscriber", value: 78, unit: "currency", min: 40, max: 120, step: 1, source: "ai", rationale: "Beans, packaging and four courier runs a month.", warning: null },
    { id: "starting_subscribers", label: "Subscribers at launch", value: 150, unit: "count", min: 0, max: 2000, step: 10, source: "ai", rationale: "Pre-launch waitlist conversion.", warning: null },
    { id: "new_subscribers_m1", label: "New subscribers in month 1", value: 60, unit: "count", min: 0, max: 500, step: 5, source: "ai", rationale: "Instagram and office sampling.", warning: null },
    { id: "acquisition_growth", label: "Monthly growth in new subscribers", value: 8, unit: "percent", min: 0, max: 30, step: 0.5, source: "ai", rationale: "Word of mouth as the base grows.", warning: null },
    { id: "churn", label: "Monthly churn", value: 5, unit: "percent", min: 1, max: 20, step: 0.5, source: "user", rationale: "Given in the prompt.", warning: null },
    { id: "payment_fee", label: "Card processing fee", value: 2.5, unit: "percent", min: 0, max: 5, step: 0.1, source: "ai", rationale: "Typical Israeli card acquirer rate.", warning: null },
    { id: "cac", label: "Customer acquisition cost", value: 180, unit: "currency", min: 50, max: 500, step: 5, source: "ai", rationale: "Paid social plus free first box.", warning: null },
    { id: "headcount", label: "Team size", value: 3, unit: "count", min: 1, max: 15, step: 1, source: "user", rationale: "Given in the prompt.", warning: null },
    { id: "monthly_salary", label: "Monthly cost per employee", value: 18000, unit: "currency", min: 8000, max: 40000, step: 500, source: "ai", rationale: "Tel Aviv salary including employer costs.", warning: null },
    { id: "rent", label: "Kitchen rent and utilities", value: 9000, unit: "currency", min: 0, max: 30000, step: 500, source: "ai", rationale: "Small roasting kitchen.", warning: null },
    { id: "equipment", label: "Roasting equipment", value: 90000, unit: "currency", min: 0, max: 300000, step: 5000, source: "ai", rationale: "Depreciated over 5 years.", warning: null },
    { id: "tax_rate", label: "Corporate tax rate", value: 23, unit: "percent", min: 0, max: 40, step: 1, source: "ai", rationale: "Israeli corporate tax.", warning: null },
  ],
  metrics: [
    { id: "new_subscribers", label: "New subscribers", formula: "new_subscribers_m1 * (1 + acquisition_growth) ^ (month - 1)", format: "count" },
    { id: "subscribers", label: "Active subscribers", formula: "prev(subscribers, starting_subscribers) * (1 - churn) + new_subscribers", format: "count" },
  ],
  lines: [
    { id: "subscription_revenue", label: "Subscription revenue", section: "revenue", formula: "subscribers * price" },
    { id: "product_costs", label: "Coffee, packaging and delivery", section: "cogs", formula: "subscribers * cost_to_serve" },
    { id: "payment_fees", label: "Payment processing", section: "cogs", formula: "revenue * payment_fee" },
    { id: "marketing", label: "Marketing (acquisition)", section: "opex", formula: "new_subscribers * cac" },
    { id: "salaries", label: "Salaries", section: "opex", formula: "headcount * monthly_salary" },
    { id: "facilities", label: "Rent and utilities", section: "opex", formula: "rent" },
    { id: "depreciation", label: "Depreciation", section: "below", formula: "equipment / 60" },
    { id: "income_tax", label: "Income tax", section: "below", formula: "max(0, ebitda - depreciation) * tax_rate" },
  ],
  unit_economics: [
    { id: "arpu", label: "Revenue per subscriber", formula: "price", format: "currency", better: "higher", good_threshold: null, note: "per month" },
    { id: "contribution", label: "Contribution per subscriber", formula: "price * (1 - payment_fee) - cost_to_serve", format: "currency", better: "higher", good_threshold: 0, note: "per month, after direct costs" },
    { id: "contribution_margin", label: "Contribution margin", formula: "contribution / price", format: "percent", better: "higher", good_threshold: 0.3, note: "" },
    { id: "lifetime_months", label: "Average lifetime", formula: "1 / churn", format: "months", better: "higher", good_threshold: null, note: "" },
    { id: "ltv", label: "Lifetime value", formula: "contribution * lifetime_months", format: "currency", better: "higher", good_threshold: null, note: "contribution over the average lifetime" },
    { id: "ltv_cac", label: "LTV to CAC", formula: "ltv / cac", format: "ratio", better: "higher", good_threshold: 3, note: "3x or more is healthy" },
    { id: "payback", label: "CAC payback", formula: "cac / contribution", format: "months", better: "lower", good_threshold: 12, note: "months to earn back CAC" },
    { id: "breakeven_subscribers", label: "Break-even subscribers", formula: "(headcount * monthly_salary + rent) / contribution", format: "count", better: "neutral", good_threshold: null, note: "to cover fixed monthly costs" },
    { id: "ending_subscribers", label: "Subscribers at end of plan", formula: "last(subscribers)", format: "count", better: "higher", good_threshold: null, note: "" },
  ],
  summary_template:
    "Each subscriber pays {arpu} a month and leaves {contribution} after direct costs, a {contribution_margin} margin. At this churn they stay about {lifetime_months}, so lifetime value is {ltv}, {ltv_cac} what it costs to win them. You need about {breakeven_subscribers} subscribers to cover fixed costs and reach {ending_subscribers} by the end of the plan.",
  assumptions: ["Subscribers are billed monthly in advance.", "No price changes during the plan."],
};

export const EXAMPLE_SCENARIO =
  "A weekly specialty-coffee subscription in Tel Aviv, delivered by bike courier. One plan at 149 ILS a month. We expect about 5% of subscribers to cancel each month. Small team of three, one roasting kitchen.";
