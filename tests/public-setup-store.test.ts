import test from "node:test";
import assert from "node:assert/strict";
import type { Request } from "express";
import { openDatabase } from "../server/db.js";
import { requireLocalOperator } from "../server/accounts.js";
import { clearSetup, mergeCheck, readSetup, writeSetup } from "../server/public-setup-store.js";
// 외부 접속 마법사 상태 (schema 74) and the operator-on-this-PC guard every wizard route uses.
const secret = "synthetic-setup-secret-".repeat(3), other = "another-secret-".repeat(4);
const TOKEN = "synthetic-cf-api-token-ABCD";
test("public_setup: answers, sealed Cloudflare token, checks, reset", () => {
  const db = openDatabase(":memory:");
  try {
    assert.equal((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version, 79);
    db.prepare("INSERT INTO users VALUES(?,?,?,?)").run("u1", "op@example.test", "op", "x");
    assert.equal(readSetup(db, secret), null);
    writeSetup(db, secret, "u1", { hasDomain: true, canRouter: false, recommended: "tunnel", chosen: "tunnel", cfToken: TOKEN });
    writeSetup(db, secret, "u1", { cfZoneId: "z1", cfAccountId: "a1", cfTunnelId: "t1", domain: "safety.example.test", email: "o@example.test", agreeTos: true });
    let s = readSetup(db, secret)!;
    assert.deepEqual([s.hasDomain, s.canRouter, s.chosen, s.cfToken, s.cfHint, s.cfZoneId, s.domain, s.email, s.agreeTos], [true, false, "tunnel", TOKEN, "…ABCD", "z1", "safety.example.test", "o@example.test", true]);
    const raw = JSON.stringify(db.prepare("SELECT * FROM public_setup").get());
    assert.ok(!raw.includes(TOKEN), "the token is stored sealed");
    assert.equal(readSetup(db, other)!.cfToken, undefined, "another SESSION_SECRET cannot open it");
    mergeCheck(db, secret, "u1", "dns", { status: "todo", reason: "r", at: "2026-11-02T00:00:00.000Z" });
    mergeCheck(db, secret, "u1", "firewall", { status: "ok", reason: "f", at: "2026-11-02T00:00:00.000Z" });
    s = readSetup(db, secret)!;
    assert.deepEqual(Object.keys(s.checks), ["dns", "firewall"]);
    assert.equal(s.cfToken, TOKEN, "merging checks keeps the token");
    writeSetup(db, secret, "u1", { cfToken: null });
    s = readSetup(db, secret)!;
    assert.deepEqual([s.cfToken, s.cfHint, s.cfZoneId, s.cfAccountId, s.cfTunnelId, s.chosen], [undefined, null, null, null, null, "tunnel"]);
    clearSetup(db);
    assert.equal(readSetup(db, secret), null);
  } finally { db.close(); }
});
test("requireLocalOperator: signed in, on this PC, with the operator grant", () => {
  const db = openDatabase(":memory:");
  try {
    db.prepare("INSERT INTO users VALUES(?,?,?,?)").run("op", "op@example.test", "op", "x");
    db.prepare("INSERT INTO users VALUES(?,?,?,?)").run("w", "w@example.test", "w", "x");
    db.prepare("INSERT INTO account_grants(user_id,operator,issuer,granted_by,granted_at) VALUES('op',1,0,NULL,?)").run(new Date().toISOString());
    const req = (userId: string | undefined, headers: Record<string, string> = {}, ip = "127.0.0.1") =>
      ({ session: { userId }, socket: { remoteAddress: ip }, get: (h: string) => ({ host: "127.0.0.1:3000", ...headers })[h.toLowerCase()] }) as unknown as Request;
    assert.equal(requireLocalOperator(db, req("op")), "op");
    const status = (r: Request) => { try { requireLocalOperator(db, r); return 200; } catch (e) { return (e as { status: number }).status; } };
    assert.equal(status(req(undefined)), 401);
    assert.equal(status(req("w")), 403);
    assert.equal(status(req("op", { host: "safety.example.test" })), 403);
    assert.equal(status(req("op", { "cf-connecting-ip": "203.0.113.5" })), 403);
    assert.equal(status(req("op", {}, "192.168.0.40")), 403);
  } finally { db.close(); }
});
