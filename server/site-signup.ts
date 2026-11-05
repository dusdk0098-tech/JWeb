import type { Express, Request } from "express";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import argon2 from "argon2";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { audit, transaction, type Db } from "./db.js";
import { HttpError, type SiteOperations } from "./site-operations.js";
import { birthHash, nameKey, sha } from "./tbm-join.js";
import { SIGNUP_CONSENT } from "./consent-text.js";
// 근로자 QR 가입 (2026-11-05 사용자 결정). A site manager makes a join QR; a worker who scans it signs up with name, date of
// birth (6 digits) and affiliation, agrees to the signup consent and enters the site at once as an editor. Workers sign in
// with name + date of birth — the owner's choice, accepted with its risk: anyone who knows both can sign in as that worker
// (failed tries are rate-limited). Only a salted hash of the birth date is stored; resident registration numbers are not
// collected. The same name + birth date is treated as the same person, who then joins one more site.
export function migrateSiteSignup(db: Db) {
  db.exec(`
CREATE TABLE IF NOT EXISTS site_join_links(id TEXT PRIMARY KEY,site_id TEXT NOT NULL REFERENCES sites(id),token_hash TEXT NOT NULL UNIQUE,role TEXT NOT NULL CHECK(role='editor'),
  expires_at TEXT NOT NULL,revoked_at TEXT,created_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS site_join_links_site ON site_join_links(site_id,created_at);
CREATE TRIGGER IF NOT EXISTS site_join_link_fixed BEFORE UPDATE ON site_join_links WHEN
  OLD.revoked_at IS NOT NULL OR NEW.id IS NOT OLD.id OR NEW.site_id IS NOT OLD.site_id OR NEW.token_hash IS NOT OLD.token_hash OR NEW.role IS NOT OLD.role OR
  NEW.expires_at IS NOT OLD.expires_at OR NEW.created_by IS NOT OLD.created_by OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT,'Join link fixed; revoke once'); END;
CREATE TABLE IF NOT EXISTS worker_accounts(user_id TEXT PRIMARY KEY REFERENCES users(id),name_key TEXT NOT NULL,salt TEXT NOT NULL,birth_hash TEXT NOT NULL,
  affiliation TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS worker_accounts_name ON worker_accounts(name_key);
CREATE TABLE IF NOT EXISTS signup_consents(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),site_id TEXT REFERENCES sites(id),link_id TEXT REFERENCES site_join_links(id),
  text_version TEXT NOT NULL,items TEXT NOT NULL,at TEXT NOT NULL);
CREATE TRIGGER IF NOT EXISTS signup_consent_fixed BEFORE UPDATE ON signup_consents BEGIN SELECT RAISE(ABORT,'Consent immutable'); END;
CREATE TRIGGER IF NOT EXISTS signup_consent_retained BEFORE DELETE ON signup_consents BEGIN SELECT RAISE(ABORT,'Consent retained'); END;
PRAGMA user_version=79`);
}
const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const validBirth = (v: string) => { const m = Number(v.slice(2, 4)), d = Number(v.slice(4, 6)); return m >= 1 && m <= 12 && d >= 1 && d <= new Date(2000, m, 0).getDate(); };
export const birth6 = z.string().regex(/^\d{6}$/, "생년월일 6자리(예: 850315)를 숫자로 입력하세요.").refine(validBirth, "생년월일을 확인하세요.");
const personName = z.string().trim().min(1).max(100);
const affiliation = z.string().trim().min(1).max(100);
type WorkerRow = { user_id: string; name_key: string; salt: string; birth_hash: string; affiliation: string };
const sameBirth = (w: WorkerRow, birth: string) => timingSafeEqual(Buffer.from(birthHash(birth, w.salt), "hex"), Buffer.from(w.birth_hash, "hex"));
/** The worker account with this name and date of birth, if any. */
export function findWorker(db: Db, name: string, birth: string) {
  const rows = db.prepare("SELECT * FROM worker_accounts WHERE name_key=?").all(nameKey(name)) as WorkerRow[];
  return rows.find((w) => sameBirth(w, birth))?.user_id;
}
function openLink(db: Db, t: string) {
  const l = db.prepare("SELECT l.*,s.name site_name FROM site_join_links l JOIN sites s ON s.id=l.site_id WHERE l.token_hash=?").get(sha(t)) as
    { id: string; site_id: string; role: string; expires_at: string; revoked_at: string | null; site_name: string } | undefined;
  if (!l || l.revoked_at || l.expires_at <= new Date().toISOString()) throw new HttpError(410, "만료되었거나 회수된 가입 QR입니다. 현장 관리자에게 새 QR을 요청하세요.");
  return l;
}
// Public (no login) routes; CSRF/Origin checks still apply. Register before the sign-in gate.
export function registerSiteSignupPublic(app: Express, db: Db) {
  const unusable = argon2.hash(randomBytes(32), { type: argon2.argon2id }); // worker accounts have no password
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: "draft-8", legacyHeaders: false,
    keyGenerator: (req) => sha(String(req.body?.token ?? "")), // behind a tunnel every request has one IP
    message: { error: "가입 시도가 많습니다. 15분 후 다시 시도하거나 현장 관리자에게 문의하세요." },
  });
  app.post("/api/site-join/info", (req, res) => {
    const l = openLink(db, z.object({ token }).strict().parse(req.body).token);
    res.json({ siteName: l.site_name, expiresAt: l.expires_at, consent: SIGNUP_CONSENT });
  });
  app.post("/api/site-join", limiter, async (req, res, next) => {
    try {
      const v = z.object({
        token, name: personName, birth: birth6, affiliation,
        consentVersion: z.literal(SIGNUP_CONSENT.version, { message: "동의문이 바뀌었습니다. 화면을 새로 고쳐 다시 확인하세요." }),
        agreed: z.array(z.string().max(40)).max(10),
      }).strict().parse(req.body);
      if (SIGNUP_CONSENT.items.some((i) => i.required && !v.agreed.includes(i.id))) throw new HttpError(400, "필수 동의 항목에 모두 체크해야 가입할 수 있습니다.");
      const hash = await unusable;
      const r = transaction(db, () => {
        const l = openLink(db, v.token), at = new Date().toISOString();
        let user = findWorker(db, v.name, v.birth);
        const created = !user;
        if (!user) {
          user = randomUUID();
          const salt = randomBytes(16).toString("hex");
          db.prepare("INSERT INTO users(id,email,name,password_hash) VALUES(?,?,?,?)").run(user, `w:${user}`, v.name, hash);
          db.prepare("INSERT INTO worker_accounts VALUES(?,?,?,?,?,?,?)").run(user, nameKey(v.name), salt, birthHash(v.birth, salt), v.affiliation, at, at);
        } else db.prepare("UPDATE worker_accounts SET affiliation=?,updated_at=? WHERE user_id=?").run(v.affiliation, at, user);
        const joined = !db.prepare("SELECT 1 FROM memberships WHERE site_id=? AND user_id=?").get(l.site_id, user);
        if (joined) db.prepare("INSERT INTO memberships VALUES(?,?,?)").run(l.site_id, user, l.role);
        db.prepare("INSERT INTO signup_consents VALUES(?,?,?,?,?,?,?)").run(randomUUID(), user, l.site_id, l.id, SIGNUP_CONSENT.version, JSON.stringify(v.agreed), at);
        audit(db, user, l.site_id, created ? "worker.signed_up" : "worker.joined", user);
        return { siteName: l.site_name, created, joined };
      });
      res.json(r);
    } catch (e) { next(e); }
  });
}
// Site managers: make, list and revoke join QR links for their site.
export function registerSiteJoinLinks(app: Express, db: Db, { access, mutate }: SiteOperations) {
  const base = "/api/sites/:siteId/join-links", site = (req: Request) => String(req.params.siteId);
  app.get(base, (req, res) => {
    access(req, false, true);
    res.json({ items: db.prepare(`SELECT l.id,l.expires_at,l.revoked_at,l.created_at,(SELECT count(*) FROM signup_consents c WHERE c.link_id=l.id) joined
      FROM site_join_links l WHERE l.site_id=? ORDER BY l.created_at DESC LIMIT 20`).all(site(req)) });
  });
  app.post(base, (req, res) => {
    access(req, true, true);
    const v = z.object({ days: z.union([z.literal(1), z.literal(7), z.literal(30)]) }).strict().parse(req.body);
    mutate(req, res, `site:${site(req)}:join-link`, v, () => {
      const id = randomUUID(), t = randomBytes(32).toString("base64url"), at = new Date(), expires = new Date(at.getTime() + v.days * 86400000).toISOString();
      db.prepare("INSERT INTO site_join_links VALUES(?,?,?,'editor',?,NULL,?,?)").run(id, site(req), sha(t), expires, req.session.userId!, at.toISOString());
      audit(db, req.session.userId!, site(req), "join_link.created", id);
      return { id, token: t, expiresAt: expires };
    }, () => { access(req, true, true); });
  });
  app.post(base + "/:id/revoke", (req, res) => {
    access(req, true, true);
    const id = String(req.params.id);
    mutate(req, res, `site:${site(req)}:join-link:${id}:revoke`, {}, () => {
      const r = db.prepare("UPDATE site_join_links SET revoked_at=? WHERE id=? AND site_id=? AND revoked_at IS NULL").run(new Date().toISOString(), id, site(req));
      if (!r.changes) throw new HttpError(404, "회수할 가입 QR을 찾을 수 없습니다.");
      audit(db, req.session.userId!, site(req), "join_link.revoked", id);
      return { id, revoked: true };
    }, () => { access(req, true, true); });
  });
}
// 근로자 '내 정보': the date of birth is asked again before the page opens (2026-11-05 사용자 결정, instead of a resident number).
const UNLOCK_MS = 10 * 60 * 1000;
export function registerWorkerProfile(app: Express, db: Db) {
  const worker = (req: Request) => {
    const w = db.prepare("SELECT * FROM worker_accounts WHERE user_id=?").get(req.session.userId!) as WorkerRow | undefined;
    if (!w) throw new HttpError(403, "근로자 계정만 쓸 수 있습니다.");
    return w;
  };
  const unlocked = (req: Request) => {
    const at = req.session.workerUnlockedAt;
    if (!at || Date.now() - at > UNLOCK_MS) throw new HttpError(403, "생년월일을 다시 입력해야 볼 수 있습니다.");
  };
  app.post("/api/account/worker/unlock", rateLimit({
    windowMs: 15 * 60 * 1000, limit: 5, skipSuccessfulRequests: true, standardHeaders: "draft-8", legacyHeaders: false,
    keyGenerator: (req) => String(req.session.userId), message: { error: "확인 시도가 많습니다. 15분 후 다시 시도하세요." },
  }), (req, res) => {
    const w = worker(req), { birth } = z.object({ birth: birth6 }).strict().parse(req.body);
    if (!sameBirth(w, birth)) throw new HttpError(401, "생년월일이 맞지 않습니다.");
    req.session.workerUnlockedAt = Date.now();
    res.json({ unlockedUntil: new Date(req.session.workerUnlockedAt + UNLOCK_MS).toISOString() });
  });
  app.get("/api/account/worker", (req, res) => {
    const w = worker(req);
    unlocked(req);
    const u = db.prepare("SELECT name FROM users WHERE id=?").get(w.user_id) as { name: string };
    res.json({
      name: u.name, affiliation: w.affiliation,
      sites: db.prepare("SELECT s.name,m.role FROM memberships m JOIN sites s ON s.id=m.site_id WHERE m.user_id=? ORDER BY s.name").all(w.user_id),
      consents: db.prepare("SELECT c.text_version version,c.at,s.name site FROM signup_consents c LEFT JOIN sites s ON s.id=c.site_id WHERE c.user_id=? ORDER BY c.at").all(w.user_id),
    });
  });
  app.put("/api/account/worker", (req, res) => {
    const w = worker(req);
    unlocked(req);
    const v = z.object({ name: personName, affiliation, birth: birth6.optional() }).strict().parse(req.body);
    const renamed = nameKey(v.name) !== w.name_key;
    if (renamed && !v.birth) throw new HttpError(400, "이름을 바꾸려면 생년월일도 함께 입력하세요.");
    const relogin = renamed || !!v.birth;
    transaction(db, () => {
      const other = v.birth && findWorker(db, v.name, v.birth);
      if (other && other !== w.user_id) throw new HttpError(409, "같은 이름·생년월일로 가입한 다른 계정이 있습니다. 현장 관리자에게 문의하세요.");
      const at = new Date().toISOString(), salt = v.birth ? randomBytes(16).toString("hex") : w.salt;
      db.prepare("UPDATE users SET name=? WHERE id=?").run(v.name, w.user_id);
      db.prepare("UPDATE worker_accounts SET name_key=?,salt=?,birth_hash=?,affiliation=?,updated_at=? WHERE user_id=?")
        .run(nameKey(v.name), salt, v.birth ? birthHash(v.birth, salt) : w.birth_hash, v.affiliation, at, w.user_id);
      if (relogin) { // the sign-in name or birth date changed: every session of this account ends
        db.prepare("UPDATE account_auth SET epoch=epoch+1 WHERE user_id=?").run(w.user_id);
        db.prepare("DELETE FROM sessions WHERE json_extract(data,'$.userId')=?").run(w.user_id);
      }
    });
    res.json({ saved: true, relogin });
  });
}
