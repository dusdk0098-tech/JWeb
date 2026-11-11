// 사진 보드 scene geometry shared by the editor preview and the PNG output (same drawing for both).
import { BOARD_THEMES, CIRCLE_COLORS, boardLayout, boardTexts, cropRect, rotateView, type BoardPanel, type View } from "../server/photo-view";
// A highlight: a circle, or with kind "rect" a rectangle (r = half width, h = half height; h absent = square). See SvgCircle.
export type Circle = { x: number; y: number; r: number; color: "red" | "yellow" | "blue"; kind?: "rect"; h?: number; dashed?: true };
// board: undefined = the board's common 보드판, null = none on this photo, a panel = this photo's own.
export type SceneItem = { photoId: string; included: boolean; rotation: 0 | 90 | 180 | 270; caption: string; circles: Circle[]; view?: View; board?: BoardPanel | null };
export type Scene = { layoutVersion: 1; items: SceneItem[]; board?: BoardPanel };
export const boardFor = (scene: Scene, item: SceneItem) => (item.board === null ? undefined : item.board ?? scene.board);
// The 보드판 over the shown photo rectangle (drawItem's x, y, w, h), drawn the same way as the printed SVG.
export function drawBoard(ctx: CanvasRenderingContext2D, b: BoardPanel, r: { x: number; y: number; w: number; h: number }) {
  const l = boardLayout(b, r), t = BOARD_THEMES[b.theme];
  ctx.save();
  ctx.globalAlpha = b.opacity; ctx.fillStyle = t.fill; ctx.fillRect(l.x, l.y, l.w, l.h); ctx.globalAlpha = 1;
  ctx.strokeStyle = t.text; ctx.lineWidth = Math.max(1, l.font * 0.08);
  ctx.strokeRect(l.x, l.y, l.w, l.h);
  ctx.beginPath(); ctx.moveTo(l.x + l.labelW, l.y); ctx.lineTo(l.x + l.labelW, l.y + l.h);
  for (const row of l.rows.slice(1)) { ctx.moveTo(l.x, l.y + row.y); ctx.lineTo(l.x + l.w, l.y + row.y); }
  ctx.stroke();
  ctx.fillStyle = t.text; ctx.textBaseline = "alphabetic"; ctx.font = `${b.bold ? "bold " : ""}${l.font}px "Malgun Gothic", Pretendard, sans-serif`;
  for (const x of boardTexts(b, l)) { ctx.textAlign = x.anchor === "middle" ? "center" : "left"; ctx.fillText(x.text, x.x, x.y); }
  ctx.restore();
}
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v * 1000) / 1000));
// Circles (and the zoom view) are stored in the rotated (displayed) frame; turning the photo 90° clockwise keeps them on the same content.
export function rotateItem(item: SceneItem): SceneItem {
  const turned: SceneItem = { ...item, rotation: ((item.rotation + 90) % 360) as SceneItem["rotation"], circles: item.circles.map((c) => ({ ...c, x: clamp(1 - c.y, 0, 1), y: clamp(c.x, 0, 1), ...(c.kind === "rect" && c.h !== undefined ? { r: c.h, h: c.r } : {}) })) };
  if (item.view) turned.view = rotateView(item.view);
  return turned;
}
export function moveCircle(c: Circle, dx: number, dy: number): Circle {
  return { ...c, x: clamp(c.x + dx, 0, 1), y: clamp(c.y + dy, 0, 1) };
}
export function resizeCircle(c: Circle, dr: number): Circle {
  return { ...c, r: clamp(c.r + dr, 0.01, 0.5), ...(c.h !== undefined ? { h: clamp(c.h + dr, 0.01, 0.5) } : {}) };
}
// Shape and line style of a highlight. Defaults (circle, solid) are left out of the stored object, like scenes saved before them.
export function styleShape(c: Circle, p: { kind?: "circle" | "rect"; dashed?: boolean }): Circle {
  const rect = (p.kind ?? c.kind ?? "circle") === "rect", dashed = p.dashed ?? !!c.dashed;
  return { x: c.x, y: c.y, r: c.r, color: c.color, ...(rect ? { kind: "rect" as const, ...(c.kind === "rect" && c.h !== undefined ? { h: c.h } : {}) } : {}), ...(dashed ? { dashed: true as const } : {}) };
}
// A rectangle's width alone (its height stays): the first use fixes the height at the current square size.
export function widenRect(c: Circle, dw: number): Circle {
  return { ...c, h: c.h ?? c.r, r: clamp(c.r + dw, 0.01, 0.5) };
}
export function moveItem(items: SceneItem[], index: number, delta: -1 | 1) {
  const to = index + delta;
  if (to < 0 || to >= items.length) return items;
  const next = [...items];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}
// Draws one photo (rotated, cropped to its zoom view) fitted inside the box, plus its circles. Returns the drawn rectangle and
// the full rotated photo's placement (ox, oy, fw, fh) so a pointer position maps back to full-frame coordinates.
export function drawItem(ctx: CanvasRenderingContext2D, img: CanvasImageSource & { width: number; height: number }, item: SceneItem, box: { x: number; y: number; w: number; h: number }) {
  const turned = item.rotation % 180 !== 0, iw = turned ? img.height : img.width, ih = turned ? img.width : img.height, crop = cropRect(item.view),
    scale = Math.min(box.w / (iw * crop.w), box.h / (ih * crop.h)), w = iw * crop.w * scale, h = ih * crop.h * scale,
    x = box.x + (box.w - w) / 2, y = box.y + (box.h - h) / 2, fw = iw * scale, fh = ih * scale, ox = x - crop.x * fw, oy = y - crop.y * fh;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.save();
  ctx.translate(ox + fw / 2, oy + fh / 2);
  ctx.rotate((item.rotation * Math.PI) / 180);
  ctx.drawImage(img, (-img.width * scale) / 2, (-img.height * scale) / 2, img.width * scale, img.height * scale);
  ctx.restore();
  const lw = Math.max(2, Math.min(w, h) * 0.012), m = Math.min(fw, fh);
  for (const c of item.circles) {
    ctx.beginPath();
    ctx.lineWidth = lw;
    ctx.setLineDash(c.dashed ? [lw * 3, lw * 2] : []);
    ctx.strokeStyle = CIRCLE_COLORS[c.color];
    if (c.kind === "rect") ctx.rect(ox + c.x * fw - c.r * m, oy + c.y * fh - (c.h ?? c.r) * m, 2 * c.r * m, 2 * (c.h ?? c.r) * m);
    else ctx.arc(ox + c.x * fw, oy + c.y * fh, c.r * m, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
  return { x, y, w, h, ox, oy, fw, fh };
}
// The circle under a full-frame point (topmost first), measured in drawn pixels (fw × fh) the way drawItem draws it.
export function circleAt(item: SceneItem, px: number, py: number, fw: number, fh: number) {
  for (let i = item.circles.length - 1; i >= 0; i--) {
    const c = item.circles[i];
    const dx = Math.abs(px - c.x) * fw, dy = Math.abs(py - c.y) * fh, m = Math.min(fw, fh);
    if (c.kind === "rect" ? dx <= c.r * m && dy <= (c.h ?? c.r) * m : Math.hypot(dx, dy) <= c.r * m) return i;
  }
  return -1;
}
// 사진 정보표 (원본 N과 같은 방식): tab-separated, every cell quoted and prefixed with ' so spreadsheets never run it as a formula.
export function photoInfoTsv(rows: string[][]) {
  return "﻿" + rows.map((row) => row.map((cell) => `"${cell === "" ? "" : "'" + cell.replace(/"/g, '""')}"`).join("\t")).join("\r\n");
}
