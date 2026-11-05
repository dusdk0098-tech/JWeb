import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
// Source only; browser execution remains unverified.
test("manual due metadata uses explicit date and does not claim certification", async ({
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
  const post = async (path: string, data: object) =>
    (
      await page.request.post(path, {
        headers: {
          Origin: "http://127.0.0.1:3107",
          "x-csrf-token": session.csrf,
          "idempotency-key": randomUUID(),
        },
        data,
      })
    ).json();
  const site = await post("/api/sites", { name: "기한 합성 현장" });
  await post(`/api/sites/${site.id}/equipment`, {
    assetCode: "",
    name: "합성 장비",
    typeLabel: "수기",
    model: "",
    serial: "",
    ownerCompany: "",
    notes: "",
  });
  await page.reload();
  await page.getByLabel("작업 현장").selectOption(site.id);
  await page
    .getByRole("button", { name: "장비", exact: true })
    .click();
  await page.getByRole("button", { name: "수기 검사·보험 기한 메모" }).click();
  await page.getByLabel("비교 기준일").fill("2026-10-28");
  await page.getByRole("button", { name: "이 장비 기한 정정" }).click();
  await page
    .getByLabel("입력한 검사 예정일", { exact: true })
    .fill("2026-10-28");
  await page
    .getByLabel("보험 기록상 종료일", { exact: true })
    .fill("2026-10-27");
  await page.getByLabel("수기 출처 메모", { exact: true }).fill("확인 전 수기");
  await page.getByLabel("기한 메모 변경 사유").fill("최초 메모");
  await page.getByRole("button", { name: "기한 메모 저장" }).click();
  await expect(
    page.getByText(/입력한 검사 예정일: 2026-10-28 · 기준일과 같은 날짜/),
  ).toBeVisible();
  await expect(
    page.getByText(/보험 기록상 종료일: 2026-10-27 · 입력된 기한 경과/),
  ).toBeVisible();
  await page.getByLabel("비교 기준일").fill("");
  await expect(page.getByText("비교할 날짜를 선택하세요.")).toBeVisible();
  await expect(page.getByText("기한 메모 조회 중")).toHaveCount(0);
});
