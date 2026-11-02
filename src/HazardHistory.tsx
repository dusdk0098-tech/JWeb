import { useEffect, useState } from "react";
import { api } from "./api";
import type { Page } from "./attendance-types";
import { statusLabel, type HazardEvent } from "./hazard-types";
const labels: Record<string, string> = {
  created: "초안 생성",
  draft_updated: "초안 수정",
  submitted: "신고 제출",
  assigned: "담당자 배정/변경",
  remediation_submitted: "조치 제출",
  rejected: "보완 반려",
  closed: "기록상 종결",
  reopened: "재개",
};
export function HazardHistory({
  siteId,
  id,
  version,
}: {
  siteId: string;
  id: string;
  version: number;
}) {
  const [page, setPage] = useState<Page<HazardEvent>>({
      items: [],
      hasMore: false,
    }),
    [offset, setOffset] = useState(0),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    api<Page<HazardEvent>>(
      `/sites/${siteId}/hazards/${id}/events?offset=${offset}`,
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
  }, [siteId, id, version, offset]);
  return (
    <section aria-label="신고 변경 이력">
      <h3>시간순 변경 기록</h3>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <p>이력 조회 중…</p>
      ) : (
        <ol className="hazard-history">
          {page.items.map((e) => (
            <li key={e.id}>
              <strong>
                v{e.version} · {labels[e.event] || e.event}
              </strong>
              <p>
                {e.from_status ? statusLabel[e.from_status] : "생성"} →{" "}
                {statusLabel[e.to_status]}
                <br />
                {e.note}
              </p>
              <small>
                {e.actor_name} · 계정 ID {e.actor_id} · {e.at}
              </small>
              <details>
                <summary>당시 기록 내용</summary>
                <p>
                  {e.snapshot.body.title} · {e.snapshot.body.observedDate} ·{" "}
                  {e.snapshot.body.location}
                </p>
                <p>{e.snapshot.body.description}</p>
                <p>
                  담당 계정 ID: {e.snapshot.assignee_id || "미배정"} · 기한:{" "}
                  {e.snapshot.due_date || "—"}
                </p>
                <p>조치 내용: {e.snapshot.remediation || "없음"}</p>
              </details>
            </li>
          ))}
        </ol>
      )}
      <div className="form-actions">
        <button
          className="secondary"
          disabled={loading || offset === 0}
          onClick={() => setOffset(offset - 50)}
        >
          이전 50
        </button>
        <span>{offset / 50 + 1} 페이지</span>
        <button
          className="secondary"
          disabled={loading || !page.hasMore}
          onClick={() => setOffset(offset + 50)}
        >
          다음 50
        </button>
      </div>
    </section>
  );
}
