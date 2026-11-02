import type { Express, Request, Response, NextFunction } from "express";
import { resolve } from "node:path";
import { z } from "zod";
import type { Db } from "./db.js";
import { HttpError } from "./site-operations.js";
import { requireLocalOperator } from "./accounts.js";
import { domainSchema, savePublicSettings, type PublicRuntime } from "./public-access.js";
import { checkCloudflared, checkDns, checkFirewall, FIREWALL_RULE, networkProfile, PUBLIC_PROFILE_NOTE, publicIp, reachabilityTest, resolveHost, runCommand, runElevated, UAC_CANCELLED, type Listen, type Resolve, type Run } from "./public-checks.js";
import type { Issue } from "./public-serve.js";
import { CF_TOKEN_PERMISSIONS, CloudflareError, createCloudflare, type Cloudflare } from "./cloudflare-api.js";
import { createUpnp, localAddressFor, type Upnp } from "./upnp.js";
import { clearSetup, mergeCheck, readSetup, writeSetup, type CheckResult, type Setup, type SetupMode } from "./public-setup-store.js";
import { summarize } from "./public-monitor.js";
// 외부 접속 마법사 (specs/001-easy-domain-setup, contracts/public-setup-api.md). Operator, browser on the install PC only.
// Every step shows its state, the values to copy for doing it by hand, and — where the app can — a "do it for me" button.
// An automatic attempt that fails leaves the manual values in place (research R9). Nothing reaches public_access until 적용.
export type PublicSetupDeps = {
  upnp: Pick<Upnp, "externalIp" | "addPortMapping">; cloudflare: (token: string) => Cloudflare; fetch: typeof fetch;
  resolve: Resolve; run: Run; platform: NodeJS.Platform; listen?: Listen; issue?: Issue; reachCooldownMs?: number;
  tlsDir: string; port: number;
};
export const defaultSetupDeps = (port: number): PublicSetupDeps => ({
  upnp: createUpnp(), cloudflare: (t) => createCloudflare(t), fetch: globalThis.fetch, resolve: resolveHost, run: runCommand,
  platform: process.platform, tlsDir: resolve(process.env.TLS_DIR || "./data/tls"), port,
});
export const ELEVATED = {
  firewall: `New-NetFirewallRule -DisplayName '${FIREWALL_RULE}' -Direction Inbound -Protocol TCP -LocalPort 80,443 -Action Allow`,
  cloudflared: "winget install --id Cloudflare.cloudflared --accept-source-agreements --accept-package-agreements",
};
export const EXTERNAL_SERVICES = "공인 IP 확인은 공유기 또는 Cloudflare, 외부 도달 시험은 Let's Encrypt 시험 서버, 터널·DNS 생성은 Cloudflare API에 요청합니다. 보내는 것은 이 PC의 IP와 도메인뿐이며 현장·계정 정보는 보내지 않습니다.";
type Copy = { label: string; value: string };
export type StepView = { id: string; title: string; required: boolean; help: string; check: CheckResult | null; action: string | null; actionLabel: string | null; command: string | null; copy: Copy[] };
const ORDER: Record<SetupMode, string[]> = {
  direct: ["domain", "cf-token", "dns", "firewall", "router", "cert-info"],
  tunnel: ["domain", "cf-token", "cf-provision", "cloudflared"],
};
const now = () => new Date().toISOString();
const ok = (reason: string): CheckResult => ({ status: "ok", reason, at: now() });
const todo = (reason: string): CheckResult => ({ status: "todo", reason, at: now() });
// Steps the app can always settle from what is stored; the rest keep the last stored check.
function stateCheck(id: string, s: Setup, mode: SetupMode): CheckResult | null {
  if (id === "domain") return s.domain ? ok(`도메인: ${s.domain}`) : todo("산 도메인 주소를 입력하세요.");
  if (id === "cf-token") {
    if (!s.cfToken) return mode === "tunnel" ? todo("Cloudflare API 토큰을 넣으세요.") : { status: "unknown", reason: "선택 사항: DNS를 Cloudflare에서 관리하면 토큰을 넣어 A 레코드를 앱이 만들게 할 수 있습니다.", at: now() };
    return s.cfZoneId ? ok("Cloudflare에서 이 도메인을 찾았습니다.") : todo("이 토큰으로 이 도메인을 찾지 못했습니다. 도메인을 Cloudflare에 추가했는지 확인하세요.");
  }
  if (id === "cert-info") return s.email && s.agreeTos ? ok("인증서 알림 이메일과 약관 동의가 입력되었습니다.") : todo("인증서 알림 이메일을 입력하고 Let's Encrypt 이용약관에 동의하세요.");
  if (id === "cf-provision") return s.cfTunnelId ? ok("Cloudflare에 터널과 DNS가 만들어져 있습니다.") : todo("아직 Cloudflare에 터널을 만들지 않았습니다.");
  return s.checks[id] ?? null;
}
function stepView(id: string, s: Setup, mode: SetupMode, deps: PublicSetupDeps): StepView {
  const win = deps.platform === "win32", lan = localAddressFor("") ?? "(이 PC의 내부 IP)";
  const base = { id, required: true, check: stateCheck(id, s, mode), action: null, actionLabel: null, command: null, copy: [] as Copy[] };
  switch (id) {
    case "domain": return { ...base, title: "도메인", help: "산 도메인 주소를 입력합니다(예: safety.example.com). 도메인이 없다면 등록 대행사에서 먼저 사세요(DNS 레코드를 편집할 수 있어야 합니다)." };
    case "cf-token": return {
      ...base, title: "Cloudflare API 토큰", required: mode === "tunnel",
      help: "Cloudflare 대시보드 → 내 프로필 → API 토큰 → 토큰 만들기에서 아래 권한으로 만들고, 대상 영역은 이 도메인만 고른 뒤 붙여 넣으세요.",
      copy: [{ label: "필요한 권한", value: CF_TOKEN_PERMISSIONS.join(" / ") }],
    };
    case "dns": return {
      ...base, title: "DNS (A 레코드)", help: "도메인 회사의 DNS 관리 화면에서 이 도메인의 A 레코드를 이 PC의 공인 IP로 만드세요.",
      action: s.cfZoneId ? "cf-dns" : null, actionLabel: s.cfZoneId ? "A 레코드 만들기" : null,
      copy: [{ label: "이름", value: s.domain }, { label: "값(공인 IP)", value: s.checks.dns?.expected ?? "‘다시 확인’을 누르면 표시됩니다" }],
    };
    case "firewall": return {
      ...base, title: "Windows 방화벽", command: win ? ELEVATED.firewall : null, action: win ? "uac-firewall" : null, actionLabel: win ? "관리자 권한으로 실행" : null,
      help: win ? "80·443 수신을 허용합니다. ‘관리자 권한으로 실행’을 누르거나, 아래 명령을 관리자 PowerShell에서 직접 실행하세요." : "이 PC의 방화벽에서 TCP 80·443 수신을 허용하세요.",
    };
    case "router": return {
      ...base, title: "공유기 포트포워딩", help: "공유기 관리 화면에서 외부 TCP 80·443을 이 PC의 같은 포트로 보내세요. 끝나면 ‘다시 확인’으로 밖에서 닿는지 시험합니다.",
      action: "upnp", actionLabel: "공유기에 80·443 열기",
      copy: [{ label: "내부 IP", value: lan }, { label: "포트", value: "80 → 80, 443 → 443 (TCP)" }],
    };
    case "cert-info": return { ...base, title: "인증서 정보", help: "인증서 만료 알림을 받을 이메일과 Let's Encrypt 이용약관 동의가 필요합니다." };
    case "cf-provision": return { ...base, title: "Cloudflare 터널·DNS", help: "앱이 Cloudflare에 터널을 만들고 이 도메인을 이 PC로 연결합니다. 접속 내용은 Cloudflare를 거치며 데이터는 이 PC에만 저장됩니다.", action: "cf-provision", actionLabel: "Cloudflare에 만들기", copy: [{ label: "서비스 주소", value: `http://127.0.0.1:${deps.port}` }] };
    case "cloudflared": return {
      ...base, title: "cloudflared 설치", command: win ? ELEVATED.cloudflared : null, action: win ? "uac-cloudflared" : null, actionLabel: win ? "관리자 권한으로 실행" : null,
      help: win ? "이 PC에 cloudflared를 설치합니다. ‘관리자 권한으로 실행’을 누르거나, 아래 명령을 PowerShell에서 직접 실행하세요." : "이 PC에 cloudflared를 설치하세요.",
    };
  }
  throw new Error("unknown step " + id);
}
// Firewall "확인 불가" passes: off Windows the app cannot read it, and the reachability test proves the path anyway.
export const passes = (v: StepView) => !v.required || v.check?.status === "ok" || (v.id === "firewall" && v.check?.status === "unknown");
export function registerPublicSetup(app: Express, db: Db, runtime: PublicRuntime, secret: string, deps: PublicSetupDeps) {
  const reaching = new Set<string>();
  const route = (fn: (req: Request, res: Response, user: string) => unknown) => async (req: Request, res: Response, next: NextFunction) => {
    try { const user = requireLocalOperator(db, req); await fn(req, res, user); } catch (e) { next(e instanceof CloudflareError ? new HttpError(400, e.message) : e); }
  };
  const setup = () => readSetup(db, secret);
  const mode = (s: Setup | null): SetupMode | null => s?.chosen ?? null;
  function view() {
    const s = setup(), m = mode(s);
    const steps = s && m ? ORDER[m].map((id) => stepView(id, s, m, deps)) : [];
    return {
      started: !!s,
      recommended: s?.recommended ?? null, chosen: m, domain: s?.domain ?? "", email: s?.email ?? "", agreeTos: s?.agreeTos ?? false,
      cfHint: s?.cfHint ?? null, steps, canApply: steps.length > 0 && steps.every(passes),
      runtime, platform: deps.platform === "win32" ? "win32" : "other", launcher: !!runtime.launcher, externalServices: EXTERNAL_SERVICES,
    };
  }
  async function note(reason: string) {
    return (await networkProfile({ run: deps.run, platform: deps.platform })) === "Public" ? `${reason} ${PUBLIC_PROFILE_NOTE}` : reason;
  }
  function startReach(s: Setup, user: string) {
    if (runtime.mode === "direct" && runtime.state === "실행 중") return mergeCheck(db, secret, user, "router", ok("이미 직접 연결로 실행 중입니다."));
    if (reaching.has(s.domain)) return;
    reaching.add(s.domain);
    mergeCheck(db, secret, user, "router", { status: "running", reason: "밖에서 이 PC에 닿는지 시험하는 중입니다(최대 1분).", at: now() });
    void reachabilityTest({ domain: s.domain, dir: deps.tlsDir, issue: deps.issue, listen: deps.listen, cooldownMs: deps.reachCooldownMs })
      .then((r) => mergeCheck(db, secret, user, "router", r))
      .finally(() => reaching.delete(s.domain));
  }
  async function check(id: string, s: Setup, user: string) {
    if (id === "dns") mergeCheck(db, secret, user, "dns", await checkDns(s.domain, await publicIp({ upnp: deps.upnp, fetch: deps.fetch }), { resolve: deps.resolve }));
    else if (id === "firewall") mergeCheck(db, secret, user, "firewall", await checkFirewall({ run: deps.run, platform: deps.platform }));
    else if (id === "cloudflared") mergeCheck(db, secret, user, "cloudflared", await checkCloudflared({ run: deps.run }));
    else if (id === "router") startReach(s, user);
  }
  const needDomain = (s: Setup | null) => { if (!s?.domain) throw new HttpError(400, "먼저 도메인을 입력하세요."); return s; };
  const needCf = (s: Setup) => { if (!s.cfToken || !s.cfZoneId || !s.cfAccountId) throw new HttpError(400, "먼저 Cloudflare API 토큰을 넣으세요."); return { cf: deps.cloudflare(s.cfToken), zone: s.cfZoneId, account: s.cfAccountId }; };
  const conflict = (res: Response, current: string) => res.status(409).json({ error: `이 이름에 이미 다른 DNS 레코드가 있습니다(${current}). 바꾸려면 ‘덮어쓰기’를 누르세요.`, conflict: { current } });

  app.get("/api/public-setup", route((_req, res) => res.json(view())));
  app.get("/api/public-access/status", route((_req, res) => res.json(summarize(runtime, !!setup()))));
  // Cloudflare Tunnel first (사용자 결정 2026-11-02): free, and no router or firewall changes. Direct connection stays
  // available under 고급 through /form { chosen }. Starting again keeps what was already chosen.
  app.post("/api/public-setup/start", route((_req, res, user) => {
    if (!setup()) writeSetup(db, secret, user, { recommended: "tunnel", chosen: "tunnel" });
    res.json(view());
  }));
  app.put("/api/public-setup/form", route(async (req, res, user) => {
    const f = z.object({ chosen: z.enum(["direct", "tunnel"]).optional(), domain: z.union([z.literal(""), domainSchema]).optional(), email: z.union([z.literal(""), z.email().max(254)]).optional(), agreeTos: z.boolean().optional() }).strict().parse(req.body);
    const s = setup();
    if (!s) throw new HttpError(409, "먼저 질문에 답하세요.");
    const patch: Parameters<typeof writeSetup>[3] = { ...f };
    if (f.domain !== undefined && f.domain !== s.domain) {
      // Checks and Cloudflare objects belong to the old name; the token stays and finds the new zone.
      Object.assign(patch, { checks: {}, cfZoneId: null, cfAccountId: null, cfTunnelId: null });
      if (s.cfToken && f.domain) {
        const z1 = await deps.cloudflare(s.cfToken).findZone(f.domain).catch(() => null);
        if (z1) Object.assign(patch, { cfZoneId: z1.zoneId, cfAccountId: z1.accountId });
      }
    }
    writeSetup(db, secret, user, patch);
    res.json(view());
  }));
  app.put("/api/public-setup/cf-token", route(async (req, res, user) => {
    const { token } = z.object({ token: z.string().trim().regex(/^[A-Za-z0-9_-]{20,200}$/, "토큰 형식을 확인하세요.") }).strict().parse(req.body);
    const s = needDomain(setup()), cf = deps.cloudflare(token);
    try {
      await cf.verify();
      const zone = await cf.findZone(s.domain);
      if (!zone) throw new HttpError(400, `이 토큰으로 볼 수 있는 Cloudflare 영역에 ${s.domain}이(가) 없습니다. 도메인을 Cloudflare에 추가했는지, 토큰의 대상 영역을 확인하세요.`);
      writeSetup(db, secret, user, { cfToken: token, cfZoneId: zone.zoneId, cfAccountId: zone.accountId, cfTunnelId: null });
    } catch (e) {
      if (e instanceof CloudflareError) throw new HttpError(400, `${e.message} 필요한 권한: ${CF_TOKEN_PERMISSIONS.join(", ")}`);
      throw e;
    }
    res.json(view());
  }));
  app.delete("/api/public-setup/cf-token", route((_req, res, user) => { if (setup()) writeSetup(db, secret, user, { cfToken: null }); res.json(view()); }));
  app.post("/api/public-setup/check", route(async (req, res, user) => {
    const { step } = z.object({ step: z.string().max(40) }).strict().parse(req.body);
    const s = needDomain(setup()), m = mode(s)!;
    for (const id of step === "all" ? ORDER[m] : [step]) {
      if (!ORDER[m].includes(id)) throw new HttpError(400, "알 수 없는 단계입니다.");
      await check(id, s, user);
    }
    res.json(view());
  }));
  app.post("/api/public-setup/run", route(async (req, res, user) => {
    const { step, overwrite } = z.object({ step: z.enum(["router", "dns", "cf-provision", "firewall", "cloudflared"]), overwrite: z.boolean().optional() }).strict().parse(req.body);
    const s = needDomain(setup());
    if (step === "firewall" || step === "cloudflared") {
      // Only the two fixed commands, shown on screen first; Windows asks the user before either runs.
      if (deps.platform !== "win32") throw new HttpError(400, "이 OS에서는 명령을 복사해 직접 실행하세요.");
      const code = await runElevated(ELEVATED[step], deps.run);
      if (code === UAC_CANCELLED) mergeCheck(db, secret, user, step, todo("실행하지 않았습니다(권한 확인에서 취소)."));
      else {
        await check(step, s, user); // "already installed" also ends here as 완료
        if (code !== 0 && setup()!.checks[step]?.status !== "ok") mergeCheck(db, secret, user, step, todo(`명령이 실패했습니다(코드 ${code}). 아래 명령을 관리자 PowerShell에서 직접 실행하세요.`));
      }
      return res.json(view());
    }
    if (step === "router") {
      const results = [await deps.upnp.addPortMapping({ externalPort: 80, internalPort: 80 }), await deps.upnp.addPortMapping({ externalPort: 443, internalPort: 443 })];
      const failed = results.find((r) => !r.ok);
      if (failed && !failed.ok) mergeCheck(db, secret, user, "router", todo(await note(`${failed.detail} 아래 값으로 공유기에서 직접 설정하세요.`)));
      else startReach(s, user);
      return res.json(view());
    }
    const { cf, zone, account } = needCf(s);
    if (step === "dns") {
      const ip = await publicIp({ upnp: deps.upnp, fetch: deps.fetch });
      if (!ip) throw new HttpError(400, "이 PC의 공인 IP를 확인하지 못했습니다.");
      const r = await cf.ensureDns(zone, { type: "A", name: s.domain, content: ip, proxied: false }, overwrite);
      if (r.status === "conflict") return conflict(res, r.current);
      await check("dns", s, user);
      return res.json(view());
    }
    const tunnel = await cf.ensureTunnel(account, `yweb-${s.domain}`);
    await cf.putIngress(account, tunnel.id, s.domain, deps.port);
    const r = await cf.ensureDns(zone, { type: "CNAME", name: s.domain, content: `${tunnel.id}.cfargotunnel.com`, proxied: true }, overwrite);
    if (r.status === "conflict") return conflict(res, r.current);
    writeSetup(db, secret, user, { cfTunnelId: tunnel.id });
    res.json(view());
  }));
  app.post("/api/public-setup/apply", route(async (req, res, user) => {
    const s = needDomain(setup()), v = view();
    const left = v.steps.filter((st) => !passes(st)).map((st) => st.title);
    if (left.length) throw new HttpError(409, `아직 끝나지 않은 단계: ${left.join(", ")}`);
    if (s.chosen === "direct") savePublicSettings(db, secret, user, { mode: "direct", domain: s.domain, email: s.email, agreeTos: true, tunnelToken: "" });
    else {
      const { cf, account } = needCf(s);
      savePublicSettings(db, secret, user, { mode: "tunnel", domain: s.domain, email: "", agreeTos: false, tunnelToken: await cf.tunnelToken(account, s.cfTunnelId!) });
    }
    const restart = req.app.locals.requestRestart as (() => void) | undefined;
    if (runtime.launcher && restart) { res.on("finish", restart); return res.json({ restarting: true }); }
    res.json({ restarting: false, message: "저장했습니다. 앱을 다시 시작하면 적용됩니다." });
  }));
  app.delete("/api/public-setup", route((_req, res) => { clearSetup(db); res.json(view()); }));
}
