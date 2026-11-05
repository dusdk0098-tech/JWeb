import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
// 로그인 만료: a request that meets a dead session sends the app back to the login screen with a notice, a wrong
// password there is still an ordinary error, and the same account's device drafts survive the new login.
test("an expired session returns to login with a notice and keeps this account's device drafts", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("이메일 또는 아이디", { exact: true }).fill("test@example.test");
  await page.getByLabel("비밀번호", { exact: true }).fill("synthetic-e2e-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page.getByRole("heading", { name: "오늘", exact: true })).toBeVisible();
  const s = await (await page.request.get("/api/session")).json();
  const site = await (await page.request.post("/api/sites", {
    headers: { Origin: "http://127.0.0.1:3107", "x-csrf-token": s.csrf, "idempotency-key": randomUUID() },
    data: { name: "만료 합성 " + randomUUID() },
  })).json();
  await page.reload();
  await page.getByLabel("작업 현장").selectOption(site.id);
  await page.getByRole("button", { name: "안전업무일지", exact: true }).click();
  await page.getByRole("button", { name: "새 안전업무일지", exact: true }).click();
  await page.getByLabel("작업 요약 · 보관 시 필수").fill("만료 전에 쓴 합성 요약");
  await page.waitForTimeout(1200); // device-draft autosave debounce

  await page.context().clearCookies(); // the 8-hour session is gone
  await page.getByRole("button", { name: "일지 초안 저장", exact: true }).click();
  await expect(page.getByRole("heading", { name: "로그인", exact: true })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("로그인이 만료되어");

  await page.getByLabel("이메일 또는 아이디", { exact: true }).fill("test@example.test");
  await page.getByLabel("비밀번호", { exact: true }).fill("wrong-synthetic-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("이메일 또는 비밀번호를 확인해 주세요.");
  await expect(page.getByRole("heading", { name: "로그인", exact: true })).toBeVisible(); // no redirect loop

  await page.getByLabel("비밀번호", { exact: true }).fill("synthetic-e2e-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await page.getByRole("button", { name: "안전업무일지", exact: true }).click();
  await page.getByRole("button", { name: "새 안전업무일지", exact: true }).click();
  await expect(page.getByText(/이 기기에 저장 안 된 초안이 있습니다/)).toBeVisible();
  await page.getByRole("button", { name: "기기 초안 복원" }).click();
  await expect(page.getByLabel("작업 요약 · 보관 시 필수")).toHaveValue("만료 전에 쓴 합성 요약");
});
