import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
// 사진 보드 2단계: folder input (non-images skipped), zoom, dragging a circle (one undo step), TSV export and the 사진대지 print.
test("사진 보드 2단계: folder, zoom, drag, TSV, two-per-page print", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("이메일 또는 아이디", { exact: true }).fill("test@example.test");
  await page.getByLabel("비밀번호", { exact: true }).fill("synthetic-e2e-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page.getByRole("heading", { name: "오늘", exact: true })).toBeVisible();
  const s = await (await page.request.get("/api/session")).json();
  const site = await (await page.request.post("/api/sites", { headers: { Origin: "http://127.0.0.1:3107", "x-csrf-token": s.csrf, "idempotency-key": randomUUID() }, data: { name: "사진 2단계 " + randomUUID() } })).json();
  const png = async (color: string) => Buffer.from(await page.evaluate(async (fill) => {
    const c = document.createElement("canvas"); c.width = 80; c.height = 60;
    const g = c.getContext("2d")!; g.fillStyle = fill; g.fillRect(0, 0, 80, 60);
    const b = await new Promise<Blob>((done) => c.toBlob((x) => done(x!), "image/png"));
    return Array.from(new Uint8Array(await b.arrayBuffer()));
  }, color));
  const dir = await mkdtemp(join(tmpdir(), "yweb-photos-"));
  await writeFile(join(dir, "1-전.png"), await png("#3a7"));
  await writeFile(join(dir, "2-후.png"), await png("#37a"));
  await writeFile(join(dir, "메모.txt"), "not a photo");
  await page.reload();
  await page.getByLabel("작업 현장").selectOption(site.id);
  await page.getByRole("button", { name: "사진 보드", exact: true }).click();
  await page.getByLabel("제목", { exact: true }).fill("2단계 보드");
  await page.getByRole("button", { name: "사진 보드 만들기" }).click();
  await page.getByLabel("폴더 추가(안의 PNG·JPEG만)").setInputFiles(dir);
  await expect(page.getByText("2장을 올립니다. 1개는 건너뜀")).toBeVisible();
  const first = page.getByRole("img", { name: /1번 사진 1-전\.png 미리보기, 원형 강조 0개/ }); // "(불러오는 중)" is gone once the photo is drawn
  await expect(first).toBeVisible();
  await expect(page.getByRole("img", { name: /2번 사진 2-후\.png/ })).toBeVisible();
  // Tap adds a circle; dragging it moves it as a single undo step.
  await first.scrollIntoViewIfNeeded();
  const box = (await first.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByRole("img", { name: /1번 사진.*원형 강조 1개/ })).toBeVisible();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.625, box.y + box.height * 0.555, { steps: 5 }); // relative: the canvas is scaled to its card
  await page.mouse.up();
  await page.getByLabel("확대(배)").first().fill("2");
  await expect(page.getByRole("img", { name: /1번 사진.*2배 확대/ })).toBeVisible();
  await page.getByRole("button", { name: "실행 취소" }).click(); // undoes the zoom only
  await expect(page.getByRole("img", { name: /1번 사진.*원형 강조 1개$/ })).toBeVisible();
  await page.getByRole("button", { name: "다시 실행" }).click();
  await page.getByLabel("설명").first().fill("=1+1 전");
  await page.getByRole("button", { name: "사진 보드 저장" }).click();
  await expect(page.getByRole("status")).toHaveText("저장했습니다.");
  const board = (await (await page.request.get(`/api/sites/${site.id}/photo-boards`)).json()).items[0];
  const saved = await (await page.request.get(`/api/sites/${site.id}/photo-boards/${board.id}`)).json();
  expect(saved.scene.items).toHaveLength(2);
  expect(saved.scene.items[0].view.zoom).toBe(2);
  expect(saved.scene.items[0].circles[0].x).toBeGreaterThan(0.6); // dragged right from the center
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "사진 정보표 TSV 저장" }).click();
  const tsv = (await readFile(await (await download).path())).toString("utf8");
  expect(tsv).toContain(`"'1"\t"'1-전.png"\t"'포함"\t"'0°"\t"'2배"\t"'=1+1 전"\t"'1"`);
  await page.goto(`/api/sites/${site.id}/photo-boards/${board.id}/print`);
  await expect(page.locator("section.photo-page")).toHaveCount(1);
  await expect(page.locator("figure.photo-slot svg")).toHaveCount(2);
  await expect(page.getByRole("img", { name: "=1+1 전 사진" })).toBeVisible();
  expect(await page.locator("figure.photo-slot svg").first().getAttribute("viewBox")).not.toBe("0 0 80 60"); // zoomed in
});
