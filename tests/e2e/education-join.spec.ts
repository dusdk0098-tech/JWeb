import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
test("교육 QR 참여: the author shows a link, a participant confirms without login, attendance stays manual", async ({ page, browser }) => {
  await page.goto("/");
  await page.getByLabel("이메일 또는 아이디", { exact: true }).fill("test@example.test");
  await page.getByLabel("비밀번호", { exact: true }).fill("synthetic-e2e-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page.getByRole("heading", { name: "오늘", exact: true })).toBeVisible();
  const s = await (await page.request.get("/api/session")).json(), headers = () => ({ Origin: "http://127.0.0.1:3107", "x-csrf-token": s.csrf, "idempotency-key": randomUUID() });
  const site = await (await page.request.post("/api/sites", { headers: headers(), data: { name: "교육 참여 합성 " + randomUUID() } })).json();
  const worker = await (await page.request.post(`/api/sites/${site.id}/workers`, { headers: headers(), data: { name: "박교육", affiliation: "합성 소속", kind: "worker" } })).json();
  await page.request.put(`/api/sites/${site.id}/workers/${worker.id}/identity`, { headers: headers(), data: { birthDate: "1988-03-04" } });
  await page.reload();
  await page.getByLabel("작업 현장").selectOption(site.id);
  await page.getByRole("button", { name: "교육일지", exact: true }).click();
  await page.getByRole("button", { name: "+ 교육일지 초안", exact: true }).click();
  await page.getByLabel("교육 제목", { exact: true }).fill("참여 링크 교육");
  await page.getByLabel("자체 과정/유형 표시", { exact: true }).fill("직접 작성");
  await page.getByLabel("강사 표시 (직접 입력)", { exact: true }).fill("담당자");
  await page.getByLabel("교육 장소", { exact: true }).fill("합성 교육장");
  await page.getByLabel("교육 목표", { exact: true }).fill("자체 목표");
  await page.getByLabel("직접 작성 교육내용", { exact: true }).fill("합성 교육내용");
  await page.getByRole("button", { name: "교육 초안 저장", exact: true }).click();
  await page.getByRole("combobox", { name: "명부 후보 (자동 참석 아님)", exact: true }).selectOption(worker.id);
  await page.getByRole("button", { name: "미입력 대상으로 추가", exact: true }).click();
  await expect(page.getByText(/미입력 · 0분/)).toBeVisible();
  await page.locator("summary", { hasText: "참여 링크 · QR" }).click();
  await page.getByRole("button", { name: "참여 링크 만들기" }).click();
  const link = await page.getByLabel("참여 링크").inputValue();
  expect(link).toMatch(/\/join#t=[A-Za-z0-9_-]{43}$/);
  await expect(page.getByRole("img", { name: "참여 링크 QR 코드" })).toBeVisible();
  const phone = await (await browser.newContext()).newPage(); // separate browser, not logged in
  await phone.goto(link);
  await expect(phone.getByRole("heading", { name: "교육 참여 확인", exact: true })).toBeVisible();
  await expect(phone.getByText(/참여 링크 교육 · .* · 합성 교육장/)).toBeVisible();
  await expect(phone.getByText(/교육 참여 확인 서명 동의/)).toBeVisible();
  await phone.getByLabel("이름").fill("박 교육");
  await phone.getByLabel("생년월일").fill("1988-03-05");
  await phone.getByRole("button", { name: "동의하지 않고 참여만 기록" }).click();
  await expect(phone.getByRole("alert")).toContainText("교육 참여 명단의 이름과 생년월일이 맞지 않습니다");
  await phone.getByLabel("생년월일").fill("1988-03-04");
  await phone.getByRole("button", { name: "동의하지 않고 참여만 기록" }).click();
  await expect(phone.getByRole("status")).toContainText("박교육님의 참여를 기록했습니다(서명 없이)");
  await expect(phone.getByRole("status")).toContainText("이 기록만으로 교육 이수가 되지는 않습니다");
  await page.getByRole("button", { name: "참여 기록 새로 조회" }).click();
  await expect(page.getByText(/참여 기록 1건: 박교육\(.* · 서명 동의 안 함\)/)).toBeVisible();
  await expect(page.getByText(/미입력 · 0분/)).toBeVisible(); // a participation record is not attendance
  await expect(page.getByText(/유효\(~/)).toBeVisible(); // adding the participant did not end the link
});
