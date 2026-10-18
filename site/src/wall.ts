/** Cosmetic rack hardware. All animation mutates retained SVG nodes at the host's slow tick. */
const NS = "http://www.w3.org/2000/svg";
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const clamp = (v: number) => Math.max(0, Math.min(1, v));
type Control = {
  el: SVGGElement;
  part: SVGElement;
  kind: "knob" | "slider" | "button";
  value: number;
  phase: number;
  center: number;
  manual: boolean;
};
type Wall = {
  el: HTMLElement;
  visible: boolean;
  controls: Control[];
  meters: { el: SVGRectElement; phase: number; bin: number }[];
  waves: { el: SVGPolylineElement; width: number; phase: number; bin: number }[];
  leds: { el: SVGElement; phase: number; slot: number; control: Control }[];
  lastStep: number;
  stepAt: number;
  settled: boolean;
};
const walls = new Map<HTMLElement, Wall>();
const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver((entries) => {
  for (const entry of entries) {
    const wall = walls.get(entry.target as HTMLElement);
    if (wall) wall.visible = entry.isIntersecting;
  }
});
reducedMotion.addEventListener("change", () => walls.forEach((wall) => { wall.settled = false; }));

function svg<K extends keyof SVGElementTagNameMap>(parent: Element, tag: K, attrs: Record<string, string | number> = {}) {
  const el = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  parent.append(el);
  return el;
}

function position(control: Control, drift = 0) {
  if (control.kind === "knob") {
    control.part.setAttribute("transform", `rotate(${(-145 + control.value * 290 + drift).toFixed(2)} ${control.center} 20)`);
  } else if (control.kind === "slider") {
    control.part.setAttribute("y", (35 - control.value * 29).toFixed(2));
  }
}

/** Seeded layout keeps the two racks distinct without rebuilding them during animation. */
/** `rows` full rows of a 3-column rack: each row is plain (1 column) and wide (2 column) tiles summing to 3. */
export function moduleWall(el: HTMLElement, rows: number, seed: number) {
  let a = seed >>> 0;
  const random = () => ((a = (a * 1664525 + 1013904223) >>> 0) / 4294967296);
  const wall: Wall = { el, visible: true, controls: [], meters: [], waves: [], leds: [], lastStep: -1, stepAt: 0, settled: false };
  walls.set(el, wall);
  observer?.observe(el);
  el.replaceChildren();
  const controls = new Map<Element, Control>();
  const control = (parent: SVGElement, kind: Control["kind"], center = 0) => {
    const group = svg(parent, "g", { "data-wall-control": kind, class: `wall-control wall-${kind}` });
    const item: Control = { el: group, part: group, kind, center, value: random(), phase: random() * Math.PI * 2, manual: false };
    controls.set(group, item);
    wall.controls.push(item);
    return item;
  };
  const jack = (parent: SVGElement, x: number, y: number, radius: number) => {
    const group = svg(parent, "g", { class: "wall-jack", "data-wall-jack": "" });
    svg(group, "circle", { cx: x, cy: y, r: radius + 2, class: "wall-jack-ring" });
    svg(group, "circle", { cx: x, cy: y, r: radius, class: "j" });
  };
  const plan: boolean[] = [];
  for (let r = 0; r < rows; r++) {
    for (let used = 0; used < 3; ) {
      const wide = used <= 1 && random() < 0.35;
      plan.push(wide);
      used += wide ? 2 : 1;
    }
  }
  for (const [n, wide] of plan.entries()) {
    const kind = Math.floor(random() * 7);
    const W = wide ? 96 : 48;
    const tile = document.createElement("div");
    tile.className = `tile${wide ? " wide" : ""}`;
    el.append(tile);
    const drawing = svg(tile, "svg", { viewBox: `0 0 ${W} 48` });
    if (kind === 0 || kind === 6) {
      for (let i = 0; i < (kind === 6 ? 1 : wide ? 4 : 2); i++) {
        const x = kind === 6 ? W / 2 : 12 + i * 22;
        const c = control(drawing, "knob", x);
        svg(c.el, "circle", { cx: x, cy: 20, r: kind === 6 ? 14 : 8, class: "k" });
        c.part = svg(c.el, "line", { x1: x, y1: 20, x2: x, y2: kind === 6 ? 9 : 14, class: "i" });
        position(c);
        if (kind === 0) jack(drawing, x, 38, 3);
      }
    } else if (kind === 1) {
      for (let i = 0; i < (wide ? 12 : 6); i++) jack(drawing, 8 + (i % (wide ? 6 : 3)) * 15, 14 + Math.floor(i / (wide ? 6 : 3)) * 18, 4);
    } else if (kind === 2) {
      svg(drawing, "rect", { x: 5, y: 8, width: W - 10, height: 22, class: "l" });
      for (let i = 0; i < (wide ? 12 : 5); i++) {
        const bar = svg(drawing, "rect", { x: 8 + i * 7, y: 25, width: 4, height: 3, class: "p", "data-wall-meter": "" });
        wall.meters.push({ el: bar, phase: random() * 6, bin: i * 9 + n });
      }
    } else if (kind === 3) {
      for (let i = 0; i < (wide ? 6 : 3); i++) {
        const x = 10 + i * 14;
        const c = control(drawing, "slider");
        svg(c.el, "rect", { x: x - 6, y: 4, width: 12, height: 40, class: "wall-hit" });
        svg(c.el, "line", { x1: x, y1: 6, x2: x, y2: 42, class: "i" });
        c.part = svg(c.el, "rect", { x: x - 4, y: 20, width: 8, height: 5, class: "s" });
        position(c);
      }
    } else if (kind === 4) {
      svg(drawing, "rect", { x: 5, y: 9, width: W - 10, height: 20, class: "l" });
      const wave = svg(drawing, "polyline", { class: "w", "data-wall-wave": "" });
      wall.waves.push({ el: wave, width: W, phase: random() * 6, bin: n * 3 });
    } else {
      for (let i = 0; i < (wide ? 8 : 4); i++) {
        for (let row = 0; row < 2; row++) {
          const c = control(drawing, "button");
          c.part = svg(c.el, "rect", { x: 6 + i * 11, y: 12 + row * 16, width: 8, height: 8, class: "led", opacity: 0.25 });
          wall.leds.push({ el: c.part, phase: c.phase, slot: (n + i + row * 4) % 16, control: c });
        }
      }
    }
    svg(drawing, "circle", { cx: 3, cy: 3, r: 1.2, class: "sc" });
    svg(drawing, "circle", { cx: W - 3, cy: 45, r: 1.2, class: "sc" });
  }
  let drag: { control: Control; y: number; value: number; range: number; pointer: number } | null = null;
  const findControl = (event: PointerEvent | MouseEvent) => controls.get((event.target as Element).closest("[data-wall-control]")!);
  el.onpointerdown = (event) => {
    const c = findControl(event);
    if (!c || c.kind === "button" || event.button !== 0) return;
    event.preventDefault();
    c.manual = true;
    c.el.classList.add("dragging");
    c.el.dataset.value = c.value.toFixed(3);
    const drawing = c.el.ownerSVGElement!;
    drag = { control: c, y: event.clientY, value: c.value, range: c.kind === "knob" ? 100 : drawing.getBoundingClientRect().height * 29 / 48, pointer: event.pointerId };
    el.setPointerCapture(event.pointerId);
  };
  el.onpointermove = (event) => {
    if (!drag || drag.pointer !== event.pointerId) return;
    const c = drag.control;
    c.value = clamp(drag.value + (drag.y - event.clientY) / drag.range);
    c.el.dataset.value = c.value.toFixed(3);
    position(c);
  };
  const endDrag = () => {
    if (!drag) return;
    drag.control.el.classList.remove("dragging");
    if (el.hasPointerCapture(drag.pointer)) el.releasePointerCapture(drag.pointer);
    drag = null;
  };
  el.onpointerup = endDrag;
  el.onpointercancel = endDrag;
  el.onlostpointercapture = endDrag;
  el.onclick = (event) => {
    const c = findControl(event);
    if (!c || c.kind !== "button") return;
    c.value = c.manual ? 1 - c.value : 1;
    c.manual = true;
    c.el.dataset.on = String(c.value === 1);
    c.part.setAttribute("opacity", c.value ? "1" : "0.15");
  };
}

const DROP_MS = 1500;
let dropAt = -Infinity;

/** v2 track drop: every LED strobes and the meters peg for a moment. */
export function dropWalls() {
  dropAt = performance.now();
  walls.forEach((wall) => { wall.settled = false; });
}

/** t is elapsed seconds; a non-null spectrum means the sequencer is playing. */
export function updateWalls(t: number, level: number, step: number, freqData: Uint8Array | null) {
  const calm = reducedMotion.matches;
  const sinceDrop = performance.now() - dropAt;
  const strobe = sinceDrop < DROP_MS ? (calm ? 1 : Math.floor(sinceDrop / 110) % 2 === 0 ? 1 : 0.15) : null;
  for (const wall of walls.values()) {
    if (!wall.visible || (calm && !freqData && wall.settled && strobe === null)) continue;
    if (wall.lastStep !== step) { wall.lastStep = step; wall.stepAt = t; }
    const clock = calm ? 0 : t;
    const pulse = calm ? 0.35 : Math.max(0, 1 - (t - wall.stepAt) * 7);
    for (const led of wall.leds) {
      if (led.control.manual) continue;
      const idle = calm ? 0.3 : Math.sin(clock * (3.2 + led.slot % 3) + led.phase) > 0.65 ? 0.8 : 0.16;
      led.el.setAttribute("opacity", String(strobe ?? (freqData && step % 4 === led.slot % 4 ? 0.35 + pulse * 0.65 : idle)));
    }
    for (const meter of wall.meters) {
      const bin = freqData?.length ? freqData[meter.bin % freqData.length] / 255 : 0;
      const base = freqData ? clamp(bin * 0.8 + level * 0.6) : calm ? 0.2 : 0.15 + (0.5 + 0.5 * Math.sin(clock * 3.8 + meter.phase)) * 0.55;
      const value = strobe === null ? base : Math.max(base, 1 - sinceDrop / DROP_MS);
      const h = 2 + value * 17;
      meter.el.setAttribute("y", (28 - h).toFixed(2));
      meter.el.setAttribute("height", h.toFixed(2));
    }
    for (const wave of wall.waves) {
      const points: string[] = [];
      for (let i = 0; i < 24; i++) {
        const bin = freqData?.length ? freqData[(wave.bin + i * 3) % freqData.length] / 255 : 0;
        const amplitude = freqData ? 1 + clamp(bin + level * 0.5) * 7 : calm ? 2 : 5;
        const y = 19 + Math.sin(i * 0.9 + clock * 4 + wave.phase) * amplitude;
        points.push(`${(7 + i * ((wave.width - 14) / 23)).toFixed(1)},${y.toFixed(1)}`);
      }
      wave.el.setAttribute("points", points.join(" "));
    }
    for (const c of wall.controls) {
      if (c.kind === "knob" && !c.manual) position(c, calm ? 0 : Math.sin(clock * 0.65 + c.phase) * 5);
    }
    wall.settled = true;
  }
}
