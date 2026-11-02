import { useRef, useState } from "react";
import { ActionBar, Notice, TechDetails } from "./ui";
import { api, type Site } from "./api";
import type { EquipmentInput, EquipmentRecord } from "./equipment-types";
import { useDraftGuard } from "./useDraftGuard";
import { EquipmentHistory } from "./EquipmentHistory";
const empty: EquipmentInput = {
  assetCode: "",
  name: "",
  typeLabel: "",
  model: "",
  serial: "",
  ownerCompany: "",
  notes: "",
};
export function EquipmentEditor({
  site,
  initial,
  onClose,
  onNewUse,
  onDirtyChange,
  onBusyChange,
}: {
  site: Site;
  initial: EquipmentRecord | null;
  onClose: () => void;
  onNewUse: (r: EquipmentRecord) => void;
  onDirtyChange: (v: boolean) => void;
  onBusyChange: (v: boolean) => void;
}) {
  const [record, setRecord] = useState(initial),
    [form, setForm] = useState(initial?.body || empty),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const baseline = useRef(JSON.stringify(form)),
    formDirty = JSON.stringify(form) !== baseline.current,
    guard = useDraftGuard(
      formDirty || !!reason,
      busy,
      onDirtyChange,
      onBusyChange,
    );
  function adopt(r: EquipmentRecord) {
    setRecord(r);
    setForm(r.body);
    baseline.current = JSON.stringify(r.body);
    setReason("");
  }
  async function run(status?: "active" | "retired") {
    if (busy) return;
    if (status && formDirty) {
      setError("본문 변경을 먼저 저장하세요.");
      return;
    }
    const path = `/sites/${site.id}/equipment${record ? "/" + record.id : ""}${status ? "/status" : ""}`,
      value = status
        ? { version: record!.version, status, reason }
        : { ...form, ...(record ? { version: record.version, reason } : {}) };
    setBusy(true);
    setError("");
    try {
      adopt(
        await api<EquipmentRecord>(
          path,
          record && !status ? "PUT" : "POST",
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
        await api<EquipmentRecord>(`/sites/${site.id}/equipment/${record.id}`),
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
        <h1>
          장비 대장 · {record?.status === "retired" ? "퇴역 기록" : "등록 활성"}
        </h1>
        <button
          disabled={busy}
          className="secondary"
          onClick={() => guard.canLeave() && onClose()}
        >
          장비 목록으로
        </button>
      </div>
      <Notice summary="활성 장비에만 사용 기록을 입력할 수 있습니다.">
        등록 활성은 앱에서 새 수기 사용기록을 입력할 수 있는 분류이며
        사용허가·장비 안전·검사/보험 적합성 인증이 아닙니다. 공학 계산·증빙 첨부
        없음.
      </Notice>
      {record && (
        <TechDetails>
          <p>장비 ID {record.id} · v{record.version}</p>
        </TechDetails>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <fieldset disabled={busy || site.role !== "manager"}>
        {(
          [
            ["name", "장비 이름", 200],
            ["typeLabel", "장비 종류 표시", 100],
            ["assetCode", "현장 장비 코드 (선택)", 60],
            ["model", "모델 표시 (선택)", 100],
            ["serial", "일련번호 표시 (선택)", 100],
            ["ownerCompany", "소유업체 표시 (선택)", 100],
          ] as const
        ).map(([key, label, max]) => (
          <label key={key}>
            {label}
            <input
              maxLength={max}
              value={form[key]}
              onChange={(e) => setForm({ ...form, [key]: e.target.value })}
            />
          </label>
        ))}
        <p>
          장비 코드는 NFKC/앞뒤 공백제거/ASCII 대문자 저장,영문·숫자·._-만
          허용하며 현장 내 중복 불가. 일련표시는 대소문자 보존·비고유값입니다.
          동일 이름은 별개 장비입니다.
        </p>
        <label>
          장비 비고
          <textarea
            maxLength={2000}
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </label>
        {record && (
          <label>
            변경/상태 처리 사유
            <textarea
              maxLength={1000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
        )}
      </fieldset>
      <ActionBar note={<span role="status">{formDirty ? "저장하지 않은 입력" : record ? "서버에 저장됨" : ""}</span>}>
        {site.role === "manager" && (
          <>
            <button
              disabled={busy || (!!record && !reason.trim())}
              onClick={() => run()}
            >
              장비 저장
            </button>
            {record && (
              <button
                disabled={busy || formDirty || !reason.trim()}
                onClick={() =>
                  window.confirm(
                    "장비의 등록 분류를 변경하고 사유를 남길까요? 안전 판정이 아닙니다.",
                  ) && run(record.status === "active" ? "retired" : "active")
                }
              >
                {record.status === "active" ? "퇴역 기록" : "등록 재활성화"}
              </button>
            )}
          </>
        )}
        {record && (
          <>
            <button className="secondary" disabled={busy} onClick={reload}>
              최신 장비 다시 열기
            </button>
            <a
              href={`/api/sites/${site.id}/equipment/${record.id}/print`}
              target="_blank"
              rel="noreferrer"
            >
              장비/이력 인쇄
            </a>
            {site.role !== "viewer" && record.status === "active" && (
              <button
                disabled={busy}
                onClick={() => guard.canLeave() && onNewUse(record)}
              >
                이 장비 수기 사용기록
              </button>
            )}
          </>
        )}
      </ActionBar>
      {record && (
        <EquipmentHistory
          key={record.id}
          siteId={site.id}
          id={record.id}
          version={record.version}
          use={false}
        />
      )}
    </section>
  );
}
