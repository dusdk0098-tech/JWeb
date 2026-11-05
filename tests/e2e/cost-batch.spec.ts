import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
// Prepared only: no browser execution in this environment.
test("cost TSV preview requires duplicate acknowledgement and returns exact receipt", async ({
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
  const headers = () => ({
    Origin: "http://127.0.0.1:3107",
    "x-csrf-token": session.csrf,
    "idempotency-key": randomUUID(),
  });
  const site = await (
    await page.request.post("/api/sites", {
      headers: headers(),
      data: { name: "일괄 합성 " + randomUUID() },
    })
  ).json();
  const period = await (
    await page.request.post(`/api/sites/${site.id}/cost-periods`, {
      headers: headers(),
      data: {
        month: "2026-10",
        openingNote: "합성",
        categories: [{ label: "합성 항목", plan: "10", opening: "0" }],
      },
    })
  ).json();
  await page.reload();
  await page.getByLabel("작업 현장").selectOption(site.id);
  await page
    .getByRole("button", { name: "산업안전보건관리비", exact: true })
    .click();
  await page
    .getByRole("button", { name: "2026-10 · 작성 중 · v1", exact: true })
    .click();
  await page.getByText(/^고급 도구/).click(); // the batch tool is folded
  await page
    .getByRole("button", { name: "TSV 지출 일괄 입력", exact: true })
    .click();
  const row = [
    period.categories[0].id,
    "2026-10-01",
    "=literal",
    "0.5",
    "1",
  ].join("\t");
  const tsv =
    "categoryId\tspendDate\tdescription\tquantity\tunitPriceWon\n" +
    row +
    "\n" +
    row;
  await page.getByLabel("붙여넣을 비용 TSV", { exact: true }).fill(tsv);
  await page
    .getByRole("button", { name: "저장 없이 TSV 검토", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "검토한 지출 전체 저장", exact: true }),
  ).toBeDisabled();
  await page.getByRole("checkbox", { name: /중복 경고를 확인/ }).check();
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "검토한 지출 전체 저장", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "일괄 저장 영수증", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("2행 · 추가 금액 1원 · 결과 원장 v3", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("붙여넣을 비용 TSV", { exact: true }),
  ).toHaveValue("");
});
