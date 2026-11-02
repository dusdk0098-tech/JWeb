import { useEffect, useState, useRef } from "react";
import { EmptyState, Notice, PageHeader, StatusChip } from "./ui";
import { api, type Site, type User } from "./api";
import type { TbmSession, TbmFull } from "./tbm-types";
import type { Page } from "./attendance-types";
import { TbmEditor } from "./TbmEditor";
export function TbmPanel({
  site,
  openId,
  user,
  onDirtyChange,
  onBusyChange,
}: {
  site: Site;
  openId?: string;
  user: User;
  onDirtyChange: (dirty: boolean) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [rows, setRows] = useState<TbmSession[]>([]),
    [more, setMore] = useState(false),
    [offset, setOffset] = useState(0),
    [tick, setTick] = useState(0),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [open, setOpen] = useState<{ record: TbmFull | null } | null>(null),
    [opening, setOpening] = useState(false);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setRows([]);
    setError("");
    api<Page<TbmSession>>(`/sites/${site.id}/tbm?offset=${offset}`)
      .then((r) => {
        if (active) {
          setRows(r.items);
          setMore(r.hasMore);
        }
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
  }, [site.id, offset, tick]);
  useEffect(
    () => () => {
      onDirtyChange(false);
      onBusyChange(false);
    },
    [onDirtyChange, onBusyChange],
  );
  async function openRecord(id: string) {
    if (opening) return;
    setOpening(true);
    onBusyChange(true);
    setError("");
    try {
      setOpen({ record: await api<TbmFull>(`/sites/${site.id}/tbm/${id}`) });
    } catch (e) {
      if (open) throw e;
      setError((e as Error).message);
    } finally {
      setOpening(false);
      onBusyChange(false);
    }
  }
  // 검토 F15: the home screen names a record to open
  const openedFromHome = useRef<string | null>(null);
  useEffect(() => { if (openId && openedFromHome.current !== openId) { openedFromHome.current = openId; void openRecord(openId); } }, [openId]);
  if (open)
    return (
      <TbmEditor
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
        onOpen={openRecord}
        onRevision={(next) => setOpen({ record: next })}
      />
    );
  return (
    <>
      <section className="panel">
        <PageHeader level={1} title="TBM 기록">
          {site.role !== "viewer" && (
            <button disabled={opening} onClick={() => setOpen({ record: null })}>
              + TBM 초안
            </button>
          )}
        </PageHeader>
        <Notice summary="참여는 담당자가 사람마다 직접 기록합니다.">
          출역을 TBM 참여로 자동 처리하지 않습니다. 기록 확정은 신원
          확인·서명·법정 교육 이수 인증이 아닙니다.
        </Notice>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {loading ? (
          <p>불러오는 중…</p>
        ) : (
          rows.map((r) => (
            <article key={r.id} className="record-row">
              <div className="record-row-main">
                <h2>{r.body.title}</h2>
                <p>{r.body.date}</p>
              </div>
              {r.status === "draft"
                ? <StatusChip tone="draft">{r.parent_id ? "정정 초안" : "작성 중"}</StatusChip>
                : <StatusChip tone="done">확정</StatusChip>}
              <button className="secondary" disabled={opening} onClick={() => openRecord(r.id)}>
                열기
              </button>
            </article>
          ))
        )}
        {!loading && !error && !rows.length && <EmptyState title="TBM 기록 없음">+ TBM 초안으로 오늘 TBM을 시작하세요.</EmptyState>}
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
            disabled={loading || opening || !more}
            onClick={() => setOffset(offset + 50)}
          >
            다음 50
          </button>
        </div>
      </section>
    </>
  );
}
