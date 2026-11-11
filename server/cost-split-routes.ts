import { assertNoActiveCostReceipt, assertNoChildCostReceipts } from "./cost-stock-model.js";
import type { Express } from "express";
import { randomUUID } from "node:crypto";
import type { Db } from "./db.js";
import { HttpError, type SiteOperations } from "./site-operations.js";
import {
  getCostPeriod,
  getExpense,
  costExpenses,
  costPeriodView,
  costLaborKinds,
  costExpenseDetails,
  saveLaborKind,
  saveExpenseDetails,
  insertExpense,
} from "./cost-model.js";
import { costReason } from "./cost-validation.js";
import {
  costSplitInput,
  splitChildren,
  expenseSplitInfo,
  splitRow,
  splitView,
  undoEligibility,
  type SplitSnapshot,
  type SplitUndo,
} from "./cost-split-model.js";
import { expectedCost, bumpCost, costEvent } from "./cost-write.js";
import { account } from "./inspection-model.js";
import { journalHash } from "./daily-journal-sources.js";
import { inspectionPage } from "./inspection-validation.js";
import { printCostSplit } from "./cost-split-print.js";
export function registerCostSplits(
  app: Express,
  db: Db,
  { access, mutate }: SiteOperations,
) {
  const base = "/api/sites/:siteId/cost-periods/:id";
  app.get(base + "/expenses/:expenseId/split-info", (req, res) => {
    access(req, true, true);
    const period = getCostPeriod(
      db,
      String(req.params.siteId),
      String(req.params.id),
    );
    res.json({
      ...expenseSplitInfo(db, period, String(req.params.expenseId)),
      period: costPeriodView(db, period),
    });
  });
  app.get(base + "/splits", (req, res) => {
    access(req, true, true);
    const period = getCostPeriod(
        db,
        String(req.params.siteId),
        String(req.params.id),
      ),
      q = inspectionPage.parse(req.query),
      rows = db
        .prepare(
          "SELECT id,status,source_expense_id,created_at FROM cost_splits WHERE period_id=? ORDER BY created_at DESC,id DESC LIMIT 51 OFFSET ?",
        )
        .all(period.id, q.offset);
    res.json({ items: rows.slice(0, 50), hasMore: rows.length > 50 });
  });
  app.get(base + "/splits/:splitId", (req, res) => {
    access(req, true, true);
    const period = getCostPeriod(
        db,
        String(req.params.siteId),
        String(req.params.id),
      ),
      row = splitRow(db, period.id, String(req.params.splitId)),
      view = splitView(row, period.site_id);
    res.json({
      ...view,
      eligibility: undoEligibility(db, row, view.snapshot),
      period: costPeriodView(db, period),
    });
  });
  app.get(base + "/splits/:splitId/print", (req, res) => {
    access(req, true, true);
    const period = getCostPeriod(
        db,
        String(req.params.siteId),
        String(req.params.id),
      ),
      row = splitRow(db, period.id, String(req.params.splitId));
    const view = splitView(row, period.site_id);
    res.type("html").send(printCostSplit(view, (JSON.parse(period.categories) as { id: string; label: string }[]).find((c) => c.id === view.snapshot.source.category_id)?.label));
  });
  app.post(base + "/expenses/:expenseId/split", (req, res) => {
    access(req, true, true);
    const v = costSplitInput.parse(req.body),
      site = String(req.params.siteId),
      id = String(req.params.id),
      expenseId = String(req.params.expenseId);
    mutate(
      req,
      res,
      `cost:split:${site}:${id}:${expenseId}`,
      v,
      () => {
        let period = getCostPeriod(db, site, id);
        expectedCost(period, v.version);
        assertNoActiveCostReceipt(db, expenseId);
        const info = expenseSplitInfo(db, period, expenseId);
        if (!info.canSplit)
          throw new HttpError(
            409,
            "현재 유효한 원행만 분할할 수 있습니다. 분할 자식의 재분할은 지원하지 않습니다.",
          );
        const children = splitChildren(info.expense, v);
        if (costExpenses(db, id).length + children.length > 1000)
          throw new HttpError(
            409,
            "취소 원행 포함 보존1,000행 한도를 넘습니다. 분할 되돌리기는 새 행을 만들지 않습니다.",
          );
        const splitId = randomUUID(),
          now = new Date().toISOString(),
          actor = account(db, req.session.userId!);
        db.prepare(
          "UPDATE cost_expenses SET status='cancelled',version=version+1,updated_at=? WHERE id=?",
        ).run(now, expenseId);
        period = bumpCost(db, period);
        costEvent(
          db,
          req,
          period,
          "expense_split_source",
          v.reason,
          getExpense(db, id, expenseId),
        );
        const saved = [],
          laborKind = costLaborKinds(db, id)[expenseId],
          details = costExpenseDetails(db, id)[expenseId];
        for (const e of children) {
          const childId = insertExpense(db, id, e, actor.id, now);
          saveLaborKind(db, childId, laborKind, now);
          saveExpenseDetails(db, childId, details, now);
          const child = getExpense(db, id, childId);
          saved.push(child);
          period = bumpCost(db, period);
          costEvent(db, req, period, "expense_split_child", v.reason, child);
        }
        const siteRow = db
          .prepare("SELECT id,name FROM sites WHERE id=?")
          .get(site) as { id: string; name: string };
        const snapshot: SplitSnapshot = {
          id: splitId,
          periodId: id,
          site: siteRow,
          month: period.month,
          source: info.expense,
          children: saved,
          reason: v.reason,
          actor,
          at: now,
        };
        db.prepare(
          "INSERT INTO cost_splits VALUES(?,?,?,?,?,'active',NULL,NULL,?)",
        ).run(
          splitId,
          id,
          expenseId,
          JSON.stringify(snapshot),
          journalHash(snapshot),
          now,
        );
        for (const child of saved)
          db.prepare("INSERT INTO cost_split_children VALUES(?,?)").run(
            child.id,
            splitId,
          );
        assertNoChildCostReceipts(db,splitId);
        const row = splitRow(db, id, splitId),
          view = splitView(row, site);
        return {
          ...view,
          eligibility: undoEligibility(db, row, snapshot),
          period: costPeriodView(db, period),
        };
      },
      () => {
        access(req, true, true);
      },
    );
  });
  app.post(base + "/splits/:splitId/undo", (req, res) => {
    access(req, true, true);
    const v = costReason.parse(req.body),
      site = String(req.params.siteId),
      id = String(req.params.id),
      splitId = String(req.params.splitId);
    mutate(
      req,
      res,
      `cost:split:undo:${site}:${id}:${splitId}`,
      v,
      () => {
        let period = getCostPeriod(db, site, id);
        expectedCost(period, v.version);
        assertNoChildCostReceipts(db,splitId);
        const row = splitRow(db, id, splitId),
          view = splitView(row, site),
          eligibility = undoEligibility(db, row, view.snapshot);
        if (!eligibility.allowed) throw new HttpError(409, eligibility.reason);
        const now = new Date().toISOString(),
          actor = account(db, req.session.userId!),
          cancelledChildren = view.snapshot.children.map((e) => ({
            ...getExpense(db, id, e.id),
            status: "cancelled" as const,
            version: getExpense(db, id, e.id).version + 1,
            updated_at: now,
          })),
          parent = getExpense(db, id, row.source_expense_id),
          restored = {
            ...parent,
            status: "active" as const,
            version: parent.version + 1,
            updated_at: now,
          };
        const undo: SplitUndo = {
          actor,
          at: now,
          reason: v.reason,
          restored,
          cancelledChildren,
        };
        db.prepare(
          "UPDATE cost_splits SET status='undone',undo_snapshot=?,undo_hash=? WHERE id=?",
        ).run(JSON.stringify(undo), journalHash(undo), splitId);
        for (const child of cancelledChildren) {
          db.prepare(
            "UPDATE cost_expenses SET status='cancelled',version=version+1,updated_at=? WHERE id=?",
          ).run(now, child.id);
          period = bumpCost(db, period);
          costEvent(
            db,
            req,
            period,
            "expense_split_undo_child",
            v.reason,
            getExpense(db, id, child.id),
          );
        }
        db.prepare(
          "UPDATE cost_expenses SET status='active',version=version+1,updated_at=? WHERE id=?",
        ).run(now, parent.id);
        period = bumpCost(db, period);
        costEvent(
          db,
          req,
          period,
          "expense_split_undo_source",
          v.reason,
          getExpense(db, id, parent.id),
        );
        const next = splitRow(db, id, splitId);
        return {
          ...splitView(next, site),
          eligibility: undoEligibility(db, next, view.snapshot),
          period: costPeriodView(db, period),
        };
      },
      () => {
        access(req, true, true);
      },
    );
  });
}
