import { useEffect, useState, type ReactNode } from "react";
import type { Site, User } from "./api";
import { HOME, MOBILE_TABS, NAV_GROUPS, SETTINGS, groupOf, titleOf, type NavItem } from "./nav";
// 앱 셸 (UI 개편 PR 2): PC는 묶음 사이드바, 폰은 하단 탭 5개 + 메뉴 시트. 탭 전환 판단(저장 안 된 입력 확인)은 App이 한다.
export function NavIcon({ name, size = 18 }: { name: string; size?: number }) {
  // public/icons/*.svg use currentColor; <img> cannot inherit it, so mask the icon with the text color.
  return <span aria-hidden="true" className="nav-icon" style={{ width: size, height: size, WebkitMaskImage: `url(/icons/${name}.svg)`, maskImage: `url(/icons/${name}.svg)` }} />;
}
export function AppShell({ user, sites, siteId, site, tab, disabled, error, operator = false, onSelectSite, onSelectTab, onLogout, children }: {
  user: User; sites: Site[]; siteId: string; site: Site | undefined; tab: string; disabled: boolean; error: string; operator?: boolean;
  onSelectSite: (id: string) => void; onSelectTab: (id: string) => void; onLogout: () => void; children: ReactNode;
}) {
  const manager = site?.role === "manager", anyManager = sites.some((s) => s.role === "manager");
  const [sheet, setSheet] = useState<string | null>(null); // open mobile tab (group ids it lists)
  // a new screen starts at its top, not where the long sidebar left the page
  useEffect(() => { setSheet(null); window.scrollTo(0, 0); }, [tab]);
  const visible = (i: NavItem) => (!i.managerOnly || manager) && (!i.operatorOnly || operator) && (i.id !== "overview" || anyManager);
  const groups = NAV_GROUPS.filter((g) => !g.managerOnly || manager);
  const item = (i: NavItem, extra = "") => (
    <button key={i.id} type="button" disabled={disabled} className={(tab === i.id ? "active " : "") + extra} aria-current={tab === i.id ? "page" : undefined} onClick={() => onSelectTab(i.id)}>
      <NavIcon name={i.icon} />{i.id === "account" && user.worker ? "내 정보" : i.title}
    </button>
  );
  const activeTab = MOBILE_TABS.find((t) => t.groups.includes(groupOf(tab)))?.id ?? "home";
  const sheetTab = MOBILE_TABS.find((t) => t.id === sheet);
  return (
    <div className="shell">
      <aside className="sidebar">
        <a className="brand" href="#" onClick={(e) => { e.preventDefault(); onSelectTab("home"); }}>
          <img src="/brand/yweb-mark.svg" alt="" width={24} height={24} />Y웹<span>현장 안전 기록</span>
        </a>
        <label className="site-switch">
          작업 현장
          <select disabled={disabled} value={siteId} onChange={(e) => onSelectSite(e.target.value)}>
            <option value="" disabled>현장을 만들어 주세요</option>
            {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <nav id="primary-navigation" aria-label="주 메뉴">
          {item(HOME, "nav-home")}
          {groups.map((g) => (
            <div className="nav-group" key={g.id}>
              <p className="nav-label">{g.title}</p>
              {g.items.filter(visible).map((i) => item(i))}
            </div>
          ))}
          <div className="nav-group nav-settings">
            <p className="nav-label">설정</p>
            {SETTINGS.filter(visible).map((i) => item(i))}
          </div>
        </nav>
        <div className="sidebar-bottom">
          <strong>{user.name}</strong>
          <small>{user.email}</small>
          <button type="button" className="secondary" onClick={onLogout}>로그아웃</button>
        </div>
      </aside>
      <main className="workspace">
        <header className="topbar">
          <span>{site?.name || "현장 없음"}</span>
          <span>{site ? { manager: "현장 관리자", editor: "작성자", viewer: "열람자" }[site.role] : "현장을 먼저 만드세요"}</span>
        </header>
        {error && <p className="error" role="alert">{error}</p>}
        {children}
      </main>
      <nav className="tabbar" aria-label="하단 메뉴">
        {MOBILE_TABS.map((t) => (
          <button key={t.id} type="button" disabled={disabled} className={activeTab === t.id && !sheet ? "active" : sheet === t.id ? "open" : ""}
            aria-expanded={t.groups.length ? sheet === t.id : undefined} aria-controls={t.groups.length ? "mobile-sheet" : undefined}
            onClick={() => { if (!t.groups.length) { setSheet(null); onSelectTab(t.id); } else setSheet((s) => (s === t.id ? null : t.id)); }}>
            <NavIcon name={t.icon} size={22} />{t.title}
          </button>
        ))}
      </nav>
      {sheetTab && (
        <div className="sheet-backdrop" onClick={() => setSheet(null)}>
          <div id="mobile-sheet" className="sheet" role="dialog" aria-label={`${sheetTab.title} 메뉴`} onClick={(e) => e.stopPropagation()}>
            {sheetTab.groups.map((gid) => {
              const g = gid === "settings" ? { id: "settings", title: "설정", items: SETTINGS } : groups.find((x) => x.id === gid);
              if (!g) return null;
              return <div className="nav-group" key={g.id}><p className="nav-label">{g.title}</p>{g.items.filter(visible).map((i) => item(i))}</div>;
            })}
            {sheetTab.groups.includes("settings") && (
              <div className="sheet-account">
                <strong>{user.name}</strong><small>{user.email}</small>
                <button type="button" className="secondary" onClick={onLogout}>로그아웃</button>
              </div>
            )}
            <button type="button" className="secondary sheet-close" onClick={() => setSheet(null)}>닫기</button>
          </div>
        </div>
      )}
      <span className="sr-only" aria-live="polite">{titleOf(tab)}</span>
    </div>
  );
}
