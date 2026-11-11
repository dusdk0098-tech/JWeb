import test from "node:test";
import assert from "node:assert/strict";
import { boardColumns, boardLayout, boardSvg, boardTexts, defaultBoard, photoSvg, setBoardColumns, wrapText, type BoardPanel } from "../server/photo-view.js";
import { photoScene } from "../server/photo-board.js";
import { boardFor, type Scene, type SceneItem } from "../src/photo-scene.js";
// 보드판 (docs/PHOTO_BOARD_FRANVIEW_ANALYSIS.md): one layout for the editor, PNG and print; wrapping, corners, shrinking, escaping.
const rect = { x: 100, y: 50, w: 800, h: 600 };
test("보드판 layout: wrap by estimated width, corners, shrink to fit, text runs", () => {
  assert.deepEqual(wrapText("가나다라마", 3), ["가나다", "라마"]);
  assert.deepEqual(wrapText("abcdef", 2.3), ["abcd", "ef"]); // 0.56 em each
  assert.deepEqual(wrapText("가나다라마바사아자", 2, 2), ["가나", "다…"]);
  assert.deepEqual(wrapText("", 5), [""]);
  assert.deepEqual(wrapText("가나 다라", 3), ["가나", "다라"], "no trailing space at a break");
  assert.deepEqual(wrapText("배근 검측 후", 4), ["배근", "검측 후"], "breaks between words, not inside one");
  const b: BoardPanel = { ...defaultBoard(), rows: [{ label: "공사명", value: "합성 공사" }, { label: "일자", value: "2026.11.05" }], size: 0.5 };
  const bl = boardLayout(b, rect);
  assert.deepEqual([bl.x, bl.w, bl.y + bl.h], [100, 400, 650], "bottom-left of the shown photo");
  const tr = boardLayout({ ...b, corner: "tr" }, rect);
  assert.deepEqual([tr.x + tr.w, tr.y], [900, 50]);
  const tall = boardLayout({ ...b, size: 1, rows: Array.from({ length: 6 }, () => ({ label: "항목", value: "아주 긴 내용 ".repeat(20) })) }, { x: 0, y: 0, w: 800, h: 200 });
  assert.ok(tall.h <= 190.01 && tall.w < 800, "shrunk as a whole to 95% of the photo height");
  assert.equal(boardLayout({ ...b, labelShare: 0.2 }, rect).labelW, 80, "the content column widens");
  assert.equal(boardLayout({ ...b, labelShare: undefined }, rect).labelW, 120, "boards saved before this default to 30%");
  // 항목 칸·내용 칸 너비 each on its own (fractions of the photo width).
  const d = defaultBoard(), near = (x: number, y: number) => assert.ok(Math.abs(x - y) < 0.002, `${x} ≈ ${y}`);
  near(boardColumns(d).label, 0.15); near(boardColumns(d).value, 0.45);
  const wider = setBoardColumns(d, { value: 0.7 });
  near(boardColumns(wider).label, 0.15); near(boardColumns(wider).value, 0.7);
  assert.equal(wider.size, 0.85);
  assert.ok(Math.abs(boardLayout(wider, rect).labelW - 120) < 1); // 15% of the 800px photo, as before the content column grew
  const label = setBoardColumns(wider, { label: 0.3 });
  near(boardColumns(label).label, 0.3); near(boardColumns(label).value, 0.7); // the content column stays
  assert.equal(setBoardColumns(label, { label: 0.4 }).size, 1, "the table never passes the photo width: content gives way");
  near(boardColumns(setBoardColumns(d, { label: 0.9 })).label, 0.4);
  assert.equal(setBoardColumns(d, { label: 0.05, value: 0.01 }).size, 0.2, "the table keeps at least 20%");
  for (const x of [wider, label, setBoardColumns(d, { label: 0.4, value: 0.1 }), setBoardColumns(d, { label: 0.05, value: 0.95 })])
    assert.equal(photoScene.safeParse({ layoutVersion: 1, items: [], board: x }).success, true, JSON.stringify(x));
  const runs = boardTexts(b, bl);
  assert.deepEqual(runs.map((r) => r.text), ["공사명", "합성 공사", "일자", "2026.11.05"]);
  assert.equal(runs[0].anchor, "middle"); // labels centered by default
  assert.equal(runs[1].x, bl.x + bl.labelW + bl.pad); // values left
});
test("보드판 SVG: escaped text, drawn inside the photo window of the print", () => {
  const b: BoardPanel = { ...defaultBoard(), rows: [{ label: "<b>", value: `"&'<script>` }] };
  const svg = boardSvg(b, boardLayout(b, rect));
  assert.ok(!svg.includes("<script>") && !svg.includes("<b>"));
  assert.match(svg, /&#60;b&#62;/);
  const photo = photoSvg({ href: "/x", width: 400, height: 300, rotation: 0, circles: [], label: "사진", clipId: "c1", board: b });
  assert.match(photo, /<g clip-path="url\(#c1\)">.*class="photo-board-panel".*<\/g><\/svg>$/);
  assert.ok(!photoSvg({ href: "/x", width: 400, height: 300, rotation: 0, circles: [], label: "사진", clipId: "c1" }).includes("photo-board-panel"));
});
test("보드판 scene: common board, per-photo own/none, limits", () => {
  const id = "5b0f2a3e-8c1d-4f2a-9b3c-1d2e3f4a5b6c", item: SceneItem = { photoId: id, included: true, rotation: 0, caption: "", circles: [] };
  const scene: Scene = { layoutVersion: 1, items: [item], board: defaultBoard() };
  assert.equal(photoScene.safeParse(scene).success, true);
  assert.equal(photoScene.safeParse({ layoutVersion: 1, items: [item] }).success, true, "older scenes stay valid");
  assert.equal(photoScene.safeParse({ ...scene, items: [{ ...item, board: null }] }).success, true);
  assert.equal(photoScene.safeParse({ ...scene, board: { ...defaultBoard(), rows: Array.from({ length: 7 }, () => ({ label: "", value: "" })) } }).success, false, "at most 6 rows");
  assert.equal(photoScene.safeParse({ ...scene, board: { ...defaultBoard(), rows: [] } }).success, false, "at least 1 row");
  assert.equal(photoScene.safeParse({ ...scene, board: { ...defaultBoard(), theme: "pink" } }).success, false);
  assert.equal(photoScene.safeParse({ ...scene, board: { ...defaultBoard(), size: 2 } }).success, false);
  assert.equal(photoScene.safeParse({ ...scene, board: { ...defaultBoard(), opacity: 0 } }).success, true, "fully transparent background");
  assert.equal(photoScene.safeParse({ ...scene, board: { ...defaultBoard(), labelShare: 0.9 } }).success, false);
  assert.equal(boardFor(scene, item), scene.board);
  assert.equal(boardFor(scene, { ...item, board: null }), undefined);
  const own = { ...defaultBoard(), corner: "tr" as const };
  assert.equal(boardFor(scene, { ...item, board: own }), own);
  assert.equal(boardFor({ layoutVersion: 1, items: [item] }, item), undefined);
});
