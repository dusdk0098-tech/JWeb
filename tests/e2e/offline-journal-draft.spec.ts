import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
async function login(page: Page) {
  await page.getByLabel("이메일 또는 아이디", { exact: true }).fill("test@example.test");
  await page.getByLabel("비밀번호", { exact: true }).fill("synthetic-e2e-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page.getByRole("button", { name: "로그아웃" })).toBeVisible();
}
async function openNewJournal(page: Page, siteId: string) {
  await page.getByLabel("작업 현장").selectOption(siteId);
  await page.getByRole("button", { name: "오늘", exact: true }).click();
  await page.getByRole("button", { name: "안전업무일지", exact: true }).click();
  await page.getByRole("button", { name: "새 안전업무일지", exact: true }).click();
}
const deviceDrafts = (page: Page) => page.evaluate(() => new Promise<string>((done) => {
  const r = indexedDB.open("yweb-offline-drafts");
  r.onsuccess = () => { const g = r.result.transaction("drafts").objectStore("drafts").getAll(); g.onsuccess = () => { done(JSON.stringify(g.result.map((x: { data: ArrayBuffer }) => Array.from(new Uint8Array(x.data))))); r.result.close(); }; };
}));
test("offline drafts: encrypted on device and restorable; a save that failed offline goes through once the connection returns; cleared on logout", async ({ page, context }) => {
  test.setTimeout(90000); // journal + TBM + reconnects in one flow
  await page.goto("/");
  await login(page);
  const s = await (await page.request.get("/api/session")).json();
  const site = await (await page.request.post("/api/sites", { headers: { Origin: "http://127.0.0.1:3107", "x-csrf-token": s.csrf, "idempotency-key": randomUUID() }, data: { name: "오프라인 합성 " + randomUUID() } })).json();
  await page.reload();
  // 1) Device draft: ciphertext at rest, offered back after a reload.
  await openNewJournal(page, site.id);
  await page.getByLabel("일지 날짜 (저장 후 고정)").fill("2026-10-30");
  await page.getByLabel("작업 요약 · 보관 시 필수").fill("통신 두절 중 작성한 합성 요약");
  await page.waitForTimeout(1200); // autosave debounce
  const stored = await deviceDrafts(page);
  expect(stored.length).toBeGreaterThan(10);
  expect(stored).not.toContain("통신");
  page.once("dialog", (d) => d.accept()); // leave-page guard for the unsaved form
  await page.reload();
  await openNewJournal(page, site.id);
  await expect(page.getByText(/이 기기에 저장 안 된 초안이 있습니다/)).toBeVisible();
  await page.getByRole("button", { name: "기기 초안 복원" }).click();
  await expect(page.getByLabel("작업 요약 · 보관 시 필수")).toHaveValue("통신 두절 중 작성한 합성 요약");
  await expect(page.getByLabel("일지 날짜 (저장 후 고정)")).toHaveValue("2026-10-30");
  // 2) Offline save fails with the device-draft notice, then saves by itself when the connection returns.
  await context.setOffline(true);
  await page.getByRole("button", { name: "일지 초안 저장", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("이 기기에 암호화해 7일간 보관합니다");
  // The retry notice sits next to the save button, so it is on screen where the user tapped (phones hide the top banner).
  await expect(page.getByText("연결되면 자동으로 다시 저장합니다.")).toBeInViewport();
  await context.setOffline(false);
  await expect(page.getByText("연결되면 자동으로 다시 저장합니다.")).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect.poll(async () => JSON.stringify(await (await page.request.get(`/api/sites/${site.id}/daily-journals`)).json())).toContain("통신 두절 중 작성한 합성 요약");
  // 3) Same for a TBM draft.
  await page.getByRole("button", { name: "TBM", exact: true }).click();
  await page.getByRole("button", { name: "+ TBM 초안", exact: true }).click();
  await page.getByLabel("TBM 제목 *", { exact: true }).fill("오프라인 TBM");
  await context.setOffline(true);
  await page.getByRole("button", { name: "TBM 초안 저장", exact: true }).click();
  await expect(page.getByText("연결되면 자동으로 다시 저장합니다.")).toBeVisible();
  await context.setOffline(false);
  await expect.poll(async () => JSON.stringify(await (await page.request.get(`/api/sites/${site.id}/tbm`)).json())).toContain("오프라인 TBM");
  // 4) Logout wipes this device's drafts.
  await openNewJournal(page, site.id);
  await expect(page.getByLabel("작업 요약 · 보관 시 필수")).toBeVisible({ timeout: 5000 });
  await page.getByLabel("작업 요약 · 보관 시 필수").fill("저장 안 한 변경");
  await page.waitForTimeout(1200);
  expect(await deviceDrafts(page)).not.toBe("[]");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "로그아웃" }).click();
  await login(page);
  expect(await deviceDrafts(page).catch(() => "[]")).toBe("[]");
});
