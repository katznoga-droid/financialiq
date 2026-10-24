// A small, safe formula language. The AI writes formulas in it; the app parses
// and evaluates them locally. There is no eval(): anything outside this grammar
// is rejected.
//
//   expr    := ternary-free arithmetic with + - * / ^, comparisons and parentheses
//   numbers := 12, 0.5, 1e3
//   names   := driver ids, metric ids, P&L line ids, totals, and `month`
//   calls   := min(a,b,...) max(...) abs(x) round(x[,digits]) floor(x) ceil(x)
//              if(cond, a, b) clamp(x, lo, hi)
//              prev(id[, fallback])   value of `id` in the previous month
//              sum(id) avg(id) last(id) first(id)   over the whole horizon
//                                                   (unit economics only)

export type Node =
  | { k: "num"; v: number }
  | { k: "ref"; name: string }
  | { k: "neg"; a: Node }
  | { k: "bin"; op: string; a: Node; b: Node }
  | { k: "call"; fn: string; args: Node[] };

const MATH_FNS = new Set(["min", "max", "abs", "round", "floor", "ceil", "if", "clamp"]);
export const SERIES_FNS = new Set(["prev", "sum", "avg", "last", "first"]);

type Tok = { t: "num" | "id" | "op" | "(" | ")" | ","; v: string; pos: number };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    const num = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(src.slice(i));
    if (num) { out.push({ t: "num", v: num[0], pos: i }); i += num[0].length; continue; }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
    if (id) { out.push({ t: "id", v: id[0], pos: i }); i += id[0].length; continue; }
    const two = src.slice(i, i + 2);
    if ([">=", "<=", "==", "!=", "&&", "||"].includes(two)) { out.push({ t: "op", v: two, pos: i }); i += 2; continue; }
    if ("+-*/^<>".includes(c)) { out.push({ t: "op", v: c, pos: i }); i++; continue; }
    if (c === "(" || c === ")" || c === ",") { out.push({ t: c, v: c, pos: i }); i++; continue; }
    throw new Error(`Unexpected character "${c}" at position ${i}`);
  }
  return out;
}

const PREC: Record<string, number> = { "||": 1, "&&": 2, "==": 3, "!=": 3, "<": 4, ">": 4, "<=": 4, ">=": 4, "+": 5, "-": 5, "*": 6, "/": 6, "^": 7 };

export function parse(src: string): Node {
  if (typeof src !== "string" || !src.trim()) throw new Error("Empty formula");
  if (src.length > 1000) throw new Error("Formula too long");
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const expect = (t: Tok["t"]) => {
    const tok = toks[p];
    if (!tok || tok.t !== t) throw new Error(`Expected "${t}" ${tok ? `but found "${tok.v}"` : "at end"}`);
    p++;
    return tok;
  };

  function primary(): Node {
    const tok = peek();
    if (!tok) throw new Error("Formula ends unexpectedly");
    if (tok.t === "num") { p++; return { k: "num", v: parseFloat(tok.v) }; }
    if (tok.t === "op" && (tok.v === "-" || tok.v === "+")) {
      p++;
      const a = binary(PREC["*"]);
      return tok.v === "-" ? { k: "neg", a } : a;
    }
    if (tok.t === "(") { p++; const e = binary(0); expect(")"); return e; }
    if (tok.t === "id") {
      p++;
      if (peek()?.t === "(") {
        const fn = tok.v.toLowerCase();
        if (!MATH_FNS.has(fn) && !SERIES_FNS.has(fn)) throw new Error(`Unknown function "${tok.v}"`);
        p++;
        const args: Node[] = [];
        if (peek()?.t !== ")") {
          args.push(binary(0));
          while (peek()?.t === ",") { p++; args.push(binary(0)); }
        }
        expect(")");
        if (SERIES_FNS.has(fn) && args[0]?.k !== "ref") throw new Error(`${fn}() needs a line or metric name as its first argument`);
        return { k: "call", fn, args };
      }
      return { k: "ref", name: tok.v };
    }
    throw new Error(`Unexpected "${tok.v}"`);
  }

  function binary(minPrec: number): Node {
    let left = primary();
    for (;;) {
      const tok = peek();
      if (!tok || tok.t !== "op" || PREC[tok.v] === undefined) break;
      const prec = PREC[tok.v];
      if (prec < minPrec) break;
      p++;
      // `^` is right-associative; the rest are left-associative.
      const right = binary(tok.v === "^" ? prec : prec + 1);
      left = { k: "bin", op: tok.v, a: left, b: right };
    }
    return left;
  }

  const node = binary(0);
  if (p < toks.length) throw new Error(`Unexpected "${toks[p].v}" at position ${toks[p].pos}`);
  return node;
}

/** Every name a formula reads, split into same-month reads and series reads (prev/sum/...). */
export function references(node: Node): { direct: Set<string>; series: Set<string> } {
  const direct = new Set<string>();
  const series = new Set<string>();
  (function walk(n: Node) {
    if (n.k === "ref") direct.add(n.name);
    else if (n.k === "neg") walk(n.a);
    else if (n.k === "bin") { walk(n.a); walk(n.b); }
    else if (n.k === "call") {
      if (SERIES_FNS.has(n.fn)) {
        series.add((n.args[0] as { name: string }).name);
        n.args.slice(1).forEach(walk);
      } else n.args.forEach(walk);
    }
  })(node);
  return { direct, series };
}

export interface EvalContext {
  get(name: string): number;
  series?(fn: string, name: string, fallback: number | undefined): number;
}

export function evaluate(node: Node, ctx: EvalContext): number {
  switch (node.k) {
    case "num": return node.v;
    case "ref": return ctx.get(node.name);
    case "neg": return -evaluate(node.a, ctx);
    case "bin": {
      const a = evaluate(node.a, ctx);
      const b = evaluate(node.b, ctx);
      switch (node.op) {
        case "+": return a + b;
        case "-": return a - b;
        case "*": return a * b;
        case "/": return b === 0 ? 0 : a / b; // divide-by-zero reads as 0 rather than breaking the table
        case "^": return Math.pow(a, b);
        case "<": return a < b ? 1 : 0;
        case ">": return a > b ? 1 : 0;
        case "<=": return a <= b ? 1 : 0;
        case ">=": return a >= b ? 1 : 0;
        case "==": return a === b ? 1 : 0;
        case "!=": return a !== b ? 1 : 0;
        case "&&": return a && b ? 1 : 0;
        case "||": return a || b ? 1 : 0;
      }
      throw new Error(`Unknown operator ${node.op}`);
    }
    case "call": {
      if (SERIES_FNS.has(node.fn)) {
        if (!ctx.series) throw new Error(`${node.fn}() is not available here`);
        const name = (node.args[0] as { name: string }).name;
        const fallback = node.args[1] ? evaluate(node.args[1], ctx) : undefined;
        return ctx.series(node.fn, name, fallback);
      }
      const v = node.args.map((a) => evaluate(a, ctx));
      switch (node.fn) {
        case "min": return Math.min(...v);
        case "max": return Math.max(...v);
        case "abs": return Math.abs(v[0]);
        case "floor": return Math.floor(v[0]);
        case "ceil": return Math.ceil(v[0]);
        case "round": { const f = Math.pow(10, v[1] ?? 0); return Math.round(v[0] * f) / f; }
        case "if": return v[0] ? v[1] : (v[2] ?? 0);
        case "clamp": return Math.min(Math.max(v[0], v[1]), v[2]);
      }
      throw new Error(`Unknown function ${node.fn}`);
    }
  }
}
