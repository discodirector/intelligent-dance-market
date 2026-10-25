import { describe, expect, it } from "vitest";
import { canon } from "../src/imd/paid.ts";
import { orderProblems, PUBLIC_REPO, STYLE_SKILL, styleContinueBody, styleObjective, styleOpenBody, type StyleOrder } from "../src/imd/styleJob.ts";

const SHA = "8e39ef78a198eded3cb43ff6982e39393e521b55";
const chog = (over: Partial<StyleOrder> = {}): StyleOrder => ({
  key: "chog", genres: ["liquid", "acid"], brief: "playful, bouncy, Monad purple energy", baseCommit: SHA, ...over,
});

describe("styleOpenBody", () => {
  it("builds a job.open body that writes only the pack, from the public repo at the commit", () => {
    const body = styleOpenBody(chog());
    expect(Object.keys(body).sort()).toEqual(["baseCommit", "github", "objective", "paths", "repoUrl", "skill"]);
    expect(body).toMatchObject({
      skill: STYLE_SKILL, repoUrl: PUBLIC_REPO, baseCommit: SHA, github: true,
      paths: ["packages/synth/src/stations/chog.ts"],
    });
    expect(STYLE_SKILL).toBe("refine-project");
    expect(styleOpenBody(chog({ repoUrl: "https://github.com/o/r" })).repoUrl).toBe("https://github.com/o/r");
  });

  it("states the file, the genres, the styles, the vibe, the taste and the gate in the objective", () => {
    const o = styleOpenBody(chog()).objective;
    expect(o).toContain("exactly one new file, packages/synth/src/stations/chog.ts");
    expect(o).toContain("Change nothing else");
    expect(o).toContain('genres: ["liquid", "acid"]');
    expect(o).toContain("genres in this order: liquid, acid. 2 styles per genre");
    expect(o).toContain('ids prefixed "chog-"');
    expect(o).toContain("Data only");
    expect(o).toContain('The owner\'s vibe: "playful, bouncy, Monad purple energy"');
    expect(o).toContain("liquid: a fast rolling break with a deep sub; acid: a 303 line over four-to-the-floor");
    expect(o).toContain("Avoid harshness");
    expect(o).toContain(`node web/scripts/station-check-pack.mjs chog --diff ${SHA}`);
    expect(o).toContain("PASS: the pack is ready for the owner to listen");
    expect(o).toContain("packages/synth/src/stations/README.md");
    expect(o).not.toContain("futuregarage:");
  });

  it("takes the style count and keeps the brief on one quoted line", () => {
    const o = styleObjective(chog({ genres: ["triphop", "lofihouse", "futuregarage"], styles: 1, brief: '  slow\n"smoky"  rooms ' }));
    expect(o).toContain("genres in this order: triphop, lofihouse, futuregarage. 1 style per genre");
    expect(o).toContain('The owner\'s vibe: "slow \\"smoky\\" rooms"');
  });

  it("fits the API: objective <= 8000 chars, body < 16 KiB even with the longest brief and seven genres", () => {
    const body = styleOpenBody(chog({ genres: ["liquid", "futuregarage", "triphop", "lofihouse", "acid", "dubtechno", "electro"], styles: 4, brief: "x".repeat(1500) }));
    expect(body.objective.length).toBeLessThanOrEqual(8000);
    expect(JSON.stringify({ requestKey: "0".repeat(36), action: "job.open", input: body }).length).toBeLessThan(16 * 1024);
    expect(body.paths.length).toBeLessThanOrEqual(16);
  });

  it("is deterministic (same order, same canonical body: the quote's input hash)", () => {
    expect(canon(styleOpenBody(chog()))).toBe(canon(styleOpenBody(chog())));
  });

  it("refuses what validatePack or the API would refuse", () => {
    expect(orderProblems(chog())).toEqual([]);
    const bad = (over: Partial<StyleOrder>) => () => styleOpenBody(chog(over));
    expect(bad({ key: "idm" })).toThrow(/key "idm"/);
    expect(bad({ key: "Chog" })).toThrow(/key/);
    expect(bad({ key: "c" })).toThrow(/key/);
    expect(bad({ genres: [] })).toThrow(/genres: 1\.\./);
    expect(bad({ genres: ["liquid", "dubstep"] })).toThrow(/genre "dubstep"/);
    expect(bad({ genres: ["liquid", "liquid"] })).toThrow(/listed twice/);
    expect(bad({ styles: 5 })).toThrow(/styles per genre/);
    expect(bad({ styles: 1.5 })).toThrow(/styles per genre/);
    expect(bad({ brief: "  " })).toThrow(/brief/);
    expect(bad({ brief: "x".repeat(1501) })).toThrow(/brief/);
    expect(bad({ baseCommit: "8E39EF78A198EDED3CB43FF6982E39393E521B55" })).toThrow(/commit/);
    expect(bad({ baseCommit: "main" })).toThrow(/commit/);
  });
});

describe("styleContinueBody", () => {
  it("continues the parent job on the same file, with the owner's notes and the gate, no repo fields", () => {
    const body = styleContinueBody("chog", "11111111-2222-4333-8444-555555555555", "acid: less squelch,\nmore bounce");
    expect(Object.keys(body).sort()).toEqual(["objective", "parentJobId", "paths", "skill"]);
    expect(body).toMatchObject({ parentJobId: "11111111-2222-4333-8444-555555555555", skill: STYLE_SKILL, paths: ["packages/synth/src/stations/chog.ts"] });
    expect(body.objective).toContain('"acid: less squelch, more bounce"');
    expect(body.objective).toContain("node web/scripts/station-check-pack.mjs chog");
    expect(body.objective).toContain("change nothing else");
    expect(() => styleContinueBody("chog", "x", " ")).toThrow(/notes/);
  });
});
