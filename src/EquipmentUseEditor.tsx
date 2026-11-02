import { useRef, useState } from "react";
import { ActionBar, Notice, TechDetails } from "./ui";
import { api, type Site, type User } from "./api";
import type {
  EquipmentRecord,
  EquipmentUseRecord,
  EquipmentUseBody,
} from "./equipment-types";
import { useDraftGuard } from "./useDraftGuard";
import { EquipmentHistory } from "./EquipmentHistory";
export function EquipmentUseEditor({
  site,
  user,
  initial,
  equipment,
  onClose,
  onDirtyChange,
  onBusyChange,
}: {
  site: Site;
  user: User;
  initial: EquipmentUseRecord | null;
  equipment?: EquipmentRecord;
  onClose: () => void;
  onDirtyChange: (v: boolean) => void;
  onBusyChange: (v: boolean) => void;
}) {
  const [record, setRecord] = useState(initial),
    [body, setBody] = useState<EquipmentUseBody>(
      initial?.body || {
        date: new Date().toLocaleDateString("en-CA"),
        location: "",
        workSummary: "",
      },
    ),
    [status, setStatus] = useState<EquipmentUseRecord["status"]>(
      initial?.status || "recorded",
    ),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const source = record?.equipment_snapshot || equipment!,
    baseline = useRef(JSON.stringify({ body, status })),
    dirty = JSON.stringify({ body, status }) !== baseline.current || !!reason,
    guard = useDraftGuard(dirty, busy, onDirtyChange, onBusyChange),
    editable =
      site.role === "manager" ||
      (site.role === "editor" && (!record || record.owner_id === user.id));
  function adopt(r: EquipmentUseRecord) {
    setRecord(r);
    setBody(r.body);
    setStatus(r.status);
    baseline.current = JSON.stringify({ body: r.body, status: r.status });
    setReason("");
  }
  async function save() {
    if (busy) return;
    const path = `/sites/${site.id}/equipment-uses${record ? "/" + record.id : ""}`,
      value = record
        ? { version: record.version, body, status, reason }
        : { equipmentId: source.id, body };
    setBusy(true);
    setError("");
    try {
      adopt(
        await api<EquipmentUseRecord>(
          path,
          record ? "PUT" : "POST",
          value,
          guard.key(path, value),
        ),
      );
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
      adopt(
        await api<EquipmentUseRecord>(
          `/sites/${site.id}/equipment-uses/${record.id}`,
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <div className="section-head">
        <h1>수기 장비 사용기록</h1>
        <button
          disabled={busy}
          className="secondary"
          onClick={() => guard.canLeave() && onClose()}
        >
          사용기록 목록으로
        </button>
      </div>
      <Notice summary="같은 장비·날짜에 여러 건을 넣을 수 있으니 저장 전 중복을 확인하세요.">
        수기 기록이며 실제 가동·사용 허가·안전 승인을 확인하지 않습니다. 같은
        장비/날짜에 별도 작업 기록 여러 건을 입력할 수 있으므로 저장 전 중복
        작업을 확인하세요.
      </Notice>
      <h2>
        {source.body.name} · {source.body.typeLabel}
      </h2>
      <p>
        당시 코드 {source.body.assetCode || "없음"} · 모델{" "}
        {source.body.model} · 일련표시 {source.body.serial} · 업체표시{" "}
        {source.body.ownerCompany}
      </p>
      <TechDetails><p>장비 ID {source.id}</p></TechDetails>
      <p>
        사용 당시 입력한 검사 예정일:{" "}
        {source.dueMetadata?.nextInspectionDate || "미기록"} · 보험 기록상
        종료일: {source.dueMetadata?.insuranceRecordedUntil || "미기록"} · 출처
        메모: {source.dueMetadata?.sourceNote || "미기록"}. 합격/유효 판단이
        아닙니다.
      </p>
      {record && (
        <p>
          사용기록 {record.id} v{record.version} · 원 작성 계정{" "}
          {record.owner_id} ·{" "}
          {record.status === "cancelled" ? "취소 기록" : "수기 기록됨"}
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <fieldset disabled={busy || !editable}>
        <label>
          사용 일자
          <input
            type="date"
            value={body.date}
            onChange={(e) => setBody({ ...body, date: e.target.value })}
          />
        </label>
        <label>
          사용 장소
          <input
            maxLength={300}
            value={body.location}
            onChange={(e) => setBody({ ...body, location: e.target.value })}
          />
        </label>
        <label>
          수기 작업내용
          <textarea
            maxLength={3000}
            value={body.workSummary}
            onChange={(e) => setBody({ ...body, workSummary: e.target.value })}
          />
        </label>
        {record && (
          <>
            <label>
              기록 상태
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as typeof status)}
              >
                <option value="recorded">수기 기록됨 (복원)</option>
                <option value="cancelled">취소</option>
              </select>
            </label>
            <label>
              정정/취소/복원 사유
              <textarea
                maxLength={1000}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <p>
              퇴역 장비도 기존 기록 정정/취소는 가능하지만 취소→복원은 관리자가
              장비를 재활성화한 뒤 가능합니다. 사용 당시 장비 snapshot은 변하지
              않습니다.
            </p>
          </>
        )}
      </fieldset>
      <ActionBar note={<span role="status">{dirty ? "저장하지 않은 입력" : record ? "서버에 저장됨" : ""}</span>}>
        {editable && (
          <button
            disabled={busy || (!!record && !reason.trim())}
            onClick={save}
          >
            {record ? "사용기록 정정 저장" : "사용기록 저장"}
          </button>
        )}
        {record && (
          <>
            <button disabled={busy} className="secondary" onClick={reload}>
              최신 사용기록 다시 열기
            </button>
            <a
              href={`/api/sites/${site.id}/equipment-uses/${record.id}/print`}
              target="_blank"
              rel="noreferrer"
            >
              사용기록/이력 인쇄
            </a>
          </>
        )}
      </ActionBar>
      {record && (
        <EquipmentHistory
          key={record.id}
          siteId={site.id}
          id={record.id}
          version={record.version}
          use
        />
      )}
    </section>
  );
}
