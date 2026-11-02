import { EquipmentDuePanel } from "./EquipmentDuePanel";
import { matchesFind, Notice, PageFind, PageHeader } from "./ui";
import { useEffect, useState } from "react";
import { api, type Site, type User } from "./api";
import type { Page } from "./attendance-types";
import type { EquipmentRecord, EquipmentUseRecord } from "./equipment-types";
import { EquipmentEditor } from "./EquipmentEditor";
import { EquipmentUseEditor } from "./EquipmentUseEditor";
type Open =
  | { kind: "equipment"; record: EquipmentRecord | null }
  | {
      kind: "use";
      record: EquipmentUseRecord | null;
      equipment?: EquipmentRecord;
    };
export function EquipmentPanel({
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
  const [dueMode, setDueMode] = useState(false);
  const [tab, setTab] = useState<"equipment" | "uses">("equipment"),
    [filter, setFilter] = useState(""),
    [date, setDate] = useState(""),
    [offset, setOffset] = useState(0),
    [tick, setTick] = useState(0),
    [rows, setRows] = useState<Page<EquipmentRecord>>({
      items: [],
      hasMore: false,
    }),
    [uses, setUses] = useState<Page<EquipmentUseRecord>>({
      items: [],
      hasMore: false,
    }),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [open, setOpen] = useState<Open | null>(null);
  useEffect(() => {
    if (dueMode) return;
    let active = true;
    setLoading(true);
    setError("");
    const path = `/sites/${site.id}/${tab === "equipment" ? "equipment" : "equipment-uses"}?offset=${offset}${tab === "equipment" && filter ? "&status=" + filter : ""}${tab === "uses" && date ? "&date=" + date : ""}`;
    (tab === "equipment"
      ? api<Page<EquipmentRecord>>(path).then((r) => {
          if (active) setRows(r);
        })
      : api<Page<EquipmentUseRecord>>(path).then((r) => {
          if (active) setUses(r);
        })
    )
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [site.id, tab, filter, date, offset, tick, dueMode]);
  useEffect(
    () => () => {
      onDirtyChange(false);
      onBusyChange(false);
    },
    [onDirtyChange, onBusyChange],
  );
  async function view(id: string) {
    if (busy) return;
    setBusy(true);
    onBusyChange(true);
    setError("");
    try {
      if (tab === "equipment")
        setOpen({
          kind: "equipment",
          record: await api<EquipmentRecord>(
            `/sites/${site.id}/equipment/${id}`,
          ),
        });
      else
        setOpen({
          kind: "use",
          record: await api<EquipmentUseRecord>(
            `/sites/${site.id}/equipment-uses/${id}`,
          ),
        });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  }
  const common = {
    site,
    onDirtyChange,
    onBusyChange,
    onClose: () => {
      setOpen(null);
      setTick((t) => t + 1);
    },
  };
  if (dueMode)
    return (
      <EquipmentDuePanel
        site={site}
        onDirtyChange={onDirtyChange}
        onBusyChange={onBusyChange}
        onClose={() => {
          setDueMode(false);
          setTick((v) => v + 1);
        }}
      />
    );
  if (open?.kind === "equipment")
    return (
      <EquipmentEditor
        key={open.record?.id || "new-equipment"}
        {...common}
        initial={open.record}
        onNewUse={(equipment) => {
          setTab("uses");
          setOffset(0);
          setOpen({ kind: "use", record: null, equipment });
        }}
      />
    );
  if (open?.kind === "use")
    return (
      <EquipmentUseEditor
        key={open.record?.id || "new-use"}
        {...common}
        user={user}
        initial={open.record}
        equipment={open.equipment}
      />
    );
  return (
    <>
      <PageHeader level={1} title="장비" />
      <Notice summary="장비 목록과 사용 이력을 기록합니다.">
        장비 식별과 변경/사용 이력만 관리합니다. 안전 판정·작업 허가·보험/검사
        적합성·공학 계산·파일 증빙은 지원하지 않습니다.
      </Notice>
      <div className="actions">
        <button disabled={busy} onClick={() => setDueMode(true)}>
          수기 검사·보험 기한 메모
        </button>
        <button
          disabled={busy}
          onClick={() => {
            setTab("equipment");
            setOffset(0);
          }}
        >
          장비 목록
        </button>
        <button
          disabled={busy}
          onClick={() => {
            setTab("uses");
            setOffset(0);
          }}
        >
          수기 사용기록
        </button>
        {tab === "equipment" && site.role === "manager" && (
          <button
            disabled={busy}
            onClick={() => setOpen({ kind: "equipment", record: null })}
          >
            새 장비 등록
          </button>
        )}
      </div>
      {tab === "equipment" ? (
        <label>
          등록 상태
          <select
            disabled={busy}
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setOffset(0);
            }}
          >
            <option value="">전체</option>
            <option value="active">등록 활성</option>
            <option value="retired">퇴역 기록</option>
          </select>
        </label>
      ) : (
        <>
          <label>
            사용일 필터
            <input
              disabled={busy}
              type="date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                setOffset(0);
              }}
            />
          </label>
          <p>새 사용기록은 장비 목록의 활성 장비를 열어 작성하세요.</p>
        </>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {loading ? (
        <p>불러오는 중…</p>
      ) : (
        <section className="panel">
          <PageFind value={find} onChange={setFind} />
          {tab === "equipment"
            ? rows.items.filter((r) => matchesFind(r, find)).map((r) => (
                <article key={r.id}>
                  <h2>
                    {r.body.name} · {r.body.typeLabel}
                  </h2>
                  <p>
                    {r.body.assetCode || "코드 없음"} ·{" "}
                    {r.status === "active" ? "등록 활성" : "퇴역 기록"}
                  </p>
                  <button disabled={busy} onClick={() => view(r.id)}>
                    장비 열기
                  </button>
                </article>
              ))
            : uses.items.filter((r) => matchesFind(r, find)).map((r) => (
                <article key={r.id}>
                  <h2>{r.equipment_snapshot.body.name}</h2>
                  <p>
                    {r.body.date} · {r.body.location} ·{" "}
                    {r.status === "cancelled" ? "취소" : "수기 기록"}
                  </p>
                  <button disabled={busy} onClick={() => view(r.id)}>
                    사용기록 열기
                  </button>
                </article>
              ))}
          {(tab === "equipment" ? rows.items : uses.items).length === 0 && (
            <p>저장된 기록이 없습니다.</p>
          )}
        </section>
      )}
      <button
        disabled={busy || loading || offset === 0}
        onClick={() => setOffset(offset - 50)}
      >
        이전 50
      </button>
      <button
        disabled={
          busy ||
          loading ||
          !(tab === "equipment" ? rows.hasMore : uses.hasMore)
        }
        onClick={() => setOffset(offset + 50)}
      >
        다음 50
      </button>
    </>
  );
}
