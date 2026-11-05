import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
// 근로자 QR 가입: the manager makes a join QR; a worker opens it in another browser, signs up with consent, enters the site,
// opens '내 정보' with the birth date, then signs in again with name + birth date.
test("worker joins a site by QR link, edits their info, signs in by name and birth date", async ({ page, browser }) => {
  await page.goto("/");
  await page.getByLabel("이메일 또는 아이디", { exact: true }).fill("test@example.test");
  await page.getByLabel("비밀번호", { exact: true }).fill("synthetic-e2e-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page.getByRole("heading", { name: "오늘", exact: true })).toBeVisible();
  const s = await (await page.request.get("/api/session")).json();
  const siteName = "가입 합성 " + randomUUID().slice(0, 8);
  const site = await (await page.request.post("/api/sites", { headers: { Origin: "http://127.0.0.1:3107", "x-csrf-token": s.csrf, "idempotency-key": randomUUID() }, data: { name: siteName } })).json();
  await page.reload();
  await page.getByLabel("작업 현장").selectOption(site.id);
  await page.getByRole("button", { name: "현장 관리", exact: true }).click();
  await page.getByLabel("유효 기간").selectOption("1");
  await page.getByRole("button", { name: "가입 QR 만들기" }).click();
  await expect(page.getByAltText("근로자 가입 QR 코드")).toBeVisible();
  const url = await page.getByLabel("가입 링크").inputValue();
  expect(url).toMatch(/\/signup#t=[A-Za-z0-9_-]{43}$/);

  const ctx = await browser.newContext(), w = await ctx.newPage();
  await w.goto(url);
  await expect(w.getByRole("heading", { name: siteName })).toBeVisible();
  await w.getByLabel("이름", { exact: true }).fill("합성 근로자");
  await w.getByLabel("생년월일 6자리").fill("850315");
  await w.getByLabel("소속(업체명)").fill("합성건설");
  await expect(w.getByRole("button", { name: "가입하고 입장" })).toBeDisabled();
  await w.getByLabel("모두 동의합니다").check();
  await w.getByRole("button", { name: "가입하고 입장" }).click();
  await expect(w.getByRole("heading", { name: "오늘", exact: true })).toBeVisible();
  await expect(w.getByText("근로자 · 합성건설").first()).toBeVisible();

  await w.getByRole("button", { name: "내 정보", exact: true }).click();
  await w.getByLabel("생년월일 6자리").fill("850315");
  await w.getByRole("button", { name: "확인", exact: true }).click();
  await expect(w.getByText(`${siteName} · 작성자`)).toBeVisible();
  await w.getByLabel("소속(업체명)").fill("합성전기");
  await w.getByRole("button", { name: "저장", exact: true }).click();
  await expect(w.getByText("저장했습니다.")).toBeVisible();

  await w.getByRole("button", { name: "로그아웃" }).first().click();
  await w.getByRole("button", { name: "근로자", exact: true }).click();
  const loginForm = w.getByRole("form", { name: "로그인" });
  await loginForm.getByLabel("이름", { exact: true }).fill("합성 근로자");
  await loginForm.getByLabel("생년월일 6자리").fill("850315");
  await w.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(w.getByRole("button", { name: "로그아웃" }).first()).toBeVisible(); // signed in; the last screen reopens
  await expect(w.getByText("근로자 · 합성전기").first()).toBeVisible();
  await ctx.close();

  await page.reload();
  await page.getByRole("button", { name: "현장 관리", exact: true }).click();
  await expect(page.getByText("합성 근로자 · 근로자 · 합성전기")).toBeVisible();
  await expect(page.getByText(/가입 1명 · 유효/)).toBeVisible();
});
