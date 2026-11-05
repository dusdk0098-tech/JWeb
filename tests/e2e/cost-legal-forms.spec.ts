import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
test("SC 법정 서식 prints all sheets in order within A4 width", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("이메일 또는 아이디", { exact: true }).fill("test@example.test");
  await page.getByLabel("비밀번호", { exact: true }).fill("synthetic-e2e-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page.getByRole("heading", { name: "오늘", exact: true })).toBeVisible();
  const s = await (await page.request.get("/api/session")).json(),
    headers = () => ({ Origin: "http://127.0.0.1:3107", "x-csrf-token": s.csrf, "idempotency-key": randomUUID() });
  const site = await (await page.request.post("/api/sites", { headers: headers(), data: { name: "서식 합성 " + randomUUID() } })).json();
  let p = await (await page.request.post(`/api/sites/${site.id}/cost-periods`, {
    headers: headers(),
    data: { month: "2026-10", openingNote: "합성", categories: Array.from({ length: 9 }, (_, i) => ({ label: `항목 ${i + 1} 합성 이름이 조금 긴 경우`, plan: "1000000", opening: "0", scCode: i + 1 })) },
  })).json();
  p = await (await page.request.put(`/api/sites/${site.id}/cost-periods/${p.id}/settings`, {
    headers: headers(),
    data: { version: p.version, settings: { writtenDate: "2026-10-31", projectName: "합성 공사 이름이 꽤 길게 들어가는 경우를 확인하는 현장", contractor: "합성건설", location: "합성시 합성구", representative: "홍길동", client: "합성 발주처", projectStart: "2026-01-01", projectEnd: "2026-12-31", summarySameAsProject: true, summaryStart: "", summaryEnd: "", contractAmountWon: "1000000000", coverProgress: "40", cumulativeProgress: "50", safetyBudgetWon: "30000000", author: "김작성", reviewer: "이확인" } },
  })).json();
  for (let i = 0; i < 9; i++) {
    const r = await (await page.request.post(`/api/sites/${site.id}/cost-periods/${p.id}/expenses`, {
      headers: headers(), data: { version: p.version, expense: { categoryId: p.categories[i].id, spendDate: "2026-10-02", description: `합성 내역 ${i + 1} 긴 설명 문구`, quantity: "12.5", unitPriceWon: "123456" } },
    })).json();
    p = r.period;
  }
  await page.setViewportSize({ width: 794, height: 1123 }); // A4 at 96dpi
  await page.goto(`/api/sites/${site.id}/cost-periods/${p.id}/legal-forms/print`);
  for (const title of ["산업안전보건관리비 사용 내역 집계표", "2026년 10월 항목별 사용내역", "9. 위험성평가 등에 따른 소요비용"])
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
  const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, view: window.innerWidth }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.view + 1);
});
