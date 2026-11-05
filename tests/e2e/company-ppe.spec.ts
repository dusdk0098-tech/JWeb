import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
// Browser source only; not executed here. All identities and movements synthetic.
test("company affiliation source and PPE full return update one stock ledger", async ({
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
  async function post(
    path: string,
    data: object,
    method: "post" | "put" = "post",
  ) {
    const r = await page.request[method]("/api" + path, {
      headers: {
        Origin: "http://127.0.0.1:3107",
        "x-csrf-token": session.csrf,
        "idempotency-key": randomUUID(),
      },
      data,
    });
    expect(r.status()).toBe(200);
    return r.json();
  }
  const site = await post("/sites", { name: "보호구 합성 현장" }),
    base = "/sites/" + site.id;
  const company = await post(base + "/companies", { name: "합성 업체" }),
    worker = await post(base + "/workers", {
      name: "합성 명부",
      affiliation: "합성 자유입력",
      kind: "worker",
    });
  await post(
    base + "/workers/" + worker.id + "/company",
    {
      version: 0,
      workerVersion: 1,
      companyId: company.id,
      reason: "합성 연결",
    },
    "put",
  );
  const item = await post(base + "/stock-items", {
    name: "합성 보호구",
    unit: "개",
  });
  await post(base + "/stock-items/" + item.id + "/movements", {
    version: 1,
    kind: "opening",
    quantity: "2",
    effectiveDate: "2026-10-28",
    reason: "합성 기초",
  });
  await page.reload();
  await page
    .getByLabel("작업 현장")
    .selectOption({ label: "보호구 합성 현장" });
  await page
    .getByRole("button", { name: "재고 · 보호구", exact: true })
    .click();
  await page
    .getByRole("button", { name: "보호구 지급·반납", exact: true })
    .click();
  await page
    .getByRole("button", { name: "새 보호구 지급 기록", exact: true })
    .click();
  await page
    .getByLabel("지급할 활성 명부 대상", { exact: true })
    .selectOption(worker.id);
  await page
    .getByRole("group", { name: "지급할 활성 명부 대상", exact: true })
    .getByRole("button", { name: "선택 적용", exact: true })
    .click();
  await expect(page.getByText(/선택 대상: 합성 명부/)).toBeVisible();
  await page
    .getByLabel("출고할 재고 품목", { exact: true })
    .selectOption(item.id);
  await page
    .getByRole("group", { name: "출고할 재고 품목", exact: true })
    .getByRole("button", { name: "선택 적용", exact: true })
    .click();
  await page
    .getByLabel("지급 수량 (양수 소수6자리)", { exact: true })
    .fill("1");
  await page.getByLabel("효력일", { exact: true }).fill("2026-10-28");
  await page.getByLabel("사용/보관 위치", { exact: true }).fill("합성 위치");
  await page.getByLabel("지급 기록 사유", { exact: true }).fill("수기 시험");
  await page.getByRole("checkbox", { name: /수량·단위·재고 감소/ }).check();
  await page
    .getByRole("button", { name: "수기 지급·재고 출고 함께 기록", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: /미반납 또는 일부 반납/ }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "기록 동작", exact: true })
    .selectOption("return");
  await page.getByLabel("사유", { exact: true }).fill("합성 전량 반납");
  await page.getByLabel("반납 효력일", { exact: true }).fill("2026-10-28");
  await page.getByRole("checkbox", { name: /전량 반납과 재고 증가/ }).check();
  await page
    .getByRole("button", { name: "반납·재고 증가 함께 기록", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: /전량 반납 기록됨/ }),
  ).toBeVisible();
  expect(
    (
      await (
        await page.request.get("/api" + base + "/stock-items/" + item.id)
      ).json()
    ).balance,
  ).toBe("2");
});
