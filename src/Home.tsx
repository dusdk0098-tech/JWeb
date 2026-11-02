import { useEffect, useState } from "react";
import { api, type Site, type User } from "./api";
import { NavIcon } from "./AppShell";
import { StatusBar, StatusChip, UiIcon, ICON } from "./ui";
// 홈 = 오늘 할 일 (UI 개편 PR 2). 기존 목록 API를 모아 보여 주기만 한다 — 서버 변경 없음, 판단·집계 없음.
// 내 할 일 (검토 2차): 각 화면의 업무함 API(신고·위험성평가·점검 일정·회의 후속조치, 관리자면 검토 대기까지)를 그대로 모은다.
// shortcut: 13 list calls on open; a summary endpoint when a real site makes this slow.
type Row = { id: string; status: string; author_id?: string; owner_id?: string; date?: string; body?: { date?: string; title?: string; summary?: string } };
type Period = { id: string; month: string; status: string };
type Task = { kind: string; id: string; tab: string; title: string; due: string; late: boolean; review: boolean };
type Data = { journals: Row[]; tbm: Row[]; plans: Row[]; inspections: Row[]; periods: Period[]; tasks: Task[]; workers: number; members: number | null };
type Ad = { id: string; title: string; text: string; url: string; image: boolean };
const today = () => new Date().toLocaleDateString("en-CA");
const KOR_DATE = (d: string) => { const [y, m, day] = d.split("-").map(Number); return `${m}월 ${day}일 (${"일월화수목금토"[new Date(y, m - 1, day).getDay()]})`; };
type PublicStatus = { tone: "ok" | "warn" | "error" | "off"; step: string | null; line: string };
const PUBLIC_TONE = { ok: "success", warn: "warning", error: "error", off: "info" } as const;
// 외부 접속 상태 (operator on the install PC): one line, and the button opens the wizard at the step that fixes it.
function PublicStatusLine({ onOpen }: { onOpen: (tab: string) => void }) {
  const [s, setS] = useState<PublicStatus | null>(null);
  useEffect(() => { api<PublicStatus>("/public-access/status").then(setS).catch(() => setS(null)); }, []);
  if (!s) return null;
  const open = () => { if (s.step) sessionStorage.setItem("public-setup-step", s.step); onOpen("public"); };
  return <StatusBar tone={PUBLIC_TONE[s.tone]}>{s.line} <button type="button" className="secondary" onClick={open}>외부 접속 설정 열기</button></StatusBar>;
}
type Focus = { id?: string; sub?: string };
// Tasks whose id is a record the target screen can open directly (the others open the screen).
const OPENS_RECORD = new Set(["신고 조치", "신고 검토", "점검 검토", "조사표 제출", "허가 검토", "작업 종료 확인"]);
export function Home({ site, user, ads, operatorLocal, onOpen }: { site: Site | undefined; user: User; ads?: boolean; operatorLocal?: boolean; onOpen: (tab: string, focus?: Focus) => void }) {
  const [data, setData] = useState<Data | null>(null), [error, setError] = useState(""), [adList, setAdList] = useState<Ad[]>([]);
  useEffect(() => {
    // 광고 (결정 6): text, link and image come from this server only; nothing about the site leaves it (docs/ADS.md).
    if (!ads) { setAdList([]); return; }
    api<{ ads: Ad[] }>("/ads").then((v) => setAdList(v.ads)).catch(() => setAdList([]));
  }, [ads]);
  useEffect(() => {
    if (!site) { setData(null); return; }
    let active = true;
    const base = `/sites/${site.id}`, manager = site.role === "manager", d = today();
    const list = <T,>(p: string, allowed = true) => allowed ? api<{ items: T[] }>(base + p).then((v) => v.items).catch(() => [] as T[]) : Promise.resolve([] as T[]);
    const task = (kind: string, tab: string, review: boolean) => <T extends { id: string }>(rows: T[], title: (r: T) => string, due: (r: T) => string | undefined): Task[] =>
      rows.map((r) => { const when = due(r) ?? ""; return { kind, id: r.id, tab, title: title(r), due: when, late: !review && !!when && when < d, review }; });
    Promise.all([
      list<Row>("/daily-journals"), list<Row>("/tbm"), list<Row>("/work-plans"), list<Row>("/inspections"), list<Period>("/cost-periods", manager),
      list<{ id: string; title: string; dueDate: string; stateLabel: string }>("/hazard-inbox?kind=mine"),
      list<{ id: string; title: string; dueDate: string }>("/hazard-inbox?kind=reviews", manager),
      list<{ id: string; title: string; task?: string; due?: string }>("/risk-inbox?kind=actions"),
      list<{ id: string; title: string }>("/risk-inbox?kind=publications"),
      list<{ id: string; title: string }>("/risk-inbox?kind=reviews", manager),
      list<{ id: string; title: string; plannedDate: string; location: string }>(`/inspection-task-register?asOfDate=${d}&work=my_start`),
      list<{ id: string; title: string; date: string; location: string }>("/inspection-register?work=reviewable", manager),
      list<{ id: string; due: string; source: { title: string; action: { task: string } } }>("/minutes-followups?mine=1&open=1"),
      list<{ id: string }>("/workers?active=true"),
      list<{ id: string; title: string; due: string }>("/incident-tasks", manager),
      list<{ id: string; title: string; due: string; kind: "review" | "close" }>("/permit-tasks"),
      list<{ id: string; title: string; due: string }>("/qualification-tasks", manager),
      manager ? api<unknown[]>(base + "/members").catch(() => null) : Promise.resolve(null),
    ])
      .then(([journals, tbm, plans, inspections, periods, hazardsMine, hazardReviews, riskActions, publications, riskReviews, inspectionStarts, inspectionReviews, followups, workers, incidentReports, permitTasks, qualificationTasks, members]) => {
        if (!active) return;
        const tasks = [
          ...task("조사표 제출", "incidents", false)(incidentReports, (r) => `산업재해조사표 · ${r.title}`, (r) => r.due),
          ...task("작업 종료 확인", "permits", false)(permitTasks.filter((p) => p.kind === "close"), (r) => `작업허가 · ${r.title}`, (r) => r.due),
          ...task("허가 검토", "permits", true)(permitTasks.filter((p) => p.kind === "review"), (r) => `작업허가 · ${r.title}`, (r) => r.due),
          ...task("자격 만료", "qualifications", false)(qualificationTasks, (r) => r.title, (r) => r.due),
          ...task("신고 조치", "hazards", false)(hazardsMine, (r) => `${r.title} · ${r.stateLabel}`, (r) => r.dueDate),
          ...task("위험성평가 조치", "riskcore", false)(riskActions, (r) => r.task ? `${r.title} · ${r.task}` : r.title, (r) => r.due),
          ...task("점검 일정", "inspections", false)(inspectionStarts, (r) => `${r.title} · ${r.location}`, (r) => r.plannedDate),
          ...task("회의 후속조치", "minutes", false)(followups, (r) => `${r.source.action.task} · ${r.source.title}`, (r) => r.due),
          ...task("게시본 확인", "riskcore", true)(publications, (r) => r.title, () => undefined),
          ...task("점검 검토", "inspections", true)(inspectionReviews, (r) => `${r.title} · ${r.location}`, (r) => r.date),
          ...task("신고 검토", "hazards", true)(hazardReviews, (r) => r.title, (r) => r.dueDate),
          ...task("문서 검토", "riskcore", true)(riskReviews, (r) => r.title, () => undefined),
        ].sort((a, b) => Number(b.late) - Number(a.late) || (a.due && b.due ? a.due.localeCompare(b.due) : a.due ? -1 : b.due ? 1 : 0));
        setData({ journals, tbm, plans, inspections, periods, tasks, workers: workers.length, members: members ? members.length : null });
      })
      .catch((e) => active && setError((e as Error).message));
    return () => { active = false; };
  }, [site?.id, site?.role]);
  const d = today();
  if (!site) return (
    <section className="home">
      <h1>오늘</h1>
      <p className="muted">{KOR_DATE(d)}</p>
      {operatorLocal && <PublicStatusLine onOpen={onOpen} />}
      <div className="ui-empty"><img src="/illustrations/no-records.svg" alt="" /><strong>아직 현장이 없습니다</strong><span>현장을 만들면 오늘 할 일이 여기에 모입니다.</span><button type="button" onClick={() => onOpen("sites")}>현장 만들러 가기</button></div>
    </section>
  );
  const mine = (r: Row) => (r.author_id ?? r.owner_id) === user.id;
  const tbmToday = data?.tbm.filter((t) => t.body?.date === d) ?? [], journalToday = data?.journals.find((j) => j.date === d);
  const tasks = data?.tasks ?? [], late = tasks.filter((t) => t.late).length;
  const drafts = [
    ...(data?.journals.filter((j) => j.status === "draft" && mine(j)).map((j) => ({ kind: "안전업무일지", id: j.id, tab: "daily", when: j.date ?? "", title: j.body?.summary || "작성 중인 일지" })) ?? []),
    ...(data?.tbm.filter((t) => t.status === "draft" && mine(t)).map((t) => ({ kind: "TBM", id: t.id, tab: "tbm", when: t.body?.date ?? "", title: t.body?.title || "작성 중인 TBM" })) ?? []),
    ...(data?.plans.filter((p) => p.status === "draft" && mine(p)).map((p) => ({ kind: "작업계획", id: p.id, tab: "workplans", when: p.body?.date ?? "", title: p.body?.title || "작성 중인 작업계획" })) ?? []),
    ...(data?.inspections.filter((i) => i.status === "draft" && mine(i)).map((i) => ({ kind: "점검", id: i.id, tab: "inspections", when: i.body?.date ?? "", title: "작성 중인 점검" })) ?? []),
  ].sort((a, b) => b.when.localeCompare(a.when)).slice(0, 6);
  const openPeriod = data?.periods.find((p) => p.status === "open");
  const card = (tab: string, label: string, value: string, tone: "signal" | "draft" | "neutral", icon: string) => (
    <button type="button" className={`home-card tone-${tone}`} onClick={() => tab ? onOpen(tab) : document.getElementById("home-tasks")?.scrollIntoView({ behavior: "smooth" })}>
      <span className="home-card-label"><NavIcon name={icon} size={16} />{label}</span>
      <span className="home-card-value">{value}</span>
    </button>
  );
  // 첫 실행 안내 (편의 4): shown until the site has its first TBM; each step opens the screen that does it.
  const steps = data && data.tbm.length === 0 ? [
    { label: "현장 만들기", done: true, tab: "sites", go: "", sub: "" },
    { label: "명부 등록", done: data.workers > 0, tab: "attendance", go: "명부 등록하러 가기", sub: "workers" },
    ...(data.members !== null ? [{ label: "구성원 추가", done: data.members > 1, tab: "sites", go: "구성원 추가하러 가기", sub: "" }] : []),
    { label: "첫 TBM", done: false, tab: "tbm", go: "첫 TBM 쓰러 가기", sub: "" },
  ] : [];
  const dueText = (t: Task) => !t.due ? "" : (t.late ? "기한 지남 · " : "") + (t.due === d ? "오늘" : KOR_DATE(t.due)) + " · ";
  return (
    <section className="home">
      <div className="home-head">
        <h1>오늘</h1>
        <span className="muted">{KOR_DATE(d)} · {site.name}</span>
      </div>
      {operatorLocal && <PublicStatusLine onOpen={onOpen} />}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="home-cards">
        {card("tbm", "오늘 TBM", tbmToday.length ? `${tbmToday.length}건 기록됨` : "아직 없음 · 시작하기", tbmToday.length ? "neutral" : "signal", "tbm")}
        {card("daily", "오늘 안전업무일지", journalToday ? (journalToday.status === "draft" ? "작성 중 · 이어 쓰기" : "보관됨") : "아직 없음 · 쓰기", journalToday ? "draft" : "signal", "journal")}
        {card("", "내 할 일", !data ? "조회 중" : tasks.length ? `${tasks.length}건${late ? ` · 기한 지남 ${late}건` : ""}` : "없음", late ? "signal" : tasks.length ? "draft" : "neutral", "inspection")}
        {site.role === "manager" && card("costs", "산업안전보건관리비", openPeriod ? `${openPeriod.month} 작성 중` : "열린 월 없음", openPeriod ? "draft" : "neutral", "cost")}
      </div>
      <section className="home-list">
        <h2>바로 가기</h2>
        <div className="home-actions">
          <button type="button" onClick={() => onOpen("tbm")}><UiIcon d={ICON.check} />TBM 시작</button>
          <button type="button" className="secondary" onClick={() => onOpen("inspections")}>점검 작성</button>
          <button type="button" className="secondary" onClick={() => onOpen("hazards")}>신고 접수</button>
          <button type="button" className="secondary" onClick={() => onOpen("photoboard")}>사진 올리기</button>
        </div>
      </section>
      {steps.length > 0 && (
        <section className="home-list home-steps">
          <h2>시작하기 <span className="muted">첫 TBM을 쓰면 이 안내는 사라집니다</span></h2>
          {steps.map((st, i) => (
            <div key={st.label} className="home-row">
              <span className="home-row-kind">{i + 1}</span>
              <span className="home-row-title">{st.label}</span>
              {st.done ? <StatusChip tone="done">완료</StatusChip> : <button type="button" className="secondary" onClick={() => onOpen(st.tab, st.sub ? { sub: st.sub } : undefined)}>{st.go}</button>}
            </div>
          ))}
        </section>
      )}
      <section className="home-list" id="home-tasks">
        <h2>내 할 일 <span className="muted">{data ? `${tasks.length}건` : "조회 중"}</span></h2>
        {data && tasks.length === 0 && <p className="ui-empty"><img src="/illustrations/all-done.svg" alt="" /><strong>지금 나에게 배정되거나 기다리는 일이 없습니다</strong></p>}
        {tasks.slice(0, 12).map((t) => (
          <button type="button" key={t.kind + t.id} className="home-row" onClick={() => onOpen(t.tab, OPENS_RECORD.has(t.kind) ? { id: t.id } : undefined)}>
            <span className="home-row-kind">{t.kind}</span>
            <span className="home-row-title">{dueText(t)}{t.title}</span>
            <StatusChip tone={t.late ? "error" : t.review ? "pending" : "draft"}>{t.late ? "기한 지남" : t.review ? "확인 대기" : "배정됨"}</StatusChip>
          </button>
        ))}
        {tasks.length > 12 && <p className="muted">외 {tasks.length - 12}건은 각 화면의 업무함에서 확인하세요.</p>}
      </section>
      <section className="home-list">
        <h2>내가 작성 중인 기록 <span className="muted">{data ? `${drafts.length}건` : "조회 중"}</span></h2>
        {data && drafts.length === 0 && <p className="ui-empty"><img src="/illustrations/all-done.svg" alt="" /><strong>작성 중인 기록이 없습니다</strong></p>}
        {drafts.map((r) => (
          <button type="button" key={r.kind + r.id} className="home-row" onClick={() => onOpen(r.tab, { id: r.id })}>
            <span className="home-row-kind">{r.kind}</span>
            <span className="home-row-title">{r.when ? KOR_DATE(r.when) + " · " : ""}{r.title}</span>
            <StatusChip tone="draft">작성 중</StatusChip>
          </button>
        ))}
      </section>
      {adList.length > 0 && (
        <aside className="ad-slot" aria-label="광고">
          <span className="ad-label">광고 · 개발자 수익용 · 현장 정보는 보내지 않습니다</span>
          {adList.map((a) => (
            <a key={a.id} className="ad" href={a.url} target="_blank" rel="noopener noreferrer sponsored">
              {a.image && <img src={`/api/ads/image/${a.id}`} alt="" />}
              <strong>{a.title}</strong>
              {a.text && <span>{a.text}</span>}
            </a>
          ))}
        </aside>
      )}
    </section>
  );
}
