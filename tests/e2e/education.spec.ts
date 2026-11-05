import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
// Prepared source only. Browser behavior is not verified in the current environment.
test("own education journal manual minutes and immutable record archive", async ({
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
  const headers = () => ({
    Origin: "http://127.0.0.1:3107",
    "x-csrf-token": session.csrf,
    "idempotency-key": randomUUID(),
  });
  const site = await (
    await page.request.post("/api/sites", {
      headers: headers(),
      data: { name: "교육 합성 현장" },
    })
  ).json();
  const worker = await (
    await page.request.post(`/api/sites/${site.id}/workers`, {
      headers: headers(),
      data: {
        name: "교육 합성 대상",
        affiliation: "테스트 업체",
        kind: "worker",
      },
    })
  ).json();
  await page.reload();
  await page.getByLabel("작업 현장").selectOption({ label: "교육 합성 현장" });
  await page
    .getByRole("button", { name: "교육일지", exact: true })
    .click();
  await page
    .getByRole("button", { name: "+ 교육일지 초안", exact: true })
    .click();
  await page.getByLabel("교육 제목", { exact: true }).fill("자체 교육");
  await page
    .getByLabel("자체 과정/유형 표시", { exact: true })
    .fill("직접 작성");
  await page
    .getByLabel("강사 표시 (직접 입력)", { exact: true })
    .fill("담당자");
  await page.getByLabel("교육 장소", { exact: true }).fill("회의실");
  await page.getByLabel("교육 목표", { exact: true }).fill("자체 목표");
  await page
    .getByLabel("직접 작성 교육내용", { exact: true })
    .fill("복사하지 않은 합성 교육내용");
  await page
    .getByRole("button", { name: "교육 초안 저장", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "명부 후보 (자동 참석 아님)", exact: true })
    .selectOption(worker.id);
  await page
    .getByRole("button", { name: "미입력 대상으로 추가", exact: true })
    .click();
  await page
    .getByRole("button", { name: "이 대상 참여 수정", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "참여 상태", exact: true })
    .selectOption("attended");
  await page.getByLabel("개인 수기 참여시간 (분)", { exact: true }).fill("45");
  page.once("dialog", (d) => d.dismiss());
  await page
    .getByRole("button", { name: "교육일지 목록으로", exact: true })
    .click();
  await expect(
    page.getByLabel("개인 수기 참여시간 (분)", { exact: true }),
  ).toHaveValue("45");
  await page
    .getByRole("button", { name: "참여 기록 저장", exact: true })
    .click();
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "관리자가 기록 확정", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "불변 보관본", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("교육 제목", { exact: true })).toBeDisabled();
  await page.getByLabel("정정 사유", { exact: true }).fill("표시 정정");
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "정정 초안 생성", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "교육일지 · 초안", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/미입력 · 0분/)).toBeVisible();
});
