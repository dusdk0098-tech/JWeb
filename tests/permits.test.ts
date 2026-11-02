import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import request from "supertest";
import { openDatabase } from "../server/db.js";
import { createApp } from "../server/app.js";
import { permitInput, PERMIT_KINDS, retainUntilPermit } from "../server/permits.js";
// 작업허가서: request needs every check decided; another manager decides (one-manager sites self-process with a note);
// requested content is fixed; the requester closes the work; print escapes input.
const origin = "http://127.0.0.1:3000";
const body = { kind: "hot", work: "<b>배관 용접</b>", location: "기계실", validFrom: "2026-11-03T08:00", validTo: "2026-11-03T17:00", workers: "합성 용접공", precautions: "불티 방지포", checks: ["pending", "yes", "yes", "na"] };
test("permit input: time window, kind's check count, strict", () => {
  assert.equal(permitInput.safeParse(body).success, true);
  assert.equal(permitInput.safeParse({ ...body, validTo: "2026-11-03T07:00" }).success, false);
  assert.equal(permitInput.safeParse({ ...body, checks: ["yes"] }).success, false);
  assert.equal(permitInput.safeParse({ ...body, kind: "confined" }).success, false, "confined has five checks");
  assert.equal(permitInput.safeParse({ ...body, risk: 1 }).success, false);
  assert.equal(PERMIT_KINDS.other.checks.length, 0);
  assert.equal(retainUntilPermit("2026-11-03T17:00"), "2027-11-03");
});
test("permits: request, independent decision, fixed content, close, home tasks, one-manager self processing", async () => {
  const db = openDatabase(":memory:"), password = randomUUID(), site = randomUUID(), solo = randomUUID();
  const users = { m: "m@example.test", m2: "m2@example.test", ed: "ed@example.test", v: "v@example.test" } as const;
  db.prepare("INSERT INTO sites(id,name) VALUES(?,?),(?,?)").run(site, "합성 현장", solo, "1인 현장");
  for (const [id, email] of Object.entries(users)) {
    db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(id, email, "합성 " + id, await argon2.hash(password));
    db.prepare("INSERT INTO memberships VALUES(?,?,?)").run(site, id, id.startsWith("m") ? "manager" : id === "v" ? "viewer" : "editor");
  }
  db.prepare("INSERT INTO memberships VALUES(?,?,?)").run(solo, "m", "manager");
  const app = await createApp(db, { origin, secret: "synthetic-permit-secret-".repeat(2) });
  async function login(email: string) {
    const a = request.agent(app);
    let r = await a.get("/api/session");
    r = await a.post("/api/login").set("Origin", origin).set("x-csrf-token", r.body.csrf).send({ email, password });
    const csrf = r.body.csrf as string;
    const send = (s: string, path: string, data: object, method: "post" | "put" = "post") => a[method](`/api/sites/${s}${path}`).set("Origin", origin).set("x-csrf-token", csrf).set("idempotency-key", randomUUID()).send(data);
    return { a, send };
  }
  try {
    const m = await login(users.m), m2 = await login(users.m2), ed = await login(users.ed), v = await login(users.v);
    assert.equal((await v.send(site, "/permits", body)).status, 403);
    let p = (await ed.send(site, "/permits", body)).body;
    const id = p.id;
    assert.deepEqual([p.status, p.kindLabel, p.checks.length], ["draft", "화기 작업", 4]);
    assert.equal((await ed.send(site, `/permits/${id}/request`, { version: 1 })).status, 400, "a check is still open");
    p = (await ed.send(site, `/permits/${id}`, { version: 1, body: { ...body, checks: ["yes", "yes", "yes", "na"] } }, "put")).body;
    assert.equal((await m.send(site, `/permits/${id}/request`, { version: 2 })).status, 403, "only the requester asks");
    p = (await ed.send(site, `/permits/${id}/request`, { version: 2 })).body;
    assert.equal(p.status, "requested");
    assert.equal((await ed.send(site, `/permits/${id}`, { version: 3, body }, "put")).status, 409);
    assert.throws(() => db.prepare("UPDATE permits SET body='{}' WHERE id=?").run(id), /요청한 작업허가서 내용은 바꿀 수 없습니다/);
    assert.deepEqual((await m.a.get(`/api/sites/${site}/permit-tasks`)).body.items.map((t: { kind: string }) => t.kind), ["review"]);
    assert.deepEqual((await ed.a.get(`/api/sites/${site}/permit-tasks`)).body.items, []);
    assert.equal((await ed.send(site, `/permits/${id}/decide`, { version: 3, approve: true, note: "" })).status, 403);
    assert.equal((await m.send(site, `/permits/${id}/decide`, { version: 3, approve: false, note: "" })).status, 400, "rejection needs a reason");
    p = (await m.send(site, `/permits/${id}/decide`, { version: 3, approve: true, note: "감시자 확인" })).body;
    assert.deepEqual([p.status, p.decision.approved, p.decision.by.name, p.decision.selfProcessed], ["approved", true, "합성 m", undefined]);
    // the window has passed (2026-11-03 17:00 is in the past relative to the test clock only if now is later) — close works either way
    assert.equal((await v.send(site, `/permits/${id}/close`, { version: 4, note: "" })).status, 403);
    p = (await ed.send(site, `/permits/${id}/close`, { version: 4, note: "잔불 없음" })).body;
    assert.deepEqual([p.status, p.closure.note, p.retainUntil], ["closed", "잔불 없음", "2027-11-03"]);
    // a manager's own request on a site with two managers waits for the other; on a one-manager site it self-processes
    let own = (await m.send(site, "/permits", { ...body, checks: ["yes", "yes", "yes", "yes"] })).body;
    own = (await m.send(site, `/permits/${own.id}/request`, { version: 1 })).body;
    assert.equal((await m.send(site, `/permits/${own.id}/decide`, { version: 2, approve: true, note: "" })).status, 403);
    assert.equal((await m2.send(site, `/permits/${own.id}/decide`, { version: 2, approve: true, note: "" })).status, 200);
    let alone = (await m.send(solo, "/permits", { ...body, kind: "other", checks: [] })).body;
    alone = (await m.send(solo, `/permits/${alone.id}/request`, { version: 1 })).body;
    alone = (await m.send(solo, `/permits/${alone.id}/decide`, { version: 2, approve: true, note: "" })).body;
    assert.equal(alone.decision.selfProcessed, "본인 처리 · 관리자 1명 현장");
    const html = (await v.a.get(`/api/sites/${site}/permits/${id}/print`)).text;
    assert.ok(html.includes("&lt;b&gt;배관 용접&lt;/b&gt;") && !html.includes("<b>배관"), "print escapes input");
    assert.match(html, /법정 허가를 대신하지 않습니다/);
  } finally { db.close(); }
});
