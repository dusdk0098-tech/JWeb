import { Notice, PageHeader, Section, StatusChip, TechDetails } from "./ui";
import { AiDescriptionSuggest } from "./AiDescriptionSuggest";
import { CostCategoryDetail } from "./CostCategoryDetail";
import { CostSettingsForm } from "./CostSettingsForm";
import { CostOutputControl } from "./CostOutputControl";
import { CostEvidence } from "./CostEvidence";
import type { CostEvidence as EvidenceContext } from "./cost-evidence-types";
import { CostInputPresets } from "./CostInputPresets";
import { CostSelectedExpense, type CostExpenseSelection } from "./CostSelectedExpense";
import { costPresetDraft } from "./cost-preset-draft";
import { CostBaselines } from "./CostBaselines";
import { CostStockPanel } from "./CostStockPanel";
import { CostSplits } from "./CostSplits";
import { CostBatchImport } from "./CostBatchImport";
import { useEffect, useState } from "react";
import { api, type Site } from "./api";
import type { Page } from "./attendance-types";
import { useDraftGuard } from "./useDraftGuard";
import { costWarning, won, type CostPeriod, type CostExpense } from "./cost-types";
import type { CostSearchResult } from "../server/cost-search";
import { laborKinds } from "../server/cost-labor-kinds";
import { costDetailFields } from "../server/cost-detail-fields";
import { CostHistory } from "./CostHistory";
type ExpenseForm = {
  categoryId: string;
  spendDate: string;
  description: string;
  quantity: string;
  unitPriceWon: string;
};
export function CostPeriodEditor({
  site,
  initial,
  initialExpenseSelection,
  onDirtyChange,
  onBusyChange,
  onClose,
  onOpen,
}: {
  site: Site;
  initial: CostPeriod;
  initialExpenseSelection?: CostExpenseSelection;
  onDirtyChange: (v: boolean) => void;
  onBusyChange: (v: boolean) => void;
  onClose: () => void;
  onOpen: (v: CostPeriod) => void;
}) {
  const [record, setRecord] = useState(initial),
    [rows, setRows] = useState<Page<CostExpense>>({
      items: [],
      hasMore: false,
    }),
    [offset, setOffset] = useState(0),
    [tick, setTick] = useState(0),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [form, setForm] = useState<ExpenseForm | null>(null),
    [editing, setEditing] = useState<CostExpense | null>(null),
    [reason, setReason] = useState(""),
    [budget, setBudget] = useState<
      { categoryId: string; plan: string; opening: string }[] | null
    >(null),
    [history, setHistory] = useState(false);
  const [splits, setSplits] = useState<{ expenseId: string | null } | null>(
    null,
  );
  const [presets,setPresets]=useState(false),[presetSource,setPresetSource]=useState<ReturnType<typeof costPresetDraft>|null>(null),[selectedExpense,setSelectedExpense]=useState<CostExpenseSelection|undefined>(initialExpenseSelection);
  const [baselines,setBaselines]=useState(false);
  const [detail,setDetail]=useState(false);
  const [settings,setSettings]=useState(false);
  const [laborKind,setLaborKind]=useState("");
  const [details,setDetails]=useState<Record<string,string>>({});
  const [nextBlank,setNextBlank]=useState<string|null>(null);
  const [preflight,setPreflight]=useState<{items:{level:"error"|"warning";message:string}[];errorCount:number}|null>(null);
  const [evidence,setEvidence]=useState(false);
  const [stockExpense,setStockExpense]=useState<string|null>(null);
  const [batch, setBatch] = useState(false),
    [batchDirty, setBatchDirty] = useState(false),
    [batchBusy, setBatchBusy] = useState(false);
  // A blank "저장하고 다음" form is not unsaved input; it must not block 마감 or leaving.
  const formOpen = !!form && JSON.stringify(form) !== nextBlank;
  const dirty = formOpen || !!budget || !!reason || batchDirty,
    guard = useDraftGuard(
      dirty,
      busy || batchBusy,
      onDirtyChange,
      onBusyChange,
    ),
    base = `/sites/${site.id}/cost-periods/${record.id}`;
  useEffect(() => {
    let active = true;
    if (record.status !== "open") setPreflight(null);
    else api<NonNullable<typeof preflight>>(`${base}/preflight`).then((v) => active && setPreflight(v)).catch(() => active && setPreflight(null));
    return () => {
      active = false;
    };
  }, [base, record.status, record.version, tick]); // tick: 증빙·사진은 원장 버전을 올리지 않으므로 돌아올 때 다시 확인
  useEffect(() => {
    let active = true;
    setLoading(true);
    api<Page<CostExpense>>(`${base}/expenses?offset=${offset}`)
      .then((v) => {
        if (active) setRows(v);
      })
      .catch((e) => {
        if (active) {
          setRows({ items: [], hasMore: false });
          setError(e.message);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [base, offset, tick]);
  async function send(
    path: string,
    body: unknown,
    method = "POST",
    expense = false,
  ) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      let command=body;
      if(path === "/close") {
        const context=await api<EvidenceContext>(base+"/evidence");
        if(context.evidenceVersion>0) {
          const w=context.warnings;
          if(!window.confirm(`미검사 증빙 참조만 고정합니다. 미연결 활성 지출 ${w.activeExpensesWithoutLink.length}개, 연결 뒤 변경 ${w.changedLinks.length}개, 취소행 연결 ${w.cancelledLinks.length}개, 미연결 원본 ${w.unlinkedFiles.length}개입니다. 적격·금액 배분·외부 제출이 아님을 확인하고 이 증빙 버전으로 마감할까요?`)) return;
          command={...(body as object),evidenceReview:{version:context.evidenceVersion,confirmUnverified:true}};
        }
      }
      const sourceExpense=/^\/expenses\/([^/]+)(?:\/(cancel|restore))?$/.exec(path);
      if(expense && sourceExpense && (method==="PUT" || sourceExpense[2])) {
        const context=await api<{activeReceiptId:string|null}>(`${base}/expenses/${sourceExpense[1]}/stock-receipts`);
        if(context.activeReceiptId){
          if(!window.confirm(`연결 입고 ${context.activeReceiptId}의 재고는 바꾸지 않습니다. 비용만 사유에 따라 정정/취소/복원할까요?`)) return;
          command={...(body as object),stockAcknowledgment:{receiptId:context.activeReceiptId,confirmStockUnchanged:true}};
        }
      }
      const next = await api<CostPeriod | { period: CostPeriod }>(
        base + path,
        method,
        command,
        guard.key(base + path, command),
      );
      if (path === "/carry") {
        onOpen(next as CostPeriod);
        return;
      }
      setRecord(
        expense
          ? (next as { period: CostPeriod }).period
          : (next as CostPeriod),
      );
      // PEDIT-SC "저장하고 다음": a new row keeps 항목·일자(and 인건비 구분) for the next entry.
      const added = method === "POST" && path === "/expenses" ? (body as { expense: ExpenseForm }).expense : null;
      const blank = added ? { ...added, description: "", quantity: "1", unitPriceWon: "" } : null;
      setForm(blank);setNextBlank(blank ? JSON.stringify(blank) : null);setPresetSource(null);
      if (added) setDetails({}); // 규격·성명 같은 추가필드는 다음 행으로 넘기지 않는다
      setEditing(null);
      setBudget(null);
      setReason("");
      if (added) requestAnimationFrame(() => document.getElementById("cost-expense-description")?.focus());
      if(expense && "expense" in next){const saved=(next as {expense:CostExpense}).expense;setSelectedExpense({id:saved.id,version:saved.version,status:saved.status});}
      setTick((v) => v + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  // Keeps every input; the next save goes against the latest version.
  async function refresh() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      setRecord(await api<CostPeriod>(base));
      setTick((v) => v + 1);
      if (editing) {
        const row = await api<CostExpense>(`${base}/expenses/${editing.id}`);
        if (row.version !== editing.version) {
          setEditing(row);
          setError(`수정 중인 지출이 다른 곳에서 바뀌었습니다(현재 ${row.description} · ${row.quantity} × ${row.unit_price_won}원). 저장하면 지금 입력으로 덮어씁니다.`);
        }
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function edit(row: CostExpense | null, copy = false) {
    if (!guard.canLeave()) return;
    setBudget(null);
    setReason("");
    setEditing(copy ? null : row);
    setLaborKind(row ? record.laborKinds[row.id] ?? "" : "");
    setDetails(row ? record.details[row.id] ?? {} : {});
    setNextBlank(null);
    setPresetSource(null);
    setForm(
      row
        ? {
            categoryId: row.category_id,
            spendDate: row.spend_date,
            description: row.description,
            quantity: row.quantity,
            unitPriceWon: row.unit_price_won,
          }
        : {
            categoryId: record.categories[0].id,
            spendDate: record.month + "-01",
            description: "",
            quantity: "1",
            unitPriceWon: "",
          },
    );
  }
  const open = record.status === "open";
  // SC 항목 번호가 있는 원장에서는 인건비 구분을 1번 항목에서만 고르게 한다(다른 항목에 붙으면 인건비 조회 합계에 섞인다).
  // 이미 붙어 있는 행은 칸을 보여 주어 지울 수 있게 한다. 서버 계약은 그대로다.
  const laborAllowed = (categoryId: string) => { const code = record.categories.find((c) => c.id === categoryId)?.scCode; return code === undefined || code === 1; };
  // 중복 경고: 이 쪽의 50행을 먼저 보고, 없으면 같은 월 전체를 기존 검색으로 한 번 확인한다(검색이 안 되면 경고 없이 저장).
  async function duplicate() {
    if (!form) return false;
    const same = (r: { status: string; categoryId: string; spendDate: string; description: string; quantity: string; unitPriceWon: string }) =>
      r.status === "active" && r.categoryId === form.categoryId && r.spendDate === form.spendDate && r.description === form.description.trim() && r.quantity === form.quantity && r.unitPriceWon === form.unitPriceWon;
    if (rows.items.some((r) => same({ status: r.status, categoryId: r.category_id, spendDate: r.spend_date, description: r.description, quantity: r.quantity, unitPriceWon: r.unit_price_won }))) return true;
    if (!rows.hasMore && offset === 0) return false;
    const query = new URLSearchParams({ monthFrom: record.month, monthTo: record.month, dateFrom: form.spendDate, dateTo: form.spendDate, status: "active", text: form.description.trim().slice(0, 100) });
    return api<CostSearchResult>(`/sites/${site.id}/cost-expense-search?${query}`).then((found) => found.items.some(same)).catch(() => false);
  }
  if(evidence)return <CostEvidence base={base} onDirtyChange={setBatchDirty} onBusyChange={setBatchBusy} onClose={()=>{
    setEvidence(false); setBusy(true);
    api<CostPeriod>(base).then(v=>{setRecord(v);setTick(t=>t+1);}).catch(e=>setError(e.message)).finally(()=>setBusy(false));
  }}/>;
  if(presets)return <CostInputPresets siteId={site.id} onClose={()=>setPresets(false)} onDirtyChange={setBatchDirty} onBusyChange={setBatchBusy} onApply={open?(preset)=>{if(!confirm(`설명 ${preset.body.defaults.description} / 수량 ${preset.body.defaults.quantity} / 단가 ${preset.body.defaults.unitPriceWon}을 미저장 새 지출에 적용할까요? 지출일과 비용 항목은 비워지며 직접 선택해야 합니다. 원장은 저장하지 않습니다.`))return;const applied=costPresetDraft(preset);setForm(applied.form);setPresetSource(applied);setEditing(null);setReason("");setPresets(false);}:undefined}/>;
  if(settings)return <CostSettingsForm base={base} period={record} onSaved={setRecord} onClose={()=>setSettings(false)} onDirtyChange={setBatchDirty} onBusyChange={setBatchBusy}/>;
  if(detail)return <CostCategoryDetail base={base} period={record} onClose={()=>setDetail(false)}/>;
  if(baselines)return <section><button disabled={batchDirty||batchBusy} onClick={()=>setBaselines(false)}>사용내역으로 돌아가기</button><CostBaselines key={record.id} base={base} period={record} onDirtyChange={setBatchDirty} onBusyChange={setBatchBusy}/></section>;
  if(stockExpense)return <CostStockPanel key={`${site.id}:${record.id}:${stockExpense}`} site={site} periodId={record.id} expenseId={stockExpense} onDirtyChange={setBatchDirty} onBusyChange={setBatchBusy} onClose={()=>{setStockExpense(null);setTick(v=>v+1);}}/>;
  if (splits)
    return (
      <CostSplits
        site={site}
        initial={record}
        expenseId={splits.expenseId}
        onDirtyChange={setBatchDirty}
        onBusyChange={setBatchBusy}
        onClose={() => setSplits(null)}
        onSaved={(next) => {
          setRecord(next);
          setTick((t) => t + 1);
        }}
      />
    );
  if (batch)
    return (
      <CostBatchImport
        site={site}
        initial={record}
        onDirtyChange={setBatchDirty}
        onBusyChange={setBatchBusy}
        onClose={() => setBatch(false)}
        onSaved={(next) => {
          setRecord(next);
          setTick((t) => t + 1);
        }}
      />
    );
  return (
    <section className="panel cost-editor">
      <PageHeader
        back="사용내역 목록"
        backDisabled={busy}
        onBack={() => {
          if (guard.canLeave()) onClose();
        }}
        title={`${record.month} 산업안전보건관리비 · ${open ? "작성 중" : "마감"}`}
        status={open ? <StatusChip tone="draft">작성 중</StatusChip> : <StatusChip tone="done">마감</StatusChip>}
      >
        <a className="button" href={"/api" + base + "/legal-forms/print"} target="_blank" rel="noreferrer">사용내역서 인쇄 (표지·집계표·사용내역서·총괄)</a>
      </PageHeader>
      <Notice summary="직접 입력하는 기록입니다. 금액은 반올림하지 않습니다.">{costWarning}</Notice>
      {selectedExpense&&<CostSelectedExpense key={`${record.id}:${selectedExpense.id}`} base={base} selection={selectedExpense}/>}
      {error && (
        <div role="alert">
          <p>{error} 입력을 보존했습니다. 다른 곳의 변경과 충돌했다면 아래 버튼으로 최신본을 받은 뒤 다시 저장하세요.</p>
          <button className="secondary" disabled={busy} onClick={() => void refresh()}>입력 유지·최신본 받기</button>
        </div>
      )}
      <div className="tool-row" role="group" aria-label="월 도구">
      <button className="secondary" disabled={busy} onClick={() => { if(guard.canLeave()) {setForm(null);setBudget(null);setReason("");setEvidence(true);} }}>미검사 원본·동일 월 지출 연결</button>
      <button className="secondary" disabled={busy} onClick={()=>{if(guard.canLeave()){setForm(null);setPresetSource(null);setEditing(null);setBudget(null);setReason("");setSettings(true);}}}>현장 설정</button>
      </div>
      <details className="ui-tech advanced-tools">
        <summary>고급 도구 · 프리셋 · 기준본 · 분할 이력 · TSV 일괄 · 항목별 상세 · 변경 이력</summary>
        <div className="tool-row">
      <button className="secondary" disabled={busy} onClick={()=>{if(guard.canLeave()){setForm(null);setPresetSource(null);setEditing(null);setBudget(null);setReason("");setPresets(true);}}}>반복 입력 프리셋 관리 / 새 지출 적용</button>
      <button className="secondary" disabled={busy} onClick={()=>{if(guard.canLeave()){setForm(null);setPresetSource(null);setEditing(null);setBudget(null);setReason("");setBaselines(true);}}}>고정 기준본 · 제출 진술 · 현재 비교</button>
      <button
        className="secondary"
        disabled={busy}
        onClick={() => {
          if (guard.canLeave()) {
            setForm(null);setPresetSource(null);
            setEditing(null);
            setBudget(null);
            setReason("");
            setSplits({ expenseId: null });
          }
        }}
      >
        분할 이력 · 되돌리기
      </button>
      {open && (
        <button
          className="secondary"
          disabled={busy}
          onClick={() => {
            if (guard.canLeave()) {
              setForm(null);setPresetSource(null);
              setEditing(null);
              setBudget(null);
              setReason("");
              setBatch(true);
            }
          }}
        >
          TSV 지출 일괄 입력
        </button>
      )}
      <button className="secondary" disabled={busy} onClick={()=>{if(guard.canLeave()){setForm(null);setPresetSource(null);setEditing(null);setBudget(null);setReason("");setDetail(true);}}}>항목별 상세</button>
      <button className="secondary" disabled={busy} onClick={() => setHistory((v) => !v)}>
        변경 이력 · 과거 마감본
      </button>
        </div>
      </details>
      {history && <CostHistory base={base} tick={tick} disabled={dirty||busy||batchBusy} />}
      <Section no={1} level={3} title="항목별 합계">
      <p className="muted">초기/이월 근거: {record.opening_note}</p>
      <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>항목</th>
            <th>계획</th>
            <th>이월 누계</th>
            <th>이번 월</th>
            <th>누계</th>
            <th>계획 잔액</th>
          </tr>
        </thead>
        <tbody>
          {record.totals.byCategory.map((c) => (
            <tr key={c.id}>
              <th>{c.label}</th>
              <td>{won(c.plan)}</td>
              <td>{won(c.opening)}</td>
              <td>{won(c.current)}</td>
              <td>{won(c.cumulative)}</td>
              <td>
                {won(c.remaining)}
                {c.overPlan ? " (계획 초과)" : ""}
              </td>
            </tr>
          ))}
          <tr>
            <th>합계</th>
            {(
              ["plan", "opening", "current", "cumulative", "remaining"] as const
            ).map((k) => (
              <td key={k}>{won(record.totals.total[k])}</td>
            ))}
          </tr>
        </tbody>
      </table>
      </div>
      <p className="muted">
        반올림 없는 원 단위 표시 · 유효 {record.totals.activeCount}행 / 취소{" "}
        {record.totals.cancelledCount}행
      </p>
      </Section>
      <Section no={2} level={3} title="출력">
      <p className="muted">사용내역서 인쇄는 원본 엑셀 양식의 순서·값을 HTML로 재현합니다. 저장하지 않은 입력은 반영되지 않습니다.</p>
      <CostOutputControl key={`${base}:${record.version}:${dirty}:${busy}`} base={base} disabled={dirty||busy||batchBusy} />
      {preflight && (
        <details open={preflight.errorCount > 0}>
          <summary>
            출력 전 확인 · 오류 {preflight.errorCount}건, 확인 {preflight.items.length - preflight.errorCount}건
          </summary>
          {preflight.items.length ? (
            <ul>
              {preflight.items.map((i, n) => (
                <li key={n}>{i.level === "error" ? "오류" : "확인"} · {i.message}</li>
              ))}
            </ul>
          ) : (
            <p>출력 준비 완료</p>
          )}
        </details>
      )}
      </Section>
      <Section no={3} level={3} title={open ? "마감" : "재개 · 이월"}>
      <fieldset disabled={busy}>
        <label>
          변경 / 마감 / 재개 사유
          <textarea
            maxLength={1000}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        {open ? (
          <>
            <button
              disabled={formOpen || !!budget || !reason.trim() || !!preflight?.errorCount}
              title={preflight?.errorCount ? `출력 전 확인 오류 ${preflight.errorCount}건을 해결해야 마감할 수 있습니다.` : undefined}
              onClick={() => {
                if (
                  window.confirm(
                    "기록을 마감하여 잠글까요? 법정 인정이나 결재가 아닙니다.",
                  )
                )
                  void send("/close", { version: record.version, reason });
              }}
            >
              기록 마감
            </button>
            <button
              onClick={() => {
                if (guard.canLeave()) {
                  setForm(null);setPresetSource(null);
                  setEditing(null);
                  setReason("");
                  setBudget(
                    record.categories.map((c) => ({
                      categoryId: c.id,
                      plan: c.plan,
                      opening: c.opening,
                    })),
                  );
                }
              }}
            >
              계획 / 초기 누계 수정
            </button>
          </>
        ) : (
          <>
            <button
              disabled={!!record.successor || !reason.trim()}
              onClick={() =>
                void send("/reopen", { version: record.version, reason })
              }
            >
              마감 재개
            </button>
            {record.successor ? (
              <p>
                다음 월 {record.successor.month}이 이미 만들어져 재개할 수
                없습니다. 다음 월 변경 전파 기능은 미구현입니다. 현재 기록을
                임의 삭제하지 말고 관리자에게 별도 정정 절차를 요청하세요.
              </p>
            ) : (
              <button
                disabled={!!reason}
                onClick={() => {
                  if (
                    window.confirm(
                      "이 마감본의 항목별 누계를 그대로 다음 월 초기 누계로 복사할까요? 생성 후 원본 재개는 차단됩니다.",
                    )
                  )
                    void send("/carry", { version: record.version });
                }}
              >
                다음 월 이월 생성
              </button>
            )}
            <p className="muted">
              이월에는 사유 입력을 사용하지 않습니다. 입력 중인 사유를 비운 뒤
              실행하세요.
            </p>
          </>
        )}
      </fieldset>
      </Section>
      {budget && (
        <fieldset disabled={busy}>
          <legend>항목 구성 고정 · 금액만 수정</legend>
          {budget.map((b, i) => (
            <div key={b.categoryId}>
              <strong>{record.categories[i].label}</strong>
              <label>
                계획
                <input
                  inputMode="decimal"
                  value={b.plan}
                  onChange={(e) =>
                    setBudget((v) =>
                      v!.map((x, j) =>
                        i === j ? { ...x, plan: e.target.value } : x,
                      ),
                    )
                  }
                />
              </label>
              {!record.parent_period_id && (
                <label>
                  초기 누계
                  <input
                    inputMode="decimal"
                    value={b.opening}
                    onChange={(e) =>
                      setBudget((v) =>
                        v!.map((x, j) =>
                          i === j ? { ...x, opening: e.target.value } : x,
                        ),
                      )
                    }
                  />
                </label>
              )}
            </div>
          ))}
          <button
            disabled={!reason.trim()}
            onClick={() =>
              void send(
                "/budget",
                {
                  version: record.version,
                  reason,
                  plans: budget.map(({ categoryId, plan }) => ({
                    categoryId,
                    plan,
                  })),
                  ...(!record.parent_period_id
                    ? {
                        openings: budget.map(({ categoryId, opening }) => ({
                          categoryId,
                          opening,
                        })),
                      }
                    : {}),
                },
                "PUT",
              )
            }
          >
            금액 변경 저장
          </button>
          <button
            onClick={() => {
              if (guard.canLeave()) {
                setBudget(null);
                setReason("");
              }
            }}
          >
            취소
          </button>
        </fieldset>
      )}
      <Section no={4} level={3} title={`지출 · 유효 ${record.totals.activeCount}행`} aside={open && (
        <button disabled={busy} onClick={() => edit(null)}>
          지출 행 추가
        </button>
      )}>
      {form && (
        <fieldset disabled={busy}>
          <legend>{editing ? "지출 수정" : "지출 추가"}</legend>
          {presetSource&&!editing&&<aside className="notice"><p>미저장 프리셋 {presetSource.name}</p><p>적용 기본값: {presetSource.defaults.description} / 수량 {presetSource.defaults.quantity} / 단가 {presetSource.defaults.unitPriceWon}. 아래 값은 직접 편집할 수 있습니다. 날짜와 비용 항목을 직접 선택하세요. 개정/중지되면 저장이 거부되고 입력은 유지됩니다.</p><button onClick={()=>{if(confirm("현재 입력은 유지하고 프리셋 출처를 해제해 수동 입력으로 계속할까요?"))setPresetSource(null);}}>출처 해제 · 수동 입력으로 계속</button></aside>}
          <label>
            항목
            <select
              required
              value={form.categoryId}
              onChange={(e) => {
                setForm({ ...form, categoryId: e.target.value });
                setDetails({});
                if (!laborAllowed(e.target.value)) setLaborKind("");
              }}
            >
              <option value="">비용 항목을 직접 선택하세요</option>
              {record.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            실제 지출일
            <input
              type="date"
              required
              value={form.spendDate}
              onChange={(e) => setForm({ ...form, spendDate: e.target.value })}
            />
          </label>
          {form.spendDate && form.spendDate < record.month + "-01" && (
            <p>
              이전 월 지출을 현재 귀속 월에 수기로 기록합니다. 중복 입력 여부를
              확인하세요.
            </p>
          )}
          <label>
            내용
            <input
              id="cost-expense-description"
              maxLength={500}
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
            />
          </label>
          <AiDescriptionSuggest siteId={site.id} text={form.description} onApply={(v) => setForm({ ...form, description: v })} />
          <label>
            수량 (양수, 소수 6자리까지)
            <input
              inputMode="decimal"
              value={form.quantity}
              onChange={(e) => setForm({ ...form, quantity: e.target.value })}
            />
          </label>
          <label>
            단가 (양수 원 단위 정수)
            <input
              inputMode="numeric"
              value={form.unitPriceWon}
              onChange={(e) =>
                setForm({ ...form, unitPriceWon: e.target.value })
              }
            />
          </label>
          {(costDetailFields[record.categories.find((c) => c.id === form.categoryId)?.scCode ?? 0] ?? []).map((f) => (
            <label key={f.key}>
              {f.label}
              {f.required && " *"}
              {f.type === "select" ? (
                <select value={details[f.key] ?? ""} onChange={(e) => setDetails({ ...details, [f.key]: e.target.value })}>
                  <option value="">선택</option>
                  {f.options!.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              ) : (
                <input
                  type={f.type === "date" ? "date" : "text"}
                  inputMode={f.type === "number" ? "numeric" : undefined}
                  maxLength={200}
                  value={details[f.key] ?? ""}
                  onChange={(e) => setDetails({ ...details, [f.key]: e.target.value })}
                />
              )}
            </label>
          ))}
          {(laborAllowed(form.categoryId) || laborKind) && (
          <label>
            인건비 구분 (인건비 항목일 때)
            <select value={laborKind} onChange={(e) => setLaborKind(e.target.value)}>
              <option value="">없음</option>
              {laborKinds.map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </label>
          )}
          <p>
            신규 행은 변경 사유를 사용하지 않습니다. 위 사유를 비운 뒤
            저장하세요. 행 금액은 서버가 정확히 계산합니다. 쉼표, 지수, 음수,
            소수 단가는 거부합니다.
          </p>
          <button
            disabled={!form.categoryId || !form.spendDate || (editing ? !reason.trim() : !!reason)}
            onClick={async () =>
              (editing || !(await duplicate()) ||
                window.confirm("같은 항목·일자·내용·수량·단가의 지출이 이미 있습니다. 그래도 저장할까요?")) &&
              void send(
                "/expenses" + (editing ? "/" + editing.id : ""),
                {
                  version: record.version,
                  ...(editing ? { reason } : {}),
                  expense: form,
                  laborKind: laborKind || null,
                  details,
                  ...(!editing && presetSource ? {presetSource:presetSource.source} : {}),
                },
                editing ? "PUT" : "POST",
                true,
              )
            }
          >
            저장
          </button>
          <button
            onClick={() => {
              if (guard.canLeave()) {
                setForm(null);setPresetSource(null);
                setEditing(null);
                setReason("");
              }
            }}
          >
            취소
          </button>
        </fieldset>
      )}
      {loading ? (
        <p>지출 조회 중</p>
      ) : (
        rows.items.map((row) => (
          <article key={row.id} className="expense-row" data-status={row.status}>
            <h4>{row.description}</h4>
            <p>
              {row.spend_date} · {won(row.quantity)} × {won(row.unit_price_won)}원 ={" "}
              {won(row.amount)}원 ·{" "}
              {row.status === "active" ? "유효" : "취소 (합계 제외)"}
              {record.laborKinds[row.id] && ` · 인건비 ${record.laborKinds[row.id]}`}
            </p>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => {
                if (guard.canLeave()) {
                  setForm(null);setPresetSource(null);
                  setEditing(null);
                  setBudget(null);
                  setReason("");
                  setSplits({ expenseId: row.id });
                }
              }}
            >
              이 지출 분할 검토 / 출처
            </button>
            <button className="secondary" disabled={busy} onClick={()=>setSelectedExpense({id:row.id,version:row.version,status:row.status})}>이 지출 현재 값 / 최초 프리셋 출처</button>
            <button className="secondary" disabled={busy} onClick={()=>{if(guard.canLeave()){setForm(null);setPresetSource(null);setBudget(null);setReason("");setStockExpense(row.id);}}}>비용 출처 입고 / 연결 이력</button>
            {open && (
              <>
                <button
                  className="secondary"
                  disabled={busy || row.status !== "active"}
                  onClick={() => edit(row)}
                >
                  수정
                </button>
                <button className="secondary" disabled={busy} onClick={() => edit(row, true)}>
                  복사 입력
                </button>
                <button
                  className="secondary"
                  disabled={busy || formOpen || !!budget || !reason.trim()}
                  onClick={() =>
                    void send(
                      `/expenses/${row.id}/${row.status === "active" ? "cancel" : "restore"}`,
                      { version: record.version, reason },
                      "POST",
                      true,
                    )
                  }
                >
                  {row.status === "active" ? "사유로 취소" : "사유로 복원"}
                </button>
              </>
            )}
          </article>
        ))
      )}
      <div className="actions">
      <button
        className="secondary"
        disabled={busy || loading || offset === 0}
        onClick={() => setOffset((v) => v - 50)}
      >
        이전 50행
      </button>
      <button
        className="secondary"
        disabled={busy || loading || !rows.hasMore}
        onClick={() => setOffset((v) => v + 50)}
      >
        다음 50행
      </button>
      </div>
      </Section>
      <TechDetails>
        <p>원장 {record.id} · v{record.version}{record.source_close_id ? ` · 이월 기준 마감본 ID ${record.source_close_id}` : ""}</p>
      </TechDetails>
    </section>
  );
}
