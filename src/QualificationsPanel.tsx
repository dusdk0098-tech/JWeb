import { useEffect, useState } from "react";
import { api, type Site } from "./api";
import { EmptyState, Notice, PageHeader, Section, StatusChip, type Tone } from "./ui";
import type { Worker, Page } from "./attendance-types";
import { QUALIFICATION_KINDS, SOON_DAYS, type QualificationKind } from "../server/qualification-kinds";
// 교육 · 자격 이수 현황 (server/qualifications.ts): what each certificate or licence says, and what has expired or expires soon.
type State = "expired" | "soon" | "ok" | "none" | "renewed";
type Item = { id: string; workerId: string; workerName: string; affiliation: string; kind: QualificationKind; kindLabel: string; label: string; issuedOn: string; expiresOn: string | null; note: string; createdBy: string; state: State };
const STATE: Record<State, [Tone, string]> = { expired: ["error", "만료"], soon: ["pending", `${SOON_DAYS}일 이내 만료`], ok: ["done", "유효"], none: ["neutral", "만료일 없음"], renewed: ["neutral", "갱신됨"] };
const FILTERS = [["all", "전체"], ["expired", "만료됨"], ["soon", `${SOON_DAYS}일 이내`]] as const;
const today = () => new Date().toLocaleDateString("en-CA");
const blank = () => ({ workerId: "", kind: "basic" as QualificationKind, label: "", issuedOn: today(), expiresOn: "", note: "" });
export function QualificationsPanel({ site, onDirtyChange, onBusyChange }: { site: Site; onDirtyChange: (v: boolean) => void; onBusyChange: (v: boolean) => void }) {
  const base = `/sites/${site.id}/qualifications`, manager = site.role === "manager";
  const [filter, setFilter] = useState<(typeof FILTERS)[number][0]>("all"), [offset, setOffset] = useState(0), [tick, setTick] = useState(0);
  const [page, setPage] = useState<{ items: Item[]; hasMore: boolean } | null>(null), [error, setError] = useState(""), [notice, setNotice] = useState(""), [busy, setBusy] = useState(false);
  const [form, setForm] = useState(blank()), [search, setSearch] = useState(""), [workers, setWorkers] = useState<Worker[]>([]);
  const [renewing, setRenewing] = useState<Item | null>(null), [voiding, setVoiding] = useState<string | null>(null), [reason, setReason] = useState("");
  const dirty = JSON.stringify(form) !== JSON.stringify({ ...blank(), issuedOn: form.issuedOn }) || !!reason;
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => { onBusyChange(busy); }, [busy, onBusyChange]);
  useEffect(() => () => { onDirtyChange(false); onBusyChange(false); }, [onDirtyChange, onBusyChange]);
  useEffect(() => { api<{ items: Item[]; hasMore: boolean }>(`${base}?filter=${filter}&offset=${offset}`).then(setPage).catch((e) => setError((e as Error).message)); }, [base, filter, offset, tick]);
  useEffect(() => {
    if (!manager) return;
    const t = setTimeout(() => void api<Page<Worker>>(`/sites/${site.id}/workers?active=true&search=${encodeURIComponent(search)}&offset=0`).then((p) => setWorkers(p.items)).catch(() => setWorkers([])), 250);
    return () => clearTimeout(t);
  }, [site.id, search, manager]);
  async function run(path: string, body: unknown, done: string, reset: () => void) {
    setBusy(true); setError(""); setNotice("");
    try { await api(path, "POST", body, crypto.randomUUID()); reset(); setNotice(done); setTick((t) => t + 1); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  function renew(q: Item) {
    setRenewing(q); setNotice("");
    setForm({ ...blank(), workerId: q.workerId, kind: q.kind, label: q.label });
    document.getElementById("qualification-new")?.scrollIntoView({ block: "start" });
  }
  const clearForm = () => { setForm(blank()); setRenewing(null); };
  const hint = QUALIFICATION_KINDS[form.kind].hint;
  return (
    <section className="panel">
      <PageHeader level={1} title="이수 · 자격" />
      <Notice summary={`근로자별 교육 이수증·면허의 내용과 만료일을 기록하고, 만료됐거나 ${SOON_DAYS}일 안에 만료되는 것을 보여 줍니다.`}>
        입력한 내용을 보관할 뿐 이수·자격을 앱이 인증하거나 교육 주기를 계산하지 않습니다. 만료일은 이수증·면허에 적힌 날짜나 다음 이수 기한을 직접 입력하세요.
        기록은 고칠 수 없습니다. 다시 받은 이수증·면허는 이전 기록의 &apos;갱신 기록&apos;으로 넣으면 이전 기록이 알림에서 빠집니다.
        잘못 넣은 기록은 사유를 남기고 무효 처리합니다. 명부에서 내린 사람은 홈 알림에 나오지 않습니다. 주민등록번호는 넣지 마세요.
      </Notice>
      {error && <p role="alert" className="error">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {manager && (
        <Section level={2} title={renewing ? "갱신 기록" : "새 기록"} id="qualification-new">
          <form className="grid" onSubmit={(e) => { e.preventDefault(); void run(base, { ...form, expiresOn: form.expiresOn || null, ...(renewing ? { replacesId: renewing.id } : {}) }, "기록했습니다.", clearForm); }}>
            {renewing ? (
              <div className="tool-row">
                <span>{renewing.workerName} · {renewing.kindLabel} · 이전 만료 {renewing.expiresOn ?? "없음"}</span>
                <button type="button" className="secondary" onClick={clearForm}>갱신 취소</button>
              </div>
            ) : (
              <>
                <label>사람 찾기<input type="search" maxLength={100} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="이름·소속" /></label>
                <label>사람 *<select aria-label="사람" required value={form.workerId} onChange={(e) => setForm({ ...form, workerId: e.target.value })}><option value="">선택</option>{workers.map((w) => <option key={w.id} value={w.id}>{w.name} · {w.affiliation}</option>)}</select></label>
                <label>종류<select aria-label="종류" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as QualificationKind })}>{(Object.keys(QUALIFICATION_KINDS) as QualificationKind[]).map((k) => <option key={k} value={k}>{QUALIFICATION_KINDS[k].label}</option>)}</select></label>
              </>
            )}
            <label>이름 · 번호 *<input required maxLength={200} value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="이수증 번호, 자격 이름 등" /></label>
            <label>이수일 *<input type="date" required value={form.issuedOn} onChange={(e) => setForm({ ...form, issuedOn: e.target.value })} /></label>
            <label>만료일<input type="date" value={form.expiresOn} onChange={(e) => setForm({ ...form, expiresOn: e.target.value })} /></label>
            <label>메모<input maxLength={1000} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
            {hint && <p className="muted">{hint}</p>}
            <button disabled={busy || !form.workerId}>기록 추가</button>
          </form>
        </Section>
      )}
      <div className="segmented" role="group" aria-label="보기">
        {FILTERS.map(([v, l]) => <button key={v} type="button" aria-pressed={filter === v} className={filter === v ? "" : "secondary"} onClick={() => { setFilter(v); setOffset(0); }}>{l}</button>)}
      </div>
      {!page ? <p>불러오는 중…</p> : !page.items.length ? <EmptyState title={filter === "all" ? "아직 기록이 없습니다" : "해당하는 기록이 없습니다"}>{filter === "all" && manager ? "위에서 첫 기록을 추가하세요." : ""}</EmptyState> : page.items.map((q) => (
        <article key={q.id} className="record-row">
          <div className="record-row-main">
            <h2>{q.workerName} · {q.kindLabel}</h2>
            <p>{q.affiliation} · {q.label} · 이수 {q.issuedOn}{q.expiresOn ? ` · 만료 ${q.expiresOn}` : ""}{q.note ? ` · ${q.note}` : ""}</p>
            {voiding === q.id && (
              <div className="inline-create">
                <label>무효 사유<input maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
                <button type="button" className="danger" disabled={busy || !reason.trim()} onClick={() => void run(`${base}/${q.id}/void`, { reason }, "무효 처리했습니다.", () => { setVoiding(null); setReason(""); })}>무효 처리</button>
                <button type="button" className="secondary" onClick={() => { setVoiding(null); setReason(""); }}>취소</button>
              </div>
            )}
          </div>
          <StatusChip tone={STATE[q.state][0]}>{STATE[q.state][1]}</StatusChip>
          {manager && voiding !== q.id && q.expiresOn && q.state !== "renewed" && <button type="button" className="secondary" onClick={() => renew(q)}>갱신 기록</button>}
          {manager && voiding !== q.id && <button type="button" className="secondary" onClick={() => { setVoiding(q.id); setReason(""); }}>무효 처리…</button>}
        </article>
      ))}
      {page && <div className="tool-row"><button className="secondary" disabled={!offset} onClick={() => setOffset(offset - 50)}>이전 50</button><button className="secondary" disabled={!page.hasMore} onClick={() => setOffset(offset + 50)}>다음 50</button></div>}
    </section>
  );
}
