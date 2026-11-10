import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
async function openNewJournal(page: Page) {
  await page.getByRole("button", { name: "안전업무일지", exact: true }).click();
  await page.getByRole("button", { name: "새 안전업무일지", exact: true }).click();
}
test("offline outbox: saves made offline wait on the device, go out once after reconnect with the editor closed, and a refused one is kept", async ({ page, context }) => {
  test.setTimeout(90000);
  await page.goto("/");
  await page.getByLabel("이메일 또는 아이디", { exact: true }).fill("test@example.test");
  await page.getByLabel("비밀번호", { exact: true }).fill("synthetic-e2e-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page.getByRole("button", { name: "로그아웃" })).toBeVisible();
  const s = await (await page.request.get("/api/session")).json();
  const site = await (await page.request.post("/api/sites", { headers: { Origin: "http://127.0.0.1:3107", "x-csrf-token": s.csrf, "idempotency-key": randomUUID() }, data: { name: "전송함 합성 " + randomUUID() } })).json();
  const server = async (path: string) => JSON.stringify(await (await page.request.get(`/api/sites/${site.id}/${path}`)).json());
  await page.reload();
  await page.getByLabel("작업 현장").selectOption(site.id);
  page.on("dialog", (d) => d.accept()); // leaving an unsaved editor, and discarding at the end

  // 1) Two new journals written with no connection; both editors are closed before it returns.
  await openNewJournal(page);
  await page.getByLabel("일지 날짜 (저장 후 고정)").fill("2026-10-28");
  await page.getByLabel("작업 요약 · 보관 시 필수").fill("전송함 일지 A");
  await context.setOffline(true);
  await page.getByRole("button", { name: "일지 초안 저장", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("이 화면을 떠나도 전송 대기에 남습니다");
  // A second new journal in the same screen (screens not opened before going offline cannot load without a connection).
  await page.getByRole("button", { name: "일지 목록으로", exact: true }).click();
  await page.getByRole("button", { name: "새 안전업무일지", exact: true }).click();
  await page.getByLabel("일지 날짜 (저장 후 고정)").fill("2026-10-29");
  await page.getByLabel("작업 요약 · 보관 시 필수").fill("전송함 일지 B");
  await page.getByRole("button", { name: "일지 초안 저장", exact: true }).click();
  await expect(page.getByText("연결되면 자동으로 다시 저장합니다.")).toBeVisible();
  await page.getByRole("button", { name: "오늘", exact: true }).click();
  await expect(page.getByText("전송 대기 2건", { exact: true })).toBeVisible();
  // At rest the queue is ciphertext.
  const stored = await page.evaluate(() => new Promise<string>((done) => {
    const r = indexedDB.open("yweb-offline-drafts");
    r.onsuccess = () => { const g = r.result.transaction("outbox").objectStore("outbox").getAll(); g.onsuccess = () => { done(JSON.stringify(g.result.map((x: { data: ArrayBuffer }) => Array.from(new Uint8Array(x.data))))); r.result.close(); }; };
  }));
  expect(stored.length).toBeGreaterThan(20);
  expect(stored).not.toContain("전송함");
  expect(await server("daily-journals")).not.toContain("전송함 일지 A");
  await context.setOffline(false);
  await expect(page.getByText(/전송 대기/)).toHaveCount(0);
  expect(await server("daily-journals")).toContain("전송함 일지 A");
  expect(await server("daily-journals")).toContain("전송함 일지 B");
  // Sent once each.
  for (const text of ["전송함 일지 A", "전송함 일지 B"]) expect((await server("daily-journals")).split(text).length - 1).toBe(1);

  // 2) A second new journal for the same day is refused by the server: kept, readable, never overwritten.
  await openNewJournal(page);
  await page.getByLabel("일지 날짜 (저장 후 고정)").fill("2026-10-28");
  await page.getByLabel("작업 요약 · 보관 시 필수").fill("같은 날짜 두 번째 일지");
  await context.setOffline(true);
  await page.getByRole("button", { name: "일지 초안 저장", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("전송 대기에 남습니다");
  await page.getByRole("button", { name: "오늘", exact: true }).click();
  await expect(page.getByText("전송 대기 1건", { exact: true })).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByText("보내지 못함 1건", { exact: true })).toBeVisible();
  await page.getByText("보내지 못함 1건", { exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("그 현장·날짜의 최초 일지가 이미 있습니다");
  await page.getByText("보내려던 내용 보기").click();
  await expect(page.locator(".outbox pre")).toContainText("같은 날짜 두 번째 일지");
  expect(await server("daily-journals")).not.toContain("같은 날짜 두 번째 일지");
  await page.getByRole("button", { name: "버리기", exact: true }).click();
  await expect(page.getByText(/보내지 못함/)).toHaveCount(0);
});
