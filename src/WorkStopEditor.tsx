import { useEffect, useState } from "react";
import { ActionBar, Notice } from "./ui";
import { api, type Site, type User, soleManagerOf } from "./api";
import { useDraftGuard } from "./useDraftGuard";
import {
  workStopLabels,
  workStopWarning,
  type WorkStopInput,
  type WorkStopRecord,
} from "./work-stop-types";
import { WorkStopHistory } from "./WorkStopHistory";
const blank: WorkStopInput = {
  work: "",
  location: "",
  reason: "",
  observedLocal: "",
};
const actionLabels: Record<string, string> = {
  acknowledge: "관리자 확인·담당자 배정 기록",
  reassign: "담당자 재배정 기록",
  "record-stop": "중지 수기 기록",
  "request-review": "개선 검토 요청 기록",
  "return-review": "보완 요청 기록",
  "record-resumption": "재개 수기 기록",
  "close-without-stop": "중지 기록 없이 종결",
  annotate: "정정/보충 메모 추가",
};
export function WorkStopEditor({
  site,
  user,
  initial,
  onClose,
  onDirtyChange,
  onBusyChange,
}: {
  site: Site;
  user: User;
  initial: WorkStopRecord | null;
  onClose: () => void;
  onDirtyChange: (v: boolean) => void;
  onBusyChange: (v: boolean) => void;
}) {
  const [record, setRecord] = useState(initial),
    [body, setBody] = useState(blank),
    [action, setAction] = useState(""),
    [reason, setReason] = useState(""),
    [assigneeId, setAssigneeId] = useState(""),
    [recordedLocal, setRecordedLocal] = useState(""),
    [improvements, setImprovements] = useState(""),
    [conditions, setConditions] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [assignees, setAssignees] = useState<{
      items: { id: string; name: string; role: string }[];
      hasMore: boolean;
    }>({ items: [], hasMore: false }),
    [offset, setOffset] = useState(0),
    [pickerBusy, setPickerBusy] = useState(false),
    [pickerError, setPickerError] = useState(""),
    [tick, setTick] = useState(0);
  const base = `/sites/${site.id}/work-stops`,
    path = record ? `${base}/${record.id}` : base;
  const dirty = record
    ? !!(reason || assigneeId || recordedLocal || improvements || conditions)
    : JSON.stringify(body) !== JSON.stringify(blank);
  const guard = useDraftGuard(dirty, busy, onDirtyChange, onBusyChange);
  const assigning = action === "acknowledge" || action === "reassign";
  useEffect(() => {
    if (!assigning) return;
    let active = true;
    setPickerBusy(true);
    setAssignees({ items: [], hasMore: false });
    setPickerError("");
    api<typeof assignees>(`${base}/assignees?offset=${offset}`)
      .then((r) => {
        if (active) setAssignees(r);
      })
      .catch((e) => {
        if (active) setPickerError(e.message);
      })
      .finally(() => {
        if (active) setPickerBusy(false);
      });
    return () => {
      active = false;
    };
  }, [base, assigning, offset, tick]);
  const options: string[] = [];
  if (record) {
    if (site.role === "manager") {
      if (record.status === "requested") options.push("acknowledge");
      if (
        ["acknowledged", "stop_recorded", "review_requested"].includes(
          record.status,
        )
      )
        options.push("reassign");
      if (record.status === "acknowledged") options.push("record-stop");
      if (record.status === "review_requested")
        options.push("return-review", "record-resumption");
      if (["requested", "acknowledged"].includes(record.status))
        options.push("close-without-stop");
      options.push("annotate");
    }
    if (
      site.role !== "viewer" &&
      record.assignee_id === user.id &&
      record.status === "stop_recorded"
    )
      options.push("request-review");
  }
  const cannotResume =
    !soleManagerOf(site) &&
    (record?.requester_id === user.id ||
      record?.review_record?.actorId === user.id ||
      record?.eligibleReviewerCount === 0);
  function clear() {
    setReason("");
    setAssigneeId("");
    setRecordedLocal("");
    setImprovements("");
    setConditions("");
  }
  async function send() {
    if (busy) return;
    let value: object = body;
    if (record) {
      if (!action) return;
      value = {
        version: record.version,
        reason,
        ...(assigning ? { assigneeId } : {}),
        ...(["record-stop", "record-resumption"].includes(action)
          ? { recordedLocal }
          : {}),
        ...(action === "request-review" ? { improvements, conditions } : {}),
        ...(action === "record-resumption" ? { conditions } : {}),
      };
    }
    const target = record ? `${path}/${action}` : path;
    setBusy(true);
    setError("");
    try {
      const next = await api<WorkStopRecord>(
        target,
        "POST",
        value,
        guard.key(target, value),
      );
      setRecord(next);
      clear();
      setAction("");
      setBody(blank);
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
      setRecord(await api<WorkStopRecord>(path));
      clear();
      setAction("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="section-head">
        <h1>작업 중지 요청</h1>
        <button
          disabled={busy}
          onClick={() => {
            if (guard.canLeave()) onClose();
          }}
        >
          목록으로
        </button>
      </div>
      <Notice tone="warning" summary="긴급 상황은 현장의 실제 대응 절차를 별도로 따르세요.">{workStopWarning}</Notice>
      <p>
        관리자의 재개 기록은 원 요청자·개선 제출자와 다른 관리자가 합니다. 관리자가 1명뿐인 현장에서는 본인 처리로 기록되고 화면에 그렇게 표시됩니다.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {!record ? (
        <form
          className="panel"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <h2>요청 접수 기록 (저장 후 원문 변경 불가)</h2>
          {(["work", "location", "reason", "observedLocal"] as const).map(
            (k) => (
              <label key={k}>
                {
                  {
                    work: "대상 작업",
                    location: "장소",
                    reason: "요청 사유",
                    observedLocal: "관찰 현장 입력 시각",
                  }[k]
                }
                {k === "reason" ? (
                  <textarea
                    required
                    maxLength={4000}
                    value={body[k]}
                    disabled={busy}
                    onChange={(e) => setBody({ ...body, [k]: e.target.value })}
                  />
                ) : (
                  <input
                    type={k === "observedLocal" ? "datetime-local" : "text"}
                    required
                    maxLength={300}
                    value={body[k]}
                    disabled={busy}
                    onChange={(e) => setBody({ ...body, [k]: e.target.value })}
                  />
                )}
              </label>
            ),
          )}
          <p className="muted">
            시각은 직접 입력합니다. 브라우저/서버 시간대에서 자동 추정하지
            않습니다. 저장해도 외부 알림은 보내지 않습니다.
          </p>
          <ActionBar note={<span role="status">{""}</span>}>
          <button disabled={busy}>요청 접수 기록 저장</button>
          </ActionBar>
        </form>
      ) : (
        <>
          <section className="panel">
            <h2>
              {workStopLabels[record.status]} · v{record.version}
            </h2>
            <h3>{record.original.body.work}</h3>
            <p>{record.original.body.location}</p>
            <p>{record.original.body.reason}</p>
            <p>
              관찰 입력 {record.original.body.observedLocal} · 접수 audit UTC{" "}
              {record.original.requestedAt}
            </p>
            <p>
              원 요청자 {record.original.requester.name} ({record.requester_id})
            </p>
            <p>
              담당 계정 {record.assignee_id || "미배정"} · 현재 독립 재개 기록
              가능 관리자 {record.eligibleReviewerCount}명
            </p>
            {record.eligibleReviewerCount === 0 && (
              <p className="notice">
                원 요청자/개선 제출자 외 관리자가 없습니다. 현장 관리에서 다른
                관리자를 적법하게 배정해야 합니다. 앱의 우회 승인 기능은
                없습니다.
              </p>
            )}
            {record.stop_record && (
              <>
                <h3>중지 입력 시각 {record.stop_record.recordedLocal}</h3>
                <p>{record.stop_record.reason}</p>
              </>
            )}
            {record.review_record && (
              <>
                <h3>개선 검토 요청</h3>
                <p>{record.review_record.improvements}</p>
                <p>조건 {record.review_record.conditions}</p>
              </>
            )}
            {record.resumption_record && (
              <>
                <h3>재개 입력 시각 {record.resumption_record.recordedLocal}</h3>
                <p>{record.resumption_record.reason}</p>
                <p>{record.resumption_record.conditions}</p>
              </>
            )}
            <div className="form-actions">
              <button disabled={busy} onClick={() => void reload()}>
                최신본 다시 조회
              </button>
              <a
                href={"/api" + path + "/print"}
                target="_blank"
                rel="noreferrer"
              >
                전체 기록 인쇄 (1000 이력 초과 시 거부)
              </a>
            </div>
          </section>
          {options.length > 0 && (
            <form
              className="panel"
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
            >
              <label>
                기록 동작
                <select
                  value={action}
                  disabled={busy}
                  onChange={(e) => {
                    if (!guard.canLeave()) return;
                    clear();
                    setAction(e.target.value);
                    setOffset(0);
                  }}
                >
                  <option value="">선택하세요</option>
                  {options.map((v) => (
                    <option key={v} value={v}>
                      {actionLabels[v]}
                    </option>
                  ))}
                </select>
              </label>
              {action && (
                <>
                  <label>
                    사유 / 정정 메모
                    <textarea
                      required
                      maxLength={2000}
                      value={reason}
                      disabled={busy}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </label>
                  {assigning && (
                    <>
                      <label>
                        담당 계정
                        <select
                          required
                          value={assigneeId}
                          disabled={busy || pickerBusy}
                          onChange={(e) => setAssigneeId(e.target.value)}
                        >
                          <option value="">선택하세요</option>
                          {assigneeId &&
                            !assignees.items.some(
                              (a) => a.id === assigneeId,
                            ) && (
                              <option value={assigneeId}>
                                선택 계정 {assigneeId}
                              </option>
                            )}
                          {assignees.items.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name} · {a.role} · {a.id}
                            </option>
                          ))}
                        </select>
                      </label>
                      {pickerError && (
                        <p role="alert">
                          {pickerError}
                          <button
                            type="button"
                            onClick={() => setTick((t) => t + 1)}
                          >
                            다시 조회
                          </button>
                        </p>
                      )}
                      <button
                        type="button"
                        disabled={busy || pickerBusy || offset === 0}
                        onClick={() => {
                          setPickerBusy(true);
                          setOffset((o) => o - 50);
                        }}
                      >
                        이전 50
                      </button>
                      <button
                        type="button"
                        disabled={busy || pickerBusy || !assignees.hasMore}
                        onClick={() => {
                          setPickerBusy(true);
                          setOffset((o) => o + 50);
                        }}
                      >
                        다음 50
                      </button>
                    </>
                  )}
                  {["record-stop", "record-resumption"].includes(action) && (
                    <label>
                      현장 입력 시각 (날짜 포함)
                      <input
                        required
                        type="datetime-local"
                        value={recordedLocal}
                        disabled={busy}
                        onChange={(e) => setRecordedLocal(e.target.value)}
                      />
                    </label>
                  )}
                  {action === "request-review" && (
                    <label>
                      수기로 기록한 개선 내용
                      <textarea
                        required
                        maxLength={4000}
                        disabled={busy}
                        value={improvements}
                        onChange={(e) => setImprovements(e.target.value)}
                      />
                    </label>
                  )}
                  {["request-review", "record-resumption"].includes(action) && (
                    <label>
                      확인/잔여 조건 (자동 안전 판정 아님)
                      <textarea
                        required
                        maxLength={4000}
                        disabled={busy}
                        value={conditions}
                        onChange={(e) => setConditions(e.target.value)}
                      />
                    </label>
                  )}
                  {action === "reassign" &&
                    record.status === "review_requested" && (
                      <p>
                        재배정하면 기존 검토 요청은 이력으로 남고 새 담당자의
                        개선 기록을 다시 받아야 합니다.
                      </p>
                    )}
                  {action === "record-resumption" && cannotResume && (
                    <p role="alert">
                      원 요청자/개선 제출자는 재개 검토 기록을 작성할 수
                      없습니다. 다른 관리자가 기록합니다.
                    </p>
                  )}
                  <button
                    disabled={
                      busy ||
                      (assigning && (pickerBusy || !!pickerError)) ||
                      (action === "record-resumption" && cannotResume)
                    }
                  >
                    {actionLabels[action]} 저장
                  </button>
                </>
              )}
            </form>
          )}
          <WorkStopHistory path={path} version={record.version} />
        </>
      )}
    </>
  );
}
