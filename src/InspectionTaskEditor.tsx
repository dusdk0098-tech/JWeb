import { InspectionUseNotice,type InspectionUseState } from "./InspectionUseNotice";
import { useEffect, useState, useRef } from "react";
import { api, type Site, type User } from "./api";
import { useDraftGuard } from "./useDraftGuard";
import type { Page } from "./attendance-types";
import {
  inspectionStatus,
  type Inspection,
  type InspectionTemplate,
} from "./inspection-types";
import { taskStatus, type TaskResult } from "./inspection-task-types";
export function InspectionTaskEditor({
  site,
  user,
  initial,
  initialTemplate,
  onDirtyChange,
  onBusyChange,
  onClose,
  onInspection,
}: {
  site: Site;
  user: User;
  initial: TaskResult | null;
  initialTemplate?: InspectionTemplate;
  onDirtyChange: (v: boolean) => void;
  onBusyChange: (v: boolean) => void;
  onClose: () => void;
  onInspection: (v: Inspection) => void;
}) {
  const [data, setData] = useState(initial),
    [body, setBody] = useState(
      initial?.record.body || {
        plannedDate: new Date().toLocaleDateString("en-CA"),
        location: "",
        instructions: "",
      },
    ),
    [assigneeId, setAssigneeId] = useState(initial?.record.assignee_id || ""),
    [templateId, setTemplateId] = useState(initial?.record.template_id || initialTemplate?.id || ""),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [useTick,setUseTick]=useState(0),[templateUse,setTemplateUse]=useState<InspectionUseState|null>(null),
    [templates, setTemplates] = useState<InspectionTemplate[]>(initialTemplate?[initialTemplate]:[]),
    [templateOffset, setTemplateOffset] = useState(0),
    [moreTemplates, setMoreTemplates] = useState(false),
    [templateLoading, setTemplateLoading] = useState(false),
    [templateFailed, setTemplateFailed] = useState(false),
    [templateRetry, setTemplateRetry] = useState(0),
    [people, setPeople] = useState<{ id: string; name: string }[]>([]),
    [events, setEvents] = useState<
      {
        version: number;
        event: string;
        reason: string;
        actor_name: string;
        at: string;
        snapshot: TaskResult["record"];
      }[]
    >([]),
    [eventOffset, setEventOffset] = useState(0),
    [moreEvents, setMoreEvents] = useState(false);
  const record = data?.record,
    base = `/sites/${site.id}/inspection-tasks`,
    manager = site.role === "manager",
    editable = manager && (!record || record.status === "planned");
  const initialBody = useRef(body);
  const dirty =
    !!reason ||
    JSON.stringify(body) !==
      JSON.stringify(record?.body || initialBody.current) ||
    assigneeId !== (record?.assignee_id || "") ||
    templateId !== (record?.template_id || "");
  const guard = useDraftGuard(dirty, busy, onDirtyChange, onBusyChange);
  useEffect(()=>{let live=true;setTemplateUse(null);if(!templateId)return;api<InspectionUseState>(`/sites/${site.id}/inspection-templates/${templateId}/use-status`).then(v=>{if(live)setTemplateUse(v);}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};},[site.id,templateId,useTick]);
  useEffect(() => {
    if (!manager) return;
    let active = true;
    api<{ id: string; name: string }[]>(base + "/assignees")
      .then((v) => {
        if (active) setPeople(v);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [base, manager, record?.version]);
  useEffect(() => {
    if (record || !manager) return;
    let active = true;
    setTemplateLoading(true);
    setTemplateFailed(false);
    api<Page<InspectionTemplate>>(
      `/sites/${site.id}/inspection-templates?offset=${templateOffset}`,
    )
      .then((v) => {
        if (active) {
          setTemplates((old) =>
            templateOffset
              ? [...old, ...v.items.filter((t) => t.status === "published"&&!old.some(saved=>saved.id===t.id))]
              : [...(initialTemplate&&!v.items.some(t=>t.id===initialTemplate.id)?[initialTemplate]:[]),...v.items.filter((t) => t.status === "published")],
          );
          setMoreTemplates(v.hasMore);
        }
      })
      .catch((e) => {
        if (active) {
          setError(e.message);
          setTemplateFailed(true);
          setMoreTemplates(false);
        }
      })
      .finally(() => {
        if (active) setTemplateLoading(false);
      });
    return () => {
      active = false;
    };
  }, [site.id, templateOffset, templateRetry, record, manager,initialTemplate]);
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
  function adopt(next: TaskResult) {
    setData(next);
    setBody(next.record.body);
    setAssigneeId(next.record.assignee_id);
    setTemplateId(next.record.template_id);
    setReason("");
    setEventOffset(0);
  }
  async function act(action: "save" | "cancel" | "start") {
    if (busy) return;
    if(!record&&(!templateUse||templateUse.useStopped))return;
    const path = record
      ? base + `/${record.id}${action === "save" ? "" : "/" + action}`
      : base;
    const payload =
      action === "save"
        ? record
          ? { version: record.version, assigneeId, body, reason }
          : { templateId, assigneeId, body,templateVersion:templateUse?.version,templateHash:templateUse?.sourceHash }
        : action === "cancel"
          ? { version: record!.version, reason }
          : { version: record!.version };
    if (
      !window.confirm(
        action === "cancel"
          ? "일정 기록만 취소합니다. 외부 작업/알림을 취소하지 않습니다. 계속할까요?"
          : action === "start"
            ? "배정 계정으로 점검 초안을 시작할까요? 계획일이 초안 날짜에 복사되므로 실제 수행일을 점검에서 확인하세요."
            : "점검 일정을 저장할까요? 게시된 양식 버전은 이후 바꿀 수 없습니다.",
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      const next = await api<TaskResult & { inspection?: Inspection }>(
        path,
        action === "save" && record ? "PUT" : "POST",
        payload,
        guard.key(path, payload),
      );
      adopt(next);
      if (next.inspection) onInspection(next.inspection);
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
      adopt(await api<TaskResult>(base + "/" + record.id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function openInspection(id: string) {
    if (!guard.canLeave()) return;
    setBusy(true);
    setError("");
    try {
      onInspection(
        await api<Inspection>(`/sites/${site.id}/inspections/${id}`),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      {templateUse?<InspectionUseNotice state={templateUse}/>:<p>선택 양식 현재상태 확인 전</p>}<button disabled={busy} onClick={()=>setUseTick(t=>t+1)}>현재 양식 사용상태 다시 조회</button>
      <div className="section-head">
        <h2>{record ? taskStatus[record.status] : "새 점검 일정"}</h2>
        <button
          className="secondary"
          disabled={busy}
          onClick={() => {
            if (guard.canLeave()) onClose();
          }}
        >
          일정 목록으로
        </button>
      </div>
      <p className="notice">
        일정은 수기 계획, 초안 시작은 배정 계정의 명시적 행위입니다. 날짜 경과를
        위험/위법 판정으로 사용하지 않습니다. 본인 제출 점검은 다른 관리자가
        검토합니다. 관리자가 1명뿐인 현장에서는 본인 처리로 기록되고 화면에 그렇게 표시됩니다.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <fieldset disabled={!editable || busy}>
        {!record ? (
          <>
            <label>
              고정할 게시 양식
              <select
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
              >
                <option value="">게시 버전 선택</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.body.title} · v{t.version} · {t.id}
                  </option>
                ))}
              </select>
            </label>
            {templateLoading && <p role="status">게시 양식 불러오는 중…</p>}
            {templateFailed && (
              <button
                type="button"
                className="secondary"
                disabled={templateLoading}
                onClick={() => setTemplateRetry((v) => v + 1)}
              >
                실패한 양식 페이지 다시 불러오기
              </button>
            )}
            {moreTemplates && (
              <button
                type="button"
                className="secondary"
                disabled={templateLoading}
                onClick={() => {
                  setTemplateLoading(true);
                  setTemplateOffset((o) => o + 50);
                }}
              >
                다음 양식50개 불러오기
              </button>
            )}
          </>
        ) : (
          <p>
            고정 양식: {record.template_snapshot.body.title} · v
            {record.template_snapshot.version}
          </p>
        )}
        <label>
          계획일
          <input
            type="date"
            value={body.plannedDate}
            onChange={(e) => setBody({ ...body, plannedDate: e.target.value })}
          />
        </label>
        <label>
          계획 장소
          <input
            maxLength={300}
            value={body.location}
            onChange={(e) => setBody({ ...body, location: e.target.value })}
          />
        </label>
        <label>
          일정 안내
          <textarea
            maxLength={3000}
            value={body.instructions}
            onChange={(e) => setBody({ ...body, instructions: e.target.value })}
          />
        </label>
        {manager ? (
          <label>
            일정 담당 계정
            <select
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
            >
              <option value="">현재 현장 계정 선택</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.id}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p>배정 계정 ID {assigneeId}</p>
        )}
        {record && (
          <label>
            일정 변경/취소 사유
            <textarea
              maxLength={1000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
        )}
        <button
          disabled={
            !templateId || (!record&&(!templateUse||templateUse.useStopped)) ||
            !assigneeId ||
            !body.plannedDate ||
            !body.location.trim() ||
            (!!record && !reason.trim())
          }
          onClick={() => void act("save")}
        >
          일정 저장
        </button>
        {record && (
          <button
            className="secondary"
            disabled={
              !reason.trim() ||
              JSON.stringify(body) !== JSON.stringify(record.body) ||
              assigneeId !== record.assignee_id
            }
            onClick={() => void act("cancel")}
          >
            일정 기록 취소
          </button>
        )}
      </fieldset>
      {record && (
        <>
          <p className="muted">
            일정 {record.id} · v{record.version} · 배정 계정{" "}
            {record.assignee_id}
          </p>
          {record.status === "planned" &&
            record.assignee_id === user.id &&
            site.role !== "viewer" && (
              <button
                disabled={busy || dirty}
                onClick={() => void act("start")}
              >
                배정 계정으로 점검 시작
              </button>
            )}
          {record.status === "planned" &&
            manager &&
            !people.some((p) => p.id === record.assignee_id) && (
              <p className="notice">
                담당자가 현재 작성자/관리자 목록에 없습니다. 유효한 계정으로
                사유를 남겨 재배정하거나 일정을 취소하세요.
              </p>
            )}
          <div className="actions">
            <button
              className="secondary"
              disabled={busy}
              onClick={() => void reload()}
            >
              일정 최신본 불러오기
            </button>
            <a
              className="button secondary"
              href={`/api${base}/${record.id}/print`}
              target="_blank"
              rel="noreferrer"
            >
              일정/이력 인쇄
            </a>
          </div>
          <h3>연결된 실제 점검 기록</h3>
          {data.chain.hasMore ? (
            <p className="error">
              연결100건 초과: 최신 상태 판정 보류. 개별 점검에서 후속 기록을
              확인하세요.
            </p>
          ) : (
            <p>
              최신 기록:{" "}
              {data.chain.latest
                ? inspectionStatus[data.chain.latest.status]
                : "아직 시작하지 않음"}
            </p>
          )}
          {data.chain.items.map((i) => (
            <p key={i.id}>
              {inspectionStatus[i.status]} · {i.id} · 작성 계정 {i.owner_id}{" "}
              <button
                className="secondary"
                disabled={busy}
                onClick={() => void openInspection(i.id)}
              >
                연결 점검 열기
              </button>
            </p>
          ))}
          <h3>일정 변경 이력</h3>
          {events.map((e) => (
            <article key={e.version}>
              <p>
                v{e.version} · {e.event} · {e.actor_name} · {e.at}
              </p>
              <p>{e.reason}</p>
              <p>
                당시 계획: {e.snapshot.body.plannedDate} ·{" "}
                {e.snapshot.body.location} · 배정 {e.snapshot.assignee_id}
              </p>
            </article>
          ))}
          <div className="actions">
            <button
              className="secondary"
              disabled={busy || !eventOffset}
              onClick={() => setEventOffset((o) => Math.max(0, o - 50))}
            >
              이전 50
            </button>
            <button
              className="secondary"
              disabled={busy || !moreEvents}
              onClick={() => setEventOffset((o) => o + 50)}
            >
              다음 50
            </button>
          </div>
        </>
      )}
      <p role="status">
        {dirty ? "저장하지 않은 일정 입력" : "저장된 일정 기준"}
      </p>
    </section>
  );
}
