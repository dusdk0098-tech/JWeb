import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
// Prepared acceptance source only; browser was not executed in this environment.
test("explicit account notice publish acknowledgement and new-version reset", async ({
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
  const site = await (
    await page.request.post("/api/sites", {
      headers: {
        Origin: "http://127.0.0.1:3107",
        "x-csrf-token": session.csrf,
        "idempotency-key": randomUUID(),
      },
      data: { name: "공지 합성 현장" },
    })
  ).json();
  await page.reload();
  await page.getByLabel("작업 현장").selectOption(site.id);
  await page
    .getByRole("button", { name: "공지 · 자료", exact: true })
    .click();
  await page.getByRole("button", { name: "새 공지 초안", exact: true }).click();
  const recipients = page.getByRole("group", {
    name: "명시적 수신 계정 (1–200명)",
    exact: true,
  });
  await expect(recipients).toHaveCount(1);
  await page.getByLabel("공지 제목", { exact: true }).fill("통로 변경 안내");
  await page.getByLabel("적용 작업/범위", { exact: true }).fill("A구역");
  await page
    .getByRole("textbox", { name: "공지 본문", exact: true })
    .fill("변경된 통로를 확인하세요. 합성 안내입니다.");
  await page.getByRole("checkbox").check();
  page.once("dialog", (d) => d.dismiss());
  await page
    .getByRole("button", { name: "공지 목록으로", exact: true })
    .click();
  await expect(page.getByLabel("공지 제목", { exact: true })).toHaveValue(
    "통로 변경 안내",
  );
  await page
    .getByRole("button", { name: "공지 초안 저장", exact: true })
    .click();
  await expect(recipients).toHaveCount(1);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "공지 게시", exact: true }).click();
  await expect(page.getByLabel("공지 제목", { exact: true })).toBeDisabled();
  await expect(recipients).toHaveCount(0);
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "내 계정으로 공지 확인", exact: true })
    .click();
  await expect(page.getByRole("status").filter({ hasText: "내 계정 확인" })).toBeVisible(); // the save bar has its own status line now
  await page.getByLabel("처리 사유", { exact: true }).fill("후속 안내");
  await page
    .getByRole("button", { name: "후속 공지 초안 생성", exact: true })
    .click();
  await expect(page.getByLabel("공지 제목", { exact: true })).toBeEnabled();
  await expect(recipients).toHaveCount(1);
  await page
    .getByRole("textbox", { name: "공지 본문", exact: true })
    .fill("새 안내. 이전 확인은 승계하지 않습니다.");
  await page
    .getByRole("button", { name: "공지 초안 저장", exact: true })
    .click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "공지 게시", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "내 계정으로 공지 확인", exact: true }),
  ).toBeVisible();
  await expect(recipients).toHaveCount(0);
});
