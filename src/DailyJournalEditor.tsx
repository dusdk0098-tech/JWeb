import { useOfflineDraft } from "./useOfflineDraft";
import { AiPolish } from "./AiDescriptionSuggest";
import { ActionBar, Notice, PageHeader, Section, StatusChip, TechDetails } from "./ui";
import { DailyJournalToday } from "./DailyJournalToday";
import { DailyInspectionReferences,DailyInspectionCaptured } from "./DailyInspectionReferences";
import { useEffect, useRef, useState } from "react";
import { api, type Site, type User } from "./api";
import { lastPlace, rememberPlace } from "./lastPlace";
import { useDraftGuard } from "./useDraftGuard";
import type { Page } from "./attendance-types";
import type { DailyBody, DailyJournal } from "./daily-journal-types";
import { DailyJournalSources } from "./DailyJournalSources";
const blank = (): DailyBody => ({
  workSummary: "",
  workLocations: "",
  safetyInstructions: "",
  observations: "",
  followupNotes: "",
  patrols: [],
});
export function DailyJournalEditor({
  site,
  user,
  initial,
  onDirtyChange,
  onBusyChange,
  onClose,
  onRevision,
}: {
  site: Site;
  user: User;
  initial: DailyJournal | null;
  onDirtyChange: (v: boolean) => void;
  onBusyChange: (v: boolean) => void;
  onClose: () => void;
  onRevision: (r: DailyJournal) => void;
}) {
  const [record, setRecord] = useState(initial),
    [body, setBody] = useState(initial?.body || { ...blank(), workLocations: lastPlace(site.id) }),
    [day, setDay] = useState(
      initial?.date || new Date().toLocaleDateString("en-CA"),
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [reason, setReason] = useState(""),
    [authorId, setAuthorId] = useState(""),
    [authors, setAuthors] = useState<{ id: string; name: string }[]>([]),
    [eventOffset, setEventOffset] = useState(0),
    [moreEvents, setMoreEvents] = useState(false),
    [events, setEvents] = useState<
      {
        version: number;
        event: string;
        actor_id: string;
        actor_name: string;
        at: string;
        note: string;
      }[]
    >([]);
  const initialDay = useRef(day),
    initialBody = useRef(body),
    base = `/sites/${site.id}/daily-journals`,
    manager = site.role === "manager",
    editable =
      site.role !== "viewer" &&
      (!record || (record.status === "draft" && record.author_id === user.id));
  const formDirty =
      JSON.stringify(body) !==
        JSON.stringify(record?.body || initialBody.current) ||
      day !== (record?.date || initialDay.current),
    actionDirty = !!reason || !!authorId,
    dirty = formDirty || actionDirty;
  const [inspectionBusy,setInspectionBusy]=useState(false);
  const allBusy=busy||inspectionBusy;
  const guard = useDraftGuard(dirty, allBusy, onDirtyChange, onBusyChange);
  // 오프라인 초안: an encrypted copy on this device while the form differs from the server (cleared after a successful save).
  const offline = useOfflineDraft(`journal:${site.id}:${user.id}:${record?.id ?? "new"}`, { body, day },
    { body: record?.body || initialBody.current, day: record?.date || initialDay.current }, editable, () => void save());
  useEffect(() => {
    if (!manager) return;
    let active = true;
    api<{ id: string; name: string }[]>(base + "/authors")
      .then((v) => {
        if (active) setAuthors(v);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [base, manager, record?.version]);
  useEffect(() => {
    if (!record) return;
    let active = true;
    api<Page<(typeof events)[number]>>(
      base + `/${record.id}/events?offset=${eventOffset}`,
    )
      .then((v) => {
        if (active) {
          setEvents(v.items);
          setMoreEvents(v.hasMore);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [base, record?.id, record?.version, eventOffset]);
  function adopt(r: DailyJournal) {
    setRecord(r);
    setBody(r.body);
    setDay(r.date);
    setReason("");
    setAuthorId("");
    setEventOffset(0);
  }
  async function save(e?: React.FormEvent) {
    e?.preventDefault();
    if (busy) return;
    const path = record ? base + "/" + record.id : base,
      value = record ? { version: record.version, body } : { date: day, body };
    setBusy(true);
    setError("");
    try {
      adopt(
        await api<DailyJournal>(
          path,
          record ? "PUT" : "POST",
          value,
          guard.key(path, value),
        ),
      );
      rememberPlace(site.id, body.workLocations);
      offline.saved();
    } catch (e) {
      setError(offline.failed(e));
    } finally {
      setBusy(false);
    }
  }
  // 편의 8: the two manager steps (reference capture, then archive) as one click with one question.
  async function captureAndArchive() {
    if (!record || busy) return;
    if (!window.confirm("선택 날짜의 수기 출역 집계와 TBM 확정 버전 참조를 새로 가져온 뒤 바로 보관할까요? 본문·참조는 고정되며 이후 정정은 새 초안입니다. 안전/법적 승인이나 본인서명이 아닙니다.")) return;
    setBusy(true);
    setError("");
    try {
      const capturePath = base + `/${record.id}/capture`, captureBody = { version: record.version };
      const captured = await api<DailyJournal>(capturePath, "POST", captureBody, guard.key(capturePath, captureBody));
      const archivePath = base + `/${record.id}/archive`, archiveBody = { version: captured.version };
      adopt(await api<DailyJournal>(archivePath, "POST", archiveBody, guard.key(archivePath, archiveBody)));
    } catch (e) {
      setError((e as Error).message + " 취합은 되었을 수 있습니다. 최신본을 다시 열어 확인하세요.");
    } finally {
      setBusy(false);
    }
  }
  async function command(action: "capture" | "archive" | "revise") {
    if (!record || busy) return;
    const path = base + `/${record.id}/${action}`,
      value =
        action === "revise"
          ? { version: record.version, reason, authorId }
          : { version: record.version };
    const question =
      action === "capture"
        ? "선택 날짜의 수기 출역 집계와 TBM 확정 버전 참조를 새로 가져올까요? 원자료를 인증하거나 수정하지 않습니다."
        : action === "archive"
          ? "관리자로서 기록을 보관할까요? 본문·참조는 고정되며 이후 정정은 새 초안입니다. 안전/법적 승인이나 본인서명이 아닙니다."
          : "이전 보관본을 유지하고 새 정정 초안을 만들까요? 같은 날짜, 자료 참조는 다시 가져와야 합니다.";
    if (!window.confirm(question)) return;
    setBusy(true);
    setError("");
    try {
      const r = await api<DailyJournal>(
        path,
        "POST",
        value,
        guard.key(path, value),
      );
      if (action === "revise") onRevision(r);
      else adopt(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function reload() {
    if (!record || !guard.canLeave()) return;
    setBusy(true);
    setError("");
    try {
      adopt(await api<DailyJournal>(base + "/" + record.id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function linked(id: string) {
    if (!guard.canLeave()) return;
    setBusy(true);
    setError("");
    try {
      onRevision(await api<DailyJournal>(base + "/" + id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const statusText = dirty ? "저장하지 않은 일지 입력" : record ? "서버에 저장됨" : "새 일지";
  return (
    <section className="panel journal-editor">
      <PageHeader
        back="일지 목록으로"
        backDisabled={allBusy}
        onBack={() => {
          if (guard.canLeave()) onClose();
        }}
        title={record?.status === "archived" ? "관리자가 보관한 안전업무일지" : "안전업무일지 초안"}
        status={
          record?.status === "archived" ? <StatusChip tone="done">확정 보관</StatusChip>
          : record?.parent_id ? <StatusChip tone="draft">정정 초안</StatusChip>
          : record ? <StatusChip tone="draft">작성 중</StatusChip>
          : <StatusChip tone="neutral">새 일지</StatusChip>
        }
      >
        {record && (
          <a className="button secondary" href={`/api${base}/${record.id}/print`} target="_blank" rel="noreferrer">
            일지 인쇄 / PDF
          </a>
        )}
      </PageHeader>
      {record?.parent_id && <p className="muted">정정 사유: {record.revision_reason}</p>}
      <Notice summary="직접 입력한 기록입니다. 앱이 판정하거나 승인하지 않습니다.">
        사용자가 선택한 날짜의 수기 안전업무일지입니다. 임금/근로시간/고용·교육
        이수·법적 승인·서명을 자동 판정하지 않습니다. 순찰 지적/조치는 직접
        입력한 설명이며 실제 위험 제거를 보증하지 않습니다.
      </Notice>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {offline.local && (
        <p role="status">
          이 기기에 저장 안 된 초안이 있습니다({new Date(offline.local.savedAt).toLocaleString()}).
          <button type="button" onClick={() => { setBody(offline.local!.value.body); if (!record) setDay(offline.local!.value.day); offline.discard(); }}>기기 초안 복원</button>
          <button type="button" onClick={() => offline.discard()}>기기 초안 버리기</button>
        </p>
      )}
      <form onSubmit={save}>
        <fieldset disabled={!editable || allBusy}>
          <label>
            일지 날짜 (저장 후 고정)
            <input
              type="date"
              required
              disabled={!!record || busy}
              value={day}
              onChange={(e) => setDay(e.target.value)}
            />
          </label>
          {editable && <DailyJournalToday siteId={site.id} date={day} />}
          <Section no={3} level={3} title="관찰·조치 입력">
          <label>
            작업 요약 · 보관 시 필수
            <textarea
              rows={4}
              maxLength={5000}
              value={body.workSummary}
              onChange={(e) =>
                setBody({ ...body, workSummary: e.target.value })
              }
            />
          </label>
          {editable && <AiPolish siteId={site.id} kind="journal_summary" text={body.workSummary} onApply={(v) => setBody({ ...body, workSummary: v })} />}
          <label>
            작업 장소
            <input
              maxLength={1000}
              value={body.workLocations}
              onChange={(e) =>
                setBody({ ...body, workLocations: e.target.value })
              }
            />
          </label>
          <label>
            안전 안내 기록 · 보관 시 필수
            <textarea
              rows={4}
              maxLength={5000}
              value={body.safetyInstructions}
              onChange={(e) =>
                setBody({ ...body, safetyInstructions: e.target.value })
              }
            />
          </label>
          {editable && <AiPolish siteId={site.id} kind="journal_safety" text={body.safetyInstructions} onApply={(v) => setBody({ ...body, safetyInstructions: v })} />}
          <label>
            관찰 사항
            <textarea
              maxLength={5000}
              value={body.observations}
              onChange={(e) =>
                setBody({ ...body, observations: e.target.value })
              }
            />
          </label>
          <h4>순찰 · 지적 · 개선 기록 (최대 20항목)</h4>
          {body.patrols.map((p, i) => (
            <fieldset key={i}>
              <legend>순찰 {i + 1}</legend>
              <label>
                순찰 장소
                <input
                  required
                  maxLength={200}
                  value={p.location}
                  onChange={(e) =>
                    setBody({
                      ...body,
                      patrols: body.patrols.map((v, j) =>
                        j === i ? { ...v, location: e.target.value } : v,
                      ),
                    })
                  }
                />
              </label>
              <label>
                지적/관찰 내용
                <textarea
                  required
                  maxLength={1000}
                  value={p.finding}
                  onChange={(e) =>
                    setBody({
                      ...body,
                      patrols: body.patrols.map((v, j) =>
                        j === i ? { ...v, finding: e.target.value } : v,
                      ),
                    })
                  }
                />
              </label>
              <label>
                직접 기록한 개선/요청 내용
                <textarea
                  maxLength={1000}
                  value={p.action}
                  onChange={(e) =>
                    setBody({
                      ...body,
                      patrols: body.patrols.map((v, j) =>
                        j === i ? { ...v, action: e.target.value } : v,
                      ),
                    })
                  }
                />
              </label>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  if (
                    window.confirm(
                      "이 초안의 순찰 입력 항목을 제거할까요? 아직 보관된 기록은 아닙니다.",
                    )
                  )
                    setBody({
                      ...body,
                      patrols: body.patrols.filter((_, j) => j !== i),
                    });
                }}
              >
                초안 순찰 항목 제거
              </button>
            </fieldset>
          ))}
          <button
            type="button"
            className="secondary"
            disabled={body.patrols.length >= 20}
            onClick={() =>
              setBody({
                ...body,
                patrols: [
                  ...body.patrols,
                  { location: "", finding: "", action: "" },
                ],
              })
            }
          >
            + 순찰 항목 추가
          </button>
          <label>
            후속 업무 메모
            <textarea
              maxLength={5000}
              value={body.followupNotes}
              onChange={(e) =>
                setBody({ ...body, followupNotes: e.target.value })
              }
            />
          </label>
          </Section>
          <Section no={4} level={3} title="참조 확인">
          <label><input type="checkbox" checked={body.inspectionReferences!==undefined} onChange={e=>{if(!e.target.checked&&!window.confirm('미저장 점검 선택과 메모를 제거할까요?'))return;const next={...body};if(e.target.checked)next.inspectionReferences=[];else delete next.inspectionReferences;setBody(next);}}/>같은 날 점검 제출본 참조</label>
          {body.inspectionReferences&&<DailyInspectionReferences siteId={site.id} date={day} value={body.inspectionReferences} onChange={v=>setBody({...body,inspectionReferences:v})} onBusy={setInspectionBusy}/>}
          </Section>
        </fieldset>
        {editable ? (
          <ActionBar note={<span role="status">{statusText}</span>}>
            <button disabled={allBusy || actionDirty || (!formDirty && !!record)}>
              일지 초안 저장
            </button>
            {offline.waiting && <p role="status">통신이 끊겨 저장하지 못했습니다. 연결되면 자동으로 다시 저장합니다.</p>}
          </ActionBar>
        ) : (
          <p role="status" className="muted">{statusText}</p>
        )}
      </form>
      {record && (
        <>
          <Section level={3} title="참조와 보관" aside={
            <button className="secondary" disabled={allBusy} onClick={() => void reload()}>
              일지 최신본 불러오기
            </button>
          }>
          {(record.snapshot?.body.source||record.source_capture)?.facts.inspectionReferences&&<DailyInspectionCaptured items={(record.snapshot?.body.source||record.source_capture)!.facts.inspectionReferences!}/>}
          <DailyJournalSources
            source={record.snapshot?.body.source || record.source_capture}
            siteId={site.id}
          />
          {editable && (
            <button
              disabled={allBusy || dirty}
              onClick={() => void command("capture")}
            >
              해당일 자료 참조 갱신
            </button>
          )}
          {manager && record.status === "draft" && (
            <>
              <Notice summary="보관 직전에 그날 자료가 바뀌었으면 보관이 멈춥니다. 작성자가 참조를 다시 가져와야 합니다.">
                보관 직전에 해당일 관련 원자료가 바뀌었으면409로 중단합니다. 원
                작성자가 참조를 갱신해야 합니다. 작성 계정이 철회됐다면
                관리자에게 현재 권한 회복 여부 판단이 필요합니다. 자동 작성자
                변경 없음.
              </Notice>
              <button
                disabled={allBusy || dirty || !record.source_capture}
                onClick={() => void command("archive")}
              >
                관리자가 일지 기록 보관
              </button>
              <button type="button" className="secondary" disabled={allBusy || dirty} onClick={() => void captureAndArchive()}>
                참조 취합 후 보관
              </button>
            </>
          )}
          {record.snapshot && (
            <p className="muted">
              보관 {record.snapshot.body.archivedAt} ·{" "}
              {record.snapshot.body.archivedBy.name}
            </p>
          )}
          </Section>
          {record.parent_id && (
            <button
              className="secondary"
              disabled={allBusy}
              onClick={() => void linked(record.parent_id!)}
            >
              이전 보관 일지 열기
            </button>
          )}
          {record.successorId ? (
            <button
              className="secondary"
              disabled={allBusy}
              onClick={() => void linked(record.successorId!)}
            >
              기존 정정 일지 열기
            </button>
          ) : (
            manager &&
            record.status === "archived" && (
              <fieldset disabled={allBusy}>
                <h3>새 정정 초안 (이전 보관본 유지)</h3>
                <label>
                  일지 정정 사유
                  <textarea
                    maxLength={1000}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
                <label>
                  정정 초안 작성 계정
                  <select
                    value={authorId}
                    onChange={(e) => setAuthorId(e.target.value)}
                  >
                    <option value="">현재 현장 작성자/관리자 선택</option>
                    {authors.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} · {a.id}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  disabled={!reason.trim() || !authorId}
                  onClick={() => void command("revise")}
                >
                  사유 있는 새 정정 초안
                </button>
              </fieldset>
            )
          )}
          <Section level={3} title="처리 이력">
          <Notice summary="보관 시점의 내용과 처리 기록을 남깁니다.">
            초안 본문/이전 취합 전체 버전은 보관하지 않습니다. 보관 시점의
            본문·참조 snapshot과 처리 메타데이터를 보존합니다.
          </Notice>
          {events.map((e) => (
            <p key={e.version}>
              {e.at} · {e.event} · {e.actor_name}
              <br />
              {e.note}
            </p>
          ))}
          <div className="actions">
            <button
              className="secondary"
              disabled={allBusy || !eventOffset}
              onClick={() => setEventOffset((v) => Math.max(0, v - 50))}
            >
              이전 50
            </button>
            <button
              className="secondary"
              disabled={allBusy || !moreEvents}
              onClick={() => setEventOffset((v) => v + 50)}
            >
              다음 50
            </button>
          </div>
          </Section>
          <TechDetails>
            <p>
              일지 {record.id} · {record.date} · v{record.version} · 작성 계정{" "}
              {record.author_id}
            </p>
            {record.snapshot && <p>보관 계정 {record.snapshot.body.archivedBy.id} · SHA-256 {record.snapshot.hash}</p>}
            {events.map((e) => <p key={e.version}>v{e.version} · {e.event} · {e.actor_id}</p>)}
          </TechDetails>
        </>
      )}
    </section>
  );
}
