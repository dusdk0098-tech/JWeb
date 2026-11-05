import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
test("TBM manual participation, manager record finalization and linked pending revision", async ({
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
  const headers = {
    Origin: "http://127.0.0.1:3107",
    "x-csrf-token": session.csrf,
    "idempotency-key": randomUUID(),
  };
  const site = await (
    await page.request.post("/api/sites", {
      headers,
      data: { name: "TBM 합성 현장" },
    })
  ).json();
  await page.request.post(`/api/sites/${site.id}/workers`, {
    headers: { ...headers, "idempotency-key": randomUUID() },
    data: { name: "TBM 합성 참가자", affiliation: "합성 소속", kind: "worker" },
  });
  await page.reload();
  await page.getByLabel("작업 현장").selectOption({ label: "TBM 합성 현장" });
  await page.getByRole("button", { name: "TBM", exact: true }).click();
  await page.getByRole("button", { name: "+ TBM 초안", exact: true }).click();
  await page.getByLabel("TBM 제목 *", { exact: true }).fill("작업 전 TBM");
  page.once("dialog", (d) => d.dismiss());
  await page.getByRole("button", { name: "오늘", exact: true }).click();
  await expect(page.getByLabel("TBM 제목 *", { exact: true })).toHaveValue(
    "작업 전 TBM",
  );
  await page.getByLabel("장소 · 확정 시 필수", { exact: true }).fill("현장 앞");
  await page
    .getByLabel("진행자 입력 · 확정 시 필수", { exact: true })
    .fill("담당자");
  await page
    .getByLabel("당일 작업 · 확정 시 필수", { exact: true })
    .fill("자재 이동");
  await page
    .getByLabel("안전 전달사항 · 확정 시 필수", { exact: true })
    .fill("통로 분리");
  await page
    .getByRole("button", { name: "TBM 초안 저장", exact: true })
    .click();
  await expect(page.getByRole("status")).toHaveText("서버에 저장됨");
  await page
    .getByRole("button", { name: /TBM 합성 참가자 · 합성 소속/ })
    .click();
  await expect(
    page.getByRole("button", { name: "참여 기록", exact: true }),
  ).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "관리자가 기록 확정", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("미확인");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "참여 기록", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "참여 기록", exact: true }),
  ).toBeDisabled();
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "관리자가 기록 확정", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "관리자가 확정한 TBM 기록",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByLabel("TBM 제목 *", { exact: true })).toBeDisabled();
  const printUrl = await page
    .getByRole("link", { name: "확정 기록 인쇄 / PDF", exact: true })
    .getAttribute("href");
  const before = await (await page.request.get(printUrl!)).text();
  await page
    .getByLabel("정정 초안 생성 사유 *", { exact: true })
    .fill("작업 설명 보완");
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "정정 초안 만들기", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "TBM 초안", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("미확인", { exact: true })).toBeVisible();
  await expect(page.getByLabel("TBM 제목 *", { exact: true })).toBeEnabled();
  expect(await (await page.request.get(printUrl!)).text()).toBe(before);
  await page.setViewportSize({ width: 320, height: 800 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "TBM 목록으로", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "TBM 기록", exact: true }),
  ).toBeVisible();
});
