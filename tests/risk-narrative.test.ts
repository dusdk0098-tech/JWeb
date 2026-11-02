import { migrateCostDetails } from "../server/cost-detail-schema.js";
import { migrateCostPhotos } from "../server/cost-photo-schema.js";
import { migrateEducationReviews } from "../server/education-catalog-review.js";
import { migratePhotoBoards } from "../server/photo-board.js";
import { migrateTbmJoin, migrateTbmSignatures } from "../server/tbm-join.js";
import { migrateWorkPlanFormChecklists } from "../server/work-plan-form-checklist.js";
import { migrateSiteLibrary } from "../server/site-library.js";
import { migrateAiUsage, migrateAiKeys } from "../server/ai-suggest.js";
import { migrateWorkPlanCalculations } from "../server/work-plan-calculations.js";
import { migratePublicAccess } from "../server/public-access.js";
import { migrateCostPhotoScene } from "../server/cost-photo-schema.js";
import { migrateAccountGrants } from "../server/accounts.js";
import { migrateAds } from "../server/ads.js";
import { migratePublicSetup, migratePublicSetupForm } from "../server/public-setup-store.js";
import { migrateIncidents } from "../server/incidents.js";
import { migrateCostLabor } from "../server/cost-labor-schema.js";
import { migrateCostSettings } from "../server/cost-settings-schema.js";
import { migrateDailyInspectionReferences } from "../server/daily-inspection-migration.js";
import { migrateWorkPlanHazardReferences } from "../server/work-plan-hazard-reference-migration.js";
import { migrateWorkPlanLifting } from "../server/work-plan-lifting-migration.js";
import { migrateWorkPlanPlateReports } from "../server/work-plan-plate-migration.js";
import { migrateWorkPlanDesignations } from "../server/work-plan-designation-migration.js";
import { migrateWorkPlanPackets } from "../server/work-plan-packet-migration.js";
import { migrateWorkPlanForms } from "../server/work-plan-form-schema.js";
import { migrateEducationAttachments } from "../server/education-attachment-schema.js";
import { migrateCostEvidence } from "../server/cost-evidence-schema.js";
import { migrateCostPresets } from "../server/cost-preset-schema.js";
import { CURRENT_SCHEMA_VERSION } from "../server/schema-version.js";
import { migrateStockMinimums } from "../server/stock-minimum-schema.js";
import { migrateRiskResidualHumanMethods } from "../server/risk-residual-schema.js";
import { migrateDailyMonthlyRecords } from "../server/daily-monthly-record-schema.js";
import { migrateWorkPlanAttachments } from "../server/work-plan-attachment-schema.js";
import { migrateMinutesPdf } from "../server/minutes-pdf-schema.js";
import { migrateMinutesAttachments } from "../server/minutes-attachment-schema.js";
import { migrateInspectionWorkflow } from "../server/inspection-workflow-schema.js";
import { migrateCatalogUse } from "../server/education-catalog-use-schema.js";
import { migrateCostBaselines } from "../server/cost-baseline-schema.js";
import { migratePpeReturns } from "../server/ppe-return-schema.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { methodFixture } from "./fixtures/risk-method-fixture.js";
import { emptyNarrativeQuestions, type NarrativeAssessment } from "../server/risk-narrative-model.js";
import { validateRiskSubmission } from "../server/risk-review.js";
const criteria = () => ({
  name: "Synthetic narrative", method: "narrative" as const, rationale: "Human own policy, no legal default",
  questions: Object.fromEntries(Object.keys(emptyNarrativeQuestions()).map((key) => [key, { prompt: `Own <${key}> question`, guidance: `Own & ${key} guidance` }])) as ReturnType<typeof emptyNarrativeQuestions>,
});
const body = (): NarrativeAssessment => ({
  title: "Synthetic narrative", date: "2026-10-28", timing: "수시", trigger: "Synthetic change", workScope: "Synthetic scope", method: "narrative",
  hazards: [{ id: randomUUID(), task: "Synthetic task", location: "", category: "", accidentType: "", scenario: "Human hazard text", harm: "Human harm text", exposedGroup: "Generic group", reference: "Human evidence note", currentControls: "Human existing controls", judgmentReason: "Explicitly unresolved human judgment", exposurePath: "Human exposure route", additionalPlanDecision: "further_review", plans: [] }],
});
const plan = { action: "Human plan", controlType: "관리적" as const, ownerNote: "Team", due: "2026-11-01", priorityNote: "", preconditions: "" };
async function createNarrative(f: Awaited<ReturnType<typeof methodFixture>>, b = body()) {
  const c = criteria();
  let r = await f.send("post", "/risk-criteria", c);
  assert.equal(r.status, 200);
  const cid = r.body.id;
  r = await f.send("post", `/risk-criteria/${cid}/confirm`, { version: 1, reason: "Own criteria", confirmHumanCriteria: true });
  assert.equal(r.status, 200);
  r = await f.send("post", "/risk-assessments", { body: b, criteriaId: cid });
  assert.equal(r.status, 200);
  return { c, b, cid, doc: r.body };
}
test("narrative submission distinguishes unresolved, missing, no-proposal and planned without changing other method rules", () => {
  const c = criteria(), b = body();
  assert.doesNotThrow(() => validateRiskSubmission(b, c));
  const h = b.hazards[0];
  assert.throws(() => validateRiskSubmission({ ...b, hazards: [{ ...h, additionalPlanDecision: null }] }, c));
  assert.throws(() => validateRiskSubmission({ ...b, hazards: [{ ...h, judgmentReason: "" }] }, c));
  assert.throws(() => validateRiskSubmission({ ...b, hazards: [{ ...h, additionalPlanDecision: "planned" }] }, c));
  assert.doesNotThrow(() => validateRiskSubmission({ ...b, hazards: [{ ...h, additionalPlanDecision: "none_proposed" }] }, c));
  assert.throws(() => validateRiskSubmission({ ...b, hazards: [{ ...h, additionalPlanDecision: "none_proposed", plans: [plan] }] }, c));
  assert.doesNotThrow(() => validateRiskSubmission({ ...b, hazards: [{ ...h, additionalPlanDecision: "planned", plans: [plan] }] }, c));
});
test("narrative fixed prompts and unresolved decisions survive document acceptance, print, overview and correction", async () => {
  const f = await methodFixture();
  try {
    const old = f.db.prepare("SELECT * FROM risk_assessments WHERE id=?").get(f.doc.id);
    const n = await createNarrative(f);
    let r = await f.send("post", `/risk-assessments/${n.doc.id}/submit`, { version: 1, reason: "Unresolved record, not safety approval", confirmRecordOnly: true });
    assert.equal(r.status, 200);
    r = await f.reviewSend(`/risk-assessments/${n.doc.id}/review`, { version: 2, decision: "accepted", reason: "Accept document only; judgment unresolved", confirmRecordOnly: true });
    assert.equal(r.status, 200);
    const accepted = r.body.record;
    assert.equal(accepted.results[0].score, null);
    assert.equal(accepted.results[0].criterionAcceptable, null);
    assert.equal(accepted.results[0].judgmentUnresolved, true);
    assert.equal(accepted.submission.body.hazards[0].additionalPlanDecision, "further_review");
    const pc = (await f.agent.get(f.base + `/risk-assessments/${n.doc.id}/print-context`)).body;
    r = await f.agent.get(f.base + `/risk-assessments/${n.doc.id}/print?expectedFingerprint=${pc.fingerprint}`);
    assert.equal(r.status, 200);
    assert.match(r.text, /판단 미확정/);
    assert.match(r.text, /Own &lt;exposurePath&gt; question/);
    assert.match(r.text, /Human exposure route/);
    assert.match(r.text, /점수\/전체 위험 허용 판정 없음/);
    assert.doesNotMatch(r.text, /원 산술값|사용자 기준상 허용 분류/);
    assert.equal((await f.agent.get(f.base + `/risk-assessments/${n.doc.id}/hazards/${n.b.hazards[0].id}/residuals/context`)).status, 200);
    r = await f.agent.get(f.base + "/risk-overview?asOfDate=2026-10-28&method=narrative");
    assert.equal(r.status, 200);
    assert.equal(r.body.groups.length, 1);
    assert.equal(r.body.groups[0].documents.currentLeaf.accepted, 1);
    r = await f.agent.get(f.base + "/risk-assessments?method=narrative");
    assert.equal(r.status, 200);
    assert.equal(r.body.items.length, 1);
    r = await f.reviewSend(`/risk-assessments/${n.doc.id}/revise`, { version: 3, reason: "More information", authorId: f.manager });
    assert.equal(r.status, 200);
    assert.equal(r.body.nextDraft.submission, null);
    assert.equal(r.body.nextDraft.body.hazards[0].additionalPlanDecision, "further_review");
    assert.deepEqual(f.db.prepare("SELECT * FROM risk_assessments WHERE id=?").get(f.doc.id), old);
    r = await f.agent.get(f.base + `/risk-assessments/${n.doc.id}`);
    assert.deepEqual(r.body.submission, accepted.submission);
  } finally { f.db.close(); }
});
test("narrative criteria replacement clears answers explicitly; planned records link actions and preserve synthetic backup bytes", async () => {
  const f = await methodFixture();
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { backup, DatabaseSync } = await import("node:sqlite");
  const { createBackup, restoreBackup } = await import("../scripts/local-backup.js");
  const dir = await mkdtemp(join(tmpdir(), "pedit-narrative-"));
  try {
    const b = body(); b.hazards[0].additionalPlanDecision = "planned"; b.hazards[0].plans = [plan];
    const n = await createNarrative(f, b);
    let r = await f.send("post", `/risk-assessments/${n.doc.id}/criteria`, { version: 1, criteriaId: n.cid, reason: "Explicit reset", confirmResetValues: true });
    assert.equal(r.status, 200);
    for (const field of ["scenario", "harm", "exposedGroup", "exposurePath", "currentControls", "judgmentReason"]) assert.equal(r.body.body.hazards[0][field], "");
    assert.equal(r.body.body.hazards[0].additionalPlanDecision, null);
    assert.equal(r.body.body.hazards[0].task, b.hazards[0].task);
    assert.deepEqual(r.body.body.hazards[0].plans, [plan]);
    assert.equal((await f.send("post", `/risk-assessments/${n.doc.id}/submit`, { version: 2, reason: "Reset needs new answers", confirmRecordOnly: true })).status, 400);
    r = await f.send("put", `/risk-assessments/${n.doc.id}`, { version: 2, reason: "Human re-entry", body: b });
    assert.equal(r.status, 200);
    r = await f.send("post", `/risk-assessments/${n.doc.id}/submit`, { version: 3, reason: "Planned", confirmRecordOnly: true });
    assert.equal(r.status, 200);
    r = await f.reviewSend(`/risk-assessments/${n.doc.id}/review`, { version: 4, decision: "accepted", reason: "Record only", confirmRecordOnly: true });
    assert.equal(r.status, 200);
    r = await f.reviewSend(`/risk-assessments/${n.doc.id}/actions`, { version: 5, hazardId: b.hazards[0].id, planIndex: 0, assigneeId: f.manager, due: "2026-11-01", reason: "Explicit action", confirmManualTracking: true });
    assert.equal(r.status, 200);
    assert.equal(r.body.source.criteria.body.method, "narrative");
    r = await f.agent.get(f.base + "/risk-overview?asOfDate=2026-11-02&method=narrative");
    assert.equal(r.status, 200);
    assert.equal(r.body.groups[0].actions.currentLeaf.assigned.beforeDate, 1);
    const before = f.db.prepare("SELECT id,body,criteria_snapshot,submission,submission_hash FROM risk_assessments ORDER BY id").all();
    const { migrateRiskNarrative } = await import("../server/risk-method-schema.js");
    f.db.exec("PRAGMA user_version=29"); migrateRiskNarrative(f.db);
    f.db.exec("DROP TABLE IF EXISTS education_archive_attachments; DROP TABLE IF EXISTS education_attachment_events; DROP TABLE IF EXISTS education_attachments; DROP TABLE IF EXISTS cost_close_evidence; DROP TABLE IF EXISTS cost_evidence_events; DROP TABLE IF EXISTS cost_evidence_links; DROP TABLE IF EXISTS cost_evidence_files; DROP TABLE IF EXISTS cost_expense_preset_sources; DROP TABLE IF EXISTS cost_input_presets; DROP TABLE IF EXISTS stock_minimum_events; DROP TABLE IF EXISTS daily_monthly_records; DROP TABLE IF EXISTS work_plan_attachment_events; DROP TABLE IF EXISTS work_plan_attachments; DROP TABLE IF EXISTS minutes_attachment_events; DROP TABLE IF EXISTS minutes_attachments; DROP TABLE IF EXISTS inspection_template_use_stops; DROP TABLE IF EXISTS education_catalog_use_stops; DROP TABLE IF EXISTS cost_baseline_statements; DROP TABLE IF EXISTS cost_baselines; DROP TABLE IF EXISTS ppe_return_entries; DROP TRIGGER IF EXISTS ppe_return_terminal_state; DROP TABLE IF EXISTS work_plan_review_events; DROP TABLE IF EXISTS work_plan_document_reviews; DROP TABLE IF EXISTS cost_stock_receipts; DROP TRIGGER IF EXISTS cost_stock_split_guard; DROP TRIGGER IF EXISTS cost_stock_split_undo_guard; DROP TABLE IF EXISTS minutes_followup_events; DROP TABLE IF EXISTS minutes_followups; DROP TABLE IF EXISTS minutes_snapshots; DROP TABLE IF EXISTS minutes_records; DROP TRIGGER IF EXISTS minutes_final_fixed; DROP TRIGGER IF EXISTS minutes_final_retained; DROP TABLE IF EXISTS tbm_risk_references; DROP TABLE IF EXISTS risk_reuse_sources; DROP TABLE IF EXISTS risk_publication_events; DROP TABLE IF EXISTS risk_publication_acks; DROP TABLE IF EXISTS risk_publication_targets; DROP TABLE IF EXISTS risk_publications; ");
    const { migrateRiskPublications } = await import("../server/risk-publication-schema.js");
    migrateRiskPublications(f.db);
    f.db.exec("DROP TABLE IF EXISTS risk_reuse_sources");
    const { migrateRiskReuse } = await import("../server/risk-reuse-schema.js"); migrateRiskReuse(f.db);
    const { migrateTbmRiskReferences } = await import("../server/tbm-risk-schema.js"); migrateTbmRiskReferences(f.db);
    const { migrateMinutesRecords } = await import("../server/minutes-schema.js"); migrateMinutesRecords(f.db);
    const { migrateCostStock } = await import("../server/cost-stock-schema.js"); migrateCostStock(f.db);
    const { migrateWorkPlanReview } = await import("../server/work-plan-review-schema.js"); migrateWorkPlanReview(f.db); migratePpeReturns(f.db); migrateCostBaselines(f.db); migrateCatalogUse(f.db); migrateInspectionWorkflow(f.db); migrateMinutesAttachments(f.db); migrateMinutesPdf(f.db); migrateWorkPlanAttachments(f.db); migrateDailyMonthlyRecords(f.db); migrateRiskResidualHumanMethods(f.db); migrateStockMinimums(f.db); migrateCostPresets(f.db); migrateCostEvidence(f.db); migrateEducationAttachments(f.db); migrateWorkPlanForms(f.db); migrateWorkPlanPackets(f.db); migrateWorkPlanDesignations(f.db); migrateWorkPlanPlateReports(f.db); migrateWorkPlanLifting(f.db); migrateWorkPlanHazardReferences(f.db); migrateDailyInspectionReferences(f.db); migrateCostSettings(f.db); migrateCostLabor(f.db); migrateCostDetails(f.db); migrateCostPhotos(f.db); migrateEducationReviews(f.db); migratePhotoBoards(f.db); migrateTbmJoin(f.db); migrateTbmSignatures(f.db); migrateWorkPlanFormChecklists(f.db); migrateSiteLibrary(f.db); migrateAiUsage(f.db); migrateAiKeys(f.db); migrateWorkPlanCalculations(f.db); migratePublicAccess(f.db); migrateCostPhotoScene(f.db); migrateAccountGrants(f.db); migrateAds(f.db); migratePublicSetup(f.db); migratePublicSetupForm(f.db); migrateIncidents(f.db);
    assert.deepEqual(f.db.prepare("SELECT id,body,criteria_snapshot,submission,submission_hash FROM risk_assessments ORDER BY id").all(), before);
    const file = join(dir, "source.sqlite"); await backup(f.db, file); await createBackup(file, join(dir, "bundle"));
    const restored = await restoreBackup(join(dir, "bundle"), join(dir, "restored"));
    const db = new DatabaseSync(restored.databasePath);
    try {
      assert.deepEqual(db.prepare("SELECT id,body,criteria_snapshot,submission,submission_hash FROM risk_assessments ORDER BY id").all(), before);
      assert.equal(db.prepare("PRAGMA user_version").get()?.user_version, CURRENT_SCHEMA_VERSION);
      assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    } finally { db.close(); }
  } finally { f.db.close(); await rm(dir, { recursive: true, force: true }); }
});
