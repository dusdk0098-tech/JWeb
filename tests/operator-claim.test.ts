import { test } from "node:test";
import assert from "node:assert/strict";
import argon2 from "argon2";
import request from "supertest";
import { openDatabase } from "../server/db.js";
import { createApp } from "../server/app.js";
// An install upgraded from before operators has accounts but no operator: one existing account may become the operator,
// from the install PC, with its own password, only while no operator exists (docs/PC_VALIDATION.md 2026-11-05).
const origin = "http://127.0.0.1:3000";
test("an existing account claims the operator role once, from the install PC, with its password", async () => {
  const db = openDatabase(":memory:"), password = "synthetic-old-manager-pw";
  db.prepare("INSERT INTO users VALUES(?,?,?,?)").run("old", "old@example.test", "합성 기존 관리자", await argon2.hash(password));
  db.prepare("INSERT INTO users VALUES(?,?,?,?)").run("other", "other@example.test", "합성 다른 계정", await argon2.hash(password));
  const app = await createApp(db, { origin, secret: "synthetic-claim-secret-".repeat(3) });
  const anon = request.agent(app), csrf = (await anon.get("/api/session")).body.csrf as string;
  const claim = (body: object, remote = false) => {
    const q = anon.post("/api/setup/claim").set("Origin", origin).set("x-csrf-token", csrf);
    return (remote ? q.set("x-forwarded-for", "203.0.113.5") : q).send(body);
  };
  assert.equal((await anon.get("/api/setup")).body.needsOperator, true);
  assert.equal((await claim({ email: "old@example.test", password }, true)).status, 403, "not from the install PC");
  assert.equal((await claim({ email: "old@example.test", password: "wrong-password-123" })).status, 401);
  assert.equal((await claim({ email: "nobody@example.test", password })).status, 401);
  const r = await claim({ email: "OLD@example.test", password });
  assert.equal(r.status, 200, r.text);
  assert.equal((await anon.get("/api/setup")).body.needsOperator, false);
  assert.equal((await claim({ email: "other@example.test", password })).status, 409, "only while no operator exists");
  assert.deepEqual(db.prepare("SELECT event,user_id FROM account_issuance_events").all().map((e) => ({ ...e })), [{ event: "operator_claimed", user_id: "old" }]);
  const a = request.agent(app), s = await a.get("/api/session");
  assert.equal((await a.post("/api/login").set("Origin", origin).set("x-csrf-token", s.body.csrf).send({ email: "old@example.test", password })).status, 200);
  const session = (await a.get("/api/session")).body;
  assert.deepEqual([session.operator, session.issuer], [true, true]);
  db.close();
});
