import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
// Source only; no browser run in the restricted environment.
test("manual daily journal explicit capture, archive, preserved prior and fresh correction", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("이메일", { exact: true }).fill("test@example.test");
  await page
    .getByLabel("비밀번호", { exact: true })
    .fill("synthetic-e2e-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "오늘", exact: true }),
  ).toBeVisible();
  const session = await (await page.request.get("/api/session")).json();
  await page.request.post("/api/sites", {
    headers: {
      Origin: "http://127.0.0.1:3107",
      "x-csrf-token": session.csrf,
      "idempotency-key": randomUUID(),
    },
    data: { name: "일지 합성 현장" },
  });
  await page.reload();
  await page.getByLabel("작업 현장").selectOption({ label: "일지 합성 현장" });
  await page
    .getByRole("button", { name: "안전업무일지", exact: true })
    .click();
  await page
    .getByRole("button", { name: "새 안전업무일지", exact: true })
    .click();
  await page.getByLabel("일지 날짜 (저장 후 고정)").fill("2026-10-28");
  // 재설계 A안: read-only 1·2단계 summary for the chosen date.
  await expect(page.getByRole("heading", { name: "오늘 현장 요약 (2026-10-28)" })).toBeVisible();
  await expect(page.getByText("이 날짜 기록일 점검 0건")).toBeVisible();
  await expect(page.getByText(/예정일이 지났는데 수락되지 않은 점검 일정 0건/)).toBeVisible();
  await page.getByLabel("작업 요약 · 보관 시 필수").fill("합성 작업");
  await page.getByLabel("안전 안내 기록 · 보관 시 필수").fill("합성 안내");
  page.once("dialog", (d) => d.dismiss());
  await page
    .getByRole("button", { name: "일지 목록으로", exact: true })
    .click();
  await expect(page.getByLabel("작업 요약 · 보관 시 필수")).toHaveValue(
    "합성 작업",
  );
  await page
    .getByRole("button", { name: "일지 초안 저장", exact: true })
    .click();
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "해당일 자료 참조 갱신", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "가져온 해당일 자료 참조 (자동 갱신 아님)",
      exact: true,
    }),
  ).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "관리자가 기록 확정", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "관리자가 보관한 안전업무일지",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByLabel("일지 정정 사유").fill("새 기록으로 정정");
  await page.getByLabel("정정 초안 작성 계정").selectOption(session.user.id);
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "사유 있는 새 정정 초안", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "안전업무일지 초안", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/해당일 자료 참조를 아직 가져오지 않았습니다/),
  ).toBeVisible();
  await expect(page.getByLabel("일지 날짜 (저장 후 고정)")).toHaveValue(
    "2026-10-28",
  );
});
