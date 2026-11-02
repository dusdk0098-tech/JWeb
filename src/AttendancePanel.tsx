import { useEffect, useState } from "react";
import { Notice } from "./ui";
import { api, type Site } from "./api";
import type {
  Attendance,
  AttendanceHistory,
  Worker,
  Page,
} from "./attendance-types";
function AttendanceHistoryView({
  siteId,
  record,
}: {
  siteId: string;
  record: Attendance;
}) {
  const [rows, setRows] = useState<AttendanceHistory[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api<AttendanceHistory[]>(`/sites/${siteId}/attendance/${record.id}/history`)
      .then((r) => {
        if (active) setRows(r);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [siteId, record.id, record.version]);
  return (
    <section aria-label="출역 변경 이력">
      <h3>변경 이력 · {record.name}</h3>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <ol>
        {rows.map((r) => (
          <li key={r.version}>
            v{r.version} · {r.status === "present" ? "출역" : "취소"} ·{" "}
            {r.reason}
            <br />
            <small>
              {r.actor_name} · {r.at} · 담당자 수기
            </small>
          </li>
        ))}
      </ol>
    </section>
  );
}
export function AttendancePanel({
  site,
  onDirtyChange,
  onBusyChange,
}: {
  site: Site;
  onDirtyChange: (dirty: boolean) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [date, setDate] = useState(new Date().toLocaleDateString("en-CA")),
    [affiliation, setAffiliation] = useState(""),
    [offset, setOffset] = useState(0),
    [tick, setTick] = useState(0),
    [page, setPage] = useState<
      Page<Attendance> & {
        summary: { present: number; cancelled: number; recorded: number };
      }
    >({
      items: [],
      hasMore: false,
      summary: { present: 0, cancelled: 0, recorded: 0 },
    }),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [search, setSearch] = useState(""),
    [workers, setWorkers] = useState<Worker[]>([]),
    [workerOffset, setWorkerOffset] = useState(0),
    [workerMore, setWorkerMore] = useState(false),
    [workerLoading, setWorkerLoading] = useState(false),
    [workerError, setWorkerError] = useState(""),
    [chosen, setChosen] = useState<Worker | null>(null),
    [key, setKey] = useState(crypto.randomUUID());
  const [edit, setEdit] = useState<Attendance | null>(null),
    [status, setStatus] = useState<Attendance["status"]>("cancelled"),
    [reason, setReason] = useState(""),
    [editKey, setEditKey] = useState(crypto.randomUUID()),
    [history, setHistory] = useState<Attendance | null>(null);
  const dirty = !!edit || !!chosen;
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
  useEffect(() => onBusyChange(busy), [busy, onBusyChange]);
  function mayDiscard() {
    return !edit || window.confirm("저장하지 않은 정정 입력을 버릴까요?");
  }
  const filter = `date=${encodeURIComponent(date)}&affiliation=${encodeURIComponent(affiliation)}`;
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setPage({
      items: [],
      hasMore: false,
      summary: { present: 0, cancelled: 0, recorded: 0 },
    });
    api<typeof page>(`/sites/${site.id}/attendance?${filter}&offset=${offset}`)
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
  }, [site.id, filter, offset, tick]);
  useEffect(() => {
    if (site.role === "viewer") return;
    let active = true;
    setWorkerLoading(true);
    setWorkerError("");
    api<Page<Worker>>(
      `/sites/${site.id}/workers?active=true&search=${encodeURIComponent(search)}&offset=${workerOffset}`,
    )
      .then((r) => {
        if (active) {
          setWorkers(r.items);
          setWorkerMore(r.hasMore);
        }
      })
      .catch((e) => {
        if (active) setWorkerError(e.message);
      })
      .finally(() => {
        if (active) setWorkerLoading(false);
      });
    return () => {
      active = false;
    };
  }, [site.id, site.role, search, workerOffset, tick]);
  async function register() {
    if (!chosen || busy) return;
    setBusy(true);
    setError("");
    try {
      await api(
        `/sites/${site.id}/attendance`,
        "POST",
        { workerId: chosen.id, date },
        key,
      );
      setChosen(null);
      setKey(crypto.randomUUID());
      setTick((t) => t + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function correct(e: React.FormEvent) {
    e.preventDefault();
    if (!edit || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<Attendance>(
        `/sites/${site.id}/attendance/${edit.id}`,
        "PUT",
        { version: edit.version, status, reason },
        editKey,
      );
      setEdit(null);
      setReason("");
      setHistory(result);
      setTick((t) => t + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <h2>수기 출역 현황</h2>
      <Notice summary="잘못 입력했다면 취소 사유를 남기고 새로 등록하세요.">
        담당자의 대리 입력입니다. 본인 확인·전자서명·교육/TBM 이수로 처리하지
        않습니다. 날짜·대상을 잘못 입력했다면 취소 사유를 남기고 올바른 기록을
        새로 등록하세요.
      </Notice>
      <fieldset disabled={busy || !!edit}>
        <div className="grid">
          <label>
            출역 날짜
            <input
              type="date"
              required
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                setOffset(0);
                setHistory(null);
                setKey(crypto.randomUUID());
              }}
            />
          </label>
          <label>
            소속 필터 · 정확히 일치
            <input
              maxLength={100}
              placeholder="비우면 전체 소속"
              value={affiliation}
              onChange={(e) => {
                setAffiliation(e.target.value);
                setOffset(0);
                setHistory(null);
              }}
            />
          </label>
        </div>
      </fieldset>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {loading ? (
        <p>불러오는 중…</p>
      ) : (
        <>
          <p role="status">
            출역 {page.summary.present}명 · 취소 {page.summary.cancelled}건 ·
            전체 {page.summary.recorded}건
          </p>
          <ul className="members">
            {page.items.map((r) => (
              <li key={r.id}>
                <span>
                  <strong>{r.name}</strong> · {r.affiliation}
                  <small>
                    {r.status === "present" ? "출역" : "취소"} ·{" "}
                    {r.kind === "worker" ? "근로자" : "방문자"} · v{r.version} ·
                    담당자 수기
                  </small>
                  <small>{r.reason}</small>
                </span>
                <span className="attendance-controls">
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={() => setHistory(r)}
                  >
                    이력
                  </button>
                  {site.role !== "viewer" && (
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy}
                      onClick={() => {
                        if (!mayDiscard()) return;
                        setEdit(r);
                        setStatus(
                          r.status === "present" ? "cancelled" : "present",
                        );
                        setReason("");
                        setEditKey(crypto.randomUUID());
                      }}
                    >
                      정정 / 취소
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="form-actions">
        <button
          className="secondary"
          disabled={loading || offset === 0 || busy}
          onClick={() => setOffset(offset - 50)}
        >
          이전 50
        </button>
        <span>{offset / 50 + 1} 페이지</span>
        <button
          className="secondary"
          disabled={loading || !page.hasMore || busy}
          onClick={() => setOffset(offset + 50)}
        >
          다음 50
        </button>
        <button
          className="secondary"
          disabled={loading || busy}
          onClick={() => setTick((t) => t + 1)}
        >
          출역 새로고침
        </button>
        {date && (
          <a
            className="button secondary"
            href={`/api/sites/${site.id}/attendance/print?${filter}`}
            target="_blank"
            rel="noreferrer"
          >
            출역 현황 인쇄 / PDF
          </a>
        )}
      </div>
      <p className="muted">
        합계와 인쇄는 선택 날짜/소속의 전체 기록 기준입니다. 취소 건은 출역
        인원에 포함하지 않습니다. 이름/소속/구분은 최초 등록 당시 값입니다.
      </p>
      {history && (
        <AttendanceHistoryView
          key={history.id + history.version}
          siteId={site.id}
          record={history}
        />
      )}{" "}
      {edit && (
        <form onSubmit={correct}>
          <h3>
            출역 정정 · {edit.name} · {edit.date}
          </h3>
          <fieldset disabled={busy}>
            <label>
              변경 상태
              <select
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value as Attendance["status"]);
                  setEditKey(crypto.randomUUID());
                }}
              >
                <option value="present">출역</option>
                <option value="cancelled">취소</option>
              </select>
            </label>
            <label>
              정정 / 취소 사유 *
              <textarea
                required
                maxLength={500}
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  setEditKey(crypto.randomUUID());
                }}
              />
            </label>
            <div className="form-actions">
              <button>정정 저장</button>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  if (mayDiscard()) setEdit(null);
                }}
              >
                정정 닫기
              </button>
            </div>
          </fieldset>
        </form>
      )}
      {site.role !== "viewer" && !edit && (
        <section>
          <h3>출역 수기 등록</h3>
          <label>
            등록 대상 검색
            <input
              maxLength={100}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setWorkerOffset(0);
              }}
            />
          </label>
          {workerError && (
            <p className="error" role="alert">
              {workerError}
            </p>
          )}
          {workerLoading ? (
            <p>명부 조회 중…</p>
          ) : (
            <ul className="worker-choices">
              {workers.map((w) => (
                <li key={w.id}>
                  <button
                    type="button"
                    disabled={busy}
                    className={chosen?.id === w.id ? "" : "secondary"}
                    onClick={() => {
                      setChosen(w);
                      setKey(crypto.randomUUID());
                    }}
                  >
                    {w.name} · {w.affiliation} ·{" "}
                    {w.kind === "worker" ? "근로자" : "방문자"}
                    <small>ID {w.id}</small>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="form-actions">
            <button
              className="secondary"
              disabled={workerOffset === 0 || workerLoading}
              onClick={() => setWorkerOffset(workerOffset - 50)}
            >
              이전 50
            </button>
            <button
              className="secondary"
              disabled={!workerMore || workerLoading}
              onClick={() => setWorkerOffset(workerOffset + 50)}
            >
              다음 50
            </button>
          </div>
          <p>
            선택:{" "}
            {chosen
              ? `${chosen.name} / ${chosen.affiliation} / ${chosen.id}`
              : "없음"}{" "}
            · 등록일 {date}
          </p>
          <button disabled={busy || !chosen || !date} onClick={register}>
            {busy ? "저장 중…" : "선택 대상 수기 출역 등록"}
          </button>
        </section>
      )}
    </section>
  );
}
