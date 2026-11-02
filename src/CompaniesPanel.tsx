import { useEffect, useState } from "react";
import { api, type Site } from "./api";
import { useDraftGuard } from "./useDraftGuard";
import type { Company } from "./company-ppe-types";
import { CompanyPpeHistory } from "./CompanyPpeHistory";
export function CompaniesPanel({
  site,
  onDirtyChange,
  onBusyChange,
}: {
  site: Site;
  onDirtyChange: (v: boolean) => void;
  onBusyChange: (v: boolean) => void;
}) {
  const [page, setPage] = useState<{ items: Company[]; hasMore: boolean }>({
      items: [],
      hasMore: false,
    }),
    [offset, setOffset] = useState(0),
    [tick, setTick] = useState(0),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [selected, setSelected] = useState<Company | null>(null),
    [name, setName] = useState(""),
    [active, setActive] = useState(true),
    [reason, setReason] = useState("");
  const dirty =
      name !== (selected?.name || "") ||
      active !== (selected ? !!selected.active : true) ||
      !!reason,
    guard = useDraftGuard(dirty, busy, onDirtyChange, onBusyChange),
    base = `/sites/${site.id}/companies`;
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError("");
    setPage({ items: [], hasMore: false });
    api<typeof page>(`${base}?offset=${offset}`)
      .then((v) => {
        if (live) setPage(v);
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [base, offset, tick]);
  function choose(row: Company | null) {
    if (!guard.canLeave()) return;
    setSelected(row);
    setName(row?.name || "");
    setActive(row ? !!row.active : true);
    setReason("");
    setError("");
  }
  async function save() {
    if (busy) return;
    setBusy(true);
    setError("");
    const path = selected ? base + "/" + selected.id : base,
      value = selected
        ? { name, active, version: selected.version, reason }
        : { name };
    try {
      const row = await api<Company>(
        path,
        selected ? "PUT" : "POST",
        value,
        guard.key(path, value),
      );
      setSelected(row);
      setName(row.name);
      setActive(!!row.active);
      setReason("");
      setTick((t) => t + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <h2>현장 업체 등록부</h2>
      <p>
        이름이 같아도 별도 UUID로 유지합니다. 사업자등록번호·연락처·법적
        고용관계는 수집/검증하지 않습니다.
      </p>
      {error && (
        <p role="alert">
          {error}
          <button onClick={() => setTick((t) => t + 1)}>목록 다시 조회</button>
        </p>
      )}
      <section className="panel">
        {loading ? (
          <p>조회 중…</p>
        ) : (
          page.items.map((c) => (
            <button key={c.id} disabled={busy} onClick={() => choose(c)}>
              {c.name} · {c.active ? "활성" : "비활성"}
            </button>
          ))
        )}
        <button
          disabled={loading || !offset}
          onClick={() => {
            setLoading(true);
            setOffset((o) => o - 50);
          }}
        >
          이전 50
        </button>
        <button
          disabled={loading || !page.hasMore}
          onClick={() => {
            setLoading(true);
            setOffset((o) => o + 50);
          }}
        >
          다음 50
        </button>
      </section>
      {site.role === "manager" && (
        <form
          className="panel"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <button type="button" disabled={busy} onClick={() => choose(null)}>
            새 업체 입력
          </button>
          <label>
            업체 이름
            <input
              required
              maxLength={200}
              disabled={busy}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          {selected && (
            <>
              <label>
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={active}
                  onChange={(e) => setActive(e.target.checked)}
                />
                현재 활성
              </label>
              <label>
                변경 사유
                <textarea
                  required
                  maxLength={1000}
                  disabled={busy}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
            </>
          )}
          <button disabled={busy}>
            {selected ? "업체 변경 기록" : "업체 등록"}
          </button>
        </form>
      )}
      {selected && (
        <CompanyPpeHistory
          key={selected.id}
          path={base + "/" + selected.id}
          version={selected.version}
        />
      )}
    </>
  );
}
