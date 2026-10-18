// Canvas visuals: phosphor LCD grid, oscilloscope, spectrum, generated module wall.
import { arrange, bassAt, isOn, type SequencerState } from "@swarm-sequencer/synth";

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** DPR-aware canvas that tracks its CSS size. */
export class Surface {
  ctx: CanvasRenderingContext2D;
  w = 1;
  h = 1;
  dpr = 1;
  constructor(public canvas: HTMLCanvasElement, private scale = 1) {
    this.ctx = canvas.getContext("2d", { alpha: false })!;
    new ResizeObserver(() => this.fit()).observe(canvas);
    this.fit();
  }
  fit() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1) * this.scale;
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }
}

export interface Flash {
  track: number; // 0..3, 4 = bass
  step: number;
  row: boolean;
  color: "buy" | "sell" | "whale";
  at: number; // performance.now()
}

const LABELS = ["KCK", "SNR", "HAT", "GLT"];

/** Lit cells are what plays (SPEC §4.3 arrangement, brightness = velocity); dots are the raw on-chain bits. */
export function drawGrid(s: Surface, st: SequencerState, step: number, bar: number, phase: number, flashes: Flash[], now: number) {
  const { ctx, w, h } = s;
  const arr = arrange(st, bar);
  const bg = css("--lcd-bg"), on = css("--phos"), dim = css("--phos-dim"), ghost = css("--phos-ghost");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  const labelW = Math.max(30, Math.min(44, w * 0.06));
  const padT = Math.max(16, h * 0.09), padB = 8, padR = 8;
  const gw = w - labelW - padR;
  const cw = gw / 16;
  const rows = 5;
  const rh = (h - padT - padB) / (rows + 0.3);
  const gap = Math.max(1.5, Math.min(cw, rh) * 0.12);
  const font = Math.max(8, Math.min(12, rh * 0.32));
  ctx.font = `500 ${font}px "JetBrains Mono", monospace`;
  ctx.textBaseline = "middle";

  // step numbers
  for (let i = 0; i < 16; i++) {
    ctx.fillStyle = i === step ? on : i % 4 === 0 ? dim : ghost;
    ctx.textAlign = "center";
    ctx.fillText(String(i + 1).padStart(2, "0"), labelW + i * cw + cw / 2, padT * 0.5);
  }

  const flashAt = (track: number, i: number) => {
    let best: Flash | null = null;
    for (const f of flashes) if (f.track === track && (f.row || f.step === i) && (!best || f.at > best.at)) best = f;
    if (!best) return 0;
    const a = 1 - (now - best.at) / (best.row ? 900 : 650);
    return a > 0 ? a : 0;
  };

  for (let r = 0; r < rows; r++) {
    const y = padT + r * rh + (r === 4 ? rh * 0.3 : 0);
    ctx.fillStyle = dim;
    ctx.textAlign = "left";
    ctx.fillText(r === 4 ? "BAS" : LABELS[r], 4, y + rh / 2);
    for (let i = 0; i < 16; i++) {
      const x = labelW + i * cw;
      const cx = x + gap / 2, cy = y + gap / 2, ww = cw - gap, hh = rh - gap;
      const playing = i === step;
      ctx.fillStyle = ghost;
      ctx.fillRect(cx, cy, ww, hh);
      let lit = false;
      let level = 1;
      let raw = false;
      if (r < 4) {
        level = arr.vel[r][i];
        lit = level > 0;
        raw = isOn(st.pattern, r, i);
      } else {
        const d = bassAt(arr.bass, i);
        lit = d > 0;
        level = d / 15;
        raw = bassAt(st.bass, i) > 0;
      }
      if (raw && !lit) {
        const d = Math.max(2, Math.min(ww, hh) * 0.22);
        ctx.fillStyle = dim;
        ctx.fillRect(cx + ww / 2 - d / 2, cy + hh / 2 - d / 2, d, d);
      }
      if (lit) {
        ctx.fillStyle = playing ? on : dim;
        if (r === 4) {
          const bh = Math.max(2, hh * (0.25 + 0.75 * level));
          ctx.fillRect(cx, cy + hh - bh, ww, bh);
        } else {
          ctx.globalAlpha = playing ? 1 : 0.35 + 0.65 * level;
          ctx.fillRect(cx, cy, ww, hh);
          ctx.globalAlpha = 1;
        }
        if (playing) {
          ctx.globalAlpha = 0.35 * (1 - phase);
          ctx.fillStyle = on;
          ctx.fillRect(cx - 2, cy - 2, ww + 4, hh + 4);
          ctx.globalAlpha = 1;
        }
      }
      const fa = flashAt(r, i);
      if (fa > 0) {
        const f = flashes.find((x) => x.track === r && (x.row || x.step === i))!;
        ctx.globalAlpha = fa;
        ctx.strokeStyle = f.color === "whale" ? css("--amber") : f.color === "sell" ? css("--sell") : on;
        ctx.lineWidth = 2;
        ctx.strokeRect(cx + 1, cy + 1, ww - 2, hh - 2);
        if (f.row) {
          ctx.fillStyle = ctx.strokeStyle;
          ctx.globalAlpha = fa * 0.45;
          ctx.fillRect(cx, cy, ww, hh);
        }
        ctx.globalAlpha = 1;
      }
    }
  }
  // playhead
  ctx.fillStyle = on;
  ctx.fillRect(labelW + step * cw + gap / 2, h - 4, cw - gap, 2);
  // scanlines
  ctx.fillStyle = "rgba(0,0,0,0.16)";
  for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);
}

export function drawScope(s: Surface, data: Uint8Array | null) {
  const { ctx, w, h } = s;
  ctx.fillStyle = css("--lcd-bg");
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = css("--phos-ghost");
  ctx.lineWidth = 1;
  for (let i = 1; i < 8; i++) { ctx.beginPath(); ctx.moveTo((w * i) / 8, 0); ctx.lineTo((w * i) / 8, h); ctx.stroke(); }
  for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(0, (h * i) / 4); ctx.lineTo(w, (h * i) / 4); ctx.stroke(); }
  ctx.strokeStyle = css("--phos");
  ctx.lineWidth = 1.6;
  ctx.shadowColor = css("--phos");
  ctx.shadowBlur = 6;
  ctx.beginPath();
  if (!data) {
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
  } else {
    // trigger on a rising zero crossing for a stable trace
    let start = 0;
    for (let i = 1; i < data.length / 2; i++) if (data[i - 1] < 128 && data[i] >= 128) { start = i; break; }
    const n = Math.min(data.length - start, 1024);
    // auto-gain (max 6x) so quiet idle stages still read on the scope
    let peak = 0;
    for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(data[start + i] - 128));
    const gain = Math.min(6, 0.85 / Math.max(peak / 128, 0.02));
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * w;
      const y = h / 2 - ((data[start + i] - 128) / 128) * gain * (h * 0.46);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
  }
  ctx.stroke();
  ctx.shadowBlur = 0;
}

const BANDS = 24;
const peaks = new Float32Array(BANDS);
export function drawSpectrum(s: Surface, data: Uint8Array | null, sampleRate: number) {
  const { ctx, w, h } = s;
  ctx.fillStyle = css("--lcd-bg");
  ctx.fillRect(0, 0, w, h);
  const bw = w / BANDS;
  const seg = 12;
  const sh = h / seg;
  const on = css("--phos"), ghost = css("--phos-ghost"), amber = css("--amber");
  for (let b = 0; b < BANDS; b++) {
    let v = 0;
    if (data) {
      const f0 = 40 * Math.pow(16000 / 40, b / BANDS), f1 = 40 * Math.pow(16000 / 40, (b + 1) / BANDS);
      const i0 = Math.floor((f0 / (sampleRate / 2)) * data.length), i1 = Math.max(i0 + 1, Math.floor((f1 / (sampleRate / 2)) * data.length));
      let m = 0;
      for (let i = i0; i < i1 && i < data.length; i++) m = Math.max(m, data[i]);
      v = m / 255;
    }
    peaks[b] = Math.max(v, peaks[b] - 0.012);
    const lit = Math.round(v * seg);
    const pk = Math.min(seg - 1, Math.round(peaks[b] * seg));
    for (let k = 0; k < seg; k++) {
      ctx.fillStyle = k < lit ? (k >= seg - 2 ? amber : on) : k === pk && peaks[b] > 0.02 ? on : ghost;
      ctx.fillRect(b * bw + 1.5, h - (k + 1) * sh + 1.5, bw - 3, sh - 3);
    }
  }
}

