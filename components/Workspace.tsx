"use client";

import { useEffect, useMemo, useState } from "react";
import { PROVIDERS, providerInfo, type ModelOption, type ProviderId } from "@/lib/catalog";
import { compute, MAX_MONTHS, type DriverValues } from "@/lib/engine";
import { EXAMPLE_MODEL, EXAMPLE_SCENARIO } from "@/lib/example";
import { download, toCsv } from "@/lib/export";
import { formatDriver, formatUnitEcon, verdict } from "@/lib/format";
import type { Driver, FinancialModel } from "@/lib/schema";
import { deleteScenario, loadScenarios, saveScenario, type SavedScenario } from "@/lib/storage";
import { Trend, Waterfall } from "./Charts";
import PnlTable from "./PnlTable";

interface Run {
  key: string;
  model: FinancialModel;
  provider: string;
  modelId: string;
  modelLabel: string;
  scenario: string;
}

const initialValues = (m: FinancialModel): DriverValues => Object.fromEntries(m.drivers.map((d) => [d.id, d.value]));

export default function Workspace({ configured }: { configured: Record<ProviderId, boolean> }) {
  const firstProvider = PROVIDERS.find((p) => configured[p.id]) ?? PROVIDERS[0];

  const [scenario, setScenario] = useState(EXAMPLE_SCENARIO);
  const [provider, setProvider] = useState<ProviderId>(firstProvider.id);
  const [modelId, setModelId] = useState(firstProvider.defaultModel);
  const [showAll, setShowAll] = useState(false);
  const [allModels, setAllModels] = useState<Record<string, ModelOption[]>>({});
  const [listError, setListError] = useState<string | null>(null);

  const [runs, setRuns] = useState<Run[]>([
    { key: "example", model: EXAMPLE_MODEL, provider: "", modelId: "", modelLabel: "Example", scenario: EXAMPLE_SCENARIO },
  ]);
  const [activeKey, setActiveKey] = useState("example");
  const [values, setValues] = useState<DriverValues>(() => initialValues(EXAMPLE_MODEL));
  const [months, setMonths] = useState(12);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("This is a worked example. Describe your own business and generate a model.");
  const [saved, setSaved] = useState<SavedScenario[]>([]);

  useEffect(() => setSaved(loadScenarios()), []);

  const run = runs.find((r) => r.key === activeKey) ?? runs[0];
  const model = run.model;
  const result = useMemo(() => compute(model, values, months), [model, values, months]);
  const info = providerInfo(provider)!;

  const modelOptions: ModelOption[] = showAll && allModels[provider] ? allModels[provider] : info.models;
  const modelLabel = modelOptions.find((m) => m.id === modelId)?.label ?? info.models.find((m) => m.id === modelId)?.label ?? modelId;

  useEffect(() => {
    if (!showAll || allModels[provider] || !configured[provider]) return;
    setListError(null);
    fetch(`/api/models?provider=${provider}`)
      .then((r) => r.json())
      .then((j) => (j.models ? setAllModels((a) => ({ ...a, [provider]: j.models })) : setListError(j.error ?? "Could not load models.")))
      .catch(() => setListError("Could not load models."));
  }, [showAll, provider, allModels, configured]);

  function chooseProvider(id: ProviderId) {
    setProvider(id);
    setModelId(providerInfo(id)!.defaultModel);
  }

  function activate(r: Run, vals?: DriverValues) {
    setActiveKey(r.key);
    setValues(vals ?? initialValues(r.model));
  }

  async function generate() {
    setBusy(true);
    setError(null);
    setStatus(`Sending your scenario to ${modelLabel}…`);
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider, model: modelId, scenario }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? `Request failed (${res.status})`);
      const r: Run = { key: `${Date.now()}`, model: j.model, provider, modelId, modelLabel, scenario };
      setRuns((rs) => [...rs.filter((x) => x.key !== "example"), r]);
      activate(r);
      setStatus(`Built by ${modelLabel} (${info.label}) in ${j.seconds}s${j.attempts > 1 ? `, after ${j.attempts} tries` : ""}. Moving a driver recalculates instantly with no new AI call.`);
    } catch (e) {
      setError((e as Error).message);
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  function save() {
    const name = window.prompt("Name this scenario", model.title);
    if (!name) return;
    setSaved(
      saveScenario({
        id: `${Date.now()}`, name, savedAt: new Date().toISOString(), scenario: run.scenario,
        provider: run.provider, modelId: run.modelId, months, model, values,
      }),
    );
  }

  function open(s: SavedScenario) {
    const r: Run = { key: `saved-${s.id}-${Date.now()}`, model: s.model, provider: s.provider, modelId: s.modelId, modelLabel: s.name, scenario: s.scenario };
    setRuns((rs) => [...rs, r]);
    setScenario(s.scenario);
    setMonths(s.months);
    activate(r, { ...initialValues(s.model), ...s.values });
    setStatus(`Opened “${s.name}”.`);
  }

  function setDriver(d: Driver, v: number) {
    if (!Number.isFinite(v)) return;
    setValues((vals) => ({ ...vals, [d.id]: v }));
  }

  const summary = useMemo(() => {
    const fill = model.summary_template.replace(/\{([a-z][a-z0-9_]*)\}/g, (m, id: string) => {
      const u = model.unit_economics.find((x) => x.id === id);
      if (u) return formatUnitEcon(u, result.unitEconomics[id], model.currency);
      const d = model.drivers.find((x) => x.id === id);
      if (d) return formatDriver(d, values[id] ?? d.value, model.currency);
      return m;
    });
    const be = result.breakEvenMonth
      ? ` EBITDA turns positive in month ${result.breakEvenMonth}.`
      : ` EBITDA stays negative for all ${result.months} months.`;
    return fill + be;
  }, [model, result, values]);

  const changed = model.drivers.some((d) => (values[d.id] ?? d.value) !== d.value);
  const noKeys = !PROVIDERS.some((p) => configured[p.id]);

  return (
    <div className="shell">
      <nav className="rail" aria-label="Sections">
        <div className="logo" aria-hidden="true">FIQ</div>
        <a href="#build" className="on" aria-label="Describe and generate" title="Describe and generate"><Icon d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4" /></a>
        <a href="#drivers" aria-label="Drivers" title="Drivers"><Icon d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4" /></a>
        <a href="#unit-economics" aria-label="Unit economics" title="Unit economics"><Icon d="M12 3v18M17 7.5c0-1.9-2.2-3-5-3s-5 1.1-5 3 2.2 2.6 5 3 5 1.1 5 3-2.2 3-5 3-5-1.1-5-3" /></a>
        <a href="#charts" aria-label="Charts" title="Charts"><Icon d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></a>
        <a href="#pnl" aria-label="Profit and loss" title="Profit and loss"><Icon d="M4 4h16v16H4zM4 9h16M4 14h16M10 4v16" /></a>
        <a href="#saved" aria-label="Saved scenarios" title="Saved scenarios"><Icon d="M6 3h12v18l-6-4-6 4z" /></a>
      </nav>
      <div className="content">
      <header>
        <div className="header-inner">
          <div className="brand">
            <div style={{ minWidth: 0 }}>
              <div className="brand-name">Financial<b>IQ</b></div>
              <div className="brand-sub">{model.title}{run.modelLabel ? ` · ${run.modelLabel}` : ""}</div>
            </div>
          </div>
          <div className="toolbar">
            {runs.length > 1 && (
              <label className="check" style={{ gap: 8 }}>
                Results
                <select className="select pill" value={activeKey}
                  onChange={(e) => activate(runs.find((r) => r.key === e.target.value)!)}>
                  {runs.map((r, i) => <option key={r.key} value={r.key}>{i + 1}. {r.modelLabel}: {r.model.title}</option>)}
                </select>
              </label>
            )}
            <label className="check" style={{ gap: 8 }}>
              Horizon
              <select className="select pill" value={months} onChange={(e) => setMonths(Number(e.target.value))}>
                {Array.from({ length: MAX_MONTHS }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n} month{n > 1 ? "s" : ""}</option>)}
              </select>
            </label>
            <button type="button" className="btn" onClick={save}>Save scenario</button>
            <button type="button" className="btn" onClick={() => download(`${model.title.replace(/[^\w-]+/g, "_")}.csv`, toCsv(model, result, values))}>
              Export to Excel (CSV)
            </button>
          </div>
        </div>
      </header>

      <div className="layout">
        <aside className="col">
          <section className="card" id="build">
            <h2><span className="step">1</span>Describe the business</h2>
            <div className="field">
              <label htmlFor="scenario">The business and its variables, in plain language</label>
              <textarea id="scenario" className="textarea" rows={7} value={scenario} onChange={(e) => setScenario(e.target.value)} />
            </div>

            <h2><span className="step">2</span>Choose the AI model</h2>
            <div className="grid-2">
              <div className="field">
                <label htmlFor="provider">Provider</label>
                <select id="provider" className="select" value={provider} onChange={(e) => chooseProvider(e.target.value as ProviderId)}>
                  {PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}{configured[p.id] ? "" : " (no key)"}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="model">Model</label>
                <select id="model" className="select" value={modelId} onChange={(e) => setModelId(e.target.value)}>
                  {!modelOptions.some((m) => m.id === modelId) && <option value={modelId}>{modelId}</option>}
                  {modelOptions.map((m) => <option key={m.id} value={m.id}>{m.label}{m.price ? ` · ${m.price}` : ""}</option>)}
                </select>
              </div>
            </div>
            <label className="check">
              <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
              Show all models from this provider (prices are $ per 1M tokens in / out)
            </label>
            {listError && <div className="alert alert-error">{listError}</div>}
            {!configured[provider] && (
              <div className="alert alert-warn">There is no API key for {info.label}. Add {info.envKey} to .env.local and restart the app.</div>
            )}
            <button type="button" className="btn btn-primary" onClick={generate} disabled={busy || noKeys || !configured[provider] || scenario.trim().length < 20}>
              {busy ? <><span className="spinner" aria-hidden="true" />Generating model…</> : "Generate financial model"}
            </button>
            {error && <div className="alert alert-error" role="alert">{error}</div>}
            {status && <p className="hint" aria-live="polite">{status}</p>}
          </section>

          <section className="card" id="drivers">
            <div className="card-head">
              <h2><span className="step">3</span>Tune the drivers</h2>
              <button type="button" className="btn btn-sm" onClick={() => setValues(initialValues(model))} disabled={!changed}>Reset to AI values</button>
            </div>
            {model.drivers.map((d) => {
              const v = values[d.id] ?? d.value;
              return (
                <div className="driver" key={d.id}>
                  <div className="driver-top">
                    <label htmlFor={`drv-${d.id}`}>{d.label}</label>
                    <input
                      className={`driver-num ${v !== d.value ? "changed" : ""}`}
                      type="number" step={d.step} value={v} aria-label={`${d.label} value`}
                      onChange={(e) => setDriver(d, parseFloat(e.target.value))}
                    />
                  </div>
                  <input
                    id={`drv-${d.id}`} type="range" min={Math.min(d.min, v)} max={Math.max(d.max, v)} step={d.step} value={v}
                    onChange={(e) => setDriver(d, parseFloat(e.target.value))}
                  />
                  <div className="driver-foot">
                    <span className="driver-note">
                      {formatDriver(d, v, model.currency)}{v !== d.value ? ` (AI: ${formatDriver(d, d.value, model.currency)})` : ""} · {d.rationale}
                    </span>
                    <span className={`tag ${d.source === "user" ? "tag-user" : "tag-ai"}`}>{d.source === "user" ? "From your prompt" : "AI estimate"}</span>
                  </div>
                  {d.warning && <div className="driver-warn">{d.warning}</div>}
                </div>
              );
            })}
          </section>

          <section className="card" id="saved">
            <h2>Saved scenarios</h2>
            {saved.length === 0 ? (
              <p className="hint">Nothing saved yet. Use “Save scenario” at the top to keep a model and your driver values in this browser.</p>
            ) : (
              <div className="saved-list">
                {saved.map((s) => (
                  <div className="saved-item" key={s.id}>
                    <div style={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
                      <span>{s.name}</span>
                      <span className="saved-meta">{new Date(s.savedAt).toLocaleString()}{s.modelId ? ` · ${s.modelId}` : ""}</span>
                    </div>
                    <div style={{ display: "flex", gap: 4 }}>
                      <button type="button" className="btn btn-sm" onClick={() => open(s)}>Open</button>
                      <button type="button" className="btn btn-sm" aria-label={`Delete ${s.name}`}
                        onClick={() => window.confirm(`Delete “${s.name}”?`) && setSaved(deleteScenario(s.id))}>Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </aside>

        <main className="col main">
          <section className="card" id="unit-economics">
            <h2>Unit economics, per {model.unit_name}</h2>
            <div className="ue-top">
            <Gauge model={model} values={result.unitEconomics} />
            <div className="tiles">
              {model.unit_economics.map((u) => {
                const v = result.unitEconomics[u.id];
                return (
                  <div key={u.id} className={`tile tile-${verdict(u, v)}`} title={`Formula: ${u.formula}`}>
                    <span className="tile-label">{u.label}</span>
                    <span className="tile-value">{formatUnitEcon(u, v, model.currency)}</span>
                    {u.note && <span className="tile-sub">{u.note}</span>}
                  </div>
                );
              })}
            </div>
            </div>
            <div className="summary">
              <p className="summary-title">What this says</p>
              <p>{summary}</p>
            </div>
          </section>

          <section className="card" id="charts">
            <div className="charts">
              <Waterfall result={result} currency={model.currency} />
              <Trend result={result} currency={model.currency} />
            </div>
          </section>

          <section className="card" id="pnl">
            <div className="card-head">
              <h2>Profit and loss</h2>
              <span className="hint">{model.currency}, monthly, {result.months} months</span>
            </div>
            <PnlTable model={model} result={result} />
            {result.errors.length > 0 && <div className="alert alert-warn">Some formulas could not be calculated: {result.errors.slice(0, 3).join("; ")}</div>}
            <p className="hint">Every figure is calculated from the drivers on the left. Changing a driver updates this table without calling the AI again.</p>
            <details className="formula-toggle">
              <summary>Show the formulas behind each line</summary>
              <div className="formulas">
                {[...model.metrics, ...model.lines].map((l) => (
                  <FormulaRow key={l.id} label={l.label} formula={l.formula} />
                ))}
                {model.unit_economics.map((u) => <FormulaRow key={u.id} label={u.label} formula={u.formula} />)}
              </div>
              {model.assumptions.length > 0 && (
                <ul className="hint" style={{ marginTop: 10, paddingLeft: 18 }}>
                  {model.assumptions.map((a, i) => <li key={i}>{a}</li>)}
                </ul>
              )}
            </details>
          </section>
        </main>
      </div>
      </div>
    </div>
  );
}

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

/** Semicircle gauge for the headline ratio (LTV:CAC when the model has one). */
function Gauge({ model, values }: { model: FinancialModel; values: Record<string, number> }) {
  const u = model.unit_economics.find((x) => x.format === "ratio") ?? model.unit_economics.find((x) => x.good_threshold != null) ?? model.unit_economics[0];
  const v = values[u.id];
  const target = u.good_threshold ?? 0;
  const max = u.format === "ratio" ? Math.max(6, target * 2) : Math.max(Math.abs(target) * 2, Math.abs(v) * 1.2, 1);
  const frac = Number.isFinite(v) ? Math.min(1, Math.max(0, v / max)) : 0;
  const arc = (f: number) => {
    const a = Math.PI * (1 - f);
    return `${100 + 80 * Math.cos(a)},${100 - 80 * Math.sin(a)}`;
  };
  const tone = verdict(u, v);
  return (
    <div className="gauge">
      <svg viewBox="0 0 200 110" role="img" aria-label={`${u.label}: ${formatUnitEcon(u, v, model.currency)}`}>
        <defs>
          <linearGradient id="gaugeGrad" x1="0" x2="1">
            <stop offset="0" stopColor="#4f7cff" />
            <stop offset=".55" stopColor="#b026ff" />
            <stop offset="1" stopColor="#ff2fb3" />
          </linearGradient>
        </defs>
        <path d={`M20,100 A80,80 0 0 1 180,100`} fill="none" stroke="rgba(255,255,255,.12)" strokeWidth={14} strokeLinecap="round" />
        {frac > 0 && <path d={`M20,100 A80,80 0 0 1 ${arc(frac)}`} fill="none" stroke="url(#gaugeGrad)" strokeWidth={14} strokeLinecap="round" />}
        {u.good_threshold != null && u.format === "ratio" && (
          <circle cx={arc(Math.min(1, target / max)).split(",")[0]} cy={arc(Math.min(1, target / max)).split(",")[1]} r={4} fill="#fff" />
        )}
      </svg>
      <div className="gauge-value" style={{ color: tone === "good" ? "var(--good)" : tone === "bad" ? "var(--neg)" : "#fff" }}>
        {formatUnitEcon(u, v, model.currency)}
      </div>
      <div className="gauge-label">{u.label}{u.good_threshold != null ? ` · target ${formatUnitEcon(u, u.good_threshold, model.currency)}` : ""}</div>
    </div>
  );
}

function FormulaRow({ label, formula }: { label: string; formula: string }) {
  return (
    <>
      <span>{label}</span>
      <code>{formula}</code>
    </>
  );
}
