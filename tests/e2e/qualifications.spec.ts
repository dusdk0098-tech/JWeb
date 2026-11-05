import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
// 교육 · 자격 이수 현황: record a licence expiring soon, find it on the list and the home screen, renew it (the old record
// leaves the alerts), then void the renewal (the old record comes back).
test("qualifications: record, expiring-soon filter, home task, renew, void", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("이메일 또는 아이디", { exact: true }).fill("test@example.test");
  await page.getByLabel("비밀번호", { exact: true }).fill("synthetic-e2e-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page.getByRole("heading", { name: "오늘", exact: true })).toBeVisible();
  const s = await (await page.request.get("/api/session")).json();
  const headers = () => ({ Origin: "http://127.0.0.1:3107", "x-csrf-token": s.csrf, "idempotency-key": randomUUID() });
  const site = await (await page.request.post("/api/sites", { headers: headers(), data: { name: "이수 자격 합성 " + randomUUID() } })).json();
  await page.request.post(`/api/sites/${site.id}/workers`, { headers: headers(), data: { name: "합성 조종원", affiliation: "합성 장비", kind: "worker" } });
  await page.reload();
  await page.getByLabel("작업 현장").selectOption(site.id);
  const day = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString("en-CA"); };

  await page.getByRole("button", { name: "이수 · 자격", exact: true }).click();
  await expect(page.getByText("아직 기록이 없습니다")).toBeVisible();
  await page.getByLabel("사람 찾기").fill("조종");
  await expect(page.getByLabel("사람", { exact: true }).locator("option", { hasText: "합성 조종원" })).toHaveCount(1);
  await page.getByLabel("사람", { exact: true }).selectOption({ label: "합성 조종원 · 합성 장비" });
  await page.getByLabel("종류", { exact: true }).selectOption("license");
  await page.getByLabel("이름 · 번호 *").fill("지게차 운전기능사");
  await page.getByLabel("만료일").fill(day(10));
  await page.getByRole("button", { name: "기록 추가" }).click();
  await expect(page.getByText("기록했습니다.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "합성 조종원 · 면허 · 자격증" })).toBeVisible();
  await expect(page.getByText("30일 이내 만료", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "만료됨", exact: true }).click();
  await expect(page.getByText("해당하는 기록이 없습니다")).toBeVisible();
  await page.getByRole("button", { name: "30일 이내", exact: true }).click();
  await expect(page.getByRole("heading", { name: "합성 조종원 · 면허 · 자격증" })).toBeVisible();

  await page.getByRole("button", { name: "오늘", exact: true }).first().click();
  await page.getByRole("button", { name: /자격 만료.*합성 조종원 · 면허 · 자격증/ }).click();
  await page.getByRole("button", { name: "갱신 기록", exact: true }).click();
  await expect(page.getByRole("heading", { name: "갱신 기록", exact: true })).toBeVisible();
  await expect(page.getByLabel("이름 · 번호 *")).toHaveValue("지게차 운전기능사");
  await page.getByLabel("만료일").fill(day(700));
  await page.getByRole("button", { name: "기록 추가" }).click();
  await expect(page.getByText("기록했습니다.")).toBeVisible();
  await expect(page.getByText("갱신됨", { exact: true })).toBeVisible();
  await expect(page.getByText("유효", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "30일 이내", exact: true }).click();
  await expect(page.getByText("해당하는 기록이 없습니다")).toBeVisible();

  await page.getByRole("button", { name: "전체", exact: true }).click();
  await page.locator("article", { hasText: "유효" }).getByRole("button", { name: "무효 처리…" }).click();
  await page.getByLabel("무효 사유").fill("만료일 오기");
  await page.getByRole("button", { name: "무효 처리", exact: true }).click();
  await expect(page.getByText("무효 처리했습니다.")).toBeVisible();
  await expect(page.getByText("30일 이내 만료", { exact: true })).toBeVisible();
  await expect(page.locator("article")).toHaveCount(1);
});
