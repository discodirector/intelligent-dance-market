// bot/caption: strict facts JSON in -> <= 240 char caption out. Claude (claude-sonnet-5-5) with template fallback.
import Anthropic from "@anthropic-ai/sdk";
import type { Facts } from "../lib/facts.ts";

export const MAX_LEN = 240;
export const MODEL = process.env.CAPTION_MODEL ?? "claude-sonnet-5-5";

const SYSTEM = `You write one short post for X for "Intelligent Dance Market": a Uniswap v4 hook whose on-chain state is a 16-step drum + bass pattern that every swap mutates. The attached video plays that state as an IDM track.
When kind is "track": buys kept landing on a full grid until its heat peaked, so the hook finished the track (track.no), archived it and started the next one from a fresh seed.
If "pulses" is present: that many of the buys were treasury pulses, small automatic buys by the project's own immutable treasury contract after 15 minutes without trades, to keep the track playing. If you mention them, call them treasury pulses; never present them as outside demand or trading activity.
When "release" is present, the video is the release: the whole track replayed from its seed to the drop at a fixed pace (release.swapsPerBar swaps per bar), release.seconds long; when release.clip is set the video is only its last release.clip.seconds (the climb into the drop) and the full track is a separate file. The whole release plays one genre and style, release.genre / release.style (where the track finished); release.chainGenres are only the genres live playback passed through while the track was built. "headline" is the post's title line; you may start with it verbatim.

Rules (hard):
- Use ONLY facts present in the JSON. Every number you write must appear in the JSON. Do not invent events, people, dates or numbers.
- No price, market cap, returns, charts or trading talk. No calls to action to buy/sell/ape. No promises, predictions or roadmap claims ("soon", "will", "next").
- Max ${MAX_LEN} characters total. Plain text, lowercase-friendly, terse, machine/terminal tone. At most 1 emoji. No hashtags except optionally #IMD.
- Output only the post text, nothing else.`;

const BANNED = [
  /\bprice\b/i, /\bmcap\b/i, /market ?cap/i, /\$\s?\d/, /\busd\b/i, /\bpump/i, /\bmoon/i, /\bape\b/i,
  /\bbuy (now|it|this|the dip|some)\b/i, /\bsoon\b/i, /\bwill\b/i, /going to/i, /\bguarantee/i, /\bprofit/i,
  /\bnfa\b/i, /\bgem\b/i, /\b\d+x\b/i, /\bwen\b/i, /\broadmap\b/i,
];

/** Numbers in the caption must be numbers present in the facts JSON. */
export function validateCaption(text: string, facts: Facts): string[] {
  const errs: string[] = [];
  if (!text.trim()) errs.push("empty");
  if ([...text].length > MAX_LEN) errs.push(`too long (${[...text].length})`);
  for (const re of BANNED) if (re.test(text)) errs.push(`banned: ${re}`);
  const allowed = new Set<string>();
  JSON.stringify(facts).replace(/\d+(\.\d+)?/g, (m) => (allowed.add(m), allowed.add(String(Number(m))), m));
  for (const n of text.match(/\d+(\.\d+)?/g) ?? []) if (!allowed.has(n) && !allowed.has(String(Number(n)))) errs.push(`unknown number ${n}`);
  return errs;
}

export function templateCaption(f: Facts): string {
  const k = f.key.start === f.key.end ? f.key.end.toLowerCase() : `${f.key.start.toLowerCase()} → ${f.key.end.toLowerCase()}`;
  const lines: string[] = [];
  if (f.kind === "teaser") {
    const span = f.window.hours >= 48 ? `${f.window.days} days` : `${f.window.hours}h`;
    lines.push(`how the ${f.pool} pool sounded: last ${span} on ${f.chain}.`);
    lines.push(`${f.swaps} swaps → ${f.swaps} mutations of a 16-step pattern. ${f.whales} whale moves, key ${k}, ${f.bpm.min}–${f.bpm.max} bpm.`);
    lines.push("every trade is a note.");
  } else if (f.kind === "track" && f.track && f.headline && f.release) {
    const r = f.release;
    lines.push(f.headline);
    lines.push(`the whole track from its seed to the drop: ${r.seconds} s, ${r.bars} bars, all in ${r.genre.toLowerCase()} / ${r.style.toLowerCase()}.`);
    lines.push(`fresh seed in ${f.track.key.toLowerCase()}, page #${f.track.page}.`);
  } else if (f.kind === "track" && f.track) {
    lines.push(`track #${f.track.no} complete.${f.track.swaps != null ? ` ${f.track.swaps} swaps filled the grid and the swarm dropped it.` : " the swarm filled the grid and dropped it."}`);
    lines.push(`fresh seed in ${f.track.key.toLowerCase()}, page #${f.track.page}. swap #${f.track.swapCount}.`);
  } else if (f.kind === "movement") {
    lines.push(`movement. a whale swap rotated the root: now ${f.key.end.toLowerCase()}, page #${f.page}.`);
    lines.push(`swap #${f.swapCount} · ${f.bpm.end} bpm.`);
  } else {
    lines.push(`state @ swap #${f.swapCount}: ${f.bpm.end} bpm, ${f.key.end.toLowerCase()}, page #${f.page}.`);
    lines.push(`last ${f.window.hours}h: ${f.swaps} swaps, ${f.whales} whales, busiest track: ${f.busiestTrack}.`);
  }
  if (f.pulses) lines.push(`${f.pulses} buys were treasury pulses: the silence kept playing.`);
  let out = lines.join("\n");
  while ([...out].length > MAX_LEN && lines.length > 1) { lines.pop(); out = lines.join("\n"); }
  return [...out].slice(0, MAX_LEN).join("");
}

export interface CaptionResult { text: string; source: "claude" | "template"; model?: string; errors?: string[] }

export async function caption(facts: Facts): Promise<CaptionResult> {
  if (!process.env.ANTHROPIC_API_KEY) return { text: templateCaption(facts), source: "template" };
  const client = new Anthropic();
  const errors: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res: any = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 2000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "low" },
        system: SYSTEM,
        messages: [
          {
            role: "user",
            content:
              `Facts JSON:\n${JSON.stringify(facts, null, 2)}` +
              (errors.length ? `\n\nYour previous draft was rejected: ${errors.join("; ")}. Fix it.` : ""),
          },
        ],
      } as any);
      if (res.stop_reason === "refusal") { errors.push("refusal"); continue; }
      const text = res.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim().replace(/^"|"$/g, "");
      const errs = validateCaption(text, facts);
      if (!errs.length) return { text, source: "claude", model: res.model };
      errors.push(...errs);
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.BadRequestError) {
        errors.push(`${(e as Error).name}: ${(e as Error).message.slice(0, 200)}`);
        break;
      }
      errors.push(`api: ${(e as Error).message.slice(0, 200)}`);
    }
  }
  return { text: templateCaption(facts), source: "template", errors };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { readFileSync } = await import("node:fs");
  const facts = JSON.parse(readFileSync(process.argv[2] ?? 0, "utf8"));
  console.log(JSON.stringify(await caption(facts), null, 2));
}
