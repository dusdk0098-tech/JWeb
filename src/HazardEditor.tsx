import { HazardAttachments } from "./HazardAttachments";
import { useOfflineDraft } from "./useOfflineDraft";
import { ActionBar, Notice, TechDetails } from "./ui";
import { HazardInspectionSource } from "./HazardInspectionSource";
import { useEffect, useRef, useState } from "react";
import { api, type Site, type User, soleManagerOf } from "./api";
import { rememberPlace } from "./lastPlace";
import {
  statusLabel,
  type HazardDetails,
  type HazardRecord,
} from "./hazard-types";
import { HazardHistory } from "./HazardHistory";
const empty = (): HazardDetails => ({
  title: "",
  observedDate: new Date().toLocaleDateString("en-CA"),
  location: "",
  description: "",
});
export function HazardEditor({
  site,
  user,
  initial,
  onDirtyChange,
  onBusyChange,
  onClose,
  closeLabel = "신고 목록으로",
}: {
  site: Site;
  user: User;
  initial: HazardRecord | null;
  onDirtyChange: (v: boolean) => void;
  onBusyChange: (v: boolean) => void;
  onClose: () => void;
  closeLabel?: string;
}) {
  const [record, setRecord] = useState(initial),
    [form, setForm] = useState(initial?.body || empty()),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [attachmentDirty, setAttachmentDirty] = useState(false),
    [saveKey, setSaveKey] = useState(crypto.randomUUID());
  const [assignees, setAssignees] = useState<(User & { role: string })[]>([]),
    [assigneeError, setAssigneeError] = useState(""),
    [assigneeId, setAssigneeId] = useState(""),
    [dueDate, setDueDate] = useState(""),
    [reason, setReason] = useState(""),
    [remediation, setRemediation] = useState("");
  const initialEmpty = useRef(form);
  const command = useRef<{ signature: string; key: string } | null>(null);
  const formDirty =
    JSON.stringify(form) !==
    JSON.stringify(record?.body || initialEmpty.current);
  const actionDirty = !!(assigneeId || dueDate || reason || remediation);
  const dirty = formDirty || actionDirty || attachmentDirty;
  const editable =
    site.role !== "viewer" &&
    (!record || (record.status === "draft" && record.owner_id === user.id));
  const offline = useOfflineDraft(`hazard:${site.id}:${user.id}:${record?.id ?? "new"}`, form, record?.body || initialEmpty.current, editable, () => void save());
  const isManager = site.role === "manager";
  const canRemediate =
    record?.status === "assigned" &&
    record.assignee_id === user.id &&
    site.role !== "viewer";
  const selfReview =
    record?.status === "review_requested" && record.remediator_id === user.id && !soleManagerOf(site);
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    onBusyChange(busy);
    return () => onBusyChange(false);
  }, [busy, onBusyChange]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty || busy) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, busy]);
  useEffect(() => {
    if (!isManager) return;
    let active = true;
    api<(User & { role: string })[]>(`/sites/${site.id}/hazards/assignees`)
      .then((r) => {
        if (active) {
          setAssignees(r);
          setAssigneeError("");
        }
      })
      .catch((e) => {
        if (active) setAssigneeError(e.message);
      });
    return () => {
      active = false;
    };
  }, [site.id, isManager, record?.version]);
  function close() {
    if (
      !busy &&
      (!dirty ||
        window.confirm(
          "저장하지 않은 신고/조치 입력을 버리고 목록으로 돌아갈까요?",
        ))
    )
      onClose();
  }
  async function save(e?: React.FormEvent) {
    e?.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const next = await api<HazardRecord>(
        `/sites/${site.id}/hazards${record ? "/" + record.id : ""}`,
        record ? "PUT" : "POST",
        { ...form, ...(record ? { version: record.version } : {}) },
        saveKey,
      );
      setRecord(next);
      rememberPlace(site.id, next.body.location);
      setForm(next.body);
      setSaveKey(crypto.randomUUID());
      offline.saved();
    } catch (e) {
      setError(offline.failed(e));
    } finally {
      setBusy(false);
    }
  }
  async function act(action: string, payload: object) {
    if (!record || busy) return;
    const unused =
      action === "remediate"
        ? reason || assigneeId || dueDate
        : action === "close" || action === "reject"
          ? remediation || assigneeId || dueDate
          : action === "assign" || action === "reopen"
            ? remediation
            : "";
    if (
      unused &&
      !window.confirm(
        "이 처리에 사용되지 않는 다른 입력은 비워집니다. 계속할까요?",
      )
    )
      return;
    setBusy(true);
    setError("");
    const path = `/sites/${site.id}/hazards/${record.id}/${action}`,
      body = { ...payload, version: record.version },
      signature = JSON.stringify({ path, body });
    if (command.current?.signature !== signature)
      command.current = { signature, key: crypto.randomUUID() };
    try {
      const next = await api<HazardRecord>(
        path,
        "POST",
        body,
        command.current.key,
      );
      setRecord(next);
      setForm(next.body);
      setAssigneeId("");
      setDueDate("");
      setReason("");
      setRemediation("");
      command.current = null;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function reload() {
    if (busy || !record) return;
    if (
      dirty &&
      !window.confirm(
        "입력을 버리고 최신 기록을 다시 불러올까요? 필요하면 먼저 복사하세요.",
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      const next = await api<HazardRecord>(
        `/sites/${site.id}/hazards/${record.id}`,
      );
      setRecord(next);
      setForm(next.body);
      setAssigneeId("");
      setDueDate("");
      setReason("");
      setRemediation("");
      command.current = null;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function change(field: keyof HazardDetails, value: string) {
    setForm({ ...form, [field]: value });
    setSaveKey(crypto.randomUUID());
  }
  return (
    <section className="panel">
      <div className="section-head">
        <div>
          <h2>{record ? statusLabel[record.status] : "신고 초안"}</h2>
        </div>
        <button className="secondary" disabled={busy} onClick={close}>
          {closeLabel}
        </button>
      </div>
      <Notice summary="기록상 종결은 실제 위험 제거를 뜻하지 않습니다.">
        초안 작성자는 PNG/JPEG 미검사 원본을 첨부할 수 있습니다. 위험 점수/등급
        평가는 없습니다. 기록상 종결은 실제 위험 제거·작업 안전을 보증하지
        않습니다.
      </Notice>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {offline.local && (
        <p role="status">
          이 기기에 저장 안 된 초안이 있습니다({new Date(offline.local.savedAt).toLocaleString()}).
          <button type="button" onClick={() => { setForm(offline.local!.value); offline.discard(); }}>기기 초안 복원</button>
          <button type="button" onClick={() => offline.discard()}>기기 초안 버리기</button>
        </p>
      )}
      <form onSubmit={save}>
        <fieldset disabled={!editable || busy}>
          <div className="grid">
            <label>
              신고 제목 *
              <input
                required
                maxLength={200}
                value={form.title}
                onChange={(e) => change("title", e.target.value)}
              />
            </label>
            <label>
              관찰일 *
              <input
                required
                type="date"
                value={form.observedDate}
                onChange={(e) => change("observedDate", e.target.value)}
              />
            </label>
          </div>
          <label>
            장소 설명 · 제출 시 필수
            <input
              maxLength={300}
              value={form.location}
              onChange={(e) => change("location", e.target.value)}
            />
          </label>
          <label>
            신고 내용 · 제출 시 필수
            <textarea
              rows={6}
              maxLength={10000}
              value={form.description}
              onChange={(e) => change("description", e.target.value)}
            />
          </label>
        </fieldset>
        <ActionBar note={<span role="status">{dirty ? "저장하지 않은 입력" : record ? "서버에 저장됨" : ""}</span>}>
          {editable && (
            <>
              <button
                disabled={busy || attachmentDirty || (!formDirty && !!record)}
              >
                신고 초안 저장
              </button>
              {offline.waiting && <p role="status">통신이 끊겨 저장하지 못했습니다. 연결되면 자동으로 다시 저장합니다.</p>}
            </>
          )}
          {record && (
            <>
              <a
                className="button secondary"
                href={`/api/sites/${site.id}/hazards/${record.id}/print`}
                target="_blank"
                rel="noreferrer"
              >
                신고·이력 인쇄 / PDF
              </a>
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={reload}
              >
                최신 기록 불러오기
              </button>
            </>
          )}
        </ActionBar>
      </form>
      {record && (
        <>
          <TechDetails>
            <p>신고 ID {record.id} · 작성 계정 ID {record.owner_id}</p>
          </TechDetails>
          {record.submitted_snapshot && (
            <p className="muted">
              제출 당시 원문 보존 · {record.submitted_snapshot.site.name} ·{" "}
              {record.submitted_snapshot.reporter.name} ·{" "}
              {record.submitted_snapshot.submittedAt}
            </p>
          )}
          {record.status === "draft" && editable && (
            <button
              disabled={busy || formDirty || attachmentDirty}
              onClick={() => {
                if (
                  window.confirm(
                    "신고 원문을 제출할까요? 제출 이후 원문 수정은 불가합니다.",
                  )
                )
                  void act("submit", {});
              }}
            >
              신고 제출
            </button>
          )}
          {record.assignee_id && (
            <p>
              현재 담당 계정 ID: {record.assignee_id} · 기한: {record.due_date}
            </p>
          )}
          {record.remediation && (
            <section>
              <h3>제출된 조치 내용</h3>
              <p className="prose">{record.remediation}</p>
              <p className="muted">조치 제출 계정 ID: {record.remediator_id}</p>
            </section>
          )}
          {canRemediate && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (
                  window.confirm(
                    "담당자로서 조치 내용을 제출하고 관리자 검토를 요청할까요?",
                  )
                )
                  void act("remediate", { text: remediation });
              }}
            >
              <h3>배정 담당자 조치 기록</h3>
              <label>
                조치 내용 *
                <textarea
                  required
                  rows={5}
                  maxLength={10000}
                  disabled={busy}
                  value={remediation}
                  onChange={(e) => setRemediation(e.target.value)}
                />
              </label>
              <button disabled={busy || !remediation.trim()}>
                조치 제출 · 검토 요청
              </button>
            </form>
          )}
          {isManager && record.status !== "draft" && (
            <section>
              <h3>관리자 처리</h3>
              <p className="notice">
                잠정 독립 검토 정책: 조치 제출자는 자기 조치를 종결할 수
                없습니다. 일반 작성자가 조치하면 관리자 1명이 검토할 수
                있습니다. 관리자가 직접 조치한 경우 다른 관리자가 필요합니다.
                기존 계정을 현장 관리에서 추가 관리자로 배정하거나, 다른
                작성자에게 재배정하여 조치 기록을 다시 받으세요. 자동
                예외/우회는 없습니다.
              </p>
              {selfReview && (
                <p role="alert" className="error">
                  현재 계정이 조치를 제출했습니다. 본인 종결 불가 — 다른 관리자
                  검토 또는 다른 담당자 재배정이 필요합니다.
                </p>
              )}
              {assigneeError && (
                <p className="error" role="alert">
                  {assigneeError}
                </p>
              )}
              {record.assignee_id &&
                !assigneeError &&
                !assignees.some((a) => a.id === record.assignee_id) && (
                  <p className="notice">
                    현재 담당자는 이 현장의 작성자/관리자 목록에 없습니다. 반려
                    대신 유효한 계정으로 재배정할 수 있습니다. 이미 제출된
                    조치는 이력으로 보존됩니다.
                  </p>
                )}
              <fieldset disabled={busy}>
                <label>
                  관리자 처리 사유 *
                  <textarea
                    required
                    maxLength={1000}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
                {record.status === "review_requested" && (
                  <div className="form-actions">
                    <button
                      disabled={!reason.trim() || selfReview}
                      onClick={() => {
                        if (
                          window.confirm(
                            "기록상 종결할까요? 실제 위험 제거/작업 안전 인증이 아닙니다.",
                          )
                        )
                          void act("close", { reason });
                      }}
                    >
                      관리자 검토 · 기록상 종결
                    </button>
                    <button
                      className="secondary"
                      disabled={!reason.trim()}
                      onClick={() => {
                        if (
                          window.confirm(
                            "조치 보완을 위해 담당자에게 반려할까요? 이전 제출 이력은 남습니다.",
                          )
                        )
                          void act("reject", { reason });
                      }}
                    >
                      보완 반려
                    </button>
                  </div>
                )}
                <div className="grid">
                  <label>
                    배정할 현장 계정
                    <select
                      value={assigneeId}
                      onChange={(e) => setAssigneeId(e.target.value)}
                    >
                      <option value="">현재 현장 작성자/관리자 선택</option>
                      {assignees.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name} · {u.email} · {u.role}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    조치 기한
                    <input
                      type="date"
                      value={dueDate}
                      onChange={(e) => setDueDate(e.target.value)}
                    />
                  </label>
                </div>
                <button
                  disabled={!reason.trim() || !assigneeId || !dueDate}
                  onClick={() => {
                    if (
                      window.confirm(
                        record.status === "closed"
                          ? "사유를 남기고 담당자/기한을 지정하여 재개할까요?"
                          : "담당자/기한을 배정할까요? 기존 검토 요청은 취소되고 이전 이력은 남습니다.",
                      )
                    )
                      void act(
                        record.status === "closed" ? "reopen" : "assign",
                        { reason, assigneeId, dueDate },
                      );
                  }}
                >
                  {record.status === "closed"
                    ? "사유 있는 재개 · 배정"
                    : "담당자 배정 / 재배정"}
                </button>
              </fieldset>
            </section>
          )}
          <HazardAttachments
            siteId={site.id}
            record={record}
            editable={editable}
            disabled={busy || formDirty || actionDirty}
            onBusy={setBusy}
            onDirty={setAttachmentDirty}
            onRecord={setRecord}
          />
          <HazardHistory
            key={record.id}
            siteId={site.id}
            id={record.id}
            version={record.version}
          />
        </>
      )}
      {record && (
        <HazardInspectionSource
          key={record.id}
          siteId={site.id}
          id={record.id}
        />
      )}
    </section>
  );
}
