import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
// Prepared source only; browser execution remains blocked/not verified.
test("manager overview uses explicit date and selected current manager site", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("이메일 또는 아이디", { exact: true }).fill("test@example.test");
  await page
    .getByLabel("비밀번호", { exact: true })
    .fill("synthetic-e2e-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "오늘", exact: true }),
  ).toBeVisible();
  const session = await (await page.request.get("/api/session")).json();
  const site = await (
    await page.request.post("/api/sites", {
      headers: {
        Origin: "http://127.0.0.1:3107",
        "x-csrf-token": session.csrf,
        "idempotency-key": randomUUID(),
      },
      data: { name: "현황 합성 " + randomUUID() },
    })
  ).json();
  await page.reload();
  await page
    .getByRole("button", { name: "관리 현장 현황", exact: true })
    .click();
  await page
    .getByLabel("현황 비교 및 일지 기준일", { exact: true })
    .fill("2026-10-28");
  await page
    .getByRole("combobox", { name: "관리 현장 조회 범위", exact: true })
    .selectOption(site.id);
  await expect(
    page.getByRole("heading", { name: site.name, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("기준일 일지 기록 없음 — 실제 작업 여부 불명", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "현재 페이지 현황 인쇄", exact: true }),
  ).toHaveAttribute("href", /expectedFingerprint=[a-f0-9]{64}/);
  await page.getByLabel("현황 비교 및 일지 기준일", { exact: true }).fill("");
  await expect(page.getByText("현황 조회 중…", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "현재 페이지 현황 인쇄", exact: true }),
  ).toHaveCount(0);
});
