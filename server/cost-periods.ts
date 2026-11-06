import { captureCloseEvidence, assertCostEvidenceReview, costEvidenceReview } from "./cost-evidence-model.js";
import type { Express } from "express";
import { randomUUID } from "node:crypto";
import type { Db } from "./db.js";
import { HttpError, type SiteOperations } from "./site-operations.js";
import { inspectionPage } from "./inspection-validation.js";
import { account } from "./inspection-model.js";
import {
  costCreate,
  costBudget,
  costReason,
  costVersion,
  costSettingsSave,
} from "./cost-validation.js";
import { moneyUnits, decimalText } from "./cost-money.js";
import {
  getCostPeriod,
  costPeriodView,
  costExpenses,
  costTotals,
  nextCostMonth,
  readCostSettings,
  costLaborKinds,
  costExpenseDetails,
  type CostCategory,
  type CostSnapshot,
} from "./cost-model.js";
import { expectedCost, bumpCost, costEvent } from "./cost-write.js";
import { journalHash } from "./daily-journal-sources.js";
import { printCostPeriod } from "./cost-print.js";
import { costPreflight } from "./cost-dashboard.js";
export function registerCostPeriods(
  app: Express,
  db: Db,
  { access, mutate }: SiteOperations,
) {
  const base = "/api/sites/:siteId/cost-periods";
  app.get(base, (req, res) => {
    access(req, true, true);
    const q = inspectionPage.parse(req.query),
      rows = db
        .prepare(
          "SELECT id,month,status,version,parent_period_id,current_close_id FROM cost_periods WHERE site_id=? ORDER BY month DESC,id LIMIT 51 OFFSET ?",
        )
        .all(String(req.params.siteId), q.offset);
    res.json({ items: rows.slice(0, 50), hasMore: rows.length > 50 });
  });
  app.post(base, (req, res) => {
    access(req, true, true);
    const input = costCreate.parse(req.body),
      v = {
        ...input,
        categories: input.categories.map((c) => ({
          ...c,
          plan: decimalText(moneyUnits(c.plan)),
          opening: decimalText(moneyUnits(c.opening)),
        })),
      },
      site = String(req.params.siteId);
    if (
      new Set(v.categories.map((c) => c.label.normalize("NFKC").toLowerCase()))
        .size !== v.categories.length
    )
      throw new HttpError(400, "비용 항목 이름을 중복 없이 지정하세요.");
    const codes = v.categories.flatMap((c) => (c.scCode ? [c.scCode] : []));
    if (new Set(codes).size !== codes.length) throw new HttpError(400, "SC 항목 번호가 중복되었습니다.");
    mutate(
      req,
      res,
      `cost:create:${site}`,
      v,
      () => {
        if (
          db
            .prepare("SELECT id FROM cost_periods WHERE site_id=? LIMIT 1")
            .get(site)
        )
          throw new HttpError(
            409,
            "최초 원장이 이미 있습니다. 이후 월은 마감 원장의 명시적 다음 월 이월로 만드세요.",
          );
        const categories = v.categories.map((c) => ({
          id: randomUUID(),
          ...c,
        }));
        costTotals(categories, []);
        const id = randomUUID(),
          now = new Date().toISOString();
        db.prepare(
          "INSERT INTO cost_periods VALUES(?,?,?,?,?,'open',1,NULL,NULL,NULL,?,?,?)",
        ).run(
          id,
          site,
          v.month,
          JSON.stringify(categories),
          v.openingNote,
          req.session.userId!,
          now,
          now,
        );
        return costEvent(
          db,
          req,
          getCostPeriod(db, site, id),
          "created",
          "사용자가 선택한 최초 원장/수기 전회누계",
        );
      },
      () => {
        access(req, true, true);
      },
    );
  });
  app.get(base + "/:id", (req, res) => {
    access(req, true, true);
    res.json(
      costPeriodView(
        db,
        getCostPeriod(db, String(req.params.siteId), String(req.params.id)),
      ),
    );
  });
  app.put(base + "/:id/budget", (req, res) => {
    access(req, true, true);
    const input = costBudget.parse(req.body),
      v = {
        ...input,
        plans: input.plans.map((p) => ({
          ...p,
          plan: decimalText(moneyUnits(p.plan)),
        })),
        ...(input.openings
          ? {
              openings: input.openings.map((p) => ({
                ...p,
                opening: decimalText(moneyUnits(p.opening)),
              })),
            }
          : {}),
      },
      site = String(req.params.siteId),
      id = String(req.params.id);
    mutate(
      req,
      res,
      `cost:budget:${site}:${id}`,
      v,
      () => {
        const row = getCostPeriod(db, site, id);
        expectedCost(row, v.version);
        const old = JSON.parse(row.categories) as CostCategory[];
        const exact = (ids: string[]) =>
          ids.length === old.length &&
          new Set(ids).size === ids.length &&
          old.every((c) => ids.includes(c.id));
        if (
          !exact(v.plans.map((p) => p.categoryId)) ||
          (v.openings && !exact(v.openings.map((p) => p.categoryId)))
        )
          throw new HttpError(
            400,
            "현재 원장의 모든 비용 항목을 중복 없이 정확히 입력하세요.",
          );
        if (row.parent_period_id && v.openings)
          throw new HttpError(
            409,
            "이월 전회누계는 이전 마감본의 정확한 값이며 직접 수정할 수 없습니다.",
          );
        const categories = old.map((c) => ({
          ...c,
          plan: v.plans.find((p) => p.categoryId === c.id)!.plan,
          opening:
            v.openings?.find((p) => p.categoryId === c.id)!.opening ??
            c.opening,
        }));
        costTotals(categories, costExpenses(db, id));
        db.prepare("UPDATE cost_periods SET categories=? WHERE id=?").run(
          JSON.stringify(categories),
          id,
        );
        return costEvent(
          db,
          req,
          bumpCost(db, row),
          "budget_updated",
          v.reason,
        );
      },
      () => {
        access(req, true, true);
      },
    );
  });
  app.put(base + "/:id/settings", (req, res) => {
    access(req, true, true);
    const v = costSettingsSave.parse(req.body),
      site = String(req.params.siteId),
      id = String(req.params.id),
      settings = v.settings.summarySameAsProject
        ? { ...v.settings, summaryStart: v.settings.projectStart, summaryEnd: v.settings.projectEnd }
        : v.settings;
    mutate(
      req,
      res,
      `cost:settings:${site}:${id}`,
      { ...v, settings },
      () => {
        const row = getCostPeriod(db, site, id);
        expectedCost(row, v.version);
        db.prepare(
          "INSERT INTO cost_period_settings VALUES(?,?,?) ON CONFLICT(period_id) DO UPDATE SET body=excluded.body,updated_at=excluded.updated_at",
        ).run(id, JSON.stringify(settings), new Date().toISOString());
        return costEvent(db, req, bumpCost(db, row), "settings_updated", "현장 설정 저장");
      },
      () => {
        access(req, true, true);
      },
    );
  });
  app.post(base + "/:id/close", (req, res) => {
    access(req, true, true);
    const v = costReason.extend({ evidenceReview: costEvidenceReview.optional() }).parse(req.body),
      site = String(req.params.siteId),
      id = String(req.params.id);
    mutate(
      req,
      res,
      `cost:close:${site}:${id}`,
      v,
      () => {
        const row = getCostPeriod(db, site, id);
        expectedCost(row, v.version);
        // Like PEDIT-SC: 출력 전 확인 오류가 남으면 마감하지 않는다 (warnings do not block).
        const errors = costPreflight(db, site, id).items.filter((i) => i.level === "error");
        if (errors.length)
          throw new HttpError(409, `출력 전 확인 오류 ${errors.length}건을 해결한 뒤 마감하세요: ${errors.slice(0, 3).map((i) => i.message).join(" / ")}${errors.length > 3 ? " 외" : ""}`);
        assertCostEvidenceReview(db, id, v.evidenceReview);
        const categories = JSON.parse(row.categories) as CostCategory[],
          expenses = costExpenses(db, id),
          totals = costTotals(categories, expenses),
          closeId = randomUUID(),
          number =
            (
              db
                .prepare(
                  "SELECT count(*) AS n FROM cost_closures WHERE period_id=?",
                )
                .get(id) as { n: number }
            ).n + 1,
          now = new Date().toISOString();
        const snapshot: CostSnapshot = {
          schema: 1,
          id: closeId,
          number,
          site: {
            id: site,
            name: (
              db.prepare("SELECT name FROM sites WHERE id=?").get(site) as {
                name: string;
              }
            ).name,
          },
          period: {
            ...row,
            categories,
            status: "closed",
            version: row.version + 1,
            current_close_id: closeId,
            updated_at: now,
          },
          totals,
          expenses,
          closedBy: account(db, req.session.userId!),
          closedAt: now,
          reason: v.reason,
          policy: "exact-six-decimal-whole-won-price-v1",
          settings: readCostSettings(db, id),
          laborKinds: costLaborKinds(db, id),
          details: costExpenseDetails(db, id),
        };
        db.prepare("INSERT INTO cost_closures VALUES(?,?,?,?,?,?)").run(
          closeId,
          id,
          number,
          JSON.stringify(snapshot),
          journalHash(snapshot),
          now,
        );
        captureCloseEvidence(db, snapshot, journalHash(snapshot));
        db.prepare(
          "UPDATE cost_periods SET status='closed',current_close_id=?,version=version+1,updated_at=? WHERE id=?",
        ).run(closeId, now, id);
        return costEvent(
          db,
          req,
          getCostPeriod(db, site, id),
          "closed",
          v.reason,
        );
      },
      () => {
        access(req, true, true);
      },
    );
  });
  app.post(base + "/:id/reopen", (req, res) => {
    access(req, true, true);
    const v = costReason.parse(req.body),
      site = String(req.params.siteId),
      id = String(req.params.id);
    mutate(
      req,
      res,
      `cost:reopen:${site}:${id}`,
      v,
      () => {
        const row = getCostPeriod(db, site, id);
        expectedCost(row, v.version, "closed");
        if (
          db
            .prepare("SELECT id FROM cost_periods WHERE parent_period_id=?")
            .get(id)
        )
          throw new HttpError(
            409,
            "다음 월로 이월된 원장은 재개할 수 없습니다. 기존 다음 월/마감본을 보존하고 관리자 검토를 요청하세요. 후속 누계 정정 전파 기능 전에는 우회·삭제·자동 재계산을 제공하지 않습니다.",
          );
        db.prepare(
          "UPDATE cost_periods SET status='open',current_close_id=NULL,version=version+1,updated_at=? WHERE id=?",
        ).run(new Date().toISOString(), id);
        return costEvent(
          db,
          req,
          getCostPeriod(db, site, id),
          "reopened",
          v.reason,
        );
      },
      () => {
        access(req, true, true);
      },
    );
  });
  app.post(base + "/:id/carry", (req, res) => {
    access(req, true, true);
    const v = costVersion.parse(req.body),
      site = String(req.params.siteId),
      id = String(req.params.id);
    mutate(
      req,
      res,
      `cost:carry:${site}:${id}`,
      v,
      () => {
        const row = getCostPeriod(db, site, id);
        expectedCost(row, v.version, "closed");
        const month = nextCostMonth(row.month);
        if (
          db
            .prepare(
              "SELECT id FROM cost_periods WHERE site_id=? AND (month=? OR parent_period_id=?)",
            )
            .get(site, month, id)
        )
          throw new HttpError(
            409,
            "다음 원장이 이미 있습니다. 비어 있어도 계획/입력을 덮어쓰거나 누계를 자동 갱신하지 않습니다.",
          );
        const stored = db
          .prepare(
            "SELECT body,hash FROM cost_closures WHERE id=? AND period_id=?",
          )
          .get(row.current_close_id!, id) as
          { body: string; hash: string } | undefined;
        if (!stored) throw new HttpError(409, "현재 마감본이 없습니다.");
        const source = JSON.parse(stored.body) as CostSnapshot;
        if (
          journalHash(source) !== stored.hash ||
          source.period.id !== id ||
          source.site.id !== site
        )
          throw new HttpError(409, "이월 마감본 출처/해시 불일치");
        const categories = source.totals.byCategory.map((c) => ({
          id: c.id,
          label: c.label,
          plan: c.plan,
          opening: c.cumulative,
          ...(c.scCode ? { scCode: c.scCode } : {}),
        }));
        costTotals(categories, []);
        const nextId = randomUUID(),
          now = new Date().toISOString();
        db.prepare(
          "INSERT INTO cost_periods VALUES(?,?,?,?,?,'open',1,?,?,NULL,?,?,?)",
        ).run(
          nextId,
          site,
          month,
          JSON.stringify(categories),
          "이전 마감본의 정확한 누계 이월",
          id,
          row.current_close_id!,
          req.session.userId!,
          now,
          now,
        );
        // Like PEDIT-SC 익월 생성: copy the closed settings, 작성일 moves to the new month's last day.
        if (source.settings)
          db.prepare("INSERT INTO cost_period_settings VALUES(?,?,?)").run(
            nextId,
            JSON.stringify({
              ...source.settings,
              writtenDate: lastDayOfMonth(month),
            }),
            now,
          );
        return costEvent(
          db,
          req,
          getCostPeriod(db, site, nextId),
          "carried",
          `이전 마감본 ${row.current_close_id}`,
        );
      },
      () => {
        access(req, true, true);
      },
    );
  });
  app.get(base + "/:id/events", (req, res) => {
    access(req, true, true);
    const row = getCostPeriod(
        db,
        String(req.params.siteId),
        String(req.params.id),
      ),
      q = inspectionPage.parse(req.query),
      events = db
        .prepare(
          "SELECT * FROM cost_events WHERE period_id=? ORDER BY version LIMIT 51 OFFSET ?",
        )
        .all(row.id, q.offset) as { data: string }[];
    res.json({
      items: events
        .slice(0, 50)
        .map((e) => ({ ...e, data: JSON.parse(e.data) })),
      hasMore: events.length > 50,
    });
  });
  app.get(base + "/:id/closures", (req, res) => {
    access(req, true, true);
    const row = getCostPeriod(
        db,
        String(req.params.siteId),
        String(req.params.id),
      ),
      q = inspectionPage.parse(req.query),
      rows = db
        .prepare(
          "SELECT id,number,hash,closed_at FROM cost_closures WHERE period_id=? ORDER BY number DESC LIMIT 51 OFFSET ?",
        )
        .all(row.id, q.offset);
    res.json({ items: rows.slice(0, 50), hasMore: rows.length > 50 });
  });
  app.get(base + "/:id/closures/:closureId/print", (req, res) => {
    access(req, true, true);
    const row = getCostPeriod(
        db,
        String(req.params.siteId),
        String(req.params.id),
      ),
      stored = db
        .prepare(
          "SELECT body,hash FROM cost_closures WHERE id=? AND period_id=?",
        )
        .get(String(req.params.closureId), row.id) as
        { body: string; hash: string } | undefined;
    if (!stored) throw new HttpError(404, "마감본을 찾을 수 없습니다.");
    const snapshot = JSON.parse(stored.body) as CostSnapshot;
    if (journalHash(snapshot) !== stored.hash)
      throw new HttpError(409, "마감본 해시가 일치하지 않습니다.");
    res.type("html").send(printCostPeriod(snapshot, stored.hash));
  });
}
// setUTCFullYear avoids Date.UTC's 0-99 → 1900s year mapping.
function lastDayOfMonth(month: string) {
  const d = new Date(0);
  d.setUTCFullYear(Number(month.slice(0, 4)), Number(month.slice(5)), 0);
  return d.toISOString().slice(0, 10);
}
