import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import request from "supertest";
import { openDatabase } from "../server/db.js";
import { createApp } from "../server/app.js";
import { DEFAULT_TEMPLATES } from "../server/default-templates.js";
import { templateInput } from "../server/inspection-validation.js";
// 기본 점검 양식 (검토 F1): a new site has published forms the writer can inspect with at once; each is an ordinary site
// form the manager can revise or stop, and none claims legal status.
test("a new site starts with the default inspection forms, published and usable", async () => {
  const db = openDatabase(":memory:"), password = randomUUID(), origin = "http://127.0.0.1:3000";
  db.prepare("INSERT INTO users VALUES(?,?,?,?)").run("m", "m@example.test", "합성 관리자", await argon2.hash(password));
  const app = await createApp(db, { origin, secret: "synthetic-template-secret-".repeat(2) });
  try {
    for (const t of DEFAULT_TEMPLATES) templateInput.parse({ title: t.title, instructions: "x", items: t.items }); // same limits as a hand-made form
    const a = request.agent(app);
    let r = await a.get("/api/session");
    r = await a.post("/api/login").set("Origin", origin).set("x-csrf-token", r.body.csrf).send({ email: "m@example.test", password });
    const csrf = r.body.csrf as string;
    const site = (await a.post("/api/sites").set("Origin", origin).set("x-csrf-token", csrf).set("idempotency-key", randomUUID()).send({ name: "합성 현장" })).body;
    const list = (await a.get(`/api/sites/${site.id}/inspection-templates`)).body.items as { id: string; status: string; version: number; body: { title: string; instructions: string; items: unknown[] } }[];
    assert.equal(list.length, DEFAULT_TEMPLATES.length);
    assert.ok(list.every((t) => t.status === "published" && t.version === 2 && t.body.items.length > 0));
    assert.ok(list.every((t) => /법정 양식·안전 인증이 아닙니다/.test(t.body.instructions)), "each form says what it is not");
    assert.deepEqual(list.map((t) => t.body.title).sort(), DEFAULT_TEMPLATES.map((t) => t.title).sort());
    const first = list.find((t) => t.body.title === "일일 안전점검 (일반)")!;
    const detail = (await a.get(`/api/sites/${site.id}/inspection-templates/${first.id}`)).body;
    assert.equal(detail.published_snapshot?.publishedBy?.name, "합성 관리자");
    // an inspection can be written from it right away
    const ins = await a.post(`/api/sites/${site.id}/inspections`).set("Origin", origin).set("x-csrf-token", csrf).set("idempotency-key", randomUUID())
      .send({ templateId: first.id, body: { date: "2026-11-02", location: "A동", performedBy: "합성 관리자", answers: first.body.items.map((i) => ({ itemId: (i as { id: string }).id, result: "pending", comment: "" })) } });
    assert.equal(ins.status, 200, JSON.stringify(ins.body));
    // the manager may stop a form they do not need, like any other form
    const use = (await a.get(`/api/sites/${site.id}/inspection-templates/${first.id}/use-status`)).body;
    const stop = await a.post(`/api/sites/${site.id}/inspection-templates/${first.id}/stop-use`).set("Origin", origin).set("x-csrf-token", csrf).set("idempotency-key", randomUUID()).send({ version: use.version, sourceHash: use.sourceHash, reason: "이 현장에는 맞지 않음", confirmNoUndo: true });
    assert.ok([200, 201].includes(stop.status), JSON.stringify(stop.body));
  } finally { db.close(); }
});
