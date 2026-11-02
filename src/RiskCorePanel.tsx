import { RiskRegisterPanel } from "./RiskRegisterPanel";
import { EmptyState, Notice, PageHeader, StatusChip, type Tone } from "./ui";
import { RiskActionsPanel } from "./RiskActionsPanel";
const statusTone: Record<string, Tone> = { draft: "draft", submitted: "pending", accepted: "done", returned: "error", confirmed: "done" };
const statusText: Record<string, string> = { draft: "작성 중", submitted: "검토 대기", accepted: "수락", returned: "보완 요청", confirmed: "확인됨" };
import { RiskInboxPanel } from "./RiskInboxPanel";
import { RiskPublicationsPanel } from "./RiskPublicationsPanel";
import { RiskOverviewPanel } from "./RiskOverviewPanel";
import { RiskOpinionsPanel } from "./RiskOpinionsPanel";
import { useEffect, useState } from "react";
import { api, type Site, type User } from "./api";
import { RiskCriteriaEditor } from "./RiskCriteriaEditor";
import { RiskAssessmentEditor } from "./RiskAssessmentEditor";
import type {
  RiskCriteriaRecord,
  RiskAssessmentRecord,
} from "../server/risk-core";
export function RiskCorePanel({
  site,
  user,
  onDirtyChange,
  onBusyChange,
}: {
  site: Site;
  user: User;
  onDirtyChange: (v: boolean) => void;
  onBusyChange: (v: boolean) => void;
}) {
  const [method, setMethod] = useState<"product" | "three_level" | "checklist" | "narrative">(
    "product",
  );
  const [tab, setTab] = useState<"criteria" | "assessments" | "actions">("assessments"),
    [opened, setOpened] = useState<
      | { kind: "criteria"; row: RiskCriteriaRecord | null }
      | { kind: "assessments"; row: RiskAssessmentRecord | null }
      | { kind: "opinions" }
      | { kind: "overview" }
      | { kind: "publications" }
      | { kind: "inbox" }
      | { kind: "register" }
      | null
    >(null),
    [page, setPage] = useState<{
      items: (RiskCriteriaRecord | RiskAssessmentRecord)[];
      hasMore: boolean;
    }>({ items: [], hasMore: false }),
    [offset, setOffset] = useState(0),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [tick, setTick] = useState(0);
  useEffect(() => {
    if (opened || tab === "actions") return; // the actions tab lists its own records
    let active = true;
    setLoading(true);
    setPage({ items: [], hasMore: false });
    setError("");
    api<typeof page>(
      `/sites/${site.id}/risk-${tab}?offset=${offset}&method=${method}`,
    )
      .then((v) => {
        if (active) setPage(v);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [site.id, tab, offset, opened, tick, method]);
  useEffect(() => {
    onBusyChange(loading);
    return () => onBusyChange(false);
  }, [loading, onBusyChange]);
  if (opened) {
    const common = {
      site,
      onClose: () => {
        setOpened(null);
        onDirtyChange(false);
      },
      onDirtyChange,
      onBusyChange,
    };
    if (opened.kind === "register") return <RiskRegisterPanel key={site.id} {...common} user={user} />;
    if (opened.kind === "inbox") return <RiskInboxPanel {...common} user={user} />;
    if (opened.kind === "publications") return <RiskPublicationsPanel {...common} />;
    if (opened.kind === "overview") return <section><button onClick={common.onClose}>위험성평가 목록으로</button><RiskOverviewPanel site={site} /></section>;
    return opened.kind === "opinions" ? (
      <RiskOpinionsPanel {...common} user={user} />
    ) : opened.kind === "criteria" ? (
      <RiskCriteriaEditor {...common} method={method} initial={opened.row} />
    ) : (
      <RiskAssessmentEditor
        {...common}
        method={method}
        user={user}
        initial={opened.row}
      />
    );
  }
  const switcher = (
      <div className="segmented" role="group" aria-label="목록 종류">
        <button
          aria-pressed={tab === "assessments"}
          className={tab === "assessments" ? "" : "secondary"}
          disabled={loading}
          onClick={() => {
            setTab("assessments");
            setOffset(0);
          }}
        >
          평가 문서
        </button>
        <button
          aria-pressed={tab === "criteria"}
          className={tab === "criteria" ? "" : "secondary"}
          disabled={loading}
          onClick={() => {
            setTab("criteria");
            setOffset(0);
          }}
        >
          사람이 정의한 기준
        </button>
              <button
          aria-pressed={tab === "actions"}
          className={tab === "actions" ? "" : "secondary"}
          disabled={loading}
          onClick={() => setTab("actions")}
        >
          조치 추적
        </button>
        </div>
  );
  if (tab === "actions")
    return (
      <section className="panel">
        <PageHeader level={1} title="위험성평가" />
        {switcher}
        <RiskActionsPanel site={site} user={user} onDirtyChange={onDirtyChange} onBusyChange={onBusyChange} />
      </section>
    );
  return (
    <section className="panel">
      <PageHeader level={1} title="위험성평가">
        {(tab === "criteria"
          ? site.role === "manager"
          : site.role !== "viewer") && (
          <button
            disabled={loading}
            onClick={() =>
              setOpened(
                tab === "criteria"
                  ? { kind: "criteria", row: null }
                  : { kind: "assessments", row: null },
              )
            }
          >
            새 {tab === "criteria" ? "기준" : "평가"} 초안
          </button>
        )}
      </PageHeader>
      <Notice summary="평가 방법(수치형·3단계·체크리스트·서술형)마다 따로 기록합니다.">
        수치형·사람 선택3단계·체크리스트·서술형 기준/문서를 제공하는 개발본입니다. 수치
        재평가와 다른 방법을 혼동하지 않습니다. 계정 의견은 근로자 참여 증명이
        아닙니다. 전체 방법·참여/서명과 독립 보안·실제 브라우저 검증은
        미완료입니다.
      </Notice>
      <details className="advanced-tools">
      <summary>고급 · 내 업무 · 게시본 · 현황 · 의견함 · 전체 검색</summary>
      <div className="tool-row" role="group" aria-label="위험성평가 도구">
      <button className="secondary" disabled={loading} onClick={() => setOpened({ kind: "inbox" })}>내 위험성평가 업무</button>
      <button className="secondary" disabled={loading} onClick={() => setOpened({ kind: "publications" })}>고정 평가 게시본·내 계정 확인</button>
      <button className="secondary" disabled={loading} onClick={() => setOpened({ kind: "overview" })}>현장 위험성평가 업무 현황</button>
      <button
        className="secondary"
        disabled={loading}
        onClick={() => setOpened({ kind: "opinions" })}
      >
        {site.role === "manager" ? "현장 계정 의견함" : "내 계정 의견함"}
      </button>
      <button className="secondary" disabled={loading} onClick={() => setOpened({kind:"register"})}>평가 문서 목록 검색 (모든 방법)</button>
      </div>
      </details>
      {switcher}
      <div className="filter-bar">
      <label>
        평가 방법 (방법 간 점수 변환 없음)
        <select
          disabled={loading}
          value={method}
          onChange={(e) => {
            setLoading(true);
            setMethod(
              e.target.value as "product" | "three_level" | "checklist" | "narrative",
            );
            setOffset(0);
          }}
        >
          <option value="product">가능성×중대성 수치형</option>
          <option value="three_level">사람 선택 3단계 판단</option>
          <option value="checklist">체크리스트 항목별 판단</option>
          <option value="narrative">핵심요인 서술형</option>
        </select>
      </label>
      <button className="secondary" disabled={loading} onClick={() => setTick((x) => x + 1)}>
        목록 다시 조회
      </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {page.items.map((r) => {
        const title = "name" in r.body ? r.body.name : r.body.title, status = "status" in r ? r.status : "draft";
        return (
          <article key={r.id} className="record-row">
            <div className="record-row-main"><h2>{title || "제목 없음"}</h2></div>
            <StatusChip tone={statusTone[status] ?? "neutral"}>{statusText[status] ?? status}</StatusChip>
            <button
              className="secondary"
              disabled={loading}
              aria-label={`${title} 열기`}
              onClick={() =>
                setOpened(
                  tab === "criteria"
                    ? { kind: "criteria", row: r as RiskCriteriaRecord }
                    : { kind: "assessments", row: r as RiskAssessmentRecord },
                )
              }
            >
              열기
            </button>
          </article>
        );
      })}
      {!loading && !error && !page.items.length && <EmptyState title={tab === "criteria" ? "기준이 없습니다." : "평가 문서가 없습니다."} />}
      <div className="actions">
      <button
        className="secondary"
        disabled={loading || !offset}
        onClick={() => {
          setLoading(true);
          setOffset((x) => x - 50);
        }}
      >
        이전 50
      </button>
      <button
        className="secondary"
        disabled={loading || !page.hasMore}
        onClick={() => {
          setLoading(true);
          setOffset((x) => x + 50);
        }}
      >
        다음 50
      </button>
      </div>
      {loading && <p>조회 중</p>}
    </section>
  );
}
