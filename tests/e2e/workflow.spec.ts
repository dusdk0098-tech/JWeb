import { test, expect } from "@playwright/test";
test("login → site → meeting create/edit/list/print → logout; desktop and mobile", async ({
  page,
}) => {
  const errors: string[] = [];
  const external: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (!r.url().startsWith("http://127.0.0.1:3107")) external.push(r.url());
  });
  await page.goto("/");
  await page.getByLabel("이메일 또는 아이디", { exact: true }).fill("test@example.test");
  await page
    .getByLabel("비밀번호", { exact: true })
    .fill("synthetic-e2e-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "오늘", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("광고 자리")).toHaveCount(0);
  await page.getByRole("button", { name: "현장 관리", exact: true }).click();
  await page.getByLabel("현장 이름", { exact: true }).fill("테스트 현장");
  await page.getByRole("button", { name: "현장 만들기", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "테스트 현장", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "회의록", exact: true }).click();
  await page.getByRole("button", { name: "+ 새 회의록", exact: true }).click();
  await page
    .getByLabel("제목 *", { exact: true })
    .fill("안전보건협의체 정기회의");
  await page.getByLabel("장소 *", { exact: true }).fill("현장 회의실");
  await page
    .getByLabel("참석자 · 소속 · 역할", { exact: true })
    .fill("김담당 / 현장 / 관리자\n이참석 / 협력업체 / 담당");
  await page.getByLabel("안건", { exact: true }).fill("안전 통로 확보");
  await page
    .getByLabel("논의 내용", { exact: true })
    .fill("긴 내용 검증\n".repeat(120));
  await page
    .getByLabel("결정 사항", { exact: true })
    .fill('<script>alert("xss")</script> 문자열도 그대로 기록');
  await page.getByRole("button", { name: "+ 조치 추가", exact: true }).click();
  await page.getByLabel("할 일 *", { exact: true }).fill("통로 재점검");
  await page.getByLabel("담당자 *", { exact: true }).fill("김담당");
  await page.getByRole("button", { name: "초안 저장", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("서버에 저장됨");
  await page
    .getByLabel("제목 *", { exact: true })
    .fill("안전보건협의체 정기회의 수정");
  await page.getByRole("button", { name: "초안 저장", exact: true }).click();
  await expect(page.locator(".ui-tech").first()).toContainText(" · v2");
  const popup = page.waitForEvent("popup");
  await page
    .getByRole("link", { name: "저장본 인쇄 / PDF", exact: true })
    .click();
  const print = await popup;
  await print.waitForLoadState();
  await expect(
    print.getByRole("heading", {
      name: "안전보건협의체 정기회의 수정",
      exact: true,
    }),
  ).toBeVisible();
  await expect(print.getByText("통로 재점검", { exact: true })).toBeVisible();
  await expect(print.locator("script")).toHaveCount(0);
  await expect(print.getByText("광고")).toHaveCount(0);
  await print.emulateMedia({ media: "print" });
  await print.pdf({ path: "test-results/meeting-print.pdf", format: "A4" });
  await print.close();
  await page.getByRole("button", { name: "목록으로", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /안전보건협의체 정기회의 수정/ }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /안전보건협의체 정기회의 수정/ })
    .click();
  await expect(page.getByLabel("제목 *", { exact: true })).toHaveValue(
    "안전보건협의체 정기회의 수정",
  );
  await page.getByLabel("제목 *", { exact: true }).fill("저장하지 않은 변경");
  page.once("dialog", (d) => d.dismiss());
  await page.getByRole("button", { name: "목록으로", exact: true }).click();
  await expect(page.getByLabel("제목 *", { exact: true })).toHaveValue(
    "저장하지 않은 변경",
  );
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "목록으로", exact: true }).click();
  await page.setViewportSize({ width: 320, height: 800 });
  await expect(
    page.getByRole("heading", { name: "회의록", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/mobile-minutes.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "오늘", exact: true }).click();
  await page.screenshot({
    path: "test-results/desktop-home.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "로그인", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "로그인", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});
