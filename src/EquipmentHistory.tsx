import { useEffect, useState } from "react";
import { api } from "./api";
import type { Page } from "./attendance-types";
type Event = {
  id: number;
  version: number;
  event?: string;
  reason: string;
  actor_id: string;
  name: string;
  at: string;
  snapshot: unknown;
};
export function EquipmentHistory({
  siteId,
  id,
  version,
  use,
}: {
  siteId: string;
  id: string;
  version: number;
  use: boolean;
}) {
  const [page, setPage] = useState<Page<Event>>({ items: [], hasMore: false }),
    [offset, setOffset] = useState(0),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    api<Page<Event>>(
      `/sites/${siteId}/${use ? "equipment-uses" : "equipment"}/${id}/events?offset=${offset}`,
    )
      .then((r) => {
        if (active) setPage(r);
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
  }, [siteId, id, version, use, offset]);
  return (
    <section>
      <h2>변경 당시 기록</h2>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {loading ? (
        <p>이력 조회 중…</p>
      ) : (
        <ol>
          {page.items.map((v) => (
            <li key={v.id}>
              v{v.version} · {v.event || "사용기록 변경"} · {v.name} (
              {v.actor_id}) · {v.at}
              <p>{v.reason}</p>
              <details>
                <summary>당시 전체 저장값</summary>
                <pre>{JSON.stringify(v.snapshot, null, 2)}</pre>
              </details>
            </li>
          ))}
        </ol>
      )}
      <button
        disabled={loading || offset === 0}
        onClick={() => setOffset(offset - 50)}
      >
        이전 50
      </button>
      <button
        disabled={loading || !page.hasMore}
        onClick={() => setOffset(offset + 50)}
      >
        다음 50
      </button>
    </section>
  );
}
