import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import request from "supertest";
import { openDatabase } from "../server/db.js";
import { createApp } from "../server/app.js";
const origin = "http://127.0.0.1:3000";
async function fixture() {
  const db = openDatabase(":memory:"), password = randomUUID(), hash = await argon2.hash(password), site = randomUUID(), other = randomUUID();
  const ids = { manager: randomUUID(), viewer: randomUUID(), outside: randomUUID() };
  for (const [name, id] of Object.entries(ids)) db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(id, name + "@example.test", name, hash);
  for (const s of [site, other]) db.prepare("INSERT INTO sites(id,name) VALUES(?,'합성 현장')").run(s);
  db.prepare("INSERT INTO memberships VALUES(?,?,'manager')").run(site, ids.manager);
  db.prepare("INSERT INTO memberships VALUES(?,?,'viewer')").run(site, ids.viewer);
  db.prepare("INSERT INTO memberships VALUES(?,?,'manager')").run(other, ids.outside);
  const app = await createApp(db, { origin, secret: "x".repeat(48) });
  async function login(name: keyof typeof ids) {
    const agent = request.agent(app);
    let r = await agent.get("/api/session");
    r = await agent.post("/api/login").set("Origin", origin).set("x-csrf-token", r.body.csrf).send({ email: name + "@example.test", password });
    assert.equal(r.status, 200);
    return { agent, csrf: r.body.csrf as string };
  }
  const m = await login("manager"), base = `/api/sites/${site}`,
    write = (method: "post" | "put", path: string, body: object) =>
      m.agent[method](path).set("Origin", origin).set("x-csrf-token", m.csrf).set("idempotency-key", randomUUID()).send(body);
  let r = await write("post", base + "/inspection-templates", { title: "<script>양식</script>", instructions: "합성 안내", items: ["바닥 상태"] });
  assert.equal(r.status, 200, r.text);
  r = await write("post", base + `/inspection-templates/${r.body.id}/publish`, { version: 1 });
  assert.equal(r.status, 200, r.text);
  const template = r.body;
  // Creates one inspection; submitted unless draft is true.
  async function record(location: string, date: string, draft = false) {
    let res = await write("post", base + "/inspections", { templateId: template.id, body: { date, location, performedBy: "합성 점검자", answers: template.body.items.map((x: { id: string }) => ({ itemId: x.id, result: "pass", comment: "" })) } });
    assert.equal(res.status, 200, res.text);
    if (!draft) {
      res = await write("post", base + `/inspections/${res.body.id}/submit`, { version: res.body.version });
      assert.equal(res.status, 200, res.text);
    }
    return res.body.id as string;
  }
  return { db, site, base, m, login, record };
}
test("batch print holds every non-draft record of the filter, one page each, escaped", async () => {
  const f = await fixture();
  try {
    await f.record("가 구역 <b>", "2026-10-01");
    await f.record("나 구역", "2026-10-02");
    await f.record("초안 구역", "2026-10-03", true);
    const single = await f.m.agent.get(f.base + "/inspections/" + (await f.record("다 구역", "2026-11-05")) + "/print");
    let r = await f.m.agent.get(f.base + "/inspection-register/print?from=2026-10-01&to=2026-10-31");
    assert.equal(r.status, 200, r.text);
    assert.equal((r.text.match(/<section class="form-page">/g) ?? []).length, 2);
    assert.match(r.text, /점검 기록 2건 · 조건: 기록일 2026-10-01~2026-10-31/);
    assert.match(r.text, /가 구역 &lt;b&gt;/);
    assert.match(r.text, /&lt;script&gt;양식&lt;\/script&gt;/);
    assert.doesNotMatch(r.text, /<script>|초안 구역|다 구역/);
    // The same record prints the same body in both documents.
    r = await f.m.agent.get(f.base + "/inspection-register/print?keyword=" + encodeURIComponent("다 구역"));
    const body = /<main>(.*)<\/main>/s.exec(single.text)![1];
    assert.ok(r.text.includes(`<section class="form-page">${body}</section>`));
    assert.equal((await f.m.agent.get(f.base + "/inspection-register/print?status=draft")).status, 400);
    assert.equal((await f.m.agent.get(f.base + "/inspection-register/print?bogus=1")).status, 400);
    r = await f.m.agent.get(f.base + "/inspection-register/print?keyword=" + encodeURIComponent("없는 구역"));
    assert.equal(r.status, 200);
    assert.match(r.text, /점검 기록 0건/);
  } finally { f.db.close(); }
});
test("batch print is for site members only and refuses more than 100 instead of printing a part", async () => {
  const f = await fixture();
  try {
    const id = await f.record("대량", "2026-10-01");
    assert.equal((await (await f.login("viewer")).agent.get(f.base + "/inspection-register/print")).status, 200);
    assert.equal((await (await f.login("outside")).agent.get(f.base + "/inspection-register/print")).status, 403);
    const copy = f.db.prepare("INSERT INTO inspections(id,site_id,template_id,template_snapshot,owner_id,body,status,version,submitted_snapshot,review,created_at) SELECT ?,site_id,template_id,template_snapshot,owner_id,body,status,version,submitted_snapshot,review,created_at FROM inspections WHERE id=?");
    for (let i = 0; i < 99; i++) copy.run(randomUUID(), id);
    assert.equal((await f.m.agent.get(f.base + "/inspection-register/print")).status, 200);
    copy.run(randomUUID(), id);
    const r = await f.m.agent.get(f.base + "/inspection-register/print");
    assert.equal(r.status, 409);
    assert.match(r.body.error, /100건까지/);
  } finally { f.db.close(); }
});
