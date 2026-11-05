import { test, expect } from "@playwright/test";
// Synthetic isolated account, source only; browser test has not been executed.
test("self password change clears fields and all sessions before new login", async ({
  page,
}) => {
  const email = "password-change@example.test",
    old = "synthetic-e2e-password",
    next = "synthetic-e2e-password-changed";
  await page.goto("/");
  await page.getByLabel("이메일 또는 아이디", { exact: true }).fill(email);
  await page.getByLabel("비밀번호", { exact: true }).fill(old);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "오늘", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "내 비밀번호", exact: true })
    .click();
  await page.getByLabel("현재 비밀번호", { exact: true }).fill(old);
  await page.getByLabel("새 비밀번호", { exact: true }).fill(next);
  await page.getByLabel("새 비밀번호 확인", { exact: true }).fill(next);
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", {
      name: "비밀번호 변경 · 모든 세션 종료",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", { name: "로그인", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("비밀번호를 변경했습니다. 새 비밀번호로 다시 로그인하세요."),
  ).toBeVisible();
  await page.getByLabel("이메일 또는 아이디", { exact: true }).fill(email);
  await page.getByLabel("비밀번호", { exact: true }).fill(next);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "오늘", exact: true }),
  ).toBeVisible();
  // Restore only this known synthetic fixture; no production account is touched.
  const session = await (await page.request.get("/api/session")).json();
  expect(
    (
      await page.request.post("/api/account/password", {
        headers: {
          Origin: "http://127.0.0.1:3107",
          "x-csrf-token": session.csrf,
        },
        data: { currentPassword: next, newPassword: old, confirmPassword: old },
      })
    ).status(),
  ).toBe(204);
});
