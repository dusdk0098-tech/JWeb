import { InspectionTaskSource } from "./InspectionTaskSource";
import { ActionBar, Notice, PageHeader, Section, StatusChip, TechDetails, type Tone } from "./ui";
const statusTone: Record<string, Tone> = { draft: "draft", submitted: "pending", accepted: "done", returned: "error" };
const statusChip: Record<string, string> = { draft: "작성 중", submitted: "확인 대기", accepted: "검토 수락", returned: "반려" };
import { InspectionHazardLinks } from "./InspectionHazardLinks";
import { HazardEditor } from "./HazardEditor";
import type { HazardRecord } from "./hazard-types";
import { InspectionHistory } from "./InspectionHistory";
import { useEffect, useRef, useState } from "react";
import { api, type Site, type User, soleManagerOf } from "./api";
import { lastPlace, rememberPlace } from "./lastPlace";
import {
  inspectionStatus,
  resultLabel,
  type Inspection,
  type InspectionTemplate,
  type InspectionBody,
} from "./inspection-types";
import { useDraftGuard } from "./useDraftGuard";
import { useOfflineDraft } from "./useOfflineDraft";
export function InspectionEditor({
  site,
  user,
  initial,
  template,
  onClose,
  onDirtyChange,
  onBusyChange,
}: {
  site: Site;
  user: User;
  initial: Inspection | null;
  template?: InspectionTemplate;
  onClose: () => void;
  onDirtyChange: (v: boolean) => void;
  onBusyChange: (v: boolean) => void;
}) {
  const [record, setRecord] = useState(initial),
    [form, setForm] = useState<InspectionBody>(
      initial?.body || {
        date: new Date().toLocaleDateString("en-CA"),
        location: lastPlace(site.id),
        performedBy: user.name,
        answers: template!.body.items.map((i) => ({
          itemId: i.id,
          result: "pending",
          comment: "",
        })),
      },
    ),
    [reason, setReason] = useState(""),
    [authorId, setAuthorId] = useState(initial?.owner_id || user.id),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [authors, setAuthors] = useState<{ id: string; name: string }[]>([]);
  const [linkedReport, setLinkedReport] = useState<HazardRecord | null>(null);
  const baseline = useRef(JSON.stringify(form)),
    formDirty = JSON.stringify(form) !== baseline.current,
    dirty = formDirty || !!reason || authorId !== (record?.owner_id || user.id),
    guard = useDraftGuard(dirty, busy, onDirtyChange, onBusyChange);
  const t = record?.template_snapshot || template!.published_snapshot!,
    editable =
      site.role !== "viewer" &&
      (!record || (record.status === "draft" && record.owner_id === user.id));
  // 오프라인 2단계: device draft of the answers; only a failed draft save is retried automatically (submit/review need a live connection).
  const offline = useOfflineDraft(`inspection:${site.id}:${user.id}:${record?.id ?? "new:" + template?.id}`, form, JSON.parse(baseline.current) as InspectionBody, editable, () => void run("save"));
  useEffect(() => {
    if (site.role !== "manager") return;
    let active = true;
    api<{ id: string; name: string }[]>(`/sites/${site.id}/inspections/authors`)
      .then((r) => {
        if (active) setAuthors(r);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [site.id, site.role]);
  function adopt(next: Inspection) {
    setRecord(next);
    rememberPlace(site.id, next.body.location);
    setForm(next.body);
    baseline.current = JSON.stringify(next.body);
    setReason("");
    setAuthorId(next.owner_id);
  }
  async function run(action: "save" | "submit" | "accept" | "return") {
    if (busy) return;
    if (action !== "save" && formDirty) {
      setError("변경 내용을 먼저 저장하세요.");
      return;
    }
    setBusy(true);
    setError("");
    const path = `/sites/${site.id}/inspections${record ? "/" + record.id : ""}${action === "save" ? "" : "/" + action}`,
      value =
        action === "save"
          ? record
            ? { version: record.version, body: form }
            : { templateId: template!.id, body: form,templateVersion:template!.version,...(template!.selectionHash?{templateHash:template!.selectionHash}:{}) }
          : action === "submit"
            ? { version: record!.version }
            : {
                version: record!.version,
                reason,
                ...(action === "return" ? { authorId } : {}),
              };
    try {
      if (action === "accept" || action === "return") {
        const result = await api<{
          record: Inspection;
          next: Inspection | null;
        }>(path, "POST", value, guard.key(path, value));
        adopt(result.next || result.record);
      } else
        adopt(
          await api<Inspection>(
            path,
            action === "save" && record ? "PUT" : "POST",
            value,
            guard.key(path, value),
          ),
        );
      if (action === "save") offline.saved();
    } catch (e) {
      setError(action === "save" ? offline.failed(e) : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function reload(id: string) {
    if (!guard.canLeave()) return;
    setBusy(true);
    setError("");
    try {
      adopt(await api<Inspection>(`/sites/${site.id}/inspections/${id}`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (linkedReport)
    return (
      <HazardEditor
        key={linkedReport.id}
        site={site}
        user={user}
        initial={linkedReport}
        closeLabel="원 점검으로 돌아가기"
        onDirtyChange={onDirtyChange}
        onBusyChange={onBusyChange}
        onClose={() => setLinkedReport(null)}
      />
    );
  return (
    <section className="panel inspection-editor">
      <PageHeader
        level={1}
        back="점검 목록으로"
        backDisabled={busy}
        onBack={() => guard.canLeave() && onClose()}
        title={<>{t.body.title} · {record ? inspectionStatus[record.status] : "새 점검"}</>}
        status={<StatusChip tone={record ? statusTone[record.status] : "neutral"}>{record ? statusChip[record.status] : "새 점검"}</StatusChip>}
      >
        {record && (
          <>
            <button disabled={busy} className="secondary" onClick={() => reload(record.id)}>
              최신본 다시 열기
            </button>
            <a className="button secondary" href={`/api/sites/${site.id}/inspections/${record.id}/print`} target="_blank" rel="noreferrer">
              저장본 인쇄 / PDF
            </a>
          </>
        )}
      </PageHeader>
      {t.body.instructions && <p>{t.body.instructions}</p>}
      <Notice summary="부적합 결과는 자동으로 조치 완료되지 않습니다.">
        계정이 직접 입력한 점검 기록입니다. 본인 확인·법정 점검 증명·안전 인증이
        아니며, 부적합 결과가 자동으로 조치 완료 처리되지 않습니다.
      </Notice>
      <TechDetails>
        <p>양식 {t.id} · 게시 버전 {t.version}</p>
        {record?.submitted_snapshot && <p>원 제출 계정 ID {record.submitted_snapshot.submitter.id}</p>}
        {record?.review && <p>검토 계정 ID {record.review.actor.id}</p>}
        {record && (
          <p>
            기록 {record.id} · v{record.version} · 작성 계정 {record.owner_id} ·
            이전 기록 {record.parent_id || "없음"}
          </p>
        )}
      </TechDetails>
      {record?.submitted_snapshot && (
        <p>
          원 제출 계정: {record.submitted_snapshot.submitter.name} ·{" "}
          {record.submitted_snapshot.submittedAt}
        </p>
      )}
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
      <fieldset disabled={!editable || busy}>
        <Section no={1} level={2} title="점검 정보">
        <div className="grid">
        <label>
          점검일
          <input
            type="date"
            value={form.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })}
          />
        </label>
        <label>
          장소
          <input
            maxLength={300}
            value={form.location}
            onChange={(e) => setForm({ ...form, location: e.target.value })}
          />
        </label>
        <label>
          점검자 표시 (직접 입력 · 신원 검증 아님)
          <input
            maxLength={100}
            value={form.performedBy}
            onChange={(e) => setForm({ ...form, performedBy: e.target.value })}
          />
        </label>
        </div>
        </Section>
        <Section no={2} level={2} title={`점검 항목 · ${t.body.items.length}개`}>
        {t.body.items.map((item, index) => {
          const a = form.answers.find((a) => a.itemId === item.id)!;
          return (
            <div className="inspection-item" key={item.id} data-result={a.result}>
              <h3>
                {index + 1}. {item.text}
              </h3>
              <label>
                결과
                <select
                  value={a.result}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      answers: form.answers.map((v) =>
                        v.itemId === item.id
                          ? { ...v, result: e.target.value as typeof a.result }
                          : v,
                      ),
                    })
                  }
                >
                  {Object.entries(resultLabel).map(([v, l]) => (
                    <option value={v} key={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                설명 (부적합/해당 없음은 필수)
                <textarea
                  maxLength={2000}
                  value={a.comment}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      answers: form.answers.map((v) =>
                        v.itemId === item.id
                          ? { ...v, comment: e.target.value }
                          : v,
                      ),
                    })
                  }
                />
              </label>
            </div>
          );
        })}
        </Section>
      </fieldset>
      {editable && (
      <ActionBar note={formDirty ? "저장하지 않은 입력" : record ? "서버에 저장됨" : ""}>
        <button disabled={busy} onClick={() => run("save")}>
          점검 초안 저장
        </button>
        {offline.waiting && <p role="status">통신이 끊겨 저장하지 못했습니다. 연결되면 자동으로 다시 저장합니다.</p>}
        {record && (
          <button
            disabled={busy || formDirty}
            onClick={() =>
              window.confirm(
                "저장된 점검 내용을 변경 불가능한 원문으로 제출할까요?",
              ) && run("submit")
            }
          >
            점검 제출
          </button>
        )}
      </ActionBar>
      )}
      {record?.review && (
        <div className="notice">
          <h2>관리자 기록 검토</h2>
          <p>
            {record.review.actor.name} · {record.review.at}
          </p>
          <p>{record.review.reason}</p>
          {record.review.successorId && (
            <button
              disabled={busy}
              onClick={() => reload(record.review!.successorId!)}
            >
              후속 점검 초안 열기
            </button>
          )}
        </div>
      )}
      {record?.status === "submitted" && site.role === "manager" && (
        <section className="panel">
          <h2>관리자 검토</h2>
          <Notice summary="제출한 사람이 아닌 다른 관리자가 검토합니다.">
            잠정 업무 정책: 원 제출 계정이 아닌 현장 관리자가 검토합니다.
            관리자가 1명뿐인 현장에서는 본인 처리로 기록되고 화면에 그렇게 표시됩니다. 법적 의무를 뜻하지 않습니다.
          </Notice>
          {record.owner_id === user.id && !soleManagerOf(site) ? (
            <p className="notice">
              본인 제출 기록은 직접 수락/반려할 수 없습니다.
            </p>
          ) : (
            <fieldset disabled={busy}>
              <label>
                검토 사유
                <textarea
                  maxLength={1000}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <label>
                반려 시 후속 초안 작성 계정 (관리자가 명시적으로 지정)
                <select
                  value={authorId}
                  onChange={(e) => setAuthorId(e.target.value)}
                >
                  <option value="">선택</option>
                  {!authors.some((a) => a.id === authorId) && authorId && (
                    <option value={authorId}>
                      기존 작성자 권한 없음 · 다른 계정 선택 필요
                    </option>
                  )}
                  {authors.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.id})
                    </option>
                  ))}
                </select>
              </label>
              <p>
                반려는 원문을 보존하고 모든 답변을 미입력으로 초기화한 후속
                초안을 한 번 생성합니다. 이전 작성자의 권한이 없으면 현재 현장
                편집자/관리자를 지정하세요.
              </p>
              <button disabled={!reason.trim()} onClick={() => run("accept")}>
                기록 검토 수락
              </button>
              <button
                disabled={
                  !reason.trim() || !authors.some((a) => a.id === authorId)
                }
                onClick={() =>
                  window.confirm(
                    "원본을 반려하고 지정한 계정의 후속 초안을 생성할까요?",
                  ) && run("return")
                }
              >
                반려 + 후속 초안 생성
              </button>
            </fieldset>
          )}
        </section>
      )}
      {record && <InspectionTaskSource siteId={site.id} id={record.id} />}
      {record && (
        <InspectionHistory
          key={`history:${record.id}`}
          siteId={site.id}
          id={record.id}
          version={record.version}
        />
      )}
      {record && (
        <InspectionHazardLinks
          key={`hazard-links:${record.id}`}
          site={site}
          record={record}
          busy={busy}
          onBusyChange={setBusy}
          onOpen={async (id) => {
            if (!guard.canLeave()) return;
            const next = await api<HazardRecord>(
              `/sites/${site.id}/hazards/${id}`,
            );
            setLinkedReport(next);
          }}
        />
      )}
    </section>
  );
}
