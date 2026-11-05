import { HelpPanel } from "./HelpPanel";
import { helpDestinationAllowed } from "./help-topics";
import {
  RiskCorePanel,
  CompanyPpePanel,
  WorkStopPanel,
  IncidentsPanel,
  PermitsPanel,
  QualificationsPanel,
  ManagerOverview,
  WorkPlanPanel,
  StockPanel,
  CostPanel,
  DailyJournalPanel,
  EquipmentPanel,
  EducationPanel,
  InspectionsPanel,
  HazardsPanel,
  TbmPanel,
  WorkersAttendance,
  PhotoBoardPanel,
} from "./DomainPanels";
import { Login } from "./Login";
import { AppShell } from "./AppShell";
import { Home } from "./Home";
import { JoinPage } from "./JoinPage";
import { SignupPage } from "./SignupPage";
import { WorkerProfile } from "./WorkerProfile";
import { clearOfflineDrafts } from "./offline-draft";
import { Minutes } from "./Minutes";
import { SiteManagement } from "./SiteManagement";
import { PasswordChange } from "./PasswordChange";
import { AiSettings } from "./AiSettings";
import { AccountsPanel } from "./AccountsPanel";
import { NoticesLibraryPanel } from "./NoticesLibraryPanel";
import { PublicAccessSettings } from "./PublicAccessSettings";
import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { api, setCsrf, setSessionLostHandler, type Meeting, type Site, type User } from "./api";
import { MeetingEditor } from "./MeetingEditor";
import "./style.css";
type Session = { user: User | null; csrf: string; adsEnabled: boolean; operator?: boolean; issuer?: boolean; local?: boolean };
function App() {
  const [user, setUser] = useState<User | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [sites, setSites] = useState<Site[]>([]),
    [siteId, setSiteId] = useState(""),
    [tab, setTab] = useState("home"),
    [ads, setAds] = useState(false),
    [editor, setEditor] = useState<{ initial: Meeting | null } | null>(null),
    [expiredUserId, setExpiredUserId] = useState<string | null>(null), // who was signed in when the session died
    [flags, setFlags] = useState({ operator: false, issuer: false, local: false }); // account-issuance rights from /session
  const userRef = useRef(user);
  userRef.current = user;
  // 검토 F15·F2: what the home screen asked a screen to open (a record, or the roster tab); cleared on any other navigation
  const [focus, setFocus] = useState<{ id?: string; sub?: string } | null>(null);
  const [attendanceDirty, setAttendanceDirty] = useState(false);
  const [attendanceBusy, setAttendanceBusy] = useState(false);
  function mayLeaveAttendance() {
    return (
      !attendanceBusy &&
      (!attendanceDirty ||
        window.confirm("저장하지 않은 업무 입력을 버리고 이동할까요?"))
    );
  }
  const site = sites.find((s) => s.id === siteId);
  async function refreshSites() {
    const list = await api<Site[]>("/sites");
    setSites(list);
    setSiteId((id) => (list.some((s) => s.id === id) ? id : list[0]?.id || ""));
  }
  useEffect(() => {
    api<Session>("/session")
      .then((s) => {
        setUser(s.user);
        setCsrf(s.csrf);
        setAds(s.adsEnabled);
        setFlags({ operator: !!s.operator, issuer: !!s.issuer, local: !!s.local });
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (!user) return;
    refreshSites().catch((e) => setError(e.message));
    api<Session>("/session").then((s) => setFlags({ operator: !!s.operator, issuer: !!s.issuer, local: !!s.local })).catch(() => {});
  }, [user]);
  useEffect(() => {
    // Back to the login screen with a notice; tab and site are kept, device drafts survive a same-account login.
    // shortcut: expiredUserId lives in memory only — a page reload before the next login clears the drafts as before.
    setSessionLostHandler(() => {
      const lost = userRef.current;
      if (!lost) return;
      setExpiredUserId(lost.id);
      setUser(null);
      setSites([]);
      setEditor(null);
      setError("");
      api<{ csrf: string }>("/session").then((s) => setCsrf(s.csrf)).catch(() => {});
    });
    return () => setSessionLostHandler(null);
  }, []);
  async function logout() {
    if (!mayLeaveAttendance()) return;
    if (
      editor &&
      !window.confirm(
        "회의록 입력을 닫고 로그아웃할까요? 저장하지 않은 내용은 사라집니다.",
      )
    )
      return;
    try {
      await api("/logout", "POST");
      await clearOfflineDrafts();
      setEditor(null);
      setSites([]);
      setUser(null);
      const s = await api<{ csrf: string }>("/session");
      setCsrf(s.csrf);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  if (loading)
    return (
      <main className="login">
        <h1>Y웹</h1>
        <p>연결 중…</p>
      </main>
    );
  if (!user)
    return (
      <Login
        onLogin={(u) => {
          setUser(u);
          setExpiredUserId(null);
          setError("");
        }}
        error={error}
        notice={expiredUserId ? "로그인이 만료되어 로그인 화면으로 돌아왔습니다. 다시 로그인하세요. 작성 중이던 일지·TBM·점검 입력은 같은 계정으로 로그인하면 이 기기 초안에서 복원할 수 있습니다." : ""}
        keepDraftsFor={expiredUserId}
      />
    );
  return (
    <AppShell
      user={user}
      sites={sites}
      siteId={siteId}
      site={site}
      tab={tab}
      disabled={!!editor || attendanceBusy}
      error={error}
      operator={flags.operator && flags.local}
      onSelectSite={(id) => {
        if (!mayLeaveAttendance()) return;
        setSiteId(id);
        setError("");
      }}
      onSelectTab={(id) => {
        if (id !== tab && !mayLeaveAttendance()) return;
        setTab(id);
        setFocus(null);
        setError("");
      }}
      onLogout={logout}
    >
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {editor && site ? (
          <MeetingEditor
            user={user}
            onDirtyChange={setAttendanceDirty}
            onBusyChange={setAttendanceBusy}
            key={site.id + (editor.initial?.id || "new")}
            site={site}
            initial={editor.initial}
            onClose={() => setEditor(null)}
            onSaved={() => {}}
          />
        ) : tab === "overview" ? (
          <ManagerOverview
            sites={sites}
            onOpen={(id, next) => {
              setSiteId(id);
              setTab(next);
            }}
          />
        ) : tab === "help" ? (
          <HelpPanel
            site={site}
            disabled={!!editor || attendanceBusy}
            onNavigate={(next) => {
              if (!helpDestinationAllowed(next, site?.role)) return;
              if (editor || !mayLeaveAttendance()) return;
              setTab(next);
              setFocus(null);
              setError("");
            }}
          />
        ) : tab === "home" ? (
          <Home site={site} user={user} ads={ads} operatorLocal={flags.operator && flags.local} onOpen={(next, f) => { if (!mayLeaveAttendance()) return; setTab(next); setFocus(f ?? null); setError(""); }} />
        ) : tab === "ai" ? (
          <AiSettings />
        ) : tab === "public" ? (
          <PublicAccessSettings />
        ) : tab === "accounts" && flags.operator && flags.local ? (
          <AccountsPanel />
        ) : tab === "account" && user.worker ? (
          <WorkerProfile onRelogin={() => location.reload()} />
        ) : tab === "account" ? (
          <PasswordChange
            onDirtyChange={setAttendanceDirty}
            onBusyChange={setAttendanceBusy}
            onClose={() => setTab("home")}
            onChanged={() => {
              setEditor(null);
              setSites([]);
              setSiteId("");
              setUser(null);
              setTab("home");
              setCsrf("");
              setError(
                "비밀번호를 변경했습니다. 새 비밀번호로 다시 로그인하세요.",
              );
              void api<{ csrf: string }>("/session")
                .then((s) => setCsrf(s.csrf))
                .catch(() =>
                  setError(
                    "비밀번호를 변경했습니다. 새로고침한 뒤 로그인하세요.",
                  ),
                );
            }}
          />
        ) : tab === "sites" ? (
          <SiteManagement sites={sites} site={site} refresh={refreshSites} issuer={flags.issuer} />
        ) : site && tab === "stock" && site.role === "manager" ? (
          <StockPanel
            key={site.id}
            site={site}
            onDirtyChange={setAttendanceDirty}
            onBusyChange={setAttendanceBusy}
          />
        ) : site && tab === "costs" && site.role === "manager" ? (
          <CostPanel
            key={site.id}
            site={site}
            onDirtyChange={setAttendanceDirty}
            onBusyChange={setAttendanceBusy}
          />
        ) : site && tab === "photoboard" ? (
          <PhotoBoardPanel
            key={site.id}
            site={site}
            onDirtyChange={setAttendanceDirty}
            onBusyChange={setAttendanceBusy}
          />
        ) : site && tab === "daily" ? (
          <DailyJournalPanel
            key={site.id}
            site={site}
            openId={focus?.id}
            user={user}
            onDirtyChange={setAttendanceDirty}
            onBusyChange={setAttendanceBusy}
          />
        ) : site && tab === "workplans" ? (
          <WorkPlanPanel
            key={site.id}
            site={site}
            openId={focus?.id}
            user={user}
            onDirtyChange={setAttendanceDirty}
            onBusyChange={setAttendanceBusy}
          />
        ) : site && tab === "equipment" ? (
          <EquipmentPanel
            key={site.id}
            site={site}
            user={user}
            onDirtyChange={setAttendanceDirty}
            onBusyChange={setAttendanceBusy}
          />
        ) : site && tab === "notices" ? (
          <NoticesLibraryPanel
            key={site.id}
            site={site}
            onDirtyChange={setAttendanceDirty}
            onBusyChange={setAttendanceBusy}
          />
        ) : site && tab === "education" ? (
          <EducationPanel
            key={site.id}
            site={site}
            user={user}
            onDirtyChange={setAttendanceDirty}
            onBusyChange={setAttendanceBusy}
          />
        ) : site && tab === "inspections" ? (
          <InspectionsPanel
            key={site.id}
            site={site}
            openId={focus?.id}
            user={user}
            onDirtyChange={setAttendanceDirty}
            onBusyChange={setAttendanceBusy}
          />
        ) : site && tab === "riskcore" ? (
          <RiskCorePanel
            key={site.id}
            site={site}
            user={user}
            onDirtyChange={setAttendanceDirty}
            onBusyChange={setAttendanceBusy}
          />
        ) : site && tab === "companyppe" ? (
          <CompanyPpePanel
            key={site.id}
            site={site}
            onDirtyChange={setAttendanceDirty}
            onBusyChange={setAttendanceBusy}
          />
        ) : site && tab === "incidents" ? (
          <IncidentsPanel
            key={site.id}
            site={site}
            openId={focus?.id}
            onDirtyChange={setAttendanceDirty}
            onBusyChange={setAttendanceBusy}
          />
        ) : site && tab === "permits" ? (
          <PermitsPanel
            key={site.id}
            site={site}
            user={user}
            openId={focus?.id}
            onDirtyChange={setAttendanceDirty}
            onBusyChange={setAttendanceBusy}
          />
        ) : site && tab === "workstops" ? (
          <WorkStopPanel
            key={site.id}
            site={site}
            user={user}
            onDirtyChange={setAttendanceDirty}
            onBusyChange={setAttendanceBusy}
          />
        ) : site && tab === "hazards" ? (
          <HazardsPanel
            key={site.id}
            site={site}
            openId={focus?.id}
            user={user}
            onDirtyChange={setAttendanceDirty}
            onBusyChange={setAttendanceBusy}
          />
        ) : site && tab === "tbm" ? (
          <TbmPanel
            key={site.id}
            site={site}
            openId={focus?.id}
            user={user}
            onNavigate={(next) => { if (!mayLeaveAttendance()) return; setTab(next); setFocus({ sub: "workers" }); setError(""); }}
            onDirtyChange={setAttendanceDirty}
            onBusyChange={setAttendanceBusy}
          />
        ) : site && tab === "qualifications" ? (
          <QualificationsPanel
            key={site.id}
            site={site}
            onDirtyChange={setAttendanceDirty}
            onBusyChange={setAttendanceBusy}
          />
        ) : site && tab === "attendance" ? (
          <WorkersAttendance
            key={site.id}
            site={site}
            initialTab={focus?.sub === "workers" ? "workers" : undefined}
            onDirtyChange={setAttendanceDirty}
            onBusyChange={setAttendanceBusy}
          />
        ) : site ? (
          <Minutes site={site} open={(initial) => setEditor({ initial })} />
        ) : (
          <div className="panel">
            <h2>현장을 먼저 만들어 주세요.</h2>
            <button onClick={() => setTab("sites")}>현장 만들러 가기</button>
          </div>
        )}
    </AppShell>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {location.pathname === "/join" ? <JoinPage /> : location.pathname === "/signup" ? <SignupPage /> : <App />}
  </React.StrictMode>,
);
