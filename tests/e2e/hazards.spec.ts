import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
test("report → assignment → assigned staff remediation → manager review → reopen", async ({
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
  const session = await (await page.request.get("/api/session")).json();
  const headers = {
    Origin: "http://127.0.0.1:3107",
    "x-csrf-token": session.csrf,
    "idempotency-key": randomUUID(),
  };
  const site = await (
    await page.request.post("/api/sites", {
      headers,
      data: { name: "신고 합성 현장" },
    })
  ).json();
  await page.request.put(`/api/sites/${site.id}/members`, {
    headers: { ...headers, "idempotency-key": randomUUID() },
    data: { email: "editor@example.test", role: "editor" },
  });
  await page.reload();
  await page.getByLabel("작업 현장").selectOption({ label: "신고 합성 현장" });
  await page
    .getByRole("button", { name: "신고 · 조치", exact: true })
    .click();
  await page.getByRole("button", { name: "+ 신고 초안", exact: true }).click();
  await page.getByLabel("신고 제목 *", { exact: true }).fill("통로 적치 확인");
  await page
    .getByLabel("장소 설명 · 제출 시 필수", { exact: true })
    .fill("A구역 통로");
  await page
    .getByLabel("신고 내용 · 제출 시 필수", { exact: true })
    .fill("자재 정리 필요");
  page.once("dialog", (d) => d.dismiss());
  await page
    .getByRole("button", { name: "신고 목록으로", exact: true })
    .click();
  await expect(page.getByLabel("신고 제목 *", { exact: true })).toHaveValue(
    "통로 적치 확인",
  );
  await page
    .getByRole("button", { name: "신고 초안 저장", exact: true })
    .click();
  await expect(page.getByRole("status")).toHaveText("서버에 저장됨");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "신고 제출", exact: true }).click();
  await expect(page.getByLabel("신고 제목 *", { exact: true })).toBeDisabled();
  await page
    .getByLabel("관리자 처리 사유 *", { exact: true })
    .fill("담당자 지정");
  await page
    .getByRole("combobox", { name: "배정할 현장 계정", exact: true })
    .selectOption("00000000-0000-4000-8000-000000000002");
  await page.getByLabel("조치 기한", { exact: true }).fill("2026-10-29");
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "담당자 배정 / 재배정", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "담당자 배정", exact: true }),
  ).toBeVisible();
  const staff = await browser.newContext({ baseURL: "http://127.0.0.1:3107" });
  const other = await staff.newPage();
  try {
    await other.goto("/");
    await other
      .getByLabel("이메일 또는 아이디", { exact: true })
      .fill("editor@example.test");
    await other
      .getByLabel("비밀번호", { exact: true })
      .fill("synthetic-e2e-password");
    await other.getByRole("button", { name: "로그인", exact: true }).click();
    await other
      .getByLabel("작업 현장")
      .selectOption({ label: "신고 합성 현장" });
    await other
      .getByRole("button", { name: "신고 · 조치", exact: true })
      .click();
    await other.getByRole("button", { name: /통로 적치 확인/ }).click();
    await other
      .getByLabel("조치 내용 *", { exact: true })
      .fill("자재를 이동하고 통로를 정리함");
    other.once("dialog", (d) => d.accept());
    await other
      .getByRole("button", { name: "조치 제출 · 검토 요청", exact: true })
      .click();
    await expect(
      other.getByRole("heading", { name: "검토 요청", exact: true }),
    ).toBeVisible();
  } finally {
    await staff.close();
  }
  await page
    .getByRole("button", { name: "최신 기록 불러오기", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "검토 요청", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "관리자 처리 사유 *", exact: true })
    .fill("조치 기록 독립 검토");
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "관리자 검토 · 기록상 종결", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "기록상 종결", exact: true }),
  ).toBeVisible();
  const printUrl = await page
    .getByRole("link", { name: "신고·이력 인쇄 / PDF", exact: true })
    .getAttribute("href");
  const printed = await page.request.get(printUrl!);
  expect(printed.ok()).toBe(true);
  expect(await printed.text()).toContain(
    "실제 위험 제거·작업 안전을 보증하지 않습니다",
  );
  await page
    .getByRole("textbox", { name: "관리자 처리 사유 *", exact: true })
    .fill("추가 관찰로 재개");
  await page
    .getByRole("combobox", { name: "배정할 현장 계정", exact: true })
    .selectOption("00000000-0000-4000-8000-000000000002");
  await page.getByLabel("조치 기한", { exact: true }).fill("2026-11-02");
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "사유 있는 재개 · 배정", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "담당자 배정", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("신고 변경 이력")).toContainText(
    "추가 관찰로 재개",
  );
  await page.setViewportSize({ width: 320, height: 800 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
