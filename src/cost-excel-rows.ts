// 비용 엑셀 가져오기: turns a PEDIT-SC style workbook into the same TSV the batch screen already checks and saves.
// The sheet rules follow the original app's import (sheet choice, A열 항목 번호, "예상" 구간, 사용내역 행 범위), re-written here.
// Stricter than the original on purpose: no rounding, 금액 must equal 수량×단가 exactly, nothing is saved from this file.
import { openXlsx, XlsxError, type XlsxCell, type XlsxSheet } from "./xlsx-read";
export type ExcelProblem = { sheet: string; row: number; message: string };
export type ExcelImport = { chunks: string[]; rows: number; sheets: string[]; notes: string[]; problems: ExcelProblem[] };
type Ledger = { month: string; categories: { id: string; scCode?: number }[] };
const HEADER = "categoryId\tspendDate\tdescription\tquantity\tunitPriceWon";
const DIRECT = new Set([1, 4, 5, 7, 8]); // 원본과 같이 금액을 직접 적는 항목: 수량 1 × 금액
const OWN_RANGES: Record<number, [number, number]> = { 1: [5, 11], 2: [13, 21], 3: [23, 28], 4: [30, 30], 5: [43, 44], 6: [46, 47], 7: [49, 50], 8: [52, 52], 9: [54, 54] };
const isOwn = (name: string) => /^사용내역(?:\(을\))?$/.test(name.replace(/\s/g, ""));
const fullYear = (y: string) => (Number(y) < 100 ? 2000 + Number(y) : Number(y));
const yearIn = (text: string) => { const m = /(\d{2,4})년/.exec(text); return m ? fullYear(m[1]) : 0; };
const clean = (c?: XlsxCell) => (c?.text ?? "").replace(/\s+/g, " ").trim();
const iso = (y: number, m: number, d: number) => {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() + 1 === m && t.getUTCDate() === d ? `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` : "";
};
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

export function pickSheets(names: string[], month: string) {
  const [year, m] = month.split("-").map(Number);
  const monthly = names.map((name) => ({ name, at: /(\d{2,4})년\s*(\d{1,2})월.*내역/.exec(name) })).filter((x) => x.at);
  if (monthly.length) {
    const mine = monthly.filter((x) => fullYear(x.at![1]) === year && Number(x.at![2]) === m).map((x) => x.name);
    if (!mine.length) throw new XlsxError(`이 원장 월(${month})의 내역 시트가 없습니다. 파일의 월별 시트: ${monthly.map((x) => x.name).join(", ")}`);
    return { kind: "monthly" as const, names: mine };
  }
  const own = names.filter(isOwn);
  if (own.length) return { kind: "own" as const, names: own };
  const byCategory = names.filter((n) => /^(감시자|신호수|안전관리자|물품)$/.test(n.trim()));
  if (byCategory.length) return { kind: "category" as const, names: byCategory };
  throw new XlsxError(`가져올 수 있는 사용내역 시트가 없습니다. 파일의 시트: ${names.join(", ") || "없음"}`);
}
// Excel date cell → YYYY-MM-DD. A bare "M월" has no day: the month's last day is used and reported.
export function excelDate(cell: XlsxCell, year: number, date1904: boolean): { date: string; monthOnly?: boolean } {
  if (cell.numeric) {
    const n = Number(cell.text);
    if (!(n >= 1 && n <= 2958465)) return { date: "" };
    const t = new Date((Math.floor(n) + (date1904 ? 1462 : 0) - 25569) * 86400000);
    return { date: iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()) };
  }
  const text = cell.text.trim().replace(/\s*(년|월|일)\s*/g, "$1");
  let m = /^(\d{2,4})[-./]\s*(\d{1,2})[-./]\s*(\d{1,2})(?:T.*)?$/.exec(text) ?? /^(\d{2,4})년(\d{1,2})월(\d{1,2})일?$/.exec(text);
  if (m) return { date: iso(fullYear(m[1]), Number(m[2]), Number(m[3])) };
  m = /^(\d{2,4})년(\d{1,2})월$/.exec(text);
  if (m) return { date: iso(fullYear(m[1]), Number(m[2]), lastDay(fullYear(m[1]), Number(m[2]))), monthOnly: true };
  m = /^(\d{1,2})월(\d{1,2})일?$/.exec(text);
  if (m && year) return { date: iso(year, Number(m[1]), Number(m[2])) };
  m = /^(\d{1,2})월$/.exec(text);
  if (m && year && Number(m[1]) >= 1 && Number(m[1]) <= 12) return { date: iso(year, Number(m[1]), lastDay(year, Number(m[1]))), monthOnly: true };
  return { date: "" };
}
// Number cell → exact decimal text, null when empty, or a reason. Only display marks (쉼표·공백·₩·원) are stripped; digits are never rounded.
export function excelNumber(cell?: XlsxCell): { value: string | null } | { reason: string } {
  const raw = (cell?.text ?? "").replace(/\u00a0/g, " ").trim();
  if (!raw || /^[-–—]$/.test(raw)) return { value: null };
  const text = raw.replace(/[\s,₩원]/g, ""), m = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!m) return { reason: `숫자가 아닙니다(${raw.slice(0, 30)})` };
  const fraction = (m[2] ?? "").replace(/0+$/, "");
  if (fraction.length > 6) return { reason: `소수 6자리를 넘습니다(${raw.slice(0, 30)}). 반올림하지 않으니 엑셀에서 값을 고치세요` };
  return { value: m[1].replace(/^0+(?=\d)/, "") + (fraction ? "." + fraction : "") };
}
const units = (v: string) => { const [i, f = ""] = v.split("."); return BigInt(i) * 1_000_000n + BigInt(f.padEnd(6, "0")); };
const wholeWon = (v: string | null) => v !== null && !v.includes(".") && BigInt(v) > 0n;

type Candidate = { sheet: string; row: number; code: number; spendDate: string; description: string; quantity: string; unitPriceWon: string };
function sheetRows(sheet: XlsxSheet, kind: "monthly" | "own" | "category", month: string, date1904: boolean, out: { rows: Candidate[]; problems: ExcelProblem[]; notes: string[]; otherMonth: number }) {
  const own = isOwn(sheet.name), col = own ? { quantity: 4, price: 5, amount: 6 } : { quantity: 6, price: 7, amount: 8 },
    order = [...sheet.rows.keys()].sort((a, b) => a - b), [ledgerYear, ledgerMonth] = month.split("-").map(Number),
    monthEnd = iso(ledgerYear, ledgerMonth, lastDay(ledgerYear, ledgerMonth));
  let code = /감시자|신호수|안전관리자/.test(sheet.name) ? 1 : /물품/.test(sheet.name) ? 3 : 0, forecast = false,
    year = order.map((r) => yearIn(clean(sheet.rows.get(r)!.get(1)))).find(Boolean) || yearIn(sheet.name) || (kind === "category" ? 0 : ledgerYear);
  for (const r of order) {
    const cells = sheet.rows.get(r)!, first = clean(cells.get(1)), heading = /^([1-9])\s*[.．]/.exec(first), problem = (message: string) => out.problems.push({ sheet: sheet.name, row: r, message });
    if (heading) { code = Number(heading[1]); forecast = false; }
    if (/기사용/.test(first)) forecast = false;
    if (/예상/.test(first)) forecast = true;
    year = yearIn(first) || year;
    if (forecast) continue;
    const rowCode = code || (own ? Number(Object.entries(OWN_RANGES).find(([, [a, b]]) => r >= a && r <= b)?.[0] ?? 0) : 0),
      dateCell = cells.get(2), description = clean(cells.get(3));
    if (!dateCell || !description || !rowCode || (/사용일자/.test(dateCell.text) && /사용내역/.test(description))) continue;
    const when = excelDate(dateCell, year, date1904);
    if (!when.date) { problem(`사용일자를 날짜로 읽을 수 없습니다(${dateCell.text.slice(0, 30)})`); continue; }
    if (kind === "category" && when.date.slice(0, 7) !== month) { out.otherMonth++; continue; }
    if (when.date > monthEnd) { problem(`지출일 ${when.date}이 원장 월(${month}) 이후입니다`); continue; }
    if (description.length > 500) { problem("사용내역이 500자를 넘습니다"); continue; }
    const amountCell = cells.get(col.amount), read = { 수량: excelNumber(cells.get(col.quantity)), 단가: excelNumber(cells.get(col.price)), 금액: excelNumber(amountCell) },
      bad = Object.entries(read).find(([k, v]) => k !== "금액" && "reason" in v);
    if (bad) { problem(`${bad[0]}: ${(bad[1] as { reason: string }).reason}`); continue; }
    const value = (v: (typeof read)["수량"]) => ("reason" in v ? null : v.value),
      quantity = value(read.수량), price = value(read.단가),
      product = quantity !== null && price !== null && units(quantity) > 0n && wholeWon(price) ? units(quantity) * BigInt(price) : null;
    // 금액은 저장하지 않고 수량×단가와 대조만 한다. 수식 결과에 붙는 부동소수 꼬리(0.1×3 → 0.30000000000000004)는
    // 정확한 곱과 사실상 같을 때만 통과시키고, 수량·단가 자체는 절대 고치지 않는다.
    const floatTail = "reason" in read.금액 && product !== null && !!amountCell?.numeric && Math.abs(Number(amountCell.text) - Number(product) / 1e6) <= (Number(product) / 1e6) * 1e-12;
    if ("reason" in read.금액 && !floatTail) { problem(`금액: ${read.금액.reason}`); continue; }
    const amount = value(read.금액),
      exact = product !== null && (floatTail || amount === null || units(amount) === product),
      where = `${sheet.name} ${r}행`;
    let saved: [string, string];
    if (exact) saved = [quantity!, price!];
    else if (DIRECT.has(rowCode) && wholeWon(amount)) {
      saved = ["1", amount!];
      if (quantity !== null || price !== null) out.notes.push(`${where}: 수량·단가가 금액과 맞지 않아 수량 1 × 금액 ${amount}원으로 넣었습니다.`);
    } else {
      problem(
        DIRECT.has(rowCode) ? "금액이 비어 있거나 원 단위 양의 정수가 아닙니다"
          : quantity === null || price === null ? "수량 또는 단가가 비어 있습니다(이 항목은 금액만으로 가져오지 않습니다)"
          : !wholeWon(price) ? "단가가 원 단위 양의 정수가 아닙니다"
          : units(quantity) <= 0n ? "수량이 0입니다"
          : `금액 ${amount}원이 수량 ${quantity} × 단가 ${price}와 다릅니다`,
      );
      continue;
    }
    if (when.monthOnly) out.notes.push(`${where}: 일자가 없어 그 달 말일(${when.date})로 넣었습니다.`);
    out.rows.push({ sheet: sheet.name, row: r, code: rowCode, spendDate: when.date, description, quantity: saved[0], unitPriceWon: saved[1] });
  }
}
// All or nothing: any problem row means no TSV. Chunks hold at most 100 rows and stay under the batch screen's 100KiB.
export async function readCostExcel(bytes: Uint8Array, ledger: Ledger): Promise<ExcelImport> {
  if (!ledger.categories.some((c) => c.scCode)) throw new XlsxError("SC 9개 항목으로 만든 원장에서만 엑셀을 가져올 수 있습니다.");
  const book = await openXlsx(bytes), picked = pickSheets(book.sheetNames, ledger.month),
    out = { rows: [] as Candidate[], problems: [] as ExcelProblem[], notes: [] as string[], otherMonth: 0 };
  for (const name of picked.names) sheetRows(await book.sheet(name), picked.kind, ledger.month, book.date1904, out);
  const ids = new Map(ledger.categories.filter((c) => c.scCode).map((c) => [c.scCode!, c.id]));
  for (const r of out.rows) if (!ids.has(r.code)) out.problems.push({ sheet: r.sheet, row: r.row, message: `이 원장에 ${r.code}번 항목이 없습니다` });
  if (book.hasMacros) out.notes.unshift("매크로가 든 파일입니다. 매크로는 실행하지 않고 저장된 값만 읽었습니다.");
  if (out.otherMonth) out.notes.unshift(`원장 월(${ledger.month})이 아닌 ${out.otherMonth}행은 넣지 않았습니다.`);
  if (!out.rows.length && !out.problems.length) throw new XlsxError(`${picked.names.join(", ")} 시트에서 가져올 사용내역을 찾지 못했습니다.`);
  const chunks: string[] = [], size = new TextEncoder();
  if (!out.problems.length) {
    let lines: string[] = [], bytesUsed = HEADER.length;
    for (const r of out.rows) {
      const line = [ids.get(r.code), r.spendDate, r.description, r.quantity, r.unitPriceWon].join("\t"), n = size.encode(line).length + 1;
      if (lines.length === 100 || bytesUsed + n > 100_000) { chunks.push([HEADER, ...lines].join("\n")); lines = []; bytesUsed = HEADER.length; }
      lines.push(line);
      bytesUsed += n;
    }
    if (lines.length) chunks.push([HEADER, ...lines].join("\n"));
  }
  return { chunks, rows: out.rows.length, sheets: picked.names, notes: out.notes, problems: out.problems };
}
