import test from "node:test";
import assert from "node:assert/strict";
import { photoSvg } from "../server/photo-view.js";
import { photoScene } from "../server/photo-board.js";
import { circleAt, resizeCircle, rotateItem, styleShape, widenRect, type Circle, type SceneItem } from "../src/photo-scene.js";
import { boardPhrases, forgetPhrase, rememberPhrases, todayText } from "../src/boardPhrases.js";
const circle: Circle = { x: 0.5, y: 0.5, r: 0.1, color: "red" };
const item = (circles: Circle[]): SceneItem => ({ photoId: "00000000-0000-4000-8000-000000000001", included: true, rotation: 0, caption: "", circles });

test("a highlight without the new fields prints exactly as before; rect and dashed add to it", () => {
  const svg = (circles: Circle[]) => photoSvg({ href: "/d", width: 400, height: 300, rotation: 0, circles, label: "합성", clipId: "c" });
  assert.match(svg([circle]), /<circle cx="200" cy="150" r="30" fill="none" stroke="#e0312b" stroke-width="3.6"\/>/);
  assert.match(svg([{ ...circle, dashed: true }]), /<circle cx="200" cy="150" r="30" fill="none" stroke="#e0312b" stroke-width="3.6" stroke-dasharray="10.8 7.2"\/>/);
  // rect: center 200,150, half width 0.1 × 300 = 30, half height 0.2 × 300 = 60
  assert.match(svg([{ ...circle, kind: "rect", h: 0.2, color: "blue" }]), /<rect x="170" y="90" width="60" height="120" fill="none" stroke="#1f6fe0" stroke-width="3.6"\/>/);
  assert.match(svg([{ ...circle, kind: "rect" }]), /<rect x="170" y="120" width="60" height="60" /); // no h = square
});

test("scene schema takes the optional shape fields and still rejects unknown ones", () => {
  const scene = (c: object) => photoScene.safeParse({ layoutVersion: 1, items: [{ ...item([]), circles: [c] }] }).success;
  assert.equal(scene(circle), true);
  assert.equal(scene({ ...circle, kind: "rect", h: 0.2, dashed: true }), true);
  for (const bad of [{ kind: "star" }, { dashed: false }, { h: 0.6 }, { fill: "red" }]) assert.equal(scene({ ...circle, ...bad }), false, JSON.stringify(bad));
});

test("shape helpers: hit test, resize, widen, rotate and style keep stored objects minimal", () => {
  const wide: Circle = { ...circle, kind: "rect", r: 0.2, h: 0.05 };
  // fw=400, fh=300: half width 60px, half height 15px around (200,150)
  assert.equal(circleAt(item([wide]), 0.5 + 55 / 400, 0.5 + 10 / 300, 400, 300), 0);
  assert.equal(circleAt(item([wide]), 0.5 + 55 / 400, 0.5 + 20 / 300, 400, 300), -1);
  assert.equal(circleAt(item([circle]), 0.5 + 25 / 400, 0.5, 400, 300), 0); // circle radius 30px
  assert.equal(circleAt(item([circle]), 0.5 + 25 / 400, 0.5 + 25 / 300, 400, 300), -1); // corner of its box is outside the circle
  assert.deepEqual(resizeCircle(wide, 0.02), { ...wide, r: 0.22, h: 0.07 });
  assert.deepEqual(resizeCircle(circle, 0.02), { ...circle, r: 0.12 });
  assert.deepEqual(widenRect({ ...circle, kind: "rect" }, 0.02), { ...circle, kind: "rect", r: 0.12, h: 0.1 });
  assert.deepEqual(rotateItem(item([{ ...wide, x: 0.2, y: 0.3 }])).circles[0], { ...wide, x: 0.7, y: 0.2, r: 0.05, h: 0.2 }); // turned with the photo
  assert.deepEqual(styleShape(circle, { kind: "rect" }), { ...circle, kind: "rect" });
  assert.deepEqual(styleShape(wide, { dashed: true }), { ...wide, dashed: true });
  assert.deepEqual(styleShape({ ...wide, dashed: true }, { kind: "circle", dashed: false }), { ...circle, r: 0.2 }); // a plain circle again: no kind, h or dashed left
});

test("board phrases: newest first, no duplicates or dates, 30 at most, per site, removable", () => {
  const data = new Map<string, string>();
  Object.assign(globalThis, { localStorage: { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) } });
  rememberPhrases("s1", ["○○ 신축공사", " 철근콘크리트공사 ", "", "2026.11.11"]);
  rememberPhrases("s1", ["지하 1층", "○○ 신축공사"]);
  assert.deepEqual(boardPhrases("s1"), ["지하 1층", "○○ 신축공사", "철근콘크리트공사"]);
  assert.deepEqual(boardPhrases("s2"), []);
  forgetPhrase("s1", "○○ 신축공사");
  assert.deepEqual(boardPhrases("s1"), ["지하 1층", "철근콘크리트공사"]);
  rememberPhrases("s1", Array.from({ length: 40 }, (_, i) => `문구 ${i}`));
  assert.equal(boardPhrases("s1").length, 30);
  data.set("yweb:board-phrases:s3", "not json");
  assert.deepEqual(boardPhrases("s3"), []);
  assert.equal(todayText(new Date(2026, 10, 5)), "2026.11.05");
});
