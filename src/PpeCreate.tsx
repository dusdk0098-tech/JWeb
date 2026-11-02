import { useEffect, useState } from "react";
import { api, type Site } from "./api";
import { useDraftGuard } from "./useDraftGuard";
import { WorkPlanPicker } from "./WorkPlanPicker";
import type { WorkerCompany, PpeRecord } from "./company-ppe-types";
import type { StockItem } from "./stock-types";
export function PpeCreate({
  site,
  initialItemId,
  onSaved,
  onClose,
  onDirtyChange,
  onBusyChange,
}: {
  site: Site;
  initialItemId?: string;
  onSaved: (v: PpeRecord) => void;
  onClose: () => void;
  onDirtyChange: (v: boolean) => void;
  onBusyChange: (v: boolean) => void;
}) {
  const [source, setSource] = useState<WorkerCompany | null>(null),
    [item, setItem] = useState<StockItem | null>(null),
    [quantity, setQuantity] = useState(""),
    [effectiveDate, setEffectiveDate] = useState(new Date().toLocaleDateString("en-CA")),
    [trade, setTrade] = useState(""),
    [location, setLocation] = useState(""),
    [reason, setReason] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const base = `/sites/${site.id}`,
    dirty = !!(
      source ||
      item ||
      quantity ||
      trade ||
      location ||
      reason
    ),
    guard = useDraftGuard(dirty, busy, onDirtyChange, onBusyChange);
  useEffect(()=>{if(!initialItemId)return;let active=true;setBusy(true);setItem(null);api<StockItem>(`/sites/${site.id}/stock-items/${initialItemId}`).then(v=>{if(active)setItem(v);}).catch((e:Error)=>{if(active)setError(e.message);}).finally(()=>{if(active)setBusy(false);});return()=>{active=false;};},[site.id,initialItemId]);
  async function choose(kind: "worker" | "item", id: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    setConfirmed(false);
    try {
      if (kind === "worker")
        setSource(await api<WorkerCompany>(`${base}/workers/${id}/company`));
      else setItem(await api<StockItem>(`${base}/stock-items/${id}`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (busy || !source || !item || !confirmed) return;
    setBusy(true);
    setError("");
    const path = base + "/ppe-issues",
      body = {
        workerId: source.worker.id,
        workerVersion: source.worker.version,
        affiliationVersion: source.version,
        companyVersion: source.company?.version ?? null,
        itemId: item.id,
        itemVersion: item.version,
        quantity,
        effectiveDate,
        trade,
        location,
        reason,
        confirmIssue: true,
      };
    try {
      onSaved(await api<PpeRecord>(path, "POST", body, guard.key(path, body)));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <h2>보호구 수기 지급</h2>
      <button
        disabled={busy}
        onClick={() => {
          if (guard.canLeave()) onClose();
        }}
      >
        지급 목록으로
      </button>
      <p className="notice">
        지급 건별 기존 전량 반납 또는 최대 3회 부분 반납·예약 잔여종결을 지원합니다. 수령 서명/법적
        신원·보호구 적합성 판정은 지원하지 않습니다.
      </p>
      {error && <p role="alert">{error}</p>}
      <WorkPlanPicker
        path={base + "/workers?active=true"}
        label="지급할 활성 명부 대상"
        disabled={busy}
        onSelect={(id) => void choose("worker", id)}
      />
      {source && (
        <p>
          선택 대상: {source.worker.name} · 연결 업체{" "}
          {source.company?.name || "미연결"} · 자유입력 소속{" "}
          {source.worker.affiliation || "없음"}{" "}
          <button
            disabled={busy}
            onClick={() => void choose("worker", source.worker.id)}
          >
            명부/업체 다시 조회
          </button>
        </p>
      )}
      <WorkPlanPicker
        path={base + "/stock-items"}
        label="출고할 재고 품목"
        disabled={busy}
        onSelect={(id) => void choose("item", id)}
      />
      {item && (
        <p>
          선택 품목: {item.name} · 단위 {item.unit} · 현재 잔량 {item.balance} ·
          최근 이동일 {item.lastEffectiveDate || "없음"}{" "}
          <button disabled={busy} onClick={() => void choose("item", item.id)}>
            품목 다시 조회
          </button>
        </p>
      )}
      <form
        className="panel"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label>
          지급 수량 (양수 소수6자리)
          <input
            required
            maxLength={24}
            inputMode="decimal"
            disabled={busy}
            value={quantity}
            onChange={(e) => {
              setQuantity(e.target.value);
              setConfirmed(false);
            }}
          />
        </label>
        <label>
          효력일
          <input
            required
            type="date"
            disabled={busy}
            value={effectiveDate}
            onChange={(e) => {
              setEffectiveDate(e.target.value);
              setConfirmed(false);
            }}
          />
        </label>
        <label>
          수기 공종 (선택)
          <input
            maxLength={200}
            disabled={busy}
            value={trade}
            onChange={(e) => setTrade(e.target.value)}
          />
        </label>
        <label>
          사용/보관 위치
          <input
            required
            maxLength={300}
            disabled={busy}
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
        </label>
        <label>
          지급 기록 사유
          <textarea
            required
            maxLength={1000}
            disabled={busy}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <p>
          저장하면 {item?.name || "미선택 품목"} 재고가 {quantity || "미입력"}{" "}
          {item?.unit || ""} 감소하고 명부/업체/품목 당시 정보가 고정됩니다.
        </p>
        <label>
          <input
            type="checkbox"
            required
            checked={confirmed}
            disabled={busy}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          수량·단위·재고 감소 및 전량/제한된 부분 반납 정책을 확인했습니다. 수령 서명이
          아닙니다.
        </label>
        <button disabled={busy || !source || !item || !confirmed}>
          수기 지급·재고 출고 함께 기록
        </button>
      </form>
    </>
  );
}
