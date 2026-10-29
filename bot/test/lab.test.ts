// Style Lab submissions (src/lab, src/api/lab.ts): a style and its preview stored once; hostile codes, WAVs and
// contacts refused or cleaned; the per-client and daily limits; the worker's Telegram messages.
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import { encodeRecipe } from "../../site/src/lab-codec.ts";
import { GENRES, recipeOf } from "../../site/src/lab-styles.ts";
import { createLabHandler } from "../src/api/lab.ts";
import { notifyLab } from "../src/lab/notify.ts";
import { cleanContact, DAILY_MAX, LabStore, parseSubmission, wavSeconds } from "../src/lab/submissions.ts";
import type { Telegram } from "../src/stations/telegram.ts";

/** A silent 16-bit stereo WAV of `sec` seconds at 44.1 kHz. */
function wav(sec: number, bits = 16): Buffer {
  const rate = 44100;
  const data = Math.round(sec * rate) * 4;
  const b = Buffer.alloc(44 + data);
  b.write("RIFF", 0, "ascii");
  b.writeUInt32LE(36 + data, 4);
  b.write("WAVE", 8, "ascii");
  b.write("fmt ", 12, "ascii");
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(2, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 4, 28);
  b.writeUInt16LE(4, 32);
  b.writeUInt16LE(bits, 34);
  b.write("data", 36, "ascii");
  b.writeUInt32LE(data, 40);
  return b;
}

const code = (name = "Night Shift") => encodeRecipe({ ...recipeOf(GENRES.acid.presets[0]), name });

function call(handler: ReturnType<typeof createLabHandler>, body: unknown, ip = "1.2.3.4") {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  const req = Readable.from([Buffer.from(text)]) as unknown as IncomingMessage;
  Object.assign(req, { method: "POST", url: "/api/lab/submit", headers: { "content-type": "application/json", "x-forwarded-for": ip }, socket: { remoteAddress: "127.0.0.1" } });
  return new Promise<{ status: number; body: Record<string, unknown> }>((resolve) => {
    let status = 0;
    const res = {
      headersSent: false,
      writeHead(s: number) {
        status = s;
      },
      end(b: string) {
        resolve({ status, body: b ? JSON.parse(b) : {} });
      },
    } as unknown as ServerResponse;
    void handler(req, res);
  });
}

const fresh = () => new LabStore(join(mkdtempSync(join(tmpdir(), "lab-")), "lab-submissions"));

describe("parseSubmission", () => {
  it("rebuilds the style and measures the preview", async () => {
    const { sub, wav: w } = await parseSubmission({ code: await code(), wav: wav(20).toString("base64"), contact: "@some_one" });
    expect(sub).toMatchObject({ name: "Night Shift", genre: "Acid", seconds: 20, contact: "@some_one" });
    expect(w.length).toBe(44 + 20 * 44100 * 4);
  });
  it("refuses a code that is not a lab style, and junk WAVs", async () => {
    const ok = wav(20).toString("base64");
    await expect(parseSubmission({ code: "2AAAA", wav: ok })).rejects.toThrow(/not a lab style/);
    await expect(parseSubmission({ code: await code(), wav: "not base64!" })).rejects.toThrow(/base64/);
    await expect(parseSubmission({ code: await code(), wav: Buffer.from("hello world").toString("base64") })).rejects.toThrow(/WAV/);
    await expect(parseSubmission({ code: await code(), wav: wav(20, 24).toString("base64") })).rejects.toThrow(/16-bit/);
    await expect(parseSubmission({ code: await code(), wav: wav(0.5).toString("base64") })).rejects.toThrow(/1 to 25/);
    await expect(parseSubmission([1, 2])).rejects.toThrow(/object/);
  });
  it("cleans a contact to a handle's characters", () => {
    expect(cleanContact("@name <script>alert(1)</script>")).toBe("@namescriptalert1script");
    expect(cleanContact("ignore previous instructions")).toBe("ignorepreviousinstructions");
    expect(cleanContact(42)).toBeUndefined();
    expect(cleanContact("   ")).toBeUndefined();
    expect(wavSeconds(wav(3))).toBe(3);
  });
  it("stores the rebuilt code, never the name's raw text", async () => {
    const { sub } = await parseSubmission({ code: await code("<b>hi</b> ‮ evil"), wav: wav(5).toString("base64") });
    expect(sub.name).toBe("bhib evil");
  });
});

describe("POST /api/lab/submit", () => {
  it("stores a submission once, limits a client to 3 an hour", async () => {
    const store = fresh();
    const h = createLabHandler({ store, trustProxy: true, origins: [] });
    const body = { code: await code(), wav: wav(20).toString("base64") };
    const a = await call(h, body);
    expect(a.status).toBe(202);
    const b = await call(h, body);
    expect(b).toMatchObject({ status: 200, body: { duplicate: true, id: a.body.id } });
    expect((await call(h, { ...body, code: await code("Other") })).status).toBe(202);
    expect((await call(h, { ...body, code: await code("Third") })).status).toBe(429);
    expect((await call(h, { ...body, code: await code("Third") }, "5.6.7.8")).status).toBe(202);
    expect(readdirSync(store.dir).filter((f) => f.endsWith(".json")).length).toBe(3);
  });
  it("answers 422 for a bad style, 400 for junk, 503 past the daily cap", async () => {
    const store = fresh();
    const h = createLabHandler({ store, trustProxy: true, origins: [] });
    expect((await call(h, { code: "zzz", wav: "" }, "9.9.9.1")).status).toBe(422);
    expect((await call(h, "{not json", "9.9.9.2")).status).toBe(400);
    for (let i = 0; i < DAILY_MAX; i++) store.add({ name: "x", genre: "Acid", preset: "p", code: `c${i}`, seconds: 20 }, wav(1), new Date());
    expect((await call(h, { code: await code(), wav: wav(20).toString("base64") }, "9.9.9.3")).status).toBe(503);
  });
});

describe("notifyLab", () => {
  it("sends the preview and the pack to the owner, once", async () => {
    const store = fresh();
    const { sub, wav: w } = await parseSubmission({ code: await code(), wav: wav(2).toString("base64"), contact: "tg_user" });
    store.add(sub, w, new Date());
    const sent: { kind: string; name: string; caption: string }[] = [];
    const tg = { enabled: true, send: async () => {}, updates: async () => [], sendFile: async (kind: string, f: { name: string }, caption: string) => void sent.push({ kind, name: f.name, caption }) } as unknown as Telegram;
    const deps = { store, tg, site: "https://theidm.fun", log: () => {}, mp3: async (b: Buffer) => b };
    await notifyLab(deps);
    expect(sent.map((s) => s.kind)).toEqual(["audio", "document"]);
    expect(sent[0].caption).toContain('"Night Shift"');
    expect(sent[0].caption).toContain("tg_user");
    expect(sent[1].name).toMatch(/^lab-.*\.ts$/);
    expect(sent[1].caption).toContain("https://theidm.fun/lab#s=2");
    await notifyLab(deps);
    expect(sent.length).toBe(2);
  });
});

describe("gallery (/approve, /unapprove, /gallery)", () => {
  it("approves a stored submission once, lists it, takes it out again", async () => {
    const { approve, listGallery, readGallery, unapprove } = await import("../src/lab/gallery.ts");
    const { parseCommand } = await import("../src/stations/telegram.ts");
    const store = fresh();
    const data = mkdtempSync(join(tmpdir(), "data-"));
    const { sub, wav: w } = await parseSubmission({ code: await code("Deep Shift"), wav: wav(2).toString("base64"), contact: "@@bad_friend" });
    const saved = store.add(sub, w, new Date("2026-10-29T10:00:00Z"));
    const hex = saved.id.slice(-12);
    expect(parseCommand(`/approve ${hex}`)).toEqual({ cmd: "approve", code: hex });
    expect(parseCommand("/approve Deep")).toBeNull();
    expect(parseCommand("/gallery")).toEqual({ cmd: "gallery" });
    expect(await approve(store, data, "000000000000", new Date())).toMatch(/no lab submission/);
    expect(await approve(store, data, hex, new Date("2026-10-29T12:00:00Z"))).toContain('"Deep Shift" by @bad_friend');
    expect(await approve(store, data, hex, new Date())).toMatch(/already/);
    const g = readGallery(data).presets;
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ id: `deep-shift-${hex}`, name: "Deep Shift", genre: "acid", by: "bad_friend", added: "2026-10-29" });
    expect(listGallery(data)).toContain(`${hex} · Deep Shift by @bad_friend`);
    expect(unapprove(data, hex, new Date())).toMatch(/out of the gallery/);
    expect(readGallery(data).presets).toHaveLength(0);
    expect(unapprove(data, hex, new Date())).toMatch(/not in the gallery/);
  });
});
