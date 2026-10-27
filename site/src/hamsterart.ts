// The hamster and its wheel for the wheel screen (wheelscreen.ts): flat shapes, our own drawing, drawn at one pixel
// per dot and shown on the LCD's dot matrix (drawHamsterLCD) in the station's phosphor, like every other screen.
// Three poses: running (a gallop cycle: the legs swing in pairs, the body bobs, the ears and tail follow), sitting
// (awake, still: it breathes and blinks) and asleep (curled up at the bottom of the wheel, breathing, z's rising).
// Everything is a function of the time and the gait phase, so the speed of the wheel and of the legs follow the rpm.

export type HamsterPose = "run" | "sit" | "sleep";

export interface HamsterFrame {
  /** Wheel rotation, radians. */
  angle: number;
  /** Gait phase, radians (one stride per 2 pi). */
  gait: number;
  pose: HamsterPose;
  /** Seconds, for breathing, blinking and z's. */
  t: number;
}

type Palette = { fur: string; furDark: string; belly: string; pink: string; pinkDark: string; eye: string; wheel: string; wheelDark: string; glassIn: string };

/**
 * The LCD's three levels as plain colours for the offscreen drawing (drawHamsterLCD reads them back per dot): red =
 * a lit dot, green = a dim one, blue (the eye) and nothing = an unlit cell.
 */
const CODES: Palette = {
  fur: "#ff0000",
  furDark: "#ff0000",
  belly: "#00ff00",
  pink: "#00ff00",
  pinkDark: "#00ff00",
  eye: "#0000ff",
  wheel: "#00ff00",
  wheelDark: "#00ff00",
  glassIn: "rgba(0,0,0,0)",
};
let PAL: Palette = CODES;

export function drawHamsterWheel(ctx: CanvasRenderingContext2D, w: number, h: number, f: HamsterFrame, bg: string) {
  ctx.save();
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  const r = Math.min(w, h * 0.92) * 0.4;
  const cx = w / 2;
  const cy = h * 0.46;
  const lw = Math.max(1.1, r * 0.045);

  // stand: a leg from the hub to the base, the base line
  const baseY = cy + r * 1.18;
  ctx.lineCap = "round";
  ctx.strokeStyle = PAL.wheelDark;
  ctx.lineWidth = lw * 1.6;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + r * 0.62, baseY);
  ctx.moveTo(cx - r * 0.95, baseY);
  ctx.lineTo(cx + r * 0.95, baseY);
  ctx.stroke();

  // the wheel's inside, a little darker than the glass
  ctx.fillStyle = PAL.glassIn;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  // the floor of the wheel: rungs on the rim, turning with it
  ctx.strokeStyle = PAL.wheelDark;
  ctx.lineWidth = lw * 0.7;
  const rungs = 16;
  for (let i = 0; i < rungs; i++) {
    const a = f.angle + (i / rungs) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r * 0.93, cy + Math.sin(a) * r * 0.93);
    ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    ctx.stroke();
  }

  // spokes behind the hamster
  ctx.strokeStyle = PAL.wheel;
  ctx.lineWidth = lw;
  for (let i = 0; i < 4; i++) {
    const a = f.angle + (i / 4) * Math.PI * 2 + Math.PI / 4;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    ctx.stroke();
  }

  // the hamster stands on the rim's bottom
  const floorY = cy + r * 0.93;
  const s = r / 68; // drawing units: the wheel's radius is 68 (the hamster fills the wheel's lower half)
  if (f.pose === "sleep") drawSleeping(ctx, cx - 2 * s, floorY, s, f.t);
  else drawHamster(ctx, cx - 4 * s, floorY - 2 * s, s, f);

  // rim and hub in front
  ctx.strokeStyle = PAL.wheel;
  ctx.lineWidth = lw * 1.4;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = PAL.wheel;
  ctx.beginPath();
  ctx.arc(cx, cy, lw * 1.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** One leg: from the hip/shoulder (x, y), swinging by `swing` radians, a little foot at the end. */
function leg(ctx: CanvasRenderingContext2D, x: number, y: number, len: number, swing: number, lift: number, s: number, front: boolean) {
  const fx = x + Math.sin(swing) * len;
  const fy = y + Math.cos(swing) * len - lift;
  ctx.strokeStyle = front ? PAL.furDark : PAL.furDark;
  ctx.lineWidth = 7.5 * s;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(fx, fy);
  ctx.stroke();
  ctx.fillStyle = PAL.pink;
  ctx.beginPath();
  ctx.ellipse(fx + 2.2 * s, fy + 1.2 * s, 4.2 * s, 2.3 * s, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawHamster(ctx: CanvasRenderingContext2D, x0: number, floor: number, s: number, f: HamsterFrame) {
  const run = f.pose === "run";
  const g = f.gait;
  // gallop: the body rises twice per stride and pitches a little
  const bob = run ? Math.abs(Math.sin(g)) * 3.2 * s : Math.sin(f.t * 2.4) * 0.7 * s;
  const pitch = run ? Math.sin(g) * 0.05 : 0;
  const stretch = run ? 1 + Math.sin(g + 0.6) * 0.035 : 1 + Math.sin(f.t * 2.4) * 0.012;
  const legLen = 15 * s;
  const hipY = floor - legLen - bob + 1 * s;

  ctx.save();
  ctx.translate(x0, hipY);
  ctx.rotate(pitch);

  // back legs (far side first, darker), then near side after the body
  const backX = -24 * s, frontX = 20 * s;
  const sw = (ph: number) => (run ? Math.sin(g + ph) * 0.75 : 0.12);
  const lf = (ph: number) => (run ? Math.max(0, Math.sin(g + ph + Math.PI / 2)) * 5 * s : 0);
  ctx.globalAlpha = 0.75;
  leg(ctx, backX + 4 * s, 0, legLen, sw(Math.PI * 0.9), lf(Math.PI * 0.9), s, false);
  leg(ctx, frontX + 3 * s, 0, legLen * 0.9, sw(0.35), lf(0.35), s, true);
  ctx.globalAlpha = 1;

  // tail
  ctx.fillStyle = PAL.furDark;
  ctx.beginPath();
  ctx.ellipse(-40 * s * stretch, -14 * s, 5 * s, 3 * s, -0.5 + (run ? Math.sin(g * 2) * 0.3 : 0), 0, Math.PI * 2);
  ctx.fill();

  // body: a long rounded loaf, the head at the front; a dark rim around it keeps it apart from the spokes
  ctx.fillStyle = PAL.fur;
  ctx.strokeStyle = PAL.eye;
  ctx.lineWidth = 5 * s;
  ctx.beginPath();
  ctx.moveTo(-38 * s * stretch, -8 * s);
  ctx.bezierCurveTo(-44 * s * stretch, -38 * s, -14 * s, -46 * s, 10 * s, -40 * s);
  ctx.bezierCurveTo(26 * s, -37 * s, 34 * s, -34 * s, 41 * s, -24 * s);
  ctx.bezierCurveTo(49 * s, -17 * s, 50 * s, -10 * s, 45 * s, -5 * s);
  ctx.bezierCurveTo(38 * s, 1 * s, 24 * s, 3 * s, 10 * s, 3 * s);
  ctx.bezierCurveTo(-12 * s, 5 * s, -34 * s, 5 * s, -38 * s * stretch, -8 * s);
  ctx.stroke();
  ctx.fill();

  // belly
  ctx.fillStyle = PAL.belly;
  ctx.beginPath();
  ctx.moveTo(-30 * s, -2 * s);
  ctx.bezierCurveTo(-14 * s, 3 * s, 14 * s, 4 * s, 30 * s, -3 * s);
  ctx.bezierCurveTo(20 * s, -10 * s, -18 * s, -9 * s, -30 * s, -2 * s);
  ctx.fill();

  // back shading
  ctx.fillStyle = PAL.furDark;
  ctx.globalAlpha = 0.35;
  ctx.beginPath();
  ctx.moveTo(-37 * s * stretch, -18 * s);
  ctx.bezierCurveTo(-32 * s, -40 * s, -6 * s, -44 * s, 12 * s, -39 * s);
  ctx.bezierCurveTo(-6 * s, -37 * s, -27 * s, -32 * s, -37 * s * stretch, -18 * s);
  ctx.fill();
  ctx.globalAlpha = 1;

  // ear (flops back while running)
  const earTilt = run ? -0.25 + Math.sin(g + 1) * 0.12 : 0;
  ctx.save();
  ctx.translate(20 * s, -36 * s);
  ctx.rotate(earTilt);
  ctx.fillStyle = PAL.furDark;
  ctx.beginPath();
  ctx.ellipse(0, -4 * s, 9 * s, 8 * s, -0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = PAL.pink;
  ctx.beginPath();
  ctx.ellipse(1 * s, -4 * s, 5.8 * s, 5 * s, -0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // cheek
  ctx.fillStyle = PAL.belly;
  ctx.globalAlpha = 0.55;
  ctx.beginPath();
  ctx.ellipse(32 * s, -8 * s, 9 * s, 6 * s, 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // eye, with a blink every few seconds when still
  const blink = !run && f.t % 4.2 < 0.14;
  ctx.fillStyle = PAL.eye;
  ctx.beginPath();
  if (blink) ctx.ellipse(32 * s, -22 * s, 3.6 * s, 0.8 * s, 0, 0, Math.PI * 2);
  else ctx.arc(32 * s, -22 * s, 3.6 * s, 0, Math.PI * 2);
  ctx.fill();
  if (!blink) {
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(33.4 * s, -23.4 * s, 1.1 * s, 0, Math.PI * 2);
    ctx.fill();
  }

  // nose and whiskers
  ctx.fillStyle = PAL.pinkDark;
  ctx.beginPath();
  ctx.ellipse(46 * s, -11 * s, 2.6 * s, 2.1 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = PAL.furDark;
  ctx.lineWidth = 0.9 * s;
  const twitch = run ? Math.sin(g * 3) * 1.2 * s : Math.sin(f.t * 9) * 0.4 * s;
  for (const dy of [-2.5, 0.5, 3.5]) {
    ctx.beginPath();
    ctx.moveTo(42 * s, -10 * s + dy * s * 0.6);
    ctx.lineTo(54 * s, -12 * s + dy * s + twitch);
    ctx.stroke();
  }

  // near legs over the body
  leg(ctx, backX, 0, legLen, sw(0), lf(0), s, false);
  leg(ctx, frontX, 0, legLen * 0.9, sw(Math.PI * 1.25), lf(Math.PI * 1.25), s, true);
  ctx.restore();
}

function drawSleeping(ctx: CanvasRenderingContext2D, x0: number, floor: number, s: number, t: number) {
  const breath = 1 + Math.sin(t * 1.6) * 0.035;
  ctx.save();
  ctx.translate(x0, floor);
  // a curled ball, its back up, the head tucked at the front
  ctx.fillStyle = PAL.fur;
  ctx.beginPath();
  ctx.ellipse(0, -20 * s * breath, 34 * s, 20 * s * breath, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = PAL.furDark;
  ctx.globalAlpha = 0.35;
  ctx.beginPath();
  ctx.ellipse(-6 * s, -28 * s * breath, 24 * s, 9 * s, -0.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  // head tucked in
  ctx.fillStyle = PAL.fur;
  ctx.beginPath();
  ctx.ellipse(24 * s, -12 * s, 15 * s, 12 * s, 0.25, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = PAL.belly;
  ctx.globalAlpha = 0.6;
  ctx.beginPath();
  ctx.ellipse(30 * s, -8 * s, 8 * s, 5 * s, 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  // ear
  ctx.fillStyle = PAL.furDark;
  ctx.beginPath();
  ctx.ellipse(16 * s, -24 * s, 6 * s, 5 * s, -0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = PAL.pink;
  ctx.beginPath();
  ctx.ellipse(16.6 * s, -24 * s, 3.6 * s, 3 * s, -0.4, 0, Math.PI * 2);
  ctx.fill();
  // closed eye
  ctx.strokeStyle = PAL.eye;
  ctx.lineWidth = 1.4 * s;
  ctx.beginPath();
  ctx.arc(28 * s, -15 * s, 3 * s, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();
  // nose, a paw under the chin, the tail
  ctx.fillStyle = PAL.pinkDark;
  ctx.beginPath();
  ctx.ellipse(38 * s, -9 * s, 2.2 * s, 1.8 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = PAL.pink;
  ctx.beginPath();
  ctx.ellipse(31 * s, -1.5 * s, 4 * s, 2.2 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = PAL.furDark;
  ctx.beginPath();
  ctx.ellipse(-33 * s, -9 * s, 4 * s, 2.6 * s, 0.4, 0, Math.PI * 2);
  ctx.fill();
  // z's drifting up, one after another
  ctx.strokeStyle = PAL.fur;
  ctx.lineWidth = 3.4 * s;
  ctx.lineJoin = "miter";
  ctx.lineWidth = Math.max(1.3, 2.8 * s);
  for (let k = 0; k < 2; k++) {
    const u = (t / 4 + k / 2) % 1;
    if (u > 0.8) continue;
    const z = (9 + u * 7) * s;
    const zx = 24 * s + u * 16 * s, zy = -36 * s - u * 52 * s;
    ctx.beginPath();
    ctx.moveTo(zx, zy);
    ctx.lineTo(zx + z, zy);
    ctx.lineTo(zx, zy + z);
    ctx.lineTo(zx + z, zy + z);
    ctx.stroke();
  }
  ctx.restore();
}

export interface LcdColors {
  bg: string;
  on: string;
  dim: string;
  ghost: string;
}

let scratch: HTMLCanvasElement | null = null;

/**
 * The wheel screen's look: the drawing on a dot matrix like the pattern grid's (visuals.ts drawGrid): `cols` square
 * cells, unlit ones in the ghost colour, lit ones in the phosphor with a soft glow, dim ones in phos-dim, scanlines
 * over it. The scene is drawn once per frame at one pixel per dot and read back.
 */
export function drawHamsterLCD(ctx: CanvasRenderingContext2D, w: number, h: number, f: HamsterFrame, c: LcdColors, cols = 52) {
  const cell = w / cols;
  const rows = Math.max(1, Math.floor(h / cell));
  scratch ??= document.createElement("canvas");
  if (scratch.width !== cols || scratch.height !== rows) {
    scratch.width = cols;
    scratch.height = rows;
  }
  const sx = scratch.getContext("2d", { willReadFrequently: true })!;
  sx.clearRect(0, 0, cols, rows);
  PAL = CODES;
  drawHamsterWheel(sx, cols, rows, f, "rgba(0,0,0,0)");
  const px = sx.getImageData(0, 0, cols, rows).data;

  ctx.fillStyle = c.bg;
  ctx.fillRect(0, 0, w, h);
  const gap = Math.max(0.6, cell * 0.16);
  const oy = (h - rows * cell) / 2;
  const lit: [number, number][] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = (y * cols + x) * 4;
      const a = px[i + 3];
      const level = a < 110 ? 0 : px[i] >= px[i + 1] && px[i] >= px[i + 2] ? 2 : px[i + 1] > px[i + 2] ? 1 : 0;
      ctx.fillStyle = level === 2 ? c.on : level === 1 ? c.dim : c.ghost;
      ctx.fillRect(x * cell + gap / 2, oy + y * cell + gap / 2, cell - gap, cell - gap);
      if (level === 2) lit.push([x, y]);
    }
  }
  // the lit dots glow a little, like the grid's playing cells
  ctx.save();
  ctx.shadowColor = c.on;
  ctx.shadowBlur = cell * 1.2;
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = c.on;
  for (const [x, y] of lit) ctx.fillRect(x * cell + gap / 2, oy + y * cell + gap / 2, cell - gap, cell - gap);
  ctx.restore();
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);
}
