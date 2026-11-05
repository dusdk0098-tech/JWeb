import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import request from "supertest";
import { openDatabase } from "../server/db.js";
import { createApp } from "../server/app.js";
import { sha } from "../server/tbm-join.js";
import { SIGNUP_CONSENT } from "../server/consent-text.js";
// 근로자 QR 가입: a manager's join link, signup with name + birth date + consent, worker login, '내 정보' behind the birth date.
const origin = "http://127.0.0.1:3000";
const allConsent = { consentVersion: SIGNUP_CONSENT.version, agreed: SIGNUP_CONSENT.items.map((i) => i.id) };
test("worker QR signup, login with name and birth date, profile behind the birth date", async () => {
  const db = openDatabase(":memory:"), password = "synthetic-manager-pw", site = randomUUID(), site2 = randomUUID();
  db.prepare("INSERT INTO sites(id,name) VALUES(?,?),(?,?)").run(site, "합성 현장", site2, "합성 둘째 현장");
  for (const [id, email, role] of [["m", "m@example.test", "manager"], ["ed", "ed@example.test", "editor"]]) {
    db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(id, email, "합성 " + id, await argon2.hash(password));
    db.prepare("INSERT INTO memberships VALUES(?,?,?)").run(site, id, role);
  }
  db.prepare("INSERT INTO memberships VALUES(?,?,?)").run(site2, "m", "manager");
  const app = await createApp(db, { origin, secret: "synthetic-signup-secret-".repeat(3) });
  const agent = async () => { const a = request.agent(app); return { a, csrf: (await a.get("/api/session")).body.csrf as string }; };
  const post = (c: { a: ReturnType<typeof request.agent>; csrf: string }, path: string, body: object, method: "post" | "put" = "post") =>
    c.a[method]("/api" + path).set("Origin", origin).set("x-csrf-token", c.csrf).set("idempotency-key", randomUUID()).send(body);
  async function login(email: string) {
    const c = await agent(), r = await post(c, "/login", { email, password });
    return { a: c.a, csrf: r.body.csrf as string };
  }
  try {
    const m = await login("m@example.test"), ed = await login("ed@example.test");
    assert.equal((await post(ed, `/sites/${site}/join-links`, { days: 7 })).status, 403, "managers make join QRs");
    assert.equal((await post(m, `/sites/${site}/join-links`, { days: 3 })).status, 400);
    const link = (await post(m, `/sites/${site}/join-links`, { days: 7 })).body;
    assert.match(link.token, /^[A-Za-z0-9_-]{43}$/);

    const anon = await agent();
    const info = (await post(anon, "/site-join/info", { token: link.token })).body;
    assert.equal(info.siteName, "합성 현장");
    const join = { token: link.token, name: "합성 근로자", birth: "850315", affiliation: "합성건설", ...allConsent };
    assert.equal((await post(anon, "/site-join", { ...join, agreed: ["collect"] })).status, 400, "every required consent");
    assert.equal((await post(anon, "/site-join", { ...join, birth: "851399" })).status, 400);
    assert.equal((await post(anon, "/site-join", { ...join, residentNo: "1234567" })).status, 400, "no resident number field");
    assert.deepEqual((await post(anon, "/site-join", join)).body, { siteName: "합성 현장", created: true, joined: true });
    assert.deepEqual((await post(anon, "/site-join", { ...join, name: "합성  근로자" })).body, { siteName: "합성 현장", created: false, joined: false }, "same person");
    const row = db.prepare("SELECT * FROM worker_accounts").get() as { birth_hash: string };
    assert.ok(!JSON.stringify(row).includes("850315"), "the birth date is stored only as a salted hash");

    // worker login
    const w = await agent();
    assert.equal((await post(w, "/login/worker", { name: "합성 근로자", birth: "850316" })).status, 401);
    const r = await post(w, "/login/worker", { name: "합성 근로자", birth: "850315" });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual([r.body.user.worker, r.body.user.email], [true, "근로자 · 합성건설"]);
    const wc = { a: w.a, csrf: r.body.csrf as string };
    assert.deepEqual((await w.a.get("/api/sites")).body.map((s: { name: string; role: string }) => [s.name, s.role]), [["합성 현장", "editor"]]);
    assert.equal((await post(await agent(), "/login", { email: `w:${r.body.user.id}`, password: "x" })).status, 400, "no e-mail/password login for workers");
    const members = (await m.a.get(`/api/sites/${site}/members`)).body as { name: string; email: string; role: string }[];
    assert.deepEqual(members.find((x) => x.name === "합성 근로자"), { id: r.body.user.id, name: "합성 근로자", email: "근로자 · 합성건설", role: "editor" });

    // the same person joins a second site; a revoked or expired link no longer works
    const link2 = (await post(m, `/sites/${site2}/join-links`, { days: 1 })).body;
    assert.deepEqual((await post(anon, "/site-join", { ...join, token: link2.token })).body, { siteName: "합성 둘째 현장", created: false, joined: true });
    assert.equal((await post(m, `/sites/${site}/join-links/${link.id}/revoke`, {})).status, 200);
    assert.equal((await post(m, `/sites/${site}/join-links/${link.id}/revoke`, {})).status, 404);
    assert.equal((await post(anon, "/site-join/info", { token: link.token })).status, 410);
    assert.equal((await post(anon, "/site-join", join)).status, 410);
    const old = "o".repeat(43);
    db.prepare("INSERT INTO site_join_links VALUES(?,?,?,'editor','2020-01-01T00:00:00.000Z',NULL,'m','2019-12-31T00:00:00.000Z')").run(randomUUID(), site, sha(old));
    assert.equal((await post(anon, "/site-join/info", { token: old })).status, 410);
    const listed = (await m.a.get(`/api/sites/${site}/join-links`)).body.items as { id: string; joined: number; revoked_at: string | null }[];
    assert.deepEqual(listed.filter((l) => l.id === link.id).map((l) => [l.joined, !!l.revoked_at]), [[2, true]]);
    assert.throws(() => db.prepare("UPDATE signup_consents SET text_version='x'").run(), /Consent immutable/);

    // '내 정보' opens only after the birth date is entered again
    assert.equal((await wc.a.get("/api/account/worker")).status, 403);
    assert.equal((await post(wc, "/account/worker/unlock", { birth: "850316" })).status, 401);
    assert.equal((await post(wc, "/account/worker/unlock", { birth: "850315" })).status, 200);
    const me = (await wc.a.get("/api/account/worker")).body;
    assert.deepEqual([me.name, me.affiliation, me.sites.length, me.consents.length], ["합성 근로자", "합성건설", 2, 3]);
    assert.deepEqual((await post(wc, "/account/worker", { name: "합성 근로자", affiliation: "합성전기" }, "put")).body, { saved: true, relogin: false });
    assert.equal((await post(wc, "/account/worker", { name: "합성 새이름", affiliation: "합성전기" }, "put")).status, 400, "renaming needs the birth date");
    assert.deepEqual((await post(wc, "/account/worker", { name: "합성 새이름", affiliation: "합성전기", birth: "850315" }, "put")).body, { saved: true, relogin: true });
    assert.equal((await wc.a.get("/api/sites")).status, 401, "sessions end after the sign-in name changes");
    assert.equal((await post(await agent(), "/login/worker", { name: "합성 근로자", birth: "850315" })).status, 401);
    assert.equal((await post(await agent(), "/login/worker", { name: "합성 새이름", birth: "850315" })).status, 200);
    assert.equal((await post(m, "/account/worker/unlock", { birth: "850315" })).status, 403, "not a worker account");
  } finally { db.close(); }
});
