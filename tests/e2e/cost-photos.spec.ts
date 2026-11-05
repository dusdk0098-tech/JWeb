import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
// Synthetic 1x1 PNG, decoded by the browser into the 사진대지 표시본.
const onePixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
test("SC 사진대지: browser makes an EXIF-free JPEG display, labels it and prints by group", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("이메일 또는 아이디", { exact: true }).fill("test@example.test");
  await page.getByLabel("비밀번호", { exact: true }).fill("synthetic-e2e-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page.getByRole("heading", { name: "오늘", exact: true })).toBeVisible();
  const s = await (await page.request.get("/api/session")).json(),
    headers = () => ({ Origin: "http://127.0.0.1:3107", "x-csrf-token": s.csrf, "idempotency-key": randomUUID() });
  const site = await (await page.request.post("/api/sites", { headers: headers(), data: { name: "사진 합성 " + randomUUID() } })).json();
  const period = await (await page.request.post(`/api/sites/${site.id}/cost-periods`, {
    headers: headers(), data: { month: "2026-10", openingNote: "합성", categories: [{ label: "안전시설비", plan: "100", opening: "0" }] },
  })).json();
  await (await page.request.post(`/api/sites/${site.id}/cost-periods/${period.id}/expenses`, {
    headers: headers(), data: { version: 1, expense: { categoryId: period.categories[0].id, spendDate: "2026-10-02", description: "안전망 설치", quantity: "1", unitPriceWon: "10" } },
  })).json();
  await page.reload();
  await page.getByLabel("작업 현장").selectOption(site.id);
  await page.getByRole("button", { name: "산업안전보건관리비", exact: true }).click();
  await page.getByRole("button", { name: /2026-10 · 작성 중/ }).click();
  await page.getByRole("button", { name: "미검사 원본·동일 월 지출 연결" }).click();
  page.on("dialog", (d) => d.accept());
  await page.locator('input[type="file"]').setInputFiles({ name: "현장.png", mimeType: "image/png", buffer: onePixel });
  await page.getByRole("button", { name: "원본 저장" }).click();
  const canvas = page.getByRole("img", { name: /현장\.png 미리보기, 원형 강조 0개/ });
  await expect(canvas).toBeVisible();
  const evidence = await (await page.request.get(`/api/sites/${site.id}/cost-periods/${period.id}/evidence`)).json();
  const fileId = evidence.items[0].file.id;
  const shown = await page.request.get(`/api/sites/${site.id}/cost-periods/${period.id}/evidence/files/${fileId}/display`);
  expect(shown.headers()["content-type"]).toBe("image/jpeg");
  expect([...(await shown.body()).subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
  // 보완: tap adds a circle, 90° rotation; undo/redo before saving.
  await canvas.click({ position: { x: 240, y: 180 } });
  await expect(page.getByRole("img", { name: /원형 강조 1개/ })).toBeVisible();
  await page.getByRole("button", { name: "90° 회전" }).click();
  await page.getByRole("button", { name: "실행 취소" }).click();
  await page.getByRole("button", { name: "다시 실행" }).click();
  await page.getByLabel("촬영일").fill("2026-10-03");
  await page.getByLabel("내용", { exact: true }).fill("안전망 설치");
  await page.getByRole("button", { name: "사진대지 항목 저장" }).click();
  await expect(page.getByLabel("내용", { exact: true })).toHaveValue("안전망 설치");
  await expect(page.getByRole("button", { name: "사진대지 항목 저장" })).toBeDisabled();
  await page.goto(`/api/sites/${site.id}/cost-periods/${period.id}/photo-board/print`);
  await expect(page.getByRole("heading", { name: "안전시설비 등 (1/1)" })).toBeVisible();
  await expect(page.getByText("안전망 설치 · 촬영일 2026-10-03")).toBeVisible();
  const printed = page.getByRole("img", { name: "안전망 설치 사진" });
  await expect(printed).toBeVisible();
  expect(await printed.locator("image").getAttribute("transform")).toMatch(/^rotate\(90 /);
  await expect(printed.locator("circle")).toHaveCount(1);
});
