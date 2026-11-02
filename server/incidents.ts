import type { Express, Request } from "express";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { audit, type Db } from "./db.js";
import { HttpError, type SiteOperations } from "./site-operations.js";
import { localRecordedTime } from "./work-stop-validation.js";
import { escapeHtml as e } from "./print.js";
// 사고 · 아차사고 기록 (docs/REVIEW_2026-11-02.md 3절 1). Keeps what happened, why, what was done and the
// recurrence-prevention plan, and shows the 산업재해조사표 due date for an accident with 3+ days off work.
// The app records what people write; it does not decide whether something is an 산업재해, file the report, or judge
// causes. Confirmed records are fixed (trigger); a correction is a new draft linked to the old one.
export function migrateIncidents(db: Db) {
  db.exec(`
CREATE TABLE IF NOT EXISTS incidents(id TEXT PRIMARY KEY,site_id TEXT NOT NULL REFERENCES sites(id),parent_id TEXT REFERENCES incidents(id),
  revision_reason TEXT,body TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('draft','confirmed')),version INTEGER NOT NULL,
  author_id TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
  confirmed_snapshot TEXT,confirmed_hash TEXT,report_filed_on TEXT,report_note TEXT);
CREATE INDEX IF NOT EXISTS incidents_site ON incidents(site_id,created_at,id);
CREATE TRIGGER IF NOT EXISTS incidents_confirmed_fixed BEFORE UPDATE OF body,status,confirmed_snapshot,confirmed_hash,parent_id ON incidents
  WHEN OLD.status='confirmed' BEGIN SELECT RAISE(ABORT,'확정된 사고 기록은 바꿀 수 없습니다.'); END;
PRAGMA user_version=76`);
}
const text = (max: number) => z.string().trim().max(max);
export const incidentBody = z.object({
  kind: z.enum(["accident", "near_miss"]),
  occurredAt: localRecordedTime,
  location: z.string().trim().min(1).max(300),
  workType: text(200),
  injured: text(500), // 재해자 이름·소속·직종 — no resident number or medical detail
  lostDays3Plus: z.boolean(),
  description: z.string().trim().min(1).max(5000),
  cause: text(3000),
  immediateAction: text(3000),
  preventionPlan: text(3000),
}).strict();
export type IncidentBody = z.infer<typeof incidentBody>;
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => !Number.isNaN(Date.parse(v + "T00:00:00Z")) && new Date(v + "T00:00:00Z").toISOString().startsWith(v), "날짜를 확인하세요.");
const version = z.number().int().min(1);
type Row = {
  id: string; site_id: string; parent_id: string | null; revision_reason: string | null; body: string; status: "draft" | "confirmed";
  version: number; author_id: string; created_at: string; updated_at: string; confirmed_snapshot: string | null; confirmed_hash: string | null;
  report_filed_on: string | null; report_note: string | null;
};
export const KIND_LABEL = { accident: "사고", near_miss: "아차사고" } as const;
// 산업재해조사표: within one month of the accident (산업안전보건법 시행규칙 제73조). Same day next month; a day the next
// month lacks becomes its last day. A guide for the screen, not a legal ruling.
export function reportDue(occurredAt: string) {
  const [y, m, d] = occurredAt.slice(0, 10).split("-").map(Number);
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d, last))).toISOString().slice(0, 10);
}
export const retainUntil = (occurredAt: string) => `${Number(occurredAt.slice(0, 4)) + 3}${occurredAt.slice(4, 10)}`;
const needsReport = (b: IncidentBody) => b.kind === "accident" && b.lostDays3Plus;
function record(db: Db, r: Row) {
  const body = JSON.parse(r.body) as IncidentBody;
  const author = db.prepare("SELECT name FROM users WHERE id=?").get(r.author_id) as { name: string } | undefined;
  const child = db.prepare("SELECT id FROM incidents WHERE parent_id=?").get(r.id) as { id: string } | undefined;
  return {
    id: r.id, status: r.status, version: r.version, body, parentId: r.parent_id, revisionReason: r.revision_reason, successorId: child?.id ?? null,
    authorId: r.author_id, authorName: author?.name ?? "", createdAt: r.created_at, updatedAt: r.updated_at,
    confirmed: r.confirmed_snapshot ? (JSON.parse(r.confirmed_snapshot) as { by: { id: string; name: string }; at: string }) : null,
    confirmedHash: r.confirmed_hash,
    reportDue: needsReport(body) ? reportDue(body.occurredAt) : null, reportFiledOn: r.report_filed_on, reportNote: r.report_note,
    retainUntil: retainUntil(body.occurredAt),
  };
}
export type IncidentRecord = ReturnType<typeof record>;
export function printIncident(r: IncidentRecord, siteName: string) {
  const b = r.body, row = (k: string, v: string) => `<tr><th>${e(k)}</th><td>${e(v || "—")}</td></tr>`;
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(KIND_LABEL[b.kind])} 기록</title><link rel="stylesheet" href="/print.css"></head><body>`
    + `<aside>직접 입력한 기록입니다. 산업재해 해당 여부·원인·조사표 제출을 앱이 판단하거나 대신하지 않습니다.</aside>`
    + `<h1>${e(KIND_LABEL[b.kind])} 기록 · ${e(siteName)}</h1><table>`
    + row("상태", r.status === "confirmed" ? `확정 · ${r.confirmed?.by.name ?? ""} · ${r.confirmed?.at ?? ""}` : "초안")
    + row("발생 일시", b.occurredAt.replace("T", " ")) + row("장소", b.location) + row("작업 종류", b.workType) + row("재해자", b.injured)
    + row("휴업 3일 이상", b.lostDays3Plus ? "예" : "아니오") + row("발생 경위", b.description) + row("원인", b.cause)
    + row("즉시 조치", b.immediateAction) + row("재발 방지 계획", b.preventionPlan)
    + (r.reportDue ? row("산업재해조사표 제출 기한(안내)", r.reportDue) + row("제출일", r.reportFiledOn ?? "미기록") : "")
    + row("보존 기한(안내)", r.retainUntil) + row("작성", `${r.authorName} · ${r.createdAt}`)
    + (r.parentId ? row("정정 사유", r.revisionReason ?? "") : "") + `</table></body></html>`;
}
export function registerIncidents(app: Express, db: Db, { access, mutate }: SiteOperations) {
  const base = "/api/sites/:siteId/incidents";
  const site = (req: Request) => String(req.params.siteId);
  function get(req: Request) {
    const r = db.prepare("SELECT * FROM incidents WHERE site_id=? AND id=?").get(site(req), String(req.params.id)) as Row | undefined;
    if (!r) throw new HttpError(404, "기록을 찾을 수 없습니다.");
    return r;
  }
  const expect = (r: Row, v: number, status: Row["status"]) => {
    if (r.version !== v || r.status !== status) throw new HttpError(409, "버전 또는 상태가 바뀌었습니다. 최신본을 다시 여세요.");
  };
  const actor = (req: Request) => db.prepare("SELECT id,name FROM users WHERE id=?").get(req.session.userId!) as { id: string; name: string };
  app.get(base, (req, res) => {
    access(req);
    const offset = z.coerce.number().int().min(0).max(100000).default(0).parse(req.query.offset);
    const rows = db.prepare("SELECT * FROM incidents WHERE site_id=? ORDER BY created_at DESC,id LIMIT 51 OFFSET ?").all(site(req), offset) as Row[];
    res.json({ items: rows.slice(0, 50).map((r) => record(db, r)), hasMore: rows.length > 50 });
  });
  // Home '내 할 일' for managers: the latest version of each accident needing a report that has no filing date yet.
  app.get("/api/sites/:siteId/incident-tasks", (req, res) => {
    if (access(req) !== "manager") return res.json({ items: [] });
    const rows = db.prepare("SELECT * FROM incidents i WHERE site_id=? AND report_filed_on IS NULL AND NOT EXISTS(SELECT 1 FROM incidents c WHERE c.parent_id=i.id) ORDER BY created_at").all(site(req)) as Row[];
    res.json({ items: rows.map((r) => record(db, r)).filter((r) => r.reportDue).map((r) => ({ id: r.id, title: `${r.body.location} · ${r.body.occurredAt.slice(0, 10)}`, due: r.reportDue })) });
  });
  app.get(base + "/:id", (req, res) => { access(req); res.json(record(db, get(req))); });
  app.get(base + "/:id/print", (req, res) => {
    access(req);
    const name = (db.prepare("SELECT name FROM sites WHERE id=?").get(site(req)) as { name: string }).name;
    res.type("html").send(printIncident(record(db, get(req)), name));
  });
  app.post(base, (req, res) => {
    access(req, true);
    const body = incidentBody.parse(req.body);
    mutate(req, res, `incident:create:${site(req)}`, body, () => {
      const id = randomUUID(), now = new Date().toISOString();
      db.prepare("INSERT INTO incidents(id,site_id,body,status,version,author_id,created_at,updated_at) VALUES(?,?,?,'draft',1,?,?,?)")
        .run(id, site(req), JSON.stringify(body), req.session.userId!, now, now);
      audit(db, req.session.userId!, site(req), "incident.created", id);
      return record(db, get({ ...req, params: { ...req.params, id } } as unknown as Request));
    }, () => { access(req, true); });
  });
  app.put(base + "/:id", (req, res) => {
    const role = access(req, true);
    const v = z.object({ version, body: incidentBody }).strict().parse(req.body);
    mutate(req, res, `incident:edit:${req.params.id}`, v, () => {
      const r = get(req);
      expect(r, v.version, "draft");
      if (role !== "manager" && r.author_id !== req.session.userId) throw new HttpError(403, "작성자나 관리자만 초안을 고칠 수 있습니다.");
      db.prepare("UPDATE incidents SET body=?,version=version+1,updated_at=? WHERE id=? AND version=?").run(JSON.stringify(v.body), new Date().toISOString(), r.id, r.version);
      audit(db, req.session.userId!, site(req), "incident.updated", r.id);
      return record(db, get(req));
    }, () => { access(req, true); });
  });
  app.post(base + "/:id/confirm", (req, res) => {
    access(req, true, true);
    const v = z.object({ version }).strict().parse(req.body);
    mutate(req, res, `incident:confirm:${req.params.id}`, v, () => {
      const r = get(req);
      expect(r, v.version, "draft");
      const b = JSON.parse(r.body) as IncidentBody;
      if (!b.cause || !b.preventionPlan) throw new HttpError(400, "확정하려면 원인과 재발 방지 계획을 입력하세요.");
      const snapshot = JSON.stringify({ body: b, by: actor(req), at: new Date().toISOString() });
      db.prepare("UPDATE incidents SET status='confirmed',version=version+1,updated_at=?,confirmed_snapshot=?,confirmed_hash=? WHERE id=? AND version=?")
        .run(new Date().toISOString(), snapshot, createHash("sha256").update(snapshot).digest("hex"), r.id, r.version);
      audit(db, req.session.userId!, site(req), "incident.confirmed", r.id);
      return record(db, get(req));
    }, () => { access(req, true, true); });
  });
  app.post(base + "/:id/report", (req, res) => {
    access(req, true, true);
    const v = z.object({ version, filedOn: day, note: text(500) }).strict().parse(req.body);
    mutate(req, res, `incident:report:${req.params.id}`, v, () => {
      const r = get(req);
      if (r.version !== v.version) throw new HttpError(409, "버전이 바뀌었습니다. 최신본을 다시 여세요.");
      if (!needsReport(JSON.parse(r.body) as IncidentBody)) throw new HttpError(400, "휴업 3일 이상 사고 기록에만 제출일을 남깁니다.");
      db.prepare("UPDATE incidents SET report_filed_on=?,report_note=?,version=version+1,updated_at=? WHERE id=? AND version=?").run(v.filedOn, v.note, new Date().toISOString(), r.id, r.version);
      audit(db, req.session.userId!, site(req), "incident.report_filed", r.id);
      return record(db, get(req));
    }, () => { access(req, true, true); });
  });
  app.post(base + "/:id/revise", (req, res) => {
    access(req, true, true);
    const v = z.object({ version, reason: z.string().trim().min(1).max(1000) }).strict().parse(req.body);
    mutate(req, res, `incident:revise:${req.params.id}`, v, () => {
      const r = get(req);
      expect(r, v.version, "confirmed");
      if (db.prepare("SELECT 1 FROM incidents WHERE parent_id=?").get(r.id)) throw new HttpError(409, "이미 정정 초안이 있습니다.");
      const id = randomUUID(), now = new Date().toISOString();
      db.prepare("INSERT INTO incidents(id,site_id,parent_id,revision_reason,body,status,version,author_id,created_at,updated_at,report_filed_on,report_note) VALUES(?,?,?,?,?,'draft',1,?,?,?,?,?)")
        .run(id, site(req), r.id, v.reason, r.body, req.session.userId!, now, now, r.report_filed_on, r.report_note);
      audit(db, req.session.userId!, site(req), "incident.revised", id);
      return record(db, get({ ...req, params: { ...req.params, id } } as unknown as Request));
    }, () => { access(req, true, true); });
  });
}
