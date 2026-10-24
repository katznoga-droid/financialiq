import type { DriverValues } from "./engine";
import type { FinancialModel } from "./schema";

// Saved scenarios live in this browser for now. Everything goes through these
// three functions, so moving to a shared database later (for multiple users)
// means changing only this file.

export interface SavedScenario {
  id: string;
  name: string;
  savedAt: string;
  scenario: string;
  provider: string;
  modelId: string;
  months: number;
  model: FinancialModel;
  values: DriverValues;
}

const KEY = "financialiq.scenarios.v1";

export function loadScenarios(): SavedScenario[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as SavedScenario[]) : [];
  } catch {
    return [];
  }
}

export function saveScenario(s: SavedScenario): SavedScenario[] {
  const list = [s, ...loadScenarios().filter((x) => x.id !== s.id)].slice(0, 50);
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* storage full or blocked */ }
  return list;
}

export function deleteScenario(id: string): SavedScenario[] {
  const list = loadScenarios().filter((x) => x.id !== id);
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* ignore */ }
  return list;
}
