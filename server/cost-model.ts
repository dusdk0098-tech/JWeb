import { randomUUID } from "node:crypto";
import type { Db } from "./db.js";
import type { CostSettings } from "./cost-validation.js";
import { HttpError } from "./site-operations.js";
import {
  moneyUnits,
  lineAmount,
  boundedTotal,
  decimalText,
} from "./cost-money.js";
export type CostCategory = {
  id: string;
  label: string;
  plan: string;
  opening: string;
  scCode?: number; // original PEDIT-SC category 1~9, set only by the SC prefill
};
export type CostPeriodRow = {
  id: string;
  site_id: string;
  month: string;
  categories: string;
  opening_note: string;
  status: "open" | "closed";
  version: number;
  parent_period_id: string | null;
  source_close_id: string | null;
  current_close_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};
export type CostExpense = {
  id: string;
  period_id: string;
  category_id: string;
  spend_date: string;
  description: string;
  quantity: string;
  unit_price_won: string;
  amount: string;
  status: "active" | "cancelled";
  version: number;
  created_by: string;
  created_at: string;
  updated_at: string;
};
export function getCostPeriod(db: Db, site: string, id: string) {
  const row = db
    .prepare("SELECT * FROM cost_periods WHERE site_id=? AND id=?")
    .get(site, id) as CostPeriodRow | undefined;
  if (!row) throw new HttpError(404, "비용 원장을 찾을 수 없습니다.");
  return row;
}
export function costExpenses(db: Db, id: string) {
  const rows = db
    .prepare(
      "SELECT * FROM cost_expenses WHERE period_id=? ORDER BY created_at,id LIMIT 1001",
    )
    .all(id) as CostExpense[];
  if (rows.length > 1000)
    throw new HttpError(
      400,
      "원장 보존 행이1,000건을 넘어 처리할 수 없습니다.",
    );
  return rows;
}
// Every new expense row goes through here so the retained-row cap cannot be skipped.
export function insertExpense(db: Db, periodId: string, e: { categoryId: string; spendDate: string; description: string; quantity: string; unitPriceWon: string; amount: string }, actorId: string, now: string) {
  if (Number(db.prepare("SELECT count(*) n FROM cost_expenses WHERE period_id=?").get(periodId)?.n) >= 1000)
    throw new HttpError(409, "보존 지출1,000행 한도입니다. 취소행도 포함하며 삭제로 회수하지 않습니다.");
  const id = randomUUID();
  db.prepare("INSERT INTO cost_expenses VALUES(?,?,?,?,?,?,?,?,'active',1,?,?,?)").run(id, periodId, e.categoryId, e.spendDate, e.description, e.quantity, e.unitPriceWon, e.amount, actorId, now, now);
  return id;
}
export function getExpense(db: Db, period: string, id: string) {
  const row = db
    .prepare("SELECT * FROM cost_expenses WHERE period_id=? AND id=?")
    .get(period, id) as CostExpense | undefined;
  if (!row) throw new HttpError(404, "지출 기록을 찾을 수 없습니다.");
  return row;
}
export function costTotals(categories: CostCategory[], rows: CostExpense[]) {
  const amounts = new Map(categories.map((c) => [c.id, 0n]));
  let activeCount = 0,
    cancelledCount = 0;
  for (const row of rows) {
    if (
      !amounts.has(row.category_id) ||
      lineAmount(row.quantity, row.unit_price_won) !== row.amount
    )
      throw new HttpError(
        409,
        "저장된 지출의 항목/계산 결과가 일치하지 않습니다.",
      );
    if (row.status === "active") {
      amounts.set(
        row.category_id,
        amounts.get(row.category_id)! + moneyUnits(row.amount),
      );
      activeCount++;
    } else cancelledCount++;
  }
  let planTotal = 0n,
    openingTotal = 0n,
    currentTotal = 0n;
  const byCategory = categories.map((c) => {
    const plan = moneyUnits(c.plan),
      opening = moneyUnits(c.opening),
      current = amounts.get(c.id)!;
    planTotal += plan;
    openingTotal += opening;
    currentTotal += current;
    return {
      ...c,
      current: boundedTotal(current),
      cumulative: boundedTotal(opening + current),
      remaining: decimalText(plan - opening - current),
      overPlan: opening + current > plan,
    };
  });
  return {
    byCategory,
    total: {
      plan: boundedTotal(planTotal),
      opening: boundedTotal(openingTotal),
      current: boundedTotal(currentTotal),
      cumulative: boundedTotal(openingTotal + currentTotal),
      remaining: decimalText(planTotal - openingTotal - currentTotal),
    },
    activeCount,
    cancelledCount,
  };
}
export function costPeriodView(db: Db, row: CostPeriodRow) {
  const categories = JSON.parse(row.categories) as CostCategory[],
    totals = costTotals(categories, costExpenses(db, row.id)),
    child = db
      .prepare(
        "SELECT id,month FROM cost_periods WHERE parent_period_id=? AND site_id=?",
      )
      .get(row.id, row.site_id) as { id: string; month: string } | undefined;
  const closure = row.current_close_id
    ? (db
        .prepare(
          "SELECT id,number,hash,closed_at FROM cost_closures WHERE id=? AND period_id=?",
        )
        .get(row.current_close_id, row.id) as {
        id: string;
        number: number;
        hash: string;
        closed_at: string;
      })
    : null;
  return {
    ...row,
    categories,
    settings: readCostSettings(db, row.id),
    laborKinds: costLaborKinds(db, row.id),
    details: costExpenseDetails(db, row.id),
    totals,
    currentClosure: closure,
    successor: child || null,
  };
}
export function readCostSettings(db: Db, periodId: string): CostSettings | null {
  const row = db.prepare("SELECT body FROM cost_period_settings WHERE period_id=?").get(periodId) as { body: string } | undefined;
  return row ? (JSON.parse(row.body) as CostSettings) : null;
}
export function costLaborKinds(db: Db, periodId: string): Record<string, string> {
  const rows = db
    .prepare("SELECT l.expense_id,l.kind FROM cost_expense_labor l JOIN cost_expenses e ON e.id=l.expense_id WHERE e.period_id=?")
    .all(periodId) as { expense_id: string; kind: string }[];
  return Object.fromEntries(rows.map((r) => [r.expense_id, r.kind]));
}
export function costExpenseDetails(db: Db, periodId: string): Record<string, Record<string, string>> {
  const rows = db
    .prepare("SELECT d.expense_id,d.body FROM cost_expense_details d JOIN cost_expenses e ON e.id=d.expense_id WHERE e.period_id=?")
    .all(periodId) as { expense_id: string; body: string }[];
  return Object.fromEntries(rows.map((r) => [r.expense_id, JSON.parse(r.body) as Record<string, string>]));
}
// undefined = leave as is; empty values are dropped and an empty set clears the row.
export function saveExpenseDetails(db: Db, expenseId: string, details: Record<string, string> | undefined, now: string) {
  if (details === undefined) return;
  const kept = Object.fromEntries(Object.entries(details).filter(([, v]) => v !== ""));
  if (!Object.keys(kept).length) db.prepare("DELETE FROM cost_expense_details WHERE expense_id=?").run(expenseId);
  else
    db.prepare(
      "INSERT INTO cost_expense_details VALUES(?,?,?) ON CONFLICT(expense_id) DO UPDATE SET body=excluded.body,updated_at=excluded.updated_at",
    ).run(expenseId, JSON.stringify(kept), now);
}
// undefined = leave as is, null = clear.
export function saveLaborKind(db: Db, expenseId: string, kind: string | null | undefined, now: string) {
  if (kind === undefined) return;
  if (kind === null) db.prepare("DELETE FROM cost_expense_labor WHERE expense_id=?").run(expenseId);
  else
    db.prepare(
      "INSERT INTO cost_expense_labor VALUES(?,?,?) ON CONFLICT(expense_id) DO UPDATE SET kind=excluded.kind,updated_at=excluded.updated_at",
    ).run(expenseId, kind, now);
}
export type CostPeriod = ReturnType<typeof costPeriodView>;
export type CostSnapshot = {
  schema: 1;
  id: string;
  number: number;
  site: { id: string; name: string };
  period: Omit<CostPeriodRow, "categories"> & { categories: CostCategory[] };
  totals: ReturnType<typeof costTotals>;
  expenses: CostExpense[];
  closedBy: { id: string; name: string };
  closedAt: string;
  reason: string;
  policy: "exact-six-decimal-whole-won-price-v1";
  // SC 현장 설정; absent before schema 57. Kept out of period so period comparisons stay byte-identical.
  settings?: CostSettings | null;
  // 인건비 구분·항목별 추가필드 for the legal forms; absent on closures made before they were fixed here.
  laborKinds?: Record<string, string>;
  details?: Record<string, Record<string, string>>;
};
export function nextCostMonth(month: string) {
  const [year, m] = month.split("-").map(Number);
  if (year === 9999 && m === 12)
    throw new HttpError(
      400,
      "다음 원장 월이 허용된4자리 연도 범위를 넘습니다.",
    );
  return (
    String(m === 12 ? year + 1 : year).padStart(4, "0") +
    "-" +
    String(m === 12 ? 1 : m + 1).padStart(2, "0")
  );
}
export function lastCostDate(month: string) {
  const d = new Date(month + "-01T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return month + "-" + String(d.getUTCDate()).padStart(2, "0");
}
