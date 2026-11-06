import { useEffect, useRef, useState } from "react";
import { api, soleManagerOf, type Site, type User } from "./api";
import { ActionBar, EmptyState, Notice, PageHeader, Section, StatusChip, type Tone } from "./ui";
import { PERMIT_KINDS, type PermitKind } from "../server/permit-kinds";
// 작업허가서 (server/permits.ts): 작성 → 허가 요청 → 다른 관리자가 허가 또는 반려 → 작업 종료 기록.
// The app records people's decisions; it does not judge safety or replace a statutory permit.
type Check = "yes" | "na" | "pending";
type Body = { kind: PermitKind; work: string; location: string; validFrom: string; validTo: string; workers: string; precautions: string; checks: Check[] };
type Status = "draft" | "requested" | "approved" | "rejected" | "closed";
type Mark = { by: { id: string; name: string }; at: string; note: string; selfProcessed?: string };
type Permit = { id: string; status: Status; version: number; body: Body; kindLabel: string; requesterId: string; requesterName: string; createdAt: string; decision: (Mark & { approved: boolean }) | null; closure: Mark | null; retainUntil: string };
const STATUS: Record<Status, [Tone, string]> = { draft: ["draft", "작성 중"], requested: ["pending", "허가 요청"], approved: ["done", "허가 기록"], rejected: ["error", "반려"], closed: ["neutral", "작업 종료"] };
const local = (h = 0) => { const d = new Date(Date.now() + h * 3600_000); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
const blank = (kind: PermitKind = "hot"): Body => ({ kind, work: "", location: "", validFrom: local(), validTo: local(8), workers: "", precautions: "", checks: PERMIT_KINDS[kind].checks.map(() => "pending" as Check) });
export function PermitsPanel({ site, user, openId, onDirtyChange, onBusyChange }: { site: Site; user: User; openId?: string; onDirtyChange: (v: boolean) => void; onBusyChange: (v: boolean) => void }) {
  const base = `/sites/${site.id}/permits`;
  const [page, setPage] = useState<{ items: Permit[]; hasMore: boolean } | null>(null), [offset, setOffset] = useState(0), [tick, setTick] = useState(0);
  const [open, setOpen] = useState<Permit | null | undefined>(undefined), [form, setForm] = useState<Body>(blank()), [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [note, setNote] = useState("");
  const dirty = open !== undefined && JSON.stringify(form) !== saved;
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => { onBusyChange(busy); }, [busy, onBusyChange]);
  useEffect(() => () => { onDirtyChange(false); onBusyChange(false); }, [onDirtyChange, onBusyChange]);
  useEffect(() => { if (open === undefined) api<{ items: Permit[]; hasMore: boolean }>(`${base}?offset=${offset}`).then(setPage).catch((e) => setError((e as Error).message)); }, [base, offset, tick, open]);
  function show(r: Permit | null, from?: Body) { const b = r?.body ?? from ?? blank(); setOpen(r); setForm(b); setSaved(r ? JSON.stringify(b) : ""); setNote(""); setError(""); }
  async function load(id: string) { try { show(await api<Permit>(`${base}/${id}`)); } catch (e) { setError((e as Error).message); } }
  const openedFromHome = useRef<string | null>(null);
  useEffect(() => { if (openId && openedFromHome.current !== openId) { openedFromHome.current = openId; void load(openId); } }, [openId]);
  async function run(path: string, method: string, body: unknown) {
    setBusy(true); setError("");
    try { show(await api<Permit>(path, method, body, crypto.randomUUID())); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const leave = () => { if (!dirty || window.confirm("저장하지 않은 입력을 버리고 목록으로 돌아갈까요?")) { setOpen(undefined); setTick((t) => t + 1); } };
  const set = <K extends keyof Body>(k: K, v: Body[K]) => setForm({ ...form, [k]: v });
  if (open === undefined) return (
    <section className="panel">
      <PageHeader level={1} title="작업허가서">{site.role !== "viewer" && <button onClick={() => show(null)}>+ 작업허가서 작성</button>}</PageHeader>
      <Notice summary="화기·밀폐·고소·중장비·전기 작업 전에 허가를 요청하고, 다른 관리자가 허가를 기록합니다.">
        사람이 내린 허가 결정을 기록할 뿐 앱이 작업 안전을 판정하거나 법정 허가를 대신하지 않습니다. 요청한 뒤에는 내용을 바꿀 수 없습니다.
        관리자가 1명뿐인 현장에서는 본인 처리로 기록되고 표시됩니다. 작업이 끝난 날부터 1년 보존을 안내합니다.
      </Notice>
      {error && <p role="alert" className="error">{error}</p>}
      {!page ? <p>불러오는 중…</p> : !page.items.length ? <EmptyState title="아직 작업허가서가 없습니다">위험 작업 전에 작성하세요.</EmptyState> : page.items.map((r) => (
        <button key={r.id} type="button" className="record-row" onClick={() => void load(r.id)}>
          <div className="record-row-main"><h2>{r.kindLabel} · {r.body.work}</h2><p>{r.body.location} · {r.body.validFrom.replace("T", " ")} ~ {r.body.validTo.slice(11)} · 요청 {r.requesterName}</p></div>
          <StatusChip tone={STATUS[r.status][0]}>{STATUS[r.status][1]}</StatusChip>
        </button>
      ))}
      {page && (offset > 0 || page.hasMore) && <div className="tool-row"><button className="secondary" disabled={!offset} onClick={() => setOffset(offset - 50)}>이전 50</button><button className="secondary" disabled={!page.hasMore} onClick={() => setOffset(offset + 50)}>다음 50</button></div>}
    </section>
  );
  const status = open?.status ?? "draft", manager = site.role === "manager", mine = !open || open.requesterId === user.id;
  const editable = status === "draft" && site.role !== "viewer" && (mine || manager);
  const kind = PERMIT_KINDS[form.kind], pending = form.checks.filter((c) => c === "pending").length;
  return (
    <section className="panel">
      <PageHeader level={2} back="목록으로" onBack={leave} title={`작업허가서 · ${kind.label}`} status={<StatusChip tone={STATUS[status][0]}>{STATUS[status][1]}</StatusChip>}>
        {open && <a className="button secondary" href={`/api${base}/${open.id}/print`} target="_blank" rel="noreferrer">허가서 인쇄 / PDF</a>}
      </PageHeader>
      {error && <p role="alert" className="error">{error}</p>}
      <form onSubmit={(e) => { e.preventDefault(); void run(open ? `${base}/${open.id}` : base, open ? "PUT" : "POST", open ? { version: open.version, body: form } : form); }}>
        <fieldset disabled={!editable || busy}>
          <Section no={1} level={3} title="작업">
            <div className="grid">
              <label>작업 종류<select aria-label="작업 종류" value={form.kind} disabled={!!open} onChange={(e) => setForm(blank(e.target.value as PermitKind))}>{(Object.keys(PERMIT_KINDS) as PermitKind[]).map((k) => <option key={k} value={k}>{PERMIT_KINDS[k].label}</option>)}</select></label>
              <label>작업 내용 *<input required maxLength={500} value={form.work} onChange={(e) => set("work", e.target.value)} /></label>
              <label>장소 *<input required maxLength={300} value={form.location} onChange={(e) => set("location", e.target.value)} /></label>
              <label>허가 시작 *<input type="datetime-local" required value={form.validFrom} onChange={(e) => set("validFrom", e.target.value)} /></label>
              <label>허가 종료 *<input type="datetime-local" required value={form.validTo} onChange={(e) => set("validTo", e.target.value)} /></label>
            </div>
            <label>작업자 (이름 · 소속)<textarea rows={2} maxLength={1000} value={form.workers} onChange={(e) => set("workers", e.target.value)} /></label>
          </Section>
          <Section no={2} level={3} title={`작업 전 확인 · 남은 ${pending}개`}>
            {kind.checks.length === 0 && <p className="muted">이 종류에는 정해진 확인 항목이 없습니다. 아래 안전 조치에 직접 적으세요.</p>}
            {kind.checks.map((text, i) => (
              <div key={text} className="inspection-item">
                <span>{text}</span>
                <div className="segmented" role="group" aria-label={text}>
                  {(["yes", "na"] as const).map((v) => <button key={v} type="button" aria-pressed={form.checks[i] === v} className={form.checks[i] === v ? "" : "secondary"} onClick={() => set("checks", form.checks.map((c, j) => (j === i ? (c === v ? "pending" : v) : c)))}>{v === "yes" ? "확인" : "해당 없음"}</button>)}
                </div>
              </div>
            ))}
            <label>안전 조치 · 특이사항<textarea rows={3} maxLength={3000} value={form.precautions} onChange={(e) => set("precautions", e.target.value)} /></label>
          </Section>
        </fieldset>
        {editable && (
          <ActionBar note={<span role="status">{dirty ? "저장하지 않은 입력" : open ? "서버에 저장됨" : ""}</span>}>
            <button disabled={busy || (!dirty && !!open)}>초안 저장</button>
            {open && mine && <button type="button" disabled={busy || dirty || pending > 0} onClick={() => { if (window.confirm("허가를 요청할까요? 요청한 뒤에는 내용을 바꿀 수 없습니다.")) void run(`${base}/${open.id}/request`, "POST", { version: open.version }); }}>허가 요청</button>}
          </ActionBar>
        )}
      </form>
      {open && status === "requested" && manager && (open.requesterId !== user.id || soleManagerOf(site)) && (
        <Section no={3} level={3} title="허가 결정">
          <label>메모 · 반려 시 필수<input maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} /></label>
          <div className="tool-row">
            <button disabled={busy} onClick={() => void run(`${base}/${open.id}/decide`, "POST", { version: open.version, approve: true, note })}>허가 기록</button>
            <button className="danger" disabled={busy || !note.trim()} onClick={() => void run(`${base}/${open.id}/decide`, "POST", { version: open.version, approve: false, note })}>반려</button>
          </div>
        </Section>
      )}
      {open?.decision && <p role="status">{open.decision.approved ? "허가" : "반려"} · {open.decision.by.name} · {open.decision.at}{open.decision.selfProcessed ? ` · ${open.decision.selfProcessed}` : ""}{open.decision.note ? ` · ${open.decision.note}` : ""}</p>}
      {open && status === "approved" && (mine || manager) && site.role !== "viewer" && (
        <Section no={4} level={3} title="작업 종료">
          <label>종료 메모<input maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="정리 상태·잔불 확인 등" /></label>
          <button disabled={busy} onClick={() => void run(`${base}/${open.id}/close`, "POST", { version: open.version, note })}>작업 종료 기록</button>
        </Section>
      )}
      {open?.closure && <p role="status">작업 종료 · {open.closure.by.name} · {open.closure.at}{open.closure.note ? ` · ${open.closure.note}` : ""} · 보존 기한(안내) {open.retainUntil}</p>}
      {open?.status === "rejected" && site.role !== "viewer" && <button className="secondary" onClick={() => show(null, { ...open.body, checks: open.body.checks })}>이 내용으로 새 초안</button>}
    </section>
  );
}
