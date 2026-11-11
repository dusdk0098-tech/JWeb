import { useEffect, useState } from "react";
import { api, type Site } from "./api";
import { won } from "./cost-types";
type Dashboard = {
  next: string;
  months: { id: string; month: string; status: string; current: string; count: number }[];
  latest: {
    month: string;
    status: string;
    safetyBudgetWon: string | null;
    total: { plan: string; opening: string; current: string; cumulative: string; remaining: string };
    usedPercent: string | null;
    monthsLeft: string | null;
    byCategory: { id: string; label: string; plan: string; opening: string; current: string; cumulative: string; remaining: string; usedPercent: string | null }[];
  } | null;
};
// SC 월마감 대시보드: latest ledger month + monthly usage across all months. Read-only.
export function CostDashboard({ site, onClose }: { site: Site; onClose: () => void }) {
  const [data, setData] = useState<Dashboard | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api<Dashboard>(`/sites/${site.id}/cost-dashboard`)
      .then((v) => active && setData(v))
      .catch((e) => active && setError(e.message));
    return () => {
      active = false;
    };
  }, [site.id]);
  const l = data?.latest,
    max = Math.max(1, ...(data?.months.map((m) => Number(m.current)) ?? [1]));
  return (
    <section>
      <button onClick={onClose}>원장 목록으로 돌아가기</button>
      <h2>월마감 대시보드{l && ` · ${l.month} (${l.status === "open" ? "작성 중" : "마감"})`}</h2>
      {error && <p role="alert">{error}</p>}
      {data && <p className="notice">다음 작업: {data.next}</p>}
      {!data ? (
        <p>조회 중</p>
      ) : !l ? (
        <p>아직 원장이 없습니다.</p>
      ) : (
        <>
          <div className="cards">
            {[
              ["계획금액", won(l.total.plan) + "원"],
              ["전회누계", won(l.total.opening) + "원"],
              ["금월사용", won(l.total.current) + "원"],
              ["잔액", won(l.total.remaining) + "원"],
              ["예상 소진", l.monthsLeft === null ? "계산 불가" : `약 ${l.monthsLeft}개월`],
            ].map(([k, v]) => (
              <article className="panel" key={k}>
                <h3>{k}</h3>
                <p>{v}</p>
              </article>
            ))}
          </div>
          <p>
            계상안전관리비 {l.safetyBudgetWon ? `${won(l.safetyBudgetWon)}원 · 누계 사용비율 ${l.usedPercent}%` : "미입력 — 현장 설정에서 입력하면 사용비율·예상 소진을 계산합니다."}
            {" "}예상 소진은 (계상안전관리비 − 누계) ÷ 사용액이 있는 월의 평균이며 추정치입니다.
          </p>
          <h3>월별 사용액</h3>
          <table>
            <thead>
              <tr>
                <th>월</th>
                <th>금액</th>
                <th>건수</th>
                <th>상태</th>
                <th aria-hidden="true"></th>
              </tr>
            </thead>
            <tbody>
              {data.months.map((m) => (
                <tr key={m.id}>
                  <td>{m.month}</td>
                  <td>{won(m.current)}원</td>
                  <td>{m.count}</td>
                  <td>{m.status === "open" ? "작성 중" : "마감"}</td>
                  <td aria-hidden="true">
                    <div style={{ width: `${(Number(m.current) / max) * 100}%`, minWidth: 2, height: 10, background: "currentColor", opacity: 0.4 }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3>항목별 현황 ({l.month})</h3>
          <table>
            <thead>
              <tr>
                <th>항목</th>
                <th>계획</th>
                <th>전회누계</th>
                <th>금월</th>
                <th>누계</th>
                <th>사용비율</th>
                <th>잔액</th>
              </tr>
            </thead>
            <tbody>
              {l.byCategory.map((c) => (
                <tr key={c.id}>
                  <th>{c.label}</th>
                  <td>{won(c.plan)}</td>
                  <td>{won(c.opening)}</td>
                  <td>{won(c.current)}</td>
                  <td>{won(c.cumulative)}</td>
                  <td>{c.usedPercent === null ? "-" : c.usedPercent + "%"}</td>
                  <td>{won(c.remaining)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
