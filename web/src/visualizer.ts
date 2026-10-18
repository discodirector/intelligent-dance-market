import { arrange, bassAt, bassLabel, epochOf, eraOf, infoLine, type Arrangement, type SequencerState } from "@swarm-sequencer/synth";

const LABELS = ["KICK", "SNARE", "HAT", "GLITCH", "BASS"];
const SHORT = ["K", "S", "H", "G", "B"];
const COLOR = ["#e0a15a", "#d9d4c4", "#7dcea0", "#d37a68", "#8fb4c9"];

interface Flash {
  track: number;
  step: number;
  born: number;
  row?: boolean;
}

interface Layout {
  pad: number;
  labelCol: number;
  top: number;
  gap: number;
  groupExtra: number;
  cellW: number;
  cellH: number;
  infoH: number;
}

/**
 * 4×16 drum grid plus a bass row. The playhead is the running step.
 * Mutation flashes are timed by the same clock the caller draws with.
 */
export class Visualizer {
  private state: SequencerState | null = null;
  private step = 0;
  private phase = 0;
  private flashes: Flash[] = [];
  private epochSeen = -1;
  private epochAt = 0;

  private arr: Arrangement | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly showInfo: boolean,
  ) {}

  /** `bar` picks the phrase position of the arrangement (SPEC §4.3); cells show what plays. */
  setFrame(state: SequencerState, step: number, phase: number, bar = 0) {
    this.state = state;
    this.arr = arrange(state, bar);
    this.step = step;
    this.phase = phase;
  }

  flash(track: number, step: number, nowMs: number) {
    this.flashes.push({ track, step, born: nowMs });
  }

  /** Light a whole drum row. Used for whale drops. */
  flashRow(track: number, nowMs: number) {
    this.flashes.push({ track, step: 0, born: nowMs, row: true });
  }

  /** Replace flashes with the ones still visible at `nowMs`. Used by the headless renderer. */
  setFlashes(flashes: Flash[]) {
    this.flashes = flashes;
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  draw(nowMs: number) {
    const ctx = this.canvas.getContext("2d");
    if (!ctx || !this.state) return;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const layout = this.layout(w, h);
    this.flashes = this.flashes.filter((flash) => nowMs - flash.born < (flash.row ? 760 : 480));

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#080907";
    ctx.fillRect(0, 0, w, h);
    this.screws(ctx, w, h);
    this.header(ctx, layout, w);

    const playX = this.xOf(this.step, layout);
    const colH = layout.cellH * 5 + layout.gap * 4;
    ctx.fillStyle = "rgba(224,161,90,0.09)";
    ctx.fillRect(playX - 2, layout.top, layout.cellW + 4, colH);

    for (let row = 0; row < 5; row++) {
      this.label(ctx, layout, row);
      for (let step = 0; step < 16; step++) {
        this.cell(ctx, layout, row, step, nowMs);
      }
    }

    ctx.fillStyle = "rgba(224,161,90,0.95)";
    ctx.fillRect(playX + this.phase * layout.cellW, layout.top, Math.max(2, w * 0.0016), colH);

    if (this.showInfo) {
      const epoch = epochOf(this.state);
      if (epoch !== this.epochSeen) {
        this.epochSeen = epoch;
        this.epochAt = nowMs;
      }
      const era = eraOf(epoch);
      const hot = nowMs - this.epochAt < 700;
      const font = `500 ${Math.max(14, Math.round(layout.infoH * 0.28))}px "IBM Plex Mono", ui-monospace, monospace`;
      ctx.font = font;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#c8d2b8";
      ctx.fillText(infoLine(this.state), layout.pad, h - layout.pad * 0.45 - layout.infoH * 0.68);
      ctx.fillStyle = hot ? "#fff6e8" : "#e0a15a";
      ctx.fillText(`EPOCH #${epoch} · ${era.name}`, layout.pad, h - layout.pad * 0.45 - layout.infoH * 0.28);
    }
  }

  private layout(w: number, h: number): Layout {
    const pad = Math.max(18, Math.round(Math.min(w, h) * 0.05));
    const infoH = this.showInfo ? Math.max(64, Math.round(h * 0.13)) : Math.round(pad * 0.4);
    const labelCol = Math.max(58, Math.round(w * 0.105));
    const top = pad + Math.round(Math.min(w, h) * 0.055);
    const gap = Math.max(3, Math.round(Math.min(w, h) * 0.0065));
    const groupExtra = gap * 1.7;
    const innerW = w - pad * 2 - labelCol;
    const innerH = h - top - pad - infoH;
    const cellW = (innerW - gap * 15 - groupExtra * 3) / 16;
    const cellH = (innerH - gap * 4) / 5;
    return { pad, labelCol, top, gap, groupExtra, cellW, cellH, infoH };
  }

  private xOf(step: number, layout: Layout): number {
    return (
      layout.pad +
      layout.labelCol +
      step * (layout.cellW + layout.gap) +
      Math.floor(step / 4) * layout.groupExtra
    );
  }

  private screws(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const r = Math.max(3, Math.round(Math.min(w, h) * 0.006));
    const inset = r * 3.2;
    const points = [
      [inset, inset],
      [w - inset, inset],
      [inset, h - inset],
      [w - inset, h - inset],
    ];
    for (const [x, y] of points) {
      ctx.beginPath();
      ctx.fillStyle = "#1a1f18";
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#3a4334";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x - r * 0.6, y);
      ctx.lineTo(x + r * 0.6, y);
      ctx.stroke();
    }
  }

  private header(ctx: CanvasRenderingContext2D, layout: Layout, w: number) {
    ctx.fillStyle = "#6d7764";
    ctx.font = `500 ${Math.max(11, Math.round(layout.cellH * 0.28))}px "IBM Plex Mono", ui-monospace, monospace`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("IDM", layout.pad, layout.top - layout.cellH * 0.38);
    ctx.textAlign = "right";
    ctx.fillText("IDM/IMD", w - layout.pad, layout.top - layout.cellH * 0.38);
    ctx.textAlign = "center";
    ctx.fillStyle = "#3d4638";
    for (const beat of [0, 4, 8, 12]) {
      const x = this.xOf(beat, layout) + layout.cellW * 0.15;
      ctx.fillText(String(beat / 4 + 1), x, layout.top - layout.cellH * 0.38);
    }
  }

  private label(ctx: CanvasRenderingContext2D, layout: Layout, row: number) {
    const y = layout.top + row * (layout.cellH + layout.gap) + layout.cellH / 2;
    const narrow = layout.cellH < 36;
    ctx.fillStyle = COLOR[row];
    ctx.globalAlpha = 0.85;
    ctx.font = `500 ${Math.max(11, Math.round(layout.cellH * (narrow ? 0.34 : 0.26)))}px "IBM Plex Mono", ui-monospace, monospace`;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(narrow ? SHORT[row] : LABELS[row], layout.pad + layout.labelCol - layout.gap * 2, y);
    ctx.globalAlpha = 1;
  }

  private cell(ctx: CanvasRenderingContext2D, layout: Layout, row: number, step: number, nowMs: number) {
    const state = this.state;
    if (!state) return;
    const x = this.xOf(step, layout);
    const y = layout.top + row * (layout.cellH + layout.gap);
    const arr = this.arr ?? arrange(state);
    const level = row < 4 ? arr.vel[row][step] : bassAt(arr.bass, step) > 0 ? 1 : 0;
    const on = level > 0;
    const flash = this.flashes.find((item) => item.track === row && (item.row || item.step === step));
    const life = flash?.row ? 700 : 420;
    const age = flash ? Math.max(0, 1 - (nowMs - flash.born) / life) : 0;

    ctx.beginPath();
    ctx.rect(x, y, layout.cellW, layout.cellH);
    if (on) {
      ctx.fillStyle = COLOR[row];
      ctx.globalAlpha = 0.4 + 0.6 * level;
      ctx.fill();
      ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = "#10140f";
      ctx.fill();
      ctx.strokeStyle = "#2a3226";
      ctx.lineWidth = Math.max(1, layout.cellW * 0.02);
      ctx.stroke();
    }
    if (age > 0) {
      ctx.fillStyle = `rgba(244,241,228,${0.82 * age})`;
      ctx.fillRect(x - 1, y - 1, layout.cellW + 2, layout.cellH + 2);
    }
    if (row === 4) {
      const deg = bassAt(arr.bass, step);
      ctx.fillStyle = on ? "#142028" : "#3d4638";
      ctx.font = `500 ${Math.max(10, Math.round(layout.cellH * 0.34))}px "IBM Plex Mono", ui-monospace, monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(bassLabel(state.root, state.mode, deg), x + layout.cellW / 2, y + layout.cellH / 2 + 1);
    }
  }
}
