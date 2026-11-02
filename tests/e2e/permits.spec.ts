import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { PERMIT_KINDS } from "../../server/permit-kinds";
// 작업허가서: write, decide every check, request (content then fixed), approval on a one-manager site is recorded as
// self-processed, then the requester closes the work.
test("work permit: checks, request, one-manager approval, close", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("이메일", { exact: true }).fill("test@example.test");
  await page.getByLabel("비밀번호", { exact: true }).fill("synthetic-e2e-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page.getByRole("heading", { name: "오늘", exact: true })).toBeVisible();
  const s = await (await page.request.get("/api/session")).json();
  const site = await (await page.request.post("/api/sites", { headers: { Origin: "http://127.0.0.1:3107", "x-csrf-token": s.csrf, "idempotency-key": randomUUID() }, data: { name: "작업허가 합성 " + randomUUID() } })).json();
  await page.reload();
  await page.getByLabel("작업 현장").selectOption(site.id);

  await page.getByRole("button", { name: "작업허가서", exact: true }).click();
  await expect(page.getByText("아직 작업허가서가 없습니다")).toBeVisible();
  await page.getByRole("button", { name: "+ 작업허가서 작성" }).click();
  await expect(page.getByLabel("작업 종류")).toHaveValue("hot");
  await page.getByLabel("작업 내용 *").fill("배관 용접");
  await page.getByLabel("장소 *").fill("기계실");
  await page.getByRole("button", { name: "초안 저장", exact: true }).click();
  await expect(page.getByText("서버에 저장됨")).toBeVisible();
  await expect(page.getByRole("button", { name: "허가 요청" })).toBeDisabled(); // checks still open

  for (const text of PERMIT_KINDS.hot.checks) await page.getByRole("group", { name: text }).getByRole("button", { name: "확인", exact: true }).click();
  await expect(page.getByRole("heading", { name: "작업 전 확인 · 남은 0개" })).toBeVisible();
  await page.getByRole("button", { name: "초안 저장", exact: true }).click();
  await expect(page.getByText("서버에 저장됨")).toBeVisible();
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "허가 요청" }).click();
  await expect(page.getByText("허가 요청", { exact: true }).first()).toBeVisible();
  await expect(page.getByLabel("작업 내용 *")).toBeDisabled();

  await page.getByRole("button", { name: "허가 기록" }).click();
  await expect(page.getByRole("status").filter({ hasText: "본인 처리 · 관리자 1명 현장" })).toBeVisible();
  await page.getByLabel("종료 메모").fill("잔불 없음");
  await page.getByRole("button", { name: "작업 종료 기록" }).click();
  await expect(page.getByRole("status").filter({ hasText: /작업 종료 · .* · 잔불 없음 · 보존 기한\(안내\)/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "허가서 인쇄 / PDF" })).toBeVisible();
});
