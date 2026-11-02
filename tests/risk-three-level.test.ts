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
import { migratePermits } from "../server/permits.js";
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
import argon2 from "argon2";
import request from "supertest";
import { openDatabase } from "../server/db.js";
import { createApp } from "../server/app.js";

const origin = "http://127.0.0.1:3000";
async function setup() {
  const db = openDatabase(":memory:"),
    manager = randomUUID(),
    site = randomUUID(),
    password = randomUUID();
  db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(
    manager,
    "synthetic@example.test",
    "Synthetic",
    await argon2.hash(password),
  );
  db.prepare("INSERT INTO sites(id,name) VALUES(?,?)").run(
    site,
    "Synthetic site",
  );
  db.prepare("INSERT INTO memberships VALUES(?,?,?)").run(
    site,
    manager,
    "manager",
  );
  const app = await createApp(db, {
      origin,
      secret: "synthetic-business-only".repeat(3),
    }),
    agent = request.agent(app);
  let r = await agent.get("/api/session");
  r = await agent
    .post("/api/login")
    .set("Origin", origin)
    .set("x-csrf-token", r.body.csrf)
    .send({ email: "synthetic@example.test", password });
  assert.equal(r.status, 200);
  const csrf = r.body.csrf,
    base = `/api/sites/${site}`;
  const send = (
    method: "post" | "put",
    path: string,
    body: object,
    key = randomUUID(),
  ) =>
    agent[method](base + path)
      .set("Origin", origin)
      .set("x-csrf-token", csrf)
      .set("idempotency-key", key)
      .send(body);
  return { db, manager, site, agent, base, send };
}
const criteria = {
  name: "Synthetic human criteria",
  method: "product" as const,
  likelihood: ["L1", "L2", "L3", "L4", "L5"],
  severity: ["S1", "S2", "S3", "S4"],
  rationale: "Synthetic arithmetic test, not operational standard",
  bands: [
    { min: 1, max: 5, label: "Synthetic A", criterionAcceptable: true },
    { min: 6, max: 20, label: "Synthetic B", criterionAcceptable: false },
  ],
};
const hazard = () => ({
  id: randomUUID(),
  task: "Synthetic task",
  location: "Test location",
  category: "Human text",
  accidentType: "Human text",
  scenario: "Synthetic scenario",
  harm: "Synthetic harm",
  exposedGroup: "Generic group",
  reference: "No legal claim",
  currentControls: "Human note",
  likelihood: null as number | null,
  severity: null as number | null,
  judgmentReason: "",
  plans: [] as {
    action: string;
    controlType: "미정";
    ownerNote: string;
    due: null;
    priorityNote: string;
    preconditions: string;
  }[],
});
const draft = () => ({
  title: "Synthetic assessment",
  date: "2026-10-28",
  timing: "수시" as const,
  trigger: "Synthetic change",
  workScope: "Synthetic scope",
  method: "product" as const,
  hazards: [hazard()],
});
function complete() {
  const body = draft();
  body.hazards[0].likelihood = 5;
  body.hazards[0].severity = 4;
  body.hazards[0].judgmentReason = "Synthetic basis";
  body.hazards[0].plans = [
    {
      action: "Human plan",
      controlType: "미정",
      ownerNote: "Group",
      due: null,
      priorityNote: "",
      preconditions: "",
    },
  ];
  return body;
}
async function numericSource() {
  const f = await setup(),
    reviewer = randomUUID(),
    password = randomUUID();
  f.db
    .prepare("INSERT INTO users VALUES(?,?,?,?)")
    .run(
      reviewer,
      "action-reviewer@example.test",
      "Synthetic reviewer",
      await argon2.hash(password),
    );
  f.db
    .prepare("INSERT INTO memberships VALUES(?,?,?)")
    .run(f.site, reviewer, "manager");
  const app = await createApp(f.db, {
      origin,
      secret: "synthetic-business-only".repeat(3),
    }),
    agent = request.agent(app);
  let r = await agent.get("/api/session");
  r = await agent
    .post("/api/login")
    .set("Origin", origin)
    .set("x-csrf-token", r.body.csrf)
    .send({ email: "action-reviewer@example.test", password });
  const csrf = r.body.csrf,
    send = (path: string, body: object, key = randomUUID()) =>
      agent
        .post(f.base + path)
        .set("Origin", origin)
        .set("x-csrf-token", csrf)
        .set("idempotency-key", key)
        .send(body);
  r = await f.send("post", "/risk-criteria", criteria);
  const cid = r.body.id;
  r = await f.send("post", `/risk-criteria/${cid}/confirm`, {
    version: 1,
    reason: "Synthetic",
    confirmHumanCriteria: true,
  });
  assert.equal(r.status, 200);
  const body = complete();
  Object.assign(body.hazards[0].plans[0], {
    controlType: "관리적",
    due: "2026-11-01",
  });
  body.hazards[0].plans.push({
    ...body.hazards[0].plans[0],
    action: "Second human plan",
  });
  r = await f.send("post", "/risk-assessments", { body, criteriaId: cid });
  const id = r.body.id;
  r = await f.send("post", `/risk-assessments/${id}/submit`, {
    version: 1,
    reason: "Document only",
    confirmRecordOnly: true,
  });
  assert.equal(r.status, 200);
  r = await send(`/risk-assessments/${id}/review`, {
    version: 2,
    decision: "accepted",
    reason: "Record review",
    confirmRecordOnly: true,
  });
  assert.equal(r.status, 200);
  return {
    ...f,
    reviewer,
    reviewAgent: agent,
    reviewSend: send,
    doc: r.body.record,
    body,
  };
}
import {
  threeLevelCriteriaInput,
  validateThreeLevelCriteria,
  threeLevelAssessmentInput,
  threeLevelResults,
} from "../server/risk-three-level-model.js";
import { methodResults } from "../server/risk-methods.js";
const levels = () => ({
  name: "Human three-level definitions",
  method: "three_level" as const,
  rationale: "Synthetic human policy, no legal default",
  levels: [true, false, false].map((criterionAcceptable, i) => ({
    id: randomUUID(),
    label: `Human label ${i}`,
    description: `Human definition ${i}`,
    criterionAcceptable,
  })),
});
const levelBody = (levelId: string | null) => {
  const b = draft();
  const { likelihood, severity, ...h } = b.hazards[0];
  void likelihood;
  void severity;
  return {
    ...b,
    method: "three_level" as const,
    hazards: [
      {
        ...h,
        levelId,
        judgmentReason: "Human selected judgment",
        plans: [
          {
            action: "Human plan",
            controlType: "관리적" as const,
            ownerNote: "Team note",
            due: "2026-11-01",
            priorityNote: "",
            preconditions: "",
          },
        ],
      },
    ],
  };
};
test("three-level is strict human selection, not multiplication or numeric default", () => {
  const c = levels();
  validateThreeLevelCriteria(threeLevelCriteriaInput.parse(c));
  assert.throws(() =>
    validateThreeLevelCriteria({
      ...c,
      levels: c.levels.map((l) => ({ ...l, label: "" })),
    }),
  );
  assert.equal(
    threeLevelCriteriaInput.safeParse({
      ...c,
      levels: [...c.levels, c.levels[0]],
    }).success,
    false,
  );
  assert.equal(
    threeLevelCriteriaInput.safeParse({
      ...c,
      levels: [c.levels[0], c.levels[0], c.levels[2]],
    }).success,
    false,
  );
  const b = levelBody(c.levels[1].id);
  assert.equal(threeLevelResults(b, c)[0].score, null);
  assert.equal(threeLevelResults(b, c)[0].criterionAcceptable, false);
  assert.equal(threeLevelResults(levelBody(null), null)[0].bandLabel, null);
  assert.throws(() => methodResults(b, criteria));
  assert.throws(() => threeLevelResults(b, null));
  assert.equal(
    threeLevelAssessmentInput.safeParse({
      ...b,
      hazards: [{ ...b.hazards[0], likelihood: 1 }],
    }).success,
    false,
  );
  assert.equal(
    threeLevelAssessmentInput.safeParse({
      ...b,
      hazards: [b.hazards[0], b.hazards[0]],
    }).success,
    false,
  );
});
test("three-level frozen criteria and shared document lifecycle preserve method-specific result and residual context", async () => {
  const f = await numericSource();
  try {
    const numericBefore = f.db
        .prepare("SELECT * FROM risk_assessments WHERE id=?")
        .get(f.doc.id),
      c = levels();
    let r = await f.send("post", "/risk-criteria", c);
    assert.equal(r.status, 200);
    const cid = r.body.id;
    r = await f.send("post", `/risk-criteria/${cid}/confirm`, {
      version: 1,
      reason: "Human criteria",
      confirmHumanCriteria: true,
    });
    assert.equal(r.status, 200);
    const b = levelBody(c.levels[1].id);
    r = await f.send("post", "/risk-assessments", { body: b, criteriaId: cid });
    assert.equal(r.status, 200);
    let doc = r.body;
    assert.equal(doc.results[0].score, null);
    assert.equal(doc.results[0].bandLabel, c.levels[1].label);
    assert.equal(
      (await f.agent.get(f.base + "/risk-assessments?method=three_level")).body
        .items.length,
      1,
    );
    assert.equal(
      (
        await f.agent.get(
          f.base + "/risk-criteria?status=confirmed&method=three_level",
        )
      ).body.items.length,
      1,
    );
    assert.equal(
      (
        await f.send("put", `/risk-assessments/${doc.id}`, {
          version: 1,
          body: complete(),
          reason: "Wrong method",
        })
      ).status,
      400,
    );
    r = await f.send("post", `/risk-assessments/${doc.id}/submit`, {
      version: 1,
      reason: "Document review",
      confirmRecordOnly: true,
    });
    assert.equal(r.status, 200);
    r = await f.reviewSend(`/risk-assessments/${doc.id}/review`, {
      version: 2,
      decision: "accepted",
      reason: "Document only",
      confirmRecordOnly: true,
    });
    assert.equal(r.status, 200);
    doc = r.body.record;
    assert.equal(doc.submission.body.method, "three_level");
    assert.equal(doc.submission.results[0].score, null);
    const context = await f.agent.get(
      f.base + `/risk-assessments/${doc.id}/print-context`,
    );
    assert.equal(context.status, 200);
    const print = await f.agent.get(
      f.base +
        `/risk-assessments/${doc.id}/print?expectedFingerprint=${context.body.fingerprint}`,
    );
    assert.equal(print.status, 200);
    assert.match(print.text, /사람이 선택한 단계/);
    assert.doesNotMatch(print.text, /null × null|원 산술값/);
    assert.equal(
      (
        await f.agent.get(
          f.base +
            `/risk-assessments/${doc.id}/hazards/${b.hazards[0].id}/residuals/context`,
        )
      ).status,
      200,
    );
    r = await f.reviewSend(`/risk-assessments/${doc.id}/actions`, {
      version: 3,
      hazardId: b.hazards[0].id,
      planIndex: 0,
      assigneeId: f.manager,
      due: "2026-11-01",
      reason: "Explicit tracking",
      confirmManualTracking: true,
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.source.criteria.body.method, "three_level");
    r = await f.send("post", `/risk-assessments/${doc.id}/opinions`, {
      submissionHash: doc.submission_hash,
      hazardId: null,
      text: "Account opinion only",
      confirmAccountOpinion: true,
    });
    assert.equal(r.status, 200);
    r = await f.reviewSend(`/risk-assessments/${doc.id}/revise`, {
      version: 3,
      reason: "Correction",
      authorId: f.manager,
    });
    assert.equal(r.status, 200);
    const child = r.body.nextDraft;
    assert.equal(child.body.method, "three_level");
    assert.equal(child.status, "draft");
    assert.equal(child.submission, null);
    assert.deepEqual(
      f.db.prepare("SELECT * FROM risk_assessments WHERE id=?").get(f.doc.id),
      numericBefore,
    );
  } finally {
    f.db.close();
  }
});
test("three-level criteria replacement resets choices, missing choices cannot submit and capability migration preserves numeric bytes", async () => {
  const f = await numericSource();
  try {
    const before = f.db
        .prepare(
          "SELECT body,criteria_snapshot,submission,submission_hash FROM risk_assessments WHERE id=?",
        )
        .get(f.doc.id),
      c = levels();
    let r = await f.send("post", "/risk-criteria", c);
    const cid = r.body.id;
    assert.equal(
      (
        await f.send("put", `/risk-criteria/${cid}`, {
          version: 1,
          body: criteria,
          reason: "Wrong method",
        })
      ).status,
      400,
    );
    r = await f.send("post", `/risk-criteria/${cid}/confirm`, {
      version: 1,
      reason: "Confirm",
      confirmHumanCriteria: true,
    });
    assert.equal(r.status, 200);
    r = await f.send("post", "/risk-assessments", {
      body: levelBody(null),
      criteriaId: null,
    });
    assert.equal(r.status, 200);
    let d = r.body;
    assert.equal(
      (
        await f.send("post", `/risk-assessments/${d.id}/submit`, {
          version: 1,
          reason: "Incomplete",
          confirmRecordOnly: true,
        })
      ).status,
      400,
    );
    r = await f.send("post", `/risk-assessments/${d.id}/criteria`, {
      version: 1,
      criteriaId: cid,
      confirmResetValues: true,
      reason: "Explicit choice reset",
    });
    assert.equal(r.status, 200);
    d = r.body;
    assert.equal(d.body.hazards[0].levelId, null);
    assert.equal(d.body.hazards[0].judgmentReason, "");
    r = await f.send("put", `/risk-assessments/${d.id}`, {
      version: 2,
      body: levelBody(c.levels[0].id),
      reason: "Human selection",
    });
    assert.equal(r.status, 200);
    d = r.body;
    r = await f.send("post", `/risk-assessments/${d.id}/criteria`, {
      version: 3,
      criteriaId: cid,
      confirmResetValues: true,
      reason: "Explicit reset again",
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.results[0].bandLabel, null);
    assert.equal(
      (
        await f.send("post", `/risk-assessments/${d.id}/criteria`, {
          version: 4,
          criteriaId: f.doc.criteria_id,
          confirmResetValues: true,
          reason: "No cross method",
        })
      ).status,
      400,
    );
    const { migrateRiskMethods } =
      await import("../server/risk-method-schema.js");
    f.db.exec("PRAGMA user_version=26");
    migrateRiskMethods(f.db);
    assert.equal(f.db.prepare("PRAGMA user_version").get()?.user_version, 27);
    assert.deepEqual(
      f.db
        .prepare(
          "SELECT body,criteria_snapshot,submission,submission_hash FROM risk_assessments WHERE id=?",
        )
        .get(f.doc.id),
      before,
    );
  } finally {
    f.db.close();
  }
});
test("three-level and unchanged numeric document bytes survive synthetic backup/fresh restore", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises"),
    { tmpdir } = await import("node:os"),
    { join } = await import("node:path"),
    { backup, DatabaseSync } = await import("node:sqlite"),
    { createBackup, restoreBackup } =
      await import("../scripts/local-backup.js");
  const dir = await mkdtemp(join(tmpdir(), "pedit-three-level-")),
    f = await numericSource();
  try {
    const c = levels();
    let r = await f.send("post", "/risk-criteria", c);
    const cid = r.body.id;
    await f.send("post", `/risk-criteria/${cid}/confirm`, {
      version: 1,
      reason: "Synthetic",
      confirmHumanCriteria: true,
    });
    r = await f.send("post", "/risk-assessments", {
      body: levelBody(c.levels[0].id),
      criteriaId: cid,
    });
    assert.equal(r.status, 200);
    const before = f.db
        .prepare(
          "SELECT id,body,criteria_snapshot,submission,submission_hash FROM risk_assessments ORDER BY id",
        )
        .all(),
      source = join(dir, "source.sqlite");
    await backup(f.db, source);
    await createBackup(source, join(dir, "bundle"));
    const restored = await restoreBackup(
      join(dir, "bundle"),
      join(dir, "restored"),
    );
    const db = new DatabaseSync(restored.databasePath);
    try {
      assert.deepEqual(
        db
          .prepare(
            "SELECT id,body,criteria_snapshot,submission,submission_hash FROM risk_assessments ORDER BY id",
          )
          .all(),
        before,
      );
      assert.equal(db.prepare("PRAGMA user_version").get()?.user_version, CURRENT_SCHEMA_VERSION);
      assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    } finally {
      db.close();
    }
  } finally {
    f.db.close();
    await rm(dir, { recursive: true, force: true });
  }
});

async function acceptedLevelSource(withPlans = true) {
  const f = await numericSource();
  const c = levels();
  // Keep markup-like text to verify print uses the fixed escaped definition.
  c.levels[2].label = "Human <review>";
  c.levels[2].description = "Human <definition> & no score";
  let r = await f.send("post", "/risk-criteria", c);
  assert.equal(r.status, 200);
  const cid = r.body.id;
  r = await f.send("post", `/risk-criteria/${cid}/confirm`, {
    version: 1, reason: "Synthetic criteria", confirmHumanCriteria: true,
  });
  assert.equal(r.status, 200);
  const b = levelBody(c.levels[0].id);
  if (!withPlans) b.hazards[0].plans = [];
  r = await f.send("post", "/risk-assessments", { body: b, criteriaId: cid });
  assert.equal(r.status, 200);
  const id = r.body.id;
  r = await f.send("post", `/risk-assessments/${id}/submit`, {
    version: 1, reason: "Synthetic submission", confirmRecordOnly: true,
  });
  assert.equal(r.status, 200);
  r = await f.reviewSend(`/risk-assessments/${id}/review`, {
    version: 2, decision: "accepted", reason: "Document only", confirmRecordOnly: true,
  });
  assert.equal(r.status, 200);
  return { ...f, levelDoc: r.body.record, c, b,
    residualBase: `/risk-assessments/${id}/hazards/${b.hazards[0].id}/residuals` };
}

test("three-level residuals preserve separate human judgments, immutable source and action-change staleness", async () => {
  const f = await acceptedLevelSource();
  try {
    const get = () => f.agent.get(f.base + f.residualBase + "/context");
    let current = (await get()).body;
    assert.equal(current.facts.criteria.body.method, "three_level");
    assert.equal(current.afterConfirmationReady, false);
    const value = {
      method: "three_level", levelId: f.c.levels[2].id, kind: "projected",
      expectedVersion: 0, contextFingerprint: current.fingerprint,
      basis: "Human projection, no numeric mapping", claimedLocalDate: "2026-11-01",
      reason: "Synthetic record", confirmManualEvaluation: true,
    };
    let r = await f.reviewSend(f.residualBase, value);
    assert.equal(r.status, 200);
    const projected = r.body.snapshot;
    assert.equal(projected.result.score, null);
    assert.equal(projected.result.criterionAcceptable, false);
    assert.equal(projected.result.description, f.c.levels[2].description);
    assert.equal("likelihood" in projected, false);
    assert.equal("severity" in projected, false);
    assert.equal(projected.method, "three_level");
    assert.equal((await f.reviewSend(f.residualBase, { ...value, kind: "after_confirmation" })).status, 409);
    r = await f.reviewSend(`/risk-assessments/${f.levelDoc.id}/actions`, {
      version: 3, hazardId: f.b.hazards[0].id, planIndex: 0,
      assigneeId: f.manager, due: "2026-11-01", reason: "Synthetic action", confirmManualTracking: true,
    });
    assert.equal(r.status, 200);
    const aid = r.body.id;
    r = await f.send("post", `/risk-actions/${aid}/report`, {
      version: 1, text: "Human report", claimedLocalDate: "2026-11-01", reason: "Synthetic report", confirmHumanReport: true,
    });
    assert.equal(r.status, 200);
    r = await f.reviewSend(`/risk-actions/${aid}/verify`, {
      version: 2, decision: "confirm", note: "Human confirmation", claimedLocalDate: "2026-11-01",
      reason: "Synthetic confirmation", confirmHumanVerification: true,
    });
    assert.equal(r.status, 200);
    current = (await get()).body;
    assert.equal(current.afterConfirmationReady, true);
    assert.equal(current.versions.projected, 1);
    assert.equal(current.versions.after_confirmation, 0);
    const afterValue = { ...value, kind: "after_confirmation", contextFingerprint: current.fingerprint };
    const pair = await Promise.all([
      f.reviewSend(f.residualBase, afterValue), f.reviewSend(f.residualBase, afterValue),
    ]);
    assert.deepEqual(pair.map((r) => r.status).sort(), [200, 409]);
    const after = pair.find((r) => r.status === 200)!.body.snapshot;
    assert.equal(after.result.criterionAcceptable, false); // Do not force a favourable judgment.
    assert.equal(after.context.actions[0].version, 3);
    const pc = await f.agent.get(f.base + `/risk-assessments/${f.levelDoc.id}/print-context`);
    r = await f.agent.get(f.base + `/risk-assessments/${f.levelDoc.id}/print?expectedFingerprint=${pc.body.fingerprint}`);
    assert.equal(r.status, 200);
    assert.match(r.text, /사람이 선택한 재평가 단계 \(숫자 점수 없음\)/);
    assert.match(r.text, /Human &lt;definition&gt; &amp; no score/);
    assert.doesNotMatch(r.text, /null × null|이 비수치 방법 전용 재평가 기록은 미지원/);
    f.db.prepare("UPDATE users SET name=? WHERE id=?").run("Changed display name", f.manager);
    assert.equal((await get()).body.fingerprint, current.fingerprint);
    r = await f.reviewSend(`/risk-actions/${aid}/reopen`, { version: 3, reason: "New human information" });
    assert.equal(r.status, 200);
    let history = (await f.agent.get(f.base + f.residualBase)).body.items;
    assert.ok(history.every((item: { stale: boolean }) => item.stale));
    assert.deepEqual(history.find((item: { kind: string }) => item.kind === "projected").snapshot, projected);
    assert.deepEqual(history.find((item: { kind: string }) => item.kind === "after_confirmation").snapshot, after);
    current = (await get()).body;
    assert.equal((await f.reviewSend(f.residualBase, { ...afterValue, expectedVersion: 1, contextFingerprint: current.fingerprint })).status, 409);
    r = await f.reviewSend(`/risk-assessments/${f.levelDoc.id}/revise`, { version: 3, reason: "Source correction", authorId: f.manager });
    assert.equal(r.status, 200);
    current = (await get()).body;
    assert.equal(current.canRecord, false);
    assert.equal((await f.reviewSend(f.residualBase, { ...value, expectedVersion: 1, contextFingerprint: current.fingerprint })).status, 409);
    history = (await f.agent.get(f.base + f.residualBase)).body.items;
    assert.deepEqual(history.find((item: { kind: string }) => item.kind === "after_confirmation").snapshot, after);
    assert.throws(() => f.db.prepare("UPDATE risk_residuals SET snapshot='{}'").run());
    assert.throws(() => f.db.prepare("DELETE FROM risk_residuals").run());
  } finally { f.db.close(); }
});

test("three-level residual strict inputs, no-plan path, append rollback and historic receipt stay explicit", async () => {
  const f = await acceptedLevelSource(false);
  try {
    const current = (await f.agent.get(f.base + f.residualBase + "/context")).body;
    assert.match(current.readinessNote, /허위 계획/);
    assert.equal(current.canRecord, true);
    assert.equal(current.afterConfirmationReady, false);
    const value = {
      method: "three_level", levelId: f.c.levels[0].id, kind: "projected",
      expectedVersion: 0, contextFingerprint: current.fingerprint,
      basis: "Synthetic human basis", claimedLocalDate: "2026-11-01", reason: "Synthetic", confirmManualEvaluation: true,
    };
    for (const bad of [
      { ...value, levelId: randomUUID() }, { ...value, levelId: null },
      { ...value, likelihood: 1, severity: 1 }, { ...value, score: 1 },
      { ...value, criterionAcceptable: true }, { ...value, basis: "" },
      { ...value, method: "checklist" },
    ]) assert.equal((await f.reviewSend(f.residualBase, bad)).status, 400);
    const { method, levelId, ...common } = value;
    void method; void levelId;
    assert.equal((await f.reviewSend(f.residualBase, { ...common, likelihood: 1, severity: 1 })).status, 400);
    const numericBase = `/risk-assessments/${f.doc.id}/hazards/${f.body.hazards[0].id}/residuals`;
    const numericContext = (await f.agent.get(f.base + numericBase + "/context")).body;
    assert.equal((await f.reviewSend(numericBase, { ...value, contextFingerprint: numericContext.fingerprint })).status, 400);
    assert.equal((await f.reviewSend(f.residualBase, { ...value, kind: "after_confirmation" })).status, 409);
    f.db.exec("CREATE TRIGGER synthetic_three_residual_fail BEFORE INSERT ON audit WHEN NEW.event='risk.residual.projected' BEGIN SELECT RAISE(ABORT,'synthetic rollback'); END;");
    assert.equal((await f.reviewSend(f.residualBase, value)).status, 500);
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM risk_residuals").get()?.n, 0);
    f.db.exec("DROP TRIGGER synthetic_three_residual_fail");
    const key = randomUUID();
    const saved = await f.reviewSend(f.residualBase, value, key);
    assert.equal(saved.status, 200);
    const replay = await f.reviewSend(f.residualBase, value, key);
    assert.deepEqual(replay.body, saved.body);
    const second = await f.reviewSend(f.residualBase, { ...value, expectedVersion: 1, levelId: f.c.levels[1].id, reason: "New judgment" });
    assert.equal(second.status, 200);
    assert.equal(second.body.version, 2);
    assert.equal(second.body.snapshot.result.criterionAcceptable, false);
    assert.equal((await f.reviewSend(f.residualBase, value)).status, 409);
    const history = (await f.agent.get(f.base + f.residualBase)).body.items;
    assert.equal(history.length, 2);
    assert.deepEqual(history.find((item: { version: number }) => item.version === 1).snapshot, saved.body.snapshot);
  } finally { f.db.close(); }
});

test("residual method fence and synthetic backup preserve legacy numeric and new human-level bytes", async () => {
  const f = await acceptedLevelSource(false);
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { backup, DatabaseSync } = await import("node:sqlite");
  const { createBackup, restoreBackup } = await import("../scripts/local-backup.js");
  const { migrateRiskResidualMethods } = await import("../server/risk-residual-schema.js");
  const dir = await mkdtemp(join(tmpdir(), "pedit-residual-methods-"));
  try {
    const numericBase = `/risk-assessments/${f.doc.id}/hazards/${f.body.hazards[0].id}/residuals`;
    const nc = (await f.agent.get(f.base + numericBase + "/context")).body;
    const common = { kind: "projected", expectedVersion: 0, basis: "Human basis", claimedLocalDate: "2026-11-01", reason: "Synthetic", confirmManualEvaluation: true };
    let r = await f.reviewSend(numericBase, { ...common, contextFingerprint: nc.fingerprint, likelihood: 1, severity: 1 });
    assert.equal(r.status, 200);
    assert.equal("method" in r.body.snapshot, false);
    assert.equal(r.body.snapshot.result.score, 1);
    const numericSnapshot = r.body.snapshot;
    const legacyRequest = {
      kind: common.kind, expectedVersion: common.expectedVersion, contextFingerprint: nc.fingerprint,
      likelihood: 1, severity: 1, basis: common.basis, claimedLocalDate: common.claimedLocalDate,
      reason: common.reason, confirmManualEvaluation: common.confirmManualEvaluation,
    };
    const receipt = f.db.prepare("SELECT request FROM idempotency WHERE scope=?").get(`risk:residual:${f.site}:${f.doc.id}:${f.body.hazards[0].id}`);
    assert.equal(receipt?.request, JSON.stringify(legacyRequest));
    assert.deepEqual(Object.keys(numericSnapshot), ["id", "siteId", "assessmentId", "hazardId", "kind", "version", "likelihood", "severity", "basis", "claimedLocalDate", "reason", "actor", "recordedAt", "context", "contextFingerprint", "result"]);
    const lc = (await f.agent.get(f.base + f.residualBase + "/context")).body;
    r = await f.reviewSend(f.residualBase, { ...common, contextFingerprint: lc.fingerprint, method: "three_level", levelId: f.c.levels[2].id });
    assert.equal(r.status, 200);
    const before = f.db.prepare("SELECT * FROM risk_residuals ORDER BY id").all();
    const docsBefore = f.db.prepare("SELECT id,body,criteria_snapshot,submission,submission_hash FROM risk_assessments ORDER BY id").all();
    f.db.exec("PRAGMA user_version=28");
    migrateRiskResidualMethods(f.db);
    assert.equal(f.db.prepare("PRAGMA user_version").get()?.user_version, 29);
    const { migrateRiskNarrative } = await import("../server/risk-method-schema.js");
    migrateRiskNarrative(f.db);
    f.db.exec("DROP TABLE IF EXISTS education_archive_attachments; DROP TABLE IF EXISTS education_attachment_events; DROP TABLE IF EXISTS education_attachments; DROP TABLE IF EXISTS cost_close_evidence; DROP TABLE IF EXISTS cost_evidence_events; DROP TABLE IF EXISTS cost_evidence_links; DROP TABLE IF EXISTS cost_evidence_files; DROP TABLE IF EXISTS cost_expense_preset_sources; DROP TABLE IF EXISTS cost_input_presets; DROP TABLE IF EXISTS stock_minimum_events; DROP TABLE IF EXISTS daily_monthly_records; DROP TABLE IF EXISTS work_plan_attachment_events; DROP TABLE IF EXISTS work_plan_attachments; DROP TABLE IF EXISTS minutes_attachment_events; DROP TABLE IF EXISTS minutes_attachments; DROP TABLE IF EXISTS inspection_template_use_stops; DROP TABLE IF EXISTS education_catalog_use_stops; DROP TABLE IF EXISTS cost_baseline_statements; DROP TABLE IF EXISTS cost_baselines; DROP TABLE IF EXISTS ppe_return_entries; DROP TRIGGER IF EXISTS ppe_return_terminal_state; DROP TABLE IF EXISTS work_plan_review_events; DROP TABLE IF EXISTS work_plan_document_reviews; DROP TABLE IF EXISTS cost_stock_receipts; DROP TRIGGER IF EXISTS cost_stock_split_guard; DROP TRIGGER IF EXISTS cost_stock_split_undo_guard; DROP TABLE IF EXISTS minutes_followup_events; DROP TABLE IF EXISTS minutes_followups; DROP TABLE IF EXISTS minutes_snapshots; DROP TABLE IF EXISTS minutes_records; DROP TRIGGER IF EXISTS minutes_final_fixed; DROP TRIGGER IF EXISTS minutes_final_retained; DROP TABLE IF EXISTS tbm_risk_references; DROP TABLE IF EXISTS risk_reuse_sources; DROP TABLE IF EXISTS risk_publication_events; DROP TABLE IF EXISTS risk_publication_acks; DROP TABLE IF EXISTS risk_publication_targets; DROP TABLE IF EXISTS risk_publications; ");
    const { migrateRiskPublications } = await import("../server/risk-publication-schema.js");
    migrateRiskPublications(f.db);
    f.db.exec("DROP TABLE IF EXISTS risk_reuse_sources");
    const { migrateRiskReuse } = await import("../server/risk-reuse-schema.js"); migrateRiskReuse(f.db);
    const { migrateTbmRiskReferences } = await import("../server/tbm-risk-schema.js"); migrateTbmRiskReferences(f.db);
    const { migrateMinutesRecords } = await import("../server/minutes-schema.js"); migrateMinutesRecords(f.db);
    const { migrateCostStock } = await import("../server/cost-stock-schema.js"); migrateCostStock(f.db);
    const { migrateWorkPlanReview } = await import("../server/work-plan-review-schema.js"); migrateWorkPlanReview(f.db); migratePpeReturns(f.db); migrateCostBaselines(f.db); migrateCatalogUse(f.db); migrateInspectionWorkflow(f.db); migrateMinutesAttachments(f.db); migrateMinutesPdf(f.db); migrateWorkPlanAttachments(f.db); migrateDailyMonthlyRecords(f.db); migrateRiskResidualHumanMethods(f.db); migrateStockMinimums(f.db); migrateCostPresets(f.db); migrateCostEvidence(f.db); migrateEducationAttachments(f.db); migrateWorkPlanForms(f.db); migrateWorkPlanPackets(f.db); migrateWorkPlanDesignations(f.db); migrateWorkPlanPlateReports(f.db); migrateWorkPlanLifting(f.db); migrateWorkPlanHazardReferences(f.db); migrateDailyInspectionReferences(f.db); migrateCostSettings(f.db); migrateCostLabor(f.db); migrateCostDetails(f.db); migrateCostPhotos(f.db); migrateEducationReviews(f.db); migratePhotoBoards(f.db); migrateTbmJoin(f.db); migrateTbmSignatures(f.db); migrateWorkPlanFormChecklists(f.db); migrateSiteLibrary(f.db); migrateAiUsage(f.db); migrateAiKeys(f.db); migrateWorkPlanCalculations(f.db); migratePublicAccess(f.db); migrateCostPhotoScene(f.db); migrateAccountGrants(f.db); migrateAds(f.db); migratePublicSetup(f.db); migratePublicSetupForm(f.db); migrateIncidents(f.db); migratePermits(f.db);
    assert.deepEqual(f.db.prepare("SELECT * FROM risk_residuals ORDER BY id").all(), before);
    assert.deepEqual(f.db.prepare("SELECT id,body,criteria_snapshot,submission,submission_hash FROM risk_assessments ORDER BY id").all(), docsBefore);
    r = await f.agent.get(f.base + numericBase);
    assert.deepEqual(r.body.items[0].snapshot, numericSnapshot);
    assert.equal(r.body.items[0].stale, false);
    const source = join(dir, "source.sqlite");
    await backup(f.db, source);
    await createBackup(source, join(dir, "bundle"));
    const restored = await restoreBackup(join(dir, "bundle"), join(dir, "restored"));
    const db = new DatabaseSync(restored.databasePath);
    try {
      assert.deepEqual(db.prepare("SELECT * FROM risk_residuals ORDER BY id").all(), before);
      assert.deepEqual(db.prepare("SELECT id,body,criteria_snapshot,submission,submission_hash FROM risk_assessments ORDER BY id").all(), docsBefore);
      assert.equal(db.prepare("PRAGMA user_version").get()?.user_version, CURRENT_SCHEMA_VERSION);
      assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    } finally { db.close(); }
  } finally { f.db.close(); await rm(dir, { recursive: true, force: true }); }
});
