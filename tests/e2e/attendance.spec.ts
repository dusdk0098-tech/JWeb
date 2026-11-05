import { test, expect } from "@playwright/test";
test("manual roster/attendance with cancel guards, correction history and print", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("이메일 또는 아이디", { exact: true }).fill("test@example.test");
  await page
    .getByLabel("비밀번호", { exact: true })
    .fill("synthetic-e2e-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await page.getByRole("button", { name: "현장 관리", exact: true }).click();
  await page.getByLabel("현장 이름", { exact: true }).fill("출역 합성 현장");
  await page.getByRole("button", { name: "현장 만들기", exact: true }).click();
  await page.getByLabel("작업 현장").selectOption({ label: "출역 합성 현장" });
  await page
    .getByRole("button", { name: "명부 · 출역", exact: true })
    .click();
  await page
    .getByRole("button", { name: "근로자 · 방문자 명부", exact: true })
    .click();
  await page.getByLabel("이름 *", { exact: true }).fill("김합성");
  await page.getByLabel("소속 *", { exact: true }).fill("합성 업체");
  page.once("dialog", (d) => d.dismiss());
  await page.getByRole("button", { name: "출역 현황", exact: true }).click();
  await expect(page.getByLabel("이름 *", { exact: true })).toHaveValue(
    "김합성",
  );
  page.once("dialog", (d) => d.dismiss());
  await page.getByRole("button", { name: "오늘", exact: true }).click();
  await expect(page.getByLabel("이름 *", { exact: true })).toHaveValue(
    "김합성",
  );
  await page.getByRole("button", { name: "명부 등록", exact: true }).click();
  await expect(page.getByLabel("이름 *", { exact: true })).toHaveValue("");
  await expect(page.getByText("김합성", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "출역 현황", exact: true }).click();
  await page.getByLabel("출역 날짜", { exact: true }).fill("2026-10-28");
  await page
    .getByRole("button", { name: /김합성 · 합성 업체 · 근로자/ })
    .click();
  await page
    .getByRole("button", { name: "선택 1명 출역 등록", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("출역 1명");
  await page.getByRole("button", { name: "정정 / 취소", exact: true }).click();
  await page
    .getByRole("textbox", { name: "정정 / 취소 사유 *", exact: true })
    .fill("날짜 확인 후 취소");
  page.once("dialog", (d) => d.dismiss());
  await page.getByRole("button", { name: "정정 닫기", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "정정 / 취소 사유 *", exact: true }),
  ).toHaveValue("날짜 확인 후 취소");
  await page.getByRole("button", { name: "정정 저장", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("출역 0명 · 취소 1건");
  await expect(page.getByLabel("출역 변경 이력")).toContainText(
    "날짜 확인 후 취소",
  );
  const popup = page.waitForEvent("popup");
  await page
    .getByRole("link", { name: "출역 현황 인쇄 / PDF", exact: true })
    .click();
  const printed = await popup;
  await printed.waitForLoadState();
  await expect(
    printed.getByRole("heading", { name: "출역 현황", exact: true }),
  ).toBeVisible();
  await expect(
    printed.getByText(/본인 확인·전자서명·교육\/TBM 이수를 증명하지 않습니다/),
  ).toBeVisible();
  await expect(printed.getByText("광고")).toHaveCount(0);
  await printed.close();
  await page.setViewportSize({ width: 320, height: 800 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  // On a phone the account lives in the 더보기 sheet.
  await page.getByRole("navigation", { name: "하단 메뉴" }).getByRole("button", { name: "더보기", exact: true }).click();
  await page.getByRole("dialog", { name: "더보기 메뉴" }).getByRole("button", { name: "로그아웃", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "로그인", exact: true }),
  ).toBeVisible();
});
