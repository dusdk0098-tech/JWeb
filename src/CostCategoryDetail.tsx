import { useEffect, useState } from "react";
import { api } from "./api";
import type { Page } from "./attendance-types";
import { won, type CostExpense, type CostPeriod } from "./cost-types";
// Read-only "항목별 상세" view of the original PEDIT-SC app: one category's active rows this month.
export function CostCategoryDetail({
  base,
  period,
  onClose,
}: {
  base: string;
  period: CostPeriod;
  onClose: () => void;
}) {
  const [categoryId, setCategoryId] = useState(period.categories[0].id),
    [offset, setOffset] = useState(0),
    [page, setPage] = useState<Page<CostExpense>>({ items: [], hasMore: false }),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    api<Page<CostExpense>>(
      `${base}/expenses?offset=${offset}&categoryId=${encodeURIComponent(categoryId)}`,
    )
      .then((v) => active && setPage(v))
      .catch((e) => active && setError(e.message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [base, categoryId, offset]);
  const selected = period.totals.byCategory.find((c) => c.id === categoryId);
  return (
    <section>
      <button onClick={onClose}>사용내역으로 돌아가기</button>
      <h2>{period.month} 항목별 상세</h2>
      <p>유효 지출만 표시합니다. 읽기 전용입니다.</p>
      <div className="actions">
        {period.totals.byCategory.map((c) => (
          <button
            key={c.id}
            className={c.id === categoryId ? "" : "secondary"}
            aria-pressed={c.id === categoryId}
            onClick={() => {
              setCategoryId(c.id);
              setOffset(0);
            }}
          >
            {c.label} · {won(c.current)}원
          </button>
        ))}
      </div>
      <h3>
        {selected?.label} 사용현황 · 이번 월 {selected ? won(selected.current) : ""}원
      </h3>
      {error && <p role="alert">{error}</p>}
      {loading ? (
        <p>조회 중</p>
      ) : page.items.length ? (
        <table>
          <thead>
            <tr>
              <th>일자</th>
              <th>내역</th>
              <th>수량</th>
              <th>단가</th>
              <th>금액</th>
            </tr>
          </thead>
          <tbody>
            {page.items.map((e) => (
              <tr key={e.id}>
                <td>{e.spend_date}</td>
                <td>{e.description}</td>
                <td>{won(e.quantity)}</td>
                <td>{won(e.unit_price_won)}</td>
                <td>{won(e.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p>금월 사용내역 없음</p>
      )}
      <button disabled={loading || !offset} onClick={() => setOffset((v) => v - 50)}>
        이전 50행
      </button>
      <button disabled={loading || !page.hasMore} onClick={() => setOffset((v) => v + 50)}>
        다음 50행
      </button>
    </section>
  );
}
