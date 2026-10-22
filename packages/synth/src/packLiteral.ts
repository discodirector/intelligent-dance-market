// A delivered style pack as data (docs/STATIONS.md "Automatic pipeline"): the swarm writes
// packages/synth/src/stations/<key>.ts, which by contract is one object literal. The pipeline never imports or evals
// that file: this parser reads it as data and refuses anything that is code. Accepted, and nothing else:
//   - comments; an optional `import type { StationPack } from "../pack.ts";` (type imports only);
//   - `export default <value>` with an optional `satisfies <Name>` / `as const`, an optional `;`;
//   - values: object literals (identifier, string or number keys), arrays, strings ('', "", and backtick strings
//     without ${}), numbers (decimal, optional sign, fraction, exponent; hex too), true, false, null; trailing commas.
// Refused: functions and arrows, calls, other imports or exports, template expressions, computed keys, spreads,
// identifiers as values (no references), shorthand properties, getters, `new`, regexes, operators.
// Pure, no dependencies: runs in the bot's image (no TypeScript compiler there) and in tests.

export class PackSyntaxError extends Error {}

type Tok =
  | { t: "punc"; v: string; at: number }
  | { t: "str"; v: string; at: number }
  | { t: "num"; v: number; at: number }
  | { t: "ident"; v: string; at: number };

const PUNC = new Set(["{", "}", "[", "]", ":", ",", ";"]);

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const fail = (msg: string, at = i): never => {
    const line = src.slice(0, at).split("\n").length;
    throw new PackSyntaxError(`line ${line}: ${msg}`);
  };
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (src.startsWith("//", i)) { const e = src.indexOf("\n", i); i = e < 0 ? src.length : e; continue; }
    if (src.startsWith("/*", i)) { const e = src.indexOf("*/", i + 2); if (e < 0) fail("unclosed comment"); i = e + 2; continue; }
    if (PUNC.has(c)) { out.push({ t: "punc", v: c, at: i }); i++; continue; }
    if (c === '"' || c === "'" || c === "`") {
      const start = i;
      let s = "";
      i++;
      for (;;) {
        if (i >= src.length) fail("unclosed string", start);
        const d = src[i];
        if (d === c) { i++; break; }
        if (c === "`" && d === "$" && src[i + 1] === "{") fail("template expression (${...}) is code, not data");
        if (c !== "`" && d === "\n") fail("newline in a string");
        if (d === "\\") {
          const n = src[i + 1];
          const esc: Record<string, string> = { n: "\n", t: "\t", r: "\r", "\\": "\\", '"': '"', "'": "'", "`": "`", "0": "\0" };
          if (n in esc) { s += esc[n]; i += 2; continue; }
          if (n === "u" && /^[0-9a-fA-F]{4}$/.test(src.slice(i + 2, i + 6))) { s += String.fromCharCode(parseInt(src.slice(i + 2, i + 6), 16)); i += 6; continue; }
          fail(`unsupported escape \\${n}`);
        }
        s += d;
        i++;
      }
      out.push({ t: "str", v: s, at: start });
      continue;
    }
    const num = /^[+-]?(0x[0-9a-fA-F]+|(\d[\d_]*)?\.?\d[\d_]*([eE][+-]?\d+)?)/.exec(src.slice(i));
    if ((/\d/.test(c) || ((c === "-" || c === "+" || c === ".") && /[\d.]/.test(src[i + 1] ?? ""))) && num && num[0] !== "-" && num[0] !== "+") {
      const text = num[0].replace(/_/g, "");
      const v = /^[+-]?0x/i.test(text) ? (text.startsWith("-") ? -1 : 1) * parseInt(text.replace(/^[+-]?0x/i, ""), 16) : Number(text);
      if (!Number.isFinite(v)) fail(`bad number ${num[0]}`);
      // A number followed by an identifier character is not a plain literal (1n, 1px, 1e).
      if (/[A-Za-z_$]/.test(src[i + num[0].length] ?? "")) fail(`bad number ${num[0]}${src[i + num[0].length]}`);
      out.push({ t: "num", v, at: i });
      i += num[0].length;
      continue;
    }
    const id = /^[A-Za-z_$][\w$]*/.exec(src.slice(i));
    if (id) { out.push({ t: "ident", v: id[0], at: i }); i += id[0].length; continue; }
    fail(`unexpected ${JSON.stringify(c)} (operators, calls and other code are not data)`);
  }
  return out;
}

/** The pack's value, parsed as data; throws PackSyntaxError on anything that is not a plain literal. */
export function parsePackSource(src: string): unknown {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const line = (t?: Tok) => (t ? src.slice(0, t.at).split("\n").length : src.split("\n").length);
  const fail = (msg: string, t = peek()): never => { throw new PackSyntaxError(`line ${line(t)}: ${msg}`); };
  const isPunc = (v: string, t = peek()) => t?.t === "punc" && t.v === v;
  const isIdent = (v: string, t = peek()) => t?.t === "ident" && t.v === v;
  const expectPunc = (v: string) => { if (!isPunc(v)) fail(`expected "${v}"`); p++; };

  // Header: type imports only.
  while (isIdent("import")) {
    p++;
    if (!isIdent("type")) fail("only `import type { ... } from \"...\"` is allowed");
    p++;
    expectPunc("{");
    while (!isPunc("}")) {
      if (peek()?.t !== "ident") fail("expected an imported type name");
      p++;
      if (isPunc(",")) p++;
    }
    p++;
    if (!isIdent("from")) fail('expected "from"');
    p++;
    if (peek()?.t !== "str") fail("expected the module path");
    p++;
    if (isPunc(";")) p++;
  }
  if (!isIdent("export")) fail("expected `export default { ... }`");
  p++;
  if (!isIdent("default")) fail("expected `export default`");
  p++;

  const RESERVED_VALUES: Record<string, unknown> = { true: true, false: false, null: null };
  const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
  const value = (depth: number): unknown => {
    if (depth > 64) fail("nested too deep");
    const t = peek();
    if (!t) fail("unexpected end of file");
    if (t.t === "str" || t.t === "num") { p++; return t.v; }
    if (t.t === "ident") {
      if (t.v in RESERVED_VALUES) { p++; return RESERVED_VALUES[t.v]; }
      fail(`"${t.v}" is a reference or code, not data`);
    }
    if (isPunc("[")) {
      p++;
      const arr: unknown[] = [];
      while (!isPunc("]")) {
        if (isPunc(",")) fail("holes in arrays are not allowed");
        arr.push(value(depth + 1));
        if (isPunc(",")) p++;
        else if (!isPunc("]")) fail('expected "," or "]"');
      }
      p++;
      return arr;
    }
    if (isPunc("{")) {
      p++;
      const obj: Record<string, unknown> = Object.create(null);
      while (!isPunc("}")) {
        const k = peek();
        let key: string;
        if (k?.t === "ident" || k?.t === "str") key = String(k.v);
        else if (k?.t === "num") key = String(k.v);
        else if (isPunc("[")) fail("computed keys are code, not data");
        else fail("expected a property name");
        if (FORBIDDEN_KEYS.has(key!)) fail(`property "${key!}" is not allowed`);
        if (Object.prototype.hasOwnProperty.call(obj, key!)) fail(`property "${key!}" is listed twice`);
        p++;
        if (!isPunc(":")) fail(`expected ":" after "${key!}" (shorthand properties, methods and getters are code)`);
        p++;
        obj[key!] = value(depth + 1);
        if (isPunc(",")) p++;
        else if (!isPunc("}")) fail('expected "," or "}"');
      }
      p++;
      // A plain object for callers (the null prototype only guarded the parse).
      return Object.assign({}, obj);
    }
    return fail(`unexpected "${(t as { v: unknown }).v}"`);
  };

  const result = value(0);
  if (isIdent("satisfies")) {
    p++;
    if (peek()?.t !== "ident") fail("expected a type name after satisfies");
    p++;
  } else if (isIdent("as")) {
    p++;
    if (!isIdent("const")) fail("only `as const` is allowed");
    p++;
  }
  if (isPunc(";")) p++;
  if (p < toks.length) fail("nothing may follow the default export");
  return result;
}
