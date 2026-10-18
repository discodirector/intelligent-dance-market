// The page background: a flat, full-viewport 1-bit Bayer-dithered field.
// Layered ridges drift across it: their profile is the bass line when idle, the spectrum when playing.
// The waveform runs through the middle; kicks, clicks and track drops send rings across the whole field.
// Fixed to the viewport; pointer input comes from the whole window and is purely visual.
import { bassAt, isOn, type SequencerState } from "@swarm-sequencer/synth";

export interface SkyAudio {
  running: boolean;
  timeData: Uint8Array;
  freqData: Uint8Array;
  ctx: { sampleRate: number } | null;
}

const BANDS = 32;
const LAYERS = 4;
const MAX_RINGS = 12;
const RING_LIFE = 3;
const RING_SPEED = 0.45; // field heights per second
const BAYER = new Float32Array([0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16));

export interface SkyOptions {
  ink: number[];
  bone: number[];
  /** CSS px per dither cell (minimum) and the most cells across. */
  cell?: number;
  maxCells?: number;
}

export class WaveSky {
  private ctx: CanvasRenderingContext2D;
  private img!: ImageData;
  private px!: Uint32Array;
  private ink: number;
  private bone: number;
  private W = 0;
  private H = 0;
  private cell: number;
  private maxCells: number;
  private steps = new Float32Array(16);
  private bands = new Float32Array(BANDS);
  private prof!: Float32Array; // per layer x column ridge height 0..1
  private wave!: Float32Array; // waveform per column
  // rings: x, y (cells), birth (s), strength; birth -1 = free
  private rings = new Float32Array(MAX_RINGS * 4).fill(-1);
  private lowAvg = 0;
  private lastKick = -1;
  private glow = { x: 0, y: 0, amp: 0, target: 0, tx: 0, ty: 0 };
  private mix = 0;
  private t = 0;
  private last = -1;
  private reduced = false;

  constructor(private canvas: HTMLCanvasElement, opts: SkyOptions) {
    this.ctx = canvas.getContext("2d")!;
    this.cell = opts.cell ?? 5;
    this.maxCells = opts.maxCells ?? 360;
    const le = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
    const pack = (c: number[]) => (le ? (255 << 24) | (c[2] << 16) | (c[1] << 8) | c[0] : (c[0] << 24) | (c[1] << 16) | (c[2] << 8) | 255) >>> 0;
    this.ink = pack(opts.ink);
    this.bone = pack(opts.bone);
    this.fit();
    window.addEventListener("resize", () => this.fit());
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (mq) {
      this.reduced = mq.matches;
      mq.addEventListener?.("change", (e) => (this.reduced = e.matches));
    }
    window.addEventListener("pointerdown", (e) => {
      const [x, y] = this.toCell(e);
      this.ring(x, y, 1);
    });
    window.addEventListener("pointermove", (e) => {
      const [x, y] = this.toCell(e);
      const g = this.glow;
      if (g.target === 0) { g.x = x; g.y = y; }
      g.tx = x;
      g.ty = y;
      g.target = e.pointerType === "mouse" ? 1 : 0;
    });
    document.documentElement.addEventListener("pointerleave", () => (this.glow.target = 0));
  }

  /** Match the viewport: one dither cell is at least `cell` CSS px, at most `maxCells` across. */
  private fit() {
    const c = Math.max(this.cell, Math.ceil(window.innerWidth / this.maxCells));
    const W = Math.max(16, Math.ceil(window.innerWidth / c)), H = Math.max(16, Math.ceil(window.innerHeight / c));
    if (W === this.W && H === this.H) return;
    // keep live rings where they were on screen
    for (let i = 0; i < MAX_RINGS; i++) {
      if (this.rings[i * 4 + 2] < 0 || !this.W) continue;
      this.rings[i * 4] *= W / this.W;
      this.rings[i * 4 + 1] *= H / this.H;
    }
    this.W = W;
    this.H = H;
    this.canvas.width = W;
    this.canvas.height = H;
    this.img = this.ctx.createImageData(W, H);
    this.px = new Uint32Array(this.img.data.buffer);
    this.prof = new Float32Array(LAYERS * W);
    this.wave = new Float32Array(W);
  }

  private toCell(e: PointerEvent): [number, number] {
    return [(e.clientX / Math.max(1, window.innerWidth)) * this.W, (e.clientY / Math.max(1, window.innerHeight)) * this.H];
  }

  private ring(x: number, y: number, strength: number) {
    let slot = 0, oldest = Infinity;
    for (let i = 0; i < MAX_RINGS; i++) {
      const b = this.rings[i * 4 + 2];
      if (b < 0) { slot = i; break; }
      if (b < oldest) { oldest = b; slot = i; }
    }
    this.rings.set([x, y, this.t, strength], slot * 4);
  }

  /** v2 track drop: a burst of rings from the centre and the corners of the field. */
  drop() {
    const { W, H } = this;
    this.ring(W / 2, H / 2, 1.4);
    this.ring(W * 0.2, H * 0.3, 1);
    this.ring(W * 0.8, H * 0.7, 1);
    this.rings.set([W / 2, H / 2, this.t + 0.25, 1.2], this.freeSlot() * 4);
  }

  private freeSlot(): number {
    for (let i = 0; i < MAX_RINGS; i++) if (this.rings[i * 4 + 2] < 0) return i;
    return 0;
  }

  update(dt: number, st: SequencerState, audio: SkyAudio) {
    dt = Math.min(0.1, Math.max(0, dt));
    this.t += dt;
    const { W, H } = this;
    const live = audio.running;
    this.mix += ((live ? 1 : 0) - this.mix) * Math.min(1, dt * 2);
    for (let i = 0; i < 16; i++) this.steps[i] = bassAt(st.bass, i) / 15 + (isOn(st.pattern, 0, i) ? 0.25 : 0) + (isOn(st.pattern, 1, i) ? 0.12 : 0);

    if (live) {
      const fd = audio.freqData, nyq = (audio.ctx?.sampleRate ?? 44100) / 2;
      for (let b = 0; b < BANDS; b++) {
        const f0 = 40 * Math.pow(16000 / 40, b / BANDS), f1 = 40 * Math.pow(16000 / 40, (b + 1) / BANDS);
        const i0 = Math.floor((f0 / nyq) * fd.length), i1 = Math.max(i0 + 1, Math.floor((f1 / nyq) * fd.length));
        let m = 0;
        for (let i = i0; i < i1 && i < fd.length; i++) if (fd[i] > m) m = fd[i];
        const v = (m / 255) * (1.25 - (b / BANDS) * 0.6);
        this.bands[b] += (v - this.bands[b]) * Math.min(1, dt * 12);
      }
      // kick: low-band flux against a slow average -> a soft ring from the centre
      const low = (this.bands[0] + this.bands[1] + this.bands[2]) / 3;
      if (low - this.lowAvg > 0.12 && this.t - this.lastKick > 0.22) {
        this.lastKick = this.t;
        this.ring(W / 2, H / 2, 0.45);
      }
      this.lowAvg += (low - this.lowAvg) * Math.min(1, dt * 4);
      const td = audio.timeData, n = td.length;
      let peak = 0;
      for (let i = 0; i < n; i += 4) { const a = Math.abs(td[i] - 128); if (a > peak) peak = a; }
      const gain = Math.min(1, (peak / 128) * 14) / Math.max(4, peak);
      let start = 0;
      for (let i = 1; i < n / 2; i++) if (td[i - 1] < 128 && td[i] >= 128) { start = i; break; }
      for (let x = 0; x < W; x++) {
        const v = (td[start + Math.floor((x / W) * (n / 2))] - 128) * gain;
        this.wave[x] += (v - this.wave[x]) * 0.6;
      }
    } else {
      for (let b = 0; b < BANDS; b++) this.bands[b] *= Math.max(0, 1 - dt * 2);
      for (let x = 0; x < W; x++) this.wave[x] *= Math.max(0, 1 - dt * 3);
    }

    // ridge profiles: each layer reads the bass line (idle) or the mirrored spectrum (playing) at its own drift
    const drift = this.reduced ? 0 : this.t;
    for (let l = 0; l < LAYERS; l++) {
      const speed = 0.25 + l * 0.22, scale = 0.6 + l * 0.35;
      for (let x = 0; x < W; x++) {
        const u = (x / W) * 16 * scale + drift * speed + l * 5.3;
        const i0 = Math.floor(u), f = u - i0, s = f * f * (3 - 2 * f);
        const idle = this.steps[i0 & 15] * (1 - s) + this.steps[(i0 + 1) & 15] * s;
        const bx = Math.abs(((x / W + drift * 0.01 * (l + 1)) % 1) - 0.5) * 2 * (BANDS - 1);
        const b0 = Math.min(BANDS - 2, Math.floor(bx)), bf = bx - b0;
        const spec = this.bands[b0] * (1 - bf) + this.bands[b0 + 1] * bf;
        this.prof[l * W + x] = idle * (1 - this.mix) + spec * this.mix;
      }
    }
    const g = this.glow, k = Math.min(1, dt * 8);
    g.x += (g.tx - g.x) * k;
    g.y += (g.ty - g.y) * k;
    g.amp += (g.target - g.amp) * Math.min(1, dt * 4);
  }

  draw() {
    const { W, H, px, prof, wave, rings, glow } = this;
    const t = this.t, mix = this.mix;
    const unit = Math.min(W, H);
    const ringAmp = this.reduced ? 0.35 : 0.75;
    let nr = 0;
    for (let i = 0; i < MAX_RINGS; i++) {
      const born = rings[i * 4 + 2];
      if (born >= 0 && t - born > RING_LIFE) rings[i * 4 + 2] = -1;
      else if (born >= 0) nr++;
    }
    const mid = H * 0.5, waveAmp = H * 0.22 * mix;
    const glowR2 = (unit * 0.16) ** 2;
    for (let y = 0; y < H; y++) {
      const yn = y / H, o = y * W;
      for (let x = 0; x < W; x++) {
        // layered ridges: each glows below its crest and fades downward, like hills against a night sky
        let v = 0.04 + 0.05 * yn;
        for (let l = 0; l < LAYERS; l++) {
          const crest = (l + 0.75) / (LAYERS + 0.5) - prof[l * W + x] * 0.16;
          const d = yn - crest;
          if (d > 0) v += Math.exp(-d * (7 + l * 3)) * (0.24 + l * 0.04);
          else if (d > -0.012) v += 0.4; // the crest line itself
        }
        // the waveform through the middle, with a soft halo when playing
        if (mix > 0.02) {
          const dw = Math.abs(y - (mid - wave[x] * waveAmp));
          if (dw < 1) v += 0.55 * mix;
          else v += Math.exp(-dw * 0.35) * 0.18 * mix;
        }
        if (glow.amp > 0.01) {
          const dx = x - glow.x, dy = y - glow.y, r2 = (dx * dx + dy * dy) / glowR2;
          if (r2 < 4) v += Math.exp(-r2 * 1.5) * 0.25 * glow.amp;
        }
        if (nr) {
          for (let i = 0; i < MAX_RINGS; i++) {
            const born = rings[i * 4 + 2];
            if (born < 0 || born > t) continue;
            const a = t - born, dx = x - rings[i * 4], dy = y - rings[i * 4 + 1];
            const dist = Math.sqrt(dx * dx + dy * dy) / unit, d = dist - a * RING_SPEED;
            if (d > 0.16 || d < -0.4) continue;
            const life = 1 - a / RING_LIFE;
            v += (0.35 + 0.65 * Math.cos(d * 34)) * Math.exp(-d * d * 70) * life * ringAmp * rings[i * 4 + 3];
          }
        }
        px[o + x] = v > BAYER[(y & 3) * 4 + (x & 3)] ? this.bone : this.ink;
      }
    }
    this.ctx.putImageData(this.img, 0, 0);
  }

  frame(nowMs: number, st: SequencerState, audio: SkyAudio) {
    const dt = this.last < 0 ? 0 : (nowMs - this.last) / 1000;
    this.last = nowMs;
    this.update(dt, st, audio);
    this.draw();
  }
}
