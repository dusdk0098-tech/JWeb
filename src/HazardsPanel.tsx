import { HazardInboxPanel } from "./HazardInboxPanel";
import { matchesFind, Notice, PageFind, PageHeader } from "./ui";
import { useEffect, useState } from "react";
import { api, type Site, type User } from "./api";
import type { Page } from "./attendance-types";
import {
  statusLabel,
  type HazardRecord,
  type HazardStatus,
} from "./hazard-types";
import { HazardEditor } from "./HazardEditor";
export function HazardsPanel({
  site,
  user,
  onDirtyChange,
  onBusyChange,
}: {
  site: Site;
  user: User;
  onDirtyChange: (v: boolean) => void;
  onBusyChange: (v: boolean) => void;
}) {
  const [find, setFind] = useState(""); // 이 페이지에서 찾기 (편의 9): filters the 50 rows already loaded
  const [page, setPage] = useState<Page<HazardRecord>>({
      items: [],
      hasMore: false,
    }),
    [offset, setOffset] = useState(0),
    [filter, setFilter] = useState(""),
    [tick, setTick] = useState(0),
    [loading, setLoading] = useState(true),
    [opening, setOpening] = useState(false),
    [error, setError] = useState(""),
    [open, setOpen] = useState<{ record: HazardRecord | null } | null>(null);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setPage({ items: [], hasMore: false });
    setError("");
    api<Page<HazardRecord>>(
      `/sites/${site.id}/hazards?offset=${offset}${filter ? "&status=" + filter : ""}`,
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
  }, [site.id, offset, filter, tick]);
  useEffect(
    () => () => {
      onDirtyChange(false);
      onBusyChange(false);
    },
    [onDirtyChange, onBusyChange],
  );
  async function view(id: string) {
    if (opening) return;
    setOpening(true);
    onBusyChange(true);
    setError("");
    try {
      setOpen({
        record: await api<HazardRecord>(`/sites/${site.id}/hazards/${id}`),
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOpening(false);
      onBusyChange(false);
    }
  }
  if (open)
    return (
      <HazardEditor
        key={open.record?.id || "new"}
        site={site}
        user={user}
        initial={open.record}
        onDirtyChange={onDirtyChange}
        onBusyChange={onBusyChange}
        onClose={() => {
          setOpen(null);
          setTick((t) => t + 1);
        }}
      />
    );
  return (
    <>
      <PageHeader level={1} title="신고 · 조치">
        {site.role !== "viewer" && (
          <button disabled={opening} onClick={() => setOpen({ record: null })}>
            + 신고 초안
          </button>
        )}
      </PageHeader>
      <HazardInboxPanel site={site} disabled={opening} onOpen={id => void view(id)} />
      <section className="panel">
        <Notice tone="warning" summary="긴급 상황은 현장의 실제 대응 절차를 따르세요.">
          기록상 종결은 실제 위험 제거·작업 안전을 보증하지 않습니다. 긴급
          상황은 현장의 실제 대응 절차를 따르세요. 신고 초안의 PNG/JPEG 원본은 미검사 다운로드 전용이며 미리보기·위험 점수/등급 평가는 지원하지 않습니다.
        </Notice>
        <label>
          신고 상태 필터
          <select
            value={filter}
            disabled={opening}
            onChange={(e) => {
              setFilter(e.target.value);
              setOffset(0);
            }}
          >
            <option value="">전체</option>
            {Object.entries(statusLabel).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {loading ? (
          <p>불러오는 중…</p>
        ) : (
          <>
          <PageFind value={find} onChange={setFind} />
          <ul className="meeting-list">
            {page.items.filter((r) => matchesFind(r, find)).map((r) => (
              <li key={r.id}>
                <button
                  className="record"
                  disabled={opening}
                  onClick={() => view(r.id)}
                >
                  <span>
                    <small>
                      {r.body.observedDate} ·{" "}
                      {statusLabel[r.status as HazardStatus]}
                    </small>
                    <strong>{r.body.title}</strong>
                    <small>
                      {r.body.location}
                    </small>
                  </span>
                  <span>열기 →</span>
                </button>
              </li>
            ))}
          </ul>
          </>
        )}
        <div className="form-actions">
          <button
            className="secondary"
            disabled={loading || opening || offset === 0}
            onClick={() => setOffset(offset - 50)}
          >
            이전 50
          </button>
          <span>{offset / 50 + 1} 페이지</span>
          <button
            className="secondary"
            disabled={loading || opening || !page.hasMore}
            onClick={() => setOffset(offset + 50)}
          >
            다음 50
          </button>
        </div>
      </section>
    </>
  );
}
