// 7-segment display as inline SVG. Unlit segments stay faintly visible like real LCD/LED glass.
const MAP: Record<string, string> = {
  "0": "abcdef", "1": "bc", "2": "abged", "3": "abgcd", "4": "fgbc", "5": "afgcd", "6": "afgedc", "7": "abc",
  "8": "abcdefg", "9": "abcdfg", a: "abcefg", b: "fgcde", c: "gde", C: "afed", d: "bcdeg", e: "afged", E: "afged",
  f: "afge", F: "afge", g: "afcdeb", G: "afedc", h: "fegc", H: "fbegc", i: "c", l: "fed", L: "fed", n: "egc",
  o: "gcde", O: "abcdef", p: "abfge", P: "abfge", r: "eg", s: "afgcd", S: "afgcd", t: "fged", u: "edc", U: "fedcb",
  y: "fgbcd", Y: "fgbcd", "-": "g", "_": "d", " ": "",
};
// Segment polygons in a 12x20 cell.
const SEG: Record<string, string> = {
  a: "2,1 10,1 8.6,2.6 3.4,2.6", b: "10.4,1.6 10.4,9.3 8.9,8.4 8.9,3.1", c: "10.4,10.7 10.4,18.4 8.9,16.9 8.9,11.6",
  d: "2,19 10,19 8.6,17.4 3.4,17.4", e: "1.6,10.7 1.6,18.4 3.1,16.9 3.1,11.6", f: "1.6,1.6 1.6,9.3 3.1,8.4 3.1,3.1",
  g: "2.2,10 3.6,9.1 8.4,9.1 9.8,10 8.4,10.9 3.6,10.9",
};

export function sevenSeg(el: HTMLElement, digits: number) {
  const W = 13;
  let svg = `<svg viewBox="0 0 ${digits * W} 20" preserveAspectRatio="xMidYMid meet" aria-hidden="true">`;
  for (let i = 0; i < digits; i++) {
    svg += `<g transform="translate(${i * W + 0.5},0) skewX(-6)">`;
    for (const k of "abcdefg") svg += `<polygon data-s="${k}" points="${SEG[k]}"/>`;
    svg += `<circle data-s="dp" cx="11.6" cy="18.6" r="0.9"/></g>`;
  }
  el.innerHTML = svg + "</svg>";
  const groups = [...el.querySelectorAll("g")];
  let last = "";
  return (text: string, dots: number[] = []) => {
    const t = text.padStart(digits, " ").slice(-digits);
    const key = t + dots.join(",");
    if (key === last) return;
    last = key;
    el.setAttribute("aria-label", text);
    groups.forEach((g, i) => {
      const on = MAP[t[i]] ?? MAP[t[i].toLowerCase()] ?? "";
      for (const p of g.children) {
        const s = (p as SVGElement).dataset.s!;
        p.classList.toggle("on", s === "dp" ? dots.includes(i) : on.includes(s));
      }
    });
  };
}
