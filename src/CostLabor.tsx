import { useEffect, useState } from "react";
import { api, type Site } from "./api";
import { won } from "./cost-types";
type LaborPage = {
  items: { id: string; month: string; kind: string; spend_date: string; description: string; quantity: string; amount: string }[];
  hasMore: boolean;
  byKind: { kind: string; amount: string }[];
  total: string;
};
// SC 인건비 조회: all months, filter by month/search, totals per 인건비 구분.
export function CostLabor({ site, onClose }: { site: Site; onClose: () => void }) {
  const [month, setMonth] = useState(""),
    [q, setQ] = useState(""),
    [offset, setOffset] = useState(0),
    [page, setPage] = useState<LaborPage | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    api<LaborPage>(
      `/sites/${site.id}/cost-labor?offset=${offset}&month=${encodeURIComponent(month)}&q=${encodeURIComponent(q)}`,
    )
      .then((v) => active && setPage(v))
      .catch((e) => active && setError(e.message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [site.id, month, q, offset]);
  return (
    <section>
      <button onClick={onClose}>원장 목록으로 돌아가기</button>
      <h2>인건비 조회 · 합계 {page ? won(page.total) : "-"}원</h2>
      <p>지출에 인건비 구분을 지정한 유효 행만 모읍니다. 구분이 없는 지출은 포함하지 않습니다.</p>
      <label>
        월 (비우면 전체 월)
        <input type="month" value={month} onChange={(e) => { setMonth(e.target.value); setOffset(0); }} />
      </label>
      <label>
        검색어 (내역·구분)
        <input maxLength={100} value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} />
      </label>
      {error && <p role="alert">{error}</p>}
      <div className="cards">
        {page?.byKind.map((k) => (
          <article className="panel" key={k.kind}>
            <h3>{k.kind}</h3>
            <p>{won(k.amount)}원</p>
          </article>
        ))}
      </div>
      {loading ? (
        <p>조회 중</p>
      ) : page?.items.length ? (
        <table>
          <thead>
            <tr>
              <th>월</th>
              <th>세부항목</th>
              <th>내역</th>
              <th>수량</th>
              <th>금액</th>
            </tr>
          </thead>
          <tbody>
            {page.items.map((r) => (
              <tr key={r.id}>
                <td>{r.month}</td>
                <td>{r.kind}</td>
                <td>{r.description}</td>
                <td>{won(r.quantity)}</td>
                <td>{won(r.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p>해당 인건비 내역 없음</p>
      )}
      <button disabled={loading || !offset} onClick={() => setOffset((v) => v - 50)}>
        이전 50행
      </button>
      <button disabled={loading || !page?.hasMore} onClick={() => setOffset((v) => v + 50)}>
        다음 50행
      </button>
    </section>
  );
}
