import { useEffect, useState } from "react";
import { api } from "./api";
import { useDraftGuard } from "./useDraftGuard";
import { StockMinimumSummary } from "./StockMinimumSummary";
import { minimumWarning, type MinimumDetail, type MinimumSetting } from "./stock-minimum-types";
import type { Page } from "./attendance-types";
export function StockMinimumEditor({ base, onClose, onDirtyChange, onBusyChange }: {
  base: string; onClose: () => void; onDirtyChange: (v: boolean) => void; onBusyChange: (v: boolean) => void;
}) {
  const [record, setRecord] = useState<MinimumDetail | null>(null), [history, setHistory] = useState<Page<MinimumSetting> | null>(null),
    [offset, setOffset] = useState(0), [tick, setTick] = useState(0), [loading, setLoading] = useState(true),
    [error, setError] = useState(""), [busy, setBusy] = useState(false), [editing, setEditing] = useState(false),
    [enabled, setEnabled] = useState(true), [minimum, setMinimum] = useState(""), [reason, setReason] = useState(""),
    [confirm, setConfirm] = useState(false), [saved, setSaved] = useState<MinimumSetting | null>(null);
  const guard = useDraftGuard(editing, busy, onDirtyChange, onBusyChange);
  useEffect(() => {
    let active = true; setLoading(true); setError(""); setRecord(null); setHistory(null);
    Promise.all([api<MinimumDetail>(base + "/minimum"), api<Page<MinimumSetting>>(base + `/minimum/history?offset=${offset}`)])
      .then(([r, h]) => { if (active) { setRecord(r); setHistory(h); } })
      .catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [base, offset, tick]);
  async function save() {
    if (!record || busy || !confirm) return;
    const common = { expectedConfigVersion: record.configVersion, expectedItemVersion: record.item.version, reason, confirm: true as const };
    const body = enabled ? { ...common, enabled: true, minimum } : { ...common, enabled: false };
    setBusy(true); setError("");
    try { const result = await api<MinimumSetting>(base + "/minimum", "POST", body, guard.key(base + "/minimum", body));
      setSaved(result); setEditing(false); setReason(""); setConfirm(false); setOffset(0); setTick(v => v + 1);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <section><button disabled={busy} onClick={() => { if (guard.canLeave()) onClose(); }}>품목 수불로 돌아가기</button>
    <h2>최소재고 설정·현재 비교</h2><p>{minimumWarning}</p>
    <p>설정 변경·해제는 새 이력이며 이동 수량이나 과거 수불 인쇄를 바꾸지 않습니다. 0 기준은 해제가 아닙니다. 이동이 없는 품목의 단위가 변경되면 다시 설정하기 전까지 비교하지 않습니다.</p>
    {saved && <p>설정 v{saved.snapshot.version} 저장됨 · 이 저장 결과는 고정 설정이며 현재 잔량 증명이 아닙니다.</p>}
    {error && <p role="alert">{error} 저장 실패 시 입력을 유지합니다.</p>}
    {loading && <p>조회 중</p>}
    <button disabled={busy || loading} onClick={() => { setConfirm(false); setTick(v => v + 1); }}>입력을 유지하고 최신 설정 조회</button>
    {record && <><h3>{record.item.name} · {record.item.id}</h3><StockMinimumSummary record={record}/><p>조회 {record.queriedAt}</p>
      {!editing && <button disabled={busy} onClick={() => { setEditing(true); setEnabled(true); setMinimum(record.setting?.snapshot.minimum || ""); setConfirm(false); }}>설정 변경·해제</button>}
      {editing && <fieldset disabled={busy || loading}><legend>사유 있는 명시 설정</legend>
        <label>동작<select value={enabled ? "set" : "disable"} onChange={e => { setEnabled(e.target.value === "set"); setConfirm(false); }}><option value="set">현재 단위로 기준 설정</option><option value="disable" disabled={!record.setting?.snapshot.enabled}>기준 해제</option></select></label>
        {enabled && <label>최소 수량 ({record.item.unit})<input inputMode="decimal" maxLength={24} value={minimum} onChange={e => { setMinimum(e.target.value); setConfirm(false); }}/></label>}
        <p>0 이상 10억 이하, 소수 6자리까지. 부호·쉼표·지수 없이 입력합니다.</p>
        <label>설정 출처·변경 사유<textarea maxLength={1000} value={reason} onChange={e => { setReason(e.target.value); setConfirm(false); }}/></label>
        <label><input type="checkbox" checked={confirm} onChange={e => setConfirm(e.target.checked)}/>현재 품목 단위와 설정 버전을 확인했으며 직접 정한 현재 기준으로 저장합니다.</label>
        <button disabled={!confirm || !reason.trim()} onClick={() => void save()}>설정 이력 저장</button>
        <button onClick={() => { if (guard.canLeave()) { setEditing(false); setConfirm(false); } }}>취소</button>
      </fieldset>}
    </>}
    {history && <><h3>설정 이력 (최근순)</h3>{history.items.map(r => <article key={r.snapshot.id}>
      <p>v{r.snapshot.version} · {r.snapshot.enabled ? `${r.snapshot.minimum} ${r.snapshot.item.unit}` : "해제"} · 당시 품목 {r.snapshot.item.name}</p>
      <p>{r.snapshot.reason} · {r.snapshot.actor.name} · {r.snapshot.at}</p><details><summary>고정 설정 해시</summary>{r.hash}</details>
    </article>)}<button disabled={busy || loading || editing || offset === 0} onClick={() => setOffset(v => Math.max(0, v - 50))}>다음 50</button><button disabled={busy || loading || editing || !history.hasMore} onClick={() => setOffset(v => v + 50)}>이전 50</button></>}
  </section>;
}
