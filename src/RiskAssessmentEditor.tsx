import { RiskReuseForm } from "./RiskReuseForm";
import { ActionBar, Notice, PageHeader, Section, StatusChip, TechDetails } from "./ui";
import { RiskReuseSource } from "./RiskReuseSource";
import { RiskOpinionsPanel } from "./RiskOpinionsPanel";
import { RiskPrintControl } from "./RiskPrintControl";
import { RiskResidualPanel } from "./RiskResidualPanel";
import { RiskHazardFields } from "./RiskHazardFields";
import { RiskReviewActions, riskStatus } from "./RiskReviewActions";
import { useState } from "react";
import { api, type Site, type User } from "./api";
import { useDraftGuard } from "./useDraftGuard";
import { WorkPlanPicker } from "./WorkPlanPicker";
import { CompanyPpeHistory } from "./CompanyPpeHistory";
import type { MethodAssessment as RiskAssessmentInput } from "../server/risk-methods";
import type { RiskAssessmentRecord } from "../server/risk-core";
const localDate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export const emptyRiskAssessment = (
  method: "product" | "three_level" | "checklist" | "narrative" = "product",
): RiskAssessmentInput => ({
  title: "",
  date: localDate(),
  timing: "최초",
  trigger: "",
  workScope: "",
  method,
  hazards: [],
});
type Hazard = RiskAssessmentInput["hazards"][number];
const blankHazard = (): Hazard => ({
  id: crypto.randomUUID(),
  task: "",
  location: "",
  category: "",
  accidentType: "",
  scenario: "",
  harm: "",
  exposedGroup: "",
  reference: "",
  currentControls: "",
  likelihood: null,
  severity: null,
  judgmentReason: "",
  plans: [],
});
function blankThreeLevelHazard() {
  const {
    likelihood: _l,
    severity: _s,
    ...common
  } = blankHazard() as Extract<Hazard, { likelihood: number | null }>;
  void _l;
  void _s;
  return { ...common, levelId: null };
}
function blankChecklistHazard() {
  const { levelId, ...common } = blankThreeLevelHazard();
  void levelId;
  return { ...common, checklistItemId: null, outcome: null };
}
function blankNarrativeHazard() {
  const { levelId, ...common } = blankThreeLevelHazard();
  void levelId;
  return { ...common, exposurePath: "", additionalPlanDecision: null };
}
export function RiskAssessmentEditor({
  site,
  user,
  initial,
  onClose,
  onDirtyChange,
  onBusyChange,
  method = "product",
}: {
  method?: "product" | "three_level" | "checklist" | "narrative";
  site: Site;
  user: User;
  initial: RiskAssessmentRecord | null;
  onClose: () => void;
  onDirtyChange: (v: boolean) => void;
  onBusyChange: (v: boolean) => void;
}) {
  const [row, setRow] = useState(initial),
    [body, setBody] = useState(initial?.body ?? emptyRiskAssessment(method)),
    [baseline, setBaseline] = useState(initial?.body ?? body),
    [criteriaId, setCriteriaId] = useState(initial?.criteria_id ?? ""),
    [reset, setReset] = useState(false),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [reuseOpen, setReuseOpen] = useState(false),
    [reviewDirty, setReviewDirty] = useState(false),
    [reviewBusy, setReviewBusy] = useState(false),
    [residualHazard, setResidualHazard] = useState<string | null>(null),
    [printBusy, setPrintBusy] = useState(false),
    [opinions, setOpinions] = useState(false);
  const bodyDirty = JSON.stringify(body) !== JSON.stringify(baseline),
    dirty =
      bodyDirty || !!reason || reset || criteriaId !== (row?.criteria_id ?? ""),
    guard = useDraftGuard(
      dirty || reviewDirty,
      busy || reviewBusy || printBusy,
      onDirtyChange,
      onBusyChange,
    ),
    editable =
      site.role !== "viewer" &&
      (!row || (row.author_id === user.id && row.status === "draft")),
    base = `/sites/${site.id}/risk-assessments`;
  const change = (id: string, patch: Partial<Hazard>) =>
    setBody({
      ...body,
      hazards: body.hazards.map((h) => (h.id === id ? { ...h, ...patch } : h)),
    } as RiskAssessmentInput);
  async function openLinked(id: string) {
    if (!guard.canLeave()) return;
    setBusy(true);
    setError("");
    try {
      const next = await api<RiskAssessmentRecord>(`${base}/${id}`);
      setRow(next);
      setReuseOpen(false);
      setBody(next.body);
      setBaseline(next.body);
      setCriteriaId(next.criteria_id ?? "");
      setReason("");
      setReset(false);
      setReviewDirty(false);
      setReviewBusy(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save(replace = false) {
    const path =
        base + (row ? `/${row.id}` : "") + (replace ? "/criteria" : ""),
      value = replace
        ? {
            version: row!.version,
            criteriaId: criteriaId || null,
            confirmResetValues: reset,
            reason,
          }
        : row
          ? { version: row.version, body, reason }
          : { body, criteriaId: criteriaId || null };
    setBusy(true);
    setError("");
    try {
      const next = await api<RiskAssessmentRecord>(
        path,
        row && !replace ? "PUT" : "POST",
        value,
        guard.key(path, value),
      );
      setRow(next);
      setReuseOpen(false);
      setBody(next.body);
      setBaseline(next.body);
      setCriteriaId(next.criteria_id ?? "");
      setReason("");
      setReset(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (opinions && row)
    return (
      <RiskOpinionsPanel
        site={site}
        user={user}
        source={row}
        onClose={() => setOpinions(false)}
        onDirtyChange={onDirtyChange}
        onBusyChange={onBusyChange}
      />
    );
  if (residualHazard && row)
    return (
      <RiskResidualPanel
        site={site}
        assessmentId={row.id}
        hazardId={residualHazard}
        onClose={() => setResidualHazard(null)}
        onDirtyChange={onDirtyChange}
        onBusyChange={onBusyChange}
      />
    );
  return (
    <section className="panel risk-editor">
      <PageHeader
        back="위험성평가 목록"
        backDisabled={busy || reviewBusy || printBusy}
        onBack={() => guard.canLeave() && onClose()}
        title={<>위험성평가{" "}
          {body.method === "product"
            ? "수치형"
            : body.method === "three_level"
              ? "사람 선택 3단계"
              : body.method === "narrative" ? "핵심요인 서술형" : "체크리스트 사람 판단"}{" "}
          · {row ? riskStatus[row.status] : "초안 · 미검토/미승인"}</>}
        status={<StatusChip tone={row ? ({ draft: "draft", submitted: "pending", accepted: "done", returned: "error" } as const)[row.status] : "neutral"}>
          {row ? ({ draft: "작성 중", submitted: "검토 대기", accepted: "수락", returned: "보완 요청" } as const)[row.status] : "새 평가"}
        </StatusChip>}
      />
      <Notice tone="warning" summary="긴급 위험은 이 화면 저장을 기다리지 말고 현장 비상 절차를 따르세요.">
        수치형은 설정 기준의 산술이며, 3단계·체크리스트·서술형은 사람의 판단 기록입니다. 안전
        판정·준법 보증·작업 재개 허가가 아닙니다. 저감 계획은 실제 이행·검증
        완료와 다릅니다. 긴급 위험은 이 화면 저장을 기다리지 말고 현장 비상
        절차를 따르세요.
      </Notice>
      {error && <p role="alert">{error}</p>}
      <fieldset
        disabled={busy || reviewBusy || printBusy || reviewDirty || !editable}
      >
        <Section no={1} level={3} title="기본 정보">
        <div className="grid">
        <label>
          평가 이름
          <input
            maxLength={200}
            value={body.title}
            onChange={(e) => setBody({ ...body, title: e.target.value })}
          />
        </label>
        <label>
          평가일 (직접 선택)
          <input
            type="date"
            value={body.date}
            onChange={(e) => setBody({ ...body, date: e.target.value })}
          />
        </label>
        <label>
          평가 시기
          <select
            value={body.timing}
            onChange={(e) =>
              setBody({
                ...body,
                timing: e.target.value as RiskAssessmentInput["timing"],
              })
            }
          >
            {["최초", "정기", "수시", "상시"].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        </div>
        <p className="muted">
          방법:{" "}
          {body.method === "product"
            ? "가능성×중대성 수치형"
            : body.method === "three_level"
              ? "사람 선택 3단계 (점수 없음)"
              : body.method === "narrative" ? "핵심요인 서술형 (점수/전체 안전 판정 없음)" : "체크리스트 항목별 사람 판단 (점수/전체 안전 판정 없음)"}
          . 시기 분류가 평가 방법을 바꾸지 않습니다.
        </p>
        {(["trigger", "workScope"] as const).map((k) => (
          <label key={k}>
            {k === "trigger" ? "시행 계기" : "작업 범위"}
            <textarea
              maxLength={2000}
              value={body[k]}
              onChange={(e) => setBody({ ...body, [k]: e.target.value })}
            />
          </label>
        ))}
        </Section>
      </fieldset>
      <h3>기준 버전</h3>
      <p>
        {row?.criteria_snapshot
          ? `${row.criteria_snapshot.body.name} · v${row.criteria_snapshot.version}`
          : "미선택: 산출값 미평가"}
      </p>
      {row && (
        <TechDetails>
          <p>평가 {row.id} · v{row.version}{row.criteria_snapshot ? ` · 기준 ${row.criteria_snapshot.id}` : ""}</p>
        </TechDetails>
      )}
      {editable && (
        <>
          <WorkPlanPicker
            path={`/sites/${site.id}/risk-criteria?status=confirmed&method=${body.method}`}
            label="확인된 기준 선택"
            disabled={busy || reviewBusy || printBusy || reviewDirty}
            onSelect={setCriteriaId}
          />
          <p className="muted">{criteriaId ? "기준을 선택했습니다. 저장하면 적용됩니다." : "선택한 기준 없음"}</p>
          <button
            disabled={busy || reviewBusy || printBusy || reviewDirty}
            onClick={() => setCriteriaId("")}
          >
            선택 해제
          </button>
          {row && (
            <>
              <label>
                <input
                  type="checkbox"
                  disabled={busy || reviewBusy || printBusy || reviewDirty}
                  checked={reset}
                  onChange={(e) => setReset(e.target.checked)}
                />
                기준 교체 시 방법별 답변·선택·판단 근거(서술형 핵심 답변 포함)를 비우고, 이전 값은
                이력에 남김을 확인합니다.
              </label>
              <button
                disabled={
                  busy ||
                  reviewBusy ||
                  reviewDirty ||
                  bodyDirty ||
                  !reason.trim() ||
                  !reset
                }
                onClick={() => save(true)}
              >
                사유와 함께 기준 교체·값 초기화
              </button>
              <p>
                내용 변경을 먼저 저장한 다음 기준을 교체하세요. 다른 기준에서 옛
                체크항목 연결/응답, 단계 또는 수치 선택값과 판단 근거를
                비웁니다. 서술형은 핵심 질문 답변도 비웁니다. 작업·계획과 이전 이력은 보존합니다.
              </p>
            </>
          )}
        </>
      )}
      {body.hazards.map((h, i) => (
        <RiskHazardFields
          key={h.id}
          h={h}
          i={i}
          disabled={busy || reviewBusy || printBusy || reviewDirty || !editable}
          criteria={row?.criteria_snapshot?.body ?? null}
          change={change}
          onRemove={() =>
            setBody({
              ...body,
              hazards: body.hazards.filter((x) => x.id !== h.id),
            } as RiskAssessmentInput)
          }
        />
      ))}
      {editable && (
        <>
          <button
            disabled={
              busy ||
              reviewBusy ||
              printBusy ||
              reviewDirty ||
              body.hazards.length >= 50
            }
            onClick={() =>
              setBody({
                ...body,
                hazards: [
                  ...body.hazards,
                  body.method === "product"
                    ? blankHazard()
                    : body.method === "three_level"
                      ? blankThreeLevelHazard()
                      : body.method === "narrative" ? blankNarrativeHazard() : blankChecklistHazard(),
                ],
              } as RiskAssessmentInput)
            }
          >
            위험행 추가 (최대50)
          </button>
          <label>
            저장/기준 교체 사유
            <input
              disabled={busy || reviewBusy || printBusy || reviewDirty}
              maxLength={1000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <ActionBar note={<span role="status">{dirty ? "저장하지 않은 입력" : row ? "서버에 저장됨" : ""}</span>}>
          <button
            disabled={
              busy ||
              reviewBusy ||
              reviewDirty ||
              (!!row && !reason.trim()) ||
              (!row && !!reason) ||
              (!!row && criteriaId !== (row.criteria_id ?? ""))
            }
            onClick={() => save()}
          >
            초안 저장·방법별 입력 검증
          </button>
          </ActionBar>
        </>
      )}
      {row && (
        <>
          {row.status !== "draft" && (
            <button
              disabled={busy || reviewBusy || printBusy}
              onClick={() => {
                if (guard.canLeave()) {
                  setReason("");
                  setReset(false);
                  setReviewDirty(false);
                  setOpinions(true);
                }
              }}
            >
              이 문서의 계정 의견 (근로자 참여 증명 아님)
            </button>
          )}
          <h3>
            마지막 저장본의 방법별 결과{" "}
            {bodyDirty ? "(현재 미저장 입력의 결과 아님)" : ""}
          </h3>
          {(row.body.method === "checklist" || row.body.method === "narrative") && (
            <p>
              비수치 방법은 사람 판단 기록이며 점수가 없습니다. 재평가도 원 질문에 대한 별도 사람 판단이며 자동 조치/안전 허가가 아닙니다.
            </p>
          )}
          {row.results.map((r, i) => (
            <p key={r.id}>
              행{i + 1}:{" "}
              {r.bandLabel === null
                ? "미평가"
                : row.body.method === "narrative"
                  ? `${r.bandLabel}; 점수/전체 위험 허용 판정 없음`
                : row.body.method === "checklist"
                  ? `${r.bandLabel}; 점수/전체 위험 허용 판정 없음`
                  : row.body.method === "three_level"
                    ? `사람 선택 ${r.bandLabel} / 사용자 기준상 ${r.criterionAcceptable ? "허용" : "비허용"} 분류 (점수 없음)`
                    : `점수 ${r.score} / 설정 구간 ${r.bandLabel} / 사용자 기준상 ${r.criterionAcceptable ? "허용 분류" : "비허용 분류"}`}{" "}
              · 안전 판정 아님 {r.incomplete ? "· 필수 내용/평가 미완" : ""}{" "}
              {r.reductionPlanMissing
                ? "· 부적합/비허용 분류의 저감 계획 누락"
                : ""}
              {row.status === "accepted" && (
                <button
                  disabled={busy || reviewBusy || printBusy}
                  onClick={() => {
                    if (guard.canLeave()) {
                      setReason("");
                      setReset(false);
                      setReviewDirty(false);
                      setResidualHazard(r.id);
                    }
                  }}
                >
                  이 위험행의 예상/조치 확인 후 재평가
                </button>
              )}
            </p>
          ))}
          {row.submission && (
            <details>
              <summary>
                고정 제출본 · 원 작성자 {row.submission.author.name}
              </summary>
              <pre>{JSON.stringify(row.submission, null, 2)}</pre>
            </details>
          )}
          {row.decision && (
            <p>
              문서 결정: {row.decision.kind} / {row.decision.actor.name} /{" "}
              {row.decision.at} / {row.decision.reason} · 안전 허가 아님
            </p>
          )}
          {row.parent_id && (
            <button
              disabled={busy || reviewBusy || printBusy}
              onClick={() => openLinked(row.parent_id!)}
            >
              이전 문서 조회 {row.parent_id}
            </button>
          )}
          {row.successor_id && (
            <button
              disabled={busy || reviewBusy || printBusy}
              onClick={() => openLinked(row.successor_id!)}
            >
              후속 문서 조회 {row.successor_id}
            </button>
          )}
          <button
            disabled={busy || reviewBusy || printBusy}
            onClick={() => openLinked(row.id)}
          >
            현재 저장 상태 다시 조회
          </button>
          <p>
            재시도 응답은 당시 성공 기록일 수 있습니다. 현재 상태는 다시 조회로
            확인하세요.
          </p>
          {!reuseOpen && !dirty && !busy && !printBusy && (
            <RiskReviewActions
              key={`review:${row.id}:${row.version}`}
              site={site}
              user={user}
              row={row}
              onDirtyChange={setReviewDirty}
              onBusyChange={setReviewBusy}
              onAdopt={(next) => {
                setRow(next);
                setBody(next.body);
                setBaseline(next.body);
                setCriteriaId(next.criteria_id ?? "");
                setReason("");
                setReset(false);
                setReviewDirty(false);
                setReviewBusy(false);
              }}
            />
          )}
          {row.status !== "draft" && (
            <RiskPrintControl
              key={`print:${row.id}:${row.version}`}
              site={site}
              assessmentId={row.id}
              disabled={busy || reviewBusy || reviewDirty}
              onBusyChange={setPrintBusy}
            />
          )}
          <RiskReuseSource key={row.id} siteId={site.id} id={row.id} onOpen={(id) => { void openLinked(id); }} />
          {row.status !== "draft" && site.role !== "viewer" && !busy && !printBusy && (
            <>
              <button type="button" disabled={reviewBusy} onClick={() => { if (guard.canLeave()) { setReviewDirty(false); setReuseOpen(!reuseOpen); } }}>{reuseOpen ? "재사용 입력 닫기" : "선택 위험행으로 새 평가 작성"}</button>
              {reuseOpen && <RiskReuseForm key={`${row.id}:${row.version}`} siteId={site.id} source={row}
                onDirtyChange={setReviewDirty} onBusyChange={setReviewBusy} onAdopt={(next) => {
                  setRow(next); setBody(next.body); setBaseline(next.body); setCriteriaId(next.criteria_id ?? "");
                  setReason(""); setReset(false); setReviewDirty(false); setReviewBusy(false); setReuseOpen(false);
                }} />}
            </>
          )}
          <CompanyPpeHistory
            path={`${base}/${row.id}/events`}
            version={row.version}
          />
        </>
      )}
    </section>
  );
}
