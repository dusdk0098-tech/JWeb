import type { CostExpense, CostCategory } from "../server/cost-model";
export type { CostExpense, CostCategory };
import type { CostSettings } from "../server/cost-validation";
export type { CostSettings };
export type CostPeriod = {
  id: string;
  month: string;
  status: "open" | "closed";
  version: number;
  opening_note: string;
  categories: CostCategory[];
  settings: CostSettings | null;
  laborKinds: Record<string, string>;
  details: Record<string, Record<string, string>>;
  parent_period_id: string | null;
  source_close_id: string | null;
  successor: { id: string; month: string } | null;
  currentClosure: {
    id: string;
    number: number;
    hash: string;
    closed_at: string;
  } | null;
  totals: {
    byCategory: (CostCategory & {
      current: string;
      cumulative: string;
      remaining: string;
      overPlan: boolean;
    })[];
    total: {
      plan: string;
      opening: string;
      current: string;
      cumulative: string;
      remaining: string;
    };
    activeCount: number;
    cancelledCount: number;
  };
};
// 화면 표시용 천 단위 쉼표. 값 자체(입력·전송)는 쉼표 없는 정확한 문자열 그대로다.
export const won = (v: string) => { const [whole, fraction] = v.split("."); return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (fraction ? "." + fraction : ""); };
export const costWarning =
  "수기 비용 원장 · 법정 인정액·세금·재고 계산이 아닙니다. 수량은 양수 소수 6자리, 단가는 양수 원 단위 정수입니다. 금액은 반올림하지 않습니다.";
