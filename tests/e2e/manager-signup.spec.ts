import { test, expect } from "@playwright/test";
// 현장 관리자 가입 신청: apply on the login screen, the operator approves it from the home shortcut onto a new site,
// then the new manager signs in with the login ID.
test("manager applies, operator approves onto a new site, manager signs in with the ID", async ({ page }) => {
  await page.goto("/");
  await page.getByText("현장 관리자 가입 신청").click();
  const form = page.getByRole("form", { name: "현장 관리자 가입 신청" });
  await form.getByLabel("이름", { exact: true }).fill("합성 김관리");
  await form.getByLabel("아이디 (영문 소문자·숫자 4~30자)").fill("site.kim");
  await form.getByLabel("비밀번호 (12자 이상)").fill("synthetic-new-manager");
  await form.getByLabel("소속(회사명)").fill("합성건설");
  await form.getByLabel("맡을 현장 이름").fill("합성 신규 현장");
  await expect(form.getByRole("button", { name: "가입 신청" })).toBeDisabled();
  await form.getByLabel("모두 동의합니다").check();
  await form.getByRole("button", { name: "가입 신청" }).click();
  await expect(page.getByText("site.kim 아이디로 가입을 신청했습니다")).toBeVisible();

  await page.getByLabel("운영자 이름").fill("합성 운영자");
  await page.getByLabel("운영자 이메일").fill("operator@example.test");
  await page.getByLabel("운영자 비밀번호 (12자 이상)").fill("synthetic-operator-pw");
  await page.getByRole("button", { name: "운영자 계정 만들기" }).click();
  await page.getByLabel("이메일 또는 아이디", { exact: true }).fill("operator@example.test");
  await page.getByLabel("비밀번호", { exact: true }).fill("synthetic-operator-pw");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page.getByText("관리자 가입 신청 1건")).toBeVisible();
  await page.getByRole("button", { name: "승인하러 가기" }).click();
  await expect(page.getByText("아이디 site.kim · 맡을 현장 합성 신규 현장")).toBeVisible();
  await page.getByRole("button", { name: "승인", exact: true }).click();
  await expect(page.getByText("합성 김관리님을 현장 관리자로 승인했습니다.")).toBeVisible();
  await expect(page.getByText("기다리는 신청이 없습니다.")).toBeVisible();

  await page.getByRole("button", { name: "로그아웃" }).first().click();
  await page.getByLabel("이메일 또는 아이디", { exact: true }).fill("site.kim");
  await page.getByLabel("비밀번호", { exact: true }).fill("synthetic-new-manager");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page.getByLabel("작업 현장").locator("option", { hasText: "합성 신규 현장" })).toHaveCount(1);
});
