import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
// 편의 9: the hazard report editor keeps a device draft and retries the save when the connection returns;
// lists get "이 페이지에서 찾기".
test("hazard draft survives offline and the list filter narrows the loaded page", async ({ page, context }) => {
  await page.goto("/");
  await page.getByLabel("이메일 또는 아이디", { exact: true }).fill("test@example.test");
  await page.getByLabel("비밀번호", { exact: true }).fill("synthetic-e2e-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page.getByRole("heading", { name: "오늘", exact: true })).toBeVisible();
  const s = await (await page.request.get("/api/session")).json();
  const site = await (await page.request.post("/api/sites", { headers: { Origin: "http://127.0.0.1:3107", "x-csrf-token": s.csrf, "idempotency-key": randomUUID() }, data: { name: "오프라인 신고 합성 " + randomUUID() } })).json();
  await page.reload();
  await page.getByLabel("작업 현장").selectOption(site.id);
  await page.getByRole("button", { name: "신고 · 조치", exact: true }).click();
  await page.getByRole("button", { name: "+ 신고 초안", exact: true }).click();
  await page.getByLabel("신고 제목 *", { exact: true }).fill("통신 두절 중 신고");
  await page.waitForTimeout(1200); // device-draft autosave debounce
  await context.setOffline(true);
  await page.getByRole("button", { name: "신고 초안 저장", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("이 기기에 암호화해 7일간 보관합니다");
  await expect(page.getByText("연결되면 자동으로 다시 저장합니다.")).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByText("연결되면 자동으로 다시 저장합니다.")).toHaveCount(0, { timeout: 10000 });
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: "신고 목록으로", exact: true }).click();
  await expect(page.getByRole("button", { name: /통신 두절 중 신고/ })).toBeVisible();
  await page.getByLabel("이 페이지에서 찾기").fill("없는 제목");
  await expect(page.getByRole("button", { name: /통신 두절 중 신고/ })).toHaveCount(0);
  await page.getByLabel("이 페이지에서 찾기").fill("두절");
  await expect(page.getByRole("button", { name: /통신 두절 중 신고/ })).toBeVisible();
});
