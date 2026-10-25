// The swarm job that writes a station's style pack (docs/STATIONS.md "Ordering the sound"): the job.open body for the
// first version and the job.continue body for a revision. Pure: bot/scripts/swarm-style.ts sends them.
// The objective is packages/synth/src/stations/README.md (the swarm's brief) boiled down to what the worker must do;
// the README itself is in the repository the job checks out, and the objective points to it.
import { DATA_GENRES } from "@swarm-sequencer/synth";

export type StyleGenre = (typeof DATA_GENRES)[number];

/** The public repository the job checks out (its main must carry the packs, the gate and the README). */
export const PUBLIC_REPO = "https://github.com/discodirector/intelligent-dance-market";

/**
 * The skill: refine-project, "change an existing project to address specific reported problems, without rebuilding
 * it" (GET /skills). It works on the imported tree, writes only the `paths` it is given (judge verifier-paths) and
 * runs no Foundry checks. implement-and-test / implement-contract / fix-findings check with Foundry (`checks:
 * foundry`), which this repository has no project for; scaffold-project builds from an empty tree; create-audio
 * delivers audio files, not code; implement-component is for one branch of a parallel fan-out.
 */
export const STYLE_SKILL = "refine-project";

/** What each opened genre must stay (README "Taste": change the producer, not the genre). */
const GENRE_CORE: Record<StyleGenre, string> = {
  liquid: "a fast rolling break with a deep sub",
  futuregarage: "skippy 2-step drums, a sub and airy chords",
  triphop: "slow and heavy, a dusty break",
  lofihouse: "a dusty four-to-the-floor house groove",
  acid: "a 303 line over four-to-the-floor",
  dubtechno: "a round four-to-the-floor kick, minor chord stabs into a dub echo, a rolling sub",
  electro: "a syncopated 808 break, never four-to-the-floor, and a machine bass line",
  ambientidm: "slow chords on a soft dusty pocket, a few long melodic notes",
  drone: "held, slowly breathing layers with no beat",
};

/** Where the character of the later-opened genres lives (styledata.ts AmbientIdmData, DroneData; README "Sound fields"). */
const GENRE_FIELDS = {
  ambientidm:
    "harmony in chords/progressions, the phrase material in figures (Tape Keys), phrases (Tape Haze) or arps (Crystal), tiers for how fast it gets busy, notes for the blips; sound in kit (each base its own parts), pad, bass, lead, line, glass, bell, shimmer.",
  drone:
    "the layers in voicing/colours/busy and bars (phrase length), the Overtone Pulse series in partials/figures, glints for the bell pitches; sound in wall/pad (waves, detune, breathing), bed (beating subs), overtone, glint, kick, breath, rumble, swell. Keep it beatless and slow.",
  liquid:
    "give every style its own `ornament`: what a mention of the token on X plays (voices and smart from nature, amen, keys; nature sounds bird, gust, drop; level 0..1.6; slots). It is silent without mentions; keep it quiet, far away or a ghost under the break, not a melody, different per style.",
  futuregarage:
    "give every style its own `ornament`: what a mention of the token on X plays (voices and smart from reverse, foley, groove, yeah; foley objects lighter, drop, vinyl; level 0..1.6; slots). It is silent without mentions; keep it quiet, a reaction in the room, not a melody, different per style.",
  electro:
    "give every style its own `ornament`: the robot word a mention of the token on X plays (vowels, wave, steps, octave, syllable, ring, lowpass, echo, level, slots). It is silent without mentions; make it this station's own robot, a quiet answer between the kicks, different per style.",
} as const;

export const packPath = (key: string) => `packages/synth/src/stations/${key}.ts`;

export interface StyleOrder {
  key: string;
  genres: readonly string[];
  /** The owner's words about the vibe. */
  brief: string;
  /** Styles per genre, 1..4 (default 2). */
  styles?: number;
  repoUrl?: string;
  /** 40 lowercase hex: the public repository's commit the job starts from (and the gate diffs against). */
  baseCommit: string;
}

/** Problems with an order's arguments, as messages; empty when it can be sent. Same rules as pack.ts validatePack. */
export function orderProblems(o: StyleOrder): string[] {
  const out: string[] = [];
  if (!/^[a-z0-9-]{2,24}$/.test(o.key) || o.key === "idm" || o.key === "imd-eth") out.push(`key "${o.key}": a-z 0-9 "-", 2..24 chars, not idm / imd-eth`);
  if (o.genres.length < 1 || o.genres.length > DATA_GENRES.length) out.push(`genres: 1..${DATA_GENRES.length} of ${DATA_GENRES.join(", ")}, got ${o.genres.length}`);
  for (const g of o.genres) if (!(DATA_GENRES as readonly string[]).includes(g)) out.push(`genre "${g}": not one of ${DATA_GENRES.join(", ")}`);
  if (new Set(o.genres).size !== o.genres.length) out.push("genres: listed twice");
  const n = o.styles ?? 2;
  if (!Number.isInteger(n) || n < 1 || n > 4) out.push(`styles per genre: 1..4, got ${n}`);
  if (!o.brief.trim()) out.push("brief: the owner's words about the vibe are required");
  if (o.brief.length > 1500) out.push(`brief: at most 1500 chars, got ${o.brief.length}`);
  if (!/^[0-9a-f]{40}$/.test(o.baseCommit)) out.push(`commit "${o.baseCommit}": 40 lowercase hex`);
  return out;
}

const quote = (s: string) => JSON.stringify(s.trim().replace(/\s+/g, " "));

/** The job's objective: one file, data only, the genres, the vibe, taste, and the gate it must pass. */
export function styleObjective(o: StyleOrder): string {
  const n = o.styles ?? 2;
  const file = packPath(o.key);
  const genres = o.genres as readonly StyleGenre[];
  return [
    `Write the style pack of the "${o.key}" station of Intelligent Dance Market: exactly one new file, ${file}. Change nothing else in the repository.`,
    "",
    "Read first: packages/synth/src/stations/README.md (the brief: contract, sound fields, taste, gate), packages/synth/src/stations/example.ts (the reference pack: copy its shape), packages/synth/src/styledata.ts (every field and its range), packages/synth/src/pack.ts (validatePack) and the house tables and SOUND_DEFAULTS at the end of packages/synth/src/engine.ts.",
    "",
    "The pack:",
    `- export default { key: "${o.key}", name, genres: [${genres.map((g) => `"${g}"`).join(", ")}], styles, patches? } satisfies StationPack; the only import is \`import type { StationPack } from "../pack.ts"\`.`,
    `- genres in this order: ${genres.join(", ")}. ${n} style${n > 1 ? "s" : ""} per genre, ids prefixed "${o.key}-", each on a base the README table lists for its genre.`,
    "- Data only: one object literal. No functions, loops, computed values, randomness or other imports. No engine edits.",
    "",
    `The owner's vibe: ${quote(o.brief)}`,
    "",
    "Taste:",
    `- Keep each genre recognisable (${genres.map((g) => `${g}: ${GENRE_CORE[g]}`).join("; ")}). Change the producer, not the genre.`,
    "- One idea per style, committed; contrast the styles with each other and with the house. Use the sound fields (kit, bass, the genre's voices: pad/strings/voice/bassTone/stabTone/hoover..., fx, mix, vinyl, the pack's own lead patches), not only notes and rhythm.",
    ...genres.filter((g) => g in GENRE_FIELDS).map((g) => `- ${g}: ${GENRE_FIELDS[g as keyof typeof GENRE_FIELDS]}`),
    "- Avoid harshness: hats under ~0.6 level, snare noise q under ~2, never resonance and drive both at the top of their ranges, fx.master.crush under 8 bits only on purpose.",
    "- One thing owns the sub. Send snares, leads, pads and percussion to the echo and the room, not the kick and the bass.",
    "",
    "The gate (it must pass before you finish):",
    "  npm ci && npx playwright install chromium",
    `  node web/scripts/station-check-pack.mjs ${o.key} --diff ${o.baseCommit}`,
    'It must end with "PASS: the pack is ready for the owner to listen". Too quiet or too loud: change that style\'s trim by the dB difference (trim *= 10 ** (dB / 20)) and run it again.',
    `Deliver only ${file}; the WAVs under sim/ are gitignored, do not commit them.`,
  ].join("\n");
}

/** job.open: the first version of the pack, from the public repository at baseCommit. */
export function styleOpenBody(o: StyleOrder) {
  const problems = orderProblems(o);
  if (problems.length) throw new Error(problems.join("; "));
  return {
    objective: styleObjective(o),
    skill: STYLE_SKILL,
    repoUrl: o.repoUrl ?? PUBLIC_REPO,
    baseCommit: o.baseCommit,
    paths: [packPath(o.key)],
    github: true,
  };
}

/** job.continue: the next version of the pack, on the project's newest job (`parentJobId`), from the same wallet. */
export function styleContinueBody(key: string, parentJobId: string, notes: string) {
  if (!notes.trim()) throw new Error("notes: say what to change");
  const file = packPath(key);
  return {
    parentJobId,
    objective: [
      `Revise the "${key}" station's style pack, ${file}, and change nothing else. The owner listened and asks:`,
      "",
      quote(notes),
      "",
      "Keep every other style as it is unless the notes say otherwise. Same rules as the first version (packages/synth/src/stations/README.md): data only, the gate must pass:",
      `  node web/scripts/station-check-pack.mjs ${key}`,
      'It must end with "PASS: the pack is ready for the owner to listen".',
    ].join("\n"),
    skill: STYLE_SKILL,
    paths: [file],
  };
}
