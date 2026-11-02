import { WorkPlanFormChecklist } from "./WorkPlanFormChecklist";
import { ActionBar, Notice, PageHeader, Section, StatusChip, TechDetails } from "./ui";
import { WorkPlanCalculations } from "./WorkPlanCalculations";
import { WorkPlanHazardReferenceFields } from "./WorkPlanHazardReferenceFields";
import { WorkPlanLiftingFields,blankLifting } from "./WorkPlanLiftingFields";
import { WorkPlanPlateReportFields } from "./WorkPlanPlateReportFields";
import { WorkPlanDesignationFields } from "./WorkPlanDesignationFields";
import { blankPacket } from "../server/work-plan-packet-values";
import { WorkPlanPacketFields } from "./WorkPlanPacketFields";
import { blankPlanForm } from "../server/work-plan-form-values";
import { WorkPlanFormFields } from "./WorkPlanFormFields";
import { WorkPlanAttachments } from "./WorkPlanAttachments";
import { WorkPlanDocumentReview } from "./WorkPlanDocumentReview";
import { useRef, useState } from "react";
import { api, type Site, type User } from "./api";
import { useDraftGuard } from "./useDraftGuard";
import { WorkPlanPicker } from "./WorkPlanPicker";
import { WorkPlanHistory } from "./WorkPlanHistory";
import {
  workPlanWarning,
  type WorkPlan,
  type WorkPlanBody,
} from "./work-plan-types";
const empty = (): WorkPlanBody => ({
  title: "",
  date: new Date().toLocaleDateString("en-CA"),
  startTime: "09:00",
  endTime: "10:00",
  location: "",
  workDescription: "",
  emergencyProcedure: "",
  verificationNote: "",
  steps: [],
  equipmentIds: [],
  duties: [],
});
export function WorkPlanEditor({
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
  initial: WorkPlan | null;
  onDirtyChange: (v: boolean) => void;
  onBusyChange: (v: boolean) => void;
  onClose: () => void;
  onRevision: (v: WorkPlan) => void;
}) {
  const [record, setRecord] = useState(initial),
    [body, setBody] = useState(initial?.body || empty),
    [reason, setReason] = useState(""),
    [authorId, setAuthor] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [history, setHistory] = useState(false);
  const [reviewDirty,setReviewDirty]=useState(false),[reviewBusy,setReviewBusy]=useState(false);
  const [attachmentsOpen,setAttachmentsOpen]=useState(false),[attachmentDirty,setAttachmentDirty]=useState(false),[attachmentBusy,setAttachmentBusy]=useState(false);
  const [packetBusy,setPacketBusy]=useState(false);
  const [plateBusy,setPlateBusy]=useState(false);
  const [liftingBusy,setLiftingBusy]=useState(false);
  const [referenceBusy,setReferenceBusy]=useState(false);
  const [checklistDirty,setChecklistDirty]=useState(false);
  const [calcDirty,setCalcDirty]=useState(false);
  const allBusy=busy||reviewBusy||attachmentBusy||packetBusy||plateBusy||liftingBusy||referenceBusy;
  const baseline = useRef(JSON.stringify(body)),
    changed = JSON.stringify(body) !== baseline.current,
    guard = useDraftGuard(
      changed || !!reason || !!authorId || reviewDirty || attachmentDirty || checklistDirty || calcDirty,
      allBusy,
      onDirtyChange,
      onBusyChange,
    ),
    base = `/sites/${site.id}/work-plans`,
    editable =
      site.role !== "viewer" &&
      (!record || (record.status === "draft" && record.author_id === user.id));
  function adopt(r: WorkPlan) {
    setRecord(r);
    setBody(r.body);
    baseline.current = JSON.stringify(r.body);
    setReason("");
    setAuthor("");
  }
  async function command(kind: "save" | "capture" | "archive" | "revise") {
    if (allBusy || reviewDirty) return;
    if (kind !== "save" && changed) {
      setError(
        "본문 변경을 먼저 저장하세요. 저장 뒤 선택 참조를 다시 취합해야 합니다.",
      );
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
            ? { version: record!.version, reason, authorId }
            : { version: record!.version };
    setBusy(true);
    setError("");
    try {
      const next = await api<WorkPlan>(
        path,
        kind === "save" && record ? "PUT" : "POST",
        value,
        guard.key(path, value),
      );
      if (kind === "revise") onRevision(next);
      else adopt(next);
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
      onRevision(await api<WorkPlan>(base + "/" + id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if(attachmentsOpen && record)return <section>
    <button disabled={allBusy} onClick={()=>{if(guard.canLeave()){setAttachmentDirty(false);setAttachmentsOpen(false);}}}>작업계획 본문으로</button>
    <WorkPlanAttachments siteId={site.id} record={record} editable={editable} disabled={busy||reviewBusy} onBusy={setAttachmentBusy} onDirty={setAttachmentDirty} onRecord={adopt}/>
  </section>;
  return (
    <section className="panel work-plan-editor">
      <PageHeader
        back="작업계획 목록"
        backDisabled={allBusy || reviewDirty}
        onBack={() => {
          if (guard.canLeave()) onClose();
        }}
        title={record?.status === "archived"
          ? (record.documentReview.review ? "작성자 고정 제출본 · 문서검토 별도" : "관리자 확정본 · 문서검토 없음")
          : "자체 일반 작업계획 초안"}
        status={
          record?.status === "archived" ? <StatusChip tone="done">확정</StatusChip>
          : record?.parent_id ? <StatusChip tone="draft">정정 초안</StatusChip>
          : record ? <StatusChip tone="draft">작성 중</StatusChip>
          : <StatusChip tone="neutral">새 작업계획</StatusChip>
        }
      >
        {record && <a className="button secondary" href={"/api" + base + "/" + record.id + "/print"} target="_blank" rel="noreferrer">작업계획 인쇄 / PDF</a>}
      </PageHeader>
      {record?.parent_id && <p className="muted">정정 사유: {record.revision_reason}</p>}
      <Notice summary="직접 쓰는 작업계획서입니다. 작업허가나 공학 검토가 아닙니다.">{workPlanWarning}</Notice>
      {!record&&<label>새 문서 형식 (저장 후 변경 불가)<select disabled={allBusy||!editable} value={body.documentForm?.kind||'legacy'} onChange={e=>{if(body.documentForm&&!window.confirm('형식을 바꾸면 미저장 전용 입력이 초기화됩니다. 계속할까요?'))return;const legacy={...body};delete legacy.documentForm;setBody(e.target.value==='legacy'?legacy:{...legacy,documentForm:blankPlanForm(e.target.value as 'general_machine'|'excavator_lift')});}}><option value="legacy">기존 자체 일반 메모형</option><option value="general_machine">차량계·중량물 일반 입력형식</option><option value="excavator_lift">굴착기 중량물 취급 입력형식</option></select></label>}
      {record && (
        <TechDetails>
          <p>ID {record.id} · v{record.version} · 작성계정 {record.author_id}{record.parent_id ? ` · 연결 원본 ${record.parent_id}` : ""}</p>
        </TechDetails>
      )}
      {record && <button className="secondary" disabled={allBusy} onClick={()=>{if(guard.canLeave()){adopt(record);setReviewDirty(false);setAttachmentsOpen(true);}}}>저장된 작업계획 원본 첨부 · 다운로드만</button>}
      {!record && <p className="muted">원본 첨부는 초안을 먼저 저장한 뒤 추가합니다.</p>}
      {error && <p role="alert">{error} 입력을 보존했습니다.</p>}
      <fieldset disabled={allBusy || reviewDirty || !editable}>
        <Section no={1} level={3} title="기본 정보">
        <div className="grid">
        <label>
          작업계획 제목
          <input
            maxLength={200}
            value={body.title}
            onChange={(e) => setBody({ ...body, title: e.target.value })}
          />
        </label>
        <label>
          선택 작업일
          <input
            type="date"
            value={body.date}
            onChange={(e) => setBody({ ...body, date: e.target.value })}
          />
        </label>
        <label>
          계획 시작 시각
          <input
            type="time"
            value={body.startTime}
            onChange={(e) => setBody({ ...body, startTime: e.target.value })}
          />
        </label>
        <label>
          계획 종료 시각
          <input
            type="time"
            value={body.endTime}
            onChange={(e) => setBody({ ...body, endTime: e.target.value })}
          />
        </label>
        </div>
        <p className="muted">
          같은 날 종료가 시작보다 늦어야 합니다. 현지 시계 계획이며 법정
          근로시간/실제 경과시간/DST 계산이 아닙니다.
        </p>
        <label>
          작업 위치
          <input
            maxLength={300}
            value={body.location}
            onChange={(e) => setBody({ ...body, location: e.target.value })}
          />
        </label>
        {(
          [
            ["workDescription", "작업 설명", 5000],
            ["emergencyProcedure", "비상 대응 절차", 3000],
            ["verificationNote", "수기 자료 확인 메모", 2000],
          ] as const
        ).map(([key, label, max]) => (
          <label key={key}>
            {label}
            <textarea
              maxLength={max}
              value={body[key]}
              onChange={(e) => setBody({ ...body, [key]: e.target.value })}
            />
          </label>
        ))}
        </Section>
        <Section no={2} level={3} title={`작업 순서 · 절차 · 주의사항 (${body.steps.length}/20)`}>
        {body.steps.map((s, i) => (
          <div key={i} className="plan-step">
            {(
              [
                ["task", "단계 작업", 500],
                ["procedure", "작업 절차", 1500],
                ["precaution", "주의사항", 1500],
              ] as const
            ).map(([key, label, max]) => (
              <label key={key}>
                {i + 1}. {label}
                <textarea
                  maxLength={max}
                  value={s[key]}
                  onChange={(e) =>
                    setBody({
                      ...body,
                      steps: body.steps.map((x, j) =>
                        i === j ? { ...x, [key]: e.target.value } : x,
                      ),
                    })
                  }
                />
              </label>
            ))}
            <button
              className="secondary"
              disabled={i === 0}
              onClick={() => {
                const steps = [...body.steps];
                [steps[i - 1], steps[i]] = [steps[i], steps[i - 1]];
                setBody({ ...body, steps });
              }}
            >
              위로 이동
            </button>
            <button
              className="secondary"
              onClick={() =>
                setBody({
                  ...body,
                  steps: body.steps.filter((_, j) => j !== i),
                })
              }
            >
              단계 제거
            </button>
          </div>
        ))}
        <button
          disabled={body.steps.length >= 20}
          onClick={() =>
            setBody({
              ...body,
              steps: [
                ...body.steps,
                { task: "", procedure: "", precaution: "" },
              ],
            })
          }
        >
          단계 추가
        </button>
        </Section>
        <Section no={3} level={3} title="선택 서식 · 기록">
        <label><input type="checkbox" checked={!!body.documentPacket} onChange={e=>{if(!e.target.checked&&body.documentPacket&&!window.confirm('미저장 서류 목록 입력을 제거할까요? 기존 첨부 원본은 삭제하지 않습니다.'))return;const next={...body};if(e.target.checked)next.documentPacket=blankPacket();else delete next.documentPacket;setBody(next);}}/>선택 장비1대의 서류 참조 목록 작성</label>
        {body.documentPacket&&<WorkPlanPacketFields siteId={site.id} planId={record?.id} version={record?.version} equipmentIds={body.equipmentIds} value={body.documentPacket} onChange={v=>setBody({...body,documentPacket:v})} onBusy={setPacketBusy}/>}
        <label><input type="checkbox" checked={!!body.designationRecords} onChange={e=>{if(!e.target.checked&&!window.confirm('미저장 지정 기록을 제거할까요?'))return;const next={...body};if(e.target.checked)next.designationRecords={schemaVersion:1,rows:[]};else delete next.designationRecords;setBody(next);}}/>지휘자·신호수 관련 수기 지정 기록 작성</label>
        {body.designationRecords&&<WorkPlanDesignationFields value={body.designationRecords} workerIds={body.duties.map(d=>d.workerId)} equipmentIds={body.equipmentIds} onChange={v=>setBody({...body,designationRecords:v})}/>}
        <label><input type="checkbox" checked={!!body.plateLoadReports} onChange={e=>{if(!e.target.checked&&!window.confirm('미저장 시험보고서 기록을 제거할까요?'))return;const next={...body};if(e.target.checked)next.plateLoadReports={schemaVersion:1,rows:[]};else delete next.plateLoadReports;setBody(next);}}/>평판재하시험 보고서 수기 기록 작성</label>
        {body.plateLoadReports&&<WorkPlanPlateReportFields value={body.plateLoadReports} onChange={v=>setBody({...body,plateLoadReports:v})} siteId={site.id} planId={record?.id} version={record?.version} onBusy={setPlateBusy}/>}
        <label><input type="checkbox" checked={!!body.liftingDetail} onChange={e=>{if(!e.target.checked&&!window.confirm('미저장 양중 상세를 제거할까요?'))return;const next={...body};if(e.target.checked)next.liftingDetail=blankLifting();else delete next.liftingDetail;setBody(next);}}/>양중 상세 수기 입력문서 작성</label>
        {body.liftingDetail&&<WorkPlanLiftingFields value={body.liftingDetail} onChange={v=>setBody({...body,liftingDetail:v})} siteId={site.id} planId={record?.id} version={record?.version} equipmentIds={body.equipmentIds} onBusy={setLiftingBusy}/>}
        <label><input type="checkbox" checked={!!body.hazardReferences} onChange={e=>{if(!e.target.checked&&!window.confirm('미저장 참고 선택과 메모를 제거할까요?'))return;const next={...body};if(e.target.checked)next.hazardReferences={schemaVersion:1,rows:[]};else delete next.hazardReferences;setBody(next);}}/>사용자 제공 위험요인·대책 참고 선택</label>
        {body.hazardReferences&&<WorkPlanHazardReferenceFields value={body.hazardReferences} onChange={v=>setBody({...body,hazardReferences:v})} onBusy={setReferenceBusy}/>}
        {body.documentForm&&<WorkPlanFormFields value={body.documentForm} onChange={v=>setBody({...body,documentForm:v})}/>}
        </Section>
      </fieldset>
      {record && <WorkPlanFormChecklist key={record.id} path={`${base}/${record.id}/form-checklist`} editable={editable && !allBusy} onDirty={setChecklistDirty} />}
      {record && <WorkPlanCalculations key={record.id + ":calc"} path={`${base}/${record.id}/calculations`} editable={editable && !allBusy} onDirty={setCalcDirty} />}
      <Section no={4} level={3} title="선택 장비 · 담당 업무 메모">
      <Notice summary="장비·명부는 각 10개까지 고를 수 있고, 고르지 않아도 됩니다.">
        각 최대10개, 선택은 선택사항입니다. 명부 항목을 지정해도 본인
        확인·동의·법정 선임이 되지 않습니다. 장비 선택은 공학 적합성 확인이
        아닙니다.
      </Notice>
      {editable && (
        <WorkPlanPicker
          path={`/sites/${site.id}/equipment?status=active`}
          label="참조할 활성 장비"
          disabled={allBusy || reviewDirty || body.equipmentIds.length >= 10}
          onSelect={(id) => {
            if (!body.equipmentIds.includes(id))
              setBody({ ...body, equipmentIds: [...body.equipmentIds, id] });
          }}
        />
      )}
      {body.equipmentIds.map((id) => (
        <p key={id}>
          장비{" "}
          {record?.source_capture?.facts.equipment.find((e) => e.id === id)
            ?.body.name || id}{" "}
          {editable && (
            <button
              disabled={allBusy || reviewDirty}
              onClick={() =>
                setBody({
                  ...body,
                  equipmentIds: body.equipmentIds.filter((v) => v !== id),
                })
              }
            >
              장비 선택 해제
            </button>
          )}
        </p>
      ))}
      {editable && (
        <WorkPlanPicker
          path={`/sites/${site.id}/workers?active=true`}
          label="업무 메모 대상 활성 명부"
          disabled={allBusy || reviewDirty || body.duties.length >= 10}
          onSelect={(id) => {
            if (!body.duties.some((d) => d.workerId === id))
              setBody({
                ...body,
                duties: [...body.duties, { workerId: id, duty: "" }],
              });
          }}
        />
      )}
      {body.duties.map((d, i) => (
        <div key={d.workerId}>
          <label>
            담당 업무 메모 ·{" "}
            {record?.source_capture?.facts.duties.find(
              (x) => x.worker.id === d.workerId,
            )?.worker.name || d.workerId}
            <textarea
              disabled={allBusy || reviewDirty || !editable}
              maxLength={1000}
              value={d.duty}
              onChange={(e) =>
                setBody({
                  ...body,
                  duties: body.duties.map((x, j) =>
                    i === j ? { ...x, duty: e.target.value } : x,
                  ),
                })
              }
            />
          </label>
          {editable && (
            <button
              disabled={allBusy || reviewDirty}
              onClick={() =>
                setBody({
                  ...body,
                  duties: body.duties.filter((_, j) => j !== i),
                })
              }
            >
              명부 선택 해제
            </button>
          )}
        </div>
      ))}
      </Section>
      {editable && (
        <ActionBar note={record?.source_capture ? undefined : "저장한 뒤 아래에서 선택 참조를 취합해야 보관할 수 있습니다."}>
          <button disabled={allBusy || reviewDirty} onClick={() => void command("save")}>
            초안 저장
          </button>
        </ActionBar>
      )}
      {record && (
        <>
          <Section no={5} level={3} title="참조 취합 · 보관">
          <WorkPlanDocumentReview key={record.id+":"+record.version} site={site} user={user} record={record} disabled={busy||changed||!!reason||!!authorId} onSaved={adopt} onRevision={onRevision} onDirtyChange={setReviewDirty} onBusyChange={setReviewBusy}/>
          <Notice summary="보관하려면 본문 저장 후 선택 참조를 취합하세요. 본문을 고치면 취합이 지워집니다.">
            본문 저장 후 선택 장비·명부 최신정보를 명시적으로 취합해야 보관할 수
            있습니다. 본문 수정 시 이전 초안 취합은 지워집니다.
          </Notice>
          {record.source_capture ? (
            <details>
              <summary>
                취합 시각 {record.source_capture.capturedAt} · 선택 참조
                snapshot
              </summary>
              <pre>{JSON.stringify(record.source_capture, null, 2)}</pre>
            </details>
          ) : (
            <p>선택 참조 취합 필요 (선택이 없어도 취합 확인 필요)</p>
          )}
          {editable && (
            <button
              disabled={allBusy || reviewDirty || changed}
              onClick={() => void command("capture")}
            >
              선택 참조 최신 정보 취합
            </button>
          )}
          {record.status === "draft" && site.role === "manager" && (
            <button
              disabled={allBusy || reviewDirty || changed || !record.source_capture}
              onClick={() => {
                if (
                  window.confirm(
                    "이 입력과 취합 참조를 보관할까요? 작업허가/안전 승인/선임이 아닙니다.",
                  )
                )
                  void command("archive");
              }}
            >
              관리자가 기록 확정
            </button>
          )}
          </Section>
          <button className="secondary" disabled={allBusy || reviewDirty} onClick={() => setHistory((v) => !v)}>
            처리 이력
          </button>
          {history && (
            <WorkPlanHistory
              base={base + "/" + record.id}
              version={record.version}
            />
          )}
          {record.parent_id && (
            <button
              disabled={allBusy || reviewDirty}
              onClick={() => void linked(record.parent_id!)}
            >
              원본 기록 열기
            </button>
          )}
          {record.successorId ? (
            <button
              disabled={allBusy || reviewDirty}
              onClick={() => void linked(record.successorId!)}
            >
              연결 정정 기록 열기
            </button>
          ) : (
            record.status === "archived" &&
            record.documentReview.review?.status !== "submitted" &&
            site.role === "manager" && (
              <fieldset disabled={allBusy || reviewDirty}>
                <legend>명시적인 새 정정 초안</legend>
                <label>
                  정정 사유
                  <textarea
                    maxLength={1000}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
                <WorkPlanPicker
                  path={base + "/authors"}
                  label="정정 초안 작성 계정"
                  disabled={allBusy || reviewDirty}
                  onSelect={setAuthor}
                />
                <p>
                  {authorId ? "작성 계정을 선택했습니다." : "작성 계정 미선택."} 원본과 고정 첨부 목록은 보존하며 첨부를 복사하지 않는 새 초안의
                  참조는 초기화됩니다.
                </p>
                <button
                  disabled={!reason.trim() || !authorId}
                  onClick={() => void command("revise")}
                >
                  새 정정 초안 만들기
                </button>
              </fieldset>
            )
          )}
        </>
      )}
    </section>
  );
}
