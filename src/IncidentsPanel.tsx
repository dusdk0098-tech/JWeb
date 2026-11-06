import { useEffect, useRef, useState } from "react";
import { api, type Site } from "./api";
import { ActionBar, EmptyState, Notice, PageHeader, Section, StatusChip, TechDetails } from "./ui";
// 사고 · 아차사고 기록 (server/incidents.ts). List → write → manager confirms; a confirmed record is fixed and a
// correction is a new linked draft. The 산업재해조사표 due date is a guide; the app files nothing.
type Kind = "accident" | "near_miss";
type Body = { kind: Kind; occurredAt: string; location: string; workType: string; injured: string; lostDays3Plus: boolean; description: string; cause: string; immediateAction: string; preventionPlan: string };
type Incident = {
  id: string; status: "draft" | "confirmed"; version: number; body: Body; parentId: string | null; revisionReason: string | null; successorId: string | null;
  authorName: string; createdAt: string; confirmed: { by: { name: string }; at: string } | null; confirmedHash: string | null;
  reportDue: string | null; reportFiledOn: string | null; reportNote: string | null; retainUntil: string;
};
const KIND: Record<Kind, string> = { accident: "사고", near_miss: "아차사고" };
const now = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
const blank = (): Body => ({ kind: "near_miss", occurredAt: now(), location: "", workType: "", injured: "", lostDays3Plus: false, description: "", cause: "", immediateAction: "", preventionPlan: "" });
const today = () => new Date().toLocaleDateString("en-CA");
export function IncidentsPanel({ site, openId, onDirtyChange, onBusyChange }: { site: Site; openId?: string; onDirtyChange: (v: boolean) => void; onBusyChange: (v: boolean) => void }) {
  const base = `/sites/${site.id}/incidents`;
  const [page, setPage] = useState<{ items: Incident[]; hasMore: boolean } | null>(null), [offset, setOffset] = useState(0), [tick, setTick] = useState(0);
  const [open, setOpen] = useState<Incident | null | undefined>(undefined), [form, setForm] = useState<Body>(blank()), [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [report, setReport] = useState({ filedOn: today(), note: "" }), [reason, setReason] = useState("");
  const dirty = open !== undefined && JSON.stringify(form) !== saved;
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => { onBusyChange(busy); }, [busy, onBusyChange]);
  useEffect(() => () => { onDirtyChange(false); onBusyChange(false); }, [onDirtyChange, onBusyChange]);
  useEffect(() => { if (open === undefined) api<{ items: Incident[]; hasMore: boolean }>(`${base}?offset=${offset}`).then(setPage).catch((e) => setError((e as Error).message)); }, [base, offset, tick, open]);
  function show(r: Incident | null) { const b = r?.body ?? blank(); setOpen(r); setForm(b); setSaved(JSON.stringify(b)); setReason(""); setError(""); }
  async function load(id: string) { try { show(await api<Incident>(`${base}/${id}`)); } catch (e) { setError((e as Error).message); } }
  const openedFromHome = useRef<string | null>(null);
  useEffect(() => { if (openId && openedFromHome.current !== openId) { openedFromHome.current = openId; void load(openId); } }, [openId]);
  async function run(path: string, method: string, body: unknown) {
    setBusy(true); setError("");
    try { show(await api<Incident>(path, method, body, crypto.randomUUID())); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const leave = () => { if (!dirty || window.confirm("저장하지 않은 입력을 버리고 목록으로 돌아갈까요?")) { setOpen(undefined); setTick((t) => t + 1); } };
  const set = <K extends keyof Body>(k: K, v: Body[K]) => setForm({ ...form, [k]: v });
  if (open === undefined) return (
    <section className="panel">
      <PageHeader level={1} title="사고 · 아차사고">{site.role !== "viewer" && <button onClick={() => show(null)}>+ 사고 · 아차사고 기록</button>}</PageHeader>
      <Notice summary="일어난 일과 원인, 재발 방지 계획을 남깁니다. 산업재해 여부를 앱이 판단하지 않습니다.">
        휴업 3일 이상 사고는 산업재해조사표 제출 기한(발생일로부터 1개월)을 안내합니다. 기한 계산은 안내이며 제출은 직접 하세요.
        재해자 칸에는 이름·소속·직종만 쓰고 주민등록번호·진단 내용은 넣지 마세요. 기록은 발생일로부터 3년 보존을 안내합니다.
      </Notice>
      {error && <p role="alert" className="error">{error}</p>}
      {!page ? <p>불러오는 중…</p> : !page.items.length ? <EmptyState title="아직 기록이 없습니다">사고나 아차사고가 있으면 바로 기록하세요.</EmptyState> : page.items.map((r) => (
        <button key={r.id} type="button" className="record-row" onClick={() => void load(r.id)}>
          <div className="record-row-main"><h2>{KIND[r.body.kind]} · {r.body.occurredAt.replace("T", " ")} · {r.body.location}</h2>
            <p>{r.body.description.slice(0, 120)}{r.parentId ? " · 정정본" : ""}{r.reportDue && !r.reportFiledOn ? ` · 조사표 기한 ${r.reportDue}` : ""}</p></div>
          {r.status === "confirmed" ? <StatusChip tone="done">확정</StatusChip> : <StatusChip tone="draft">작성 중</StatusChip>}
        </button>
      ))}
      {page && (offset > 0 || page.hasMore) && <div className="tool-row"><button className="secondary" disabled={!offset} onClick={() => setOffset(offset - 50)}>이전 50</button><button className="secondary" disabled={!page.hasMore} onClick={() => setOffset(offset + 50)}>다음 50</button></div>}
    </section>
  );
  const editable = !open || (open.status === "draft" && site.role !== "viewer"), manager = site.role === "manager";
  return (
    <section className="panel">
      <PageHeader level={2} back="목록으로" onBack={leave} title={`${KIND[form.kind]} 기록`} status={open?.status === "confirmed" ? <StatusChip tone="done">확정</StatusChip> : <StatusChip tone="draft">작성 중</StatusChip>}>
        {open && <a className="button secondary" href={`/api${base}/${open.id}/print`} target="_blank" rel="noreferrer">기록 인쇄 / PDF</a>}
      </PageHeader>
      {open?.parentId && <p className="muted">정정 사유: {open.revisionReason}</p>}
      {open?.successorId && <p className="notice">이 기록에는 정정 초안이 있습니다. <button className="secondary" onClick={() => void load(open.successorId!)}>정정 초안 열기</button></p>}
      {error && <p role="alert" className="error">{error}</p>}
      <form onSubmit={(e) => { e.preventDefault(); void run(open ? `${base}/${open.id}` : base, open ? "PUT" : "POST", open ? { version: open.version, body: form } : form); }}>
        <fieldset disabled={!editable || busy}>
          <Section no={1} level={3} title="무엇이 일어났나">
            <div className="grid">
              <label>종류<select aria-label="종류" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as Kind, lostDays3Plus: e.target.value === "accident" && form.lostDays3Plus })}><option value="near_miss">아차사고 (다친 사람 없음)</option><option value="accident">사고 (다친 사람 있음)</option></select></label>
              <label>발생 일시 *<input type="datetime-local" required value={form.occurredAt} onChange={(e) => set("occurredAt", e.target.value)} /></label>
              <label>장소 *<input required maxLength={300} value={form.location} onChange={(e) => set("location", e.target.value)} /></label>
              <label>작업 종류<input maxLength={200} value={form.workType} onChange={(e) => set("workType", e.target.value)} /></label>
            </div>
            {form.kind === "accident" && <>
              <label>재해자 (이름 · 소속 · 직종)<input maxLength={500} value={form.injured} onChange={(e) => set("injured", e.target.value)} placeholder="주민등록번호·진단 내용은 넣지 마세요" /></label>
              <label><input type="checkbox" checked={form.lostDays3Plus} onChange={(e) => set("lostDays3Plus", e.target.checked)} /> 휴업 3일 이상 (산업재해조사표 제출 대상일 수 있음)</label>
            </>}
            <label>발생 경위 *<textarea required rows={4} maxLength={5000} value={form.description} onChange={(e) => set("description", e.target.value)} /></label>
          </Section>
          <Section no={2} level={3} title="원인과 조치">
            <label>원인 · 확정 시 필수<textarea rows={3} maxLength={3000} value={form.cause} onChange={(e) => set("cause", e.target.value)} /></label>
            <label>즉시 조치<textarea rows={3} maxLength={3000} value={form.immediateAction} onChange={(e) => set("immediateAction", e.target.value)} /></label>
            <label>재발 방지 계획 · 확정 시 필수<textarea rows={3} maxLength={3000} value={form.preventionPlan} onChange={(e) => set("preventionPlan", e.target.value)} /></label>
          </Section>
        </fieldset>
        {editable && (
          <ActionBar note={<span role="status">{dirty ? "저장하지 않은 입력" : open ? "서버에 저장됨" : ""}</span>}>
            <button disabled={busy || (!dirty && !!open)}>초안 저장</button>
            {open && manager && <button type="button" disabled={busy || dirty} onClick={() => { if (window.confirm("관리자로서 기록을 확정할까요? 확정한 내용은 바꿀 수 없고 정정 초안만 만들 수 있습니다.")) void run(`${base}/${open.id}/confirm`, "POST", { version: open.version }); }}>관리자가 기록 확정</button>}
          </ActionBar>
        )}
      </form>
      {open?.reportDue && (
        <Section no={3} level={3} title="산업재해조사표">
          <p>제출 기한(안내): <strong>{open.reportDue}</strong> · 발생일로부터 1개월. {open.reportFiledOn ? `제출일 ${open.reportFiledOn}${open.reportNote ? ` · ${open.reportNote}` : ""}` : "제출일이 아직 기록되지 않았습니다."}</p>
          {manager && !open.reportFiledOn && (
            <div className="inline-create">
              <label>제출일<input type="date" value={report.filedOn} onChange={(e) => setReport({ ...report, filedOn: e.target.value })} /></label>
              <label>메모<input maxLength={500} value={report.note} onChange={(e) => setReport({ ...report, note: e.target.value })} placeholder="접수 방법·번호 등" /></label>
              <button type="button" disabled={busy || dirty} onClick={() => void run(`${base}/${open.id}/report`, "POST", { version: open.version, ...report })}>제출일 기록</button>
            </div>
          )}
          <p className="muted">해당 여부와 제출은 관할 지방고용노동관서 안내를 따르세요. 앱은 제출하지 않습니다.</p>
        </Section>
      )}
      {open?.status === "confirmed" && (
        <Section level={3} title="확정 정보">
          <p>확정 {open.confirmed?.by.name} · {open.confirmed?.at} · 보존 기한(안내) {open.retainUntil}</p>
          {manager && !open.successorId && (
            <div className="inline-create">
              <label>정정 사유<input maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
              <button type="button" className="secondary" disabled={busy || !reason.trim()} onClick={() => void run(`${base}/${open.id}/revise`, "POST", { version: open.version, reason })}>정정 초안 만들기</button>
            </div>
          )}
          <TechDetails><p>고정 SHA-256: {open.confirmedHash}</p></TechDetails>
        </Section>
      )}
    </section>
  );
}
