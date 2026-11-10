import { useState } from "react";
import { api, type Site } from "./api";
import { useDraftGuard } from "./useDraftGuard";
import type { CostPeriod } from "./cost-types";
import type { CostBatchPreview } from "../server/cost-batch";
import { readCostExcel, type ExcelImport } from "./cost-excel-rows";
import { XLSX_LIMITS } from "./xlsx-read";
const header = "categoryId\tspendDate\tdescription\tquantity\tunitPriceWon";
type Receipt = {
  period: CostPeriod;
  createdIds: string[];
  count: number;
  batchAmount: string;
  previewDigest: string;
};
export function CostBatchImport({
  site,
  initial,
  onDirtyChange,
  onBusyChange,
  onClose,
  onSaved,
}: {
  site: Site;
  initial: CostPeriod;
  onDirtyChange: (v: boolean) => void;
  onBusyChange: (v: boolean) => void;
  onClose: () => void;
  onSaved: (v: CostPeriod) => void;
}) {
  const [period, setPeriod] = useState(initial),
    [tsv, setTsv] = useState(""),
    [preview, setPreview] = useState<CostBatchPreview | null>(null),
    [ack, setAck] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [receipt, setReceipt] = useState<Receipt | null>(null),
    // 엑셀에서 불러온 묶음: 100행씩 TSV 칸에 차례로 채운다. at = 지금 칸에 있는 묶음.
    [excel, setExcel] = useState<(ExcelImport & { name: string; at: number }) | null>(null);
  const guard = useDraftGuard(!!tsv, busy, onDirtyChange, onBusyChange),
    base = `/sites/${site.id}/cost-periods/${period.id}`;
  async function review() {
    if (busy) return;
    setBusy(true);
    setError("");
    setPreview(null);
    setAck(false);
    try {
      setPreview(
        await api<CostBatchPreview>(base + "/expense-batch/preview", "POST", {
          version: period.version,
          tsv,
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function loadExcel(file: File) {
    if (busy) return;
    setBusy(true);
    setError("");
    setExcel(null);
    setPreview(null);
    setAck(false);
    setReceipt(null);
    try {
      if (file.size > XLSX_LIMITS.file) throw new Error("엑셀 파일은 5MiB까지 읽습니다.");
      const read = await readCostExcel(new Uint8Array(await file.arrayBuffer()), period);
      setExcel({ ...read, name: file.name, at: 0 });
      if (read.chunks.length) setTsv(read.chunks[0]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function refresh() {
    if (busy) return;
    setBusy(true);
    setError("");
    setPreview(null);
    setAck(false);
    try {
      const next = await api<CostPeriod>(base);
      setPeriod(next);
      onSaved(next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function commit() {
    if (busy || !preview?.digest) return;
    if (
      !window.confirm(
        `검토한 ${preview.rows.length}행을 모두 새 지출로 저장할까요? 자동 중복 제거는 없습니다.`,
      )
    )
      return;
    const body = {
        version: period.version,
        tsv,
        previewDigest: preview.digest,
        acknowledgeDuplicates: ack,
      },
      path = base + "/expense-batch/commit";
    setBusy(true);
    setError("");
    try {
      const next = await api<Receipt>(
        path,
        "POST",
        body,
        guard.key(path, body),
      );
      setPeriod(next.period);
      onSaved(next.period);
      setReceipt(next);
      // The next 100 rows of the same Excel file follow; each chunk gets its own review.
      const following = excel && excel.at + 1 < excel.chunks.length ? { ...excel, at: excel.at + 1 } : null;
      setExcel(following);
      setTsv(following ? following.chunks[following.at] : "");
      setPreview(null);
      setAck(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <button
        disabled={busy}
        onClick={() => {
          if (guard.canLeave()) onClose();
        }}
      >
        사용내역으로
      </button>
      <h2>
        TSV 지출 일괄 입력 검토 · {period.month} v{period.version}
      </h2>
      <p>
        현재 현장 관리자의 작성 중 원장에만 최대100행을 추가합니다. 미리보기는
        지출을 저장하지 않으며 오류가 있으면 전체 저장하지 않습니다. 수량
        소수6자리, 단가 양수 원 단위 정수, 반올림 없음. 엑셀 파일은 아래에서
        값만 읽어 같은 TSV로 바꾸며, 파일 자체나 사진·증빙·수불은 옮기지
        않습니다.
      </p>
      <fieldset disabled={busy || period.status !== "open"}>
        <legend>엑셀 파일에서 불러오기 (.xlsx · .xlsm)</legend>
        <p>
          기존 산업안전보건관리비 엑셀 장부의 사용내역을 읽어 아래 TSV 칸을
          채웁니다. 이 단계에서는 아무것도 저장하지 않습니다. 매크로는 실행하지
          않고 수식은 저장된 값만 읽습니다. 금액이 수량×단가와 다르거나 소수
          6자리를 넘는 행이 하나라도 있으면 전체를 채우지 않고 행별 이유를
          보여 줍니다. 1·4·5·7·8번 항목은 원 단위 금액을 수량 1 × 금액으로
          넣습니다. 규격·단위·지급내역·인건비 구분은 가져오지 않으니 저장 뒤
          지출 수정에서 채우세요(출력 전 확인이 빠진 값을 알려 줍니다).
        </p>
        <label>
          가져올 엑셀 파일
          <input
            type="file"
            accept=".xlsx,.xlsm"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file && (!tsv || window.confirm("지금 TSV 칸의 내용을 엑셀에서 읽은 내용으로 바꿀까요?"))) void loadExcel(file);
            }}
          />
        </label>
        {excel && (
          <aside className="notice">
            <p>
              {excel.name} · 시트 {excel.sheets.join(", ")} · {excel.rows}행
              {excel.chunks.length === 1 && " · 아래 TSV 칸에 채웠습니다."}
              {excel.chunks.length > 1 && ` · 100행씩 ${excel.chunks.length}묶음 중 ${excel.at + 1}번째를 TSV 칸에 채웠습니다. 검토·저장하면 다음 묶음이 채워집니다.`}
            </p>
            {excel.problems.length > 0 && (
              <>
                <p role="alert">가져올 수 없는 행이 {excel.problems.length}개 있어 아무것도 채우지 않았습니다. 엑셀에서 고친 뒤 다시 불러오세요.</p>
                <ul>
                  {excel.problems.slice(0, 50).map((p, i) => (
                    <li key={i}>{p.sheet} {p.row}행: {p.message}</li>
                  ))}
                </ul>
                {excel.problems.length > 50 && <p>외 {excel.problems.length - 50}개</p>}
              </>
            )}
            {excel.notes.length > 0 && (
              <details open={excel.notes.length <= 5}>
                <summary>읽으면서 바꾼 점 {excel.notes.length}건</summary>
                <ul>
                  {excel.notes.slice(0, 100).map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              </details>
            )}
            {excel.chunks.length > 1 && <button className="secondary" onClick={() => setExcel(null)}>엑셀 묶음 이어 채우기 그만두기</button>}
          </aside>
        )}
      </fieldset>
      <p>
        첫 행은 아래 고정 헤더 그대로, 셀은 탭·행은 LF/CRLF입니다. BOM/빈 행/셀
        내부 탭·개행/CSV 인용 escape는 지원하지 않습니다. 따옴표와 =로 시작한
        설명은 문자 그대로이며 수식으로 실행하지 않습니다. UTF-8 100KiB 제한, 끝
        개행1개 허용.
      </p>
      <pre>{header}</pre>
      <h3>현재 원장의 항목 ID 매핑 (이름 추측 없음)</h3>
      <ul>
        {period.categories.map((c) => (
          <li key={c.id}>
            {c.label} — <code>{c.id}</code>
          </li>
        ))}
      </ul>
      <fieldset disabled={busy}>
        <label>
          붙여넣을 비용 TSV
          <textarea
            rows={12}
            maxLength={102400}
            value={tsv}
            onChange={(e) => {
              setTsv(e.target.value);
              setPreview(null);
              setAck(false);
              setReceipt(null);
            }}
          />
        </label>
        <button
          disabled={!tsv || period.status !== "open"}
          onClick={() => void review()}
        >
          저장 없이 TSV 검토
        </button>
        <button onClick={() => void refresh()}>
          입력 유지하고 원장 새로 조회
        </button>
      </fieldset>
      {period.status !== "open" && (
        <p>
          현재 마감 상태입니다. 검토/새 저장 불가. 원장 정책에 따른 명시적
          재개가 필요합니다.
        </p>
      )}
      {busy && <p role="status">처리 중…</p>}
      {error && (
        <p role="alert">
          {error} TSV 입력은 유지했습니다. 응답 유실 시 같은 입력/검토본으로
          재시도하면 같은 요청 영수증을 확인합니다. 원장 버전 충돌이면 새로 조회
          후 재검토하세요.
        </p>
      )}
      {receipt && (
        <aside>
          <h3>일괄 저장 영수증</h3>
          <p>
            {receipt.count}행 · 추가 금액 {receipt.batchAmount}원 · 결과 원장 v
            {receipt.period.version}
          </p>
          <p>검토 지문 {receipt.previewDigest}</p>
          <details>
            <summary>생성된 지출 ID</summary>
            <ul>
              {receipt.createdIds.map((id) => (
                <li key={id}>{id}</li>
              ))}
            </ul>
          </details>
        </aside>
      )}
      {preview && (
        <>
          <h3>행별 검토</h3>
          {preview.errors.map((e, i) => (
            <p role="alert" key={i}>
              {e.line ? `${e.line}행` : "전체"}: {e.message}
            </p>
          ))}
          <p>
            추가 합계 {preview.batchAmount ?? "계산 불가"}원 · 저장 후 현재 지출{" "}
            {preview.projected?.total.current ?? "계산 불가"}원 · 저장 후 누계{" "}
            {preview.projected?.total.cumulative ?? "계산 불가"}원
          </p>
          <table>
            <thead>
              <tr>
                <th>행/설명</th>
                <th>항목/날짜</th>
                <th>수량 × 단가 = 금액</th>
                <th>경고</th>
              </tr>
            </thead>
            <tbody>
              {preview.rows.map((r) => (
                <tr key={r.line}>
                  <td>
                    {r.line} · {r.expense.description}
                  </td>
                  <td>
                    {r.expense.categoryId}
                    <br />
                    {r.expense.spendDate}
                  </td>
                  <td>
                    {r.expense.quantity} × {r.expense.unitPriceWon} ={" "}
                    {r.expense.amount}
                  </td>
                  <td>
                    {r.priorPeriod ? "원장 월 이전 날짜. " : ""}
                    {r.duplicateLines.length
                      ? `입력 내 같은 내용 ${r.duplicateLines.join(",")}행. `
                      : ""}
                    {r.existingActive || r.existingCancelled
                      ? `기존 동일 내용 유효 ${r.existingActive} / 취소 ${r.existingCancelled}행. `
                      : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {preview.hasDuplicates && (
            <label>
              <input
                type="checkbox"
                checked={ack}
                disabled={busy}
                onChange={(e) => setAck(e.target.checked)}
              />
              중복 경고를 확인했으며 각 행은 실제 별도 지출로 모두 추가합니다
              (자동 제거 없음)
            </label>
          )}
          <button
            disabled={
              busy ||
              !preview.digest ||
              !!preview.errors.length ||
              (preview.hasDuplicates && !ack) ||
              period.status !== "open"
            }
            onClick={() => void commit()}
          >
            검토한 지출 전체 저장
          </button>
        </>
      )}
    </section>
  );
}
