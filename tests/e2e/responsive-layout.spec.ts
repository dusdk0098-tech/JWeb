import { test, expect } from "@playwright/test";

test("desktop content starts at the top; the phone uses the bottom tab bar and a menu sheet", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByLabel("이메일 또는 아이디", { exact: true }).fill("test@example.test");
  await page.getByLabel("비밀번호", { exact: true }).fill("synthetic-e2e-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await page.getByRole("button", { name: "현장 관리", exact: true }).click();
  await page.getByLabel("현장 이름", { exact: true }).fill("합성 반응형 검증 현장");
  await page.getByRole("button", { name: "현장 만들기", exact: true }).click();
  await expect(page.getByRole("heading", { name: "합성 반응형 검증 현장", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "회의록", exact: true }).click();
  const heading = page.getByRole("heading", { name: "회의록", exact: true });
  await expect(heading).toBeVisible();
  expect((await page.locator("main.workspace").boundingBox())!.y).toBeLessThan(80);
  expect((await heading.boundingBox())!.y).toBeLessThan(300);
  await expect(page.getByRole("navigation", { name: "하단 메뉴" })).toBeHidden();

  await page.setViewportSize({ width: 320, height: 800 });
  await expect(page.getByRole("navigation", { name: "주 메뉴" })).toBeHidden();
  const tabbar = page.getByRole("navigation", { name: "하단 메뉴" });
  await expect(tabbar).toBeVisible();
  expect((await heading.boundingBox())!.y).toBeLessThan(300); // the task stays near the top: no stacked menu above it
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("mobile-tabbar.png"), fullPage: true });

  const docs = tabbar.getByRole("button", { name: "문서", exact: true });
  await expect(docs).toHaveAttribute("aria-expanded", "false");
  await docs.press("Enter");
  await expect(docs).toHaveAttribute("aria-expanded", "true");
  const sheet = page.getByRole("dialog", { name: "문서 메뉴" });
  await expect(sheet).toBeVisible();
  await sheet.getByRole("button", { name: "작업계획", exact: true }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByRole("heading", { name: /작업계획/ }).first()).toBeVisible();
  await tabbar.getByRole("button", { name: "오늘", exact: true }).click();
  await expect(page.getByRole("heading", { name: "오늘", exact: true })).toBeVisible();

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByRole("navigation", { name: "주 메뉴" })).toBeVisible();
  await expect(tabbar).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath("desktop-content-top.png"), fullPage: true });
});
