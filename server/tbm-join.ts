import type { Express, Request } from "express";
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { audit, type Db } from "./db.js";
import { HttpError, type SiteOperations } from "./site-operations.js";
import { journalHash } from "./daily-journal-sources.js";
import { date } from "./validation.js";
import { SIGNATURE_MAX_BYTES, TBM_SIGNATURE_CONSENT } from "./consent-text.js";
// MOB-01 1단계 (docs/REMAINING_AREAS_SPEC.md): a time-limited TBM invitation link; a worker on the TBM roster confirms
// name + date of birth and a participation event is recorded. It does not change the TBM roster state by itself and is not
// proof of identity, attendance or a signature. Only token hashes and salted birth-date hashes are stored.
// IF NOT EXISTS: older-schema test fixtures drop only the tables they know about.
export function migrateTbmJoin(db: Db) {
  db.exec(`
 CREATE TABLE IF NOT EXISTS worker_identities(worker_id TEXT PRIMARY KEY REFERENCES workers(id),site_id TEXT NOT NULL REFERENCES sites(id),salt TEXT NOT NULL,birth_hash TEXT NOT NULL,
  updated_by TEXT NOT NULL REFERENCES users(id),updated_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS activity_invitations(id TEXT PRIMARY KEY,site_id TEXT NOT NULL REFERENCES sites(id),kind TEXT NOT NULL CHECK(kind='tbm'),activity_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,document_hash TEXT NOT NULL,expires_at TEXT NOT NULL,revoked_at TEXT,created_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS activity_invitations_activity ON activity_invitations(activity_id,created_at);
 CREATE TRIGGER IF NOT EXISTS activity_invitation_fixed BEFORE UPDATE ON activity_invitations WHEN
  OLD.revoked_at IS NOT NULL OR NEW.id IS NOT OLD.id OR NEW.site_id IS NOT OLD.site_id OR NEW.activity_id IS NOT OLD.activity_id OR NEW.token_hash IS NOT OLD.token_hash OR
  NEW.document_hash IS NOT OLD.document_hash OR NEW.expires_at IS NOT OLD.expires_at OR NEW.created_by IS NOT OLD.created_by OR NEW.created_at IS NOT OLD.created_at
 BEGIN SELECT RAISE(ABORT,'Invitation fixed; revoke once'); END;
 CREATE TRIGGER IF NOT EXISTS activity_invitation_retained BEFORE DELETE ON activity_invitations BEGIN SELECT RAISE(ABORT,'Invitation retained'); END;
 CREATE TABLE IF NOT EXISTS participation_events(id TEXT PRIMARY KEY,invitation_id TEXT NOT NULL REFERENCES activity_invitations(id),site_id TEXT NOT NULL REFERENCES sites(id),
  activity_id TEXT NOT NULL,worker_id TEXT NOT NULL REFERENCES workers(id),worker_name TEXT NOT NULL,document_hash TEXT NOT NULL,method TEXT NOT NULL CHECK(method='name_birth'),at TEXT NOT NULL,
  UNIQUE(invitation_id,worker_id));
 CREATE TRIGGER IF NOT EXISTS participation_event_fixed BEFORE UPDATE ON participation_events BEGIN SELECT RAISE(ABORT,'Participation immutable'); END;
 CREATE TRIGGER IF NOT EXISTS participation_event_retained BEFORE DELETE ON participation_events BEGIN SELECT RAISE(ABORT,'Participation retained'); END;
 PRAGMA user_version=63;
`);
}
// MOB-01 2단계: consent decision and, when granted, a hand-drawn signature PNG bound to the TBM document hash.
// Append-only; retain_until records the 3-year retention (purging is a separate, not yet approved operation).
export function migrateTbmSignatures(db: Db) {
  db.exec(`
 CREATE TABLE IF NOT EXISTS consent_records(id TEXT PRIMARY KEY,participation_id TEXT NOT NULL UNIQUE REFERENCES participation_events(id),site_id TEXT NOT NULL REFERENCES sites(id),
  purpose TEXT NOT NULL CHECK(purpose='tbm_signature'),text_version TEXT NOT NULL,decision TEXT NOT NULL CHECK(decision IN('grant','deny')),at TEXT NOT NULL,retain_until TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS signature_records(id TEXT PRIMARY KEY,participation_id TEXT NOT NULL UNIQUE REFERENCES participation_events(id),site_id TEXT NOT NULL REFERENCES sites(id),
  document_hash TEXT NOT NULL,size INTEGER NOT NULL CHECK(size BETWEEN 1 AND 153600),sha256 TEXT NOT NULL,png BLOB NOT NULL CHECK(length(png)=size),at TEXT NOT NULL,retain_until TEXT NOT NULL);
 CREATE TRIGGER IF NOT EXISTS signature_needs_grant BEFORE INSERT ON signature_records WHEN NOT EXISTS(
  SELECT 1 FROM consent_records WHERE participation_id=NEW.participation_id AND decision='grant')
 BEGIN SELECT RAISE(ABORT,'Signature requires a granted consent'); END;
 CREATE TRIGGER IF NOT EXISTS consent_record_fixed BEFORE UPDATE ON consent_records BEGIN SELECT RAISE(ABORT,'Consent immutable'); END;
 CREATE TRIGGER IF NOT EXISTS consent_record_retained BEFORE DELETE ON consent_records BEGIN SELECT RAISE(ABORT,'Consent retained'); END;
 CREATE TRIGGER IF NOT EXISTS signature_record_fixed BEFORE UPDATE ON signature_records BEGIN SELECT RAISE(ABORT,'Signature immutable'); END;
 CREATE TRIGGER IF NOT EXISTS signature_record_retained BEFORE DELETE ON signature_records BEGIN SELECT RAISE(ABORT,'Signature retained'); END;
 PRAGMA user_version=64;
`);
}
export const INVITATION_HOURS = 2;
export const sha = (v: string) => createHash("sha256").update(v).digest("hex");
export const birthHash = (birthDate: string, salt: string) => scryptSync(birthDate, salt, 32).toString("hex");
export const nameKey = (v: string) => v.normalize("NFKC").replace(/\s+/g, "");
type Session = { id: string; site_id: string; body: string; status: string; version: number };
const tbmHash = (s: Session) => journalHash({ id: s.id, version: s.version, body: JSON.parse(s.body) });
const joinInput = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/), name: z.string().trim().min(1).max(100), birthDate: date,
  consentVersion: z.literal(TBM_SIGNATURE_CONSENT.version, { message: "동의문이 바뀌었습니다. 화면을 새로 고쳐 다시 확인하세요." }),
  decision: z.enum(["grant", "deny"]), signature: z.string().max(Math.ceil((SIGNATURE_MAX_BYTES * 4) / 3) + 32).optional(),
}).strict();
const tokenInput = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict();
// Valid invitation for a still-draft TBM whose content has not changed since the invitation was made.
function openInvitation(db: Db, token: string) {
  const inv = db.prepare("SELECT * FROM activity_invitations WHERE token_hash=?").get(sha(token)) as
    { id: string; site_id: string; activity_id: string; document_hash: string; expires_at: string; revoked_at: string | null } | undefined;
  if (!inv || inv.revoked_at || inv.expires_at <= new Date().toISOString()) throw new HttpError(410, "만료되었거나 폐기된 참여 링크입니다. 담당자에게 새 링크를 요청하세요.");
  const s = db.prepare("SELECT id,site_id,body,status,version FROM tbm_sessions WHERE id=? AND site_id=?").get(inv.activity_id, inv.site_id) as Session | undefined;
  if (!s || s.status !== "draft" || tbmHash(s) !== inv.document_hash) throw new HttpError(410, "TBM 내용이 바뀌었거나 확정되어 이 링크로는 참여할 수 없습니다. 담당자에게 새 링크를 요청하세요.");
  return { inv, body: JSON.parse(s.body) as { title?: string; date?: string; location?: string } };
}
// Public (no login) routes; CSRF/Origin checks still apply. Register before the login guard.
export function registerTbmJoinPublic(app: Express, db: Db) {
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, limit: 10, skipSuccessfulRequests: true, standardHeaders: "draft-8", legacyHeaders: false,
    // Loopback-only: one IP, so failed tries are counted per invitation link to slow birth-date guessing.
    keyGenerator: (req) => sha(String(req.body?.token ?? "")),
    message: { error: "확인 시도가 많습니다. 15분 후 다시 시도하거나 담당자에게 문의하세요." },
  });
  app.post("/api/join/info", (req, res) => {
    const { body } = openInvitation(db, tokenInput.parse(req.body).token);
    res.json({ title: body.title ?? "", date: body.date ?? "", location: body.location ?? "" });
  });
  app.post("/api/join", limiter, (req, res) => {
    const v = joinInput.parse(req.body), { inv } = openInvitation(db, v.token);
    const candidates = (db.prepare("SELECT p.worker_id,p.name,i.salt,i.birth_hash FROM tbm_participants p JOIN worker_identities i ON i.worker_id=p.worker_id WHERE p.session_id=?")
      .all(inv.activity_id) as { worker_id: string; name: string; salt: string; birth_hash: string }[]).filter((c) => nameKey(c.name) === nameKey(v.name));
    const match = candidates.find((c) => timingSafeEqual(Buffer.from(birthHash(v.birthDate, c.salt), "hex"), Buffer.from(c.birth_hash, "hex")));
    if (!match) throw new HttpError(400, "TBM 명부의 이름과 생년월일이 맞지 않습니다. 담당자에게 확인하세요.");
    const existing = db.prepare("SELECT at FROM participation_events WHERE invitation_id=? AND worker_id=?").get(inv.id, match.worker_id) as { at: string } | undefined;
    if (existing) return res.json({ recorded: true, already: true, name: match.name, at: existing.at });
    let png: Buffer | null = null;
    if (v.decision === "grant") {
      png = Buffer.from((v.signature ?? "").replace(/^data:image\/png;base64,/, ""), "base64");
      if (png.length < 8 || png.length > SIGNATURE_MAX_BYTES || !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
        throw new HttpError(400, "서명을 그린 뒤 다시 제출하세요.");
    } else if (v.signature) throw new HttpError(400, "동의하지 않으면 서명을 보내지 않습니다.");
    const at = new Date().toISOString(), id = randomUUID(), retain = new Date(at);
    retain.setUTCFullYear(retain.getUTCFullYear() + TBM_SIGNATURE_CONSENT.retainYears);
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("INSERT INTO participation_events VALUES(?,?,?,?,?,?,?,'name_birth',?)").run(id, inv.id, inv.site_id, inv.activity_id, match.worker_id, match.name, inv.document_hash, at);
      db.prepare("INSERT INTO consent_records VALUES(?,?,?,'tbm_signature',?,?,?,?)").run(randomUUID(), id, inv.site_id, TBM_SIGNATURE_CONSENT.version, v.decision, at, retain.toISOString());
      if (png) db.prepare("INSERT INTO signature_records VALUES(?,?,?,?,?,?,?,?,?)").run(randomUUID(), id, inv.site_id, inv.document_hash, png.length, sha(png.toString("latin1")), png, at, retain.toISOString());
      db.exec("COMMIT");
    } catch (e) { db.exec("ROLLBACK"); throw e; }
    res.json({ recorded: true, already: false, name: match.name, at, signed: !!png });
  });
}
export function registerTbmJoin(app: Express, db: Db, { access, mutate }: SiteOperations) {
  const session = (req: Request) => {
    const s = db.prepare("SELECT id,site_id,body,status,version FROM tbm_sessions WHERE id=? AND site_id=?").get(String(req.params.id), String(req.params.siteId)) as Session | undefined;
    if (!s) throw new HttpError(404, "TBM 기록을 찾을 수 없습니다.");
    return s;
  };
  const list = (s: Session) => ({
    invitations: db.prepare("SELECT id,document_hash,expires_at,revoked_at,created_at FROM activity_invitations WHERE activity_id=? AND site_id=? ORDER BY created_at DESC LIMIT 20").all(s.id, s.site_id)
      .map((i) => ({ ...(i as object), current: (i as { document_hash: string }).document_hash === tbmHash(s) })),
    events: db.prepare(`SELECT e.id,e.worker_id,e.worker_name,e.invitation_id,e.at,e.document_hash=? AS current,c.decision,c.text_version,(g.id IS NOT NULL) AS signed
      FROM participation_events e LEFT JOIN consent_records c ON c.participation_id=e.id LEFT JOIN signature_records g ON g.participation_id=e.id
      WHERE e.activity_id=? AND e.site_id=? ORDER BY e.at`).all(tbmHash(s), s.id, s.site_id),
  });
  const base = "/api/sites/:siteId/tbm/:id/invitations";
  app.get(base, (req, res) => { access(req); res.json(list(session(req))); });
  app.post(base, (req, res) => {
    access(req, true);
    mutate(req, res, `tbm:invite:${req.params.siteId}:${req.params.id}`, {}, () => {
      const s = session(req);
      if (s.status !== "draft") throw new HttpError(409, "확정된 TBM에는 참여 링크를 만들 수 없습니다.");
      const token = randomBytes(32).toString("base64url"), now = new Date(), expires = new Date(now.getTime() + INVITATION_HOURS * 3600_000).toISOString();
      db.prepare("INSERT INTO activity_invitations VALUES(?,?,'tbm',?,?,?,?,NULL,?,?)").run(randomUUID(), s.site_id, s.id, sha(token), tbmHash(s), expires, req.session.userId!, now.toISOString());
      audit(db, req.session.userId!, s.site_id, "tbm.invitation_created", s.id);
      // The raw token is returned once and never stored.
      return { token, expiresAt: expires, ...list(s) };
    }, () => { access(req, true); });
  });
  app.post(base + "/:invitationId/revoke", (req, res) => {
    access(req, true);
    mutate(req, res, `tbm:invite:revoke:${req.params.siteId}:${req.params.invitationId}`, {}, () => {
      const s = session(req), r = db.prepare("UPDATE activity_invitations SET revoked_at=? WHERE id=? AND activity_id=? AND site_id=? AND revoked_at IS NULL")
        .run(new Date().toISOString(), String(req.params.invitationId), s.id, s.site_id);
      if (!r.changes) throw new HttpError(404, "폐기할 참여 링크가 없습니다.");
      audit(db, req.session.userId!, s.site_id, "tbm.invitation_revoked", String(req.params.invitationId));
      return list(s);
    }, () => { access(req, true); });
  });
  app.get(base.replace("/invitations", "/participation/:eventId/signature"), (req, res) => {
    access(req);
    const s = session(req), g = db.prepare("SELECT g.png,g.size,g.sha256 FROM signature_records g JOIN participation_events e ON e.id=g.participation_id WHERE e.id=? AND e.activity_id=? AND e.site_id=?")
      .get(String(req.params.eventId), s.id, s.site_id) as { png: Uint8Array; size: number; sha256: string } | undefined;
    if (!g) throw new HttpError(404, "서명이 없습니다.");
    const png = Buffer.from(g.png);
    if (png.length !== g.size || sha(png.toString("latin1")) !== g.sha256) throw new HttpError(409, "서명 크기/해시가 일치하지 않습니다.");
    res.set({ "Content-Type": "image/png", "Content-Disposition": "inline", "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" }).send(png);
  });
  app.get("/api/sites/:siteId/worker-identities", (req, res) => {
    access(req, true, true);
    res.json({ workerIds: (db.prepare("SELECT worker_id FROM worker_identities WHERE site_id=?").all(String(req.params.siteId)) as { worker_id: string }[]).map((r) => r.worker_id) });
  });
  app.put("/api/sites/:siteId/workers/:workerId/identity", (req, res) => {
    access(req, true, true);
    const v = z.object({ birthDate: date.nullable() }).strict().parse(req.body), site = String(req.params.siteId), workerId = String(req.params.workerId);
    mutate(req, res, `worker:identity:${site}:${workerId}`, { workerId, set: v.birthDate !== null, digest: v.birthDate ? sha(v.birthDate + workerId) : null }, () => {
      if (!db.prepare("SELECT 1 FROM workers WHERE id=? AND site_id=?").get(workerId, site)) throw new HttpError(404, "명부 인원을 찾을 수 없습니다.");
      if (v.birthDate === null) db.prepare("DELETE FROM worker_identities WHERE worker_id=? AND site_id=?").run(workerId, site);
      else {
        const salt = randomBytes(16).toString("hex");
        db.prepare("INSERT INTO worker_identities VALUES(?,?,?,?,?,?) ON CONFLICT(worker_id) DO UPDATE SET salt=excluded.salt,birth_hash=excluded.birth_hash,updated_by=excluded.updated_by,updated_at=excluded.updated_at")
          .run(workerId, site, salt, birthHash(v.birthDate, salt), req.session.userId!, new Date().toISOString());
      }
      audit(db, req.session.userId!, site, "worker.identity_" + (v.birthDate === null ? "cleared" : "set"), workerId);
      return { workerId, registered: v.birthDate !== null };
    }, () => { access(req, true, true); });
  });
}
