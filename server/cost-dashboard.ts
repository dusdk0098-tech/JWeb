import type { Express } from "express";
import type { Db } from "./db.js";
import type { SiteOperations } from "./site-operations.js";
import { costExpenses, costTotals, readCostSettings, getCostPeriod, costPeriodView, type CostCategory } from "./cost-model.js";
import { currentCostEvidence } from "./cost-evidence-model.js";
import { photoBoard } from "./cost-photo-routes.js";
import { missingRequired } from "./cost-detail-fields.js";
import { moneyUnits } from "./cost-money.js";
// Ratio a/b as a percent string with one decimal, truncated (no rounding up).
export function percentText(a: bigint, b: bigint) {
  if (b <= 0n) return null;
  const tenths = (a * 1000n) / b;
  return `${tenths / 10n}.${(tenths < 0n ? -tenths : tenths) % 10n}`;
}
// SC 월마감 대시보드 numbers, computed from current ledgers (not closures).
export function costDashboard(db: Db, site: string) {
  const periods = db
    .prepare("SELECT id,month,status,categories FROM cost_periods WHERE site_id=? ORDER BY month")
    .all(site) as { id: string; month: string; status: string; categories: string }[];
  const months = periods.map((p) => {
    const totals = costTotals(JSON.parse(p.categories) as CostCategory[], costExpenses(db, p.id));
    return { id: p.id, month: p.month, status: p.status, current: totals.total.current, count: totals.activeCount, totals };
  });
  const latest = months.at(-1);
  if (!latest) return { next: "최초 원장 만들기", months: [], latest: null };
  const settings = readCostSettings(db, latest.id),
    entered = settings?.safetyBudgetWon ? moneyUnits(settings.safetyBudgetWon) : 0n,
    budget = entered > 0n ? entered : null, // 0원은 비율·소진을 계산할 수 없으므로 미입력과 같게 다룬다
    used = months.map((m) => moneyUnits(m.current)).filter((v) => v > 0n),
    cumulative = moneyUnits(latest.totals.total.cumulative);
  let monthsLeft: string | null = null;
  if (budget !== null && used.length) {
    const left = budget - cumulative,
      tenths = left <= 0n ? 0n : (left * 10n * BigInt(used.length)) / used.reduce((a, b) => a + b, 0n);
    monthsLeft = `${tenths / 10n}.${tenths % 10n}`;
  }
  // PEDIT-SC "다음 작업": first unfinished step of 현장 설정 → 예산 → 사용내역 → 마감 → 이월.
  const pre = latest.status === "open" ? costPreflight(db, site, latest.id) : null,
    next = !pre
      ? "마감됨 · 원장에서 다음 월 이월 생성"
      : pre.items.some((i) => i.message.startsWith("현장 설정") || i.message.startsWith("계상안전관리비"))
        ? "현장 설정 입력"
        : pre.items.some((i) => i.message.startsWith("항목별 계획금액"))
          ? "예산(계획금액) 입력"
          : latest.count === 0
            ? "금월 사용내역 입력"
            : "출력 전 확인 후 기록 마감";
  return {
    next,
    months: months.map(({ totals: _totals, ...m }) => m),
    latest: {
      id: latest.id,
      month: latest.month,
      status: latest.status,
      safetyBudgetWon: budget === null ? null : settings!.safetyBudgetWon,
      total: latest.totals.total,
      usedPercent: budget === null ? null : percentText(cumulative, budget),
      monthsLeft,
      byCategory: latest.totals.byCategory.map((c) => ({
        id: c.id,
        label: c.label,
        plan: c.plan,
        opening: c.opening,
        current: c.current,
        cumulative: c.cumulative,
        remaining: c.remaining,
        usedPercent: budget === null ? null : percentText(moneyUnits(c.cumulative), budget),
      })),
    },
  };
}
// PEDIT-SC 출력 전 확인 (state-query.js preflightState), limited to data this app has.
// Errors block closing (cost-periods.ts); stock/legal-limit checks are out of scope.
export function costPreflight(db: Db, site: string, id: string) {
  const period = costPeriodView(db, getCostPeriod(db, site, id)),
    items: { level: "error" | "warning"; message: string }[] = [],
    s = period.settings;
  for (const [key, label] of [
    ["writtenDate", "작성일"], ["projectName", "공사명"], ["contractor", "건설업체명"], ["contractAmountWon", "공사금액"],
    ["safetyBudgetWon", "계상안전관리비"], ["author", "작성자"], ["reviewer", "작성확인자"],
  ] as const)
    if (!s?.[key]) items.push({ level: "error", message: `현장 설정의 ${label}을(를) 입력하세요.` });
  if (s?.safetyBudgetWon === "0") items.push({ level: "error", message: "계상안전관리비는 0보다 커야 합니다." });
  if (!period.categories.some((c) => moneyUnits(c.plan) > 0n)) items.push({ level: "error", message: "항목별 계획금액을 입력하세요." });
  for (const e of costExpenses(db, id)) {
    if (e.status !== "active") continue;
    if (e.spend_date < period.month + "-01")
      items.push({ level: "warning", message: `${e.description}은(는) 이전 월 지출일(${e.spend_date})로 입력되었습니다.` });
    const missing = missingRequired(period.categories.find((c) => c.id === e.category_id)?.scCode, period.details[e.id] ?? {});
    if (missing.length) items.push({ level: "error", message: `${e.description}의 ${missing.join(", ")} 항목을 입력하세요.` });
  }
  const noEvidence = currentCostEvidence(db, site, id).warnings.activeExpensesWithoutLink.length;
  if (noEvidence) items.push({ level: "warning", message: `증빙 연결이 없는 지출이 ${noEvidence}건 있습니다.` });
  // Original SC (state-query.js) photo checks are warnings.
  const photos = photoBoard(db, site, id);
  if (photos.missingDisplay) items.push({ level: "warning", message: `사진대지 표시본이 없는 사진이 ${photos.missingDisplay}장 있습니다.` });
  for (const p of photos.photos.filter((x) => x.included)) {
    if (!p.takenDate.startsWith(period.month + "-")) items.push({ level: "warning", message: `${p.description || p.filename}의 촬영일자를 확인하세요.` });
    if (!p.description) items.push({ level: "warning", message: `사진대지 내용이 비어 있습니다(${p.filename}).` });
  }
  for (const c of period.totals.byCategory)
    if (c.overPlan) items.push({ level: "warning", message: `${c.label} 항목이 계획금액을 초과했습니다.` });
  return { items, errorCount: items.filter((i) => i.level === "error").length };
}
export function registerCostDashboard(app: Express, db: Db, { access }: SiteOperations) {
  app.get("/api/sites/:siteId/cost-periods/:id/preflight", (req, res) => {
    access(req, true, true);
    res.json(costPreflight(db, String(req.params.siteId), String(req.params.id)));
  });
  app.get("/api/sites/:siteId/cost-dashboard", (req, res) => {
    access(req, true, true);
    res.json(costDashboard(db, String(req.params.siteId)));
  });
}
