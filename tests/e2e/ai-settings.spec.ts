import { test, expect } from "@playwright/test";
// SC-04: the install-wide AI settings appear on this PC (loopback), a per-account key is registered and never shown back.
test("AI settings: choose per-account keys and register one without showing it again", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("이메일 또는 아이디", { exact: true }).fill("test@example.test");
  await page.getByLabel("비밀번호", { exact: true }).fill("synthetic-e2e-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page.getByRole("heading", { name: "오늘", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "AI 문구 설정", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("꺼짐");
  await expect(page.getByText("이 PC 공용 설정 (이 PC에서 접속했을 때만 보입니다)")).toBeVisible();
  await page.getByLabel("사용 방식").selectOption({ label: "계정마다 본인 키" });
  await page.getByRole("button", { name: "방식 저장" }).click();
  await expect(page.getByRole("status")).toContainText("방식: 계정마다 본인 키");
  const key = "sk-ant-synthetic-e2e-" + "k".repeat(24) + "WXYZ";
  await page.getByLabel("내 API 키", { exact: true }).fill(key);
  await page.getByLabel("월 요청 상한(회)").fill("7");
  await page.getByRole("button", { name: "키 등록" }).click();
  await expect(page.getByText("내 API 키 등록됨 (…WXYZ) · 월 상한 7회 · 이번 달 0회 사용")).toBeVisible();
  await expect(page.getByRole("status")).toContainText("켜짐");
  await expect(page.getByLabel("내 API 키", { exact: true })).toHaveValue("");
  expect(await page.content()).not.toContain(key);
});
