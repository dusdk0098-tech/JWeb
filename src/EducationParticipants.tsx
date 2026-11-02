import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { Worker, Page } from "./attendance-types";
import type { EducationFull, EducationParticipant } from "./education-types";
export function EducationParticipants({
  siteId,
  record,
  editable,
  busy,
  onBusy,
  onUpdated,
  onDirty,
}: {
  siteId: string;
  record: EducationFull;
  editable: boolean;
  busy: boolean;
  onBusy: (v: boolean) => void;
  onUpdated: (v: EducationFull) => void;
  onDirty: (v: boolean) => void;
}) {
  const [workers, setWorkers] = useState<Worker[]>([]),
    [offset, setOffset] = useState(0),
    [more, setMore] = useState(false),
    [loading, setLoading] = useState(true),
    [candidate, setCandidate] = useState(""),
    [selected, setSelected] = useState<EducationParticipant | null>(null),
    [state, setState] = useState<EducationParticipant["state"]>("pending"),
    [minutes, setMinutes] = useState(0),
    [error, setError] = useState("");
  const dirty =
      !!candidate ||
      (!!selected &&
        (state !== selected.state || minutes !== selected.attended_minutes)),
    command = useRef<{ signature: string; key: string } | null>(null);
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    api<Page<Worker>>(`/sites/${siteId}/workers?offset=${offset}`)
      .then((r) => {
        if (active) {
          setWorkers(r.items);
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
  }, [siteId, offset]);
  function select(p: EducationParticipant | null) {
    if (
      busy ||
      (dirty && !window.confirm("저장하지 않은 참여 입력을 버릴까요?"))
    )
      return;
    setCandidate("");
    setSelected(p);
    setState(p?.state || "pending");
    setMinutes(p?.attended_minutes || 0);
    setError("");
  }
  async function run(kind: "add" | "record" | "remove") {
    if (busy) return;
    const id = kind === "add" ? candidate : selected?.worker_id;
    if (!id) return;
    if (
      kind === "remove" &&
      !window.confirm("이 대상의 저장된 참여 기록을 초안에서 제거할까요?")
    )
      return;
    const path = `/sites/${siteId}/education/${record.id}/participants${kind === "add" ? "" : "/" + id}`,
      value =
        kind === "add"
          ? { version: record.version, workerId: id }
          : kind === "record"
            ? { version: record.version, state, attendedMinutes: minutes }
            : { version: record.version },
      signature = JSON.stringify([path, kind, value]);
    if (command.current?.signature !== signature)
      command.current = { signature, key: crypto.randomUUID() };
    onBusy(true);
    setError("");
    try {
      const next = await api<EducationFull>(
        path,
        kind === "add" ? "POST" : kind === "record" ? "PUT" : "DELETE",
        value,
        command.current.key,
      );
      onUpdated(next);
      setCandidate("");
      setSelected(null);
      setState("pending");
      setMinutes(0);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      onBusy(false);
    }
  }
  return (
    <section className="panel">
      <h2>수기 참여 · 시간</h2>
      <p>
        교육 예정 {record.scheduledMinutes}분과 개인 수기 참여시간은 다릅니다.
        출역/TBM·자동 이수 인정 없음. 최대200명, 비활성 명부는 새 추가/참석 기록
        불가.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {editable && (
        <fieldset disabled={busy}>
          <label>
            명부 후보 (자동 참석 아님)
            <select
              value={candidate}
              disabled={loading || !!selected}
              onChange={(e) => setCandidate(e.target.value)}
            >
              <option value="">선택</option>
              {workers
                .filter(
                  (w) =>
                    w.active &&
                    !record.participants.some((p) => p.worker_id === w.id),
                )
                .map((w) => (
                  <option value={w.id} key={w.id}>
                    {w.name} · {w.affiliation} ({w.id})
                  </option>
                ))}
            </select>
          </label>
          <button
            disabled={!candidate || !!selected}
            onClick={() => run("add")}
          >
            미입력 대상으로 추가
          </button>
          <button
            disabled={loading || offset === 0 || !!candidate || !!selected}
            onClick={() => setOffset(offset - 50)}
          >
            이전 50
          </button>
          <button
            disabled={loading || !more || !!candidate || !!selected}
            onClick={() => setOffset(offset + 50)}
          >
            다음 50
          </button>
        </fieldset>
      )}
      <ul>
        {record.participants.map((p) => (
          <li key={p.worker_id}>
            <strong>
              {p.name} · {p.affiliation}
            </strong>{" "}
            ·{" "}
            {
              { pending: "미입력", attended: "수기 참석", absent: "수기 불참" }[
                p.state
              ]
            }{" "}
            · {p.attended_minutes}분
            <p>
              명부 {p.worker_id} · 기록 계정 {p.recorded_by || "—"} ·{" "}
              {p.recorded_at || "—"}
            </p>
            {editable && (
              <button disabled={busy} onClick={() => select(p)}>
                이 대상 참여 수정
              </button>
            )}
          </li>
        ))}
      </ul>
      {editable && selected && (
        <fieldset disabled={busy}>
          <h3>{selected.name} 수기 기록</h3>
          <label>
            참여 상태
            <select
              value={state}
              onChange={(e) => {
                const s = e.target.value as typeof state;
                setState(s);
                if (s !== "attended") setMinutes(0);
              }}
            >
              <option value="pending">미입력</option>
              <option value="attended">담당자 기록 · 참석</option>
              <option value="absent">담당자 기록 · 불참</option>
            </select>
          </label>
          <label>
            개인 수기 참여시간 (분)
            <input
              type="number"
              min={state === "attended" ? 1 : 0}
              max={record.scheduledMinutes}
              step={1}
              disabled={state !== "attended"}
              value={minutes}
              onChange={(e) => setMinutes(Number(e.target.value))}
            />
          </label>
          <button onClick={() => run("record")}>참여 기록 저장</button>
          <button className="secondary" onClick={() => select(null)}>
            참여 입력 닫기
          </button>
          <button className="secondary" onClick={() => run("remove")}>
            대상 제거
          </button>
        </fieldset>
      )}
    </section>
  );
}
