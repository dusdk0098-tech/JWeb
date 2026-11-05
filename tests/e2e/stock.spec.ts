import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
// Reproducible browser source only, not executed in this environment.
test("manual stock exact quantity and selected full reversal preserve original", async ({
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
      data: { name: "수불 합성 현장" },
    })
  ).json();
  await page.reload();
  await page.getByLabel("작업 현장").selectOption(site.id);
  await page
    .getByRole("button", { name: "재고 · 보호구", exact: true })
    .click();
  await page.getByRole("button", { name: "품목 등록", exact: true }).click();
  await page.getByLabel("품목명", { exact: true }).fill("합성 품목");
  await page.getByLabel("수량 단위").fill("개");
  await page.getByRole("button", { name: "등록", exact: true }).click();
  await page.getByRole("button", { name: "실제 이동·조정 기록" }).click();
  await page.getByLabel("양수 수량").fill("0.3");
  await page.getByLabel("효력일").fill("2026-10-28");
  await page.getByLabel("이동 사실·사유").fill("합성 초기");
  await page.getByRole("button", { name: "이동 저장" }).click();
  await expect(
    page.getByRole("heading", { name: "합성 품목 · 잔량 0.3 개" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "이 원본 전체 역분개" }).click();
  await page.getByLabel("이동 사실·사유").fill("초기 기록 오류");
  await page.getByRole("button", { name: "전량 역분개 기록" }).click();
  await expect(
    page.getByRole("heading", { name: "합성 품목 · 잔량 0 개" }),
  ).toBeVisible();
  await expect(page.getByText(/전체 역분개 기록 .* 존재/)).toBeVisible();
});
