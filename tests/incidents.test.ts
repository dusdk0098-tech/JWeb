import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import request from "supertest";
import { openDatabase } from "../server/db.js";
import { createApp } from "../server/app.js";
import { incidentBody, reportDue, retainUntil } from "../server/incidents.js";
// 사고 · 아차사고 기록: due-date guide, roles, fixed confirmed records, linked corrections, escaped print.
const origin = "http://127.0.0.1:3000";
const body = {
  kind: "accident", occurredAt: "2026-01-31T10:15", location: "<script>A동</script>", workType: "철근 운반", injured: "합성 근로자 · 합성 소속 · 철근공",
  lostDays3Plus: true, description: "운반 중 넘어짐", cause: "", immediateAction: "병원 이송", preventionPlan: "",
};
test("incident guides: report due one month later (clamped), three-year retention, strict input", () => {
  assert.equal(reportDue("2026-01-31T10:15"), "2026-02-28");
  assert.equal(reportDue("2028-01-31T00:00"), "2028-02-29");
  assert.equal(reportDue("2026-12-15T08:00"), "2027-01-15");
  assert.equal(retainUntil("2026-03-02T09:00"), "2029-03-02");
  assert.equal(incidentBody.safeParse({ ...body, severity: 3 }).success, false);
  assert.equal(incidentBody.safeParse({ ...body, occurredAt: "2026-02-30T10:00" }).success, false);
});
test("incident records: editors write, managers confirm, confirmed rows are fixed, corrections link back", async () => {
  const db = openDatabase(":memory:"), password = randomUUID(), site = randomUUID();
  const users = { m: "m@example.test", ed: "ed@example.test", ed2: "ed2@example.test", v: "v@example.test" } as const;
  db.prepare("INSERT INTO sites(id,name) VALUES(?,?)").run(site, "합성 현장");
  for (const [id, email] of Object.entries(users)) {
    db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(id, email, "합성 " + id, await argon2.hash(password));
    db.prepare("INSERT INTO memberships VALUES(?,?,?)").run(site, id, id === "m" ? "manager" : id === "v" ? "viewer" : "editor");
  }
  const app = await createApp(db, { origin, secret: "synthetic-incident-secret-".repeat(2) });
  async function login(email: string) {
    const a = request.agent(app);
    let r = await a.get("/api/session");
    r = await a.post("/api/login").set("Origin", origin).set("x-csrf-token", r.body.csrf).send({ email, password });
    const csrf = r.body.csrf as string;
    const send = (method: "post" | "put", path: string, data: object) => a[method](`/api/sites/${site}${path}`).set("Origin", origin).set("x-csrf-token", csrf).set("idempotency-key", randomUUID()).send(data);
    return { a, send };
  }
  try {
    const m = await login(users.m), ed = await login(users.ed), ed2 = await login(users.ed2), v = await login(users.v);
    assert.equal((await v.send("post", "/incidents", body)).status, 403);
    let r = (await ed.send("post", "/incidents", body)).body;
    assert.deepEqual([r.status, r.version, r.reportDue, r.retainUntil], ["draft", 1, "2026-02-28", "2029-01-31"]);
    const id = r.id;
    assert.equal((await ed2.send("put", `/incidents/${id}`, { version: 1, body })).status, 403, "only the author or a manager edits a draft");
    assert.equal((await ed.send("post", `/incidents/${id}/confirm`, { version: 1 })).status, 403);
    assert.equal((await m.send("post", `/incidents/${id}/confirm`, { version: 1 })).status, 400, "cause and prevention plan first");
    r = (await ed.send("put", `/incidents/${id}`, { version: 1, body: { ...body, cause: "통로 적재물", preventionPlan: "통로 적재 금지 표지·일일 점검" } })).body;
    assert.equal(r.version, 2);
    assert.equal((await ed.send("put", `/incidents/${id}`, { version: 1, body })).status, 409, "stale version");
    // home task for managers only, until the filing date is recorded
    assert.deepEqual((await m.a.get(`/api/sites/${site}/incident-tasks`)).body.items.map((t: { id: string; due: string }) => [t.id, t.due]), [[id, "2026-02-28"]]);
    assert.deepEqual((await ed.a.get(`/api/sites/${site}/incident-tasks`)).body.items, []);
    r = (await m.send("post", `/incidents/${id}/confirm`, { version: 2 })).body;
    assert.equal(r.status, "confirmed");
    assert.equal(r.confirmed.by.name, "합성 m");
    assert.match(r.confirmedHash, /^[0-9a-f]{64}$/);
    assert.equal((await m.send("put", `/incidents/${id}`, { version: 3, body })).status, 409, "confirmed is fixed");
    assert.throws(() => db.prepare("UPDATE incidents SET body='{}' WHERE id=?").run(id), /확정된 사고 기록은 바꿀 수 없습니다/);
    r = (await m.send("post", `/incidents/${id}/report`, { version: 3, filedOn: "2026-02-20", note: "고용노동부 전자 신고" })).body;
    assert.deepEqual([r.reportFiledOn, r.version], ["2026-02-20", 4]);
    assert.deepEqual((await m.a.get(`/api/sites/${site}/incident-tasks`)).body.items, []);
    // near miss: no report date to record
    const near = (await ed.send("post", "/incidents", { ...body, kind: "near_miss", lostDays3Plus: false, injured: "" })).body;
    assert.equal(near.reportDue, null);
    assert.equal((await m.send("post", `/incidents/${near.id}/report`, { version: 1, filedOn: "2026-02-20", note: "" })).status, 400);
    // correction: a new draft linked to the fixed one, once
    const rev = (await m.send("post", `/incidents/${id}/revise`, { version: 4, reason: "작업 종류 정정" })).body;
    assert.deepEqual([rev.status, rev.parentId, rev.reportFiledOn], ["draft", id, "2026-02-20"]);
    assert.equal((await m.send("post", `/incidents/${id}/revise`, { version: 4, reason: "또" })).status, 409);
    assert.equal((await m.a.get(`/api/sites/${site}/incidents/${id}`)).body.successorId, rev.id);
    const html = (await v.a.get(`/api/sites/${site}/incidents/${id}/print`)).text;
    assert.ok(html.includes("&lt;script&gt;A동&lt;/script&gt;") && !html.includes("<script>A동"), "print escapes input");
    assert.match(html, /앱이 판단하거나 대신하지 않습니다/);
    assert.equal((await v.a.get(`/api/sites/${site}/incidents`)).body.items.length, 3);
  } finally { db.close(); }
});
