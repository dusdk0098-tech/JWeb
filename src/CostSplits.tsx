import { useEffect, useState } from "react";
import { api, type Site } from "./api";
import type { CostPeriod, CostExpense } from "./cost-types";
import type { splitView } from "../server/cost-split-model";
import { useDraftGuard } from "./useDraftGuard";
type Detail = ReturnType<typeof splitView> & {
  eligibility: { allowed: boolean; reason: string };
  period: CostPeriod;
};
type Info = {
  expense: CostExpense;
  childOf: string | null;
  activeSplitId: string | null;
  canSplit: boolean;
  stockReceiptId?: string;
  period: CostPeriod;
};
type Child = { description: string; quantity: string; unitPriceWon: string };
type List = {
  items: {
    id: string;
    status: string;
    source_expense_id: string;
    created_at: string;
  }[];
  hasMore: boolean;
};
export function CostSplits({
  site,
  initial,
  expenseId,
  onDirtyChange,
  onBusyChange,
  onClose,
  onSaved,
}: {
  site: Site;
  initial: CostPeriod;
  expenseId: string | null;
  onDirtyChange: (v: boolean) => void;
  onBusyChange: (v: boolean) => void;
  onClose: () => void;
  onSaved: (p: CostPeriod) => void;
}) {
  const [period, setPeriod] = useState(initial),
    [info, setInfo] = useState<Info | null>(null),
    [detail, setDetail] = useState<Detail | null>(null),
    [children, setChildren] = useState<Child[]>([]),
    [baseline, setBaseline] = useState("[]"),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [listLoading, setListLoading] = useState(false),
    [sourceLoading, setSourceLoading] = useState(false),
    [error, setError] = useState(""),
    [page, setPage] = useState<List>({ items: [], hasMore: false }),
    [offset, setOffset] = useState(0),
    [tick, setTick] = useState(0);
  const working = busy || listLoading || sourceLoading;
  const dirty = !!reason || JSON.stringify(children) !== baseline,
    guard = useDraftGuard(dirty, working, onDirtyChange, onBusyChange),
    base = `/sites/${site.id}/cost-periods/${period.id}`;
  useEffect(() => {
    let active = true;
    setListLoading(true);
    setError("");
    api<List>(base + "/splits?offset=" + offset)
      .then((v) => {
        if (active) setPage(v);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setListLoading(false);
      });
    return () => {
      active = false;
    };
  }, [base, offset, tick]);
  useEffect(() => {
    if (!expenseId) return;
    let active = true;
    setSourceLoading(true);
    api<Info>(base + "/expenses/" + expenseId + "/split-info")
      .then((v) => {
        if (!active) return;
        setInfo(v);
        setPeriod(v.period);
        const rows = [0, 1].map(() => ({
          description: "",
          quantity: "",
          unitPriceWon: v.expense.unit_price_won,
        }));
        setChildren(rows);
        setBaseline(JSON.stringify(rows));
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setSourceLoading(false);
      });
    return () => {
      active = false;
    };
  }, [base, expenseId]);
  function reset() {
    setReason("");
    setChildren([]);
    setBaseline("[]");
    setInfo(null);
  }
  async function open(id: string) {
    if (!guard.canLeave()) return;
    setBusy(true);
    setError("");
    try {
      const v = await api<Detail>(base + "/splits/" + id);
      reset();
      setDetail(v);
      setPeriod(v.period);
      onSaved(v.period);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function source(id: string) {
    if (!guard.canLeave()) return;
    setBusy(true);
    setError("");
    try {
      const v = await api<Info>(base + "/expenses/" + id + "/split-info");
      setInfo(v);
      setDetail(null);
      setPeriod(v.period);
      onSaved(v.period);
      setReason("");
      const rows = [0, 1].map(() => ({
        description: "",
        quantity: "",
        unitPriceWon: v.expense.unit_price_won,
      }));
      setChildren(rows);
      setBaseline(JSON.stringify(rows));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function submit(undo = false) {
    if (working) return;
    const path = undo
        ? base + "/splits/" + detail!.id + "/undo"
        : base + "/expenses/" + info!.expense.id + "/split",
      body = undo
        ? { version: period.version, reason }
        : { version: period.version, reason, children };
    if (
      !window.confirm(
        undo
          ? "자식행을 취소하고 원행을 복원할까요? 새 지출행은 만들지 않습니다."
          : "원행을 취소하고 정확한 수량/금액의 자식행을 만들까요? 재고 연동이 아닙니다.",
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      const next = await api<Detail>(path, "POST", body, guard.key(path, body));
      reset();
      setDetail(next);
      setPeriod(next.period);
      onSaved(next.period);
      setTick((t) => t + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <button
        disabled={working}
        onClick={() => {
          if (guard.canLeave()) {
            onSaved(period);
            onClose();
          }
        }}
      >
        사용내역으로
      </button>
      <h2>
        수량·금액 보존 분할 · {period.month} v{period.version}
      </h2>
      <p>
        단위 없는 입력 수량과 금액만 정확히 보존합니다. 실제 재고/단위 변환이
        아닙니다. 자식은 원행의 항목·날짜를 유지하며 중첩 분할하지 않습니다.
        기존 분할과 되돌리기 이력은 삭제하지 않습니다.
      </p>
      {working && <p role="status">분할 기록 처리 중…</p>}
      {error && (
        <p role="alert">
          {error} 입력을 유지했습니다. 충돌이면 입력을 별도로 보관하고 최신
          분할/원장 상태를 다시 확인하세요.
        </p>
      )}
      {expenseId && (
        <button disabled={working} onClick={() => void source(expenseId)}>
          선택 원행 상태 다시 조회
        </button>
      )}
      {info && (
        <>
          <h3>선택 원행: {info.expense.description}</h3>
          <p>
            {info.expense.quantity} × {info.expense.unit_price_won} ={" "}
            {info.expense.amount}원 · 항목 {period.categories.find((c) => c.id === info.expense.category_id)?.label ?? info.expense.category_id} · 날짜{" "}
            {info.expense.spend_date}
          </p>
          {info.stockReceiptId && <p>활성 연결 입고 {info.stockReceiptId} 때문에 분할할 수 없습니다. 비용행의 연결 입고 화면에서 실제 기록을 확인하세요. 비용/재고를 자동 상쇄하지 않습니다.</p>}
          {!info.canSplit && (
            <p>
              지금 새 분할 불가: 유효 원행/작성 중 원장이어야 하고, 모든 분할
              자식은 재분할할 수 없습니다.
            </p>
          )}
          {(info.childOf || info.activeSplitId) && (
            <button
              disabled={working}
              onClick={() => void open((info.childOf || info.activeSplitId)!)}
            >
              연결된 분할 이력 열기
            </button>
          )}
          {info.canSplit && (
            <fieldset disabled={working}>
              <legend>2~20개 자식 · 수량합/금액합 모두 일치 필수</legend>
              {children.map((c, i) => (
                <div key={i}>
                  <label>
                    자식 {i + 1} 설명
                    <input
                      maxLength={500}
                      value={c.description}
                      onChange={(e) =>
                        setChildren((v) =>
                          v.map((r, j) =>
                            j === i ? { ...r, description: e.target.value } : r,
                          ),
                        )
                      }
                    />
                  </label>
                  <label>
                    자식 {i + 1} 수량
                    <input
                      inputMode="decimal"
                      value={c.quantity}
                      onChange={(e) =>
                        setChildren((v) =>
                          v.map((r, j) =>
                            j === i ? { ...r, quantity: e.target.value } : r,
                          ),
                        )
                      }
                    />
                  </label>
                  <label>
                    자식 {i + 1} 양수 정수 단가
                    <input
                      inputMode="numeric"
                      value={c.unitPriceWon}
                      onChange={(e) =>
                        setChildren((v) =>
                          v.map((r, j) =>
                            j === i
                              ? { ...r, unitPriceWon: e.target.value }
                              : r,
                          ),
                        )
                      }
                    />
                  </label>
                  <button
                    disabled={children.length <= 2}
                    onClick={() => {
                      if (window.confirm("이 자식 입력을 제거할까요?"))
                        setChildren((v) => v.filter((_, j) => j !== i));
                    }}
                  >
                    이 자식 입력 제거
                  </button>
                </div>
              ))}
              <button
                disabled={children.length >= 20}
                onClick={() =>
                  setChildren((v) => [
                    ...v,
                    {
                      description: "",
                      quantity: "",
                      unitPriceWon: info.expense.unit_price_won,
                    },
                  ])
                }
              >
                자식 입력 추가
              </button>
              <label>
                분할 사유
                <textarea
                  maxLength={1000}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <button disabled={!reason.trim()} onClick={() => void submit()}>
                수량·금액 검증 후 분할 저장
              </button>
            </fieldset>
          )}
        </>
      )}
      {detail && (
        <article>
          <h3>고정 분할 기록 {detail.id}</h3>
          <p>
            상태:{" "}
            {detail.status === "active" ? "분할 적용" : "되돌림 기록 있음"} ·
            원행 {detail.snapshot.source.id}
          </p>
          <p>
            당시 원행 {detail.snapshot.source.quantity} ×{" "}
            {detail.snapshot.source.unit_price_won} ={" "}
            {detail.snapshot.source.amount}원
          </p>
          {detail.snapshot.children.map((c) => (
            <p key={c.id}>
              {c.description} · {c.quantity} × {c.unit_price_won} = {c.amount}원
              · {c.id}
            </p>
          ))}
          <p>
            당시 사유 {detail.snapshot.reason} · {detail.snapshot.actor.name} ·{" "}
            {detail.snapshot.at}
          </p>
          <p>
            현재 자식 상태/내용은 바뀔 수 있습니다. 위는 당시 고정 내용입니다.{" "}
            {detail.eligibility.reason}
          </p>
          {detail.undo && (
            <p>
              되돌리기: {detail.undo.reason} · {detail.undo.actor.name} ·{" "}
              {detail.undo.at}
            </p>
          )}
          <a
            href={"/api" + base + "/splits/" + detail.id + "/print"}
            target="_blank"
            rel="noreferrer"
          >
            이 분할 고정 기록 인쇄
          </a>
          <button disabled={working} onClick={() => void open(detail.id)}>
            현재 되돌리기 조건 다시 조회
          </button>
          <button
            disabled={working}
            onClick={() => void source(detail.snapshot.source.id)}
          >
            원행의 새 분할 가능 여부 조회
          </button>
          {detail.status === "active" && (
            <fieldset
              disabled={
                working ||
                period.status !== "open" ||
                !detail.eligibility.allowed
              }
            >
              <label>
                분할 되돌리기 사유
                <textarea
                  maxLength={1000}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <button
                disabled={!reason.trim()}
                onClick={() => void submit(true)}
              >
                자식 취소·원행 복원 (새 행 없음)
              </button>
            </fieldset>
          )}
          {period.status !== "open" && (
            <p>
              마감 원장은 분할/되돌리기 불가. 기존 원장 재개 정책을 따르세요.
            </p>
          )}
        </article>
      )}
      <h3>분할 이력 (50개씩)</h3>
      <button
        disabled={working}
        onClick={() => {
          if (guard.canLeave()) {
            reset();
            setDetail(null);
            setListLoading(true);
            setTick((t) => t + 1);
          }
        }}
      >
        분할 이력 새로 조회
      </button>
      {page.items.map((r) => (
        <p key={r.id}>
          <button disabled={working} onClick={() => void open(r.id)}>
            {r.created_at} · {r.status === "active" ? "적용" : "되돌림"} ·{" "}
            {r.id}
          </button>
        </p>
      ))}
      <button
        disabled={working || offset === 0}
        onClick={() => {
          if (guard.canLeave()) {
            reset();
            setDetail(null);
            setListLoading(true);
            setOffset(offset - 50);
          }
        }}
      >
        이전 50
      </button>
      <button
        disabled={working || !page.hasMore}
        onClick={() => {
          if (guard.canLeave()) {
            reset();
            setDetail(null);
            setListLoading(true);
            setOffset(offset + 50);
          }
        }}
      >
        다음 50
      </button>
    </section>
  );
}
