// 메뉴 구조 (UI 개편 PR 2): 25개 평면 메뉴 → 묶음. 탭 id는 main.tsx의 분기와 같아야 한다.
export type NavItem = { id: string; title: string; icon: string; managerOnly?: boolean; operatorOnly?: boolean };
export type NavGroup = { id: string; title: string; icon: string; items: NavItem[]; managerOnly?: boolean };
export const HOME: NavItem = { id: "home", title: "오늘", icon: "today" };
export const NAV_GROUPS: NavGroup[] = [
  { id: "safety", title: "안전 활동", icon: "tbm", items: [
    { id: "tbm", title: "TBM", icon: "tbm" },
    { id: "inspections", title: "점검", icon: "inspection" },
    { id: "daily", title: "안전업무일지", icon: "journal" },
    { id: "hazards", title: "신고 · 조치", icon: "report" },
    { id: "workstops", title: "작업 중지 요청", icon: "stop" },
    { id: "incidents", title: "사고 · 아차사고", icon: "warning" },
    { id: "permits", title: "작업허가서", icon: "check" },
    { id: "education", title: "교육일지", icon: "education" },
  ] },
  { id: "docs", title: "문서", icon: "work-plan", items: [
    { id: "workplans", title: "작업계획", icon: "work-plan" },
    { id: "riskcore", title: "위험성평가", icon: "risk" },
    { id: "minutes", title: "회의록", icon: "minutes" },
    { id: "notices", title: "공지 · 자료", icon: "notice" }, // notices + library (결정 8)
  ] },
  { id: "resources", title: "현장 자원", icon: "roster", items: [
    { id: "attendance", title: "명부 · 출역", icon: "roster" },
    { id: "qualifications", title: "이수 · 자격", icon: "education" },
    { id: "companyppe", title: "업체 · 소속", icon: "company-ppe" },
    { id: "equipment", title: "장비", icon: "equipment" },
    { id: "stock", title: "재고 · 보호구", icon: "stock", managerOnly: true }, // PPE issue/return lives here (결정 8)
  ] },
  { id: "cost", title: "안전보건관리비", icon: "cost", managerOnly: true, items: [
    { id: "costs", title: "산업안전보건관리비", icon: "cost" },
  ] },
  { id: "media", title: "사진 · 자료", icon: "photo-board", items: [
    { id: "photoboard", title: "사진 보드", icon: "photo-board" },
  ] },
];
export const SETTINGS: NavItem[] = [
  { id: "sites", title: "현장 관리", icon: "settings" },
  { id: "overview", title: "관리 현장 현황", icon: "settings" }, // shown when the user manages any site
  { id: "account", title: "내 비밀번호", icon: "lock" },
  { id: "accounts", title: "계정 발급", icon: "lock", operatorOnly: true }, // operator on the install PC
  { id: "ai", title: "AI 문구 설정", icon: "settings" },
  { id: "public", title: "외부 접속 설정", icon: "online" },
  { id: "help", title: "도움말", icon: "help" },
];
// 폰 하단 탭 5개: 오늘 · 안전 · 문서 · 사진 · 더보기(현장 자원·비용·설정)
export const MOBILE_TABS: { id: string; title: string; icon: string; groups: string[] }[] = [
  { id: "home", title: "오늘", icon: "today", groups: [] },
  { id: "safety", title: "안전", icon: "tbm", groups: ["safety"] },
  { id: "docs", title: "문서", icon: "work-plan", groups: ["docs"] },
  { id: "media", title: "사진", icon: "photo-board", groups: ["media"] },
  { id: "more", title: "더보기", icon: "more", groups: ["resources", "cost", "settings"] },
];
export const ALL_ITEMS: NavItem[] = [HOME, ...NAV_GROUPS.flatMap((g) => g.items), ...SETTINGS];
export const titleOf = (id: string) => ALL_ITEMS.find((i) => i.id === id)?.title ?? "";
export const groupOf = (id: string) => NAV_GROUPS.find((g) => g.items.some((i) => i.id === id))?.id ?? (SETTINGS.some((i) => i.id === id) ? "settings" : "home");
