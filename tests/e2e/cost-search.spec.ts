import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
// Prepared only. Browser behavior not executed in this environment.
test("manager literal cross-month cost search labels owning month and spend date", async ({
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
  const s = await (await page.request.get("/api/session")).json(),
    headers = () => ({
      Origin: "http://127.0.0.1:3107",
      "x-csrf-token": s.csrf,
      "idempotency-key": randomUUID(),
    });
  const site = await (
    await page.request.post("/api/sites", {
      headers: headers(),
      data: { name: "검색 합성 " + randomUUID() },
    })
  ).json();
  const period = await (
    await page.request.post(`/api/sites/${site.id}/cost-periods`, {
      headers: headers(),
      data: {
        month: "2026-12",
        openingNote: "합성",
        categories: [{ label: "항목", plan: "0", opening: "0" }],
      },
    })
  ).json();
  await page.request.post(
    `/api/sites/${site.id}/cost-periods/${period.id}/expenses`,
    {
      headers: headers(),
      data: {
        version: 1,
        expense: {
          categoryId: period.categories[0].id,
          spendDate: "2026-10-01",
          description: "비율 100%_문자",
          quantity: "0.5",
          unitPriceWon: "1",
        },
      },
    },
  );
  await page.reload();
  await page.getByLabel("작업 현장").selectOption(site.id);
  await page
    .getByRole("button", { name: "산업안전보건관리비", exact: true })
    .click();
  await page
    .getByRole("button", { name: "전체 월 지출 검색", exact: true })
    .click();
  await page.getByLabel("귀속 월 시작", { exact: true }).fill("2026-12");
  await page.getByLabel("지출일 끝", { exact: true }).fill("2026-10-01");
  await page
    .getByLabel("설명에 포함된 문자 (기호도 문자 그대로)", { exact: true })
    .fill("%_");
  await page
    .getByRole("button", { name: "조건으로 지출 검색", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "비율 100%_문자", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/귀속 월 2026-12.*지출일 2026-10-01/),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "이 지출 ID와 귀속 원장 열기", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: /2026-12 산업안전보건관리비/ }),
  ).toBeVisible();
});
