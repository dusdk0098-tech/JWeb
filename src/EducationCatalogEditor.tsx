import { CatalogReview, type CatalogReviewRecord } from "./CatalogReview";
import { CatalogUseNotice,type CatalogUseStatus } from "./CatalogUseNotice";
import { CatalogStopForm } from "./CatalogStopForm";
import { useEffect, useRef, useState } from "react";
import { api, type Site } from "./api";
import type { EducationFull } from "./education-types";
import { useDraftGuard } from "./useDraftGuard";
import {
  catalogWarning,
  type CatalogRecord,
  type CatalogBody,
} from "./education-catalog-types";
const empty: CatalogBody = {
  title: "",
  categoryLabel: "",
  objectives: "",
  contents: "",
  referenceNote: "",
};
export function EducationCatalogEditor({
  site,
  initial,
  onClose,
  onRevision,
  onJournal,
  onDirtyChange,
  onBusyChange,
}: {
  site: Site;
  initial: CatalogRecord | null;
  onClose: () => void;
  onRevision: (v: CatalogRecord) => void;
  onJournal: (v: EducationFull) => void;
  onDirtyChange: (v: boolean) => void;
  onBusyChange: (v: boolean) => void;
}) {
  const [record, setRecord] = useState(initial),
    [body, setBody] = useState(initial?.body || empty),
    [reason, setReason] = useState(""),
    [makeJournal, setMake] = useState(false),
    [readAll, setReadAll] = useState(false),
    [review, setReview] = useState<CatalogReviewRecord | null>(null), [reviewDirty, setReviewDirty] = useState(false),
    [schedule, setSchedule] = useState({
      date: new Date().toLocaleDateString("en-CA"),
      startTime: "09:00",
      endTime: "10:00",
      breakMinutes: 0,
      instructor: "",
      location: "",
    }),
    [useTick,setUseTick]=useState(0),[useStatus,setUseStatus]=useState<CatalogUseStatus|null>(null),[useError,setUseError]=useState(""),[stopDirty,setStopDirty]=useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const baseline = useRef(JSON.stringify(body)),
    changed = JSON.stringify(body) !== baseline.current,
    guard = useDraftGuard(
      changed || !!reason || makeJournal || stopDirty || reviewDirty,
      busy,
      onDirtyChange,
      onBusyChange,
    ),
    base = `/sites/${site.id}/education-catalog`,
    editable =
      site.role === "manager" && (!record || record.status === "draft");
  useEffect(()=>{let live=true;setUseStatus(null);setUseError("");if(!record||record.status!=="published")return;api<CatalogUseStatus>(base+"/"+record.id+"/use-status").then(v=>{if(live)setUseStatus(v);}).catch(e=>{if(live)setUseError(e.message);});return()=>{live=false;};},[base,record?.id,record?.version,record?.status,useTick]);
  async function stopUse(why:string){if(!record||busy)return;const path=base+"/"+record.id+"/stop-use",value={version:record.version,sourceHash:record.published_hash,reason:why,confirmNoUndo:true};setBusy(true);setError("");try{setUseStatus(await api<CatalogUseStatus>(path,"POST",value,guard.key(path,value)));setStopDirty(false);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  function adopt(r: CatalogRecord) {
    setRecord(r);
    setBody(r.body);
    baseline.current = JSON.stringify(r.body);
    setReason("");
    setMake(false);
  }
  async function run(kind: "save" | "publish" | "revise" | "journals") {
    if (busy) return;
    if(kind==="journals"&&(!useStatus||useStatus.useStopped||stopDirty))return;
    if (kind !== "save" && changed) {
      setError("내용 변경을 먼저 저장하세요.");
      return;
    }
    const path =
        base +
        (record ? "/" + record.id : "") +
        (kind === "save" ? "" : "/" + kind),
      value =
        kind === "save"
          ? { ...(record ? { version: record.version } : {}), body }
          : kind === "revise"
            ? { version: record!.version, reason }
            : kind === "journals"
              ? { version: record!.version, schedule,sourceHash:record!.published_hash }
              : { version: record!.version };
    setBusy(true);
    setError("");
    try {
      const next = await api<CatalogRecord | EducationFull>(
        path,
        kind === "save" && record ? "PUT" : "POST",
        value,
        guard.key(path, value),
      );
      if (kind === "journals") onJournal(next as EducationFull);
      else if (kind === "revise") onRevision(next as CatalogRecord);
      else adopt(next as CatalogRecord);
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
      onRevision(await api<CatalogRecord>(base + "/" + id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      {record?.status==="published"&&<>
        {useStatus?<CatalogUseNotice state={useStatus}/>:<p role={useError?"alert":undefined}>{useError?"현재 사용상태 조회 실패: "+useError:"현재 사용상태 조회 중"}</p>}
        <button disabled={busy||stopDirty||changed||!!reason||makeJournal} onClick={()=>setUseTick(t=>t+1)}>현재 사용상태 다시 조회</button>
        <details className="ui-tech advanced-tools">
          <summary>관리 · 검수 기록 · 사용 중지</summary>
        {site.role==="manager"&&useStatus&&!useStatus.useStopped&&!makeJournal&&<CatalogStopForm busy={busy||changed||!!reason} onDirtyChange={setStopDirty} onStop={why=>void stopUse(why)}/>}
        {record.published_hash&&<CatalogReview key={record.id} path={base+"/"+record.id+"/reviews"} sourceHash={record.published_hash} manager={site.role==="manager"} keyFor={guard.key} onLatest={setReview} onDirty={setReviewDirty}/>}
        </details>
      </>}
      <button
        disabled={busy}
        onClick={() => {
          if (guard.canLeave()) onClose();
        }}
      >
        교육내용 목록
      </button>
      <h2>
        {record?.status === "published"
          ? "고정 게시 교육내용"
          : "자체 교육내용 초안"}
      </h2>
      <p>{catalogWarning}</p>
      {error && <p role="alert">{error} 입력을 유지했습니다.</p>}
      {record && (
        <p>
          ID {record.id} v{record.version}
        </p>
      )}
      <fieldset disabled={!editable || busy}>
        {(
          [
            ["title", "내용 제목", 200],
            ["categoryLabel", "자체 분류 표시", 200],
            ["objectives", "교육 목표", 5000],
            ["contents", "직접 작성 교육내용", 10000],
            ["referenceNote", "수기 참고 메모", 2000],
          ] as const
        ).map(([key, label, max]) => (
          <label key={key}>
            {label}
            <textarea
              value={body[key]}
              maxLength={max}
              onChange={(e) => setBody({ ...body, [key]: e.target.value })}
            />
          </label>
        ))}
      </fieldset>
      {editable && (
        <button disabled={busy} onClick={() => void run("save")}>
          교육내용 초안 저장
        </button>
      )}
      {record && (
        <>
          <a
            href={"/api" + base + "/" + record.id + "/print"}
            target="_blank"
            rel="noreferrer"
          >
            교육내용 인쇄
          </a>
          {editable && (
            <button
              disabled={busy || changed}
              onClick={() => {
                if (
                  window.confirm(
                    "이 내용을 불변 버전으로 게시할까요? 법정 과정 인증이 아닙니다.",
                  )
                )
                  void run("publish");
              }}
            >
              자체 내용 게시
            </button>
          )}
          {record.published_snapshot && (
            <p>
              게시 계정 {record.published_snapshot.publishedBy.name} ·{" "}
              {record.published_snapshot.publishedAt} · hash{" "}
              {record.published_hash}
            </p>
          )}
          {record.revisionNote && (
            <p>
              연결 개정 사유: {record.revisionNote.reason} ·{" "}
              {record.revisionNote.actor_name} · {record.revisionNote.at}
            </p>
          )}
          {record.parent_id && site.role === "manager" && (
            <button
              disabled={busy}
              onClick={() => void linked(record.parent_id!)}
            >
              원본 게시본 열기
            </button>
          )}
          {record.successorId && site.role === "manager" && (
            <button
              disabled={busy}
              onClick={() => void linked(record.successorId!)}
            >
              연결 개정 내용 열기
            </button>
          )}
          {record.status === "published" && site.role !== "viewer" && (
            <>
              <button
                disabled={busy||stopDirty||!useStatus||useStatus.useStopped}
                onClick={() => {
                  if (guard.canLeave()) {
                    setReason("");
                    setMake(true);
                  }
                }}
              >
                이 게시본으로 교육일지 초안 작성
              </button>
              {makeJournal && (<>
                <fieldset disabled={busy}>
                  <legend>적용할 교육내용 전체 확인</legend>
                  <p>
                    판본 ID {record.id} v{record.version} · hash {record.published_hash} · 과정 표시 {record.body.categoryLabel || "없음"}
                  </p>
                  {review ? <p>적용대상·출처·권리 검수: {review.target} · {review.source} · 권리 확인 {review.rightsCheckedBy}({review.rightsCheckedDate}) · 현행성 확인 {review.currencyCheckedDate}</p> : <p role="alert">적용대상·출처·권리 검수: 미검토 — 검수 기록이 없습니다. 적용은 할 수 있지만 내용을 직접 확인하세요.</p>}
                  <h3>{record.body.title}</h3>
                  <h4>교육 목표</h4>
                  <p style={{ whiteSpace: "pre-wrap" }}>{record.body.objectives || "없음"}</p>
                  <h4>교육내용</h4>
                  <p style={{ whiteSpace: "pre-wrap" }}>{record.body.contents || "없음"}</p>
                  {record.body.referenceNote && <><h4>수기 참고 메모</h4><p style={{ whiteSpace: "pre-wrap" }}>{record.body.referenceNote}</p></>}
                  <label>
                    <input type="checkbox" checked={readAll} onChange={(e) => setReadAll(e.target.checked)} />
                    위 내용 전체를 읽었고 이 판본을 새 교육일지에 적용합니다
                  </label>
                </fieldset>
                <fieldset disabled={busy}>
                  <legend>새 교육일지의 수기 일정</legend>
                  <label>
                    일지 날짜
                    <input
                      type="date"
                      value={schedule.date}
                      onChange={(e) =>
                        setSchedule({ ...schedule, date: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    시작 시각
                    <input
                      type="time"
                      value={schedule.startTime}
                      onChange={(e) =>
                        setSchedule({ ...schedule, startTime: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    종료 시각
                    <input
                      type="time"
                      value={schedule.endTime}
                      onChange={(e) =>
                        setSchedule({ ...schedule, endTime: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    휴게 예정 분
                    <input
                      type="number"
                      min={0}
                      max={1438}
                      step={1}
                      value={schedule.breakMinutes}
                      onChange={(e) =>
                        setSchedule({
                          ...schedule,
                          breakMinutes: Number(e.target.value),
                        })
                      }
                    />
                  </label>
                  <label>
                    강사 표시
                    <input
                      maxLength={200}
                      value={schedule.instructor}
                      onChange={(e) =>
                        setSchedule({ ...schedule, instructor: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    장소
                    <input
                      maxLength={300}
                      value={schedule.location}
                      onChange={(e) =>
                        setSchedule({ ...schedule, location: e.target.value })
                      }
                    />
                  </label>
                  <p>
                    같은 날 현지 시각 계획입니다. 참여자는 생성하지 않습니다.
                    출처 내용은 복사 후 편집 가능하며 변경 여부를 표시합니다.
                  </p>
                  <button disabled={!useStatus||useStatus.useStopped||stopDirty||!readAll} onClick={() => void run("journals")}>
                    출처를 결속한 일지 초안 생성
                  </button>
                  <button
                    onClick={() => {
                      if (guard.canLeave()) { setMake(false); setReadAll(false); }
                    }}
                  >
                    일지 생성 취소
                  </button>
                </fieldset>
              </>)}
            </>
          )}
          {record.status === "published" &&
            site.role === "manager" &&
            !record.successorId &&
            !makeJournal && (
              <fieldset disabled={busy||stopDirty}>
                <legend>연결된 새 내용 초안</legend>
                <label>
                  교육내용 개정 사유
                  <textarea
                    maxLength={1000}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
                <button
                  disabled={!reason.trim()}
                  onClick={() => void run("revise")}
                >
                  새 내용 버전 초안 만들기
                </button>
                <p>
                  이미 만든 교육일지/과거 게시본은 변경하지 않습니다. 새 내용도
                  따로 게시해야 합니다.
                </p>
              </fieldset>
            )}
        </>
      )}
    </section>
  );
}
