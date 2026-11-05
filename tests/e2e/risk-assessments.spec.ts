import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";

test("independent risk document review and print preparation keep one section each", async ({
  page,
  browser,
}) => {
  await page.goto("/");
  await page.getByLabel("이메일 또는 아이디", { exact: true }).fill("test@example.test");
  await page.getByLabel("비밀번호", { exact: true }).fill("synthetic-e2e-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page.getByRole("heading", { name: "오늘", exact: true })).toBeVisible();
  const session = await (await page.request.get("/api/session")).json();
  const send = async (client: APIRequestContext, csrf: string, path: string, data: object) => {
    const response = await client.post(path, {
      headers: { Origin: "http://127.0.0.1:3107", "x-csrf-token": csrf, "idempotency-key": randomUUID() },
      data,
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  };
  const site = await send(page.request, session.csrf, "/api/sites", { name: "위험평가 합성 현장" });
  const base = `/api/sites/${site.id}`;
  const member = await page.request.put(`${base}/members`, {
    headers: { Origin: "http://127.0.0.1:3107", "x-csrf-token": session.csrf, "idempotency-key": randomUUID() },
    data: { email: "editor@example.test", role: "editor" },
  });
  expect(member.ok(), await member.text()).toBeTruthy();
  const criteria = await send(page.request, session.csrf, `${base}/risk-criteria`, {
    name: "합성 산술 기준 · 현장 안전 판정 아님", method: "product",
    likelihood: ["L1", "L2", "L3", "L4", "L5"], severity: ["S1", "S2", "S3", "S4"],
    rationale: "합성 회귀 검증이며 운영 기준이 아닙니다.",
    bands: [
      { min: 1, max: 5, label: "합성 A", criterionAcceptable: true },
      { min: 6, max: 20, label: "합성 B", criterionAcceptable: false },
    ],
  });
  await send(page.request, session.csrf, `${base}/risk-criteria/${criteria.id}/confirm`, {
    version: criteria.version, reason: "합성 문서 시험", confirmHumanCriteria: true,
  });
  const author = await browser.newContext({ baseURL: "http://127.0.0.1:3107" });
  try {
    const anonymous = await (await author.request.get("/api/session")).json();
    const authorSession = await send(author.request, anonymous.csrf, "/api/login", {
      email: "editor@example.test", password: "synthetic-e2e-password",
    });
    const assessment = await send(author.request, authorSession.csrf, `${base}/risk-assessments`, {
      criteriaId: criteria.id,
      body: {
        title: "합성 위험 문서", date: "2026-10-30", timing: "수시", trigger: "합성 시험", workScope: "합성 구역", method: "product",
        hazards: [{
          id: randomUUID(), task: "합성 작업", location: "합성 구역", category: "수기", accidentType: "수기",
          scenario: "합성 위험 시나리오", harm: "합성 피해", exposedGroup: "합성 작업자", reference: "법정 기준 아님",
          currentControls: "수기 대책", likelihood: 5, severity: 4, judgmentReason: "합성 판단 근거",
          plans: [{ action: "합성 개선 계획", controlType: "관리적", ownerNote: "합성 담당", due: "2026-11-01", priorityNote: "", preconditions: "" }],
        }],
      },
    });
    await send(author.request, authorSession.csrf, `${base}/risk-assessments/${assessment.id}/submit`, {
      version: assessment.version, reason: "문서 검토만 요청", confirmRecordOnly: true,
    });
    await page.reload();
    await page.getByLabel("작업 현장").selectOption(site.id);
    await page.getByRole("button", { name: "위험성평가", exact: true }).click();
    await page.getByRole("button", { name: "합성 위험 문서 열기", exact: true }).click();
    const review = page.getByRole("heading", { name: "문서 기록 처리", exact: true });
    const print = page.getByRole("heading", { name: "고정 원문 출력: HTML / JSON", exact: true });
    await expect(review).toHaveCount(1);
    await expect(print).toHaveCount(1);
    await page.getByRole("button", { name: "현재 조회로 HTML/JSON 준비", exact: true }).click();
    await expect(page.getByRole("link", { name: "준비한 조회의 인쇄용 HTML 열기", exact: true })).toBeVisible();
    await expect(review).toHaveCount(1);
    await expect(print).toHaveCount(1);
    await page.getByRole("button", { name: "현재 저장 상태 다시 조회", exact: true }).click();
    await expect(page.getByRole("button", { name: "현재 조회로 HTML/JSON 준비", exact: true })).toBeEnabled();
    await expect(review).toHaveCount(1);
    await expect(print).toHaveCount(1);
    await page.getByRole("textbox", { name: "문서 처리 사유", exact: true }).fill("다른 관리자 문서 검토 · 안전 허가 아님");
    await page.getByRole("checkbox", { name: "문서 처리이며 안전·이행 완료·작업 재개 허가가 아님을 확인합니다.", exact: true }).check();
    await page.getByRole("button", { name: "문서 기록 수락", exact: true }).click();
    await expect(page.getByRole("heading", { name: "위험성평가 수치형 · 문서 기록 수락 (안전 허가 아님)", exact: true })).toBeVisible();
    await expect(review).toHaveCount(1);
    await expect(print).toHaveCount(1);
  } finally {
    await author.close();
  }
});
