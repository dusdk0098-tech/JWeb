import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
test("사진 보드 도형·문구: rectangle and dashed highlight print as drawn; saved 보드판 내용 comes back as a suggestion with today's date", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("이메일 또는 아이디", { exact: true }).fill("test@example.test");
  await page.getByLabel("비밀번호", { exact: true }).fill("synthetic-e2e-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page.getByRole("heading", { name: "오늘", exact: true })).toBeVisible();
  const s = await (await page.request.get("/api/session")).json();
  const site = await (await page.request.post("/api/sites", { headers: { Origin: "http://127.0.0.1:3107", "x-csrf-token": s.csrf, "idempotency-key": randomUUID() }, data: { name: "도형 합성 " + randomUUID() } })).json();
  const pngBytes = Buffer.from(await page.evaluate(async () => {
    const c = document.createElement("canvas"); c.width = 400; c.height = 300;
    const g = c.getContext("2d")!; g.fillStyle = "#68a"; g.fillRect(0, 0, 400, 300);
    const b = await new Promise<Blob>((done) => c.toBlob((x) => done(x!), "image/png"));
    return Array.from(new Uint8Array(await b.arrayBuffer()));
  }));
  await page.reload();
  await page.getByLabel("작업 현장").selectOption(site.id);
  await page.getByRole("button", { name: "사진 보드", exact: true }).click();
  await page.getByLabel("제목", { exact: true }).fill("도형 확인");
  await page.getByRole("button", { name: "사진 보드 만들기" }).click();
  await page.getByLabel("사진 추가(PNG·JPEG, 원본 보존)").setInputFiles({ name: "현장.png", mimeType: "image/png", buffer: pngBytes });
  const preview = page.getByRole("img", { name: /1번 사진 현장\.png 미리보기, 원형 강조 0개/ });
  await expect(preview).toBeVisible();
  await preview.click({ position: { x: 240, y: 180 } });
  await page.getByLabel("강조 모양").selectOption("rect");
  await expect(page.getByRole("img", { name: /원형 강조 0개, 사각형 강조 1개/ })).toBeVisible();
  await page.getByLabel("점선").check();
  await page.getByRole("button", { name: "가로 넓게" }).click();
  // 보드판 내용 with today's date offered by the browser's own suggestion list
  await page.getByLabel("모든 사진에 보드판 넣기").check();
  const today = await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`; });
  await expect(page.locator(`datalist#board-phrases option[value="${today}"]`)).toHaveCount(1);
  await expect(page.getByLabel("보드판 1줄 내용", { exact: true })).toHaveAttribute("list", "board-phrases");
  await page.getByLabel("보드판 1줄 내용", { exact: true }).fill("합성 신축공사");
  await page.getByLabel("보드판 4줄 내용", { exact: true }).fill(today);
  await page.getByRole("button", { name: "사진 보드 저장" }).click();
  await expect(page.getByRole("status")).toHaveText("저장했습니다.");
  const board = (await (await page.request.get(`/api/sites/${site.id}/photo-boards`)).json()).items[0];
  const saved = await (await page.request.get(`/api/sites/${site.id}/photo-boards/${board.id}`)).json();
  expect(saved.scene.items[0].circles).toMatchObject([{ r: 0.1, color: "red", kind: "rect", h: 0.08, dashed: true }]); // widened once: height stays at the first size
  const print = await (await page.request.get(`/api/sites/${site.id}/photo-boards/${board.id}/print`)).text();
  expect(print).toMatch(/<rect x="[\d.]+" y="[\d.]+" width="[\d.]+" height="[\d.]+" fill="none" stroke="#e0312b" stroke-width="[\d.]+" stroke-dasharray="[\d. ]+"\/>/);
  // The saved text (not the date) is now a suggestion on this device, and can be removed.
  await expect(page.locator('datalist#board-phrases option[value="합성 신축공사"]')).toHaveCount(1);
  await expect(page.locator("datalist#board-phrases option")).toHaveCount(2);
  await page.getByText("자주 쓰는 문구 1개 (이 기기에만 보관)").click();
  await page.getByRole("button", { name: "문구 지우기: 합성 신축공사" }).click();
  await expect(page.locator("datalist#board-phrases option")).toHaveCount(1);
});
