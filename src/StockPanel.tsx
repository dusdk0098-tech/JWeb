import { StockMinimumPanel } from "./StockMinimumPanel";
import { PpePanel } from "./PpePanel";
import { Notice, PageHeader } from "./ui";
import { useEffect, useState } from "react";
import { api, type Site } from "./api";
import type { Page } from "./attendance-types";
import { useDraftGuard } from "./useDraftGuard";
import { StockEditor } from "./StockEditor";
import { stockWarning, type StockItem } from "./stock-types";
export function StockPanel({
  site,
  onDirtyChange,
  onBusyChange,
}: {
  site: Site;
  onDirtyChange: (v: boolean) => void;
  onBusyChange: (v: boolean) => void;
}) {
  const [page, setPage] = useState<Page<StockItem>>({
      items: [],
      hasMore: false,
    }),
    [offset, setOffset] = useState(0),
    [tick, setTick] = useState(0),
    [record, setRecord] = useState<StockItem | null>(null),
    [creating, setCreating] = useState(false),
    [minimums, setMinimums] = useState(false),
    [ppe, setPpe] = useState(false), // 보호구 지급·반납 (결정 8: one entry for PPE)
    [name, setName] = useState(""),
    [unit, setUnit] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const guard = useDraftGuard(creating, busy, onDirtyChange, onBusyChange),
    base = `/sites/${site.id}/stock-items`;
  useEffect(() => {
    let active = true;
    setLoading(true);
    api<Page<StockItem>>(`${base}?offset=${offset}`)
      .then((v) => {
        if (active) setPage(v);
      })
      .catch((e) => {
        if (active) {
          setPage({ items: [], hasMore: false });
          setError(e.message);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [base, offset, tick]);
  async function open(id?: string) {
    setBusy(true);
    setError("");
    try {
      const body = { name, unit };
      setRecord(
        id
          ? await api<StockItem>(base + "/" + id)
          : await api<StockItem>(base, "POST", body, guard.key(base, body)),
      );
      setCreating(false);
      setName("");
      setUnit("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (record)
    return (
      <StockEditor
        key={record.id}
        initial={record}
        site={site}
        onDirtyChange={onDirtyChange}
        onBusyChange={onBusyChange}
        onClose={() => {
          setRecord(null);
          setTick((v) => v + 1);
        }}
      />
    );
  if (minimums) return <>{error && <p role="alert">{error}</p>}<StockMinimumPanel siteId={site.id} disabled={busy} onOpen={id => void open(id)} onClose={() => setMinimums(false)}/></>;
  const switcher = (
    <div className="segmented" role="group" aria-label="종류">
      <button type="button" aria-pressed={!ppe} className={ppe ? "secondary" : ""} disabled={busy} onClick={() => setPpe(false)}>품목 재고</button>
      <button type="button" aria-pressed={ppe} className={ppe ? "" : "secondary"} disabled={busy} onClick={() => setPpe(true)}>보호구 지급·반납</button>
    </div>
  );
  if (ppe)
    return (
      <section className="panel">
        <PageHeader level={1} title="재고 · 보호구" />
        {switcher}
        <PpePanel site={site} onDirtyChange={onDirtyChange} onBusyChange={onBusyChange} />
      </section>
    );
  return (
    <section className="panel">
      <PageHeader level={1} title="재고 · 보호구" />
      {switcher}
      <Notice summary="직접 입력하는 재고 기록입니다. 실물 확인이나 금액 평가는 하지 않습니다.">{stockWarning}</Notice>
      {error && <p role="alert">{error}</p>}
      {creating ? (
        <fieldset disabled={busy}>
          <legend>별도 품목 등록</legend>
          <label>
            품목명
            <input
              maxLength={200}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            수량 단위
            <input
              maxLength={30}
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
            />
          </label>
          <p>
            같은 이름도 다른 UUID 품목입니다. 자동 병합하지 않습니다. 첫 이동 뒤
            단위는 바꿀 수 없습니다.
          </p>
          <button onClick={() => void open()}>등록</button>
          <button
            onClick={() => {
              if (guard.canLeave()) setCreating(false);
            }}
          >
            취소
          </button>
        </fieldset>
      ) : (
        <>
          <button disabled={busy} onClick={() => setMinimums(true)}>현재 최소재고 비교</button>
          <button disabled={busy} onClick={() => setCreating(true)}>
            품목 등록
          </button>
          {loading ? (
            <p>조회 중</p>
          ) : (
            page.items.map((p) => (
              <p key={p.id}>
                <button disabled={busy} onClick={() => void open(p.id)}>
                  {p.name} · {p.unit} · {p.id}
                </button>
              </p>
            ))
          )}
          <button
            disabled={busy || loading || offset === 0}
            onClick={() => setOffset((v) => v - 50)}
          >
            이전 50
          </button>
          <button
            disabled={busy || loading || !page.hasMore}
            onClick={() => setOffset((v) => v + 50)}
          >
            다음 50
          </button>
        </>
      )}
    </section>
  );
}
