import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
// 편의 4·7·8: the first-run steps on the home, "지난 TBM 참가자 불러오기", and "참조 취합 후 확정" in one click.
test("first-run steps, previous-TBM roster copy, journal capture-and-archive", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("이메일 또는 아이디", { exact: true }).fill("test@example.test");
  await page.getByLabel("비밀번호", { exact: true }).fill("synthetic-e2e-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page.getByRole("heading", { name: "오늘", exact: true })).toBeVisible();
  const s = await (await page.request.get("/api/session")).json();
  const h = () => ({ Origin: "http://127.0.0.1:3107", "x-csrf-token": s.csrf, "idempotency-key": randomUUID() });
  const site = await (await page.request.post("/api/sites", { headers: h(), data: { name: "지름길 합성 " + randomUUID() } })).json();
  for (const name of ["김합성", "이합성"])
    await page.request.post(`/api/sites/${site.id}/workers`, { headers: h(), data: { name, affiliation: "합성 소속", kind: "worker" } });
  await page.reload();
  await page.getByLabel("작업 현장").selectOption(site.id);
  // home: steps until the first TBM
  const steps = page.locator("section.home-steps");
  await expect(steps.getByText("명부 등록")).toBeVisible();
  await expect(steps.getByRole("button", { name: "첫 TBM 쓰러 가기" })).toBeVisible();
  await steps.getByRole("button", { name: "첫 TBM 쓰러 가기" }).click();
  // first TBM with one participant
  await page.getByRole("button", { name: "+ TBM 초안", exact: true }).click();
  await page.getByLabel("TBM 제목 *", { exact: true }).fill("첫 TBM");
  await page.getByLabel("TBM 날짜 *", { exact: true }).fill("2026-10-30");
  await page.getByRole("button", { name: "TBM 초안 저장", exact: true }).click();
  await expect(page.getByRole("status").last()).toHaveText("서버에 저장됨");
  await page.getByRole("button", { name: /김합성 · 합성 소속/ }).click();
  await expect(page.getByRole("heading", { name: "참가 대상 · 1명" })).toBeVisible();
  await page.getByRole("button", { name: "TBM 목록으로", exact: true }).click();
  // second TBM copies the roster as 미확인
  await page.getByRole("button", { name: "+ TBM 초안", exact: true }).click();
  await page.getByLabel("TBM 제목 *", { exact: true }).fill("둘째 TBM");
  await page.getByLabel("TBM 날짜 *", { exact: true }).fill("2026-10-31");
  await page.getByRole("button", { name: "TBM 초안 저장", exact: true }).click();
  await expect(page.getByRole("status").last()).toHaveText("서버에 저장됨");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "지난 TBM 참가자 불러오기", exact: true }).click();
  await expect(page.getByRole("heading", { name: "참가 대상 · 1명" })).toBeVisible();
  await expect(page.locator("ul.members")).toContainText("김합성");
  await expect(page.locator("ul.members")).toContainText("미확인");
  // home steps are gone once a TBM exists
  await page.getByRole("button", { name: "오늘", exact: true }).click();
  await expect(page.getByRole("heading", { name: "오늘", exact: true })).toBeVisible();
  await expect(page.locator("section.home-steps")).toHaveCount(0);
  // journal: save, then capture and archive with one click
  await page.getByRole("button", { name: "안전업무일지", exact: true }).click();
  await page.getByRole("button", { name: "새 안전업무일지", exact: true }).click();
  await page.getByLabel("일지 날짜 (저장 후 고정)").fill("2026-10-31");
  await page.getByLabel("작업 요약 · 보관 시 필수").fill("합성 작업");
  await page.getByLabel("안전 안내 기록 · 보관 시 필수").fill("합성 안내");
  await page.getByRole("button", { name: "일지 초안 저장", exact: true }).click();
  await expect(page.getByRole("status").last()).toHaveText("서버에 저장됨");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "참조 취합 후 확정", exact: true }).click();
  await expect(page.getByRole("heading", { name: "관리자가 보관한 안전업무일지", exact: true })).toBeVisible();
});
