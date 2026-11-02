import type { Express, Request } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { audit, type Db } from "./db.js";
import { date } from "./validation.js";
import { HttpError, type SiteOperations } from "./site-operations.js";
import { QUALIFICATION_KINDS, SOON_DAYS, type QualificationKind } from "./qualification-kinds.js";
// 교육 · 자격 이수 현황 (docs/REVIEW_2026-11-02.md 3절 3). A manager records what a worker's certificate or licence
// says (kind, name/number, issued, expiry); the list and the home screen show what has expired or expires within 30 days.
// Records are written once: a mistake is voided with a reason, and a certificate taken again is recorded as the renewal
// of the old one, which then leaves the alerts. The app keeps what was entered — it does not certify completion or
// compute legal training cycles.
export function migrateQualifications(db: Db) {
  db.exec(`
CREATE TABLE IF NOT EXISTS worker_qualifications(id TEXT PRIMARY KEY,site_id TEXT NOT NULL REFERENCES sites(id),worker_id TEXT NOT NULL,
  kind TEXT NOT NULL,label TEXT NOT NULL,issued_on TEXT NOT NULL,expires_on TEXT,note TEXT NOT NULL,replaces_id TEXT REFERENCES worker_qualifications(id),
  created_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,voided_at TEXT,voided_by TEXT REFERENCES users(id),void_reason TEXT,
  FOREIGN KEY(site_id,worker_id) REFERENCES workers(site_id,id));
CREATE INDEX IF NOT EXISTS worker_qualifications_site ON worker_qualifications(site_id,expires_on,id);
CREATE INDEX IF NOT EXISTS worker_qualifications_replaces ON worker_qualifications(replaces_id);
CREATE TRIGGER IF NOT EXISTS worker_qualifications_fixed BEFORE UPDATE OF site_id,worker_id,kind,label,issued_on,expires_on,note,replaces_id,created_by,created_at ON worker_qualifications
  BEGIN SELECT RAISE(ABORT,'이수·자격 기록은 바꿀 수 없습니다. 무효 처리 후 새로 기록하세요.'); END;
CREATE TRIGGER IF NOT EXISTS worker_qualifications_void_once BEFORE UPDATE OF voided_at,voided_by,void_reason ON worker_qualifications WHEN OLD.voided_at IS NOT NULL
  BEGIN SELECT RAISE(ABORT,'이미 무효 처리된 기록입니다.'); END;
PRAGMA user_version=78`);
}
const kind = z.enum(Object.keys(QUALIFICATION_KINDS) as [QualificationKind, ...QualificationKind[]]);
export const qualificationInput = z.object({
  workerId: z.uuid(), kind, label: z.string().trim().min(1).max(200), issuedOn: date, expiresOn: date.nullable(), note: z.string().trim().max(1000),
  replacesId: z.uuid().optional(),
}).strict().refine((v) => !v.expiresOn || v.expiresOn >= v.issuedOn, { message: "만료일은 이수일 이후여야 합니다.", path: ["expiresOn"] });
type Row = { id: string; site_id: string; worker_id: string; kind: QualificationKind; label: string; issued_on: string; expires_on: string | null; note: string; replaces_id: string | null; created_by: string; created_at: string; worker_name: string; affiliation: string; creator: string; renewed: number };
const localDay = (d = new Date()) => d.toLocaleDateString("en-CA");
export function soonLimit(today: string) {
  const d = new Date(today + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + SOON_DAYS);
  return d.toISOString().slice(0, 10);
}
export function expiryState(expiresOn: string | null, today: string) {
  if (!expiresOn) return "none" as const;
  if (expiresOn < today) return "expired" as const;
  return expiresOn <= soonLimit(today) ? ("soon" as const) : ("ok" as const);
}
// A record stays renewed only while its renewal is not voided.
const RENEWED = "EXISTS(SELECT 1 FROM worker_qualifications n WHERE n.replaces_id=q.id AND n.voided_at IS NULL)";
const SELECT = `SELECT q.*,w.name worker_name,w.affiliation,u.name creator,${RENEWED} renewed FROM worker_qualifications q JOIN workers w ON w.site_id=q.site_id AND w.id=q.worker_id JOIN users u ON u.id=q.created_by`;
const view = (r: Row, today: string) => ({
  id: r.id, workerId: r.worker_id, workerName: r.worker_name, affiliation: r.affiliation, kind: r.kind, kindLabel: QUALIFICATION_KINDS[r.kind].label,
  label: r.label, issuedOn: r.issued_on, expiresOn: r.expires_on, note: r.note, replacesId: r.replaces_id, createdBy: r.creator, createdAt: r.created_at,
  state: r.renewed ? ("renewed" as const) : expiryState(r.expires_on, today),
});
export function registerQualifications(app: Express, db: Db, { access, mutate }: SiteOperations) {
  const base = "/api/sites/:siteId/qualifications", site = (req: Request) => String(req.params.siteId);
  app.get(base, (req, res) => {
    access(req);
    const q = z.object({ offset: z.coerce.number().int().min(0).max(100000).default(0), filter: z.enum(["all", "expired", "soon"]).default("all") }).parse(req.query);
    const today = localDay(), args: unknown[] = [site(req)];
    let where = "q.site_id=? AND q.voided_at IS NULL";
    if (q.filter !== "all") where += ` AND NOT ${RENEWED}`;
    if (q.filter === "expired") { where += " AND q.expires_on < ?"; args.push(today); }
    if (q.filter === "soon") { where += " AND q.expires_on >= ? AND q.expires_on <= ?"; args.push(today, soonLimit(today)); }
    const rows = db.prepare(`${SELECT} WHERE ${where} ORDER BY renewed,q.expires_on IS NULL,q.expires_on,w.name,q.id LIMIT 51 OFFSET ?`).all(...(args as never[]), q.offset) as Row[];
    res.json({ items: rows.slice(0, 50).map((r) => view(r, today)), hasMore: rows.length > 50 });
  });
  // Home '내 할 일' for managers: expired or expiring within 30 days, not renewed, for people still on the roster.
  app.get("/api/sites/:siteId/qualification-tasks", (req, res) => {
    if (access(req) !== "manager") return res.json({ items: [] });
    const today = localDay();
    const rows = db.prepare(`${SELECT} WHERE q.site_id=? AND q.voided_at IS NULL AND NOT ${RENEWED} AND w.active=1 AND q.expires_on IS NOT NULL AND q.expires_on <= ? ORDER BY q.expires_on LIMIT 50`).all(site(req), soonLimit(today)) as Row[];
    res.json({ items: rows.map((r) => ({ id: r.id, title: `${r.worker_name} · ${QUALIFICATION_KINDS[r.kind].label}`, due: r.expires_on })) });
  });
  app.post(base, (req, res) => {
    access(req, true, true);
    const v = qualificationInput.parse(req.body);
    mutate(req, res, `qualification:create:${site(req)}`, v, () => {
      if (!db.prepare("SELECT 1 FROM workers WHERE site_id=? AND id=?").get(site(req), v.workerId)) throw new HttpError(400, "이 현장 명부에 있는 사람만 기록합니다.");
      if (v.replacesId) {
        const old = db.prepare(`SELECT q.worker_id,q.kind,q.voided_at,${RENEWED} renewed FROM worker_qualifications q WHERE q.site_id=? AND q.id=?`).get(site(req), v.replacesId) as { worker_id: string; kind: string; voided_at: string | null; renewed: number } | undefined;
        if (!old) throw new HttpError(404, "갱신할 기록을 찾을 수 없습니다.");
        if (old.voided_at) throw new HttpError(409, "무효 처리된 기록은 갱신하지 않습니다.");
        if (old.renewed) throw new HttpError(409, "이미 갱신된 기록입니다.");
        if (old.worker_id !== v.workerId || old.kind !== v.kind) throw new HttpError(400, "같은 사람의 같은 종류만 갱신으로 기록합니다.");
      }
      const id = randomUUID();
      db.prepare("INSERT INTO worker_qualifications(id,site_id,worker_id,kind,label,issued_on,expires_on,note,replaces_id,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
        .run(id, site(req), v.workerId, v.kind, v.label, v.issuedOn, v.expiresOn, v.note, v.replacesId ?? null, req.session.userId!, new Date().toISOString());
      audit(db, req.session.userId!, site(req), v.replacesId ? "qualification.renewed" : "qualification.created", id);
      return view(db.prepare(`${SELECT} WHERE q.id=?`).get(id) as Row, localDay());
    }, () => { access(req, true, true); });
  });
  app.post(base + "/:id/void", (req, res) => {
    access(req, true, true);
    const v = z.object({ reason: z.string().trim().min(1).max(500) }).strict().parse(req.body);
    mutate(req, res, `qualification:void:${req.params.id}`, v, () => {
      const r = db.prepare("SELECT voided_at FROM worker_qualifications WHERE site_id=? AND id=?").get(site(req), String(req.params.id)) as { voided_at: string | null } | undefined;
      if (!r) throw new HttpError(404, "기록을 찾을 수 없습니다.");
      if (r.voided_at) throw new HttpError(409, "이미 무효 처리된 기록입니다.");
      db.prepare("UPDATE worker_qualifications SET voided_at=?,voided_by=?,void_reason=? WHERE id=?").run(new Date().toISOString(), req.session.userId!, v.reason, String(req.params.id));
      audit(db, req.session.userId!, site(req), "qualification.voided", String(req.params.id));
      return { id: String(req.params.id), voided: true };
    }, () => { access(req, true, true); });
  });
}
