import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
// Source only: browser execution remains pending.
test("explicit scheduled start opens pending inspection and shows immutable schedule source", async ({
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
  const headers = {
    Origin: "http://127.0.0.1:3107",
    "x-csrf-token": session.csrf,
  };
  const post = async (path: string, data: object) =>
    (
      await page.request.post(path, {
        headers: { ...headers, "idempotency-key": randomUUID() },
        data,
      })
    ).json();
  const site = await post("/api/sites", { name: "일정 합성 현장" }),
    base = `/api/sites/${site.id}`;
  let template = await post(base + "/inspection-templates", {
    title: "일정 자체 양식",
    instructions: "합성",
    items: ["직접 확인"],
  });
  template = await post(
    base + "/inspection-templates/" + template.id + "/publish",
    { version: template.version },
  );
  await page.reload();
  await page.getByLabel("작업 현장").selectOption({ label: "일정 합성 현장" });
  await page
    .getByRole("button", { name: "점검", exact: true })
    .click();
  await page
    .getByRole("button", { name: "점검 일정 / 배정 · 내 일정 업무", exact: true })
    .click();
  await page.getByRole("button", { name: "새 점검 일정", exact: true }).click();
  await page.getByLabel("고정할 게시 양식").selectOption(template.id);
  await page.getByLabel("계획 장소").fill("합성구역");
  await page.getByLabel("일정 담당 계정").selectOption(session.user.id);
  page.once("dialog", (d) => d.dismiss());
  await page
    .getByRole("button", { name: "일정 목록으로", exact: true })
    .click();
  await expect(page.getByLabel("계획 장소")).toHaveValue("합성구역");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "일정 저장", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "배정 계정으로 점검 시작" }),
  ).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "배정 계정으로 점검 시작" }).click();
  await expect(
    page.getByRole("heading", { name: "시작 당시 일정 출처", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "일정 자체 양식 · 초안", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "결과", exact: true }),
  ).toHaveValue("pending");
  const source = page.getByRole("complementary").filter({
    has: page.getByRole("heading", {
      name: "시작 당시 일정 출처",
      exact: true,
    }),
  });
  await expect(source).toContainText("합성구역");
  await expect(source).toContainText(`당시 배정 ${session.user.name} (${session.user.id})`);
  await expect(
    page.getByRole("heading", { name: "점검 변경 기록", exact: true }),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "최신본 다시 열기", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "점검 변경 기록", exact: true }),
  ).toHaveCount(1);
});
