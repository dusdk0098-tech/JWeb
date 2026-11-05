import { registerCostOutput } from "./cost-output.js";
import { registerEducationAttachments, isEducationUpload } from "./education-attachment-routes.js";
import { registerHazardInbox } from "./hazard-inbox.js";
import { registerCostEvidenceComparison } from "./cost-evidence-comparison-routes.js";
import { registerCostEvidenceRequests } from "./cost-evidence-request-routes.js";
import { registerCostEvidence, isCostEvidenceUpload } from "./cost-evidence-routes.js";
import { registerCostPhotos, isCostPhotoUpload } from "./cost-photo-routes.js";
import { registerLegalForms } from "./cost-legal-forms.js";
import { registerCostPresets } from "./cost-preset-routes.js";
import { registerDailyMonthlyRecords } from "./daily-monthly-record-routes.js";
import { registerDailyJournalRegister } from "./daily-journal-register.js";
import { registerWorkPlanAttachments, isWorkPlanUpload } from "./work-plan-attachment-routes.js";
import { registerMinutesAttachments, isMinutesUpload } from "./minutes-attachment-routes.js";
import { boundedUploadReader, boundedRejectedUploadDrainer } from "./bounded-upload.js";
import { registerInspectionWorkflow } from "./inspection-workflow-routes.js";
import { registerEducationTransfer } from "./education-transfer-routes.js";
import { registerCatalogUse } from "./education-catalog-use-routes.js";
import { registerEducationReviews } from "./education-catalog-review.js";
import { registerPhotoBoards, isPhotoBoardUpload } from "./photo-board.js";
import { registerTbmJoin, registerTbmJoinPublic } from "./tbm-join.js";
import { registerSiteJoinLinks, registerSiteSignupPublic, registerWorkerProfile } from "./site-signup.js";
import { registerAccounts, registerSetup } from "./accounts.js";
import { registerAds, type AdsConfig } from "./ads.js";
import { registerWorkPlanFormChecklists } from "./work-plan-form-checklist.js";
import { registerWorkPlanCalculations } from "./work-plan-calculations.js";
import { registerSiteLibrary, isLibraryUpload } from "./site-library.js";
import { registerAiSuggest, anthropicSuggest, type AiConfig, type AiSuggest } from "./ai-suggest.js";
import { registerPublicAccess, type PublicRuntime } from "./public-access.js";
import { defaultSetupDeps, registerPublicSetup, type PublicSetupDeps } from "./public-setup.js";
import { rateLimit } from "express-rate-limit";
import { registerCostBaselines } from "./cost-baseline-routes.js";
import { registerPpeReturns } from "./ppe-return-routes.js";
import { registerWorkPlanReview } from "./work-plan-review.js";
import { registerCostStock } from "./cost-stock-routes.js";
import { registerMinutesRecords } from "./minutes-records.js";
import { registerMinutesFollowups } from "./minutes-followups.js";
import { minutesRow, minutesRecord, fixedMinutes } from "./minutes-model.js";
import { printFinalMinutes } from "./minutes-print.js";
import { registerRiskRegister } from "./risk-register.js";
import { registerRiskInbox } from "./risk-inbox.js";
import { registerRiskDocumentExport } from "./risk-document-export.js";
import { registerRiskReuse } from "./risk-reuse.js";
import { registerRiskPublications } from "./risk-publications.js";
import { registerRiskOverview } from "./risk-overview.js";
import { registerRiskOpinions } from "./risk-opinions.js";
import { registerRiskDocumentReports } from "./risk-document-report.js";
import { registerRiskResiduals } from "./risk-residuals.js";
import { registerRiskActions } from "./risk-actions.js";
import { registerRiskReview } from "./risk-review.js";
import { registerRiskCore } from "./risk-core.js";
import { registerPpe } from "./ppe.js";
import { registerCompanies } from "./companies.js";
import { registerWorkStops } from "./work-stops.js";
import { registerCostSearch } from "./cost-search-routes.js";
import { registerCostSplits } from "./cost-split-routes.js";
import { registerCostBatch } from "./cost-batch-routes.js";
import { registerManagerOverview } from "./manager-overview-routes.js";
import { registerEducationCatalog } from "./education-catalog.js";
import { registerWorkPlans } from "./work-plans.js";
import { registerAuthentication } from "./authentication.js";
import { registerEquipmentDue } from "./equipment-due.js";
import { registerStockMinimums } from "./stock-minimum-routes.js";
import { registerStock } from "./stock.js";
import { registerCostPeriods } from "./cost-periods.js";
import { registerCostDashboard } from "./cost-dashboard.js";
import { registerCostExpenses } from "./cost-expenses.js";
import { registerDailyMonthlyReports } from "./daily-monthly-routes.js";
import { registerDailyJournals } from "./daily-journals.js";
import { registerInspectionSchedules } from "./inspection-schedules.js";
import {
  isHazardUpload,
  registerHazardAttachments,
} from "./hazard-attachments.js";
import { registerEquipmentRoutes } from "./equipment.js";
import { registerEquipmentUseRoutes } from "./equipment-uses.js";
import { registerNoticeRoutes } from "./notices.js";
import { registerEducationRoutes } from "./education.js";
import { registerInspectionLinkRoutes } from "./inspection-links.js";
import { registerInspectionTemplates } from "./inspection-templates.js";
import { seedDefaultTemplates } from "./default-templates.js";
import { registerIncidents } from "./incidents.js";
import { registerPermits } from "./permits.js";
import { registerQualifications } from "./qualifications.js";
import { registerInspectionRoutes } from "./inspections.js";
import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import session from "express-session";
import helmet from "helmet";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { audit, type Db } from "./db.js";
import { SqliteSessionStore } from "./session-store.js";
import {
  meetingInput,
  memberInput,
  revision,
  siteInput,
} from "./validation.js";
import { HttpError, siteOperations } from "./site-operations.js";
import { registerHazardRoutes } from "./hazards.js";
import { registerTbmRoutes } from "./tbm.js";
import { registerAttendanceRoutes } from "./attendance.js";
import { printMeeting } from "./print.js";

declare module "express-session" {
  interface SessionData {
    userId?: string;
    csrf?: string;
    issuedAt?: number;
    authEpoch?: number;
    workerUnlockedAt?: number; // 근로자 '내 정보': date of birth re-entered at this time
  }
}
export type AppConfig = {
  secret: string;
  origin: string;
  adsEnabled?: boolean; // legacy flag, no longer read: ads run whenever `ads` is set
  ads?: AdsConfig; // 결정 6: the developer's ad feed (server/ads.ts); absent only in tests (no switch in the app)
  // SEC-LOCAL-01 A안: read-only permission findings computed at startup, shown to managers.
  localPermissionWarnings?: string[];
  // SC-04: .env AI config (legacy, wins over the in-app setting) and the call used for in-app keys (tests inject a fake).
  ai?: AiConfig;
  aiSuggest?: AiSuggest;
  // Self-hosting: the https origin phones use (set only when this PC serves a domain), whether a local tunnel proxies requests,
  // and what the running process did with the settings (shown on the settings screen).
  publicOrigin?: string;
  trustProxy?: boolean;
  publicRuntime?: PublicRuntime;
  publicSetup?: Partial<PublicSetupDeps>; // 외부 접속 마법사: tests replace the router, Cloudflare and OS checks
};
export async function createApp(db: Db, config: AppConfig) {
  if (config.secret.length < 32 || config.secret.startsWith("replace-"))
    throw new Error("Set a random SESSION_SECRET (32+ characters).");
  if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(config.origin))
    throw new Error("This foundation allows a loopback HTTP origin only.");
  if (config.publicOrigin && !/^https:\/\/[a-z0-9.-]+$/.test(config.publicOrigin))
    throw new Error("The public origin must be https://<domain>.");
  const origins = [config.origin, config.publicOrigin].filter(Boolean);
  const app = express();
  app.disable("x-powered-by");
  if (config.trustProxy) app.set("trust proxy", "loopback");
  app.use(
    helmet({
      strictTransportSecurity: config.publicOrigin ? { maxAge: 15552000 } : false,
      contentSecurityPolicy: {
        directives: {
          "upgrade-insecure-requests": null,
          "script-src": ["'self'"],
          "style-src": ["'self'"],
          "img-src": ["'self'", "data:"],
          "connect-src": ["'self'"],
        },
      },
    }),
  );
  const isUpload = (method: string, path: string) =>
    isHazardUpload(method, path) || isMinutesUpload(method, path) || isWorkPlanUpload(method, path) || isCostEvidenceUpload(method, path) || isCostPhotoUpload(method, path) || isPhotoBoardUpload(method, path) || isLibraryUpload(method, path) || isEducationUpload(method, path);
  app.use("/api", (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (isUpload(_req.method, _req.originalUrl.split("?")[0]))
      res.set("Connection", "close");
    next();
  });
  const jsonBody = express.json({ limit: "256kb" });
  app.use((req, res, next) =>
    isUpload(req.method, req.path) ? next() : jsonBody(req, res, next),
  );
  app.use(
    session({
      name: "pedit.sid",
      secret: config.secret,
      store: new SqliteSessionStore(db),
      resave: false,
      saveUninitialized: false,
      rolling: false,
      cookie: {
        httpOnly: true,
        sameSite: "strict",
        secure: config.publicOrigin ? "auto" : false,
        maxAge: 8 * 60 * 60 * 1000,
      },
    }),
  );
  app.use("/api", (req, res, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      if (!origins.includes(req.get("origin") ?? ""))
        return res
          .status(403)
          .json({ error: "요청 출처를 확인할 수 없습니다." });
      const received = req.get("x-csrf-token") || "",
        expected = req.session.csrf || "";
      if (
        !expected ||
        Buffer.byteLength(received) !== Buffer.byteLength(expected) ||
        !timingSafeEqual(Buffer.from(received), Buffer.from(expected))
      )
        return res
          .status(403)
          .json({ error: "보안 토큰이 만료되었습니다. 새로고침해 주세요." });
    }
    next();
  });
  // Reachable from the internet: also cap failed logins and join checks per client address (accounts/links are capped already).
  if (config.publicOrigin)
    app.post(["/api/login", "/api/join"], rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, skipSuccessfulRequests: true, standardHeaders: "draft-8", legacyHeaders: false,
      message: { error: "이 주소에서 시도가 많습니다. 15분 후 다시 시도해 주세요." } }));
  const publicRuntime = config.publicRuntime ?? { mode: "off", state: "꺼짐" };
  registerPublicAccess(app, db, publicRuntime, config.secret);
  registerPublicSetup(app, db, publicRuntime, config.secret, { ...defaultSetupDeps(Number(new URL(config.origin).port) || 80), ...config.publicSetup });
  registerTbmJoinPublic(app, db);
  registerSiteSignupPublic(app, db); // 근로자 QR 가입, before the sign-in gate
  registerSetup(app, db); // anonymous first-operator route, before the sign-in gate
  await registerAuthentication(app, db, () => !!config.ads);
  const { access, mutate } = siteOperations(db);
  registerAccounts(app, db, { access, mutate });
  registerWorkerProfile(app, db);
  app.locals.adsRefresh = registerAds(app, db, config.ads).refresh;
  registerAttendanceRoutes(app, db, { access, mutate });
  registerTbmRoutes(app, db, { access, mutate });
  registerHazardRoutes(app, db, { access, mutate });
  registerWorkStops(app, db, { access, mutate });
  registerCompanies(app, db, { access, mutate });
  registerCostStock(app, db, { access, mutate });
  registerRiskCore(app, db, { access, mutate });
  registerRiskRegister(app, db, { access, mutate });
  registerRiskReuse(app, db, { access, mutate });
  registerRiskReview(app, db, { access, mutate });
  registerRiskActions(app, db, { access, mutate });
  registerRiskResiduals(app, db, { access, mutate });
  registerRiskDocumentReports(app, db, { access, mutate });
  registerRiskDocumentExport(app, db, { access, mutate });
  registerRiskOpinions(app, db, { access, mutate });
  registerRiskOverview(app, db, { access, mutate });
  registerRiskInbox(app, db, { access, mutate });
  registerMinutesRecords(app, db, { access, mutate });
  registerMinutesFollowups(app, db, { access, mutate });
  registerRiskPublications(app, db, { access, mutate });
  registerPpe(app, db, { access, mutate });
  registerPpeReturns(app, db, { access, mutate });
  const attachmentReader=boundedUploadReader();
  registerHazardAttachments(app, db, { access, mutate },attachmentReader);
  registerMinutesAttachments(app,db,{access,mutate},attachmentReader);
  registerWorkPlanAttachments(app,db,{access,mutate},attachmentReader);
  registerEducationAttachments(app,db,{access,mutate},attachmentReader);
  registerCostEvidence(app,db,{access,mutate},attachmentReader);
  registerCostPhotos(app,db,{access,mutate},attachmentReader);
  registerLegalForms(app,db,{access,mutate});
  registerPhotoBoards(app,db,{access,mutate},attachmentReader);
  registerTbmJoin(app,db,{access,mutate});
  registerWorkPlanFormChecklists(app,db,{access,mutate});
  registerWorkPlanCalculations(app,db,{access,mutate});
  registerSiteLibrary(app,db,{access,mutate},attachmentReader);
  registerAiSuggest(app,db,{access,mutate},{ env: config.ai, suggest: config.aiSuggest ?? anthropicSuggest(), secret: config.secret });
  registerCostEvidenceRequests(app,db,{access,mutate});
  registerCostEvidenceComparison(app,db,{access,mutate});
  registerCostOutput(app,db,{access,mutate});
  registerHazardInbox(app,db,{access,mutate});
  registerInspectionTemplates(app, db, { access, mutate });
  registerInspectionRoutes(app, db, { access, mutate });
  registerInspectionSchedules(app, db, { access, mutate });
  registerInspectionWorkflow(app, db, { access, mutate });
  registerDailyJournals(app, db, { access, mutate });
  registerDailyMonthlyReports(app, db, { access, mutate });
  registerDailyMonthlyRecords(app, db, { access, mutate });
  registerDailyJournalRegister(app, db, { access, mutate });
  registerManagerOverview(app, db);
  app.get("/api/local-permissions", (req, res) => {
    if (!db.prepare("SELECT 1 FROM memberships WHERE user_id=? AND role='manager' LIMIT 1").get(req.session.userId!))
      throw new HttpError(403, "관리자만 확인할 수 있습니다.");
    res.json({ warnings: config.localPermissionWarnings ?? [] });
  });
  registerEducationTransfer(app, db, { access, mutate });
  registerEducationCatalog(app, db, { access, mutate });
  registerCatalogUse(app, db, { access, mutate });
  registerEducationReviews(app, db, { access, mutate });
  registerWorkPlans(app, db, { access, mutate });
  registerWorkPlanReview(app, db, { access, mutate });
  registerEquipmentDue(app, db, { access, mutate });
  registerStock(app, db, { access, mutate });
  registerStockMinimums(app, db, { access, mutate });
  registerCostBaselines(app, db, { access, mutate });
  registerCostPeriods(app, db, { access, mutate });
  registerCostDashboard(app, db, { access, mutate });
  registerCostExpenses(app, db, { access, mutate });
  registerCostPresets(app, db, { access, mutate });
  registerCostBatch(app, db, { access, mutate });
  registerCostSplits(app, db, { access, mutate });
  registerCostSearch(app, db, { access, mutate });
  registerInspectionLinkRoutes(app, db, { access, mutate });
  registerEducationRoutes(app, db, { access, mutate });
  registerNoticeRoutes(app, db, { access, mutate });
  registerEquipmentRoutes(app, db, { access, mutate });
  registerEquipmentUseRoutes(app, db, { access, mutate });
  registerIncidents(app, db, { access, mutate });
  registerPermits(app, db, { access, mutate });
  registerQualifications(app, db, { access, mutate });
  registerSiteJoinLinks(app, db, { access, mutate });
  app.get("/api/sites", (req, res) =>
    res.json(
      db
        .prepare(
          "SELECT s.*,m.role,(SELECT count(*) FROM memberships x WHERE x.site_id=s.id AND x.role='manager') AS managers FROM sites s JOIN memberships m ON s.id=m.site_id WHERE m.user_id=? ORDER BY s.name",
        )
        .all(req.session.userId!),
    ),
  );
  app.post("/api/sites", (req, res) => {
    const input = siteInput.parse(req.body);
    mutate(
      req,
      res,
      "site:create",
      input,
      () => {
        const id = randomUUID();
        db.prepare("INSERT INTO sites(id,name) VALUES(?,?)").run(
          id,
          input.name,
        );
        db.prepare("INSERT INTO memberships VALUES(?,?,?)").run(
          id,
          req.session.userId!,
          "manager",
        );
        audit(db, req.session.userId!, id, "site.created", id);
        seedDefaultTemplates(db, id, req.session.userId!); // 검토 F1: the first inspection needs no form design
        return { id, name: input.name, version: 1, role: "manager" };
      },
      () => {
        /* New site: live authenticated session only, checked by mutate. */
      },
    );
  });
  app.patch("/api/sites/:siteId", (req, res) => {
    access(req, true, true);
    const input = siteInput.extend({ version: revision }).parse(req.body);
    mutate(
      req,
      res,
      `site:${req.params.siteId}:edit`,
      input,
      () => {
        const changed = db
          .prepare(
            "UPDATE sites SET name=?,version=version+1 WHERE id=? AND version=?",
          )
          .run(input.name, String(req.params.siteId), input.version);
        if (!changed.changes)
          throw new HttpError(
            409,
            "현장이 변경되었습니다. 다시 불러와 주세요.",
          );
        audit(
          db,
          req.session.userId!,
          String(req.params.siteId),
          "site.updated",
          String(req.params.siteId),
        );
        return { version: input.version + 1 };
      },
      () => {
        access(req, true, true);
      },
    );
  });
  app.get("/api/sites/:siteId/members", (req, res) => {
    access(req, false, true);
    res.json(
      db
        .prepare(
          "SELECT u.id,CASE WHEN w.user_id IS NULL THEN u.email ELSE '근로자 · ' || w.affiliation END email,u.name,m.role FROM memberships m JOIN users u ON u.id=m.user_id LEFT JOIN worker_accounts w ON w.user_id=u.id WHERE site_id=? ORDER BY u.name",
        )
        .all(String(req.params.siteId)),
    );
  });
  app.put("/api/sites/:siteId/members", (req, res) => {
    access(req, true, true);
    const input = memberInput.parse(req.body);
    const site = String(req.params.siteId);
    mutate(
      req,
      res,
      `site:${site}:member`,
      input,
      () => {
        const user = db
          .prepare("SELECT id FROM users WHERE email=?")
          .get(input.email) as { id: string } | undefined;
        if (!user)
          throw new HttpError(
            400,
            "등록된 계정인지 운영 담당자에게 확인해 주세요.",
          );
        const current = db
          .prepare("SELECT role FROM memberships WHERE site_id=? AND user_id=?")
          .get(site, user.id) as { role: string } | undefined;
        const managers = db
          .prepare(
            "SELECT count(*) AS n FROM memberships WHERE site_id=? AND role='manager'",
          )
          .get(site) as { n: number };
        if (
          current?.role === "manager" &&
          input.role !== "manager" &&
          managers.n <= 1
        )
          throw new HttpError(
            409,
            "마지막 현장 관리자의 권한을 내릴 수 없습니다.",
          );
        db.prepare(
          "INSERT INTO memberships VALUES(?,?,?) ON CONFLICT(site_id,user_id) DO UPDATE SET role=excluded.role",
        ).run(site, user.id, input.role);
        audit(db, req.session.userId!, site, "member.changed", user.id);
        return { ok: true };
      },
      () => {
        access(req, true, true);
      },
    );
  });
  app.delete("/api/sites/:siteId/members/:userId", (req, res) => {
    access(req, true, true);
    const site = String(req.params.siteId),
      user = String(req.params.userId);
    mutate(
      req,
      res,
      `site:${site}:remove:${user}`,
      {},
      () => {
        const row = db
          .prepare("SELECT role FROM memberships WHERE site_id=? AND user_id=?")
          .get(site, user) as { role: string } | undefined;
        const managers = db
          .prepare(
            "SELECT count(*) AS n FROM memberships WHERE site_id=? AND role='manager'",
          )
          .get(site) as { n: number };
        if (row?.role === "manager" && managers.n <= 1)
          throw new HttpError(409, "마지막 현장 관리자는 삭제할 수 없습니다.");
        db.prepare("DELETE FROM memberships WHERE site_id=? AND user_id=?").run(
          site,
          user,
        );
        audit(db, req.session.userId!, site, "member.removed", user);
        return { ok: true };
      },
      () => {
        access(req, true, true);
      },
    );
  });
  app.get("/api/sites/:siteId/minutes", (req, res) => {
    access(req);
    const offset = z.coerce
      .number()
      .int()
      .min(0)
      .max(1000000)
      .parse(req.query.offset || 0);
    const rows = db
      .prepare(
        "SELECT * FROM minutes WHERE site_id=? ORDER BY created_at DESC,id DESC LIMIT 51 OFFSET ?",
      )
      .all(String(req.params.siteId), offset) as {id:string}[];
    res.json({
      items: rows.slice(0, 50).map(row=>minutesRecord(db,minutesRow(db,String(req.params.siteId),row.id))),
      hasMore: rows.length > 50,
    });
  });
  function getMeeting(req: Request) {
    access(req);
    return minutesRow(db,String(req.params.siteId),String(req.params.id));
  }
  app.get("/api/sites/:siteId/minutes/:id", (req, res) =>
    res.json(minutesRecord(db,getMeeting(req))),
  );
  app.get("/api/sites/:siteId/minutes/:id/print", (req, res) => {
    const row = getMeeting(req);
    if(row.status==="finalized"){res.type("html").send(printFinalMinutes(fixedMinutes(db,row)));return;}
    const site = db
      .prepare("SELECT name FROM sites WHERE id=?")
      .get(row.site_id) as { name: string };
    const author = db
      .prepare("SELECT name FROM users WHERE id=?")
      .get(row.author_id) as { name: string };
    res.type("html").send(printMeeting(minutesRecord(db,row), site.name, author.name));
  });
  app.post("/api/sites/:siteId/minutes", (req, res) => {
    access(req, true);
    const input = meetingInput.parse(req.body),
      site = String(req.params.siteId);
    mutate(
      req,
      res,
      `site:${site}:minutes:create`,
      input,
      () => {
        const id = randomUUID(),
          now = new Date().toISOString();
        db.prepare("INSERT INTO minutes VALUES(?,?,?,1,?,?,?)").run(
          id,
          site,
          JSON.stringify(input),
          req.session.userId!,
          now,
          now,
        );
        audit(db, req.session.userId!, site, "minutes.created", id);
        return minutesRecord(db,minutesRow(db,site,id));
      },
      () => {
        access(req, true);
      },
    );
  });
  app.put("/api/sites/:siteId/minutes/:id", (req, res) => {
    access(req, true);
    const { version, ...input } = meetingInput
        .extend({ version: revision })
        .parse(req.body),
      site = String(req.params.siteId),
      id = String(req.params.id);
    mutate(
      req,
      res,
      `site:${site}:minutes:${id}:edit`,
      { version, ...input },
      () => {
        if(getMeeting(req).status!=="draft")throw new HttpError(409,"확정 회의록은 정정 초안을 만드세요.");
        const changed = db
          .prepare(
            "UPDATE minutes SET body=?,version=version+1,updated_at=? WHERE id=? AND site_id=? AND version=?",
          )
          .run(
            JSON.stringify(input),
            new Date().toISOString(),
            id,
            site,
            version,
          );
        if (!changed.changes)
          throw new HttpError(
            409,
            "다른 사람이 수정했습니다. 현재 입력을 복사한 뒤 목록에서 최신 회의록을 다시 열어 주세요.",
          );
        audit(db, req.session.userId!, site, "minutes.updated", id);
        return minutesRecord(db,minutesRow(db,site,id));
      },
      () => {
        access(req, true);
      },
    );
  });
  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "API를 찾을 수 없습니다." }),
  );
  const discardRejectedUpload = boundedRejectedUploadDrainer();
  app.use(
    async (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
      if (error instanceof HttpError && error.status === 413 &&
        (isHazardUpload(_req.method, _req.path) || isMinutesUpload(_req.method, _req.path) ||
          isWorkPlanUpload(_req.method, _req.path) || isCostEvidenceUpload(_req.method, _req.path) || isCostPhotoUpload(_req.method, _req.path) || isPhotoBoardUpload(_req.method, _req.path) || isLibraryUpload(_req.method, _req.path) ||
          isEducationUpload(_req.method, _req.path)))
        await discardRejectedUpload(_req);
      if (error instanceof z.ZodError)
        return res.status(400).json({
          error: "입력값을 확인해 주세요.",
          fields: error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        });
      if (error instanceof HttpError)
        return res.status(error.status).json({ error: error.message });
      if (
        error instanceof SyntaxError ||
        (error as { type?: string })?.type === "entity.too.large"
      )
        return res
          .status(400)
          .json({ error: "요청 형식 또는 크기를 확인해 주세요." });
      // Never log request bodies, cookies, credentials or meeting data.
      console.error("API internal error");
      res
        .status(500)
        .json({ error: "저장하지 못했습니다. 잠시 후 다시 시도해 주세요." });
    },
  );
  return app;
}
