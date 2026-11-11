import { useState } from "react";
import { api } from "./api";
import { useDraftGuard } from "./useDraftGuard";
import type { CostPeriod, CostSettings } from "./cost-types";
// SC 현장 설정: same fields and order as the original PEDIT-SC settings form.
const empty: CostSettings = {
  writtenDate: "",
  projectName: "",
  contractor: "",
  location: "",
  representative: "",
  client: "",
  projectStart: "",
  projectEnd: "",
  summarySameAsProject: true,
  summaryStart: "",
  summaryEnd: "",
  contractAmountWon: "",
  coverProgress: "",
  cumulativeProgress: "",
  safetyBudgetWon: "",
  author: "",
  reviewer: "",
};
type TextKey = Exclude<keyof CostSettings, "summarySameAsProject">;
const fields: [TextKey, string, string?][] = [
  ["writtenDate", "작성일", "date"],
  ["projectName", "공사명"],
  ["contractor", "건설업체명"],
  ["location", "소재지"],
  ["representative", "대표자"],
  ["client", "발주자"],
  ["projectStart", "공사기간 시작일", "date"],
  ["projectEnd", "공사기간 종료일", "date"],
  ["summaryStart", "내역집계표 공사기간 시작일", "date"],
  ["summaryEnd", "내역집계표 공사기간 종료일", "date"],
  ["contractAmountWon", "공사금액 (원, 정수)", "numeric"],
  ["coverProgress", "표지공정률 (%)", "decimal"],
  ["cumulativeProgress", "누계공정률 (%)", "decimal"],
  ["safetyBudgetWon", "계상안전관리비 (원, 정수)", "numeric"],
  ["author", "작성자"],
  ["reviewer", "작성확인자"],
];
export function CostSettingsForm({
  base,
  period,
  onSaved,
  onClose,
  onDirtyChange,
  onBusyChange,
}: {
  base: string;
  period: CostPeriod;
  onSaved: (next: CostPeriod) => void;
  onClose: () => void;
  onDirtyChange: (v: boolean) => void;
  onBusyChange: (v: boolean) => void;
}) {
  const saved = period.settings ?? empty,
    [form, setForm] = useState<CostSettings>(saved),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    open = period.status === "open",
    dirty = JSON.stringify(form) !== JSON.stringify(saved),
    guard = useDraftGuard(dirty, busy, onDirtyChange, onBusyChange);
  async function save() {
    setBusy(true);
    setError("");
    setNotice("");
    // "동일" 체크 시 숨은 집계표 기간 칸의 옛 값이 검증에 걸리지 않게 공사기간을 그대로 보낸다(서버도 그렇게 저장한다).
    const body = { version: period.version, settings: form.summarySameAsProject ? { ...form, summaryStart: form.projectStart, summaryEnd: form.projectEnd } : form };
    try {
      const next = await api<CostPeriod>(`${base}/settings`, "PUT", body, guard.key(base + "/settings", body));
      setForm(next.settings ?? empty);
      onSaved(next);
      setNotice("저장했습니다.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function refresh() {
    setBusy(true);
    setError("");
    try {
      onSaved(await api<CostPeriod>(base));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <button disabled={busy} onClick={() => guard.canLeave() && onClose()}>
        사용내역으로 돌아가기
      </button>
      <h2>{period.month} 현장 설정</h2>
      <p>
        출력에 반복되는 기본 정보입니다. 마감하면 마감본에 함께 고정되고, 다음 월 이월 때 복사됩니다(작성일은 그 달 말일).
        {!open && " 마감된 원장은 수정할 수 없습니다."}
      </p>
      {error && <div role="alert"><p>{error} 입력을 보존했습니다.</p><button className="secondary" disabled={busy} onClick={() => void refresh()}>입력 유지·최신본 받기</button></div>}
      {notice && <p role="status">{notice}</p>}
      <fieldset disabled={busy || !open}>
        {fields.map(([k, label, kind]) => {
          const summary = k === "summaryStart" || k === "summaryEnd";
          return (
            <div key={k}>
              {k === "summaryStart" && (
                <label>
                  <input
                    type="checkbox"
                    checked={form.summarySameAsProject}
                    onChange={(e) => setForm((v) => ({ ...v, summarySameAsProject: e.target.checked }))}
                  />
                  내역집계표 공사기간을 위 공사기간과 동일하게 사용
                </label>
              )}
            <label>
              {label}
              <input
                type={kind === "date" ? "date" : "text"}
                inputMode={kind === "numeric" || kind === "decimal" ? kind : undefined}
                maxLength={200}
                disabled={summary && form.summarySameAsProject}
                value={summary && form.summarySameAsProject ? form[k === "summaryStart" ? "projectStart" : "projectEnd"] : form[k]}
                onChange={(e) => setForm((v) => ({ ...v, [k]: e.target.value }))}
              />
            </label>
            </div>
          );
        })}
        <button disabled={!dirty} onClick={() => void save()}>
          현장 설정 저장
        </button>
      </fieldset>
    </section>
  );
}
