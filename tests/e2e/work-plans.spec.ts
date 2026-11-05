import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
// Reproducible scenario source only; actual browser run remains blocked.
test("general work plan requires explicit source capture before manual archive", async ({
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
      data: { name: "계획 합성 현장" },
    })
  ).json();
  await page.reload();
  await page.getByLabel("작업 현장").selectOption(site.id);
  await page
    .getByRole("button", { name: "작업계획", exact: true })
    .click();
  await page.getByRole("button", { name: "일반 작업계획 초안 작성" }).click();
  await page.getByLabel("작업계획 제목").fill("합성 작업계획");
  await page.getByLabel("선택 작업일").fill("2026-10-28");
  await page.getByLabel("작업 위치").fill("합성 장소");
  await page.getByLabel("작업 설명", { exact: true }).fill("직접 설명");
  await page.getByLabel("비상 대응 절차").fill("직접 비상 절차");
  await page.getByRole("button", { name: "단계 추가" }).click();
  await page.getByLabel("1. 단계 작업", { exact: true }).fill("합성 단계");
  await page.getByLabel("1. 작업 절차", { exact: true }).fill("수기 절차");
  await page.getByLabel("1. 주의사항", { exact: true }).fill("수기 주의");
  await page
    .getByRole("button", { name: "초안 저장", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "관리자가 기록 확정" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "선택 참조 최신 정보 취합" }).click();
  await expect(
    page.getByRole("button", { name: "관리자가 기록 확정" }),
  ).toBeEnabled();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "관리자가 기록 확정" }).click();
  await expect(
    page.getByRole("heading", { name: "관리자 확정본 · 문서검토 없음", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/작업허가\/공학 검토\/안전 인증/)).toBeVisible();
});
