// 사진 보드(N) 2단계: per-photo zoom ("확대") as a viewport over the rotated photo. Pure, no imports: the editor canvas,
// the PNG export and the server print all crop through these functions. Originals and circle coordinates are not changed —
// circles stay in the full rotated-photo frame and the view only decides which part is shown.
export type View = { zoom: number; cx: number; cy: number };
export const MAX_ZOOM = 4;
export const CIRCLE_COLORS = { red: "#e0312b", yellow: "#f2c200", blue: "#1f6fe0" } as const;
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
// The shown part of the rotated photo, normalized 0..1: 1/zoom of each side (same aspect as the photo), kept inside it.
export function cropRect(view?: View) {
  if (!view || view.zoom <= 1) return { x: 0, y: 0, w: 1, h: 1 };
  const s = 1 / clamp(view.zoom, 1, MAX_ZOOM);
  return { x: r3(clamp(view.cx - s / 2, 0, 1 - s)), y: r3(clamp(view.cy - s / 2, 0, 1 - s)), w: r3(s), h: r3(s) };
}
// Turning the photo 90° clockwise moves the view center with the content (same rule as circles).
export const rotateView = (v: View): View => ({ ...v, cx: r3(1 - v.cy), cy: r3(v.cx) });
// Pan by a fraction of the full photo; the center is clamped so the window stays inside.
export function panView(v: View, dx: number, dy: number): View {
  const half = 1 / clamp(v.zoom, 1, MAX_ZOOM) / 2;
  return { ...v, cx: r3(clamp(v.cx + dx, half, 1 - half)), cy: r3(clamp(v.cy + dy, half, 1 - half)) };
}
export function zoomView(v: View | undefined, zoom: number): View | undefined {
  const z = r3(clamp(zoom, 1, MAX_ZOOM));
  if (z <= 1) return undefined;
  return panView({ zoom: z, cx: v?.cx ?? 0.5, cy: v?.cy ?? 0.5 }, 0, 0);
}
// One printed photo: an SVG over the display JPEG with rotation, optional zoom window and circles, clipped to the window so a
// wider slot never shows the cropped-out part. `label` must already be HTML-escaped; ids/numbers are generated here.
export type SvgCircle = { x: number; y: number; r: number; color: keyof typeof CIRCLE_COLORS };
// 보드판 (docs/PHOTO_BOARD_FRANVIEW_ANALYSIS.md 5절): an item/content table drawn over the shown photo, like a site photo
// board held up in the picture. One layout for the editor canvas, the PNG and the printed SVG, so all three match. Text width
// is estimated (CJK 1 em, others 0.56 em) instead of measured, so the server and the browser wrap the same way.
export type BoardRow = { label: string; value: string };
export type BoardPanel = {
  rows: BoardRow[]; corner: "tl" | "tr" | "bl" | "br"; size: number; labelShare?: number; theme: keyof typeof BOARD_THEMES; opacity: number;
  bold: boolean; labelAlign: "left" | "center"; valueAlign: "left" | "center";
};
export const BOARD_THEMES = { white: { fill: "#ffffff", text: "#111111" }, green: { fill: "#1d4a33", text: "#ffffff" }, black: { fill: "#111111", text: "#ffffff" } } as const;
export const BOARD_MAX_ROWS = 6;
export const defaultBoard = (): BoardPanel => ({
  rows: [{ label: "공사명", value: "" }, { label: "공종", value: "" }, { label: "위치", value: "" }, { label: "일자", value: "" }],
  corner: "bl", size: 0.6, labelShare: 0.25, theme: "white", opacity: 0.85, bold: false, labelAlign: "center", valueAlign: "left",
});
const em = (ch: string) => (ch.codePointAt(0)! >= 0x2e80 ? 1 : 0.56);
// Greedy wrap by estimated width, breaking at the last space when the line has one; at most `max` lines, the last one ends
// with … when text is left over. Empty text keeps one line.
export function wrapText(text: string, width: number, max = 3) {
  const lines: string[] = [], units = (s: string) => [...s].reduce((n, c) => n + em(c), 0);
  let line = "";
  for (const ch of text.replace(/\s+/g, " ").trim()) {
    if (units(line) + em(ch) > width && line) {
      if (lines.length === max - 1) return [...lines, line.trimEnd().slice(0, -1) + "…"];
      const sp = ch === " " ? -1 : line.lastIndexOf(" "), carry = sp > 0 ? line.slice(sp + 1) : "";
      lines.push((sp > 0 ? line.slice(0, sp) : line).trimEnd());
      line = ch === " " ? carry : carry + ch;
    } else line += ch;
  }
  return [...lines, line];
}
export type BoardLayout = { x: number; y: number; w: number; h: number; labelW: number; font: number; lineH: number; pad: number; rows: { y: number; h: number; label: string[]; value: string[] }[] };
// Board placed in a corner of the shown photo rectangle; shrunk as a whole when its rows would be taller than the photo.
export function boardLayout(b: BoardPanel, r: { x: number; y: number; w: number; h: number }): BoardLayout {
  const w0 = r.w * Math.min(1, Math.max(0.2, b.size)), font0 = w0 / 16, pad0 = font0 * 0.35, lineH0 = font0 * 1.3, labelW0 = w0 * (b.labelShare ?? 0.3);
  let y0 = 0;
  const rows0 = b.rows.map((row) => {
    const label = wrapText(row.label, (labelW0 - 2 * pad0) / font0, 2), value = wrapText(row.value, (w0 - labelW0 - 2 * pad0) / font0, 3);
    const h = Math.max(label.length, value.length) * lineH0 + 2 * pad0, out = { y: y0, h, label, value };
    y0 += h;
    return out;
  });
  const s = Math.min(1, (r.h * 0.95) / y0), w = w0 * s, h = y0 * s;
  return {
    x: b.corner.endsWith("l") ? r.x : r.x + r.w - w, y: b.corner.startsWith("t") ? r.y : r.y + r.h - h, w, h,
    labelW: labelW0 * s, font: font0 * s, lineH: lineH0 * s, pad: pad0 * s,
    rows: rows0.map((row) => ({ ...row, y: row.y * s, h: row.h * s })),
  };
}
// Text runs of one board (cell, line, anchor), shared by the canvas and the SVG drawing.
export function boardTexts(b: BoardPanel, l: BoardLayout) {
  const out: { text: string; x: number; y: number; anchor: "start" | "middle" }[] = [];
  for (const row of l.rows) for (const [lines, x0, cw, align] of [[row.label, l.x, l.labelW, b.labelAlign], [row.value, l.x + l.labelW, l.w - l.labelW, b.valueAlign]] as const) {
    const top = l.y + row.y + (row.h - lines.length * l.lineH) / 2;
    lines.forEach((text, i) => out.push({ text, x: align === "center" ? x0 + cw / 2 : x0 + l.pad, y: top + i * l.lineH + l.font * 1.02, anchor: align === "center" ? "middle" : "start" }));
  }
  return out;
}
const xml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
export function boardSvg(b: BoardPanel, l: BoardLayout) {
  const n = (x: number) => Math.round(x * 100) / 100, t = BOARD_THEMES[b.theme], sw = n(Math.max(1, l.font * 0.08));
  const lines = [`<line x1="${n(l.x + l.labelW)}" y1="${n(l.y)}" x2="${n(l.x + l.labelW)}" y2="${n(l.y + l.h)}"/>`,
    ...l.rows.slice(1).map((row) => `<line x1="${n(l.x)}" y1="${n(l.y + row.y)}" x2="${n(l.x + l.w)}" y2="${n(l.y + row.y)}"/>`)].join("");
  const texts = boardTexts(b, l).map((x) => `<text x="${n(x.x)}" y="${n(x.y)}" text-anchor="${x.anchor}">${xml(x.text)}</text>`).join("");
  return `<g class="photo-board-panel"><rect x="${n(l.x)}" y="${n(l.y)}" width="${n(l.w)}" height="${n(l.h)}" fill="${t.fill}" fill-opacity="${b.opacity}" stroke="${t.text}" stroke-width="${sw}"/>` +
    `<g stroke="${t.text}" stroke-width="${sw}">${lines}</g><g fill="${t.text}" font-size="${n(l.font)}" font-weight="${b.bold ? 700 : 400}" font-family="Malgun Gothic, Pretendard, sans-serif">${texts}</g></g>`;
}
export function photoSvg(o: { href: string; width: number; height: number; rotation: number; circles: SvgCircle[]; view?: View; label: string; clipId: string; board?: BoardPanel }) {
  const n = (x: number) => Math.round(x * 100) / 100, turned = o.rotation % 180 !== 0, iw = turned ? o.height : o.width, ih = turned ? o.width : o.height, c = cropRect(o.view);
  const circles = o.circles.map((k) => `<circle cx="${n(k.x * iw)}" cy="${n(k.y * ih)}" r="${n(k.r * Math.min(iw, ih))}" fill="none" stroke="${CIRCLE_COLORS[k.color]}" stroke-width="${n(Math.max(2, Math.min(c.w * iw, c.h * ih) * 0.012))}"/>`).join("");
  const box = `x="${n(c.x * iw)}" y="${n(c.y * ih)}" width="${n(c.w * iw)}" height="${n(c.h * ih)}"`;
  const panel = o.board ? boardSvg(o.board, boardLayout(o.board, { x: c.x * iw, y: c.y * ih, w: c.w * iw, h: c.h * ih })) : "";
  return `<svg viewBox="${n(c.x * iw)} ${n(c.y * ih)} ${n(c.w * iw)} ${n(c.h * ih)}" role="img" aria-label="${o.label}"><clipPath id="${o.clipId}"><rect ${box}/></clipPath><g clip-path="url(#${o.clipId})"><image href="${o.href}" x="${n((iw - o.width) / 2)}" y="${n((ih - o.height) / 2)}" width="${o.width}" height="${o.height}" transform="rotate(${o.rotation} ${n(iw / 2)} ${n(ih / 2)})"/>${circles}${panel}</g></svg>`;
}
