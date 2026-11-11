import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import request from "supertest";
import { openDatabase } from "../server/db.js";
import { createApp } from "../server/app.js";
import { circleAt, moveCircle, moveItem, photoInfoTsv, resizeCircle, rotateItem, type SceneItem } from "../src/photo-scene.js";
import { cropRect, panView, zoomView } from "../server/photo-view.js";
const origin = "http://127.0.0.1:3000", png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
const jpeg = (w: number, h: number) => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 0x11, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9]);
test("scene geometry: 90° rotation keeps circles on the same content, four turns restore, moves clamp", () => {
  const item: SceneItem = { photoId: randomUUID(), included: true, rotation: 0, caption: "", circles: [{ x: 0.2, y: 0.1, r: 0.05, color: "red" }] };
  const once = rotateItem(item);
  assert.deepEqual([once.rotation, once.circles[0].x, once.circles[0].y], [90, 0.9, 0.2]); // top-left area moves to top-right
  assert.deepEqual(rotateItem(rotateItem(rotateItem(once))), item);
  assert.deepEqual(moveCircle(item.circles[0], -0.5, 2), { x: 0, y: 1, r: 0.05, color: "red" });
  assert.equal(resizeCircle(item.circles[0], -1).r, 0.01);
  const items = [item, { ...item, photoId: "b" }];
  assert.deepEqual(moveItem(items, 0, 1).map((i) => i.photoId), ["b", item.photoId]);
  assert.equal(moveItem(items, 0, -1), items);
});
test("stage 2 geometry: zoom window stays inside the photo, turns with it, pans clamp; TSV cells cannot become formulas", () => {
  assert.deepEqual(cropRect(undefined), { x: 0, y: 0, w: 1, h: 1 });
  assert.deepEqual(cropRect({ zoom: 2, cx: 0.5, cy: 0.5 }), { x: 0.25, y: 0.25, w: 0.5, h: 0.5 });
  assert.deepEqual(cropRect({ zoom: 2, cx: 0.05, cy: 0.99 }), { x: 0, y: 0.5, w: 0.5, h: 0.5 }); // clamped to the edges
  assert.equal(zoomView(undefined, 1), undefined);
  assert.deepEqual(zoomView({ zoom: 2, cx: 0.9, cy: 0.1 }, 4), { zoom: 4, cx: 0.875, cy: 0.125 }); // 1/4 window keeps its center inside
  assert.deepEqual(panView({ zoom: 2, cx: 0.5, cy: 0.5 }, 0.6, -0.6), { zoom: 2, cx: 0.75, cy: 0.25 });
  const item: SceneItem = { photoId: "a", included: true, rotation: 0, caption: "", circles: [{ x: 0.2, y: 0.1, r: 0.05, color: "red" }], view: { zoom: 2, cx: 0.25, cy: 0.25 } };
  const turned = rotateItem(item);
  assert.deepEqual(turned.view, { zoom: 2, cx: 0.75, cy: 0.25 }); // same content as the circle rule
  assert.deepEqual(rotateItem(rotateItem(rotateItem(turned))), item);
  assert.equal(circleAt(item, 0.21, 0.1, 800, 600), 0);
  assert.equal(circleAt(item, 0.5, 0.5, 800, 600), -1);
  assert.equal(photoInfoTsv([["설명", ""], ['=HYPERLINK("x")', "a\tb"]]), '\uFEFF"\'설명"\t""\r\n"\'=HYPERLINK(""x"")"\t"\'a\tb"');
});
test("photo board: originals retained, display set once, scene limited to own photos, version conflicts, roles", async () => {
  const db = openDatabase(":memory:"), site = randomUUID(), other = randomUUID(), password = randomUUID(), hash = await argon2.hash(password), ids: Record<string, string> = {};
  db.prepare("INSERT INTO sites(id,name) VALUES(?,?)").run(site, "합성");
  for (const role of ["editor", "viewer"]) {
    ids[role] = randomUUID();
    db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(ids[role], role + "@example.test", role, hash);
    db.prepare("INSERT INTO memberships VALUES(?,?,?)").run(site, ids[role], role);
  }
  try {
    const app = await createApp(db, { origin, secret: "synthetic-photo-board-secret-".repeat(2) });
    const login = async (name: string) => {
      const agent = request.agent(app);
      let r = await agent.get("/api/session");
      r = await agent.post("/api/login").set("Origin", origin).set("x-csrf-token", r.body.csrf).send({ email: name + "@example.test", password });
      return { agent, csrf: r.body.csrf as string };
    };
    const ed = await login("editor"), vw = await login("viewer"), base = `/api/sites/${site}/photo-boards`;
    const send = (a: typeof ed, method: "post" | "put", path: string, body: object, key = randomUUID()) => a.agent[method](path).set("Origin", origin).set("x-csrf-token", a.csrf).set("idempotency-key", key).send(body);
    const raw = (path: string, bytes: Buffer, type: string, name: string, version: number, key = randomUUID()) =>
      ed.agent.post(path).set("Origin", origin).set("x-csrf-token", ed.csrf).set("content-type", "application/octet-stream").set("x-photo-board-version", String(version))
        .set("x-file-name", encodeURIComponent(name)).set("x-file-type", type).set("idempotency-key", key).send(bytes);
    assert.equal((await send(vw, "post", base, { title: "보기 전용" })).status, 403);
    let r = await send(ed, "post", base, { title: "<작업 전후>" });
    assert.equal(r.status, 200, r.text);
    let b = r.body;
    const path = `${base}/${b.id}`;
    r = await raw(`${path}/photos`, png, "image/png", "현장.png", b.version);
    assert.equal(r.status, 200, r.text);
    const photoId = r.body.photoId;
    b = r.body.board;
    assert.equal((await raw(`${path}/photos`, png, "image/png", "현장.png", b.version - 1)).status, 409); // stale board version
    assert.equal((await raw(`${path}/photos/${photoId}/display`, jpeg(2049, 10), "image/jpeg", "display.jpg", b.version)).status, 400);
    r = await raw(`${path}/photos/${photoId}/display`, jpeg(800, 600), "image/jpeg", "display.jpg", b.version);
    assert.equal(r.status, 200, r.text);
    b = r.body;
    assert.deepEqual([b.photos[0].hasDisplay, b.photos[0].width, b.photos[0].height], [true, 800, 600]);
    assert.equal((await raw(`${path}/photos/${photoId}/display`, jpeg(10, 10), "image/jpeg", "display.jpg", b.version)).status, 409); // set once
    const shown = await ed.agent.get(`${path}/photos/${photoId}/display`), original = await vw.agent.get(`${path}/photos/${photoId}/download`);
    assert.deepEqual([shown.headers["content-type"], original.headers["content-type"], original.headers["x-attachment-scan"]], ["image/jpeg", "application/octet-stream", "UNSCANNED"]);
    const scene = { layoutVersion: 1, items: [{ photoId, included: true, rotation: 90, caption: "정리 완료", circles: [{ x: 0.5, y: 0.5, r: 0.1, color: "yellow" }] }] };
    const save = (v: number, s: object) => send(ed, "put", path, { version: v, title: "작업 전후", body: { siteName: "합성 현장", work: "정리", footer: "" }, scene: s });
    assert.equal((await save(b.version, { ...scene, items: [{ ...scene.items[0], photoId: randomUUID() }] })).status, 400); // not this board's photo
    assert.equal((await save(b.version, { ...scene, items: [scene.items[0], scene.items[0]] })).status, 400); // duplicate
    assert.equal((await save(b.version, { ...scene, items: [{ ...scene.items[0], rotation: 45 }] })).status, 400);
    assert.equal((await save(b.version - 1, scene)).status, 409);
    r = await save(b.version, scene);
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.body.scene, scene);
    assert.equal((await send(vw, "put", path, { version: r.body.version, title: "x", body: { siteName: "", work: "", footer: "" }, scene })).status, 403);
    // 2단계 사진대지: zoom view saved with the scene; print is two per page with rotation, zoom crop and circles as SVG.
    b = r.body;
    r = await raw(`${path}/photos`, png, "image/png", "두번째.png", b.version);
    const second = r.body.photoId;
    r = await raw(`${path}/photos`, png, "image/png", "제외.png", r.body.board.version);
    const third = r.body.photoId;
    b = r.body.board;
    const zoomed = { ...scene.items[0], caption: "<정리> 완료", view: { zoom: 2, cx: 0.25, cy: 0.25 } };
    assert.equal((await save(b.version, { ...scene, items: [{ ...zoomed, view: { zoom: 5, cx: 0.5, cy: 0.5 } }] })).status, 400);
    const full = { layoutVersion: 1, items: [zoomed, { photoId: second, included: true, rotation: 0, caption: "", circles: [] }, { photoId: third, included: false, rotation: 0, caption: "제외됨", circles: [] }] };
    r = await save(b.version, full);
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.body.scene.items[0].view, { zoom: 2, cx: 0.25, cy: 0.25 });
    let html = (await vw.agent.get(`${path}/print`)).text;
    assert.equal((html.match(/class="photo-page"/g) ?? []).length, 1);
    // 800×600 display turned 90° → 600×800 frame; 2× zoom at the top-left quarter → viewBox 0 0 300 400.
    assert.match(html, /<svg viewBox="0 0 300 400"[^>]*><clipPath id="v-[^"]+"><rect x="0" y="0" width="300" height="400"\/><\/clipPath><g clip-path="url\(#v-[^"]+\)"><image href="\/api\/sites\/[^"]+\/photos\/[^"]+\/display" x="-100" y="100" width="800" height="600" transform="rotate\(90 300 400\)"\/><circle cx="300" cy="400" r="60" fill="none" stroke="#f2c200" stroke-width="3.6"\/><\/g><\/svg>/);
    assert.match(html, /&lt;정리&gt; 완료/);
    assert.match(html, /표시본 없음 · 두번째\.png/);
    assert.doesNotMatch(html, /제외됨|빈 칸/);
    r = await save(r.body.version, { ...full, items: [full.items[0], { ...full.items[1], included: false }, full.items[2]] });
    html = (await ed.agent.get(`${path}/print`)).text;
    assert.match(html, /<p>빈 칸<\/p>/); // an odd last slot is marked, not stretched
    assert.match(html, /1\/1쪽/);
    // 5단계 사진대지 양식: photos per page, 머리글 4칸, 내용 칸 with the file name when the caption is empty.
    const sheetSave = (version: number, sheet: object, items = [full.items[0], full.items[1], { ...full.items[2], included: true }]) =>
      send(ed, "put", path, { version, title: "작업 전후", body: { siteName: "합성 현장", work: "정리", footer: "", sheet }, scene: { ...full, items } });
    const header = { project: "<합성> 신축공사", trade: "철근콘크리트", location: "지하 1층", date: "2026.11.11" };
    for (const bad of [{ perPage: 5, captions: true, fileNames: false, header }, { perPage: 4, captions: true, fileNames: false, header: { ...header, extra: "x" } }, { perPage: 4, captions: true, header }])
      assert.equal((await sheetSave(r.body.version, bad)).status, 400, JSON.stringify(bad));
    r = await sheetSave(r.body.version, { perPage: 4, captions: true, fileNames: true, header });
    assert.equal(r.status, 200, r.text);
    html = (await vw.agent.get(`${path}/print`)).text;
    assert.equal((html.match(/class="photo-page"/g) ?? []).length, 1); // 3 photos, 4 per page
    assert.match(html, /<table class="photo-head"><tbody><tr><th>공사명<\/th><td>&lt;합성&gt; 신축공사<\/td><th>공종명<\/th><td>철근콘크리트<\/td><\/tr><tr><th>공사 위치<\/th><td>지하 1층<\/td><th>공사 일자<\/th><td>2026\.11\.11<\/td><\/tr>/);
    assert.match(html, /<div class="photo-grid cols-2 rows-2">/);
    assert.match(html, /<figcaption>두번째\.png<\/figcaption>/); // empty caption → file name
    assert.match(html, /<figcaption>제외됨<\/figcaption>/); // a written caption stays
    assert.doesNotMatch(html, /빈 칸|설명 미입력/);
    r = await sheetSave(r.body.version, { perPage: 1, captions: false, fileNames: false, header: { project: "", trade: "", location: "", date: "" } });
    html = (await vw.agent.get(`${path}/print`)).text;
    assert.equal((html.match(/class="photo-page"/g) ?? []).length, 3); // one per page
    assert.match(html, /<div class="photo-grid cols-1 rows-1 no-captions">/);
    assert.doesNotMatch(html, /photo-head|figcaption/); // empty 머리글 is not printed, 내용 칸 off
    assert.match(html, /3\/3쪽/);
    assert.throws(() => db.prepare("UPDATE photo_board_photos SET bytes=x'00'").run());
    assert.throws(() => db.prepare("DELETE FROM photo_board_photos").run());
    assert.equal((await ed.agent.get(`/api/sites/${other}/photo-boards/${b.id}`)).status, 403); // not a member of that site
  } finally {
    db.close();
  }
});
