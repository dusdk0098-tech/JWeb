import { migrateCostDetails } from "./cost-detail-schema.js";
import { migrateCostPhotos, migrateCostPhotoScene } from "./cost-photo-schema.js";
import { migrateAccountGrants } from "./accounts.js";
import { migrateAds } from "./ads.js";
import { migratePublicSetup, migratePublicSetupForm } from "./public-setup-store.js";
import { migrateIncidents } from "./incidents.js";
import { migratePermits } from "./permits.js";
import { migrateQualifications } from "./qualifications.js";
import { migrateSiteSignup } from "./site-signup.js";
import { migrateManagerSignup } from "./manager-signup.js";
import { migrateEducationJoin } from "./education-join.js";
import { migrateEducationReviews } from "./education-catalog-review.js";
import { migratePhotoBoards } from "./photo-board.js";
import { migrateTbmJoin, migrateTbmSignatures } from "./tbm-join.js";
import { migrateWorkPlanFormChecklists } from "./work-plan-form-checklist.js";
import { migrateSiteLibrary } from "./site-library.js";
import { migrateAiUsage, migrateAiKeys } from "./ai-suggest.js";
import { migrateWorkPlanCalculations } from "./work-plan-calculations.js";
import { migratePublicAccess } from "./public-access.js";
import { migrateCostLabor } from "./cost-labor-schema.js";
import { migrateCostSettings } from "./cost-settings-schema.js";
import { migrateDailyInspectionReferences } from "./daily-inspection-migration.js";
import { migrateWorkPlanHazardReferences } from "./work-plan-hazard-reference-migration.js";
import { migrateWorkPlanLifting } from "./work-plan-lifting-migration.js";
import { migrateWorkPlanPlateReports } from "./work-plan-plate-migration.js";
import { migrateWorkPlanDesignations } from "./work-plan-designation-migration.js";
import { migrateWorkPlanPackets } from "./work-plan-packet-migration.js";
import { migrateWorkPlanForms } from "./work-plan-form-schema.js";
import { migrateEducationAttachments } from "./education-attachment-schema.js";
import { migrateCostEvidence } from "./cost-evidence-schema.js";
import { migrateCostPresets } from "./cost-preset-schema.js";
import { migrateStockMinimums } from "./stock-minimum-schema.js";
import { migrateDailyMonthlyRecords } from "./daily-monthly-record-schema.js";
import { migrateWorkPlanAttachments } from "./work-plan-attachment-schema.js";
import { CURRENT_SCHEMA_VERSION } from "./schema-version.js";
import { migrateMinutesPdf } from "./minutes-pdf-schema.js";
import { migrateMinutesAttachments } from "./minutes-attachment-schema.js";
import { migrateInspectionWorkflow } from "./inspection-workflow-schema.js";
import { migrateCatalogUse } from "./education-catalog-use-schema.js";
import { migrateCostBaselines } from "./cost-baseline-schema.js";
import { migratePpeReturns } from "./ppe-return-schema.js";
import { migrateWorkPlanReview } from "./work-plan-review-schema.js";
import { migrateCostStock } from "./cost-stock-schema.js";
import { migrateMinutesRecords } from "./minutes-schema.js";
import { migrateTbmRiskReferences } from "./tbm-risk-schema.js";
import { migrateRiskReuse } from "./risk-reuse-schema.js";
import { migrateRiskPublications } from "./risk-publication-schema.js";
import {
  migrateRiskMethods,
  migrateRiskChecklist,
  migrateRiskNarrative,
} from "./risk-method-schema.js";
import { migrateRiskOpinions } from "./risk-opinion-schema.js";
import { migrateRiskResiduals, migrateRiskResidualMethods, migrateRiskResidualHumanMethods } from "./risk-residual-schema.js";
import { migrateRiskActions } from "./risk-action-schema.js";
import { migrateRiskReview } from "./risk-review-schema.js";
import { migrateRiskCore } from "./risk-schema.js";
import { migrateCompaniesPpe } from "./company-schema.js";
import { migrateWorkStops } from "./work-stop-schema.js";
import { migrateCostSplits } from "./cost-split-schema.js";
import { migrateEducationCatalog } from "./education-catalog-schema.js";
import { migrateWorkPlans } from "./work-plan-schema.js";
import { migrateAccountEpoch } from "./account-schema.js";
import { migrateEquipmentDue } from "./equipment-due-schema.js";
import { migrateStock } from "./stock-schema.js";
import { migrateCosts } from "./cost-schema.js";
import { migrateDailyJournals } from "./daily-journal-schema.js";
import { migrateInspectionSchedules } from "./inspection-schedule-schema.js";
import { migrateHazardAttachments } from "./hazard-attachment-schema.js";
import { migrateEquipment } from "./equipment-schema.js";
import { migrateNotices } from "./notice-schema.js";
import { migrateEducation } from "./education-schema.js";
import { migrateInspectionLinks } from "./inspection-link-schema.js";
import { migrateInspections } from "./inspection-schema.js";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export function openDatabase(path: string) {
  if (path !== ":memory:")
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  db.exec(
    "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;",
  );
  try {
    const version = (
      db.prepare("PRAGMA user_version").get() as { user_version: number }
    ).user_version;
    if (version > CURRENT_SCHEMA_VERSION)
      throw new Error(
        "Database schema is newer than this application; refusing to downgrade.",
      );
    transaction(db, () => {
      if (version < 1)
        db.exec(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, password_hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sites (id TEXT PRIMARY KEY, name TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS memberships (site_id TEXT NOT NULL REFERENCES sites(id), user_id TEXT NOT NULL REFERENCES users(id), role TEXT NOT NULL CHECK(role IN ('manager','editor','viewer')), PRIMARY KEY(site_id,user_id));
    CREATE TABLE IF NOT EXISTS minutes (id TEXT PRIMARY KEY, site_id TEXT NOT NULL REFERENCES sites(id), body TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, author_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (sid TEXT PRIMARY KEY, data TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS idempotency (user_id TEXT NOT NULL, scope TEXT NOT NULL, key TEXT NOT NULL, request TEXT NOT NULL, response TEXT NOT NULL, PRIMARY KEY(user_id,scope,key));
    CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, actor_id TEXT NOT NULL, site_id TEXT NOT NULL, event TEXT NOT NULL, record_id TEXT NOT NULL, at TEXT NOT NULL);
PRAGMA user_version=1;`);
      if (version < 2)
        db.exec(`
        CREATE TABLE workers (
          id TEXT PRIMARY KEY, site_id TEXT NOT NULL REFERENCES sites(id),
          name TEXT NOT NULL, affiliation TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('worker','visitor')),
          active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), version INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(site_id,id));
        CREATE INDEX workers_site ON workers(site_id,name,id);
        CREATE TABLE attendance (
          id TEXT PRIMARY KEY, site_id TEXT NOT NULL REFERENCES sites(id), worker_id TEXT NOT NULL,
          date TEXT NOT NULL, name TEXT NOT NULL, affiliation TEXT NOT NULL, kind TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('present','cancelled')), source TEXT NOT NULL CHECK(source='manual'),
          reason TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
          actor_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
          FOREIGN KEY(site_id,worker_id) REFERENCES workers(site_id,id), UNIQUE(site_id,worker_id,date));
        CREATE INDEX attendance_day ON attendance(site_id,date,affiliation,id);
        CREATE TABLE attendance_history (
          id INTEGER PRIMARY KEY, attendance_id TEXT NOT NULL REFERENCES attendance(id),
          version INTEGER NOT NULL, status TEXT NOT NULL, reason TEXT NOT NULL,
          actor_id TEXT NOT NULL REFERENCES users(id), at TEXT NOT NULL, UNIQUE(attendance_id,version));
        PRAGMA user_version=2;
      `);
      if (version < 3)
        db.exec(`
        CREATE TABLE tbm_sessions (
          id TEXT PRIMARY KEY, site_id TEXT NOT NULL REFERENCES sites(id), body TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('draft','finalized')), version INTEGER NOT NULL DEFAULT 1,
          parent_id TEXT UNIQUE REFERENCES tbm_sessions(id), revision_reason TEXT NOT NULL,
          author_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE INDEX tbm_site ON tbm_sessions(site_id,created_at,id);
        CREATE TABLE tbm_participants (
          session_id TEXT NOT NULL REFERENCES tbm_sessions(id), worker_id TEXT NOT NULL REFERENCES workers(id),
          name TEXT NOT NULL, affiliation TEXT NOT NULL, kind TEXT NOT NULL,
          state TEXT NOT NULL CHECK(state IN ('pending','present','absent')),
          recorded_by TEXT REFERENCES users(id), recorded_at TEXT,
          PRIMARY KEY(session_id,worker_id));
        CREATE TABLE tbm_snapshots (
          session_id TEXT PRIMARY KEY REFERENCES tbm_sessions(id), body TEXT NOT NULL,
          hash TEXT NOT NULL, finalized_by TEXT NOT NULL REFERENCES users(id), finalized_at TEXT NOT NULL);
        CREATE TRIGGER tbm_snapshot_no_update BEFORE UPDATE ON tbm_snapshots BEGIN SELECT RAISE(ABORT,'TBM snapshot is immutable'); END;
        CREATE TRIGGER tbm_snapshot_no_delete BEFORE DELETE ON tbm_snapshots BEGIN SELECT RAISE(ABORT,'TBM snapshot is immutable'); END;
        PRAGMA user_version=3;
      `);
      if (version < 4)
        db.exec(`
        CREATE TABLE hazard_reports (
          id TEXT PRIMARY KEY, site_id TEXT NOT NULL REFERENCES sites(id), owner_id TEXT NOT NULL REFERENCES users(id),
          body TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('draft','reported','assigned','review_requested','closed')),
          version INTEGER NOT NULL DEFAULT 1, assignee_id TEXT REFERENCES users(id), due_date TEXT,
          remediation TEXT NOT NULL DEFAULT '', remediator_id TEXT REFERENCES users(id),
          submitted_snapshot TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE INDEX hazards_site ON hazard_reports(site_id,status,updated_at,id);
        CREATE TABLE hazard_events (
          id INTEGER PRIMARY KEY, report_id TEXT NOT NULL REFERENCES hazard_reports(id), version INTEGER NOT NULL,
          event TEXT NOT NULL, from_status TEXT, to_status TEXT NOT NULL, note TEXT NOT NULL,
          actor_id TEXT NOT NULL REFERENCES users(id), actor_name TEXT NOT NULL, at TEXT NOT NULL, snapshot TEXT NOT NULL,
          UNIQUE(report_id,version));
        CREATE TRIGGER hazard_event_no_update BEFORE UPDATE ON hazard_events BEGIN SELECT RAISE(ABORT,'Hazard event is immutable'); END;
        CREATE TRIGGER hazard_event_no_delete BEFORE DELETE ON hazard_events BEGIN SELECT RAISE(ABORT,'Hazard event is immutable'); END;
        CREATE TRIGGER hazard_original_immutable BEFORE UPDATE ON hazard_reports
          WHEN OLD.submitted_snapshot IS NOT NULL AND NEW.submitted_snapshot IS NOT OLD.submitted_snapshot
          BEGIN SELECT RAISE(ABORT,'Submitted original is immutable'); END;
        CREATE TRIGGER hazard_submitted_body_immutable BEFORE UPDATE ON hazard_reports
          WHEN OLD.status != 'draft' AND NEW.body != OLD.body
          BEGIN SELECT RAISE(ABORT,'Submitted report body is immutable'); END;
        PRAGMA user_version=4;
      `);
      if (version < 5) migrateInspections(db);
      if (version < 6) migrateInspectionLinks(db);
      if (version < 7) migrateEducation(db);
      if (version < 8) migrateNotices(db);
      if (version < 9) migrateEquipment(db);
      if (version < 10) migrateHazardAttachments(db);
      if (version < 11) migrateInspectionSchedules(db);
      if (version < 12) migrateDailyJournals(db);
      if (version < 13) migrateCosts(db);
      if (version < 14) migrateStock(db);
      if (version < 15) migrateEquipmentDue(db);
      if (version < 16) migrateAccountEpoch(db);
      if (version < 17) migrateWorkPlans(db);
      if (version < 18) migrateEducationCatalog(db);
      if (version < 19) migrateCostSplits(db);
      if (version < 20) migrateWorkStops(db);
      if (version < 21) migrateCompaniesPpe(db);
      if (version < 22) migrateRiskCore(db);
      if (version < 23) migrateRiskReview(db);
      if (version < 24) migrateRiskActions(db);
      if (version < 25) migrateRiskResiduals(db);
      if (version < 26) migrateRiskOpinions(db);
      if (version < 27) migrateRiskMethods(db);
      if (version < 28) migrateRiskChecklist(db);
      if (version < 29) migrateRiskResidualMethods(db);
      if (version < 30) migrateRiskNarrative(db);
      if (version < 31) migrateRiskPublications(db);
      if (version < 32) migrateRiskReuse(db);
      if (version < 33) migrateTbmRiskReferences(db);
      if (version < 34) migrateMinutesRecords(db);
      if (version < 35) migrateCostStock(db);
      if (version < 36) migrateWorkPlanReview(db);
      if (version < 37) migratePpeReturns(db);
      if (version < 38) migrateCostBaselines(db);
      if (version < 39) migrateCatalogUse(db);
      if (version < 40) migrateInspectionWorkflow(db);
      if (version < 41) migrateMinutesAttachments(db);
      if (version < 42) migrateMinutesPdf(db);
      if (version < 43) migrateWorkPlanAttachments(db);
      if (version < 44) migrateDailyMonthlyRecords(db);
      if (version < 45) migrateRiskResidualHumanMethods(db);
      if (version < 46) migrateStockMinimums(db);
      if (version < 47) migrateCostPresets(db);
      if (version < 48) migrateCostEvidence(db);
      if (version < 49) migrateEducationAttachments(db);
      if (version < 50) migrateWorkPlanForms(db);
      if (version < 51) migrateWorkPlanPackets(db);
      if (version < 52) migrateWorkPlanDesignations(db);
      if (version < 53) migrateWorkPlanPlateReports(db);
      if (version < 54) migrateWorkPlanLifting(db);
      if (version < 55) migrateWorkPlanHazardReferences(db);
      if (version < 56) migrateDailyInspectionReferences(db);
      if (version < 57) migrateCostSettings(db);
      if (version < 58) migrateCostLabor(db);
      if (version < 59) migrateCostDetails(db);
      if (version < 60) migrateCostPhotos(db);
      if (version < 61) migrateEducationReviews(db);
      if (version < 62) migratePhotoBoards(db);
      if (version < 63) migrateTbmJoin(db);
      if (version < 64) migrateTbmSignatures(db);
      if (version < 65) migrateWorkPlanFormChecklists(db);
      if (version < 66) migrateSiteLibrary(db);
      if (version < 67) migrateAiUsage(db);
      if (version < 68) migrateAiKeys(db);
      if (version < 69) migrateWorkPlanCalculations(db);
      if (version < 70) migratePublicAccess(db);
      if (version < 71) migrateCostPhotoScene(db);
      if (version < 72) migrateAccountGrants(db);
      if (version < 73) migrateAds(db);
      if (version < 74) migratePublicSetup(db);
      if (version < 75) migratePublicSetupForm(db);
      if (version < 76) migrateIncidents(db);
      if (version < 77) migratePermits(db);
      if (version < 78) migrateQualifications(db);
      if (version < 79) migrateSiteSignup(db);
      if (version < 80) migrateManagerSignup(db);
    });
    // 81 rebuilds two tables to widen a CHECK. SQLite needs foreign-key enforcement off for that and ignores the pragma
    // inside a transaction, so it runs as its own transaction; the migration checks the references itself.
    if (version < 81) {
      db.exec("PRAGMA foreign_keys=OFF");
      try {
        transaction(db, () => migrateEducationJoin(db));
      } finally {
        db.exec("PRAGMA foreign_keys=ON");
      }
    }
  } catch (error) {
    db.close();
    throw error;
  }
  return db;
}
export type Db = DatabaseSync;
export function transaction<T>(db: Db, action: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = action();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
export function audit(
  db: Db,
  actor: string,
  site: string,
  event: string,
  record: string,
) {
  db.prepare(
    "INSERT INTO audit(actor_id,site_id,event,record_id,at) VALUES(?,?,?,?,?)",
  ).run(actor, site, event, record, new Date().toISOString());
}
