import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import argon2 from "argon2";
import request from "supertest";
import { openDatabase } from "../server/db.js";
import { createApp } from "../server/app.js";
import { birthHash, nameKey } from "../server/tbm-join.js";
import { MANAGER_SIGNUP_CONSENT } from "../server/consent-text.js";
// 현장 관리자 가입 신청: apply with a login ID, the operator approves onto a new or existing site or rejects; workers cannot open sites.
const origin = "http://127.0.0.1:3000";
const consent = { consentVersion: MANAGER_SIGNUP_CONSENT.version, agreed: MANAGER_SIGNUP_CONSENT.items.map((i) => i.id) };
test("manager signup: apply, operator approval onto a site, login by ID, rejection, workers cannot open sites", async () => {
  const db = openDatabase(":memory:"), password = "synthetic-operator-pw", existing = randomUUID();
  db.prepare("INSERT INTO sites(id,name) VALUES(?,?)").run(existing, "합성 기존 현장");
  for (const [id, email] of [["op", "op@example.test"], ["m", "m@example.test"], ["taken", "takenid"]]) db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(id, email, "합성 " + id, await argon2.hash(password));
  db.prepare("INSERT INTO account_grants(user_id,operator,issuer,granted_by,granted_at) VALUES('op',1,1,NULL,?)").run(new Date().toISOString());
  const app = await createApp(db, { origin, secret: "synthetic-manager-signup-".repeat(3) });
  const agent = async () => { const a = request.agent(app); return { a, csrf: (await a.get("/api/session")).body.csrf as string }; };
  const post = (c: { a: ReturnType<typeof request.agent>; csrf: string }, path: string, body: object, remote = false) => {
    const q = c.a.post("/api" + path).set("Origin", origin).set("x-csrf-token", c.csrf).set("idempotency-key", randomUUID());
    return (remote ? q.set("x-forwarded-for", "203.0.113.5") : q).send(body);
  };
  async function login(email: string, pw = password) {
    const c = await agent(), r = await post(c, "/login", { email, password: pw });
    return { a: c.a, csrf: r.body.csrf as string, status: r.status };
  }
  try {
    const anon = await agent();
    const form = { loginId: "Site.Kim", password: "synthetic-new-manager", name: "합성 김관리", affiliation: "합성건설", siteName: "합성 신규 현장", note: "", ...consent };
    assert.equal((await post(anon, "/manager-signup", { ...form, agreed: [] })).status, 400, "consent required");
    assert.equal((await post(anon, "/manager-signup", { ...form, loginId: "a b" })).status, 400);
    assert.equal((await post(anon, "/manager-signup", { ...form, password: "short" })).status, 400);
    assert.equal((await post(anon, "/manager-signup", { ...form, loginId: "takenid" })).status, 409, "an existing login");
    assert.deepEqual((await post(anon, "/manager-signup", form)).body, { received: true });
    assert.equal((await post(anon, "/manager-signup", form)).status, 409, "already pending");
    assert.equal((await login("site.kim", form.password)).status, 401, "no account before approval");

    const op = await login("op@example.test"), m = await login("m@example.test");
    assert.equal((await m.a.get("/api/manager-signups")).status, 403);
    assert.equal((await op.a.get("/api/manager-signups").set("x-forwarded-for", "203.0.113.5")).status, 403, "install PC only");
    const list = (await op.a.get("/api/manager-signups")).body;
    assert.deepEqual(list.items.map((s: { login_id: string }) => s.login_id), ["site.kim"]);
    const id = list.items[0].id as string;
    assert.equal((await post(op, `/manager-signups/${id}/approve`, { siteId: existing, newSiteName: "x" })).status, 400);
    assert.equal((await post(op, `/manager-signups/${id}/approve`, { newSiteName: "합성 신규 현장" }, true)).status, 403);
    const ok = await post(op, `/manager-signups/${id}/approve`, { newSiteName: "합성 신규 현장" });
    assert.equal(ok.status, 200, ok.text);
    assert.equal((await post(op, `/manager-signups/${id}/approve`, { siteId: existing })).status, 409, "decided once");
    assert.ok((db.prepare("SELECT count(*) n FROM inspection_templates WHERE site_id=?").get(ok.body.siteId) as { n: number }).n > 0, "new site gets the default forms");
    assert.equal((db.prepare("SELECT count(*) n FROM signup_consents WHERE user_id=?").get(ok.body.userId) as { n: number }).n, 1);

    const kim = await login("SITE.KIM", form.password);
    assert.equal(kim.status, 200, "login by ID, case-insensitive");
    assert.deepEqual((await kim.a.get("/api/sites")).body.map((s: { name: string; role: string }) => [s.name, s.role]), [["합성 신규 현장", "manager"]]);

    // onto an existing site; a rejected application keeps no password hash
    await post(anon, "/manager-signup", { ...form, loginId: "lee.site", name: "합성 이관리" });
    await post(anon, "/manager-signup", { ...form, loginId: "park.site", name: "합성 박관리" });
    const [lee, park] = (await op.a.get("/api/manager-signups")).body.items as { id: string }[];
    assert.equal((await post(op, `/manager-signups/${lee.id}/approve`, { siteId: existing })).status, 200);
    assert.deepEqual((db.prepare("SELECT role FROM memberships m JOIN users u ON u.id=m.user_id WHERE u.email='lee.site' AND m.site_id=?").get(existing) as { role: string }).role, "manager");
    assert.equal((await post(op, `/manager-signups/${park.id}/reject`, { note: "" })).status, 400);
    assert.equal((await post(op, `/manager-signups/${park.id}/reject`, { note: "현장 확인 불가" })).status, 200);
    assert.deepEqual({ ...(db.prepare("SELECT status,password_hash FROM manager_signups WHERE id=?").get(park.id) as object) }, { status: "rejected", password_hash: "" });
    assert.throws(() => db.prepare("UPDATE manager_signups SET status='pending' WHERE id=?").run(park.id), /already decided/);
    assert.deepEqual((await op.a.get("/api/manager-signups")).body.items, []);

    // a worker account (QR signup) cannot open a site
    const salt = randomBytes(16).toString("hex"), now = new Date().toISOString();
    db.prepare("INSERT INTO users VALUES('w','w:w','합성 근로자',?)").run(await argon2.hash(randomBytes(16)));
    db.prepare("INSERT INTO worker_accounts VALUES('w',?,?,?,'합성건설',?,?)").run(nameKey("합성 근로자"), salt, birthHash("850315", salt), now, now);
    const wc = await agent(), wr = await post(wc, "/login/worker", { name: "합성 근로자", birth: "850315" });
    assert.equal(wr.status, 200, wr.text);
    assert.equal((await post({ a: wc.a, csrf: wr.body.csrf }, "/sites", { name: "근로자 현장" })).status, 403);
    assert.equal((await post(kim, "/sites", { name: "관리자 둘째 현장" })).status, 200, "managers still open sites");
  } finally { db.close(); }
});
