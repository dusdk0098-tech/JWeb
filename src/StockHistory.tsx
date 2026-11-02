import { useEffect, useState } from "react";
import { api } from "./api";
import type { Page } from "./attendance-types";
type Event = {
  id: number;
  version: number;
  event: string;
  actor_name: string;
  at: string;
  reason: string;
  data: unknown;
};
export function StockHistory({ base, tick }: { base: string; tick: number }) {
  const [page, setPage] = useState<Page<Event>>({ items: [], hasMore: false }),
    [offset, setOffset] = useState(0),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setLoading(true);
    api<Page<Event>>(`${base}/events?offset=${offset}`)
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
  return (
    <section>
      <h3>품목 변경·이동 메타 이력</h3>
      {error && <p role="alert">{error}</p>}
      {loading ? (
        <p>조회 중</p>
      ) : (
        page.items.map((e) => (
          <details key={e.id}>
            <summary>
              v{e.version} · {e.event} · {e.actor_name} · {e.at}
            </summary>
            <p>{e.reason}</p>
            <pre>{JSON.stringify(e.data, null, 2)}</pre>
          </details>
        ))
      )}
      <button
        disabled={loading || offset === 0}
        onClick={() => setOffset((v) => v - 50)}
      >
        이전 50
      </button>
      <button
        disabled={loading || !page.hasMore}
        onClick={() => setOffset((v) => v + 50)}
      >
        다음 50
      </button>
    </section>
  );
}
