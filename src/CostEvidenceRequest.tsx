import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { EvidenceRequestView } from "../server/cost-evidence-request-text";
type Page = EvidenceRequestView & { total: number; offset: number; hasMore: boolean };
type Draft = { text: string; tsv: string; selectedCount: number; fingerprint: string };
export function CostEvidenceRequest({ siteId, periodId }: { siteId: string; periodId: string }) {
  const [page, setPage] = useState<Page | null>(null), [selected, setSelected] = useState<string[]>([]),
    [draft, setDraft] = useState<Draft | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const generation = useRef(0), base = `/sites/${siteId}/cost-periods/${periodId}/evidence`;
  useEffect(() => { generation.current++; return () => { generation.current++; }; }, []);
  async function run(action: () => Promise<void>) {
    const token = generation.current; setBusy(true); setError("");
    try { await action(); } catch (e) { if (token === generation.current) setError((e as Error).message); }
    finally { if (token === generation.current) setBusy(false); }
  }
  async function load(offset = 0) {
    const token = generation.current; setPage(null); setSelected([]); setDraft(null);
    const result = await api<Page>(`${base}/request-candidates?offset=${offset}`);
    if (token === generation.current) setPage(result);
  }
  async function create() {
    if (!page || !selected.length || !confirm("선택한 행의 내부 확인용 초안을 생성할까요? 외부로 전송하지 않습니다.")) return;
    const token = generation.current; setDraft(null);
    const result = await api<Draft>(`${base}/request-preview`, "POST", { fingerprint: page.fingerprint,
      periodVersion: page.periodVersion, evidenceVersion: page.evidenceVersion, confirmInternalDraft: true,
      selected: page.rows.filter(r => selected.includes(r.id)).map(r => ({ id: r.id, version: r.version, hash: r.hash })) });
    if (token === generation.current) setDraft(result);
  }
  return <section><h3>내부 원본 연결 확인 요청 초안</h3>
    <p>법정 증빙 필요 여부·적격성·실제 거래를 판정하지 않습니다. 수신자·기한을 지정하거나 전송하지 않습니다. 생성된 내용은 해당 지문 당시 값이며 확인 완료 기록이 아닙니다.</p>
    <p>다시 조회하거나 페이지를 바꾸면 기존 선택과 생성문을 지웁니다. 한 페이지에서 최대 50개 행을 선택하세요.</p>
    <button disabled={busy} onClick={() => void run(() => load())}>현재 확인 후보 조회</button>
    {error && <p role="alert">{error} 생성 완료나 경고 없음으로 처리하지 않았습니다.</p>}
    {!page && <p>현재 후보 미조회. 경고가 없다는 뜻이 아닙니다.</p>}
    {page && <><p>{page.month} · 현재 {page.periodStatus} · 후보 {page.total}개 · 원장 v{page.periodVersion} / 참조 v{page.evidenceVersion}</p>
      {page.rows.map(row => <label key={row.id}><input type="checkbox" disabled={busy} checked={selected.includes(row.id)} onChange={e => { setDraft(null); setSelected(e.target.checked ? [...selected, row.id] : selected.filter(id => id !== row.id)); }} />
        {row.spendDate} · {row.description} · {row.amount}원 · {row.status} · {row.id} v{row.version} · {row.reasons.map(x => ({ no_link: "미연결", changed_link: "연결 뒤 변경", cancelled_link: "취소행 연결" })[x]).join(" / ")}</label>)}
      {!page.rows.length && <p>이 페이지에 확인 후보가 없습니다. 증빙 적격성을 확인했다는 뜻이 아닙니다.</p>}
      <button disabled={busy || page.offset === 0} onClick={() => void run(() => load(page.offset - 50))}>이전 50</button>
      <button disabled={busy || !page.hasMore} onClick={() => void run(() => load(page.offset + 50))}>다음 50</button>
      <button disabled={busy || !selected.length} onClick={() => void run(create)}>선택 {selected.length}개로 내부 초안 생성</button></>}
    {draft && <><p>생성 당시 지문: {draft.fingerprint}. 생성/복사는 발송·수신·읽음 기록이 아닙니다. 아래 내용을 검토하고 직접 선택하여 복사하세요.</p>
      <label>확인 요청 평문<textarea readOnly rows={12} value={draft.text} /></label>
      <p>표시용 TSV는 모든 칸 앞에 text: 를 붙이고 탭·줄바꿈·제어문자·따옴표를 보이는 escape로 바꿉니다. 금액은 won: 뒤 정확한 숫자를 보존한 텍스트입니다. 원장 원문은 바뀌지 않습니다. 무변형 가져오기용이 아니며 접두사 제거·앱별 재해석·재저장 이후 안전을 보장하지 않습니다. 실제 스프레드시트 수용 검증은 미완료입니다.</p>
      <label>표시용 TSV<textarea readOnly rows={8} value={draft.tsv} /></label></>}
  </section>;
}
