import { TbmRiskReferenceView } from "./TbmRiskReferenceView";
import { AiPolish } from "./AiDescriptionSuggest";
import { ActionBar, Notice, PageHeader, Section, StatusChip, TechDetails } from "./ui";
import { TbmRiskReferencePicker } from "./TbmRiskReferencePicker";
import { useEffect, useRef, useState } from "react";
import { api, type Site, type User } from "./api";
import { lastPlace, rememberPlace } from "./lastPlace";
import { TbmInvitations } from "./TbmInvitations";
import { useOfflineDraft } from "./useOfflineDraft";
import type { Worker, Page } from "./attendance-types";
import type { TbmDetails, TbmFull, TbmParticipant } from "./tbm-types";
const empty = (): TbmDetails => ({
  title: "",
  date: new Date().toLocaleDateString("en-CA"),
  time: "09:00",
  location: "",
  facilitator: "",
  work: "",
  topics: "",
});
export function TbmEditor({
  site,
  user,
  initial,
  onDirtyChange,
  onBusyChange,
  onClose,
  onOpen,
  onRevision,
}: {
  site: Site;
  user: User;
  initial: TbmFull | null;
  onDirtyChange: (value: boolean) => void;
  onBusyChange: (value: boolean) => void;
  onClose: () => void;
  onOpen: (id: string) => Promise<void>;
  onRevision: (next: TbmFull) => void;
}) {
  const [record, setRecord] = useState(initial),
    [form, setForm] = useState<TbmDetails>(
      initial?.snapshot?.body.details || initial?.body || { ...empty(), facilitator: user.name, location: lastPlace(site.id) },
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [key, setKey] = useState(crypto.randomUUID());
  const [search, setSearch] = useState(""),
    [workers, setWorkers] = useState<Worker[]>([]),
    [offset, setOffset] = useState(0),
    [more, setMore] = useState(false),
    [workersLoading, setWorkersLoading] = useState(false),
    [workerError, setWorkerError] = useState(""),
    [revisionReason, setRevisionReason] = useState("");
  const [referenceDirty,setReferenceDirty]=useState(false), [referenceBusy,setReferenceBusy]=useState(false), [historicalConfirm,setHistoricalConfirm]=useState(false), [fixedSource,setFixedSource]=useState<unknown>(null);
  const initialEmpty = useRef(form);
  const detailsDirty =
    JSON.stringify(form) !==
      JSON.stringify(record?.body || initialEmpty.current) || !!revisionReason;
  const dirty = detailsDirty || referenceDirty;
  const allBusy = busy || referenceBusy;
  const writable = site.role !== "viewer" && record?.status !== "finalized";
  // 오프라인 2단계: device draft of the TBM details, one automatic save when the connection returns.
  const offline = useOfflineDraft(`tbm:${site.id}:${record?.id ?? "new"}`, form, record?.body || initialEmpty.current, writable, () => void save());
  const participants =
    record?.snapshot?.body.participants || record?.participants || [];
  // A failed command retains its UUID while the exact path/payload is retried.
  const command = useRef<{ signature: string; key: string } | null>(null);
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    onBusyChange(allBusy);
    return () => onBusyChange(false);
  }, [allBusy, onBusyChange]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty || allBusy) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, allBusy]);
  useEffect(() => {
    if (!record || !writable) return;
    let active = true;
    setWorkersLoading(true);
    setWorkerError("");
    api<Page<Worker>>(
      `/sites/${site.id}/workers?active=true&search=${encodeURIComponent(search)}&offset=${offset}`,
    )
      .then((r) => {
        if (active) {
          setWorkers(r.items);
          setMore(r.hasMore);
        }
      })
      .catch((e) => {
        if (active) setWorkerError(e.message);
      })
      .finally(() => {
        if (active) setWorkersLoading(false);
      });
    return () => {
      active = false;
    };
  }, [site.id, record?.id, writable, search, offset]);
  function change(field: keyof TbmDetails, value: string) {
    setForm({ ...form, [field]: value });
    setKey(crypto.randomUUID());
  }
  function close() {
    if (
      !allBusy &&
      (!dirty ||
        window.confirm("저장하지 않은 TBM 입력을 버리고 목록으로 돌아갈까요?"))
    )
      onClose();
  }
  async function save(e?: React.FormEvent) {
    e?.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const next = await api<TbmFull>(
        `/sites/${site.id}/tbm${record ? "/" + record.id : ""}`,
        record ? "PUT" : "POST",
        { ...form, ...(record ? { version: record.version } : {}) },
        key,
      );
      setRecord(next);
      setHistoricalConfirm(false);
      setFixedSource(null);
      setForm(next.body);
      setKey(crypto.randomUUID());
      rememberPlace(site.id, next.body.location);
      offline.saved();
    } catch (e) {
      setError(offline.failed(e));
    } finally {
      setBusy(false);
    }
  }
  // 결정 (검토 2차, 편의 7): copy the previous TBM's roster as targets. They start as 미확인 — attendance and the old
  // record's states are not carried over, so the "출역 ≠ 참여" rule holds.
  async function copyPreviousParticipants() {
    if (!record || busy) return;
    setBusy(true);
    setError("");
    try {
      const page = await api<{ items: { id: string; body: { date: string; title: string } }[] }>(`/sites/${site.id}/tbm`);
      const previous = page.items.filter((t) => t.id !== record.id).sort((a, b) => b.body.date.localeCompare(a.body.date))[0];
      if (!previous) { setError("가져올 지난 TBM이 없습니다."); return; }
      const source = await api<TbmFull>(`/sites/${site.id}/tbm/${previous.id}`);
      const have = new Set(participants.map((x) => x.worker_id));
      const missing = source.participants.filter((x) => !have.has(x.worker_id)).slice(0, Math.max(0, 200 - participants.length));
      if (!missing.length) { setError(`지난 TBM(${previous.body.date} · ${previous.body.title})의 참가자가 이미 모두 있습니다.`); return; }
      if (!window.confirm(`지난 TBM(${previous.body.date} · ${previous.body.title})의 참가자 ${missing.length}명을 미확인으로 추가할까요? 참여 상태는 가져오지 않습니다.`)) return;
      let current = record;
      for (const x of missing)
        current = await api<TbmFull>(`/sites/${site.id}/tbm/${record.id}/participants`, "POST", { workerId: x.worker_id, version: current.version }, crypto.randomUUID());
      setRecord(current);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function mutate(
    suffix: string,
    method: string,
    payload: object,
    revision = false,
  ) {
    if (!record || busy) return;
    setBusy(true);
    setError("");
    const path = `/sites/${site.id}/tbm/${record.id}${suffix}`,
      body = { ...payload, version: record.version },
      signature = JSON.stringify({ path, method, body });
    if (command.current?.signature !== signature)
      command.current = { signature, key: crypto.randomUUID() };
    try {
      const next = await api<TbmFull>(path, method, body, command.current.key);
      command.current = null;
      if (revision) {
        setRevisionReason("");
        onRevision(next);
      } else {
        setRecord(next);
      setHistoricalConfirm(false);
      setFixedSource(null);
        setForm(next.snapshot?.body.details || next.body);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function openLinked(id: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await onOpen(id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function participantState(p: TbmParticipant, state: TbmParticipant["state"]) {
    if (
      !window.confirm(
        `${p.name}: 담당자가 '${{ pending: "미확인", present: "참여", absent: "불참" }[state]}'로 기록합니다. 본인의 서명/확인이 아닙니다. 계속할까요?`,
      )
    )
      return;
    void mutate("/participants/" + p.worker_id, "PUT", { state });
  }
  const statusText = dirty ? "저장하지 않은 입력" : record ? "서버에 저장됨" : "";
  return (
    <section className="panel tbm-editor">
      <PageHeader
        back="TBM 목록으로"
        backDisabled={allBusy}
        onBack={close}
        title={record?.status === "finalized" ? "관리자가 확정한 TBM 기록" : "TBM 초안"}
        status={
          record?.status === "finalized" ? <StatusChip tone="done">확정</StatusChip>
          : record?.parent_id ? <StatusChip tone="draft">정정 초안</StatusChip>
          : record ? <StatusChip tone="draft">작성 중</StatusChip>
          : <StatusChip tone="neutral">새 TBM</StatusChip>
        }
      >
        {record && (
          <a className="button secondary" href={`/api/sites/${site.id}/tbm/${record.id}/print`} target="_blank" rel="noreferrer">
            {record.status === "finalized" ? "확정 기록 인쇄 / PDF" : "저장 초안 인쇄 / PDF"}
          </a>
        )}
      </PageHeader>
      <Notice summary="담당자가 참여를 기록하고 관리자가 확정합니다.">
        담당자가 참여 사실을 수기로 기록하며 관리자가 기록을 확정합니다. 대상자
        신원·전자서명·법정 교육 이수 인증이 아닙니다.
      </Notice>
      {record?.parent_id && (
        <p className="muted">정정 사유: {record.revision_reason}</p>
      )}
      {record && (
        <TechDetails>
          <p>기록 {record.id} · v{record.version}{record.parent_id ? ` · 이전 확정본 ID: ${record.parent_id}` : ""}</p>
        </TechDetails>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <form onSubmit={save}>
      {offline.local && (
        <p role="status">
          이 기기에 저장 안 된 초안이 있습니다({new Date(offline.local.savedAt).toLocaleString()}).
          <button type="button" onClick={() => { setForm(offline.local!.value); offline.discard(); }}>기기 초안 복원</button>
          <button type="button" onClick={() => offline.discard()}>기기 초안 버리기</button>
        </p>
      )}
        <fieldset disabled={!writable || allBusy}>
          <Section no={1} level={3} title="기본 정보">
          <div className="grid">
            {(
              ["title", "date", "time", "location", "facilitator"] as const
            ).map((field, i) => (
              <label key={field}>
                {
                  [
                    "TBM 제목 *",
                    "TBM 날짜 *",
                    "TBM 시간 *",
                    "장소 · 확정 시 필수",
                    "진행자 입력 · 확정 시 필수",
                  ][i]
                }
                <input
                  type={
                    field === "date"
                      ? "date"
                      : field === "time"
                        ? "time"
                        : "text"
                  }
                  required={["title", "date", "time"].includes(field)}
                  maxLength={200}
                  value={form[field]}
                  onChange={(e) => change(field, e.target.value)}
                />
              </label>
            ))}
          </div>
          </Section>
          <Section no={2} level={3} title="전달 내용">
          <label>
            당일 작업 · 확정 시 필수
            <textarea
              maxLength={10000}
              rows={4}
              value={form.work}
              onChange={(e) => change("work", e.target.value)}
            />
          </label>
          <label>
            안전 전달사항 · 확정 시 필수
            <textarea
              maxLength={10000}
              rows={5}
              value={form.topics}
              onChange={(e) => change("topics", e.target.value)}
            />
          </label>
          {writable && <AiPolish siteId={site.id} kind="tbm_topics" text={form.topics} onApply={(v) => change("topics", v)} />}
          </Section>
        </fieldset>
        {writable ? (
          <ActionBar note={<span role="status">{statusText}</span>}>
            <button disabled={allBusy || (!dirty && !!record)}>
              TBM 초안 저장
            </button>
            {offline.waiting && <p role="status">통신이 끊겨 저장하지 못했습니다. 연결되면 자동으로 다시 저장합니다.</p>}
          </ActionBar>
        ) : (
          <p role="status" className="muted">{statusText}</p>
        )}
      </form>
      {record && (
        <>
          <Section no={3} level={3} title={`참가 대상 · ${participants.length}명`} aside={
            <button className="secondary" disabled={allBusy || dirty} onClick={()=>void openLinked(record.id)}>최신 저장본 다시 열기</button>
          }>
          <TbmInvitations key={record.id + ":" + record.version} path={`/sites/${site.id}/tbm/${record.id}/invitations`} draft={record.status === "draft"} writable={writable} />
          <Notice summary="명부에서 추가하면 미확인으로 시작합니다.">
            명부 추가 시 항상 미확인으로 시작합니다. 출역/다른 기록의 참여
            상태는 가져오지 않습니다.
          </Notice>
          <ul className="members">
            {participants.map((p) => (
              <li key={p.worker_id}>
                <span>
                  <strong>{p.name}</strong> · {p.affiliation}
                  {p.state === "present" ? <StatusChip tone="done">담당자 기록 · 참여</StatusChip>
                    : p.state === "absent" ? <StatusChip tone="neutral">담당자 기록 · 불참</StatusChip>
                    : <StatusChip tone="pending">미확인</StatusChip>}
                  <small>{p.recorded_at || "기록 전"}</small>
                </span>
                {writable && (
                  <span className="attendance-controls">
                    {(["present", "absent", "pending"] as const).map(
                      (state) => (
                        <button
                          key={state}
                          className="secondary"
                          disabled={allBusy || dirty || p.state === state}
                          onClick={() => participantState(p, state)}
                        >
                          {
                            {
                              present: "참여 기록",
                              absent: "불참 기록",
                              pending: "미확인으로",
                            }[state]
                          }
                        </button>
                      ),
                    )}
                    <button
                      className="secondary"
                      disabled={allBusy || dirty}
                      onClick={() => {
                        if (
                          window.confirm("이 초안에서 참가 대상을 제외할까요?")
                        )
                          void mutate(
                            "/participants/" + p.worker_id,
                            "DELETE",
                            {},
                          );
                      }}
                    >
                      대상 제외
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
          {writable && (
            <>
              <h4>참가 대상 추가</h4>
              <button type="button" className="secondary" disabled={allBusy || dirty} onClick={() => void copyPreviousParticipants()}>
                지난 TBM 참가자 불러오기
              </button>
              <label>
                TBM 명부 검색
                <input
                  maxLength={100}
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setOffset(0);
                  }}
                />
              </label>
              {workerError && (
                <p className="error" role="alert">
                  {workerError}
                </p>
              )}
              {workersLoading ? (
                <p>명부 조회 중…</p>
              ) : (
                <ul className="worker-choices">
                  {workers.map((w) => (
                    <li key={w.id}>
                      <button
                        className="secondary"
                        disabled={
                          busy ||
                          dirty ||
                          participants.length >= 200 ||
                          participants.some((p) => p.worker_id === w.id)
                        }
                        onClick={() =>
                          mutate("/participants", "POST", { workerId: w.id })
                        }
                      >
                        {w.name} · {w.affiliation}
                        <small>미확인으로 추가</small>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="form-actions">
                <button
                  className="secondary"
                  disabled={workersLoading || offset === 0 || busy}
                  onClick={() => setOffset(offset - 50)}
                >
                  TBM 명부 이전
                </button>
                <button
                  className="secondary"
                  disabled={workersLoading || !more || busy}
                  onClick={() => setOffset(offset + 50)}
                >
                  TBM 명부 다음
                </button>
              </div>
              {dirty && (
                <p className="muted">
                  참가 기록 변경 전에 초안 입력을 저장하세요.
                </p>
              )}
            </>
          )}
          <TechDetails summary="참가 기술 정보">
            {participants.map((p) => <p key={p.worker_id}>{p.name} · 명부 ID {p.worker_id} · 기록 계정 ID {p.recorded_by || "없음"}</p>)}
          </TechDetails>
          </Section>
          <Section level={3} title="위험성평가 참조">
          <TbmRiskReferenceView reference={record.riskReference ?? null} sourceHasSuccessor={record.riskSourceState?.sourceHasSuccessor} historicalAtFinalization={record.snapshot?.body.schemaVersion===2 && !!record.snapshot.body.riskReference?.sourceHasSuccessorAtFinalization}/>
          {record.riskReference && <button disabled={allBusy || dirty} onClick={async()=>{setBusy(true);setError("");try{setFixedSource(await api(`/sites/${site.id}/tbm/${record.id}/risk-reference/source`));}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>고정 평가 전체 원문 보기</button>}
          {fixedSource!==null && <pre className="risk-publication-source">{JSON.stringify(fixedSource,null,2)}</pre>}
          {writable && site.role==="manager" && <TbmRiskReferencePicker key={record.id+":"+record.version} siteId={site.id} disabled={busy||detailsDirty} onDirtyChange={setReferenceDirty} onBusyChange={setReferenceBusy} onSave={source=>void mutate("/risk-reference","PUT",{source})}/>}
          </Section>
          {record.status === "draft" && site.role === "manager" && (
            <Section no={4} level={3} title="관리자 기록 확정">
              {record.riskSourceState?.sourceHasSuccessor && <label><input type="checkbox" checked={historicalConfirm} disabled={allBusy||dirty} onChange={e=>setHistoricalConfirm(e.target.checked)}/>후속 평가가 있음을 확인하고 이 TBM에는 당시 고정 출처를 사용합니다. 안전 판단이 아닙니다.</label>}
              <Notice summary="확정하려면 필수 내용, 참여 1명 이상, 미확인 0명이 필요합니다.">
                잠정 업무 정책(법적 요건 아님): 필수 내용 입력, 참여 기록 1명
                이상, 미확인 0명. 확정 후 원본 수정은 불가하며 사유가 있는 정정
                초안만 만들 수 있습니다.
              </Notice>
              <button
                disabled={allBusy || dirty}
                onClick={() => {
                  if (
                    window.confirm(
                      "관리자로서 기록을 확정할까요? 신원/서명/법정 이수 인증이 아니며 원본은 수정할 수 없습니다.",
                    )
                  )
                    void mutate("/finalize", "POST", {acknowledgeHistoricalSource:historicalConfirm});
                }}
              >
                관리자가 기록 확정
              </button>
            </Section>
          )}
          {record.snapshot && (
            <section>
              <p className="muted">
                기록 확정 관리자: {record.snapshot.body.finalizedBy.name} ·{" "}
                {record.snapshot.body.finalizedAt}
              </p>
              <TechDetails>
                <p>확정 관리자 계정 ID {record.snapshot.body.finalizedBy.id}</p>
                <p className="record-hash">
                  내용 SHA-256: {record.snapshot.hash} · 내용 비교용이며
                  전자서명/법적 인증 아님.
                </p>
              </TechDetails>
              {record.successorId ? (
                <button
                  className="secondary"
                  disabled={allBusy}
                  onClick={() => {
                    if (
                      !dirty ||
                      window.confirm(
                        "정정 사유 입력을 버리고 연결된 기록을 열까요?",
                      )
                    )
                      void openLinked(record.successorId!);
                  }}
                >
                  연결된 정정본 열기
                </button>
              ) : (
                site.role === "manager" && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (
                        window.confirm(
                          "이전 확정본을 보존한 채 정정 초안을 만들까요? 참가 상태는 모두 미확인으로 초기화됩니다.",
                        )
                      )
                        void mutate(
                          "/revise",
                          "POST",
                          { reason: revisionReason },
                          true,
                        );
                    }}
                  >
                    <label>
                      정정 초안 생성 사유 *
                      <textarea
                        required
                        maxLength={500}
                        disabled={allBusy}
                        value={revisionReason}
                        onChange={(e) => setRevisionReason(e.target.value)}
                      />
                    </label>
                    <button disabled={allBusy || !revisionReason.trim()}>
                      정정 초안 만들기
                    </button>
                  </form>
                )
              )}
            </section>
          )}
        </>
      )}
    </section>
  );
}
