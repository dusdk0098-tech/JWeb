import { CostOutputControl } from "./CostOutputControl";
import { CostEvidenceComparison } from "./CostEvidenceComparison";
import { useEffect, useState } from "react";
import { api } from "./api";
import type { Page } from "./attendance-types";
type Event = {
  id: string;
  version: number;
  event: string;
  actor_name: string;
  at: string;
  reason: string;
  data: unknown;
};
type Closure = { id: string; number: number; hash: string; closed_at: string };
export function CostHistory({ base, tick, disabled=false }: { base: string; tick: number; disabled?:boolean }) {
  const [kind, setKind] = useState<"events" | "closures">("events"),
    [offset, setOffset] = useState(0),
    [page, setPage] = useState<Page<Event | Closure>>({
      items: [],
      hasMore: false,
    }),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    api<Page<Event | Closure>>(`${base}/${kind}?offset=${offset}`)
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
  }, [base, kind, offset, tick]);
  return (
    <section>
      <h3>이력 (관리자 전용)</h3>
      <button
        disabled={loading}
        onClick={() => {
          setKind(kind === "events" ? "closures" : "events");
          setOffset(0);
        }}
      >
        {kind === "events" ? "과거 마감본 보기" : "변경 이력 보기"}
      </button>
      {error && <p role="alert">{error}</p>}
      {loading ? (
        <p>조회 중</p>
      ) : (
        page.items.map((row) =>
          "event" in row ? (
            <details key={row.id}>
              <summary>
                v{row.version} {row.event} · {row.actor_name} · {row.at}
              </summary>
              <p>{row.reason}</p>
              <pre>{JSON.stringify(row.data, null, 2)}</pre>
            </details>
          ) : (
            <div key={row.id}>
              <a
                href={"/api" + base + "/closures/" + row.id + "/print"}
                target="_blank"
                rel="noreferrer"
              >
                마감본 {row.number} · {row.closed_at}
              </a>{" "}
              · 해시 {row.hash} · <a href={"/api" + base + "/evidence/closures/" + row.id + "/print"} target="_blank" rel="noreferrer">고정 증빙 참조 목록 (과거 미기록 구분)</a>
              <CostOutputControl key={`${base}:${row.id}:${tick}:${disabled}`} base={base} selection={{closureId:row.id}} disabled={disabled} />
              <CostEvidenceComparison key={`${base}:${row.id}:${tick}`} base={base} selection={{ closureId: row.id }} />
            </div>
          ),
        )
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
