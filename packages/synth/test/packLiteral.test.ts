import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PackSyntaxError, parsePackSource } from "../src/packLiteral.ts";
import { programFromPack, validatePack } from "../src/pack.ts";
import { packFor, programFor, registerPack } from "../src/stations/index.ts";
import example from "../src/stations/example.ts";
import credits from "../src/stations/credits.ts";
import creditsDubhouse from "../src/stations/credits-dubhouse.ts";
import infer from "../src/stations/infer.ts";

const src = (name: string) => readFileSync(new URL(`../src/stations/${name}.ts`, import.meta.url), "utf8");
const wrap = (body: string) => `import type { StationPack } from "../pack.ts";\n\nexport default ${body} satisfies StationPack;\n`;

describe("pack literal parser", () => {
  it("reads example.ts, infer.ts and the Credits packs as the same data the module exports", () => {
    for (const [name, mod] of [["example", example], ["infer", infer], ["credits", credits], ["credits-dubhouse", creditsDubhouse]] as const) {
      const data = parsePackSource(src(name));
      expect(data).toEqual(JSON.parse(JSON.stringify(mod)));
      expect(validatePack(data)).toEqual([]);
      // The parsed pack plays exactly like the imported one.
      expect(JSON.stringify(programFromPack(data as typeof mod).styles)).toBe(JSON.stringify(programFromPack(mod).styles));
    }
  });

  it("accepts the literal forms a pack uses", () => {
    expect(parsePackSource(`export default { a: 1, "b-c": [1, -2.5, 1e3, 0x10, .5,], d: 'x', e: \`plain\`, f: true, g: null, }`)).toEqual({ a: 1, "b-c": [1, -2.5, 1000, 16, 0.5], d: "x", e: "plain", f: true, g: null });
    expect(parsePackSource(`// c\n/* c */ export default { x: "a\\"b // not a comment" } as const;`)).toEqual({ x: 'a"b // not a comment' });
  });

  const refused: [string, string][] = [
    ["a function", wrap(`{ key: function () { return 1; } }`)],
    ["an arrow", wrap(`{ key: () => 1 }`)],
    ["a call", wrap(`{ key: make("x") }`)],
    ["a method", wrap(`{ key() { return 1; } }`)],
    ["a getter", wrap(`{ get key() { return 1; } }`)],
    ["a reference", wrap(`{ key: someConst }`)],
    ["a shorthand property", wrap(`{ key }`)],
    ["a value import", `import { x } from "./x.ts";\nexport default { key: 1 };`],
    ["a default import", `import x from "./x.ts";\nexport default { key: 1 };`],
    ["a dynamic import", wrap(`{ key: import("./x.ts") }`)],
    ["a template expression", wrap("{ key: `a${1 + 1}` }")],
    ["a computed key", wrap(`{ ["k" + 1]: 1 }`)],
    ["an object spread", wrap(`{ ...other, key: 1 }`)],
    ["an array spread", wrap(`{ key: [...other] }`)],
    ["arithmetic", wrap(`{ key: 1 + 2 }`)],
    ["new", wrap(`{ key: new Date() }`)],
    ["a regex", wrap(`{ key: /x/ }`)],
    ["code after the export", `export default { key: 1 };\nconsole.log(1);`],
    ["code before the export", `const x = 1;\nexport default { key: 1 };`],
    ["a named export", `export const x = { key: 1 };`],
    ["__proto__", wrap(`{ __proto__: { polluted: true } }`)],
    ["a bigint", wrap(`{ key: 1n }`)],
    ["a duplicate key", wrap(`{ key: 1, key: 2 }`)],
  ];
  for (const [what, text] of refused) {
    it(`refuses ${what}`, () => {
      expect(() => parsePackSource(text)).toThrow(PackSyntaxError);
    });
  }
});

describe("baked packs", () => {
  it("the Credits station plays credits.ts (ten styles); its first pack (credits-dubhouse) is baked, unused", () => {
    expect(packFor("credits")).toBe(credits);
    expect(packFor("credits-dubhouse")).toBe(creditsDubhouse);
    expect(programFor("credits-dubhouse").key).toBe("credits-dubhouse");
    const ids = (p: { styles: { dubtechno: readonly { id: string }[] } }) => p.styles.dubtechno.map((s) => s.id);
    expect(ids(credits)).toEqual(["void", "watermark", "null", "signature", "provenance", "escrow", "clearing", "redacted", "foil", "letterpress"].map((n) => `credits-${n}`));
    const all = [...ids(credits), ...ids(creditsDubhouse)];
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("runtime packs", () => {
  it("registerPack validates, then programFor plays it; baked packs win; bad packs are refused", () => {
    const pack = { ...(parsePackSource(src("example")) as Record<string, unknown>), key: "rt-test", name: "Runtime Test" };
    expect(packFor("rt-test")).toBeUndefined();
    expect(registerPack(pack)).toEqual([]);
    expect(programFor("rt-test").key).toBe("rt-test");
    expect(registerPack({ ...pack, genres: ["techno"] }).length).toBeGreaterThan(0);
    const fake = { ...pack, key: "infer", name: "Not Infer" };
    expect(registerPack(fake)).toEqual([]);
    expect(packFor("infer")).toBe(infer);
  });
});
