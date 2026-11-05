import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
// P-02: the editor shows the "not engineer-reviewed" warnings and live results; the printed calculation sheet has none of them.
test("work plan 장비 계산: warnings on screen, crawler result, save and print without warnings", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("이메일 또는 아이디", { exact: true }).fill("test@example.test");
  await page.getByLabel("비밀번호", { exact: true }).fill("synthetic-e2e-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page.getByRole("heading", { name: "오늘", exact: true })).toBeVisible();
  const s = await (await page.request.get("/api/session")).json(), headers = () => ({ Origin: "http://127.0.0.1:3107", "x-csrf-token": s.csrf, "idempotency-key": randomUUID() });
  const site = await (await page.request.post("/api/sites", { headers: headers(), data: { name: "계산 합성 " + randomUUID() } })).json();
  const plan = await (await page.request.post(`/api/sites/${site.id}/work-plans`, { headers: headers(), data: { body: {
    title: "장비 계산 계획", date: "2026-10-31", startTime: "09:00", endTime: "10:00", location: "합성", workDescription: "합성", emergencyProcedure: "합성",
    verificationNote: "합성", steps: [{ task: "작업", procedure: "절차", precaution: "주의" }], equipmentIds: [], duties: [],
  } } })).json();
  await page.reload();
  await page.getByLabel("작업 현장").selectOption(site.id);
  await page.getByRole("button", { name: "작업계획", exact: true }).click();
  await page.getByRole("button", { name: "작업계획 열기" }).click();
  await expect(page.getByRole("heading", { name: "장비 계산 (원본 P 계산 양식)" })).toBeVisible();
  await expect(page.getByRole("note")).toContainText("전문가 검토를 받지 않은 계산입니다");
  await page.getByLabel("지내력 계산 장비").selectOption({ label: "크롤러크레인" });
  await page.getByLabel("장비 중량+웨이트(t)").fill("45");
  await page.getByLabel("정격(인양) 하중(t)").fill("4");
  await page.getByLabel("부가 하중(t)").fill("1");
  await page.getByLabel("궤도 폭(m)").fill("0.8");
  await page.getByLabel("축간 거리(m)").fill("4");
  await page.getByLabel("궤도 높이(m)").fill("1");
  await page.getByLabel("허용지내력(kN/㎡)").fill("300");
  await expect(page.getByText("판정: 부적합 (q > 허용지내력)")).toBeVisible();
  await expect(page.getByText(/높이 × 0.35/)).toBeVisible();
  await page.getByRole("button", { name: "줄걸이 추가" }).click();
  await page.getByLabel("파단하중(t, 시험성적서)").fill("16");
  await page.getByLabel("화물 중량(t)").fill("5");
  await expect(page.getByRole("row", { name: /안전하중/ })).toContainText("5.543 t");
  await page.getByRole("button", { name: "장비 계산 저장" }).click();
  await expect(page.getByRole("status").filter({ hasText: "장비 계산을 저장했습니다." })).toBeVisible();
  await page.goto(`/api/sites/${site.id}/work-plans/${plan.id}/calculations/print`);
  await expect(page.getByRole("heading", { name: "장비 계산서" })).toBeVisible();
  await expect(page.getByText("판정: 부적합 (q > 허용지내력)")).toBeVisible();
  const text = await page.locator("body").innerText();
  for (const word of ["전문가 검토", "근거", "⚠", "KOSHA"]) expect(text).not.toContain(word);
});
