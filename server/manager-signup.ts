import type { Express, Request } from "express";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { audit, transaction, type Db } from "./db.js";
import { HttpError, type SiteOperations } from "./site-operations.js";
import { grantsOf } from "./accounts.js";
import { isLocalRequest } from "./local-admin.js";
import { seedDefaultTemplates } from "./default-templates.js";
import { MANAGER_SIGNUP_CONSENT } from "./consent-text.js";
// 현장 관리자 가입 신청 (2026-11-05 사용자 결정): anyone applies with their own login ID and password, the site they will run
// and the signup consent; the operator, at the install PC, approves it onto an existing site or a new one, or rejects it.
// Nothing exists as an account until the approval.
export function migrateManagerSignup(db: Db) {
  db.exec(`
CREATE TABLE IF NOT EXISTS manager_signups(id TEXT PRIMARY KEY,login_id TEXT NOT NULL,name TEXT NOT NULL,password_hash TEXT NOT NULL,affiliation TEXT NOT NULL,
  site_name TEXT NOT NULL,note TEXT NOT NULL,consent_version TEXT NOT NULL,agreed TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','approved','rejected')),created_at TEXT NOT NULL,
  decided_by TEXT REFERENCES users(id),decided_at TEXT,decision_note TEXT,user_id TEXT REFERENCES users(id),site_id TEXT REFERENCES sites(id));
CREATE UNIQUE INDEX IF NOT EXISTS manager_signups_pending ON manager_signups(login_id) WHERE status='pending';
CREATE TRIGGER IF NOT EXISTS manager_signup_decided_once BEFORE UPDATE ON manager_signups WHEN OLD.status<>'pending'
BEGIN SELECT RAISE(ABORT,'Signup already decided'); END;
PRAGMA user_version=80`);
}
export const LOGIN_ID = /^[a-z0-9][a-z0-9._-]{3,29}$/;
const MAX_PENDING = 50;
// Public (no login) route; CSRF/Origin checks still apply. Register before the sign-in gate.
export function registerManagerSignupPublic(app: Express, db: Db) {
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: "draft-8", legacyHeaders: false,
    keyGenerator: () => "manager-signup", // behind a tunnel every request has one IP: cap applications overall
    message: { error: "가입 신청이 많습니다. 15분 후 다시 시도하세요." },
  });
  app.post("/api/manager-signup", limiter, async (req, res, next) => {
    try {
      const v = z.object({
        loginId: z.string().trim().toLowerCase().regex(LOGIN_ID, "아이디는 영문 소문자·숫자·마침표·밑줄·하이픈으로 4~30자입니다."),
        password: z.string().min(12).max(128), name: z.string().trim().min(1).max(100), affiliation: z.string().trim().min(1).max(100),
        siteName: z.string().trim().min(1).max(200), note: z.string().trim().max(500),
        consentVersion: z.literal(MANAGER_SIGNUP_CONSENT.version, { message: "동의문이 바뀌었습니다. 화면을 새로 고쳐 다시 확인하세요." }),
        agreed: z.array(z.string().max(40)).max(10),
      }).strict().parse(req.body);
      if (MANAGER_SIGNUP_CONSENT.items.some((i) => i.required && !v.agreed.includes(i.id))) throw new HttpError(400, "필수 동의 항목에 모두 체크해야 신청할 수 있습니다.");
      const hash = await argon2.hash(v.password, { type: argon2.argon2id });
      transaction(db, () => {
        if (db.prepare("SELECT 1 FROM users WHERE email=?").get(v.loginId) || db.prepare("SELECT 1 FROM manager_signups WHERE login_id=? AND status='pending'").get(v.loginId))
          throw new HttpError(409, "이미 쓰거나 신청 중인 아이디입니다. 다른 아이디를 고르세요.");
        if ((db.prepare("SELECT count(*) n FROM manager_signups WHERE status='pending'").get() as { n: number }).n >= MAX_PENDING)
          throw new HttpError(429, "처리를 기다리는 신청이 많습니다. 운영자에게 직접 문의하세요.");
        db.prepare("INSERT INTO manager_signups(id,login_id,name,password_hash,affiliation,site_name,note,consent_version,agreed,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
          .run(randomUUID(), v.loginId, v.name, hash, v.affiliation, v.siteName, v.note, v.consentVersion, JSON.stringify(v.agreed), new Date().toISOString());
      });
      res.json({ received: true });
    } catch (e) { next(e); }
  });
}
type Signup = { id: string; login_id: string; name: string; password_hash: string; affiliation: string; site_name: string; consent_version: string; agreed: string; status: string; created_at: string };
// Operator at the install PC: list, approve onto a site, reject.
export function registerManagerSignups(app: Express, db: Db, { mutate }: SiteOperations) {
  const operator = (req: Request) => {
    const user = req.session.userId!;
    if (!isLocalRequest(req) || !grantsOf(db, user).operator) throw new HttpError(403, "가입 신청은 이 앱이 설치된 PC에서 운영자만 처리합니다.");
    return user;
  };
  const pending = (id: string) => {
    const s = db.prepare("SELECT * FROM manager_signups WHERE id=?").get(id) as Signup | undefined;
    if (!s) throw new HttpError(404, "가입 신청을 찾을 수 없습니다.");
    if (s.status !== "pending") throw new HttpError(409, "이미 처리한 신청입니다.");
    return s;
  };
  app.get("/api/manager-signups", (req, res) => {
    operator(req);
    res.json({
      items: db.prepare("SELECT id,login_id,name,affiliation,site_name,note,created_at FROM manager_signups WHERE status='pending' ORDER BY created_at").all(),
      sites: db.prepare("SELECT id,name FROM sites ORDER BY name").all(),
    });
  });
  app.post("/api/manager-signups/:id/approve", (req, res) => {
    operator(req);
    const id = String(req.params.id);
    const v = z.object({ siteId: z.uuid().optional(), newSiteName: z.string().trim().min(1).max(200).optional() }).strict()
      .refine((x) => !!x.siteId !== !!x.newSiteName, "기존 현장을 고르거나 새 현장 이름을 넣으세요.").parse(req.body);
    mutate(req, res, `manager-signup:${id}`, v, () => {
      const actor = operator(req), s = pending(id), at = new Date().toISOString();
      if (db.prepare("SELECT 1 FROM users WHERE email=?").get(s.login_id)) throw new HttpError(409, "같은 아이디의 계정이 이미 있습니다. 반려하고 다른 아이디로 다시 신청하게 하세요.");
      if (v.siteId && !db.prepare("SELECT 1 FROM sites WHERE id=?").get(v.siteId)) throw new HttpError(404, "현장을 찾을 수 없습니다.");
      const user = randomUUID(), site = v.siteId ?? randomUUID();
      db.prepare("INSERT INTO users(id,email,name,password_hash) VALUES(?,?,?,?)").run(user, s.login_id, s.name, s.password_hash);
      if (!v.siteId) {
        db.prepare("INSERT INTO sites(id,name) VALUES(?,?)").run(site, v.newSiteName!);
        seedDefaultTemplates(db, site, user);
      }
      db.prepare("INSERT INTO memberships VALUES(?,?,'manager')").run(site, user);
      db.prepare("INSERT INTO signup_consents VALUES(?,?,?,NULL,?,?,?)").run(randomUUID(), user, site, s.consent_version, s.agreed, s.created_at);
      db.prepare("UPDATE manager_signups SET status='approved',decided_by=?,decided_at=?,user_id=?,site_id=? WHERE id=?").run(actor, at, user, site, id);
      audit(db, actor, site, "manager_signup.approved", user);
      return { id, userId: user, siteId: site };
    }, () => { operator(req); });
  });
  app.post("/api/manager-signups/:id/reject", (req, res) => {
    operator(req);
    const id = String(req.params.id), v = z.object({ note: z.string().trim().min(1).max(500) }).strict().parse(req.body);
    mutate(req, res, `manager-signup:${id}`, v, () => {
      const actor = operator(req);
      pending(id);
      db.prepare("UPDATE manager_signups SET status='rejected',decided_by=?,decided_at=?,decision_note=?,password_hash='' WHERE id=?").run(actor, new Date().toISOString(), v.note, id);
      return { id, rejected: true };
    }, () => { operator(req); });
  });
}
