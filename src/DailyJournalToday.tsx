import { useEffect, useState } from "react";
import { api } from "./api";
import { Section } from "./ui";
type Counts = { inspections: number; planned: number; elapsed: number; followupsLate: number; followupsToday: number; followupsMore: boolean };
// 일지 재설계 A안 1·2단계: read-only counts from existing registers for the journal date. TBM/신고 have no date filter, so they are not counted.
export function DailyJournalToday({ siteId, date }: { siteId: string; date: string }) {
  const [counts, setCounts] = useState<Counts | null>(null), [error, setError] = useState("");
  useEffect(() => {
    if (!date) return;
    let active = true;
    setCounts(null);
    setError("");
    const s = `/sites/${siteId}`;
    Promise.all([
      api<{ total: number }>(`${s}/inspection-register?from=${date}&to=${date}`),
      api<{ total: number }>(`${s}/inspection-task-register?asOfDate=${date}&from=${date}&to=${date}`),
      api<{ total: number }>(`${s}/inspection-task-register?asOfDate=${date}&due=elapsed`),
      api<{ items: { due: string }[]; hasMore: boolean }>(`${s}/minutes-followups?open=1`),
    ])
      .then(([records, planned, elapsed, followups]) => active && setCounts({
        inspections: records.total, planned: planned.total, elapsed: elapsed.total,
        followupsLate: followups.items.filter((f) => f.due < date).length,
        followupsToday: followups.items.filter((f) => f.due === date).length,
        followupsMore: followups.hasMore,
      }))
      .catch((e) => active && setError(e.message));
    return () => {
      active = false;
    };
  }, [siteId, date]);
  return (
    <>
      <Section no={2} level={3} title={`오늘 현장 요약 (${date || "날짜 선택"})`}>
        {error && <p role="alert">{error} 요약을 불러오지 못해도 일지 입력은 계속할 수 있습니다.</p>}
        {!date ? <p>일지 날짜를 고르면 요약합니다.</p> : !counts ? !error && <p>조회 중</p> : (
          <ul>
            <li>이 날짜 기록일 점검 {counts.inspections}건</li>
            <li>이 날짜 예정 점검 일정 {counts.planned}건</li>
          </ul>
        )}
      </Section>
      {counts && (
        <Section no={3} level={3} title="미완료 확인">
          <ul>
            <li>예정일이 지났는데 수락되지 않은 점검 일정 {counts.elapsed}건 (자체 양식 · 점검에서 처리)</li>
            <li>기한이 지난 회의 후속조치 {counts.followupsLate}건{counts.followupsMore ? " 이상" : ""}, 이 날짜 기한 {counts.followupsToday}건 (회의록 후속조치 보드에서 처리)</li>
          </ul>
          <p className="muted">숫자는 각 기록의 현재 상태를 읽은 것이며 일지에 자동으로 넣지 않습니다. TBM·신고는 날짜별 조회가 없어 세지 않습니다.</p>
        </Section>
      )}
    </>
  );
}
