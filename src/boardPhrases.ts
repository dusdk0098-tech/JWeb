// 보드판 자주 쓰는 문구 (docs/PHOTO_BOARD_FRANVIEW_ANALYSIS.md 3단계): what was saved in 보드판 내용 칸 on this device, per
// site, offered back as input suggestions together with today's date. Like 장소 기억: it only suggests into an input the user
// still sees; nothing is sent on its own.
// shortcut: device-local (localStorage), not shared between people or devices; move to a site table when teams ask for one list.
const key = (siteId: string) => `yweb:board-phrases:${siteId}`, MAX = 30;
export function boardPhrases(siteId: string): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(key(siteId)) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, MAX) : [];
  } catch { return []; }
}
const store = (siteId: string, list: string[]) => { try { localStorage.setItem(key(siteId), JSON.stringify(list.slice(0, MAX))); } catch { /* private window or blocked storage */ } };
// Newest first, no duplicates, at most 30. Dates are left out: today's date is always offered separately.
export function rememberPhrases(siteId: string, values: string[]) {
  const fresh = values.map((v) => v.trim()).filter((v) => v && !/^\d{4}\.\d{2}\.\d{2}$/.test(v));
  if (fresh.length) store(siteId, [...new Set([...fresh, ...boardPhrases(siteId)])]);
}
export const forgetPhrase = (siteId: string, text: string) => store(siteId, boardPhrases(siteId).filter((v) => v !== text));
export function todayText(now = new Date()) {
  return `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, "0")}.${String(now.getDate()).padStart(2, "0")}`;
}
