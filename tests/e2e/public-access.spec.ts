import { test, expect } from "@playwright/test";
// Self-hosting settings: editable on this PC (loopback), saved for the next start, the tunnel token is never shown back.
test("외부 접속 설정: save tunnel settings on this PC, applied at next start", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("이메일 또는 아이디", { exact: true }).fill("test@example.test");
  await page.getByLabel("비밀번호", { exact: true }).fill("synthetic-e2e-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page.getByRole("heading", { name: "오늘", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "외부 접속 설정", exact: true }).click();
  await expect(page.getByRole("status").first()).toContainText("꺼짐 (이 PC에서만 접속)");
  await page.getByText("고급: 직접 입력").click(); // the manual form sits under the wizard
  await page.getByLabel("방식").selectOption({ label: "Cloudflare Tunnel" });
  await page.getByLabel("도메인").fill("safety.example.test");
  const token = "eyJ-synthetic-e2e-tunnel-" + "x".repeat(30) + "QRST";
  await page.getByLabel("터널 토큰").fill(token);
  await page.getByRole("button", { name: "저장" }).click();
  await expect(page.getByText("저장했습니다. 앱을 다시 시작하면 적용됩니다.")).toBeVisible();
  await expect(page.getByText("저장한 설정이 아직 적용되지 않았습니다. 앱을 다시 시작하세요.")).toBeVisible();
  await expect(page.getByLabel("터널 토큰")).toHaveAttribute("placeholder", /저장됨 \(…QRST\)/);
  expect(await page.content()).not.toContain(token);
  // Turn it back off so other specs on this server are unaffected.
  await page.getByLabel("방식").selectOption({ label: "끄기 (이 PC에서만 사용)" });
  await page.getByRole("button", { name: "저장" }).click();
  await expect(page.getByText("저장했습니다. 앱을 다시 시작하면 적용됩니다.")).toBeVisible();
});
