import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
// Source only: browser execution blocked; no executed UI claim.
test("manager ledger keeps exact fractions through explicit close and carry", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("이메일 또는 아이디", { exact: true }).fill("test@example.test");
  await page
    .getByLabel("비밀번호", { exact: true })
    .fill("synthetic-e2e-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "오늘", exact: true }),
  ).toBeVisible();
  const session = await (await page.request.get("/api/session")).json();
  const site = await (
    await page.request.post("/api/sites", {
      headers: {
        Origin: "http://127.0.0.1:3107",
        "x-csrf-token": session.csrf,
        "idempotency-key": randomUUID(),
      },
      data: { name: "비용 합성 현장" },
    })
  ).json();
  await page.reload();
  await page.getByLabel("작업 현장").selectOption(site.id);
  await page
    .getByRole("button", { name: "산업안전보건관리비", exact: true })
    .click();
  await page.getByRole("button", { name: "최초 원장 만들기" }).click();
  await page.getByLabel("귀속 월").fill("2026-10");
  await page.getByLabel("초기 이월 근거").fill("합성 시작");
  await page.getByLabel("항목명").fill("자체 항목");
  await page.getByLabel("계획액").fill("100");
  await page.getByRole("button", { name: "생성", exact: true }).click();
  await page.getByRole("button", { name: "지출 행 추가" }).click();
  await page.getByLabel("내용", { exact: true }).fill("합성 비용");
  await page.getByLabel("수량 (양수, 소수 6자리까지)").fill("0.25");
  await page.getByLabel("단가 (양수 원 단위 정수)").fill("3");
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.getByText(/0.25 × 3원 = 0.75원/)).toBeVisible();
  await page.getByLabel("변경 / 마감 / 재개 사유").fill("수기 마감");
  // 출력 전 확인 errors (no 현장 설정 yet) block closing.
  await expect(page.getByRole("button", { name: "기록 마감", exact: true })).toBeDisabled();
  page.on("dialog", (d) => d.accept()); // leave-draft confirm here, close confirm below
  await page.getByRole("button", { name: "현장 설정", exact: true }).click();
  for (const [label, value] of [
    ["작성일", "2026-10-31"], ["공사명", "합성 공사"], ["건설업체명", "합성건설"],
    ["공사기간 시작일", "2026-01-01"], ["공사기간 종료일", "2026-12-31"],
    ["공사금액 (원, 정수)", "1000000"], ["계상안전관리비 (원, 정수)", "30000"],
    ["작성자", "작성"], ["작성확인자", "확인"],
  ])
    await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByRole("button", { name: "현장 설정 저장" }).click();
  await expect(page.getByRole("status")).toBeVisible();
  await page.getByRole("button", { name: "사용내역으로 돌아가기" }).click();
  await page.getByLabel("변경 / 마감 / 재개 사유").fill("수기 마감");
  await page.getByRole("button", { name: "기록 마감", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: /2026-10 산업안전보건관리비 · 마감/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "다음 월 이월 생성" }).click();
  await expect(
    page.getByRole("heading", { name: /2026-11 산업안전보건관리비/ }),
  ).toBeVisible();
  await expect(page.getByText("0.75", { exact: true }).first()).toBeVisible();
});
