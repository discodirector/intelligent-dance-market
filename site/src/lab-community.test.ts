// The kept listeners' styles (lab-community.json): every code opens in the lab as what the entry says, and its style
// builds a pack the station gate's validator accepts.
import { validatePack } from "@swarm-sequencer/synth";
import { describe, expect, it } from "vitest";
import { decodeRecipe } from "./lab-codec";
import { COMMUNITY } from "./lab-community";
import { buildStyle, packOf } from "./lab-styles";

describe("community presets", () => {
  it("have unique kebab-case ids", () => {
    const ids = COMMUNITY.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });
  for (const p of COMMUNITY) {
    it(`${p.id}: decodes to its genre, preset and name, and builds a valid pack`, async () => {
      const d = await decodeRecipe(p.code);
      expect(d.ok).toBe(true);
      if (!d.ok) return;
      expect(d.recipe).toMatchObject({ genre: p.genre, preset: p.from, name: p.name });
      expect(validatePack(packOf(buildStyle(d.recipe)))).toEqual([]);
      expect(p.added).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  }
});

describe("runtime gallery (untrusted JSON)", () => {
  it("keeps decoded entries, takes name and genre from the code, cleans the rest", async () => {
    const { runtimeFrom } = await import("./lab-community");
    const good = COMMUNITY[0];
    const out = await runtimeFrom({
      presets: [
        { ...good, id: "evil-1", name: "<img src=x onerror=alert(1)>", genre: "acid", by: "@x<script>", note: "hi‮ there <b>", added: "yesterday" },
        { id: "bad-code", code: "2AAAA" },
        { id: "Bad Id!", code: good.code },
        null,
        "string",
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: "evil-1", name: good.name, genre: good.genre, by: "xscript", note: "hi there <b>", added: "" });
    expect(await runtimeFrom({ presets: "nope" })).toEqual([]);
    expect(await runtimeFrom(null)).toEqual([]);
  });
});
