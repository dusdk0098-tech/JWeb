import { printTaskSource } from "./inspection-schedule-print.js";
import type { TaskSource } from "./inspection-schedule-model.js";
import { printInspectionLinks } from "./inspection-link-print.js";
import type { InspectionLink } from "./inspection-links.js";
import { escapeHtml as e } from "./print.js";
import type { inspectionRecord } from "./inspection-model.js";
type Printable = { record: ReturnType<typeof inspectionRecord>; links: InspectionLink[]; taskSource: TaskSource | null };
const page = (title: string, main: string) =>
  `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${e(title)}</title><link rel="stylesheet" href="/print.css"></head><body><aside>브라우저 인쇄 / PDF 저장</aside><main>${main}</main></body></html>`;
export function printInspection(
  r: ReturnType<typeof inspectionRecord>,
  links: InspectionLink[] = [],
  taskSource: TaskSource | null = null,
) {
  return page(`${(r.submitted_snapshot?.template || r.template_snapshot).body.title} · 점검 기록`, inspectionArticle(r, links, taskSource));
}
// 일괄 출력: one record per page, each printed exactly as its single print (submitted snapshot first).
export function printInspections(items: Printable[], filter: string) {
  return page(
    "점검 기록 일괄 출력",
    `<p class="form-note">점검 기록 ${items.length}건 · 조건: ${e(filter)} · 작성 중 초안은 넣지 않습니다.</p>` +
      items.map((i) => `<section class="form-page">${inspectionArticle(i.record, i.links, i.taskSource)}</section>`).join(""),
  );
}
function inspectionArticle(r: Printable["record"], links: InspectionLink[], taskSource: TaskSource | null) {
  const s = r.submitted_snapshot,
    t = s?.template || r.template_snapshot,
    b = s?.body || r.body;
  return `<h1>${e(t.body.title)}</h1><p>${e(t.siteName)} · 양식 ${e(t.id)} v${t.version}</p><p>${e(t.body.instructions)}</p><p>기록 ${e(r.id)} · ${e(r.status)} · v${r.version} · 이전 기록 ${e(r.parent_id || "없음")}</p><p>${e(b.date)} · ${e(b.location)} · 점검자 표시(직접 입력): ${e(b.performedBy)}</p><p>제출 계정: ${s ? `${e(s.submitter.name)} (${e(s.submitter.id)}) · ${e(s.submittedAt)}` : "미제출 초안"}</p>${t.body.items
    .map((i) => {
      const a = b.answers.find((a) => a.itemId === i.id);
      return `<article><h2>${e(i.text)}</h2><p>${e(a?.result || "pending")}</p><p>${e(a?.comment || "")}</p></article>`;
    })
    .join(
      "",
    )}${r.review ? `<h2>관리자 기록 검토</h2><p>${e(r.review.actor.name)} (${e(r.review.actor.id)}) · ${e(r.review.at)}</p><p>${e(r.review.reason)}</p><p>후속 초안 ${e(r.review.successorId || "없음")}</p>` : ""}${printInspectionLinks(links)}${printTaskSource(taskSource)}<footer>자체 작성 점검 양식입니다. 법정 서식·안전 인증·위험성평가가 아닙니다. 결과는 계정이 직접 기록한 내용이며 점검자 본인 확인 또는 실제 안전을 보증하지 않습니다. 첨부 미지원.</footer>`;
}
