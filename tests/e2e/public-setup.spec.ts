import { test, expect } from "@playwright/test";
// 외부 접속 마법사 (specs/001-easy-domain-setup US1). The server runs with TEST_PUBLIC_FAKES: router, DNS, firewall and
// the outside test are a synthetic world this spec changes through PUT /api/test/public-state.
test("domain wizard: Cloudflare Tunnel first, direct under 고급; step checks with values to copy, apply only when every step is done", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("이메일 또는 아이디", { exact: true }).fill("test@example.test");
  await page.getByLabel("비밀번호", { exact: true }).fill("synthetic-e2e-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page.getByRole("heading", { name: "오늘", exact: true })).toBeVisible();
  const world = async (data: object) => expect((await page.request.put("/api/test/public-state", { data })).ok()).toBe(true);

  // 홈 상태 한 줄 (US3): the operator on this PC sees where the domain stands and opens the wizard from there.
  await expect(page.getByText("휴대폰에서도 쓰려면 도메인을 연결하세요.")).toBeVisible();
  await page.getByRole("button", { name: "외부 접속 설정 열기" }).click();
  const step = (id: string) => page.locator(`#setup-${id}`), wizard = page.locator(".setup-wizard");
  // Cloudflare Tunnel first: no questions, no router steps.
  await page.getByRole("button", { name: "도메인 연결 시작", exact: true }).click();
  await expect(wizard).toContainText("방식: Cloudflare Tunnel · 무료이고 공유기를 만지지 않아도 됩니다.");
  await expect(step("cf-provision")).toBeVisible();
  await expect(step("router")).toHaveCount(0);
  // This run goes on with the direct connection, chosen under 고급.
  await wizard.getByText("고급: 다른 방식").click();
  await wizard.getByLabel("방식").selectOption({ label: "직접 연결 + 자동 HTTPS" });
  await expect(step("router")).toBeVisible();
  await step("domain").getByLabel("도메인").fill("safety.example.test");
  await step("domain").getByRole("button", { name: "도메인 저장" }).click();
  await expect(step("domain")).toContainText("완료");
  await step("cert-info").getByLabel("인증서 알림 이메일").fill("owner@example.test");
  await step("cert-info").getByLabel(/Let's Encrypt 이용약관/).check();
  await step("cert-info").getByRole("button", { name: "인증서 정보 저장" }).click();
  await expect(step("cert-info")).toContainText("완료");

  await page.getByRole("button", { name: "모두 다시 확인" }).click();
  await expect(step("dns")).toContainText("아직 안 됨");
  await expect(step("dns").getByLabel("값(공인 IP)")).toHaveValue("203.0.113.5"); // nothing to type by hand
  await expect(step("firewall").getByLabel("명령")).toHaveValue(/^New-NetFirewallRule/);
  await expect(step("router")).toContainText("밖에서 80 포트로 접속이 거부됐습니다", { timeout: 10000 });
  await expect(page.getByRole("button", { name: "설정 적용" })).toBeDisabled();

  // The router has no UPnP: the step stays "아직 안 됨" and the manual values stay where they were.
  await step("router").getByRole("button", { name: "공유기에 80·443 열기" }).click();
  await expect(step("router")).toContainText("아래 값으로 공유기에서 직접 설정하세요");
  await expect(step("router").getByLabel("포트")).toHaveValue("80 → 80, 443 → 443 (TCP)");

  // 관리자 권한으로 실행 (US2): the command is on screen first; "no" at the Windows prompt leaves the step as it was.
  await expect(step("firewall").getByRole("button", { name: "관리자 권한으로 실행" })).toBeVisible();
  await expect(step("firewall")).toContainText("Windows 권한 확인 창이 뜨면 ‘예’를 누르세요");
  await step("firewall").getByRole("button", { name: "관리자 권한으로 실행" }).click();
  await expect(step("firewall")).toContainText("실행하지 않았습니다(권한 확인에서 취소).");
  await world({ uac: 0 });
  await step("firewall").getByRole("button", { name: "관리자 권한으로 실행" }).click();
  await expect(step("firewall")).toContainText("Windows 방화벽이 80·443 수신을 허용합니다.");

  // The user fixes DNS and the router by hand.
  await world({ dns: ["203.0.113.5"], reach: true });
  await page.getByRole("button", { name: "모두 다시 확인" }).click();
  await expect(step("router")).toContainText("밖에서 80 포트로 이 PC에 닿습니다", { timeout: 10000 });
  await expect(step("dns")).toContainText("완료");
  await expect(page.getByRole("button", { name: "설정 적용" })).toBeEnabled();
  await page.getByRole("button", { name: "설정 적용" }).click();
  await expect(page.getByText("저장했습니다. 앱을 다시 시작하면 적용됩니다.")).toBeVisible();
  await expect(page.getByText("저장한 설정이 아직 적용되지 않았습니다. 앱을 다시 시작하세요.")).toBeVisible();

  await page.getByRole("button", { name: "오늘", exact: true }).first().click();
  await expect(page.getByText("도메인 연결을 마저 진행하세요.")).toBeVisible();
  await page.getByRole("button", { name: "외부 접속 설정 열기" }).click();

  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "처음부터" }).click();
  await expect(page.getByRole("button", { name: "도메인 연결 시작", exact: true })).toBeVisible();
});
