import { EducationCatalogPanel } from "./EducationCatalogPanel";
import { matchesFind, Notice, PageFind, PageHeader } from "./ui";
import { useEffect, useState } from "react";
import { api, type Site, type User } from "./api";
import type { EducationSession, EducationFull } from "./education-types";
import type { Page } from "./attendance-types";
import { EducationEditor } from "./EducationEditor";
export function EducationPanel({
  site,
  user,
  onDirtyChange,
  onBusyChange,
}: {
  site: Site;
  user: User;
  onDirtyChange: (dirty: boolean) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [find, setFind] = useState(""); // 이 페이지에서 찾기 (편의 9): filters the 50 rows already loaded
  const [catalogMode, setCatalogMode] = useState(false);
  const [rows, setRows] = useState<EducationSession[]>([]),
    [more, setMore] = useState(false),
    [offset, setOffset] = useState(0),
    [tick, setTick] = useState(0),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [open, setOpen] = useState<{ record: EducationFull | null } | null>(null),
    [opening, setOpening] = useState(false);
  useEffect(() => {
    if (catalogMode) return;
    let active = true;
    setLoading(true);
    setRows([]);
    setError("");
    api<Page<EducationSession>>(`/sites/${site.id}/education?offset=${offset}`)
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
  }, [site.id, offset, tick, catalogMode]);
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
      setOpen({
        record: await api<EducationFull>(`/sites/${site.id}/education/${id}`),
      });
    } catch (e) {
      if (open) throw e;
      setError((e as Error).message);
    } finally {
      setOpening(false);
      onBusyChange(false);
    }
  }
  if (catalogMode)
    return (
      <EducationCatalogPanel
        site={site}
        onDirtyChange={onDirtyChange}
        onBusyChange={onBusyChange}
        onClose={() => {
          setCatalogMode(false);
          setTick((v) => v + 1);
        }}
        onJournal={(r) => {
          setCatalogMode(false);
          setOpen({ record: r });
        }}
      />
    );

  if (open)
    return (
      <EducationEditor
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
      <PageHeader level={1} title="교육일지">
        <button className="secondary" disabled={opening} onClick={() => setCatalogMode(true)}>
          자체 교육내용 카탈로그
        </button>
        {site.role !== "viewer" && (
          <button disabled={opening} onClick={() => setOpen({ record: null })}>
            + 교육일지 초안
          </button>
        )}
      </PageHeader>
      <section className="panel">
        <Notice summary="참여는 담당자가 사람마다 직접 기록합니다.">
          출역을 교육일지 참여로 자동 처리하지 않습니다. 기록 보관은 신원
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
          <>
          <PageFind value={find} onChange={setFind} />
          <ul className="meeting-list">
            {rows.filter((r) => matchesFind(r, find)).map((r) => (
              <li key={r.id}>
                <button
                  className="record"
                  disabled={opening}
                  onClick={() => openRecord(r.id)}
                >
                  <span>
                    <small>
                      {r.body.date} ·{" "}
                      {r.status === "draft"
                        ? "초안"
                        : "확정"}
                    </small>
                    <strong>{r.body.title}</strong>
                    {r.parent_id && <small>정정본</small>}
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
