import { DailyMonthlyReport } from "./DailyMonthlyReport";
import { EmptyState, Notice, PageHeader, StatusChip } from "./ui";
import { useEffect, useState, useRef } from "react";
import { api, type Site, type User } from "./api";
import type { Page } from "./attendance-types";
import type { DailyJournal } from "./daily-journal-types";
import { DailyJournalEditor } from "./DailyJournalEditor";
type RegisterItem = { id:string; date:string; status:"draft"|"archived"; version:number; parent_id:string|null; workSummary:string; workLocations:string };
export function DailyJournalPanel({
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
  const [items, setItems] = useState<Page<RegisterItem> & {total?:number}>({
      items: [],
      hasMore: false,
    }),
    [date, setDate] = useState(""),
    [toDate, setToDate] = useState(""),
    [status, setStatus] = useState(""),
    [query, setQuery] = useState(""),
    [monthly, setMonthly] = useState(false),
    [month, setMonth] = useState(() =>
      new Date().toLocaleDateString("en-CA").slice(0, 7),
    ),
    [offset, setOffset] = useState(0),
    [tick, setTick] = useState(0),
    [open, setOpen] = useState<DailyJournal | null | undefined>(undefined),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (monthly) return;
    let active = true;
    setLoading(true);
    setError("");
    api<Page<RegisterItem> & {total?:number}>(
      `/sites/${site.id}/daily-journal-register?offset=${offset}${date ? "&from=" + date : ""}${toDate ? "&to=" + toDate : ""}${status ? "&status=" + status : ""}&q=${encodeURIComponent(query)}`,
    )
      .then((v) => {
        if (active) setItems(v);
      })
      .catch((e) => {
        if (active) {
          setError(e.message);
          setItems({ items: [], hasMore: false });
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [site.id, date, toDate, status, query, offset, tick, monthly]);
  async function view(id: string) {
    if (busy) return;
    setBusy(true);
    onBusyChange(true);
    setError("");
    try {
      setOpen(
        await api<DailyJournal>(`/sites/${site.id}/daily-journals/${id}`),
      );
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
  if (open !== undefined)
    return (
      <DailyJournalEditor
        key={open?.id || "new"}
        site={site}
        user={user}
        initial={open}
        onDirtyChange={onDirtyChange}
        onBusyChange={onBusyChange}
        onRevision={setOpen}
        onClose={() => {
          setOpen(undefined);
          setTick((v) => v + 1);
        }}
      />
    );
  if (monthly)
    return (
      <DailyMonthlyReport
        site={site}
        month={month}
        onMonth={(v) => {
          setError("");
          setMonth(v);
        }}
        onOpen={(id) => void view(id)}
        onClose={() => setMonthly(false)}
        busy={busy}
        parentError={error}
        onDirtyChange={onDirtyChange}
        onBusyChange={onBusyChange}
      />
    );
  return (
    <section className="panel">
      <PageHeader level={1} title="안전업무일지">
        <button
          className="secondary"
          disabled={busy}
          onClick={() => {
            setError("");
            setMonthly(true);
          }}
        >
          월간 보관 일지 조회
        </button>
        {site.role !== "viewer" && (
          <button disabled={busy} onClick={() => setOpen(null)}>
            새 안전업무일지
          </button>
        )}
      </PageHeader>
      <Notice summary="날짜마다 일지 하나. 보관한 뒤 고칠 때는 정정 초안을 새로 씁니다.">
        현장·선택 날짜별 최초 일지 하나, 보관 이후 정정은 새 초안입니다.
        작업/순찰 기록은 실제 안전·고용/임금·법적 승인이나 서명이 아닙니다.
      </Notice>
      <details className="filter-fold" open={!!(items.items.length || date || toDate || status || query || loading)}>
        <summary>검색 조건</summary>
      <div className="filter-bar">
        <label>
          일지 날짜 시작
          <input
            type="date"
            disabled={busy}
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setOffset(0);
            }}
          />
        </label>
        <label>일지 날짜 끝 <input type="date" disabled={busy} value={toDate} onChange={e=>{setToDate(e.target.value);setOffset(0);}}/></label>
        <label>기록 상태 <select disabled={busy} value={status} onChange={e=>{setStatus(e.target.value);setOffset(0);}}><option value="">모든 버전</option><option value="draft">초안</option><option value="archived">보관</option></select></label>
        <label>작업 요약·장소·관찰 문자 검색 <input maxLength={200} disabled={busy} value={query} onChange={e=>{setQuery(e.target.value);setOffset(0);}}/></label>
        <button
          className="secondary"
          disabled={busy}
          onClick={() => {
            setDate("");
            setToDate("");
            setStatus("");
            setQuery("");
            setOffset(0);
          }}
        >
          검색 조건 초기화
        </button>
      </div>
      </details>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {!loading && !error && (
        <Notice summary={`검색 결과 ${items.total ?? 0}개`}>
          제목 필드는 없습니다. 과거 정정본도 검색하며 검색 조건은 월간 전체 달력 조회를 제한하지 않습니다. 페이지 사이 기록이 바뀔 수 있습니다.
        </Notice>
      )}
      {loading ? (
        <p>불러오는 중…</p>
      ) : (
        items.items.map((j) => (
          <article key={j.id} className="record-row">
            <div className="record-row-main">
              <h2>{j.date} · {j.status === "archived" ? "확정" : "초안"}</h2>
              <p>{j.workSummary.slice(0, 200) || "작업 요약 미입력"}</p>
            </div>
            {j.status === "archived" ? <StatusChip tone="done">확정</StatusChip>
              : <StatusChip tone="draft">{j.parent_id ? "정정 초안" : "작성 중"}</StatusChip>}
            <button className="secondary" disabled={busy} onClick={() => void view(j.id)}>
              일지 열기
            </button>
          </article>
        ))
      )}
      {!loading && !error && !items.items.length && <EmptyState title="일지 없음">검색 조건을 바꾸거나 새 일지를 쓰세요.</EmptyState>}
      <div className="actions">
        <button
          className="secondary"
          disabled={busy || loading || !offset}
          onClick={() => setOffset((o) => Math.max(0, o - 50))}
        >
          이전 50
        </button>
        <button
          className="secondary"
          disabled={busy || loading || !items.hasMore}
          onClick={() => setOffset((o) => o + 50)}
        >
          다음 50
        </button>
      </div>
    </section>
  );
}
