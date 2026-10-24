# FinancialIQ

Describe a business in plain words, pick an AI model, and get a monthly P&L, tunable drivers and unit economics. Move any driver and the numbers update instantly. See `context.md` for the full product notes.

## Run it (Windows)

1. Make sure your API keys are in `.env.local` in this folder (copy `.env.example` if it is missing).
2. Double-click **`Start FinancialIQ.bat`**. The first time, it installs what the app needs, which takes a minute or two.
3. Your browser opens at http://localhost:3000. If the page isn't ready yet, wait a few seconds and refresh.
4. Keep the black window open while you use the app. Close it to stop the app.

If Windows says Node.js is missing, install the LTS version from https://nodejs.org and try again.

## For developers

```bash
npm install
npm run dev      # http://localhost:3000
npm test         # formula engine tests
npm run build    # production build and type check
```

- `lib/formula.ts`: the safe formula language the AI writes in.
- `lib/engine.ts`: validation and month-by-month calculation.
- `lib/ai/`: the prompt, provider adapters and generate-with-retry.
- `lib/catalog.ts`: providers and the curated model lists.
- `components/`: the workspace, P&L table and charts.
