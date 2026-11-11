import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import request from "supertest";
import { openDatabase } from "../server/db.js";
import { createApp } from "../server/app.js";
import { closeReadySettings } from "./fixtures/cost-close-ready.js";
import { won } from "../src/cost-types.js";
const origin = "http://127.0.0.1:3000";
const labels = ["1. 안전보건관리자 임금 등", "2. 안전시설비 등", "3. 보호구 등", "4. 안전보건진단비 등", "5. 안전보건교육비 등", "6. 근로자 건강장해예방비 등", "7. 건설재해예방전문지도기관 기술지도비", "8. 본사 전담조직 근로자 임금 등", "9. 위험성평가 등에 따른 소요비용"];
async function fixture(settings: object = closeReadySettings) {
  const db = openDatabase(":memory:"), site = randomUUID(), user = randomUUID(), password = randomUUID();
  db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(user, "low@example.test", "합성", await argon2.hash(password));
  db.prepare("INSERT INTO sites(id,name) VALUES(?,?)").run(site, "합성 현장");
  db.prepare("INSERT INTO memberships VALUES(?,?,?)").run(site, user, "manager");
  const app = await createApp(db, { origin, secret: "synthetic-cost-low-secret-".repeat(2) }), agent = request.agent(app);
  let r = await agent.get("/api/session");
  r = await agent.post("/api/login").set("Origin", origin).set("x-csrf-token", r.body.csrf).send({ email: "low@example.test", password });
  const csrf = r.body.csrf as string, periods = `/api/sites/${site}/cost-periods`,
    send = (method: "post" | "put", path: string, body: object) => agent[method](path).set("Origin", origin).set("x-csrf-token", csrf).set("idempotency-key", randomUUID()).send(body);
  r = await send("post", periods, { month: "2026-10", openingNote: "합성", categories: labels.map((label, i) => ({ label, plan: "1000000", opening: "0", scCode: i + 1 })) });
  assert.equal(r.status, 200, r.text);
  r = await send("put", `${periods}/${r.body.id}/settings`, { version: r.body.version, settings });
  assert.equal(r.status, 200, r.text);
  let p = r.body;
  const add = async (code: number, spendDate: string, description: string, quantity: string, unitPriceWon: string, extra: object = {}) => {
    const res = await send("post", `${periods}/${p.id}/expenses`, { version: p.version, expense: { categoryId: p.categories[code - 1].id, spendDate, description, quantity, unitPriceWon }, ...extra });
    if (res.status === 200) p = res.body.period;
    return res;
  };
  return { db, site, agent, send, periods, add, period: () => p };
}

test("display helper puts thousands separators and keeps every digit", () => {
  assert.deepEqual(["0", "999", "1000", "61000000", "13188298.999999", "-450000.5", "0.333333"].map(won), ["0", "999", "1,000", "61,000,000", "13,188,298.999999", "-450,000.5", "0.333333"]);
});

test("legal forms: category number once, exact 보호구 running quantity, 8·9번 in date order", async () => {
  const f = await fixture();
  try {
    assert.equal((await f.add(3, "2026-10-02", "안전화", "0.1", "1000")).status, 200);
    assert.equal((await f.add(3, "2026-10-03", "안전화", "0.2", "1000")).status, 200);
    const decided = { details: { decisionType: "위험성평가", decisionDate: "2026-10-01", paymentDetails: "지급" } };
    assert.equal((await f.add(9, "2026-10-20", "늦은 지출", "1", "100", decided)).status, 200);
    assert.equal((await f.add(9, "2026-10-05", "이른 지출", "1", "100", decided)).status, 200);
    const html = (await f.agent.get(`${f.periods}/${f.period().id}/legal-forms/print`)).text;
    assert.match(html, /<th>9\. 위험성평가 등에 따른 소요비용<\/th>/);
    assert.doesNotMatch(html, /\d\. \d\. /);
    assert.match(html, /<td>0\.2<\/td><td>200<\/td><td>0\.3<\/td><td>300<\/td>/); // 금월 수량·금액, 누계 수량·금액
    assert.doesNotMatch(html, /0\.30000000000000004/);
    const sheet9 = html.slice(html.indexOf("<h1>9. 위험성평가 등에 따른 소요비용"));
    assert.ok(sheet9.indexOf("이른 지출") < sheet9.indexOf("늦은 지출"));
    const usage = html.slice(html.indexOf("항목별 사용내역"), html.indexOf("사용항목별 지급현황")); // 을: 입력 순서 그대로
    assert.ok(usage.indexOf("늦은 지출") < usage.indexOf("이른 지출"));
  } finally { f.db.close(); }
});

test("detail dates must be real dates", async () => {
  const f = await fixture();
  try {
    const r = await f.add(1, "2026-10-03", "날짜 이상", "1", "1", { details: { appointedDate: "2026-13-99" } });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /선임일/);
    assert.equal((await f.add(1, "2026-10-03", "윤년 아님", "1", "1", { details: { appointedDate: "2026-02-29" } })).status, 400);
    assert.equal((await f.add(1, "2026-10-03", "정상 날짜", "1", "1", { details: { appointedDate: "2024-02-29" } })).status, 200);
  } finally { f.db.close(); }
});

test("dashboard treats a 0원 계상안전관리비 as not entered instead of showing null%", async () => {
  const f = await fixture({ ...closeReadySettings, safetyBudgetWon: "0" });
  try {
    assert.equal((await f.add(3, "2026-10-02", "장갑", "1", "1000")).status, 200);
    const latest = (await f.agent.get(`/api/sites/${f.site}/cost-dashboard`)).body.latest;
    assert.deepEqual([latest.safetyBudgetWon, latest.usedPercent, latest.monthsLeft], [null, null, null]);
  } finally { f.db.close(); }
});

test("split print names the category instead of its id", async () => {
  const f = await fixture();
  try {
    const made = await f.add(3, "2026-10-02", "장갑", "1", "1000");
    const split = await f.send("post", `${f.periods}/${f.period().id}/expenses/${made.body.expense.id}/split`, { version: f.period().version, reason: "합성", children: [{ description: "A", quantity: "0.4", unitPriceWon: "1000" }, { description: "B", quantity: "0.6", unitPriceWon: "1000" }] });
    assert.equal(split.status, 200, split.text);
    const html = (await f.agent.get(`${f.periods}/${f.period().id}/splits/${split.body.id}/print`)).text;
    assert.match(html, /항목 3\. 보호구 등 · 날짜/);
    assert.doesNotMatch(html, new RegExp("항목 " + f.period().categories[2].id));
  } finally { f.db.close(); }
});
