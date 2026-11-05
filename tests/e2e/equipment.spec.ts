import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
// Prepared source only, no browser execution claimed.
test("equipment code normalization and manual use cancellation", async ({
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
  const session = await (await page.request.get("/api/session")).json(),
    site = await (
      await page.request.post("/api/sites", {
        headers: {
          Origin: "http://127.0.0.1:3107",
          "x-csrf-token": session.csrf,
          "idempotency-key": randomUUID(),
        },
        data: { name: "장비 합성 현장" },
      })
    ).json();
  await page.reload();
  await page.getByLabel("작업 현장").selectOption(site.id);
  await page
    .getByRole("button", { name: "장비", exact: true })
    .click();
  await page.getByRole("button", { name: "새 장비 등록", exact: true }).click();
  await page.getByLabel("장비 이름", { exact: true }).fill("합성 장비");
  await page.getByLabel("장비 종류 표시", { exact: true }).fill("직접 입력");
  await page
    .getByLabel("현장 장비 코드 (선택)", { exact: true })
    .fill(" eq-1 ");
  page.once("dialog", (d) => d.dismiss());
  await page
    .getByRole("button", { name: "장비 목록으로", exact: true })
    .click();
  await expect(page.getByLabel("장비 이름", { exact: true })).toHaveValue(
    "합성 장비",
  );
  await page.getByRole("button", { name: "장비 저장", exact: true }).click();
  await expect(
    page.getByLabel("현장 장비 코드 (선택)", { exact: true }),
  ).toHaveValue("EQ-1");
  await page
    .getByRole("button", { name: "이 장비 수기 사용기록", exact: true })
    .click();
  await page.getByLabel("사용 장소", { exact: true }).fill("합성 구역");
  await page
    .getByLabel("수기 작업내용", { exact: true })
    .fill("수기 기록 테스트, 안전 승인 아님");
  await page
    .getByRole("button", { name: "사용기록 저장", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "기록 상태", exact: true })
    .selectOption("cancelled");
  await page
    .getByLabel("정정/취소/복원 사유", { exact: true })
    .fill("중복 입력 취소");
  await page
    .getByRole("button", { name: "사용기록 정정 저장", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "기록 상태", exact: true }),
  ).toHaveValue("cancelled");
  await expect(page.getByText("중복 입력 취소", { exact: true })).toBeVisible();
});
