import { PpeReturnSummary } from "./PpeReturnSummary";
import { PpeReturnPolicy } from "./PpeReturnPolicy";
import type { PpeReturnView } from "./ppe-return-types";
import { useEffect, useState } from "react";
import { api, type Site } from "./api";
import { useDraftGuard } from "./useDraftGuard";
import type { PpeRecord } from "./company-ppe-types";
import type { StockItem } from "./stock-types";
import { CompanyPpeHistory } from "./CompanyPpeHistory";
export function PpeEditor({
  site,
  initial,
  onClose,
  onDirtyChange,
  onBusyChange,
}: {
  site: Site;
  initial: PpeRecord;
  onClose: () => void;
  onDirtyChange: (v: boolean) => void;
  onBusyChange: (v: boolean) => void;
}) {
  const [record, setRecord] = useState(initial),
    [item, setItem] = useState<StockItem | null>(null),
    [returnView,setReturnView]=useState<PpeReturnView|null>(null),
    [quantity,setQuantity]=useState(""),
    [cancelId,setCancelId]=useState(""),
    [mode, setMode] = useState<"return" | "note" | "partial" | "terminal" | "cancel">("note"),
    [date, setDate] = useState(""),
    [reason, setReason] = useState(""),
    [link, setLink] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [tick, setTick] = useState(0);
  const base = `/sites/${site.id}`,
    path = `${base}/ppe-issues/${record.id}`,
    dirty = !!(date || reason || link || confirmed || quantity || cancelId),
    guard = useDraftGuard(dirty, busy, onDirtyChange, onBusyChange);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setConfirmed(false);
    setError("");
    setItem(null);
    setReturnView(null);
    Promise.all([api<StockItem>(`${base}/stock-items/${record.item_id}`),api<PpeReturnView>(path+"/returns")])
      .then((v) => {
        if (live) {setItem(v[0]);setReturnView(v[1]);}
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [base, path, record.item_id, record.version, tick]);
  function clear() {
    setQuantity("");setCancelId("");
    setDate("");
    setReason("");
    setLink("");
    setConfirmed(false);
  }
  async function reload() {
    if (!guard.canLeave()) return;
    setBusy(true);
    setError("");
    try {
      setRecord(await api<PpeRecord>(path));
      clear();
      setTick((t) => t + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function send() {
    if (busy) return;
    if (mode !== "note" && (!item || !returnView || !confirmed || loading)) return;
    const bounded=mode==="partial"||mode==="terminal"||mode==="cancel";
    if(mode==="cancel"&&!cancelId)return;
    const endpoint=path+(bounded?(mode==="cancel"?`/returns/${cancelId}/cancel`:"/returns"):(mode==="return"?"/return":"/notes"));
    const body=bounded?{
      version:record.version,itemVersion:item!.version,effectiveDate:date,reason,
      ...(mode==="cancel"?{confirmCancelWholeEntry:true}:{kind:mode,quantity:mode==="terminal"?returnView!.summary.remainingQuantity:quantity,confirmBoundedPolicy:true}),
    }:mode==="return"?{version:record.version,itemVersion:item!.version,effectiveDate:date,reason,confirmFullReturn:true}:{version:record.version,reason,correctionMovementId:link||null};
    setBusy(true);
    setError("");
    try {
      if(bounded){const result=await api<PpeReturnView>(endpoint,"POST",body,guard.key(endpoint,body));setRecord(result.issue);setReturnView(result);}
      else setRecord(await api<PpeRecord>(endpoint,"POST",body,guard.key(endpoint,body)));
      setTick(t=>t+1);
      clear();
      setMode("note");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const original = record.original;
  return (
    <>
      <div className="section-head">
        <h2>
          보호구 수기 원장 ·{" "}
          {record.status === "issued" ? "미반납 또는 일부 반납" : "전량 반납 기록됨"} ·
          v{record.version}
        </h2>
        <button
          disabled={busy}
          onClick={() => {
            if (guard.canLeave()) onClose();
          }}
        >
          지급 목록으로
        </button>
      </div>
      <p className="notice">
        수령 서명·신원 인증이 아닙니다. 부분 반납은 평생 3회와 예약 잔여종결 정책을 따릅니다. 업체/명부
        비활성 후에도 기존 지급의 반납을 기록할 수 있습니다.
      </p>
      {error && <p role="alert">{error}</p>}
      <section className="panel">
        <p>보호구 원장 ID {record.id}</p>
        <h3>당시 지급 원본 (현재 이름/소속과 다를 수 있음)</h3>
        <p>
          {original.worker.name} · {original.company?.name || "업체 미연결"} ·
          자유입력 소속 {original.worker.affiliation || "없음"}
        </p>
        <p>
          {original.item.name} · {original.quantity} {original.item.unit} ·{" "}
          {original.effectiveDate}
        </p>
        <p>
          공종 {original.trade || "미기록"} · 위치 {original.location}
        </p>
        <p>{original.reason}</p>
        <p>원 지급 이동 ID {record.issue_movement_id}</p>
        {record.return_record && (
          <>
            <h3>전량 반납 기록</h3>
            <p>
              {record.return_record.effectiveDate} ·{" "}
              {record.return_record.reason}
            </p>
            <p>반납 이동 ID {record.return_movement_id}</p>
          </>
        )}
        <button disabled={busy} onClick={() => void reload()}>
          최신 원장·품목 다시 조회
        </button>
        <a href={"/api" + path + "/print"} target="_blank" rel="noreferrer">
          원장 인쇄
        </a>
      </section>
      <p>
        현재 품목 잔량:{" "}
        {loading
          ? "조회 중"
          : item
            ? item.balance + " " + item.unit
            : "조회 실패"}{" "}
        · 최근 이동일 {item?.lastEffectiveDate || "없음"}{" "}
        <button
          disabled={busy || loading}
          onClick={() => setTick((t) => t + 1)}
        >
          품목 재조회
        </button>
      </p>
      <PpeReturnSummary data={returnView} unit={original.item.unit}/>
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
            value={mode}
            disabled={busy}
            onChange={(e) => {
              if (!guard.canLeave()) return;
              clear();
              setMode(e.target.value as typeof mode);
            }}
          >
            <option value="note">정정/보충 메모 (수량 변경 없음)</option>
            {record.status === "issued" && returnView && returnView.entries.length===0 && (
              <option value="return">기존 전량 반납 기록</option>
            )}
            {record.status==="issued"&&returnView&&!returnView.summary.terminal&&<>
              <option value="partial" disabled={returnView.summary.partialCount>=3}>일부 수량 반납 (평생 최대 3회)</option>
              <option value="terminal">예약 잔여 전량 반납·종결</option>
              <option value="cancel">개별 부분 반납 전체 오류취소</option>
            </>}
          </select>
        </label>
        <label>
          사유
          <textarea
            required
            maxLength={1000}
            value={reason}
            disabled={busy}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        {mode !== "note" ? (
          <>
            <label>
              반납 효력일
              <input
                required
                type="date"
                value={date}
                disabled={busy}
                onChange={(e) => {
                  setDate(e.target.value);
                  setConfirmed(false);
                }}
              />
            </label>
            {mode!=="return"&&<PpeReturnPolicy/>}
            {mode==="partial"&&<label>실제 부분 반납 수량<input required disabled={busy} value={quantity} onChange={e=>{setQuantity(e.target.value);setConfirmed(false);}}/></label>}
            {mode==="terminal"&&<p>이번 반납 {returnView?.summary.remainingQuantity} {original.item.unit} · 종결 후 모든 반납 취소 불가</p>}
            {mode==="cancel"&&<label>전체 취소할 부분 반납<select required disabled={busy} value={cancelId} onChange={e=>{setCancelId(e.target.value);setConfirmed(false);}}><option value="">선택</option>{returnView?.entries.filter(x=>x.kind==="partial"&&!returnView.entries.some(y=>y.cancelsId===x.id)).map(x=><option key={x.id} value={x.id}>{x.effectiveDate} · {x.quantity} · {x.id}</option>)}</select></label>}
            {mode==="return"&&<p>
              전량 {original.quantity} {original.item.unit}를 반납했다고
              기록하며 재고가 같은 수량 증가합니다. 일부만 반납했다면 저장하지
              마세요.
            </p>}
            <label>
              <input
                required
                type="checkbox"
                checked={confirmed}
                disabled={busy}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              {mode==="return"?"위 수량·단위의 전량 반납과 재고 증가를 확인했습니다.":mode==="cancel"?"선택한 부분 반납 전체 취소와 같은 수량의 재고 감소를 확인했습니다.":"실제 수량·재고 증가와 3회 제한·종결 후 취소 불가를 확인했습니다."}
            </label>
          </>
        ) : (
          <>
            <p>
              메모만으로 지급/반납 수량이나 재고는 바뀌지 않습니다. 잘못된 종결
              반납은 재고 · 보호구 메뉴에서 실제 사실과 사유에 근거한 증감
              조정을 별도로 기록한 뒤 아래 이동 ID를 참조하세요. 기존
              날짜/잔량/건수 제한을 우회하지 않습니다. 종결 반납의 직접 취소는 지원하지 않습니다.
            </p>
            <label>
              별도 재고 조정 이동 ID (선택)
              <input
                maxLength={36}
                value={link}
                disabled={busy}
                onChange={(e) => setLink(e.target.value)}
              />
            </label>
            <p>
              같은 품목의 현재 유효한 adjust_in/adjust_out 이동만 연결합니다.
              연결은 그 조정의 실제 적합성을 인증하지 않습니다.
            </p>
          </>
        )}
        <button
          disabled={
            busy || (mode !== "note" && (!item || !returnView || loading || !confirmed || (mode==="partial"&&returnView.summary.partialCount>=3) || (mode==="cancel"&&!cancelId)))
          }
        >
          {mode==="note"?"메모 기록 (재고 수량 변화 없음)":mode==="cancel"?"부분 반납 전체 취소·재고 감소":mode==="terminal"?"잔여 전량 반납·불변 종결":"반납·재고 증가 함께 기록"}
        </button>
      </form>
      <CompanyPpeHistory path={path} version={record.version} />
    </>
  );
}
