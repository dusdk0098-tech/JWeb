import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
test("work plan 양식사용 체크리스트: 17 forms, required locked, save and print", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("이메일 또는 아이디", { exact: true }).fill("test@example.test");
  await page.getByLabel("비밀번호", { exact: true }).fill("synthetic-e2e-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page.getByRole("heading", { name: "오늘", exact: true })).toBeVisible();
  const s = await (await page.request.get("/api/session")).json(), headers = () => ({ Origin: "http://127.0.0.1:3107", "x-csrf-token": s.csrf, "idempotency-key": randomUUID() });
  const site = await (await page.request.post("/api/sites", { headers: headers(), data: { name: "양식 합성 " + randomUUID() } })).json();
  const plan = await (await page.request.post(`/api/sites/${site.id}/work-plans`, { headers: headers(), data: { body: {
    title: "양식 체크 계획", date: "2026-10-31", startTime: "09:00", endTime: "10:00", location: "합성", workDescription: "합성", emergencyProcedure: "합성",
    verificationNote: "공학 판정 없음", steps: [{ task: "작업", procedure: "절차", precaution: "주의" }], equipmentIds: [], duties: [],
  } } })).json();
  await page.reload();
  await page.getByLabel("작업 현장").selectOption(site.id);
  await page.getByRole("button", { name: "작업계획", exact: true }).click();
  await page.getByRole("button", { name: "작업계획 열기" }).click();
  await expect(page.getByRole("heading", { name: "양식사용 체크리스트 (원본 P 시트 1)" })).toBeVisible();
  await expect(page.getByLabel(/ 포함$/)).toHaveCount(17);
  await expect(page.getByLabel("일반 작업계획 포함")).toBeDisabled();
  await expect(page.getByLabel("일반 작업계획 포함")).toBeChecked();
  await page.getByLabel("신호수 지정서 포함").check();
  await page.getByLabel("신호수 지정서 메모").fill("야간 양중 시");
  await page.getByRole("button", { name: "양식 체크리스트 저장" }).click();
  await expect(page.getByRole("status").filter({ hasText: "양식 체크리스트를 저장했습니다." })).toBeVisible();
  await page.goto(`/api/sites/${site.id}/work-plans/${plan.id}/form-checklist/print`);
  await expect(page.getByRole("row", { name: /신호수 지정서 선택 포함 야간 양중 시/ })).toBeVisible();
});
