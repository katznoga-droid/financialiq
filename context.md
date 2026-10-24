# FinancialIQ: Product Context

_Last updated: 2026-10-24. Status: first working version runs locally and is on GitHub; live on Vercel at https://financialiq-khaki.vercel.app behind a password. Keep this file current: every decision and status change goes here._

## 1. Goal

FinancialIQ turns a plain-language description of a business scenario into a working financial model. The user describes a business, the app sends that description to an AI model the user picks, and the app returns three things:

1. A **P&L** (profit and loss statement).
2. A set of **tunable drivers**: the assumptions behind the P&L, which the user can change to see the P&L update.
3. A **unit economics summary** that explains how the business makes or loses money per unit.

The point is to go from "here's an idea" to "here's what the numbers look like, and what moves them" in minutes, not hours of spreadsheet work.

## 2. Core flow

1. **Describe.** The user writes a prompt that describes the business and the variables associated with it. The variables the user names become starting drivers. The AI fills in any others the model needs.
2. **Choose a provider, then a model.** OpenAI, Anthropic (Claude) or OpenRouter, then a model within it.
3. **Generate.** The app sends the scenario plus a structured prompt to the chosen model, which returns drivers, P&L formulas and unit economics as JSON.
4. **Explore.** P&L, drivers and unit economics appear together. Changing a driver recalculates everything instantly, with no new AI call.
5. **Iterate.** Edit the scenario and regenerate, or switch models; every result in the session stays available in the "Results" picker to compare.

## 3. Decisions made

| Topic | Decision |
|---|---|
| Users | Single user (Noga) for now. Keep it easy to make shareable later: keys stay on the server, and saved scenarios go through one storage module (`lib/storage.ts`) that can be swapped for a database. |
| Platform and stack | Web app: Next.js 16 + TypeScript + React 19, zod for validation. No other UI libraries; charts are hand-drawn SVG. |
| Where it runs | Locally on Noga's Windows PC (see section 8), and on Vercel at https://financialiq-khaki.vercel.app behind a password (see section 9). |
| Hosting password | App-level password gate (`proxy.ts`, Next.js 16's renamed middleware) using HTTP Basic auth, turned on only when the `SITE_PASSWORD` environment variable is set. Chosen over Vercel's own Password Protection, which needs a paid plan. Any username works; only the password is checked. Locally there is no password. |
| Time horizon | Monthly P&L, 1 to 12 months (user picks; default 12). The earlier mockup's yearly view was replaced. |
| Providers | OpenAI, Anthropic and OpenRouter. Grok is reached through OpenRouter (no separate xAI provider). |
| Models | Each provider offers a short curated list that leads with cheap, low-tier models (see section 6), plus a "Show all models" switch that fetches the provider's full live list. |
| API keys | The app holds keys centrally in `.env.local` (git-ignored, never committed). `.env.example` is the blank template. Keys are read only on the server; the browser only learns which providers have a key. |
| Drivers | One value per driver (no per-month schedule); time effects are expressed in formulas using `month`. Users change values, not names or formulas. |
| Unrealistic user values | Keep the user's value and flag it with a warning on the driver (both). |
| P&L lines | Revenue, COGS, gross profit, operating expenses by category, EBITDA, then optional depreciation / interest / tax lines, and net income. |
| Picture of the P&L | Both: a formatted monthly table and charts (waterfall from revenue to net income, monthly trend, and a gauge for LTV:CAC). |
| Saved scenarios | Saved in the browser (localStorage) for now. |
| Export | CSV that opens in Excel. |
| Source control | GitHub repo `katznoga-droid/financialiq` (private, `main` branch). |

## 4. Drivers-to-P&L relationship (the key design idea)

The AI is used to **design the model**, not to **do the arithmetic every time**.

- The AI returns drivers plus formulas linking them to each P&L line, in a fixed JSON schema (`lib/schema.ts`).
- Formulas use a small safe formula language (`lib/formula.ts`): numbers, `+ - * / ^`, comparisons, `min max abs round floor ceil clamp if`, `month`, `prev(id, fallback)` for last month's value (customer bases, cumulative figures), and `sum avg last first` over the plan (unit economics only). There is no `eval`; anything else is rejected.
- Percent drivers are stored as percentage points (5 = 5%) and read as fractions (0.05) inside formulas.
- Evaluation order per month: metrics, revenue lines, then the app's `revenue` total, COGS lines, `cogs` and `gross_profit`, opex lines, `opex` and `ebitda`, below-EBITDA lines, `below_total` and `net_income`.
- The server validates every AI answer (schema, unique ids, every name defined before use, a trial 12-month calculation). If anything is wrong it sends the problems back to the model and retries, up to 3 attempts.
- The unit-economics summary is a template with `{id}` placeholders, so its numbers update live as drivers change.

## 5. Look and feel

- Inspired by Noga's reference dashboard: dark purple/violet glassmorphism with translucent rounded cards over a pink-to-blue gradient, a slim icon sidebar, smooth curved area charts with white strokes and gradient fills, a semicircle gauge KPI, rounded bars, small white pill toggles, and coloured status pills.
- Noga's refinement: **make the purple and pink really pop** (vivid, saturated colours) and keep **strong contrast** between the background and the content. Cards are near-opaque dark glass with white text so the content stands clear of the gradient.
- Earlier light mockup: https://claude.ai/code/artifact/beabd347-7751-4fd8-ba83-2e7c4d4c542b (layout reference only; its colours were replaced).

## 6. Models offered (tested 2026-10-24)

Prices are approximate US$ per 1M input / output tokens.

- **Anthropic:** Claude Haiku 5.5 (default, $0.10/$0.50), Claude Haiku 4.5, Claude Sonnet 5.5, Claude Opus 5.5.
- **OpenAI:** GPT-6 Luna (default), GPT-5 nano, GPT-4.1 mini, GPT-5 mini, GPT-6 Sol.
- **OpenRouter:** DeepSeek V4 Flash (default), Gemini 2.5 Flash Lite, GPT-6 Luna, Claude Haiku 5.5, GPT-OSS 120B, Grok 4.3.
- Dropped after testing: Llama 4 Scout (no endpoint available), Qwen3 235B (timed out), Mistral Small 3.2 (took almost 4 minutes).

## 7. Build status

- Done: formula engine with tests, provider adapters (OpenAI, Anthropic, OpenRouter) with JSON mode and retry, generate and model-list APIs, full workspace UI (scenario, provider and model pickers, drivers with sliders, unit economics with gauge and live summary, waterfall and trend charts, monthly P&L table with formulas shown on request), saved scenarios, CSV export, Windows start script, purple glass styling.
- Tested: real generations succeed with Anthropic and OpenRouter models. The OpenAI key is valid, but the OpenAI account had no credits on 2026-10-24, so direct OpenAI calls fail until billing is topped up (OpenAI models still work through OpenRouter). The OpenRouter balance was low, which is why its requests are capped at 12,000 output tokens.
- GitHub: Noga ran the first push herself on 2026-10-24 (`git remote add origin …` then `git push -u origin main` from a command window in the folder), because Claude's permission settings blocked pushing at the time. Since then Claude has been able to push from this folder directly. `main` tracks `origin/main`.
- Password gate added and tested locally on 2026-10-24: no password or a wrong one gets a 401, the right one gets in, and the API routes are covered too.
- The generate API's `maxDuration` was lowered from 600 to 300 seconds, the most Vercel's Hobby plan allows.
- Deployed to Vercel on 2026-10-24 and tested live: password gate works, a real Claude Haiku 5.5 generation succeeded in 16 s.
- Not yet: scenario comparison side by side, best/base/worst cases.

## 8. Running it locally

1. API keys live in `.env.local` in the app folder (git-ignored). `.env.example` is the blank template with the three names: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`.
2. Double-click **`Start FinancialIQ.bat`**. The first run installs dependencies (a minute or two), then the browser opens at http://localhost:3000.
3. Keep the black window open while using the app; closing it stops the app.
4. Developers: `npm run dev`, `npm test`, `npm run build`.

### Account balances (checked 2026-10-24)

- **OpenAI:** the key is valid but the account has no credits, so direct OpenAI calls fail until billing is topped up at platform.openai.com. OpenAI models still work through OpenRouter.
- **OpenRouter:** balance is low; top it up before heavy use. Requests are capped at 12,000 output tokens for this reason.
- **Anthropic:** working.

## 9. Hosting on Vercel (live)

- **Live URL:** https://financialiq-khaki.vercel.app. The browser shows a sign-in box: type anything as the username, and the site password as the password. The password is stored only in Vercel's `SITE_PASSWORD` setting (Noga has it); it is deliberately not written in this file.
- **Account:** Noga's Vercel account (katz.noga@gmail.com, username `katznoga-6555`, team `noga12`, Hobby/free plan). Project `financialiq`.
- **Auto-deploy:** the project is linked to GitHub `katznoga-droid/financialiq`; every push to `main` redeploys production automatically.
- **Environment variables (Production and Preview, encrypted):** `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY` (copied from `.env.local` by the Vercel CLI, never shown), and `SITE_PASSWORD`. To change a key or the password: Vercel dashboard → financialiq → Settings → Environment Variables → edit → then Deployments → latest → Redeploy.
- **Other addresses:** `financialiq-noga12.vercel.app` and `financialiq-git-main-noga12.vercel.app` also exist but sit behind Vercel's own login (default Deployment Protection), so they only open for Noga's Vercel account. Use the khaki URL.
- **Limits:** Hobby plan caps each request at 300 s, so the generate API's `maxDuration` is 300.
- **Tested 2026-10-24:** no password or a wrong one returns 401; the right one loads the app; the live model list and a real generation (Claude Haiku 5.5, 16 s) work.

## 10. Sample test prompt

Made-up cloud security SaaS scenario used to test the app (2026-10-24):

```
SkyShield is a B2B SaaS company selling cloud security posture management (CSPM) to mid-market companies running on AWS, Azure and GCP. It scans cloud accounts for misconfigurations, compliance gaps (SOC 2, ISO 27001, HIPAA) and exposed secrets.

Pricing: three tiers billed annually — Starter $1,200/month (up to 50 cloud assets), Growth $4,500/month (up to 500 assets), Enterprise ~$15,000/month (unlimited, custom). Mix of new customers: 50% Starter, 35% Growth, 15% Enterprise.

Today: 120 paying customers, $600k MRR. Adding ~12 new customers per month, growing 5% month over month. Monthly logo churn 1.2%; net revenue retention 115% from tier upgrades.

Go-to-market: inbound + sales-led. Blended CAC $18,000 per customer. Sales cycle 60 days. 8 account executives at $180k fully loaded, each closing ~2 deals/month.

Costs: cloud hosting and scanning infrastructure ~12% of revenue; customer success 6% of revenue; payment and third-party data fees 2%. R&D team of 25 engineers at $200k fully loaded; G&A $120k/month; office and tools $40k/month.

Build a 12-month monthly P&L, show the key drivers I can tune, and summarise unit economics (CAC payback, LTV:CAC, gross margin, contribution margin, and when we reach EBITDA break-even).
```

## 11. Out of scope (for now)

- Balance sheet and cash flow statement.
- Pulling real market data or benchmarks from the web.
- Multi-user collaboration and accounts.

## 12. Open questions

1. Should the AI ask clarifying questions before generating when the scenario is vague?
2. Side-by-side comparison of two models on the same scenario, and base / best / worst cases?
3. Should drivers be able to vary over time (for example, a price rise in month 7) as a first-class feature?
4. Export beyond CSV: real .xlsx with formulas, PDF, Google Sheets?
5. A benchmark set of scenarios to test each provider against?
