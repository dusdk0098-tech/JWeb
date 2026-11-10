import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
// Prepared acceptance source only; browser execution is not verified in this environment.
test("own template publish, inspection submit and independent return", async ({
  page,
  browser,
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
  const session = await (await page.request.get("/api/session")).json(),
    headers = {
      Origin: "http://127.0.0.1:3107",
      "x-csrf-token": session.csrf,
      "idempotency-key": randomUUID(),
    };
  const site = await (
    await page.request.post("/api/sites", {
      headers,
      data: { name: "점검 합성 현장" },
    })
  ).json();
  await page.request.put(`/api/sites/${site.id}/members`, {
    headers: { ...headers, "idempotency-key": randomUUID() },
    data: { email: "editor@example.test", role: "editor" },
  });
  await page.reload();
  await page.getByLabel("작업 현장").selectOption({ label: "점검 합성 현장" });
  await page
    .getByRole("button", { name: "점검", exact: true })
    .click();
  await page
    .getByRole("button", { name: "양식 / 새 점검", exact: true })
    .click();
  await page.getByRole("button", { name: "새 자체 양식", exact: true }).click();
  await page.getByLabel("양식 제목", { exact: true }).fill("자체 통로 확인");
  await page.getByLabel("항목 1", { exact: true }).fill("통로 정돈 확인");
  page.once("dialog", (d) => d.dismiss());
  await page
    .getByRole("button", { name: "양식 목록으로", exact: true })
    .click();
  await expect(page.getByLabel("양식 제목", { exact: true })).toHaveValue(
    "자체 통로 확인",
  );
  await page
    .getByRole("button", { name: "양식 초안 저장", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "양식 게시", exact: true }),
  ).toBeEnabled();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "양식 게시", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "자체 점검 양식 · 게시됨" }),
  ).toBeVisible();
  const ctx = await browser.newContext({ baseURL: "http://127.0.0.1:3107" });
  try {
    const staff = await ctx.newPage();
    await staff.goto("/");
    await staff
      .getByLabel("이메일 또는 아이디", { exact: true })
      .fill("editor@example.test");
    await staff
      .getByLabel("비밀번호", { exact: true })
      .fill("synthetic-e2e-password");
    await staff.getByRole("button", { name: "로그인", exact: true }).click();
    await staff
      .getByLabel("작업 현장")
      .selectOption({ label: "점검 합성 현장" });
    await staff
      .getByRole("button", { name: "점검", exact: true })
      .click();
    await staff
      .getByRole("button", { name: "양식 / 새 점검", exact: true })
      .click();
    // A new site also carries the default forms, so pick the row of the form this test published.
    await staff
      .locator("article", { hasText: "자체 통로 확인" })
      .getByRole("button", { name: "이 버전으로 직접 새 점검", exact: true })
      .click();
    await staff.getByLabel("장소", { exact: true }).fill("작업구역");
    await staff
      .getByLabel("점검자 표시 (직접 입력 · 신원 검증 아님)", { exact: true })
      .fill("수기 표시");
    await staff.getByRole("combobox", { name: "결과", exact: true }).selectOption("fail");
    await staff
      .getByLabel("설명 (부적합/해당 없음은 필수)", { exact: true })
      .fill("정리 필요");
    await staff
      .getByRole("button", { name: "점검 초안 저장", exact: true })
      .click();
    await expect(
      staff.getByRole("button", { name: "점검 제출", exact: true }),
    ).toBeEnabled();
    staff.once("dialog", (d) => d.accept());
    await staff.getByRole("button", { name: "점검 제출", exact: true }).click();
    await expect(staff.getByLabel("장소", { exact: true })).toBeDisabled();
    await page
      .getByRole("button", { name: "양식 목록으로", exact: true })
      .click();
    await page.getByRole("button", { name: "점검 기록", exact: true }).click();
    // 일괄 출력: the submitted record opens in a new tab as one page of the batch document.
    const [batch] = await Promise.all([
      page.waitForEvent("popup"),
      page.getByRole("link", { name: "현재 조건 일괄 인쇄", exact: true }).click(),
    ]);
    await expect(batch.getByText(/점검 기록 1건 · 조건:/)).toBeVisible();
    await expect(batch.locator("section.form-page")).toHaveCount(1);
    await expect(batch.getByText(/작업구역/)).toBeVisible();
    await batch.close();
    await page.getByRole("button", { name: "점검 열기", exact: true }).click();
    await page.getByLabel("검토 사유", { exact: true }).fill("다시 확인");
    page.once("dialog", (d) => d.accept());
    await page
      .getByRole("button", { name: "반려 + 후속 초안 생성", exact: true })
      .click();
    await expect(page.getByRole("combobox", { name: "결과", exact: true })).toHaveValue(
      "pending",
    );
    await expect(
      page.getByLabel("설명 (부적합/해당 없음은 필수)", { exact: true }),
    ).toHaveValue("");
  } finally {
    await ctx.close();
  }
});
