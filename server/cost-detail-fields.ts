// SC 항목별 추가필드: copied from the original PEDIT-SC src/expense-policy.js EXPENSE_SCHEMAS.
// Code 1 "구분" is the separate 인건비 구분 (cost_expense_labor). No imports: shared with the client bundle.
// Not ported: 2번 노무비+자재비 → 단가 auto-sum and the 고시 한도 rules (legal judgment).
export type DetailField = { key: string; label: string; type: "text" | "number" | "date" | "select"; required?: boolean; options?: readonly string[] };
const text = (key: string, label: string, required = false): DetailField => ({ key, label, type: "text", required });
const number = (key: string, label: string, required = false): DetailField => ({ key, label, type: "number", required });
const date = (key: string, label: string, required = false): DetailField => ({ key, label, type: "date", required });
const note = text("note", "비고");
export const costDetailFields: Record<number, readonly DetailField[]> = {
  1: [text("personName", "성명"), text("company", "소속"), date("appointedDate", "선임일"), date("workStartDate", "근무 시작일"), date("workEndDate", "근무 종료일")],
  2: [text("spec", "규격", true), text("unit", "단위", true), number("laborUnitPrice", "노무비 단가"), number("materialUnitPrice", "자재비 단가"), text("paymentDetails", "지급내역", true), note],
  3: [note],
  4: [text("agency", "진단기관", true), text("paymentDetails", "지급내역", true), note],
  5: [text("host", "교육주관", true), number("people", "참가인원", true), note],
  6: [text("vendor", "진단병원(사용처)", true), number("people", "참가인원", true), note],
  7: [text("agency", "지도기관", true), note],
  8: [text("company", "소속", true), text("role", "직책", true), text("personName", "성명", true), date("positionedDate", "보직일", true), note],
  9: [{ key: "decisionType", label: "결정 구분", type: "select", options: ["위험성평가", "노사협의"], required: true }, date("decisionDate", "결정일", true), text("paymentDetails", "지급내역", true), note],
};
// 2026-13-99 or 2026-02-30 have the right shape but are not days.
const realDate = (v: string) => { const d = new Date(v + "T00:00:00Z"); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v; };
// Returns a Korean problem message, or null when the details fit the category's fields.
export function detailProblem(code: number | undefined, details: Record<string, string>) {
  const fields = code ? costDetailFields[code] : undefined;
  if (!fields) return Object.keys(details).length ? "이 항목은 추가필드를 받지 않습니다." : null;
  for (const [key, value] of Object.entries(details)) {
    const f = fields.find((x) => x.key === key);
    if (!f) return `알 수 없는 추가필드입니다: ${key}`;
    if (typeof value !== "string" || value.length > 200) return `${f.label}은(는) 200자 이하 문자로 입력하세요.`;
    if (!value) continue;
    if (f.type === "number" && !/^(0|[1-9]\d{0,11})$/.test(value)) return `${f.label}은(는) 0 이상 정수로 입력하세요.`;
    if (f.type === "date" && !(/^\d{4}-\d{2}-\d{2}$/.test(value) && realDate(value))) return `${f.label}은(는) 날짜로 입력하세요.`;
    if (f.type === "select" && !f.options!.includes(value)) return `${f.label} 선택값이 올바르지 않습니다.`;
  }
  return null;
}
export function missingRequired(code: number | undefined, details: Record<string, string>) {
  return (code ? costDetailFields[code] ?? [] : []).filter((f) => f.required && !details[f.key]).map((f) => f.label);
}
