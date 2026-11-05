import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
// Real browser-encoded JPEG with a synthetic EXIF DateTimeOriginal inserted after SOI.
function withExif(jpeg: Buffer, date: string) {
  const t = Buffer.alloc(80);
  t.write("II", 0, "latin1"); t.writeUInt16LE(42, 2); t.writeUInt32LE(8, 4);
  t.writeUInt16LE(1, 8); t.writeUInt16LE(0x8769, 10); t.writeUInt16LE(4, 12); t.writeUInt32LE(1, 14); t.writeUInt32LE(26, 18);
  t.writeUInt16LE(1, 26); t.writeUInt16LE(0x9003, 28); t.writeUInt16LE(2, 30); t.writeUInt32LE(20, 32); t.writeUInt32LE(44, 36);
  t.write(date + "\0", 44, "latin1");
  const app1 = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), t]);
  return Buffer.concat([jpeg.subarray(0, 2), Buffer.from([0xff, 0xe1, (app1.length + 2) >> 8, (app1.length + 2) & 255]), app1, jpeg.subarray(2)]);
}
test("SC 사진대지: EXIF 촬영일 only prefills the editable 촬영일", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("이메일 또는 아이디", { exact: true }).fill("test@example.test");
  await page.getByLabel("비밀번호", { exact: true }).fill("synthetic-e2e-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page.getByRole("heading", { name: "오늘", exact: true })).toBeVisible();
  const s = await (await page.request.get("/api/session")).json(),
    headers = () => ({ Origin: "http://127.0.0.1:3107", "x-csrf-token": s.csrf, "idempotency-key": randomUUID() });
  const site = await (await page.request.post("/api/sites", { headers: headers(), data: { name: "EXIF 합성 " + randomUUID() } })).json();
  const period = await (await page.request.post(`/api/sites/${site.id}/cost-periods`, {
    headers: headers(), data: { month: "2026-10", openingNote: "합성", categories: [{ label: "안전시설비", plan: "100", opening: "0" }] },
  })).json();
  const jpeg = Buffer.from(await page.evaluate(async () => {
    const c = document.createElement("canvas"); c.width = 4; c.height = 3; c.getContext("2d")!.fillRect(0, 0, 4, 3);
    const b = await new Promise<Blob>((done) => c.toBlob((x) => done(x!), "image/jpeg"));
    return Array.from(new Uint8Array(await b.arrayBuffer()));
  }));
  await page.reload();
  await page.getByLabel("작업 현장").selectOption(site.id);
  await page.getByRole("button", { name: "산업안전보건관리비", exact: true }).click();
  await page.getByRole("button", { name: /2026-10 · 작성 중/ }).click();
  await page.getByRole("button", { name: "미검사 원본·동일 월 지출 연결" }).click();
  page.on("dialog", (d) => d.accept());
  await page.locator('input[type="file"]').setInputFiles({ name: "exif.jpg", mimeType: "image/jpeg", buffer: withExif(jpeg, "2026:10:03 09:15:00") });
  await page.getByRole("button", { name: "원본 저장" }).click();
  await expect(page.getByRole("img", { name: /exif\.jpg 미리보기, 원형 강조 0개/ })).toBeVisible();
  const board = await (await page.request.get(`/api/sites/${site.id}/cost-periods/${period.id}/photo-board`)).json();
  expect([board.photos[0].width, board.photos[0].height]).toEqual([4, 3]);
  await expect(page.getByLabel("촬영일")).toHaveValue("2026-10-03");
  await expect(page.getByLabel("촬영일")).toBeEnabled();
});
