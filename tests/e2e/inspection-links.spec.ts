import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
// Source prepared only; not executed in restricted browser environment.
test("accepted failure creates one draft and opens immutable provenance", async ({
  page,
  browser,
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
  const headers = () => ({
    Origin: "http://127.0.0.1:3107",
    "x-csrf-token": session.csrf,
    "idempotency-key": randomUUID(),
  });
  const site = await (
    await page.request.post("/api/sites", {
      headers: headers(),
      data: { name: "연결 합성 현장" },
    })
  ).json();
  const base = `/api/sites/${site.id}`;
  await page.request.put(base + "/members", {
    headers: headers(),
    data: { email: "editor@example.test", role: "editor" },
  });
  let t = await (
    await page.request.post(base + "/inspection-templates", {
      headers: headers(),
      data: { title: "연결 양식", instructions: "자체", items: ["통로 확보"] },
    })
  ).json();
  t = await (
    await page.request.post(
      base + "/inspection-templates/" + t.id + "/publish",
      { headers: headers(), data: { version: t.version } },
    )
  ).json();
  const ctx = await browser.newContext({ baseURL: "http://127.0.0.1:3107" });
  try {
    const staff = await ctx.newPage();
    await staff.goto("/");
    await staff
      .getByLabel("이메일 또는 아이디", { exact: true })
      .fill("editor@example.test");
    await staff
      .getByLabel("비밀번호", { exact: true })
      .fill("synthetic-e2e-password");
    await staff.getByRole("button", { name: "로그인", exact: true }).click();
    await expect(
      staff.getByRole("heading", { name: "오늘", exact: true }),
    ).toBeVisible();
    const es = await (await staff.request.get("/api/session")).json(),
      eh = () => ({
        Origin: "http://127.0.0.1:3107",
        "x-csrf-token": es.csrf,
        "idempotency-key": randomUUID(),
      });
    let r = await (
      await staff.request.post(base + "/inspections", {
        headers: eh(),
        data: {
          templateId: t.id,
          body: {
            date: "2026-10-28",
            location: "통로",
            performedBy: "수기 담당자",
            answers: [
              {
                itemId: t.body.items[0].id,
                result: "fail",
                comment: "적치물 정리 필요",
              },
            ],
          },
        },
      })
    ).json();
    r = await (
      await staff.request.post(base + "/inspections/" + r.id + "/submit", {
        headers: eh(),
        data: { version: r.version },
      })
    ).json();
    await page.request.post(base + "/inspections/" + r.id + "/accept", {
      headers: headers(),
      data: { version: r.version, reason: "기록 검토" },
    });
  } finally {
    await ctx.close();
  }
  await page.reload();
  await page.getByLabel("작업 현장").selectOption({ label: "연결 합성 현장" });
  await page
    .getByRole("button", { name: "점검", exact: true })
    .click();
  await page.getByRole("button", { name: "점검 열기", exact: true }).click();
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", {
      name: "이 부적합으로 신고 초안 만들기",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", { name: "연결 신고 열기", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "이 부적합으로 신고 초안 만들기",
      exact: true,
    }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "연결 신고 열기", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "불변 점검 출처", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("신고 제목 *", { exact: true })).toHaveValue(
    "점검 부적합: 연결 양식",
  );
  await page
    .getByRole("button", { name: "원 점검으로 돌아가기", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "연결 신고 열기", exact: true }),
  ).toBeVisible();
});
