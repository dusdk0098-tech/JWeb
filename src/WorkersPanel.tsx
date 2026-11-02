import { useEffect, useState } from "react";
import { Notice } from "./ui";
import { api, type Site } from "./api";
import type { Worker, Page } from "./attendance-types";
import { WorkerIdentity } from "./WorkerIdentity";
const empty = {
  name: "",
  affiliation: "",
  kind: "worker" as Worker["kind"],
  active: 1,
};
export function WorkersPanel({
  site,
  onDirtyChange,
  onBusyChange,
}: {
  site: Site;
  onDirtyChange: (dirty: boolean) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [items, setItems] = useState<Worker[]>([]),
    [more, setMore] = useState(false),
    [offset, setOffset] = useState(0),
    [search, setSearch] = useState(""),
    [tick, setTick] = useState(0),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [edit, setEdit] = useState<Worker | null>(null),
    [form, setForm] = useState(empty),
    [key, setKey] = useState(crypto.randomUUID());
  const original = edit
    ? {
        name: edit.name,
        affiliation: edit.affiliation,
        kind: edit.kind,
        active: edit.active,
      }
    : empty;
  const dirty = JSON.stringify(form) !== JSON.stringify(original);
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
  useEffect(() => onBusyChange(busy), [busy, onBusyChange]);
  const [identities, setIdentities] = useState<string[]>([]);
  useEffect(() => {
    if (site.role !== "manager") return;
    let active = true;
    api<{ workerIds: string[] }>(`/sites/${site.id}/worker-identities`).then((v) => active && setIdentities(v.workerIds)).catch(() => {});
    return () => { active = false; };
  }, [site.id, site.role]);
  function mayDiscard() {
    return !dirty || window.confirm("저장하지 않은 명부 입력을 버릴까요?");
  }
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    api<Page<Worker>>(
      `/sites/${site.id}/workers?search=${encodeURIComponent(search)}&offset=${offset}`,
    )
      .then((r) => {
        if (active) {
          setItems(r.items);
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
  }, [site.id, offset, search, tick]);
  function change(next: typeof form) {
    setForm(next);
    setKey(crypto.randomUUID());
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await api(
        `/sites/${site.id}/workers${edit ? "/" + edit.id : ""}`,
        edit ? "PUT" : "POST",
        {
          name: form.name,
          affiliation: form.affiliation,
          kind: form.kind,
          ...(edit ? { active: !!form.active, version: edit.version } : {}),
        },
        key,
      );
      setEdit(null);
      setForm(empty);
      setKey(crypto.randomUUID());
      setTick((t) => t + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <h2>현장 명부</h2>
      <Notice tone="warning" summary="주민등록번호·건강정보·위치·연락처는 넣지 마세요.">
        최소한의 이름·소속·구분만 입력하세요. 동명이인은 별도 ID로 관리하며 다른
        현장과 자동 합치지 않습니다. 주민등록번호·건강정보·위치·연락처를 넣지
        마세요.
      </Notice>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <label>
        명부 검색
        <input
          value={search}
          maxLength={100}
          onChange={(e) => {
            setSearch(e.target.value);
            setOffset(0);
          }}
        />
      </label>
      {loading ? (
        <p>불러오는 중…</p>
      ) : (
        <ul className="members">
          {items.map((w) => (
            <li key={w.id}>
              <span>
                <strong>{w.name}</strong> · {w.affiliation}
                <small>
                  {w.kind === "worker" ? "근로자" : "방문자"} ·{" "}
                  {w.active ? "활성" : "비활성"}
                </small>
              </span>
              {site.role === "manager" && (
                <WorkerIdentity siteId={site.id} workerId={w.id} registered={identities.includes(w.id)}
                  onChange={(v) => setIdentities((old) => (v ? [...old.filter((x) => x !== w.id), w.id] : old.filter((x) => x !== w.id)))} />
              )}
              {site.role === "manager" && (
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => {
                    if (!mayDiscard()) return;
                    setEdit(w);
                    setForm({
                      name: w.name,
                      affiliation: w.affiliation,
                      kind: w.kind,
                      active: w.active,
                    });
                    setKey(crypto.randomUUID());
                  }}
                >
                  명부 수정
                </button>
              )}
            </li>
          ))}
        </ul>
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
          disabled={loading || !more}
          onClick={() => setOffset(offset + 50)}
        >
          다음 50
        </button>
        <button
          className="secondary"
          disabled={loading}
          onClick={() => setTick((t) => t + 1)}
        >
          명부 새로고침
        </button>
      </div>
      {site.role === "manager" ? (
        <form onSubmit={save}>
          <h3>{edit ? "명부 수정" : "명부 신규 등록"}</h3>
          <fieldset disabled={busy}>
            <div className="grid">
              <label>
                이름 *
                <input
                  required
                  maxLength={100}
                  value={form.name}
                  onChange={(e) => change({ ...form, name: e.target.value })}
                />
              </label>
              <label>
                소속 *
                <input
                  required
                  maxLength={100}
                  value={form.affiliation}
                  onChange={(e) =>
                    change({ ...form, affiliation: e.target.value })
                  }
                />
              </label>
              <label>
                구분
                <select
                  value={form.kind}
                  onChange={(e) =>
                    change({ ...form, kind: e.target.value as Worker["kind"] })
                  }
                >
                  <option value="worker">근로자</option>
                  <option value="visitor">방문자</option>
                </select>
              </label>
              {edit && (
                <label>
                  활성 상태
                  <select
                    value={form.active}
                    onChange={(e) =>
                      change({ ...form, active: Number(e.target.value) })
                    }
                  >
                    <option value={1}>활성</option>
                    <option value={0}>비활성 · 신규 출역 불가</option>
                  </select>
                </label>
              )}
            </div>
            <div className="form-actions">
              <button>
                {busy ? "저장 중…" : edit ? "명부 변경 저장" : "명부 등록"}
              </button>
              {edit && (
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    if (!mayDiscard()) return;
                    setEdit(null);
                    setForm(empty);
                    setKey(crypto.randomUUID());
                  }}
                >
                  수정 취소
                </button>
              )}
            </div>
          </fieldset>
          <p className="muted">
            기존 출역의 이름·소속은 등록 당시 값으로 유지됩니다. 삭제 대신
            비활성화하여 기록 연결을 보존합니다.
          </p>
        </form>
      ) : (
        <p className="muted">명부 변경은 현장 관리자만 할 수 있습니다.</p>
      )}
    </section>
  );
}
