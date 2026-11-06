import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
// 보드판: turn on the common board, edit rows and position, leave one photo out, save, and see it in the printed 사진대지.
test("사진 보드 보드판: common board, per-photo none, print", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("이메일 또는 아이디", { exact: true }).fill("test@example.test");
  await page.getByLabel("비밀번호", { exact: true }).fill("synthetic-e2e-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page.getByRole("heading", { name: "오늘", exact: true })).toBeVisible();
  const s = await (await page.request.get("/api/session")).json();
  const site = await (await page.request.post("/api/sites", { headers: { Origin: "http://127.0.0.1:3107", "x-csrf-token": s.csrf, "idempotency-key": randomUUID() }, data: { name: "보드판 " + randomUUID() } })).json();
  const png = async (color: string) => Buffer.from(await page.evaluate(async (fill) => {
    const c = document.createElement("canvas"); c.width = 160; c.height = 120;
    const g = c.getContext("2d")!; g.fillStyle = fill; g.fillRect(0, 0, 160, 120);
    const b = await new Promise<Blob>((done) => c.toBlob((x) => done(x!), "image/png"));
    return Array.from(new Uint8Array(await b.arrayBuffer()));
  }, color));
  const photos = [{ name: "1-전.png", mimeType: "image/png", buffer: await png("#3a7") }, { name: "2-후.png", mimeType: "image/png", buffer: await png("#37a") }];
  await page.reload();
  await page.getByLabel("작업 현장").selectOption(site.id);
  await page.getByRole("button", { name: "사진 보드", exact: true }).click();
  await page.getByLabel("제목", { exact: true }).fill("보드판 시험");
  await page.getByRole("button", { name: "사진 보드 만들기" }).click();
  await page.getByLabel("사진 추가(PNG·JPEG, 원본 보존)").setInputFiles(photos);
  await expect(page.getByRole("img", { name: /2번 사진 2-후\.png 미리보기, 원형 강조 0개$/ })).toBeVisible();

  await page.getByLabel("모든 사진에 보드판 넣기").check();
  await expect(page.getByRole("img", { name: /1번 사진.*보드판 4줄/ })).toBeVisible();
  await page.getByLabel("보드판 1줄 내용", { exact: true }).fill("합성 신축 공사");
  await page.getByLabel("보드판 4줄 내용", { exact: true }).fill("2026.11.05");
  await page.getByRole("button", { name: "보드판 줄 추가", exact: true }).click();
  await page.getByLabel("보드판 5줄 항목", { exact: true }).fill("내용");
  await page.getByLabel("보드판 5줄 내용", { exact: true }).fill("<기초> 철근 배근 & 검측");
  await page.getByRole("group", { name: "보드판 위치", exact: true }).getByRole("button", { name: "오른쪽 위" }).click();
  await page.getByLabel("보드판 색", { exact: true }).selectOption("green");
  await page.getByLabel("보드판 바탕 투명도", { exact: true }).fill("0.6");
  await page.getByLabel("보드판 내용 칸 너비", { exact: true }).fill("0.8");
  await expect(page.getByRole("img", { name: "보드판 미리보기, 5줄" })).toBeVisible(); // beside the fields
  await expect(page.getByRole("img", { name: /1번 사진.*보드판 5줄/ })).toBeVisible();
  await page.getByLabel("2번 사진 보드판 적용").selectOption("none"); // the second photo goes without
  await expect(page.getByRole("img", { name: /2번 사진 2-후\.png 미리보기, 원형 강조 0개$/ })).toBeVisible();
  await page.getByRole("button", { name: "사진 보드 저장" }).click();
  await expect(page.getByRole("status")).toHaveText("저장했습니다.");

  const board = (await (await page.request.get(`/api/sites/${site.id}/photo-boards`)).json()).items[0];
  const saved = await (await page.request.get(`/api/sites/${site.id}/photo-boards/${board.id}`)).json();
  expect(saved.scene.board).toMatchObject({ corner: "tr", theme: "green", opacity: 0.4, labelShare: 0.2 });
  expect(saved.scene.board.rows).toHaveLength(5);
  expect(saved.scene.items[1].board).toBeNull();
  const print = await (await page.request.get(`/api/sites/${site.id}/photo-boards/${board.id}/print`)).text();
  expect(print.match(/class="photo-board-panel"/g)).toHaveLength(1);
  expect(print).toContain("합성 신축 공사");
  expect(print).toContain(">&#60;기초&#62; 철근 배근 &#38; 검측</text>"); // escaped
  expect(print).toContain('fill-opacity="0.4"'); // 60% transparent background

  await page.reload();
  await page.getByLabel("작업 현장").selectOption(site.id);
  await page.getByRole("button", { name: "사진 보드", exact: true }).click();
  await page.getByRole("button", { name: "보드판 시험 열기" }).click();
  await expect(page.getByLabel("보드판 1줄 내용", { exact: true })).toHaveValue("합성 신축 공사");
  await expect(page.getByRole("img", { name: /1번 사진.*보드판 5줄/ })).toBeVisible();
});
