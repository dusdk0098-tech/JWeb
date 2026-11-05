import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
// Source only: not executed in this environment. No real workplace actions.
test("manual stop request preserves dirty input and terminal correction notes", async ({
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
  await page.request.post("/api/sites", {
    headers: {
      Origin: "http://127.0.0.1:3107",
      "x-csrf-token": session.csrf,
      "idempotency-key": randomUUID(),
    },
    data: { name: "중지 기록 합성 현장" },
  });
  await page.reload();
  await page
    .getByLabel("작업 현장")
    .selectOption({ label: "중지 기록 합성 현장" });
  await page
    .getByRole("button", { name: "작업 중지 요청", exact: true })
    .click();
  await page
    .getByRole("button", { name: "+ 요청 접수 기록", exact: true })
    .click();
  await page.getByLabel("대상 작업", { exact: true }).fill("합성 작업");
  await page.getByLabel("장소", { exact: true }).fill("합성 장소");
  await page
    .getByLabel("요청 사유", { exact: true })
    .fill("실제 현장 행위 없는 시험");
  await page
    .getByLabel("관찰 현장 입력 시각", { exact: true })
    .fill("2026-10-28T23:50");
  page.once("dialog", (d) => d.dismiss());
  await page.getByRole("button", { name: "목록으로", exact: true }).click();
  await expect(page.getByLabel("대상 작업", { exact: true })).toHaveValue(
    "합성 작업",
  );
  await page
    .getByRole("button", {
      name: "요청 접수 기록 저장",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("heading", { name: /요청 접수 기록 · v1/ }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "기록 동작", exact: true })
    .selectOption("close-without-stop");
  await page
    .getByLabel("사유 / 정정 메모", { exact: true })
    .fill("중지 조치의 진위는 앱이 확인하지 않음");
  await page
    .getByRole("button", { name: "중지 기록 없이 종결 저장", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: /중지 기록 없이 요청 종결 · v2/ }),
  ).toBeVisible();
  await page.getByRole("combobox", { name: "기록 동작", exact: true }).selectOption("annotate");
  await page
    .getByLabel("사유 / 정정 메모", { exact: true })
    .fill("이전 기록 보존하는 정정 메모");
  await page
    .getByRole("button", { name: "정정/보충 메모 추가 저장", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: /중지 기록 없이 요청 종결 · v3/ }),
  ).toBeVisible();
});
