import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import request from "supertest";
import { openDatabase } from "../server/db.js";
import { createApp } from "../server/app.js";
import { readPublicSettings, savePublicSettings, type PublicRuntime } from "../server/public-access.js";
import { monitorTick } from "../server/public-monitor.js";
import { CloudflareError, type Cloudflare } from "../server/cloudflare-api.js";
import { ELEVATED, type PublicSetupDeps } from "../server/public-setup.js";
// 외부 접속 마법사 API (specs/001-easy-domain-setup quickstart U1–U17). Router, Cloudflare, DNS, OS and ACME are fakes.
const origin = "http://127.0.0.1:3000", secret = "synthetic-wizard-secret-".repeat(3);
const GOOD = "synthetic_cf_api_token_GOOD", TUNNEL_TOKEN = "eyJ-synthetic-tunnel-token-WXYZ";
type World = { ip: string; dns: string[]; fw: number; profile: string; cfd: boolean; reach: boolean; upnp: boolean; records: Map<string, { type: string; content: string }>; tunnels: string[]; upnpCalls: number[]; uac: number; elevated: string[] };
function world(): World { return { ip: "203.0.113.5", dns: [], fw: 0, profile: "Private", cfd: false, reach: false, upnp: false, records: new Map(), tunnels: [], upnpCalls: [], uac: 1223, elevated: [] }; }
function deps(w: World, dir: string): Partial<PublicSetupDeps> {
  const cf = (t: string) => ({
    verify: async () => { if (t !== GOOD) throw new CloudflareError("Cloudflare 응답: Invalid API Token"); },
    findZone: async (host: string) => (host.endsWith("example.test") ? { zoneId: "z1", accountId: "a1", zone: "example.test" } : null),
    ensureTunnel: async (_a: string, name: string) => { const created = !w.tunnels.includes(name); if (created) w.tunnels.push(name); return { id: "t1", created }; },
    putIngress: async () => ({}),
    tunnelToken: async () => TUNNEL_TOKEN,
    ensureDns: async (_z: string, want: { type: string; name: string; content: string }, overwrite = false) => {
      const cur = w.records.get(want.name);
      if (cur && (cur.type !== want.type || cur.content !== want.content) && !overwrite) return { status: "conflict" as const, current: `${cur.type} ${cur.content}` };
      w.records.set(want.name, { type: want.type, content: want.content });
      return { status: cur ? ("replaced" as const) : ("created" as const) };
    },
  }) as unknown as Cloudflare;
  return {
    upnp: {
      externalIp: async () => null,
      addPortMapping: async (m) => { w.upnpCalls.push(m.externalPort); return w.upnp ? { ok: true } : { ok: false, kind: "unsupported", detail: "공유기가 자동 설정(UPnP)을 지원하지 않거나 꺼져 있습니다." }; },
    },
    cloudflare: cf, fetch: (async () => new Response(`ip=${w.ip}\n`)) as never, resolve: async () => w.dns, platform: "win32",
    run: async (_cmd, args) => {
      const a = args.join(" ");
      // The UAC wrapper: decode the one command it would run elevated; a "yes" with code 0 makes that command take effect.
      if (a.includes("Start-Process")) {
        const cmd = Buffer.from(/'-EncodedCommand','([A-Za-z0-9+/=]+)'/.exec(a)![1], "base64").toString("utf16le");
        w.elevated.push(cmd);
        if (w.uac === 0 && cmd.startsWith("New-NetFirewallRule")) w.fw = 1;
        if (w.uac === 0 && cmd.startsWith("winget install")) w.cfd = true;
        return { code: w.uac, stdout: "" };
      }
      if (a.includes("Get-NetFirewallRule")) return { code: 0, stdout: String(w.fw) };
      if (a.includes("NetConnectionProfile")) return { code: 0, stdout: w.profile };
      if (args[0] === "--version") return w.cfd ? { code: 0, stdout: "cloudflared version 2026.7.3" } : { code: 1, stdout: "", missing: true };
      return { code: 1, stdout: "" };
    },
    listen: async () => () => {}, issue: async () => { if (!w.reach) throw new Error("Verify error: Connection refused"); return { cert: "", key: "" }; },
    reachCooldownMs: 0, tlsDir: dir, port: 3000,
  };
}
async function fixture(runtime: PublicRuntime = { mode: "off", state: "꺼짐" }, extra: Partial<PublicSetupDeps> = {}) {
  const db = openDatabase(":memory:"), password = randomUUID(), dir = mkdtempSync(join(tmpdir(), "yweb-setup-")), w = world();
  for (const [id, email, op] of [["op", "op@example.test", 1], ["w", "w@example.test", 0]] as const) {
    db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(id, email, id, await argon2.hash(password));
    if (op) db.prepare("INSERT INTO account_grants(user_id,operator,issuer,granted_by,granted_at) VALUES(?,1,0,NULL,?)").run(id, new Date().toISOString());
  }
  const d = { ...deps(w, dir), ...extra } as PublicSetupDeps;
  const app = await createApp(db, { origin, secret, publicRuntime: runtime, publicSetup: d });
  let restarts = 0;
  app.locals.requestRestart = () => { restarts++; };
  async function login(email: string) {
    const a = request.agent(app);
    let r = await a.get("/api/session");
    r = await a.post("/api/login").set("Origin", origin).set("x-csrf-token", r.body.csrf).send({ email, password });
    const csrf = r.body.csrf as string;
    const send = (method: "put" | "post" | "delete", path: string, body: object = {}, headers: Record<string, string> = {}) => {
      let q = a[method]("/api/public-setup" + path).set("Origin", origin).set("x-csrf-token", csrf);
      for (const [k, v] of Object.entries(headers)) q = q.set(k, v);
      return q.send(body);
    };
    return { status: () => a.get("/api/public-access/status"), get: (headers: Record<string, string> = {}) => { let q = a.get("/api/public-setup"); for (const [k, v] of Object.entries(headers)) q = q.set(k, v); return q; }, send };
  }
  // The reachability test runs in the background; wait until the router step is no longer "running".
  async function settle(op: Awaited<ReturnType<typeof login>>) {
    for (let i = 0; i < 50; i++) {
      const v = (await op.get()).body;
      if (v.steps.find((s: { id: string }) => s.id === "router")?.check?.status !== "running") return v;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error("router check never finished");
  }
  return { db, w, d, login, settle, restarts: () => restarts, close: () => { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}
const step = (v: { steps: { id: string }[] }, id: string) => v.steps.find((s) => s.id === id) as { id: string; check: { status: string; reason: string; current?: string; expected?: string } | null; copy: { label: string; value: string }[]; command: string | null; action: string | null };
test("wizard: operator on this PC only; nothing leaks to others", async () => {
  const f = await fixture();
  try {
    const op = await f.login("op@example.test"), worker = await f.login("w@example.test");
    assert.equal((await op.get()).body.started, false);
    for (const headers of [{ Host: "safety.example.test" }, { "cf-connecting-ip": "203.0.113.5" }] as Record<string, string>[]) {
      const r = await op.get(headers);
      assert.equal(r.status, 403);
      assert.ok(!JSON.stringify(r.body).includes("203.0.113"), "no IP in a refusal");
      assert.equal((await op.send("post", "/start", {}, headers)).status, 403);
    }
    assert.equal((await worker.get()).status, 403);
    assert.equal((await worker.send("post", "/apply")).status, 403);
    let v = (await op.send("post", "/start")).body;
    assert.deepEqual([v.started, v.recommended, v.chosen], [true, "tunnel", "tunnel"], "Cloudflare Tunnel first");
    assert.deepEqual(v.steps.map((s: { id: string }) => s.id), ["domain", "cf-token", "cf-provision", "cloudflared"]);
    await op.send("put", "/form", { chosen: "direct" });
    v = (await op.send("post", "/start")).body;
    assert.equal(v.chosen, "direct", "starting again keeps the chosen method");
  } finally { f.close(); }
});
test("wizard: direct connection — checks, router fallback, apply only when every step passes", async () => {
  const runtime: PublicRuntime = { mode: "off", state: "꺼짐", launcher: false };
  const f = await fixture(runtime);
  try {
    const op = await f.login("op@example.test");
    await op.send("post", "/start");
    await op.send("put", "/form", { chosen: "direct" });
    assert.equal((await op.send("put", "/form", { domain: "bad domain" })).status, 400);
    let v = (await op.send("put", "/form", { domain: "safety.example.test", email: "o@example.test", agreeTos: true })).body;
    assert.deepEqual(v.steps.map((s: { id: string }) => s.id), ["domain", "cf-token", "dns", "firewall", "router", "cert-info"]);
    assert.equal(step(v, "domain").check?.status, "ok");
    assert.equal(step(v, "cert-info").check?.status, "ok");
    await op.send("post", "/check", { step: "all" });
    v = await f.settle(op);
    assert.deepEqual([step(v, "dns").check?.status, step(v, "dns").check?.expected], ["todo", "203.0.113.5"]);
    assert.ok(step(v, "dns").copy.some((c) => c.value === "203.0.113.5"), "the A record value is ready to copy");
    assert.equal(step(v, "firewall").check?.status, "todo");
    assert.match(String(step(v, "firewall").command), /^New-NetFirewallRule -DisplayName 'Y웹 HTTP\/HTTPS'/);
    assert.equal(step(v, "router").check?.reason, "밖에서 80 포트로 접속이 거부됐습니다. 공유기 포트포워딩을 확인하세요.");
    assert.equal(v.canApply, false);
    assert.equal((await op.send("post", "/apply")).status, 409);
    // UPnP missing on a "public" network: still todo, manual values stay, the profile is named
    f.w.profile = "Public";
    v = (await op.send("post", "/run", { step: "router" })).body;
    assert.deepEqual(f.w.upnpCalls, [80, 443]);
    assert.equal(step(v, "router").check?.status, "todo");
    assert.match(step(v, "router").check!.reason, /직접 설정하세요.*공용/);
    assert.deepEqual(step(v, "router").copy.map((c) => c.label), ["내부 IP", "포트"]);
    // UPnP works and the outside test passes
    Object.assign(f.w, { upnp: true, reach: true, dns: ["203.0.113.5"], fw: 1 });
    await op.send("post", "/run", { step: "router" });
    await op.send("post", "/check", { step: "all" });
    v = await f.settle(op);
    assert.deepEqual(v.steps.map((s: { check: { status: string } | null }) => s.check?.status), ["ok", "unknown", "ok", "ok", "ok", "ok"]);
    assert.equal(v.canApply, true);
    const applied = await op.send("post", "/apply");
    assert.deepEqual(applied.body, { restarting: false, message: "저장했습니다. 앱을 다시 시작하면 적용됩니다." });
    const pub = readPublicSettings(f.db, secret);
    assert.deepEqual([pub.mode, pub.domain, pub.email, !!pub.tosAgreedAt], ["direct", "safety.example.test", "o@example.test", true]);
    assert.equal(f.restarts(), 0);
    runtime.launcher = true;
    assert.deepEqual((await op.send("post", "/apply")).body, { restarting: true });
    assert.equal(f.restarts(), 1);
    // a new domain makes old results stale
    v = (await op.send("put", "/form", { domain: "other.example.test" })).body;
    assert.equal(step(v, "dns").check, null);
    assert.equal((await op.send("delete", "")).body.started, false);
  } finally { f.close(); }
});
test("wizard: tunnel — API token sealed, Cloudflare objects made once, DNS conflict needs overwrite", async () => {
  const f = await fixture();
  try {
    const op = await f.login("op@example.test");
    await op.send("post", "/start");
    assert.equal((await op.send("put", "/cf-token", { token: GOOD })).status, 400); // domain first
    let v = (await op.send("put", "/form", { domain: "safety.example.test" })).body;
    assert.deepEqual(v.steps.map((s: { id: string }) => s.id), ["domain", "cf-token", "cf-provision", "cloudflared"]);
    const bad = await op.send("put", "/cf-token", { token: "synthetic_cf_api_token_BAD0" });
    assert.equal(bad.status, 400);
    assert.match(bad.body.error, /Invalid API Token.*필요한 권한/);
    assert.equal((await op.get()).body.cfHint, null);
    v = (await op.send("put", "/cf-token", { token: GOOD })).body;
    assert.equal(v.cfHint, "…GOOD");
    assert.equal(step(v, "cf-token").check?.status, "ok");
    assert.equal((await op.send("post", "/apply")).status, 409);
    f.w.records.set("safety.example.test", { type: "A", content: "198.51.100.7" });
    const clash = await op.send("post", "/run", { step: "cf-provision" });
    assert.equal(clash.status, 409);
    assert.deepEqual(clash.body.conflict, { current: "A 198.51.100.7" });
    v = (await op.send("post", "/run", { step: "cf-provision", overwrite: true })).body;
    assert.equal(step(v, "cf-provision").check?.status, "ok");
    await op.send("post", "/run", { step: "cf-provision" });
    assert.deepEqual(f.w.tunnels, ["yweb-safety.example.test"], "made once");
    assert.deepEqual(f.w.records.get("safety.example.test"), { type: "CNAME", content: "t1.cfargotunnel.com" });
    v = (await op.send("post", "/check", { step: "cloudflared" })).body;
    assert.equal(step(v, "cloudflared").check?.reason, "cloudflared가 설치되어 있지 않습니다.");
    assert.equal(step(v, "cloudflared").command, ELEVATED.cloudflared);
    f.w.cfd = true;
    v = (await op.send("post", "/check", { step: "cloudflared" })).body;
    assert.equal(v.canApply, true);
    assert.equal((await op.send("post", "/apply")).body.restarting, false);
    const pub = readPublicSettings(f.db, secret);
    assert.deepEqual([pub.mode, pub.domain, pub.tunnelToken], ["tunnel", "safety.example.test", TUNNEL_TOKEN]);
    const raw = JSON.stringify([f.db.prepare("SELECT * FROM public_setup").get(), f.db.prepare("SELECT * FROM public_access").get(), (await op.get()).body]);
    assert.ok(!raw.includes(GOOD) && !raw.includes(TUNNEL_TOKEN), "tokens are sealed and never sent back");
    assert.equal((await op.send("post", "/run", { step: "rm" })).status, 400, "only fixed actions run");
    assert.equal((await op.send("post", "/check", { step: "rm -rf" })).status, 400);
  } finally { f.close(); }
});
test("wizard: firewall and cloudflared with one 'run as administrator' button (US2)", async () => {
  const f = await fixture();
  try {
    const op = await f.login("op@example.test");
    await op.send("post", "/start");
    await op.send("put", "/form", { chosen: "direct" });
    let v = (await op.send("put", "/form", { domain: "safety.example.test" })).body;
    assert.deepEqual([step(v, "firewall").action, step(v, "firewall").command], ["uac-firewall", ELEVATED.firewall], "the command is on screen before it runs");
    // declined at the Windows prompt
    v = (await op.send("post", "/run", { step: "firewall" })).body;
    assert.deepEqual([step(v, "firewall").check?.status, step(v, "firewall").check?.reason], ["todo", "실행하지 않았습니다(권한 확인에서 취소)."]);
    assert.deepEqual(f.w.elevated, [ELEVATED.firewall], "exactly the fixed command, nothing from the request");
    // the command fails
    f.w.uac = 5;
    v = (await op.send("post", "/run", { step: "firewall" })).body;
    assert.match(step(v, "firewall").check!.reason, /명령이 실패했습니다\(코드 5\)/);
    // accepted: the rule exists afterwards and the step re-checks itself
    f.w.uac = 0;
    v = (await op.send("post", "/run", { step: "firewall" })).body;
    assert.equal(step(v, "firewall").check?.status, "ok");
    await op.send("put", "/form", { chosen: "tunnel" });
    v = (await op.send("post", "/run", { step: "cloudflared" })).body;
    assert.deepEqual([step(v, "cloudflared").action, step(v, "cloudflared").check?.status], ["uac-cloudflared", "ok"]);
    assert.equal(f.w.elevated.at(-1), ELEVATED.cloudflared);
  } finally { f.close(); }
  const linux = await fixture(undefined, { platform: "linux" });
  try {
    const op = await linux.login("op@example.test");
    await op.send("post", "/start");
    await op.send("put", "/form", { chosen: "direct" });
    const v = (await op.send("put", "/form", { domain: "safety.example.test" })).body;
    assert.equal(step(v, "firewall").action, null);
    const r = await op.send("post", "/run", { step: "firewall" });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /직접 실행/);
    assert.deepEqual(linux.w.elevated, []);
  } finally { linux.close(); }
});
test("home status line and the 10-minute watch: DNS repaired after a new public IP (US3)", async () => {
  const runtime: PublicRuntime = { mode: "off", state: "꺼짐" };
  const f = await fixture(runtime);
  try {
    const op = await f.login("op@example.test"), worker = await f.login("w@example.test");
    const status = async () => (await op.status()).body as { tone: string; step: string | null; line: string };
    assert.deepEqual(await status(), { tone: "off", step: null, line: "휴대폰에서도 쓰려면 도메인을 연결하세요." });
    assert.equal((await worker.status()).status, 403);
    await op.send("post", "/start");
    await op.send("put", "/form", { chosen: "direct" });
    assert.equal((await status()).line, "도메인 연결을 마저 진행하세요.");
    // running as a direct connection
    savePublicSettings(f.db, secret, "op", { mode: "direct", domain: "safety.example.test", email: "o@example.test", agreeTos: true, tunnelToken: "" });
    Object.assign(runtime, { mode: "direct", state: "실행 중", origin: "https://safety.example.test", certNotAfter: "2027-01-30T00:00:00.000Z" });
    f.w.dns = ["203.0.113.5"];
    const tick = () => monitorTick({ db: f.db, secret, runtime, deps: f.d });
    await tick();
    assert.deepEqual(await status(), { tone: "ok", step: null, line: "외부 접속 정상 · https://safety.example.test · 인증서 2027-01-30까지" });
    assert.deepEqual(f.w.upnpCalls, [80, 443], "port mappings are re-added each tick (routers forget them on reboot)");
    // the line's public IP changed; DNS still points at the old one and no Cloudflare token is stored
    f.w.ip = "198.51.100.20";
    await tick();
    const broken = await status();
    assert.deepEqual([broken.tone, broken.step], ["error", "dns"]);
    assert.match(broken.line, /198\.51\.100\.20/);
    // with the wizard's Cloudflare token for this domain the next tick fixes the A record itself
    await op.send("put", "/form", { domain: "safety.example.test" });
    await op.send("put", "/cf-token", { token: GOOD });
    await tick();
    assert.deepEqual(f.w.records.get("safety.example.test"), { type: "A", content: "198.51.100.20" });
    assert.equal((await status()).tone, "ok");
    // offline: the last state stays
    f.w.ip = "<none>";
    await tick();
    assert.equal((await status()).tone, "ok");
    Object.assign(runtime, { state: "중지", detail: "인증서 발급 실패" });
    assert.deepEqual(await status(), { tone: "error", step: "router", line: "외부 접속이 멈췄습니다: 인증서 발급 실패" });
    Object.assign(runtime, { mode: "tunnel", state: "재연결 대기", detail: "cloudflared 종료(코드 1)." });
    assert.deepEqual(await status(), { tone: "warn", step: "cloudflared", line: "외부 접속 연결 중: cloudflared 종료(코드 1)." });
  } finally { f.close(); }
});
