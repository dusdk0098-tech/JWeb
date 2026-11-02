import type { Express, Request } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { audit, type Db } from "./db.js";
import { HttpError, type SiteOperations } from "./site-operations.js";
import { localRecordedTime } from "./work-stop-validation.js";
import { escapeHtml as e } from "./print.js";
import { SOLE_MANAGER_NOTE, soleManager } from "./sole-manager.js";
import { PERMIT_KINDS, type PermitKind } from "./permit-kinds.js";
export { PERMIT_KINDS };
// 작업허가서 (docs/REVIEW_2026-11-02.md 3절 2). A writer fills the work, time window and the kind's check items and
// asks for a permit; a manager (not the requester, unless the site has one manager) records approval or rejection;
// the work is closed with a note. The app records people's decisions; it does not judge safety or replace a statutory
// permit. Once requested, the content is fixed (trigger). Keep for a year after the permit ends (안내).
const kind = z.enum(Object.keys(PERMIT_KINDS) as [PermitKind, ...PermitKind[]]);
const state = z.enum(["yes", "na", "pending"]);
export const permitInput = z.object({
  kind, work: z.string().trim().min(1).max(500), location: z.string().trim().min(1).max(300),
  validFrom: localRecordedTime, validTo: localRecordedTime, workers: z.string().trim().max(1000), precautions: z.string().trim().max(3000),
  checks: z.array(state).max(10),
}).strict().superRefine((v, ctx) => {
  if (v.validTo <= v.validFrom) ctx.addIssue({ code: "custom", path: ["validTo"], message: "허가 종료 시각은 시작보다 늦어야 합니다." });
  if (v.checks.length !== PERMIT_KINDS[v.kind].checks.length) ctx.addIssue({ code: "custom", path: ["checks"], message: "작업 종류의 확인 항목 수와 맞지 않습니다." });
});
export type PermitInput = z.infer<typeof permitInput>;
type Status = "draft" | "requested" | "approved" | "rejected" | "closed";
type Row = { id: string; site_id: string; body: string; status: Status; version: number; requester_id: string; created_at: string; updated_at: string; decision: string | null; closure: string | null };
type Mark = { by: { id: string; name: string }; at: string; note: string; selfProcessed?: string };
export function migratePermits(db: Db) {
  db.exec(`
CREATE TABLE IF NOT EXISTS permits(id TEXT PRIMARY KEY,site_id TEXT NOT NULL REFERENCES sites(id),body TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('draft','requested','approved','rejected','closed')),version INTEGER NOT NULL,
  requester_id TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,decision TEXT,closure TEXT);
CREATE INDEX IF NOT EXISTS permits_site ON permits(site_id,created_at,id);
CREATE TRIGGER IF NOT EXISTS permits_requested_fixed BEFORE UPDATE OF body ON permits WHEN OLD.status<>'draft'
  BEGIN SELECT RAISE(ABORT,'요청한 작업허가서 내용은 바꿀 수 없습니다.'); END;
PRAGMA user_version=77`);
}
export const retainUntilPermit = (validTo: string) => `${Number(validTo.slice(0, 4)) + 1}${validTo.slice(4, 10)}`;
function record(db: Db, r: Row) {
  const body = JSON.parse(r.body) as PermitInput;
  const requester = db.prepare("SELECT name FROM users WHERE id=?").get(r.requester_id) as { name: string } | undefined;
  return {
    id: r.id, status: r.status, version: r.version, body, kindLabel: PERMIT_KINDS[body.kind].label,
    checks: PERMIT_KINDS[body.kind].checks.map((text, i) => ({ text, state: body.checks[i] })),
    requesterId: r.requester_id, requesterName: requester?.name ?? "", createdAt: r.created_at, updatedAt: r.updated_at,
    decision: r.decision ? (JSON.parse(r.decision) as Mark & { approved: boolean }) : null, closure: r.closure ? (JSON.parse(r.closure) as Mark) : null,
    retainUntil: retainUntilPermit(body.validTo),
  };
}
export type PermitRecord = ReturnType<typeof record>;
const STATE_LABEL = { yes: "확인", na: "해당 없음", pending: "미확인" } as const;
export const STATUS_LABEL: Record<Status, string> = { draft: "작성 중", requested: "허가 요청", approved: "허가 기록", rejected: "반려", closed: "작업 종료" };
export function printPermit(r: PermitRecord, siteName: string) {
  const b = r.body, row = (k: string, v: string) => `<tr><th>${e(k)}</th><td>${e(v || "—")}</td></tr>`;
  const mark = (m: Mark | null) => (m ? `${m.by.name} · ${m.at}${m.selfProcessed ? ` · ${m.selfProcessed}` : ""}${m.note ? ` · ${m.note}` : ""}` : "");
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>작업허가서</title><link rel="stylesheet" href="/print.css"></head><body>`
    + `<aside>사람이 내린 허가 결정을 기록한 문서입니다. 앱이 작업 안전을 판정하거나 법정 허가를 대신하지 않습니다.</aside>`
    + `<h1>작업허가서 · ${e(r.kindLabel)} · ${e(siteName)}</h1><table>`
    + row("상태", STATUS_LABEL[r.status]) + row("작업", b.work) + row("장소", b.location)
    + row("허가 시간", `${b.validFrom.replace("T", " ")} ~ ${b.validTo.replace("T", " ")}`) + row("작업자", b.workers) + row("안전 조치", b.precautions)
    + r.checks.map((c) => row(c.text, STATE_LABEL[c.state])).join("")
    + row("요청", `${r.requesterName} · ${r.createdAt}`) + row(r.decision?.approved === false ? "반려" : "허가", mark(r.decision)) + row("작업 종료", mark(r.closure))
    + row("보존 기한(안내)", r.retainUntil) + `</table></body></html>`;
}
export function registerPermits(app: Express, db: Db, { access, mutate }: SiteOperations) {
  const base = "/api/sites/:siteId/permits", site = (req: Request) => String(req.params.siteId);
  function get(req: Request, id = String(req.params.id)) {
    const r = db.prepare("SELECT * FROM permits WHERE site_id=? AND id=?").get(site(req), id) as Row | undefined;
    if (!r) throw new HttpError(404, "작업허가서를 찾을 수 없습니다.");
    return r;
  }
  const expect = (r: Row, v: number, ...states: Status[]) => {
    if (r.version !== v || !states.includes(r.status)) throw new HttpError(409, "버전 또는 상태가 바뀌었습니다. 최신본을 다시 여세요.");
  };
  const mark = (req: Request, note: string): Mark => ({ by: db.prepare("SELECT id,name FROM users WHERE id=?").get(req.session.userId!) as Mark["by"], at: new Date().toISOString(), note });
  const step = (req: Request, r: Row, set: string, args: unknown[], event: string) => {
    const res = db.prepare(`UPDATE permits SET ${set},version=version+1,updated_at=? WHERE id=? AND version=?`).run(...(args as never[]), new Date().toISOString(), r.id, r.version);
    if (res.changes !== 1) throw new HttpError(409, "동시 변경 충돌");
    audit(db, req.session.userId!, site(req), "permit." + event, r.id);
    return record(db, get(req, r.id));
  };
  const version = z.object({ version: z.number().int().min(1) }).strict();
  const note = z.object({ version: z.number().int().min(1), note: z.string().trim().max(1000) }).strict();
  app.get(base, (req, res) => {
    access(req);
    const offset = z.coerce.number().int().min(0).max(100000).default(0).parse(req.query.offset);
    const rows = db.prepare("SELECT * FROM permits WHERE site_id=? ORDER BY created_at DESC,id LIMIT 51 OFFSET ?").all(site(req), offset) as Row[];
    res.json({ items: rows.slice(0, 50).map((r) => record(db, r)), hasMore: rows.length > 50 });
  });
  // Home '내 할 일': managers review requests; the requester (or a manager) closes approved permits whose time ended.
  app.get("/api/sites/:siteId/permit-tasks", (req, res) => {
    const role = access(req), me = req.session.userId!, now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    const local = now.toISOString().slice(0, 16);
    const rows = (db.prepare("SELECT * FROM permits WHERE site_id=? AND status IN ('requested','approved') ORDER BY created_at").all(site(req)) as Row[]).map((r) => record(db, r));
    res.json({ items: [
      ...(role === "manager" ? rows.filter((r) => r.status === "requested" && (r.requesterId !== me || soleManager(db, site(req), me))).map((r) => ({ id: r.id, kind: "review", title: `${r.kindLabel} · ${r.body.work}`, due: r.body.validFrom.slice(0, 10) })) : []),
      ...rows.filter((r) => r.status === "approved" && r.body.validTo <= local && (r.requesterId === me || role === "manager")).map((r) => ({ id: r.id, kind: "close", title: `${r.kindLabel} · ${r.body.work}`, due: r.body.validTo.slice(0, 10) })),
    ] });
  });
  app.get(base + "/:id", (req, res) => { access(req); res.json(record(db, get(req))); });
  app.get(base + "/:id/print", (req, res) => {
    access(req);
    const name = (db.prepare("SELECT name FROM sites WHERE id=?").get(site(req)) as { name: string }).name;
    res.type("html").send(printPermit(record(db, get(req)), name));
  });
  app.post(base, (req, res) => {
    access(req, true);
    const body = permitInput.parse(req.body);
    mutate(req, res, `permit:create:${site(req)}`, body, () => {
      const id = randomUUID(), now = new Date().toISOString();
      db.prepare("INSERT INTO permits(id,site_id,body,status,version,requester_id,created_at,updated_at) VALUES(?,?,?,'draft',1,?,?,?)").run(id, site(req), JSON.stringify(body), req.session.userId!, now, now);
      audit(db, req.session.userId!, site(req), "permit.created", id);
      return record(db, get(req, id));
    }, () => { access(req, true); });
  });
  app.put(base + "/:id", (req, res) => {
    const role = access(req, true);
    const v = z.object({ version: z.number().int().min(1), body: permitInput }).strict().parse(req.body);
    mutate(req, res, `permit:edit:${req.params.id}`, v, () => {
      const r = get(req);
      expect(r, v.version, "draft");
      if (role !== "manager" && r.requester_id !== req.session.userId) throw new HttpError(403, "요청자나 관리자만 초안을 고칠 수 있습니다.");
      return step(req, r, "body=?", [JSON.stringify(v.body)], "updated");
    }, () => { access(req, true); });
  });
  app.post(base + "/:id/request", (req, res) => {
    access(req, true);
    const v = version.parse(req.body);
    mutate(req, res, `permit:request:${req.params.id}`, v, () => {
      const r = get(req);
      expect(r, v.version, "draft");
      if (r.requester_id !== req.session.userId) throw new HttpError(403, "요청자만 허가를 요청합니다.");
      if ((JSON.parse(r.body) as PermitInput).checks.includes("pending")) throw new HttpError(400, "확인 항목을 모두 '확인' 또는 '해당 없음'으로 정하세요.");
      return step(req, r, "status='requested'", [], "requested");
    }, () => { access(req, true); });
  });
  app.post(base + "/:id/decide", (req, res) => {
    access(req, true, true);
    const v = z.object({ version: z.number().int().min(1), approve: z.boolean(), note: z.string().trim().max(1000) }).strict().parse(req.body);
    mutate(req, res, `permit:decide:${req.params.id}`, v, () => {
      const r = get(req), me = req.session.userId!;
      expect(r, v.version, "requested");
      const sole = soleManager(db, site(req), me);
      if (r.requester_id === me && !sole) throw new HttpError(403, "요청자가 아닌 다른 관리자가 허가를 기록합니다.");
      if (!v.approve && !v.note) throw new HttpError(400, "반려 사유를 쓰세요.");
      const decision = { ...mark(req, v.note), approved: v.approve, ...(r.requester_id === me ? { selfProcessed: SOLE_MANAGER_NOTE } : {}) };
      return step(req, r, "status=?,decision=?", [v.approve ? "approved" : "rejected", JSON.stringify(decision)], v.approve ? "approved" : "rejected");
    }, () => { access(req, true, true); });
  });
  app.post(base + "/:id/close", (req, res) => {
    const role = access(req, true);
    const v = note.parse(req.body);
    mutate(req, res, `permit:close:${req.params.id}`, v, () => {
      const r = get(req);
      expect(r, v.version, "approved");
      if (role !== "manager" && r.requester_id !== req.session.userId) throw new HttpError(403, "요청자나 관리자가 작업 종료를 기록합니다.");
      return step(req, r, "status='closed',closure=?", [JSON.stringify(mark(req, v.note))], "closed");
    }, () => { access(req, true); });
  });
}
