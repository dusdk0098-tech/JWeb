import { useEffect, useState } from "react";
import { api } from "./api";
import type { Page } from "./attendance-types";
type Event = {
  id: number;
  version: number;
  event: string;
  actor_id: string;
  name: string;
  at: string;
  reason: string;
};
const labels: Record<string, string> = {
  created: "초안/후속 생성",
  updated: "초안 저장",
  published: "게시",
  withdrawn: "철회",
  superseded: "후속으로 대체",
};
export function NoticeHistory({
  siteId,
  id,
  version,
}: {
  siteId: string;
  id: string;
  version: number;
}) {
  const [page, setPage] = useState<Page<Event>>({ items: [], hasMore: false }),
    [offset, setOffset] = useState(0),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    api<Page<Event>>(`/sites/${siteId}/notices/${id}/events?offset=${offset}`)
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
  }, [siteId, id, version, offset]);
  return (
    <section>
      <h2>공지 관리자 처리 이력</h2>
      <p>
        계정·시각·처리 사유 이력입니다. 저장할 때마다 초안의 전체 내용을
        보관하는 기능은 아닙니다. 게시 원문은 별도 보존됩니다.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {loading ? (
        <p>이력 조회 중…</p>
      ) : (
        <ol>
          {page.items.map((e) => (
            <li key={e.id}>
              v{e.version} · {labels[e.event] || e.event} · {e.name} (
              {e.actor_id}) · {e.at}
              <p>{e.reason}</p>
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
