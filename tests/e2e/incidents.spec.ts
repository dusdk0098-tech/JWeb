import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
// 사고 · 아차사고 기록: write an accident, see the 산업재해조사표 due date on the home screen, confirm, record the filing.
test("incident record: accident draft, home due-date task, manager confirm and report filing", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("이메일", { exact: true }).fill("test@example.test");
  await page.getByLabel("비밀번호", { exact: true }).fill("synthetic-e2e-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page.getByRole("heading", { name: "오늘", exact: true })).toBeVisible();
  const s = await (await page.request.get("/api/session")).json();
  const site = await (await page.request.post("/api/sites", { headers: { Origin: "http://127.0.0.1:3107", "x-csrf-token": s.csrf, "idempotency-key": randomUUID() }, data: { name: "사고 기록 합성 " + randomUUID() } })).json();
  await page.reload();
  await page.getByLabel("작업 현장").selectOption(site.id);

  await page.getByRole("button", { name: "사고 · 아차사고", exact: true }).click();
  await expect(page.getByText("아직 기록이 없습니다")).toBeVisible();
  await page.getByRole("button", { name: "+ 사고 · 아차사고 기록" }).click();
  await page.getByLabel("종류", { exact: true }).selectOption("accident");
  await page.getByLabel("발생 일시 *").fill("2026-10-20T10:30");
  await page.getByLabel("장소 *").fill("B동 2층");
  await page.getByLabel("재해자 (이름 · 소속 · 직종)").fill("합성 근로자 · 합성 소속 · 형틀공");
  await page.getByLabel(/휴업 3일 이상/).check();
  await page.getByLabel("발생 경위 *").fill("거푸집 해체 중 손 부딪힘");
  await page.getByRole("button", { name: "초안 저장", exact: true }).click();
  await expect(page.getByText("서버에 저장됨")).toBeVisible();
  await expect(page.getByText("제출 기한(안내):")).toContainText("2026-11-20");

  // confirming needs the cause and the prevention plan
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "관리자가 기록 확정" }).click();
  await expect(page.getByRole("alert")).toContainText("원인과 재발 방지 계획");
  await page.getByLabel("원인 · 확정 시 필수").fill("해체 순서 미준수");
  await page.getByLabel("재발 방지 계획 · 확정 시 필수").fill("해체 순서 TBM 전달, 장갑 착용 점검");
  await page.getByRole("button", { name: "초안 저장", exact: true }).click();
  await expect(page.getByText("서버에 저장됨")).toBeVisible();

  // the home screen shows the report due date and opens the record
  await page.getByRole("button", { name: "오늘", exact: true }).first().click();
  await page.getByRole("button", { name: /산업재해조사표 · B동 2층/ }).click();
  await expect(page.getByRole("heading", { name: "사고 기록" })).toBeVisible();

  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "관리자가 기록 확정" }).click();
  await expect(page.getByText(/보존 기한\(안내\) 2029-10-20/)).toBeVisible();
  await expect(page.getByLabel("장소 *")).toBeDisabled();
  await page.getByLabel("메모").fill("전자 신고");
  await page.getByRole("button", { name: "제출일 기록" }).click();
  await expect(page.getByText(/제출일 \d{4}-\d{2}-\d{2} · 전자 신고/)).toBeVisible();
});
