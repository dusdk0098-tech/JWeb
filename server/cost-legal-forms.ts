import type { Express } from "express";
import { z } from "zod";
import type { Db } from "./db.js";
import { HttpError, type SiteOperations } from "./site-operations.js";
import { costExpenses, costPeriodView, getCostPeriod, type CostCategory, type CostExpense } from "./cost-model.js";
import { moneyUnits, decimalText } from "./cost-money.js";
import { percentText } from "./cost-dashboard.js";
import { fixed as fixedClosure } from "./cost-output.js";
import { escapeHtml as e } from "./print.js";
// 법정 서식 A안 1단계 (docs/LEGAL_FORMS_PROPOSAL.md): 표지·내역집계표·사용내역(갑)·총괄 as HTML,
// same document order, page capacity and values as the original PEDIT-SC (src/excel-summary-settings.js).
// Only structural labels come from the original template; its leftover sample values are not copied.
const SUMMARY_MONTH_CAPACITY = 16;
const SUMMARY_CODES = [1, 2, 3, 4, 5, 6, 7, 9] as const; // original 내역집계표 has no 8번(본사) column
const SUMMARY_HEADS = ["1.인건비등", "2.시설비등", "3.보호구등", "4.안전진단비", "5.교육비등", "6.건강관리비등", "7.기술지도비등", "9.위험성평가"];
function byCode<T extends CostCategory & { current?: string }>(categories: T[]) {
  const unmapped = categories.filter((c) => !c.scCode);
  if (!categories.some((c) => c.scCode))
    throw new HttpError(409, "SC 9개 항목(현장 설정의 SC 채우기)으로 만든 원장만 법정 서식으로 출력할 수 있습니다.");
  if (unmapped.some((c) => [c.plan, c.opening, c.current].some((v) => v && moneyUnits(v) !== 0n)))
    throw new HttpError(409, `SC 항목 번호가 없는 항목(${unmapped.map((c) => c.label).join(", ")})에 금액이 있어 법정 서식으로 출력할 수 없습니다.`);
  return new Map(categories.filter((c) => c.scCode).map((c) => [c.scCode!, c]));
}
const won = (v: bigint | string) => {
  const t = typeof v === "string" ? v : decimalText(v), [i, f] = t.split(".");
  return i.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (f ? "." + f : "");
};
const krMonth = (m: string) => `${m.slice(0, 4)}년 ${Number(m.slice(5, 7))}월`; // original monthKoreanLabel: no zero pad
// original spacedName: 2~4 Hangul syllables are spaced ("홍길동" -> "홍 길 동").
const spacedName = (v: string) => { const t = v.replace(/\s/g, ""); return /^[가-힣]{2,4}$/.test(t) ? t.split("").join(" ") : v; };
const shortDate = (d: string) => (d ? d.slice(2).replaceAll("-", ".") : "");
export function legalForms(db: Db, site: string, id: string, closureId?: string) {
  const row = getCostPeriod(db, site, id), live = costPeriodView(db, row),
    closure = closureId ? fixedClosure(db, site, id, closureId, row.month).body : null;
  // A closure prints what was fixed at that close, never today's values.
  const view = closure ? { ...live, status: "closed" as const, categories: closure.period.categories, totals: closure.totals, settings: closure.settings ?? null, laborKinds: closure.laborKinds ?? {}, details: closure.details ?? {} } : live;
  const s = view.settings, codes = byCode(view.totals.byCategory);
  if (!s) throw new HttpError(409, "현장 설정을 입력한 뒤 출력하세요.");
  const budget = moneyUnits(s.safetyBudgetWon || "0");
  // 내역집계표: every ledger month of this site up to this month, current amount per SC code.
  const periods = db.prepare("SELECT * FROM cost_periods WHERE site_id=? AND month<=? ORDER BY month").all(site, view.month) as Parameters<typeof costPeriodView>[1][];
  const totalsOf = (p: (typeof periods)[number]) => (p.id === id ? view.totals : costPeriodView(db, p).totals).byCategory;
  // 이전 누계: the first ledger's 초기 누계 has no month row, so it gets its own row and counts toward 계 and 사용률.
  const first = byCode(totalsOf(periods[0])), openings = SUMMARY_CODES.map((c) => moneyUnits(first.get(c)?.opening ?? "0"));
  let grand = openings.reduce((a, b) => a + b, 0n), code8 = moneyUnits(first.get(8)?.opening ?? "0");
  const columnTotals = new Map<number, bigint>(SUMMARY_CODES.map((c, i) => [c, openings[i]]));
  const months = periods.map((p) => {
    const m = byCode(totalsOf(p)), amounts = SUMMARY_CODES.map((c) => moneyUnits(m.get(c)?.current ?? "0"));
    code8 += moneyUnits(m.get(8)?.current ?? "0");
    amounts.forEach((a, i) => columnTotals.set(SUMMARY_CODES[i], columnTotals.get(SUMMARY_CODES[i])! + a));
    const total = amounts.reduce((a, b) => a + b, 0n);
    grand += total;
    return { month: p.month, amounts, total };
  });
  const rows = [...codes.values()].sort((a, b) => a.scCode! - b.scCode!), t = view.totals.total;
  const expenses = (closure?.expenses ?? costExpenses(db, id)).filter((x) => x.status === "active");
  return { view, s, budget, months, openings, grand, code8, columnTotals, rows, t, codes, expenses, closure };
}
export function printLegalForms(f: ReturnType<typeof legalForms>) {
  const { view, s, budget, months, openings, grand, code8, columnTotals, rows, t, closure } = f,
    openingTotal = openings.reduce((a, b) => a + b, 0n),
    ratio = (v: string | bigint) => percentText(typeof v === "string" ? moneyUnits(v) : v, budget),
    pct = (v: string | null) => (v === null ? "-" : v + "%"),
    progress = s.cumulativeProgress ? moneyUnits(s.cumulativeProgress.replace(/^0+(?=\d)/, "")) : 0n, // "05" could be saved before the settings check tightened
    standard = budget * progress / 100_000_000n; // 계상액 × 누계공정률(%) / 100, ×10^6 units
  const pages: (typeof months)[] = [];
  for (let i = 0; i < Math.max(1, months.length); i += SUMMARY_MONTH_CAPACITY) pages.push(months.slice(i, i + SUMMARY_MONTH_CAPACITY));
  const cover = `<section class="form-page"><h1>산업안전보건관리비 사용내역</h1><p>표지공정률 ${e(s.coverProgress ? s.coverProgress + "%" : "미입력")}</p><p>${e(krMonth(view.month))}</p><h2>${e(s.projectName)}</h2></section>`;
  const summary = pages.map((page, n) => `<section class="form-page"><h1>산업안전보건관리비 사용 내역 집계표${pages.length > 1 ? ` (${n + 1}/${pages.length})` : ""}</h1>
<p>▶ 공 사 명 : ${e(s.projectName)}</p><p>▶ 공사기간 : ${e(s.summaryStart ? `${s.summaryStart} ~ ${s.summaryEnd}` : `${s.projectStart} ~ ${s.projectEnd}`)}</p>
<table><tbody><tr><th>계상된안전관리비</th><td>${won(budget)}</td><th>도 급 공 사 비</th><td>${won(s.contractAmountWon || "0")}</td></tr>
<tr><th>안전관리비사용률</th><td>${pct(ratio(grand))}</td><th>공사공정률</th><td>${e(s.cumulativeProgress ? s.cumulativeProgress + "%" : "미입력")}</td></tr></tbody></table>
<table><thead><tr><th rowspan="2">구 분</th><th colspan="8">사 용 내 역</th><th rowspan="2">월 별 소 계</th></tr><tr>${SUMMARY_HEADS.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>
${n === 0 && openingTotal ? `<tr><th>이전 누계</th>${openings.map((a) => `<td>${won(a)}</td>`).join("")}<td>${won(openingTotal)}</td></tr>` : ""}
${page.map((m) => `<tr><th>${krMonth(m.month)}</th>${m.amounts.map((a) => `<td>${won(a)}</td>`).join("")}<td>${won(m.total)}</td></tr>`).join("")}
<tr><th>계</th>${SUMMARY_CODES.map((c) => `<td>${won(columnTotals.get(c)!)}</td>`).join("")}<td>${won(grand)}</td></tr>
<tr><th>적용료</th><td colspan="8"></td><td>0</td></tr><tr><th>적용금액</th><td colspan="8"></td><td>${won(grand)}</td></tr></tbody></table>
${openingTotal ? `<p>이전 누계는 최초 원장의 초기 누계이며 계와 사용률에 포함했습니다.</p>` : ""}
${code8 ? `<p>원본 양식과 같이 8번(본사) 열이 없습니다. 8번 사용액 ${won(code8)}원은 이 표의 합계에 포함되지 않습니다.</p>` : ""}</section>`).join("");
  const gap = `<section class="form-page"><p>[별지 제1호 서식]</p><h1>산업안전보건관리비 사용내역서(${view.month.slice(2, 4)}년 ${view.month.slice(5, 7)}월)</h1>
<table><tbody><tr><th>건설업체명</th><td>${e(s.contractor)}</td><th>공사명</th><td>${e(s.projectName)}</td></tr>
<tr><th>소재지</th><td>${e(s.location)}</td><th>대 표 자</th><td>${e(s.representative)}</td></tr>
<tr><th>공사금액(전체)</th><td>${won(s.contractAmountWon || "0")}</td><th>공사기간(전체)</th><td>${e(`${shortDate(s.projectStart)} ~ ${shortDate(s.projectEnd)}`)}</td></tr>
<tr><th>발주자</th><td>${e(s.client)}</td><th>누계공정율(전체)</th><td>${e(s.cumulativeProgress ? s.cumulativeProgress + "%" : "미입력")}</td></tr>
<tr><th>계상된 안전관리비(전체)</th><td>${won(budget)}</td><th>공사진척도에 따른 사용기준금액(전체)</th><td>${won(standard)}</td></tr></tbody></table>
<h2>사 용 금 액</h2><table><thead><tr><th>항 목</th><th>전월누계</th><th>당월금액</th><th>비율(%)</th><th>누계</th></tr></thead><tbody>
<tr><th>계</th><td>${won(t.opening)}</td><td>${won(t.current)}</td><td>${pct(ratio(t.cumulative))}</td><td>${won(t.cumulative)}</td></tr>
${rows.map((c) => `<tr><th>${c.scCode}. ${e(c.label)}</th><td>${won(c.opening)}</td><td>${won(c.current)}</td><td>${pct(ratio(c.cumulative))}</td><td>${won(c.cumulative)}</td></tr>`).join("")}</tbody></table>
<p>건설업 표준안전관리비계상 및 사용기준 고시 제10조 1항 규정에 의하여 위와같이 사용내역을 제출합니다.</p>
<p>${s.writtenDate ? `${s.writtenDate.slice(0, 4)} 년 ${s.writtenDate.slice(5, 7)}월 ${s.writtenDate.slice(8, 10)}일` : "작성일 미입력"}</p>
<p>작성자 · 안전관리자 · 성명 : ${e(spacedName(s.author))} (인)</p><p>작성 확인자 · 직급 : 현장 대리인 · 성명 : ${e(spacedName(s.reviewer))} (인)</p></section>`;
  const overall = `<section class="form-page"><h1>산업안전보건관리비 사용금액 총괄현황</h1><p>공사명 : ${e(s.projectName)}</p>
<table><thead><tr><th rowspan="2">사 용 항 목</th><th rowspan="2">계 획 금 액</th><th colspan="3">사 용 금 액</th><th rowspan="2">잔 액</th><th rowspan="2">비 고</th></tr>
<tr><th>전회까지</th><th>금회금액</th><th>소 계(누계금액)</th></tr></thead><tbody>
<tr><th>계</th><td>${won(t.plan)}</td><td>${won(t.opening)}</td><td>${won(t.current)}</td><td>${won(t.cumulative)}</td><td>${won(t.remaining)}</td><td></td></tr>
${rows.map((c) => `<tr><th>${c.scCode}. ${e(c.label)}</th><td>${won(c.plan)}</td><td>${won(c.opening)}</td><td>${won(c.current)}</td><td>${won(c.cumulative)}</td><td>${won(c.remaining)}</td><td></td></tr>`).join("")}</tbody></table>
<p>※ 첨부：사용항목별 세부내역 (양식 별첨)</p></section>`;
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${e(view.month)} 산업안전보건관리비 법정 서식</title><link rel="stylesheet" href="/print.css"></head><body><main>
<p class="form-note">${closure ? `마감본 ${closure.number}에 고정된 값입니다.${closure.details ? "" : " 이 마감본은 인건비 구분·항목별 추가필드를 고정하기 전 기록이라 그 값이 비어 있습니다."}` : view.status === "open" ? "작성 중 원장의 현재 값입니다. 마감 후 다시 출력하세요." : "마감 원장 기준입니다."} 원본 엑셀 양식의 문서 순서·값을 HTML로 재현했으며 모양은 근사입니다. 법적 적합성 판단이 아닙니다.</p>
${cover}${summary}${gap}${overall}${usageSheets(f)}${detailSheets(f)}</main></body></html>`;
}
export function registerLegalForms(app: Express, db: Db, { access }: SiteOperations) {
  app.get("/api/sites/:siteId/cost-periods/:id/legal-forms/print", (req, res) => {
    access(req, true, true);
    const q = z.object({ closureId: z.uuid().optional() }).strict().parse(req.query);
    res.type("html").send(printLegalForms(legalForms(db, String(req.params.siteId), String(req.params.id), q.closureId)));
  });
}
// 2단계: 사용내역(을) and 항목 1~9 상세, from the original src/excel-expenses.js and src/detail-sheets.js.
type Forms = ReturnType<typeof legalForms>;
const USAGE_RANGES: Record<number, number> = { 1: 7, 2: 9, 3: 6, 4: 1, 5: 2, 6: 2, 7: 2, 8: 1, 9: 1 }; // rows per page (EXPENSE_RANGES)
const pagesOf = (n: number, capacity: number) => Math.max(1, Math.ceil(n / capacity));
const cell = (v: string) => `<td>${e(v)}</td>`;
function byCodeRows(f: Forms) {
  const codeOf = new Map(f.view.categories.map((c) => [c.id, c.scCode]));
  return (code: number) => f.expenses.filter((x) => codeOf.get(x.category_id) === code);
}
function usageSheets(f: Forms) {
  const rowsOf = byCodeRows(f), pages = Math.max(...Object.entries(USAGE_RANGES).map(([c, cap]) => pagesOf(rowsOf(Number(c)).length, cap)));
  const all = f.expenses.reduce((a, x) => a + moneyUnits(x.amount), 0n), out: string[] = [];
  for (let page = 0; page < pages; page++) {
    let pageSum = 0n;
    const body = f.rows.map((c) => {
      const cap = USAGE_RANGES[c.scCode!], rows = rowsOf(c.scCode!), slice = rows.slice(page * cap, page * cap + cap);
      return Array.from({ length: cap }, (_, i) => {
        const x = slice[i];
        if (x) pageSum += moneyUnits(x.amount);
        // original expenseDescription: code 1 drops the "장비유도수 및 화기감시자(...)" wrapper
        const text = x ? (c.scCode === 1 && /^장비유도수 및 화기감시자\(.*\)$/.test(x.description) ? x.description.slice(13, -1) : x.description) : "";
        return `<tr>${i === 0 ? `<th rowspan="${cap}">${c.scCode}. ${e(c.label)}</th>` : ""}${x ? cell(x.spend_date) + cell(text) + cell(x.quantity) + cell(won(x.unit_price_won)) + cell(won(x.amount)) : "<td></td><td></td><td></td><td></td><td></td>"}${i === 0 ? `<td rowspan="${cap}">${won(c.current)}</td>` : ""}</tr>`;
      }).join("");
    }).join("");
    out.push(`<section class="form-page"><p>첨부 # 1</p><h1>${krMonth(f.view.month)} 항목별 사용내역${pages > 1 ? ` (${page + 1})` : ""}</h1>
<table><thead><tr><th>항 목</th><th>일자</th><th>내역</th><th>수량</th><th>단가</th><th>금액[원]</th><th>계</th></tr></thead><tbody>${body}
<tr><th>계</th><td colspan="4"></td><td>${won(pageSum)}</td><td>${won(all)}</td></tr></tbody></table></section>`);
  }
  return out.join("");
}
type Detail = { code: number; title: string; capacity: number; heads: string[]; row: (x: CostExpense, d: Record<string, string>, f: Forms, cum: Map<string, [number, bigint]>) => string[]; notes?: string[]; pre?: string };
const n = (v: string | undefined) => (v ? won(v) : "");
const DETAILS: Detail[] = [
  { code: 1, title: "1. 안전관리자의 임금 등 지급현황", capacity: 22, pre: "<p>별지 제5-1호 서식 (2.6.4. 관련)</p><h2>사용항목별 지급현황</h2>",
    heads: ["구 분", "성 명", "소 속", "선임일", "사용일(근무일)", "지급금액", "지급내역"],
    row: (x, d, f) => [
      f.view.laborKinds[x.id] ?? (/장비유도|화기감시|신호수|유도수/.test(x.description) ? "장비유도원 및 화기감시자" : /감시단/.test(x.description) ? "안전감시단" : "안전관리자"),
      d.personName || (/\(([^)]+)\)/.exec(x.description)?.[1] ?? ""), d.company || f.s.contractor, d.appointedDate ?? "",
      d.workStartDate && d.workEndDate ? `${d.workStartDate} ~ ${d.workEndDate}` : `${Number(x.spend_date.slice(5, 7))}월`, won(x.amount), x.description],
    notes: [" * 관련 증빙서류 사본 첨부", " * 월간보고, 기성서류에는 현황만 첨부보고 하고 감독 및 검사원이 증빙서류 확인"] },
  { code: 2, title: "2. 안전시설비 등 사용현황", capacity: 28,
    heads: ["품 명", "규격", "사용일자", "단위", "수량", "단가 노무비", "단가 자재비", "단가 계", "사용금액", "지급내역", "비고"],
    row: (x, d) => [x.description, d.spec ?? "", x.spend_date, d.unit ?? "", x.quantity, n(d.laborUnitPrice), n(d.materialUnitPrice), won(x.unit_price_won), won(x.amount), d.paymentDetails ?? "", d.note ?? ""],
    notes: [" * 시설물 자재, 설치비 등이 혼재되어 정산이 곤란한 경우 표준도면, ", "   일위대가를 작성하여 시공 확인 사항 기재", " * 1식으로 적산처리 하는 경우 2개사 이상 적산서 및 세금계산서 첨부"] },
  { code: 3, title: "3. 보호구 등 사용현황", capacity: 22,
    heads: ["구 분", "계획 수량", "계획 금액", "전월까지 수량", "전월까지 금액", "금월 일자", "금월 수량", "금월 금액", "누계 수량", "누계 금액", "비고"],
    // shortcut: the original adds a fixed previous-stock table (config previousProtectionStock); this app has none, so 누계 starts at 0 each month.
    row: (x, _d, _f, cum) => {
      const key = x.description.replace(/\s+/g, ""), [q, a] = cum.get(key) ?? [0, 0n], next: [number, bigint] = [q + Number(x.quantity), a + moneyUnits(x.amount)];
      cum.set(key, next);
      return [x.description, "", "", "", "", x.spend_date, x.quantity, won(x.amount), String(next[0]), won(next[1]), ""];
    },
    notes: [" * 계획은 안전관리비 예산 내역서 사항 기재", " * 개인보호구 지급대장은 별도 관리", " * 누계는 이 달 입력분만 셉니다(전월까지 품목 재고 정보 없음)."] },
  { code: 4, title: "4. 안전보건진단비 등 사용현황", capacity: 9, heads: ["구 분", "진단기관(검사기관)", "사용일자", "소요비용", "지급내역", "비 고"],
    row: (x, d) => [x.description, d.agency ?? "", x.spend_date, won(x.amount), d.paymentDetails ?? "", d.note ?? ""] },
  { code: 5, title: "5. 안전보건교육비 등 사용현황", capacity: 16, heads: ["교육 과목", "교육주관", "교육일", "참가인원", "소요경비", "비고"],
    row: (x, d) => [x.description, d.host ?? "", x.spend_date, d.people || x.quantity, won(x.amount), d.note ?? ""],
    notes: ["* 1. 각종 교육 및 행사에 관련된 상세내용은 별도 회의록으로 관리하고 회의록에 관련 영수증 사진 첨부", "  2. 보수교육 등 회의록에 기재 불가사항은 관계 영수증 등 증빙서류 첨부"] },
  { code: 6, title: "6. 근로자 건강장해예방비 등 사용현황", capacity: 11, heads: ["구   분", "사용일자", "진단병원(사용처)", "참가인원(수량)", "소요경비", "단 가"],
    row: (x, d) => [x.description, x.spend_date, d.vendor ?? "", d.people || x.quantity, won(x.amount), won(x.unit_price_won)], notes: ["* 관련 영수증 등 증빙자료 첨부"] },
  { code: 7, title: "7. 건설재해예방 기술지도비 사용현황", capacity: 8, heads: ["지 도 항 목", "지 도 기 관", "점 검 일", "소 요 경 비", "비 고"],
    row: (x, d) => [x.description, d.agency ?? "", x.spend_date, won(x.amount), d.note ?? ""] },
  { code: 8, title: "8. 본사 전담조직 근로자 임금 등 사용현황", capacity: 3,
    pre: `<p>- 조직 현황</p><table><thead><tr><th>시공능력 평가순위</th><th>조직명</th><th>직책</th><th>인원 수</th><th>안전보건관리비 계상총액</th><th>본사 임금 등 계상액(계획)</th></tr></thead><tbody><tr><td></td><td></td><td></td><td></td><td></td><td></td></tr></tbody></table><p>- 사용 내역</p>`,
    heads: ["구 분", "소 속", "직 책", "성 명", "보직일", "지급액", "지급일", "비고"],
    row: (x, d) => [x.description, d.company ?? "", d.role ?? "", d.personName ?? "", d.positionedDate ?? "", won(x.amount), x.spend_date, d.note ?? ""],
    notes: ["* 주 : 사용내역은 항목별 사용일자가 빠른 순서로 작성"] },
  { code: 9, title: "9. 위험성평가 등에 따른 소요비용", capacity: 8,
    heads: ["품목명", "결정일 위험성평가등", "결정일 노사협의등", "계획 단가", "계획 수량", "계획 금액", "사용일", "소요경비 단가", "소요경비 수량", "소요경비 금액", "지급내역", "비고"],
    row: (x, d) => { const labor = (d.decisionType ?? "").includes("노사"); return [x.description, labor ? "" : d.decisionDate ?? "", labor ? d.decisionDate ?? "" : "", "", "", "", x.spend_date, won(x.unit_price_won), x.quantity, won(x.amount), d.paymentDetails ?? "", d.note ?? ""]; },
    notes: ["* 주 : 사용내역은 항목별 사용일자가 빠른 순서로 작성"] },
];
function detailSheets(f: Forms) {
  const rowsOf = byCodeRows(f);
  return DETAILS.map((def) => {
    const c = f.codes.get(def.code);
    if (!c) return "";
    const rows = rowsOf(def.code), pages = pagesOf(rows.length, def.capacity), cum = new Map<string, [number, bigint]>();
    return Array.from({ length: pages }, (_, page) => {
      const slice = rows.slice(page * def.capacity, page * def.capacity + def.capacity),
        body = Array.from({ length: def.capacity }, (_, i) => `<tr>${slice[i] ? def.row(slice[i], f.view.details[slice[i].id] ?? {}, f, cum).map(cell).join("") : def.heads.map(() => "<td></td>").join("")}</tr>`).join("");
      return `<section class="form-page">${def.pre ?? ""}<h1>${def.title}${pages > 1 ? ` (${page + 1})` : ""}</h1>
<table><thead><tr>${def.heads.map((h) => `<th>${h.replace("금월", `금 월(${f.view.month.slice(2, 4)}년 ${f.view.month.slice(5, 7)}월)`)}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table>
<table><tbody><tr><th>계</th><th>계 획</th><td>${won(c.plan)}</td><th>전회까지 누계금액</th><td>${won(c.opening)}</td><th>금월</th><td>${won(c.current)}</td><th>누 계</th><td>${won(c.cumulative)}</td></tr></tbody></table>
${(def.notes ?? []).map((t) => `<p>${e(t)}</p>`).join("")}</section>`;
    }).join("");
  }).join("");
}
