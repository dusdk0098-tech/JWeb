import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { syntheticXlsx } from "../fixtures/synthetic-xlsx";
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
test("cost Excel import fills the TSV from a synthetic workbook and saves through the same review", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("이메일 또는 아이디", { exact: true }).fill("test@example.test");
  await page.getByLabel("비밀번호", { exact: true }).fill("synthetic-e2e-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page.getByRole("heading", { name: "오늘", exact: true })).toBeVisible();
  const session = await (await page.request.get("/api/session")).json();
  const headers = () => ({ Origin: "http://127.0.0.1:3107", "x-csrf-token": session.csrf, "idempotency-key": randomUUID() });
  const site = await (await page.request.post("/api/sites", { headers: headers(), data: { name: "엑셀 합성 " + randomUUID() } })).json();
  await page.request.post(`/api/sites/${site.id}/cost-periods`, {
    headers: headers(),
    data: { month: "2026-10", openingNote: "합성", categories: Array.from({ length: 9 }, (_, i) => ({ label: `${i + 1}. 합성 항목`, plan: "1000000", opening: "0", scCode: i + 1 })) },
  });
  await page.reload();
  await page.getByLabel("작업 현장").selectOption(site.id);
  await page.getByRole("button", { name: "산업안전보건관리비", exact: true }).click();
  await page.getByRole("button", { name: "2026-10 · 작성 중 · v1", exact: true }).click();
  await page.getByText(/^고급 도구/).click();
  await page.getByRole("button", { name: "TSV 지출 일괄 입력", exact: true }).click();
  const sheet = (cells: Record<string, string | number>) => ({ name: "upload.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: syntheticXlsx([{ name: "26년 10월 사용내역", cells: { A1: "26년 10월 사용내역", ...cells } }]) });
  // A row whose 금액 differs from 수량×단가 blocks the whole file.
  await page.getByLabel("가져올 엑셀 파일").setInputFiles(sheet({ A3: "3. 보호구", B3: 46300, C3: "금액 불일치", F3: 2, G3: 1000, H3: 2001 }));
  await expect(page.getByText(/가져올 수 없는 행이 1개 있어 아무것도 채우지 않았습니다/)).toBeVisible();
  await expect(page.getByLabel("붙여넣을 비용 TSV", { exact: true })).toHaveValue("");
  await page.getByLabel("가져올 엑셀 파일").setInputFiles(sheet({
    A3: "1. 안전관리자 인건비", B3: 46300, C3: "10월 급여(합성)", H3: 3500000,
    A4: "3. 보호구", B4: "10월 7일", C4: "안전모(합성)", F4: 12.5, G4: 1999, H4: 24987.5,
    B5: 46303, C5: "안전화(합성)", F5: 2, G5: 30000,
  }));
  await expect(page.getByText(/upload\.xlsx · 시트 26년 10월 사용내역 · 3행/)).toBeVisible();
  await expect(page.getByRole("textbox", { name: "붙여넣을 비용 TSV" })).toHaveValue(/\t2026-10-07\t안전모\(합성\)\t12\.5\t1999/);
  await page.getByRole("button", { name: "저장 없이 TSV 검토", exact: true }).click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "검토한 지출 전체 저장", exact: true }).click();
  await expect(page.getByText("3행 · 추가 금액 3584987.5원 · 결과 원장 v4", { exact: true })).toBeVisible();
  await expect(page.getByLabel("붙여넣을 비용 TSV", { exact: true })).toHaveValue("");
});
