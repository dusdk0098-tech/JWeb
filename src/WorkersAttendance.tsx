import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "./ui";
import type { Site } from "./api";
import { WorkersPanel } from "./WorkersPanel";
import { AttendancePanel } from "./AttendancePanel";
export function WorkersAttendance({
  site,
  initialTab,
  onDirtyChange,
  onBusyChange,
}: {
  site: Site;
  initialTab?: "attendance" | "workers";
  onDirtyChange: (dirty: boolean) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [tab, setTab] = useState<"attendance" | "workers">(initialTab ?? "attendance");
  const [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false);
  const updateDirty = useCallback(
    (value: boolean) => {
      setDirty(value);
      onDirtyChange(value);
    },
    [onDirtyChange],
  );
  const updateBusy = useCallback(
    (value: boolean) => {
      setBusy(value);
      onBusyChange(value);
    },
    [onBusyChange],
  );
  useEffect(
    () => () => {
      onDirtyChange(false);
      onBusyChange(false);
    },
    [onDirtyChange, onBusyChange],
  );
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty || busy) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, busy]);
  function navigate(next: typeof tab) {
    if (next === tab || busy) return;
    if (
      dirty &&
      !window.confirm("저장하지 않은 명부/출역 입력을 버리고 이동할까요?")
    )
      return;
    updateDirty(false);
    setTab(next);
  }
  return (
    <>
      <div className="page-heading">
        <PageHeader level={1} title="명부 · 출역" />
        <div className="form-actions">
          <button
            disabled={busy}
            className={tab === "attendance" ? "" : "secondary"}
            onClick={() => navigate("attendance")}
          >
            출역 현황
          </button>
          <button
            disabled={busy}
            className={tab === "workers" ? "" : "secondary"}
            onClick={() => navigate("workers")}
          >
            근로자 · 방문자 명부
          </button>
        </div>
      </div>
      {tab === "workers" ? (
        <WorkersPanel
          site={site}
          onDirtyChange={updateDirty}
          onBusyChange={updateBusy}
        />
      ) : (
        <AttendancePanel
          site={site}
          onDirtyChange={updateDirty}
          onBusyChange={updateBusy}
        />
      )}
    </>
  );
}
