import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
const onePixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
test("cost screens keep typed input through a conflict and through a refresh", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("이메일 또는 아이디", { exact: true }).fill("test@example.test");
  await page.getByLabel("비밀번호", { exact: true }).fill("synthetic-e2e-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page.getByRole("heading", { name: "오늘", exact: true })).toBeVisible();
  const s = await (await page.request.get("/api/session")).json(),
    headers = () => ({ Origin: "http://127.0.0.1:3107", "x-csrf-token": s.csrf, "idempotency-key": randomUUID() });
  const site = await (await page.request.post("/api/sites", { headers: headers(), data: { name: "입력 유지 합성 " + randomUUID() } })).json();
  const url = `/api/sites/${site.id}/cost-periods`;
  const period = await (await page.request.post(url, { headers: headers(), data: { month: "2026-10", openingNote: "합성", categories: [{ label: "항목", plan: "100", opening: "0" }] } })).json();
  const elsewhere = async (description: string) => {
    const now = await (await page.request.get(`${url}/${period.id}`)).json();
    await page.request.post(`${url}/${period.id}/expenses`, { headers: headers(), data: { version: now.version, expense: { categoryId: period.categories[0].id, spendDate: "2026-10-02", description, quantity: "1", unitPriceWon: "1" } } });
  };
  page.on("dialog", (d) => d.accept());
  await page.reload();
  await page.getByLabel("작업 현장").selectOption(site.id);
  await page.getByRole("button", { name: "산업안전보건관리비", exact: true }).click();
  await page.getByRole("button", { name: /2026-10 · 작성 중/ }).click();
  // 지출 입력 중 다른 곳에서 원장이 바뀜
  await page.getByRole("button", { name: "지출 행 추가" }).click();
  await page.getByLabel("내용", { exact: true }).fill("충돌 입력");
  await page.getByLabel("단가 (양수 원 단위 정수)").fill("7");
  await elsewhere("다른 창 지출");
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("원장 상태/버전이 변경되었습니다");
  await page.getByRole("button", { name: "입력 유지·최신본 받기" }).click();
  await expect(page.getByRole("heading", { name: "다른 창 지출", exact: true })).toBeVisible();
  await expect(page.getByLabel("내용", { exact: true })).toHaveValue("충돌 입력");
  await expect(page.getByLabel("단가 (양수 원 단위 정수)")).toHaveValue("7");
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.getByRole("heading", { name: "충돌 입력", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "취소", exact: true }).click();
  // 현장 설정도 같은 경로
  await page.getByRole("button", { name: "현장 설정", exact: true }).click();
  await page.getByLabel("공사명", { exact: true }).fill("설정 충돌 입력");
  await elsewhere("다른 창 지출 2");
  await page.getByRole("button", { name: "현장 설정 저장" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByRole("button", { name: "입력 유지·최신본 받기" }).click();
  await expect(page.getByLabel("공사명", { exact: true })).toHaveValue("설정 충돌 입력");
  await page.getByRole("button", { name: "현장 설정 저장" }).click();
  await expect(page.getByRole("status")).toContainText("저장했습니다");
  await page.getByRole("button", { name: "사용내역으로 돌아가기" }).click();
  // 사진대지 입력 중 최신 조회
  await page.getByRole("button", { name: "미검사 원본·동일 월 지출 연결" }).click();
  await page.locator('input[type="file"]').setInputFiles({ name: "유지.png", mimeType: "image/png", buffer: onePixel });
  await page.getByRole("button", { name: "원본 저장" }).click();
  await expect(page.getByRole("img", { name: /유지\.png 미리보기/ })).toBeVisible();
  await page.getByLabel("내용", { exact: true }).fill("저장 안 한 사진 내용");
  await page.getByRole("button", { name: "입력 유지·최신 조회" }).click();
  await expect(page.getByRole("button", { name: "입력 유지·최신 조회" })).toBeEnabled();
  await expect(page.getByLabel("내용", { exact: true })).toHaveValue("저장 안 한 사진 내용");
  await page.getByRole("button", { name: "사진대지 항목 저장" }).click();
  await expect(page.getByRole("button", { name: "사진대지 항목 저장" })).toBeDisabled();
  await page.getByLabel("내용", { exact: true }).fill("저장 후 다시 고침");
  await page.getByRole("button", { name: "사진대지 항목 저장" }).click();
  await expect(page.getByRole("button", { name: "사진대지 항목 저장" })).toBeDisabled();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByLabel("내용", { exact: true })).toHaveValue("저장 후 다시 고침");
});
