// 장소 기억 (검토 F7): the place last saved for this site on this device, offered as the default of a new record.
// It only pre-fills an input the user still sees and can change; nothing is sent on its own.
const key = (siteId: string) => `yweb:last-place:${siteId}`;
export function lastPlace(siteId: string) {
  try { return localStorage.getItem(key(siteId)) ?? ""; } catch { return ""; }
}
export function rememberPlace(siteId: string, place: string | undefined) {
  try { if (place?.trim()) localStorage.setItem(key(siteId), place.trim()); } catch { /* private window or blocked storage */ }
}
