import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
// Prepared source only; browser behavior has not been executed in this environment.
test("own catalog creates a journal with editable copied text and fixed provenance", async ({
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
  const siteName = `카탈로그 합성 현장 ${randomUUID()}`;
  await page.request.post("/api/sites", {
    headers: {
      Origin: "http://127.0.0.1:3107",
      "x-csrf-token": session.csrf,
      "idempotency-key": randomUUID(),
    },
    data: { name: siteName },
  });
  await page.reload();
  await page.getByLabel("작업 현장").selectOption({ label: siteName });
  await page
    .getByRole("button", { name: "교육일지", exact: true })
    .click();
  await page
    .getByRole("button", { name: "자체 교육내용 카탈로그", exact: true })
    .click();
  await page
    .getByRole("button", { name: "자체 내용 초안 작성", exact: true })
    .click();
  await page.getByLabel("내용 제목", { exact: true }).fill("자체 합성 내용");
  await page.getByLabel("자체 분류 표시", { exact: true }).fill("직접 작성");
  await page.getByLabel("교육 목표", { exact: true }).fill("합성 목표");
  await page
    .getByLabel("직접 작성 교육내용", { exact: true })
    .fill("자체 합성 본문");
  await page
    .getByRole("button", { name: "교육내용 초안 저장", exact: true })
    .click();
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "자체 내용 게시", exact: true })
    .click();
  // 교육 B안: a manager records what was checked for this published version (append-only).
  await page.getByText(/^관리 · 검수 기록/).click(); // review and stop are folded
  await expect(page.getByText("검수 기록 없음")).toBeVisible();
  await page.getByLabel("적용대상", { exact: true }).fill("전체 근로자");
  await page.getByLabel("출처", { exact: true }).fill("자체 작성");
  await page.getByLabel("권리 확인자", { exact: true }).fill("김확인");
  await page.getByLabel("권리 확인일", { exact: true }).fill("2026-10-30");
  await page.getByLabel("현행성 확인일", { exact: true }).fill("2026-10-31");
  await page.getByRole("button", { name: "검수 기록 저장", exact: true }).click();
  await expect(page.getByText(/최근 검수: 적용대상 전체 근로자 · 출처 자체 작성/)).toBeVisible();
  await page
    .getByRole("button", {
      name: "이 게시본으로 교육일지 초안 작성",
      exact: true,
    })
    .click();
  await page.getByLabel("일지 날짜", { exact: true }).fill("2026-10-28");
  await page.getByLabel("강사 표시", { exact: true }).fill("합성 담당자");
  await page.getByLabel("장소", { exact: true }).fill("합성 장소");
  // 교육 재설계 A안: read the whole published content, then apply explicitly.
  await expect(page.getByText("적용대상·출처·권리 검수: 전체 근로자 · 자체 작성 · 권리 확인 김확인(2026-10-30) · 현행성 확인 2026-10-31")).toBeVisible();
  await expect(page.getByRole("button", { name: "출처를 결속한 일지 초안 생성", exact: true })).toBeDisabled();
  await page.getByLabel("위 내용 전체를 읽었고 이 판본을 새 교육일지에 적용합니다").check();
  await page
    .getByRole("button", { name: "출처를 결속한 일지 초안 생성", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "고정 게시 출처 · 복사된 내용은 편집 가능",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText(/현재 제목\/과정표시\/목표\/내용은 이 출처와 같습니다/),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "직접 작성 교육내용", exact: true })
    .fill("편집한 합성 본문");
  await expect(
    page.getByText(/현재 작성 내용은 출처에서 수정되었습니다/),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "교육 초안 저장", exact: true })
    .click();
  await page.getByText("원래 게시된 내용 보기", { exact: true }).click();
  await expect(page.getByText("자체 합성 본문", { exact: true })).toBeVisible();
});
