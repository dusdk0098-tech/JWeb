import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import request from "supertest";
import { openDatabase } from "../server/db.js";
import { createApp } from "../server/app.js";
import { closeReadySettings } from "./fixtures/cost-close-ready.js";
const origin = "http://127.0.0.1:3000";
async function fixture() {
  const db = openDatabase(":memory:"), site = randomUUID(), user = randomUUID(), password = randomUUID();
  db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(user, "fixes@example.test", "합성", await argon2.hash(password));
  db.prepare("INSERT INTO sites(id,name) VALUES(?,?)").run(site, "합성 현장");
  db.prepare("INSERT INTO memberships VALUES(?,?,?)").run(site, user, "manager");
  const app = await createApp(db, { origin, secret: "synthetic-cost-fixes-secret-".repeat(2) }), agent = request.agent(app);
  let r = await agent.get("/api/session");
  r = await agent.post("/api/login").set("Origin", origin).set("x-csrf-token", r.body.csrf).send({ email: "fixes@example.test", password });
  assert.equal(r.status, 200);
  const csrf = r.body.csrf as string, periods = `/api/sites/${site}/cost-periods`,
    send = (method: "post" | "put", path: string, body: object) =>
      agent[method](path).set("Origin", origin).set("x-csrf-token", csrf).set("idempotency-key", randomUUID()).send(body);
  async function ledger(categories: { plan: string; opening: string; scCode: number }[]) {
    let res = await send("post", periods, { month: "2026-10", openingNote: "합성", categories: categories.map((c) => ({ ...c, label: `항목${c.scCode}` })) });
    assert.equal(res.status, 200, res.text);
    const id = res.body.id as string;
    res = await send("put", `${periods}/${id}/settings`, { version: res.body.version, settings: closeReadySettings });
    assert.equal(res.status, 200, res.text);
    return res.body;
  }
  return { db, site, agent, send, periods, ledger };
}
const item = (categoryId: string, description: string, unitPriceWon: string) => ({ categoryId, spendDate: "2026-10-02", description, quantity: "1", unitPriceWon });

test("집계표 counts the first ledger's 초기 누계 in its own row, in 계 and in 사용률", async () => {
  const { db, agent, send, periods, ledger } = await fixture();
  try {
    let p = await ledger([{ plan: "1000", opening: "3000000", scCode: 1 }, { plan: "1000", opening: "0.5", scCode: 2 }, { plan: "1000", opening: "20", scCode: 8 }]);
    const r = await send("post", `${periods}/${p.id}/expenses`, { version: p.version, expense: item(p.categories[0].id, "합성", "1000000") });
    assert.equal(r.status, 200, r.text);
    p = r.body.period;
    const html = (await agent.get(`${periods}/${p.id}/legal-forms/print`)).text;
    assert.match(html, /<tr><th>이전 누계<\/th><td>3,000,000<\/td><td>0.5<\/td>(<td>0<\/td>){6}<td>3,000,000.5<\/td><\/tr>/);
    assert.match(html, /<tr><th>계<\/th><td>4,000,000<\/td><td>0.5<\/td>(<td>0<\/td>){6}<td>4,000,000.5<\/td><\/tr>/);
    assert.match(html, /<th>안전관리비사용률<\/th><td>13\.3%<\/td>/); // 4,000,000.5 / 30,000,000, the same base as 사용내역서 누계 minus 8번
    assert.match(html, /8번 사용액 20원은 이 표의 합계에 포함되지 않습니다/);
    assert.match(html, /<tr><th>계<\/th><td>3,000,020.5<\/td><td>1,000,000<\/td><td>13\.3%<\/td><td>4,000,020.5<\/td><\/tr>/);
  } finally { db.close(); }
});

test("a ledger with no 초기 누계 keeps the original 집계표 rows", async () => {
  const { db, agent, periods, ledger } = await fixture();
  try {
    const p = await ledger([{ plan: "1000", opening: "0", scCode: 1 }]);
    assert.doesNotMatch((await agent.get(`${periods}/${p.id}/legal-forms/print`)).text, /이전 누계/);
  } finally { db.close(); }
});

test("누계공정률 05 is refused, and one stored before the check still prints", async () => {
  const { db, agent, send, periods, ledger } = await fixture();
  try {
    const p = await ledger([{ plan: "1000", opening: "0", scCode: 1 }]);
    for (const bad of ["05", "00", "101", "5.123"]) {
      const r = await send("put", `${periods}/${p.id}/settings`, { version: p.version, settings: { ...closeReadySettings, cumulativeProgress: bad } });
      assert.equal(r.status, 400, bad);
    }
    for (const good of ["0", "5", "5.5", "50", "100", "100.00"]) {
      const current = await agent.get(`${periods}/${p.id}`);
      const r = await send("put", `${periods}/${p.id}/settings`, { version: current.body.version, settings: { ...closeReadySettings, cumulativeProgress: good } });
      assert.equal(r.status, 200, good);
    }
    db.prepare("UPDATE cost_period_settings SET body=? WHERE period_id=?").run(JSON.stringify({ ...closeReadySettings, cumulativeProgress: "05" }), p.id);
    const printed = await agent.get(`${periods}/${p.id}/legal-forms/print`);
    assert.equal(printed.status, 200, printed.text);
    assert.match(printed.text, /사용기준금액\(전체\)<\/th><td>1,500,000<\/td>/); // 30,000,000 × 5%
  } finally { db.close(); }
});

test("split children keep 인건비 구분 and 추가필드; undo restores the source", async () => {
  const { db, site, agent, send, periods, ledger } = await fixture();
  try {
    let p = await ledger([{ plan: "1000", opening: "0", scCode: 1 }, { plan: "1000", opening: "0", scCode: 2 }]);
    let r = await send("post", `${periods}/${p.id}/expenses`, { version: p.version, expense: item(p.categories[0].id, "급여", "1000"), laborKind: "전담 안전관리자", details: { personName: "합성갑" } });
    assert.equal(r.status, 200, r.text);
    p = r.body.period;
    const pay = r.body.expense.id as string;
    r = await send("post", `${periods}/${p.id}/expenses`, { version: p.version, expense: item(p.categories[1].id, "난간", "1000"), details: { spec: "H1200", unit: "m", paymentDetails: "지급" } });
    assert.equal(r.status, 200, r.text);
    p = r.body.period;
    const rail = r.body.expense.id as string;
    const kids = [{ description: "A", quantity: "0.4", unitPriceWon: "1000" }, { description: "B", quantity: "0.6", unitPriceWon: "1000" }];
    r = await send("post", `${periods}/${p.id}/expenses/${pay}/split`, { version: p.version, reason: "합성", children: kids });
    assert.equal(r.status, 200, r.text);
    p = r.body.period;
    const splitId = r.body.id as string;
    assert.equal(Object.values(p.laborKinds as Record<string, string>).filter((k) => k === "전담 안전관리자").length, 3);
    let labor = (await agent.get(`/api/sites/${site}/cost-labor`)).body;
    assert.equal(labor.total, "1000");
    r = await send("post", `${periods}/${p.id}/expenses/${rail}/split`, { version: p.version, reason: "합성", children: kids });
    assert.equal(r.status, 200, r.text);
    p = r.body.period;
    const errors = (await agent.get(`${periods}/${p.id}/preflight`)).body.items.filter((i: { level: string }) => i.level === "error");
    assert.deepEqual(errors, []);
    r = await send("post", `${periods}/${p.id}/splits/${splitId}/undo`, { version: p.version, reason: "되돌림" });
    assert.equal(r.status, 200, r.text);
    labor = (await agent.get(`/api/sites/${site}/cost-labor`)).body;
    assert.equal(labor.total, "1000");
    assert.deepEqual(labor.items.map((x: { description: string }) => x.description), ["급여"]);
  } finally { db.close(); }
});

test("a closure's legal forms print the values fixed at that close, also after a reopen and correction", async () => {
  const { db, agent, send, periods, ledger } = await fixture();
  try {
    let p = await ledger([{ plan: "1000", opening: "0", scCode: 1 }]);
    let r = await send("post", `${periods}/${p.id}/expenses`, { version: p.version, expense: item(p.categories[0].id, "급여", "1000"), laborKind: "전담 안전관리자", details: { personName: "최초성명" } });
    assert.equal(r.status, 200, r.text);
    p = r.body.period;
    const expense = r.body.expense;
    r = await send("post", `${periods}/${p.id}/close`, { version: p.version, reason: "1차" });
    assert.equal(r.status, 200, r.text);
    p = r.body;
    const first = p.currentClosure.id as string;
    r = await send("post", `${periods}/${p.id}/reopen`, { version: p.version, reason: "정정" });
    p = r.body;
    r = await send("put", `${periods}/${p.id}/expenses/${expense.id}`, { version: p.version, reason: "성명 정정", expense: item(p.categories[0].id, "급여", "2000"), laborKind: "기타", details: { personName: "바뀐성명" } });
    assert.equal(r.status, 200, r.text);
    p = r.body.period;
    r = await send("put", `${periods}/${p.id}/settings`, { version: p.version, settings: { ...closeReadySettings, projectName: "바뀐공사" } });
    p = r.body;
    r = await send("post", `${periods}/${p.id}/close`, { version: p.version, reason: "2차" });
    assert.equal(r.status, 200, r.text);
    p = r.body;
    const old = (await agent.get(`${periods}/${p.id}/legal-forms/print?closureId=${first}`)).text;
    assert.match(old, /마감본 1에 고정된 값입니다/);
    assert.match(old, /최초성명/);
    assert.match(old, /전담 안전관리자/);
    assert.match(old, /<td>2026-10-02<\/td><td>급여<\/td><td>1<\/td><td>1,000<\/td><td>1,000<\/td>/);
    assert.match(old, /&lt;합성&gt; 공사/);
    assert.doesNotMatch(old, /바뀐성명|바뀐공사/);
    const now = (await agent.get(`${periods}/${p.id}/legal-forms/print`)).text;
    assert.match(now, /바뀐성명/);
    assert.match(now, /바뀐공사/);
    assert.doesNotMatch(now, /최초성명/);
    assert.equal((await agent.get(`${periods}/${p.id}/legal-forms/print?closureId=${randomUUID()}`)).status, 404);
    assert.equal((await agent.get(`${periods}/${p.id}/legal-forms/print?closureId=x`)).status, 400);
  } finally { db.close(); }
});

test("a closure made before form values were fixed says so instead of showing today's values", async () => {
  const { db, agent, send, periods, ledger } = await fixture();
  try {
    let p = await ledger([{ plan: "1000", opening: "0", scCode: 1 }]);
    let r = await send("post", `${periods}/${p.id}/expenses`, { version: p.version, expense: item(p.categories[0].id, "급여", "1000"), details: { personName: "현재성명" } });
    p = r.body.period;
    r = await send("post", `${periods}/${p.id}/close`, { version: p.version, reason: "1차" });
    assert.equal(r.status, 200, r.text);
    const stored = db.prepare("SELECT id,body FROM cost_closures WHERE period_id=?").get(p.id) as { id: string; body: string };
    const legacy = JSON.parse(stored.body);
    delete legacy.laborKinds;
    delete legacy.details;
    const { journalHash } = await import("../server/daily-journal-sources.js");
    db.exec("DROP TRIGGER IF EXISTS cost_closure_no_update");
    db.prepare("UPDATE cost_closures SET body=?,hash=? WHERE id=?").run(JSON.stringify(legacy), journalHash(legacy), stored.id);
    const html = (await agent.get(`${periods}/${p.id}/legal-forms/print?closureId=${stored.id}`)).text;
    assert.match(html, /고정하기 전 기록이라 그 값이 비어 있습니다/);
    assert.doesNotMatch(html, /현재성명/);
  } finally { db.close(); }
});
