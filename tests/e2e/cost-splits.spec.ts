import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
// Prepared source only; browser verification not executed.
test("exact quantity and amount split can be explicitly undone", async ({
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
      data: { name: "분할 합성 " + randomUUID() },
    })
  ).json();
  const period = await (
    await page.request.post(`/api/sites/${site.id}/cost-periods`, {
      headers: headers(),
      data: {
        month: "2026-10",
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
          description: "분할 원행",
          quantity: "1",
          unitPriceWon: "2",
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
    .getByRole("button", { name: "2026-10 · 작성 중 · v2", exact: true })
    .click();
  await page
    .getByRole("button", { name: "이 지출 분할 검토 / 출처", exact: true })
    .click();
  await page.getByLabel("자식 1 설명", { exact: true }).fill("첫 자식");
  await page.getByLabel("자식 2 설명", { exact: true }).fill("둘째 자식");
  await page.getByLabel("자식 1 수량", { exact: true }).fill("0.5");
  await page.getByLabel("자식 2 수량", { exact: true }).fill("0.5");
  await page.getByLabel("자식 1 양수 정수 단가", { exact: true }).fill("1");
  await page.getByLabel("자식 2 양수 정수 단가", { exact: true }).fill("3");
  await page.getByLabel("분할 사유", { exact: true }).fill("합성 분할");
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "수량·금액 검증 후 분할 저장", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: /고정 분할 기록/ }),
  ).toBeVisible();
  await page
    .getByLabel("분할 되돌리기 사유", { exact: true })
    .fill("합성 되돌리기");
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", {
      name: "자식 취소·원행 복원 (새 행 없음)",
      exact: true,
    })
    .click();
  await expect(page.getByText(/상태: 되돌림 기록 있음/)).toBeVisible();
});
