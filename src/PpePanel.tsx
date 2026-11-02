import { useEffect, useState } from "react";
import { api, type Site } from "./api";
import type { PpeRecord } from "./company-ppe-types";
import { PpeCreate } from "./PpeCreate";
import { PpeEditor } from "./PpeEditor";
export function PpePanel({
  site,
  onDirtyChange,
  onBusyChange,
}: {
  site: Site;
  onDirtyChange: (v: boolean) => void;
  onBusyChange: (v: boolean) => void;
}) {
  const [page, setPage] = useState<{ items: PpeRecord[]; hasMore: boolean }>({
      items: [],
      hasMore: false,
    }),
    [offset, setOffset] = useState(0),
    [tick, setTick] = useState(0),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [record, setRecord] = useState<PpeRecord | null>(null),
    [creating, setCreating] = useState(false);
  const base = `/sites/${site.id}/ppe-issues`;
  useEffect(() => {
    let active = true;
    setLoading(true);
    setPage({ items: [], hasMore: false });
    setError("");
    api<typeof page>(`${base}?offset=${offset}`)
      .then((v) => {
        if (active) setPage(v);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [base, offset, tick]);
  const close = () => {
    setRecord(null);
    setCreating(false);
    setTick((t) => t + 1);
  };
  if (creating)
    return (
      <PpeCreate
        site={site}
        onDirtyChange={onDirtyChange}
        onBusyChange={onBusyChange}
        onClose={close}
        onSaved={(v) => {
          setCreating(false);
          setRecord(v);
        }}
      />
    );
  if (record)
    return (
      <PpeEditor
        key={record.id}
        site={site}
        initial={record}
        onClose={close}
        onDirtyChange={onDirtyChange}
        onBusyChange={onBusyChange}
      />
    );
  return (
    <>
      <h2>보호구 수기 지급·전량 반납</h2>
      <p>
        manager 전용. 수령 서명/본인 신원/적합성 확인이 아닙니다. 부분 반납은
        지급 건당 3회까지, 그 뒤에는 전량 반납으로 기록합니다. 실제 재고 원장과
        원자적으로 수량을 기록합니다.
      </p>
      <button onClick={() => setCreating(true)}>새 보호구 지급 기록</button>
      {error && (
        <p role="alert">
          {error}
          <button onClick={() => setTick((t) => t + 1)}>다시 조회</button>
        </p>
      )}
      <section className="panel">
        {loading ? (
          <p>조회 중…</p>
        ) : (
          page.items.map((r) => (
            <button key={r.id} onClick={() => setRecord(r)}>
              {r.original.worker.name} · {r.original.item.name} ·{" "}
              {r.original.quantity} {r.original.item.unit} ·{" "}
              {r.status === "issued" ? "지급" : "전량 반납"} ·{" "}
              {r.original.effectiveDate}
            </button>
          ))
        )}
        <button
          disabled={loading || !offset}
          onClick={() => {
            setLoading(true);
            setOffset((o) => o - 50);
          }}
        >
          이전 50
        </button>
        <button
          disabled={loading || !page.hasMore}
          onClick={() => {
            setLoading(true);
            setOffset((o) => o + 50);
          }}
        >
          다음 50
        </button>
      </section>
    </>
  );
}
