import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import request from "supertest";
import { openDatabase } from "../server/db.js";
import { createApp } from "../server/app.js";
import { expiryState, qualificationInput, soonLimit } from "../server/qualifications.js";
// 교육 · 자격 이수 현황: managers write once, renew or void; lists and home tasks show what expired or expires soon.
const origin = "http://127.0.0.1:3000";
const shift = (days: number) => { const d = new Date(); d.setDate(d.getDate() + days); return d.toLocaleDateString("en-CA"); };
test("qualification expiry states and input rules", () => {
  assert.equal(soonLimit("2026-12-15"), "2027-01-14");
  assert.equal(expiryState(null, "2026-11-02"), "none");
  assert.equal(expiryState("2026-11-01", "2026-11-02"), "expired");
  assert.equal(expiryState("2026-11-02", "2026-11-02"), "soon");
  assert.equal(expiryState("2026-12-02", "2026-11-02"), "soon");
  assert.equal(expiryState("2026-12-03", "2026-11-02"), "ok");
  const ok = { workerId: randomUUID(), kind: "operator", label: "이수증 1", issuedOn: "2026-01-02", expiresOn: "2029-01-01", note: "" };
  assert.equal(qualificationInput.safeParse(ok).success, true);
  assert.equal(qualificationInput.safeParse({ ...ok, replacesId: randomUUID() }).success, true);
  assert.equal(qualificationInput.safeParse({ ...ok, replacesId: "x" }).success, false);
  assert.equal(qualificationInput.safeParse({ ...ok, expiresOn: "2025-12-31" }).success, false, "expiry before issue");
  assert.equal(qualificationInput.safeParse({ ...ok, issuedOn: "2026-02-30" }).success, false);
  assert.equal(qualificationInput.safeParse({ ...ok, issuedOn: "2026-13-01" }).success, false, "no throw on an impossible month");
  assert.equal(qualificationInput.safeParse({ ...ok, kind: "resident" }).success, false);
  assert.equal(qualificationInput.safeParse({ ...ok, residentNo: "x" }).success, false);
});
test("qualifications: this site's roster, renewal, fixed rows, void once, lists and home tasks", async () => {
  const db = openDatabase(":memory:"), password = randomUUID(), site = randomUUID(), other = randomUUID();
  const users = { m: "m@example.test", ed: "ed@example.test" } as const;
  db.prepare("INSERT INTO sites(id,name) VALUES(?,?),(?,?)").run(site, "합성 현장", other, "다른 현장");
  for (const [id, email] of Object.entries(users)) {
    db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(id, email, "합성 " + id, await argon2.hash(password));
    db.prepare("INSERT INTO memberships VALUES(?,?,?)").run(site, id, id === "m" ? "manager" : "editor");
  }
  const now = new Date().toISOString(), w1 = randomUUID(), w2 = randomUUID(), outside = randomUUID();
  const worker = db.prepare("INSERT INTO workers(id,site_id,name,affiliation,kind,active,version,created_at,updated_at) VALUES(?,?,?,?,'worker',1,1,?,?)");
  worker.run(w1, site, "합성 김", "합성 소속", now, now);
  worker.run(w2, site, "합성 이", "합성 소속", now, now);
  worker.run(outside, other, "다른 박", "다른 소속", now, now);
  const app = await createApp(db, { origin, secret: "synthetic-qualification-secret-".repeat(2) });
  async function login(email: string) {
    const a = request.agent(app);
    let r = await a.get("/api/session");
    r = await a.post("/api/login").set("Origin", origin).set("x-csrf-token", r.body.csrf).send({ email, password });
    const csrf = r.body.csrf as string;
    const send = (path: string, data: object) => a.post(`/api/sites/${site}${path}`).set("Origin", origin).set("x-csrf-token", csrf).set("idempotency-key", randomUUID()).send(data);
    return { a, send };
  }
  try {
    const m = await login(users.m), ed = await login(users.ed);
    const list = async (filter: string) => (await ed.a.get(`/api/sites/${site}/qualifications?filter=${filter}`)).body.items.map((q: { id: string }) => q.id);
    const tasks = async () => (await m.a.get(`/api/sites/${site}/qualification-tasks`)).body.items.map((t: { id: string }) => t.id);
    const base = { kind: "operator", label: "조종사 교육 이수증", issuedOn: shift(-1000), note: "" };
    assert.equal((await ed.send("/qualifications", { ...base, workerId: w1, expiresOn: null })).status, 403, "managers write");
    assert.equal((await m.send("/qualifications", { ...base, workerId: outside, expiresOn: null })).status, 400, "only this site's roster");
    const expired = (await m.send("/qualifications", { ...base, workerId: w1, expiresOn: shift(-1) })).body;
    const soon = (await m.send("/qualifications", { ...base, workerId: w2, kind: "license", label: "지게차 면허", expiresOn: shift(10) })).body;
    const fine = (await m.send("/qualifications", { ...base, workerId: w2, kind: "basic", label: "기초안전 123", expiresOn: null })).body;
    assert.deepEqual([expired.state, soon.state, fine.state, soon.kindLabel], ["expired", "soon", "none", "면허 · 자격증"]);
    assert.deepEqual(await list("all"), [expired.id, soon.id, fine.id], "earliest expiry first, no expiry last");
    assert.deepEqual(await list("expired"), [expired.id]);
    assert.deepEqual(await list("soon"), [soon.id]);
    assert.deepEqual(await tasks(), [expired.id, soon.id]);
    assert.deepEqual((await ed.a.get(`/api/sites/${site}/qualification-tasks`)).body.items, []);

    // renewal: same person and kind, once; the old record leaves the filters and the alerts and sorts last
    const renew = { ...base, workerId: w2, kind: "license", label: "지게차 면허", issuedOn: shift(0), expiresOn: shift(1000), replacesId: soon.id };
    assert.equal((await ed.send("/qualifications", renew)).status, 403);
    assert.equal((await m.send("/qualifications", { ...renew, workerId: w1 })).status, 400, "same person");
    assert.equal((await m.send("/qualifications", { ...renew, kind: "other" })).status, 400, "same kind");
    assert.equal((await m.send("/qualifications", { ...renew, replacesId: randomUUID() })).status, 404);
    const renewed = (await m.send("/qualifications", renew)).body;
    assert.equal(renewed.state, "ok");
    assert.equal((await m.send("/qualifications", renew)).status, 409, "renewed once");
    assert.deepEqual(await list("soon"), []);
    assert.deepEqual(await tasks(), [expired.id]);
    const all = (await ed.a.get(`/api/sites/${site}/qualifications`)).body.items.map((q: { id: string; state: string }) => [q.id, q.state]);
    assert.deepEqual(all, [[expired.id, "expired"], [renewed.id, "ok"], [fine.id, "none"], [soon.id, "renewed"]]);

    // someone taken off the roster leaves the home alerts but stays on the list
    db.prepare("UPDATE workers SET active=0 WHERE id=?").run(w1);
    assert.deepEqual(await tasks(), []);
    assert.deepEqual(await list("expired"), [expired.id]);
    db.prepare("UPDATE workers SET active=1 WHERE id=?").run(w1);

    assert.throws(() => db.prepare("UPDATE worker_qualifications SET expires_on='2099-01-01' WHERE id=?").run(expired.id), /바꿀 수 없습니다/);
    assert.throws(() => db.prepare("UPDATE worker_qualifications SET replaces_id=NULL WHERE id=?").run(renewed.id), /바꿀 수 없습니다/);
    assert.equal((await ed.send(`/qualifications/${expired.id}/void`, { reason: "잘못 입력" })).status, 403);
    assert.equal((await m.send(`/qualifications/${expired.id}/void`, { reason: "" })).status, 400);
    assert.equal((await m.send(`/qualifications/${expired.id}/void`, { reason: "다른 사람 것" })).status, 200);
    assert.equal((await m.send(`/qualifications/${expired.id}/void`, { reason: "또" })).status, 409);
    assert.throws(() => db.prepare("UPDATE worker_qualifications SET void_reason='x' WHERE id=?").run(expired.id), /이미 무효 처리된 기록입니다/);
    assert.equal((await m.send("/qualifications", { ...base, workerId: w1, expiresOn: shift(500), replacesId: expired.id })).status, 409, "a voided record is not renewed");

    // voiding the renewal brings the old record back to the alerts
    assert.equal((await m.send(`/qualifications/${renewed.id}/void`, { reason: "번호 오기" })).status, 200);
    assert.deepEqual(await list("all"), [soon.id, fine.id]);
    assert.deepEqual(await tasks(), [soon.id]);
  } finally { db.close(); }
});
