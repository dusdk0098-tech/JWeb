import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
// Source only; actual browser verification remains pending.
test("monthly readonly report selects archive and warns about a newer draft", async ({
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
  const session = await (await page.request.get("/api/session")).json(),
    headers = { Origin: "http://127.0.0.1:3107", "x-csrf-token": session.csrf };
  const post = async (path: string, data: object) =>
    (
      await page.request.post(path, {
        headers: { ...headers, "idempotency-key": randomUUID() },
        data,
      })
    ).json();
  const site = await post("/api/sites", { name: "월간 합성 현장" }),
    base = `/api/sites/${site.id}/daily-journals`;
  let journal = await post(base, {
    date: "2026-02-01",
    body: {
      workSummary: "보관된 월간 요약",
      workLocations: "합성",
      safetyInstructions: "직접 안내",
      observations: "",
      followupNotes: "",
      patrols: [],
    },
  });
  journal = await post(base + "/" + journal.id + "/capture", {
    version: journal.version,
  });
  journal = await post(base + "/" + journal.id + "/archive", {
    version: journal.version,
  });
  await page.reload();
  await page.getByLabel("작업 현장").selectOption({ label: "월간 합성 현장" });
  await page
    .getByRole("button", { name: "안전업무일지", exact: true })
    .click();
  await page
    .getByRole("button", { name: "월간 보관 일지 조회", exact: true })
    .click();
  await page.getByLabel("조회할 달력 월").fill("2026-02");
  await expect(
    page.getByText("보관된 월간 요약", { exact: true }),
  ).toBeVisible();
  const printHref = await page
    .getByRole("link", { name: "현재 조회 기준 월간 인쇄" })
    .getAttribute("href");
  expect((await page.request.get(printHref!)).status()).toBe(200);
  await post(base + "/" + journal.id + "/revise", {
    version: journal.version,
    reason: "새 초안",
    authorId: session.user.id,
  });
  expect((await page.request.get(printHref!)).status()).toBe(409);
  await page.getByRole("button", { name: "월간 자료 다시 조회" }).click();
  await expect(
    page.getByText("더 새로운 정정 초안 대기 — 위 보관본은 이전 버전", {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByLabel("조회할 달력 월").fill("");
  await expect(
    page.getByText("월간 자료 조회 중…", { exact: true }),
  ).toHaveCount(0);
});
