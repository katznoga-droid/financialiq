import "server-only";
import type { ProviderId } from "../catalog";
import { chat } from "./providers";

// "Surprise me": a quick, cheap call that writes a made-up business scenario for
// demos. The industry is picked here rather than by the model, because models
// asked for "a random business" keep returning the same few ideas.

const INDUSTRIES = [
  "vertical SaaS for dental clinics",
  "direct-to-consumer specialty coffee subscription",
  "boutique fitness studio chain",
  "B2B payroll and HR software for restaurants",
  "electric scooter rental in mid-sized cities",
  "online language tutoring marketplace",
  "craft brewery with taproom and distribution",
  "veterinary telehealth app",
  "commercial solar installation for warehouses",
  "AI meeting-notes tool sold to sales teams",
  "premium dog food delivered monthly",
  "co-working spaces in suburban towns",
  "mobile game with in-app purchases",
  "cybersecurity awareness training for SMBs",
  "meal-kit delivery for families",
  "construction equipment rental marketplace",
  "home EV charger installation service",
  "B2B logistics route-optimisation software",
  "luxury skincare brand sold online and in salons",
  "kids' coding bootcamp franchise",
  "managed IT services for law firms",
  "plant-based ready meals sold to grocery chains",
  "telehealth mental-health therapy platform",
  "vacation rental property management company",
  "API for identity verification (KYC) charged per check",
  "smart-lock hardware with a monthly software plan",
  "freight brokerage for refrigerated trucking",
  "online wedding planning marketplace taking a commission",
  "precision agriculture drones sold as a service",
  "indoor climbing gym with memberships and day passes",
];

const STAGES = ["just launched with its first handful of customers", "early-stage with a few customers", "growing fast after a seed round", "mature and steady", "scaling into a new region"];

// The SkyShield test prompt from context.md, used as the style reference.
const STYLE_EXAMPLE = `SkyShield is a B2B SaaS company selling cloud security posture management (CSPM) to mid-market companies running on AWS, Azure and GCP. It scans cloud accounts for misconfigurations, compliance gaps (SOC 2, ISO 27001, HIPAA) and exposed secrets.

Pricing: three tiers billed annually. Starter $1,200/month (up to 50 cloud assets), Growth $4,500/month (up to 500 assets), Enterprise ~$15,000/month (unlimited, custom). Mix of new customers: 50% Starter, 35% Growth, 15% Enterprise.

Today: 120 paying customers, $600k MRR. Adding ~12 new customers per month, growing 5% month over month. Monthly logo churn 1.2%; net revenue retention 115% from tier upgrades.

Go-to-market: inbound + sales-led. Blended CAC $18,000 per customer. Sales cycle 60 days. 8 account executives at $180k fully loaded, each closing ~2 deals/month.

Costs: cloud hosting and scanning infrastructure ~12% of revenue; customer success 6% of revenue; payment and third-party data fees 2%. R&D team of 25 engineers at $200k fully loaded; G&A $120k/month; office and tools $40k/month.

Build a 12-month monthly P&L, show the key drivers I can tune, and summarise unit economics (CAC payback, LTV:CAC, gross margin, contribution margin, and when we reach EBITDA break-even).`;

const pick = <T,>(xs: readonly T[]) => xs[Math.floor(Math.random() * xs.length)];

const SYSTEM = `You write short, realistic, made-up business scenarios that a founder or CFO would type into a financial modelling tool. Write plain text only: no markdown headings, no bullet symbols, no preamble or closing remarks.

Follow the structure and level of detail of this example, but invent everything for the business you are given:

${STYLE_EXAMPLE}`;

export async function sampleScenario(provider: ProviderId, model: string): Promise<{ scenario: string; industry: string }> {
  const industry = pick(INDUSTRIES);
  const stage = pick(STAGES);
  const prompt = `Write one scenario for this business: ${industry}, ${stage}.

Invent a company name. Cover, in short paragraphs with concrete numbers: what it sells and to whom; pricing (tiers, price per unit or average order value, and the customer mix); where it is today (customers or volume, monthly revenue); growth (new customers per month and how that grows); churn or repeat rate; go-to-market and CAC; and costs (COGS or hosting as % of revenue or per unit, team sizes with fully loaded salaries, rent, G&A, marketing). Use figures that fit this industry. End with one line asking for a 12-month monthly P&L, the key drivers to tune, and a unit economics summary. Keep it under 230 words, laid out in short labelled paragraphs like the example.`;

  const text = await chat(provider, model, SYSTEM, [{ role: "user", content: prompt }], { json: false, maxTokens: 4000 });
  const scenario = text.trim().replace(/^```\w*\s*/, "").replace(/```$/, "").trim();
  if (scenario.length < 40) throw new Error("The model returned an empty scenario. Try again or pick another model.");
  return { scenario, industry };
}
