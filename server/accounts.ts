import type { Express, Request } from "express";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import { z } from "zod";
import { transaction, type Db } from "./db.js";
import { HttpError, type SiteOperations } from "./site-operations.js";
import { isLocalRequest } from "./local-admin.js";
// 계정 발급 (docs/UI_REDESIGN_PLAN.md 결정 10). Accounts were CLI-only (scripts/provision.ts, still available).
// - Operator: sits at the install PC. While no operator exists, a browser on the install PC may create the first one
//   without signing in (the same trust as running the CLI there). Operators issue accounts, reset passwords and grant
//   or revoke the "issuer" right — only from the install PC (isLocalRequest), never through a domain or tunnel.
// - Issuer: a manager the operator trusted. From anywhere, they create accounts that join their own site and reset
//   the passwords of that site's non-manager members.
// Every issuance and reset is written to account_issuance_events with the actor. A reset bumps the account epoch, so the old
// sessions end. No sign-up, no e-mail, no self-service reset: the issuer hands the first password over in person.
export function migrateAccountGrants(db: Db) {
  db.exec(`
CREATE TABLE IF NOT EXISTS account_grants(user_id TEXT PRIMARY KEY REFERENCES users(id),
  operator INTEGER NOT NULL DEFAULT 0 CHECK(operator IN (0,1)), issuer INTEGER NOT NULL DEFAULT 0 CHECK(issuer IN (0,1)),
  granted_by TEXT, granted_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS account_issuance_events(id INTEGER PRIMARY KEY, event TEXT NOT NULL, user_id TEXT NOT NULL, actor_id TEXT, site_id TEXT, at TEXT NOT NULL);
PRAGMA user_version=72`);
}
const password = z.string().min(12).max(128);
const newAccount = z
  .object({ name: z.string().trim().min(1).max(100), email: z.email().max(254).transform((v) => v.toLowerCase()), password })
  .strict();
export type Grants = { operator: boolean; issuer: boolean };
export function grantsOf(db: Db, user: string): Grants {
  const g = db.prepare("SELECT operator,issuer FROM account_grants WHERE user_id=?").get(user) as { operator: number; issuer: number } | undefined;
  return { operator: !!g?.operator, issuer: !!g?.issuer };
}
// Install-wide settings that reach outside this PC (외부 접속 마법사): an operator, in a browser on the install PC.
export function requireLocalOperator(db: Db, req: Request) {
  const user = req.session.userId;
  if (!user) throw new HttpError(401, "로그인이 필요합니다.");
  if (!isLocalRequest(req) || !grantsOf(db, user).operator) throw new HttpError(403, "외부 접속 설정은 이 앱이 설치된 PC에서 운영자만 바꿀 수 있습니다.");
  return user;
}
const hasOperator = (db: Db) => !!db.prepare("SELECT 1 FROM account_grants WHERE operator=1 LIMIT 1").get();
const NOT_LOCAL = "계정 발급·운영자 기능은 이 앱이 설치된 PC에서 직접 접속했을 때만 쓸 수 있습니다.";
function event(db: Db, kind: string, user: string, actor: string | null, site: string | null) {
  db.prepare("INSERT INTO account_issuance_events(event,user_id,actor_id,site_id,at) VALUES(?,?,?,?,?)").run(kind, user, actor, site, new Date().toISOString());
}
function createUser(db: Db, input: z.infer<typeof newAccount>, hash: string) {
  if (db.prepare("SELECT 1 FROM users WHERE email=?").get(input.email)) throw new HttpError(409, "이미 있는 이메일입니다.");
  const id = randomUUID();
  db.prepare("INSERT INTO users(id,email,name,password_hash) VALUES(?,?,?,?)").run(id, input.email, input.name, hash);
  return id;
}
function resetPassword(db: Db, user: string, hash: string) {
  if (!db.prepare("SELECT 1 FROM users WHERE id=?").get(user)) throw new HttpError(404, "계정을 찾을 수 없습니다.");
  db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(hash, user);
  db.prepare("UPDATE account_auth SET epoch=epoch+1 WHERE user_id=?").run(user); // ends the account's sessions
}
const hashOf = (value: string) => argon2.hash(value, { type: argon2.argon2id });
/** Anonymous routes: registered before the sign-in gate. */
export function registerSetup(app: Express, db: Db) {
  app.get("/api/setup", (req, res) => res.json({ needsOperator: !hasOperator(db), local: isLocalRequest(req) }));
  app.post("/api/setup/operator", async (req, res, next) => {
    try {
      if (!isLocalRequest(req)) throw new HttpError(403, NOT_LOCAL);
      if (hasOperator(db)) throw new HttpError(409, "운영자 계정이 이미 있습니다. 운영자로 로그인해 계정 발급에서 만드세요.");
      const input = newAccount.parse(req.body), hash = await hashOf(input.password);
      const id = transaction(db, () => {
        if (hasOperator(db)) throw new HttpError(409, "운영자 계정이 이미 있습니다.");
        const id = createUser(db, input, hash);
        db.prepare("INSERT INTO account_grants(user_id,operator,issuer,granted_by,granted_at) VALUES(?,1,1,NULL,?)").run(id, new Date().toISOString());
        event(db, "operator_created", id, null, null);
        return id;
      });
      res.json({ id, email: input.email, name: input.name });
    } catch (e) { next(e); }
  });
  // An install upgraded from before operators existed has accounts but no operator. Same trust as creating the first one
  // (install PC, no operator yet); the password proves which existing account becomes the operator.
  app.post("/api/setup/claim", async (req, res, next) => {
    try {
      if (!isLocalRequest(req)) throw new HttpError(403, NOT_LOCAL);
      if (hasOperator(db)) throw new HttpError(409, "운영자 계정이 이미 있습니다.");
      const input = z.object({ email: z.email().max(254).transform((v) => v.toLowerCase()), password: z.string().min(1).max(128) }).strict().parse(req.body);
      const user = db.prepare("SELECT id,password_hash FROM users WHERE email=?").get(input.email) as { id: string; password_hash: string } | undefined;
      if (!user || !(await argon2.verify(user.password_hash, input.password))) throw new HttpError(401, "이메일 또는 비밀번호가 맞지 않습니다.");
      transaction(db, () => {
        if (hasOperator(db)) throw new HttpError(409, "운영자 계정이 이미 있습니다.");
        db.prepare(
          "INSERT INTO account_grants(user_id,operator,issuer,granted_by,granted_at) VALUES(?,1,1,NULL,?) ON CONFLICT(user_id) DO UPDATE SET operator=1,issuer=1,granted_by=NULL,granted_at=excluded.granted_at",
        ).run(user.id, new Date().toISOString());
        event(db, "operator_claimed", user.id, null, null);
      });
      res.json({ email: input.email });
    } catch (e) { next(e); }
  });
}
export function registerAccounts(app: Express, db: Db, { access, mutate }: SiteOperations) {
  function operator(req: Request) {
    const user = req.session.userId;
    if (!user) throw new HttpError(401, "로그인이 필요합니다.");
    if (!isLocalRequest(req)) throw new HttpError(403, NOT_LOCAL);
    if (!grantsOf(db, user).operator) throw new HttpError(403, "운영자 계정만 쓸 수 있습니다.");
    return user;
  }
  app.get("/api/accounts", (req, res) => {
    operator(req);
    const items = db.prepare(
      "SELECT u.id,CASE WHEN w.user_id IS NULL THEN u.email ELSE '근로자 · ' || w.affiliation END AS email,u.name,COALESCE(g.operator,0) AS operator,COALESCE(g.issuer,0) AS issuer FROM users u LEFT JOIN account_grants g ON g.user_id=u.id LEFT JOIN worker_accounts w ON w.user_id=u.id ORDER BY u.name,u.email",
    ).all() as { id: string; email: string; name: string; operator: number; issuer: number }[];
    res.json({ items: items.map((u) => ({ ...u, operator: !!u.operator, issuer: !!u.issuer })) });
  });
  app.post("/api/accounts", async (req, res, next) => {
    try {
      const actor = operator(req);
      const input = newAccount.extend({ issuer: z.boolean().default(false) }).parse(req.body), hash = await hashOf(input.password);
      mutate(req, res, "accounts:create", input, () => {
        const id = createUser(db, input, hash);
        if (input.issuer) db.prepare("INSERT INTO account_grants(user_id,operator,issuer,granted_by,granted_at) VALUES(?,0,1,?,?)").run(id, actor, new Date().toISOString());
        event(db, "created", id, actor, null);
        return { id, email: input.email, name: input.name, operator: false, issuer: input.issuer };
      }, () => { operator(req); });
    } catch (e) { next(e); }
  });
  app.post("/api/accounts/:id/password", async (req, res, next) => {
    try {
      const actor = operator(req), id = String(req.params.id);
      const input = z.object({ password }).strict().parse(req.body), hash = await hashOf(input.password);
      mutate(req, res, `accounts:${id}:password`, { at: new Date().toISOString() }, () => {
        resetPassword(db, id, hash);
        event(db, "password_reset", id, actor, null);
        return { ok: true };
      }, () => { operator(req); });
    } catch (e) { next(e); }
  });
  app.put("/api/accounts/:id/grants", (req, res) => {
    const actor = operator(req), id = String(req.params.id);
    const input = z.object({ operator: z.boolean(), issuer: z.boolean() }).strict().parse(req.body);
    mutate(req, res, `accounts:${id}:grants`, input, () => {
      if (!db.prepare("SELECT 1 FROM users WHERE id=?").get(id)) throw new HttpError(404, "계정을 찾을 수 없습니다.");
      const operators = (db.prepare("SELECT count(*) AS n FROM account_grants WHERE operator=1").get() as { n: number }).n;
      if (!input.operator && grantsOf(db, id).operator && operators <= 1) throw new HttpError(409, "마지막 운영자의 권한은 내릴 수 없습니다.");
      db.prepare(
        "INSERT INTO account_grants(user_id,operator,issuer,granted_by,granted_at) VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET operator=excluded.operator,issuer=excluded.issuer,granted_by=excluded.granted_by,granted_at=excluded.granted_at",
      ).run(id, Number(input.operator), Number(input.issuer), actor, new Date().toISOString());
      event(db, `grants:${input.operator ? "operator" : "-"}:${input.issuer ? "issuer" : "-"}`, id, actor, null);
      return { id, ...input };
    }, () => { operator(req); });
  });
  // Issuer managers: accounts for their own site, from anywhere.
  function issuer(req: Request) {
    access(req, true, true);
    const user = req.session.userId!;
    if (!grantsOf(db, user).issuer) throw new HttpError(403, "계정 발급 권한이 없습니다. 운영자에게 발급 권한을 요청하세요.");
    return user;
  }
  app.post("/api/sites/:siteId/accounts", async (req, res, next) => {
    try {
      const actor = issuer(req), site = String(req.params.siteId);
      const input = newAccount.extend({ role: z.enum(["manager", "editor", "viewer"]) }).parse(req.body), hash = await hashOf(input.password);
      mutate(req, res, `site:${site}:account`, input, () => {
        const id = createUser(db, input, hash);
        db.prepare("INSERT INTO memberships VALUES(?,?,?)").run(site, id, input.role);
        event(db, "created", id, actor, site);
        return { id, email: input.email, name: input.name, role: input.role };
      }, () => { issuer(req); });
    } catch (e) { next(e); }
  });
  app.post("/api/sites/:siteId/accounts/:userId/password", async (req, res, next) => {
    try {
      const actor = issuer(req), site = String(req.params.siteId), id = String(req.params.userId);
      const member = () => {
        const m = db.prepare("SELECT role FROM memberships WHERE site_id=? AND user_id=?").get(site, id) as { role: string } | undefined;
        if (!m || m.role === "manager") throw new HttpError(403, "이 현장의 작성자·열람자 계정만 초기화할 수 있습니다. 관리자 계정은 운영자가 초기화합니다.");
      };
      member();
      const input = z.object({ password }).strict().parse(req.body), hash = await hashOf(input.password);
      mutate(req, res, `site:${site}:account:${id}:password`, { at: new Date().toISOString() }, () => {
        member();
        resetPassword(db, id, hash);
        event(db, "password_reset", id, actor, site);
        return { ok: true };
      }, () => { issuer(req); member(); });
    } catch (e) { next(e); }
  });
}
