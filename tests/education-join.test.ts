import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as joinPath } from "node:path";
import argon2 from "argon2";
import request from "supertest";
import { openDatabase } from "../server/db.js";
import { createApp } from "../server/app.js";
import { CURRENT_SCHEMA_VERSION } from "../server/schema-version.js";
import { EDUCATION_SIGNATURE_CONSENT, TBM_SIGNATURE_CONSENT } from "../server/consent-text.js";
const origin = "http://127.0.0.1:3000";
const details = { title: "합성 교육", courseLabel: "자체 과정", instructor: "합성 강사", date: "2026-11-10", startTime: "09:00", endTime: "10:00", breakMinutes: 0, location: "합성 교육장", objectives: "목표", contents: "내용" };
const tbmDetails = { title: "합성 TBM", date: "2026-11-10", time: "08:00", location: "합성 장소", facilitator: "담당", work: "정리", topics: "안전" };
// A tiny valid PNG header is enough for the server's signature check.
const png = "data:image/png;base64," + Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(40, 1)]).toString("base64");
async function fixture(path = ":memory:") {
  const db = openDatabase(path), site = randomUUID(), password = randomUUID(), hash = await argon2.hash(password), ids: Record<string, string> = {};
  db.prepare("INSERT INTO sites(id,name) VALUES(?,?)").run(site, "합성");
  for (const role of ["manager", "editor"]) {
    ids[role] = randomUUID();
    db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(ids[role], role + "@example.test", role, hash);
    db.prepare("INSERT INTO memberships VALUES(?,?,?)").run(site, ids[role], role);
  }
  const app = await createApp(db, { origin, secret: "synthetic-education-join-secret-".repeat(2) });
  const login = async (name: string) => {
    const agent = request.agent(app);
    let r = await agent.get("/api/session");
    r = await agent.post("/api/login").set("Origin", origin).set("x-csrf-token", r.body.csrf).send({ email: name + "@example.test", password });
    return { agent, csrf: r.body.csrf as string };
  };
  const m = await login("manager"), e = await login("editor"), base = `/api/sites/${site}`;
  const send = (a: typeof m, method: "post" | "put", url: string, body: object) =>
    a.agent[method](url).set("Origin", origin).set("x-csrf-token", a.csrf).set("idempotency-key", randomUUID()).send(body);
  const anon = request.agent(app), csrf = (await anon.get("/api/session")).body.csrf;
  const pub = (url: string, body: object) => anon.post(url).set("Origin", origin).set("x-csrf-token", csrf).send(body);
  const worker = (await send(m, "post", base + "/workers", { name: "박 교육", affiliation: "합성", kind: "worker" })).body.id as string;
  assert.equal((await send(m, "put", `${base}/workers/${worker}/identity`, { birthDate: "1988-03-04" })).status, 200);
  return { db, site, ids, m, e, base, send, pub, worker };
}

test("교육 QR 참여: a participant confirms by name + birth date; attendance stays manual and the link follows the content", async () => {
  const f = await fixture();
  try {
    let s = (await f.send(f.e, "post", f.base + "/education", details)).body;
    const url = `${f.base}/education/${s.id}`;
    s = (await f.send(f.e, "post", url + "/participants", { workerId: f.worker, version: s.version })).body;
    assert.equal((await f.send(f.m, "post", url + "/invitations", {})).status, 403); // only the author, like the participant routes
    let r = await f.send(f.e, "post", url + "/invitations", {});
    assert.equal(r.status, 200, r.text);
    const token = r.body.token as string;
    assert.doesNotMatch(JSON.stringify(f.db.prepare("SELECT * FROM activity_invitations").all()), new RegExp(token));
    assert.deepEqual((await f.pub("/api/join/info", { token })).body, { title: "합성 교육", date: "2026-11-10", location: "합성 교육장", kind: "education" });
    const join = (body: object) => f.pub("/api/join", { token, name: "박교육", birthDate: "1988-03-04", consentVersion: EDUCATION_SIGNATURE_CONSENT.version, decision: "deny", ...body });
    assert.equal((await join({ consentVersion: TBM_SIGNATURE_CONSENT.version })).status, 400); // the TBM consent text is not this one
    r = await join({ birthDate: "1988-03-05" });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /교육 참여 명단/);
    r = await join({ decision: "grant", signature: png });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual([r.body.name, r.body.already, r.body.signed], ["박 교육", false, true]);
    assert.equal((await join({})).body.already, true);
    assert.deepEqual({ ...(f.db.prepare("SELECT purpose,text_version,decision FROM consent_records").get() as object) }, { purpose: "education_signature", text_version: EDUCATION_SIGNATURE_CONSENT.version, decision: "grant" });
    // A participation record is not attendance: the participant is still pending until the author records it.
    s = (await f.e.agent.get(url)).body;
    assert.equal(s.participants[0].state, "pending");
    const list = (await f.e.agent.get(url + "/invitations")).body;
    assert.deepEqual(list.events.map((x: { worker_id: string; signed: number }) => [x.worker_id, x.signed]), [[f.worker, 1]]);
    assert.equal((await f.e.agent.get(`${url}/participation/${list.events[0].id}/signature`)).headers["content-type"], "image/png");
    // Marking attendance bumps the version but keeps the link valid; a second worker can still join.
    r = await f.send(f.e, "put", `${url}/participants/${f.worker}`, { version: s.version, state: "attended", attendedMinutes: 60 });
    assert.equal(r.status, 200, r.text);
    assert.equal((await f.pub("/api/join/info", { token })).status, 200);
    assert.equal((await f.e.agent.get(url + "/invitations")).body.invitations[0].current, true);
    // Editing the content ends the link; so does archiving (checked with a fresh link).
    s = (await f.e.agent.get(url)).body;
    assert.equal((await f.send(f.e, "put", url, { ...details, title: "바뀐 교육", version: s.version })).status, 200);
    assert.equal((await join({})).status, 410);
    const fresh = (await f.send(f.e, "post", url + "/invitations", {})).body;
    assert.equal((await f.send(f.e, "post", `${url}/invitations/${fresh.invitations[0].id}/revoke`, {})).status, 200);
    assert.equal((await f.pub("/api/join/info", { token: fresh.token })).status, 410);
    assert.throws(() => f.db.prepare("DELETE FROM consent_records").run(), /Consent retained/);
    assert.throws(() => f.db.prepare("INSERT INTO activity_invitations VALUES(?,?,'other',?,?,?,?,NULL,?,?)").run(randomUUID(), f.site, s.id, "h", "d", "2099-01-01", f.ids.editor, "2026-01-01"), /CHECK/);
  } finally { f.db.close(); }
});

test("schema 81 keeps every TBM invitation, participation, consent and signature row and their guards", async () => {
  const dir = mkdtempSync(joinPath(tmpdir(), "yweb-schema81-")), path = joinPath(dir, "db.sqlite");
  try {
    let f = await fixture(path);
    // Put the four tables back exactly as schemas 63/64 made them (their migrations still carry the original text), at version 80.
    const { migrateTbmJoin, migrateTbmSignatures } = await import("../server/tbm-join.js");
    f.db.exec("DROP TABLE signature_records; DROP TABLE consent_records; DROP TABLE participation_events; DROP TABLE activity_invitations;");
    migrateTbmJoin(f.db);
    migrateTbmSignatures(f.db);
    f.db.exec("PRAGMA user_version=80");
    assert.throws(() => f.db.prepare("INSERT INTO activity_invitations VALUES(?,?,'education',?,?,?,?,NULL,?,?)").run(randomUUID(), f.site, "x", "h", "d", "2099-01-01", f.ids.editor, "2026-01-01"), /CHECK/);
    // Real TBM rows written through the app on the old tables.
    let t = (await f.send(f.e, "post", f.base + "/tbm", tbmDetails)).body;
    t = (await f.send(f.e, "post", `${f.base}/tbm/${t.id}/participants`, { workerId: f.worker, version: t.version })).body;
    const made = await f.send(f.e, "post", `${f.base}/tbm/${t.id}/invitations`, {}), token = made.body.token as string;
    const joined = await f.pub("/api/join", { token, name: "박교육", birthDate: "1988-03-04", consentVersion: TBM_SIGNATURE_CONSENT.version, decision: "grant", signature: png });
    assert.equal(joined.status, 200, joined.text);
    assert.equal((await f.send(f.e, "post", `${f.base}/tbm/${t.id}/invitations/${made.body.invitations[0].id}/revoke`, {})).status, 200);
    const tables = ["activity_invitations", "participation_events", "consent_records", "signature_records"],
      dump = () => tables.map((name) => f.db.prepare(`SELECT * FROM ${name} ORDER BY id`).all().map((row) => ({ ...(row as object) })));
    const before = dump();
    assert.deepEqual(before.map((rows) => rows.length), [1, 1, 1, 1]);
    f.db.close();
    const db = openDatabase(path);
    f = { ...f, db };
    assert.equal((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version, CURRENT_SCHEMA_VERSION);
    assert.deepEqual(dump(), before); // same ids, same bytes
    assert.equal((db.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number }).foreign_keys, 1);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    assert.throws(() => db.prepare("DELETE FROM activity_invitations").run(), /Invitation retained/);
    assert.throws(() => db.prepare("UPDATE activity_invitations SET token_hash='x'").run(), /Invitation fixed/);
    assert.throws(() => db.prepare("UPDATE consent_records SET decision='deny'").run(), /Consent immutable/);
    assert.throws(() => db.prepare("DELETE FROM consent_records").run(), /Consent retained/);
    assert.throws(() => db.prepare("INSERT INTO participation_events VALUES(?,?,?,?,?,?,?,'name_birth',?)").run(randomUUID(), randomUUID(), f.site, t.id, f.worker, "x", "d", "2026-01-01"), /FOREIGN KEY/);
    const e2 = randomUUID();
    db.prepare("INSERT INTO activity_invitations VALUES(?,?,'education',?,?,?,?,NULL,?,?)").run(e2, f.site, t.id, "h2", "d", "2099-01-01", f.ids.editor, "2026-01-01");
    const p2 = randomUUID();
    db.prepare("INSERT INTO participation_events VALUES(?,?,?,?,?,?,?,'name_birth',?)").run(p2, e2, f.site, t.id, f.worker, "x", "d", "2026-01-01");
    assert.throws(() => db.prepare("INSERT INTO signature_records VALUES(?,?,?,?,?,?,?,?,?)").run(randomUUID(), p2, f.site, "d", 1, "s", Buffer.from([1]), "2026-01-01", "2029-01-01"), /Signature requires a granted consent/);
    db.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
