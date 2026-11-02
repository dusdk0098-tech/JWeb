import { useEffect, useState, useRef } from "react";
import { EmptyState, Notice, PageHeader, StatusChip } from "./ui";
import { api, type Site, type User } from "./api";
import type { Page } from "./attendance-types";
import { WorkPlanEditor } from "./WorkPlanEditor";
import {
  workPlanWarning,
  type WorkPlan,
  type WorkPlanListItem,
} from "./work-plan-types";
export function WorkPlanPanel({
  site,
  openId,
  user,
  onDirtyChange,
  onBusyChange,
}: {
  site: Site;
  openId?: string;
  user: User;
  onDirtyChange: (v: boolean) => void;
  onBusyChange: (v: boolean) => void;
}) {
  const [page, setPage] = useState<Page<WorkPlanListItem>>({
      items: [],
      hasMore: false,
    }),
    [offset, setOffset] = useState(0),
    [tick, setTick] = useState(0),
    [record, setRecord] = useState<WorkPlan | null | undefined>(undefined),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setLoading(true);
    api<Page<WorkPlanListItem>>(`/sites/${site.id}/work-plans?offset=${offset}`)
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
  }, [site.id, offset, tick]);
  async function view(id: string) {
    setBusy(true);
    onBusyChange(true);
    setError("");
    try {
      setRecord(await api<WorkPlan>(`/sites/${site.id}/work-plans/${id}`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  }
  // 검토 F15: the home screen names a record to open
  const openedFromHome = useRef<string | null>(null);
  useEffect(() => { if (openId && openedFromHome.current !== openId) { openedFromHome.current = openId; void view(openId); } }, [openId]);
  if (record !== undefined)
    return (
      <WorkPlanEditor
        key={record?.id || "new"}
        site={site}
        user={user}
        initial={record}
        onDirtyChange={onDirtyChange}
        onBusyChange={onBusyChange}
        onRevision={setRecord}
        onClose={() => {
          setRecord(undefined);
          setTick((v) => v + 1);
        }}
      />
    );
  return (
    <section className="panel">
      <PageHeader level={1} title="작업계획">
        {site.role !== "viewer" && (
          <button disabled={busy} onClick={() => setRecord(null)}>
            일반 작업계획 초안 작성
          </button>
        )}
      </PageHeader>
      <Notice summary="직접 쓰는 작업계획서입니다. 작업허가나 공학 검토가 아닙니다.">{workPlanWarning}</Notice>
      {error && <p role="alert">{error}</p>}
      {loading ? (
        <p>조회 중</p>
      ) : (
        page.items.map((r) => (
          <article key={r.id} className="record-row">
            <div className="record-row-main">
              <h2>{r.body.title || "제목 없음"}</h2>
              <p>{r.body.date} {r.body.startTime}~{r.body.endTime}</p>
            </div>
            {r.status === "archived" ? <StatusChip tone="done">확정</StatusChip> : <StatusChip tone="draft">작성 중</StatusChip>}
            <button className="secondary" disabled={busy} onClick={() => void view(r.id)}>
              작업계획 열기
            </button>
          </article>
        ))
      )}
      {!loading && !error && !page.items.length && <EmptyState title="작업계획 없음">일반 작업계획 초안 작성으로 시작하세요.</EmptyState>}
      <div className="actions">
        <button className="secondary" disabled={busy || loading || !offset} onClick={() => setOffset((v) => v - 50)}>
          이전 50
        </button>
        <button className="secondary" disabled={busy || loading || !page.hasMore} onClick={() => setOffset((v) => v + 50)}>
          다음 50
        </button>
      </div>
    </section>
  );
}
