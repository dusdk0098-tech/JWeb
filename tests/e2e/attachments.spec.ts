import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
// Source-only scenario here: no browser run. Header fixture is deliberately not a decoded image.
test("warned raw upload, dirty navigation, retained detach and frozen submit", async ({
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
  const site = await (
    await page.request.post("/api/sites", {
      headers: {
        Origin: "http://127.0.0.1:3107",
        "x-csrf-token": session.csrf,
        "idempotency-key": randomUUID(),
      },
      data: { name: "첨부 합성 현장" },
    })
  ).json();
  expect(site.id).toBeTruthy();
  await page.reload();
  await page.getByLabel("작업 현장").selectOption({ label: "첨부 합성 현장" });
  await page
    .getByRole("button", { name: "신고 · 조치", exact: true })
    .click();
  await page.getByRole("button", { name: "+ 신고 초안", exact: true }).click();
  await page.getByLabel("신고 제목 *", { exact: true }).fill("첨부 시험");
  await page
    .getByLabel("장소 설명 · 제출 시 필수", { exact: true })
    .fill("합성");
  await page
    .getByLabel("신고 내용 · 제출 시 필수", { exact: true })
    .fill("테스트");
  await page
    .getByRole("button", { name: "신고 초안 저장", exact: true })
    .click();
  await page
    .getByLabel("원본 PNG/JPEG (5 MiB 이하, 개인정보 제외)")
    .setInputFiles({
      name: "synthetic.png",
      mimeType: "image/png",
      buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    });
  page.once("dialog", (d) => d.dismiss());
  await page
    .getByRole("button", { name: "신고 목록으로", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "미검사 원본 업로드" }),
  ).toBeEnabled();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "미검사 원본 업로드" }).click();
  await expect(page.getByText("synthetic.png", { exact: true })).toBeVisible();
  await page.getByLabel("분리/재연결 사유").fill("분리 시험");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "연결 분리 (보존)" }).click();
  await expect(page.getByText(/분리됨 · 원본 보존/)).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "신고 제출", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "미검사 원본 업로드" }),
  ).toHaveCount(0);
  // Explicit cancellation: do not open/download a raw original during this scenario.
  page.once("dialog", (d) => d.dismiss());
  await page.getByRole("link", { name: "경고 확인 후 원본 다운로드" }).click();
});
