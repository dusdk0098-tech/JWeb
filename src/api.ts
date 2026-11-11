import type { MinutesSnapshot } from "../server/minutes-model";
let csrf = "";
export function setCsrf(value: string) {
  csrf = value;
}
// Pages without login (/join, /signup) fetch a CSRF token first, once per page load: two /session calls at once (React
// runs a mount effect twice in StrictMode) each start a session, and one token then fails against the other's cookie.
let pageCsrf: Promise<void> | null = null;
export function loadCsrf() {
  return (pageCsrf ??= api<{ csrf: string }>("/session").then((s) => setCsrf(s.csrf), (e) => { pageCsrf = null; throw e; }));
}
// Sessions last 8 hours and die on a server restart or a password change elsewhere. A 401 off the login path, or the
// 403 the CSRF check gives once the cookie is gone, then means we are signed out — unless the server still knows us
// (a wrong current password also answers 401, a real permission error 403), so ask /session once before sending the
// app back to the login screen.
let onSessionLost: (() => void) | null = null, sessionCheck: Promise<boolean> | null = null;
export function setSessionLostHandler(handler: (() => void) | null) {
  onSessionLost = handler;
}
async function sessionLost(path: string, status: number) {
  if ((status !== 401 && status !== 403) || path === "/login" || !onSessionLost) return;
  sessionCheck ??= fetch("/api/session", { credentials: "same-origin" })
    .then((r) => r.json())
    .then((s: { user: unknown }) => !s.user)
    .catch(() => false) // unreachable server: not a lost session
    .finally(() => { sessionCheck = null; });
  if (await sessionCheck) onSessionLost();
}
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
  key?: string,
): Promise<T> {
  const response = await fetch("/api" + path, {
    method,
    credentials: "same-origin",
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(method !== "GET" ? { "x-csrf-token": csrf } : {}),
      ...(key ? { "idempotency-key": key } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 204) return undefined as T;
  const data = await response.json();
  if (!response.ok) {
    await sessionLost(path, response.status);
    throw Object.assign(new Error(errorText(data)), { status: response.status }); // status: the outbox tells a refusal from "try later"
  }
  return data as T;
}
// Append the server's Korean field reasons (custom zod messages); zod's English defaults stay hidden.
export function errorText(data: { error?: string; fields?: { message: string }[] }) {
  const reasons = [...new Set((data.fields ?? []).map((f) => f.message).filter((m) => /[가-힣]/.test(m)))];
  return (data.error || "요청을 처리하지 못했습니다.") + (reasons.length ? " " + reasons.join(" / ") : "");
}
export type User = { id: string; name: string; email: string; worker?: boolean }; // worker: QR signup account
export type Site = {
  id: string;
  name: string;
  role: "manager" | "editor" | "viewer";
  version: number;
  managers?: number; // manager memberships on the site (from GET /sites)
};
// 관리자 1명 현장: the only manager also does the "another manager" steps (server/sole-manager.ts decides; this only shows the controls).
export const soleManagerOf = (site: Site) => site.role === "manager" && site.managers === 1;
export type Meeting = {
  status?: "draft" | "finalized";
  parentId?: string | null;
  successorId?: string | null;
  revisionReason?: string;
  snapshot?: {body:MinutesSnapshot;hash:string} | null;
  id: string;
  version: number;
  title: string;
  type: "안전보건협의체" | "기타";
  date: string;
  time: string;
  location: string;
  attendees: string;
  agenda: string;
  discussion: string;
  decisions: string;
  actions: {
    task: string;
    owner: string;
    due: string;
    status: "대기" | "진행" | "완료";
  }[];
};

// Dedicated raw upload; original bytes are not previewed or opened by the app.
async function uploadRawImageAttachment<T>(
  path: string,
  file: File,
  version: number,
  key: string,
  versionHeader: "x-hazard-version"|"x-minutes-version"|"x-work-plan-version"|"x-cost-period-version"|"x-education-version"|"x-photo-board-version"|"x-library-revision",
  allowPdfOriginal = false,
  evidenceVersion?: number,
  extraHeaders: Record<string, string> = {},
): Promise<T> {
  const format = allowPdfOriginal && /\.pdf$/i.test(file.name) ? "application/pdf" : /\.png$/i.test(file.name) ? "image/png" : "image/jpeg";
  const response = await fetch("/api" + path, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/octet-stream",
      "x-csrf-token": csrf,
      "idempotency-key": key,
      "x-file-name": encodeURIComponent(file.name),
      "x-file-type": format,
      [versionHeader]: String(version),
      ...(evidenceVersion === undefined ? {} : { "x-cost-evidence-version": String(evidenceVersion) }),
      ...extraHeaders,
    },
    body: file,
  });
  const data = await response.json();
  if (!response.ok) {
    await sessionLost(path, response.status);
    throw new Error(data.error || "첨부 저장 실패");
  }
  return data as T;
}

export function uploadHazardAttachment<T>(path:string,file:File,version:number,key:string){return uploadRawImageAttachment<T>(path,file,version,key,"x-hazard-version");}
export function uploadMinutesAttachment<T>(path:string,file:File,version:number,key:string){return uploadRawImageAttachment<T>(path,file,version,key,"x-minutes-version",true);}

export function uploadWorkPlanAttachment<T>(path:string,file:File,version:number,key:string){return uploadRawImageAttachment<T>(path,file,version,key,"x-work-plan-version",true);}

export function uploadCostEvidence<T>(path:string,file:File,periodVersion:number,evidenceVersion:number,key:string){return uploadRawImageAttachment<T>(path,file,periodVersion,key,"x-cost-period-version",true,evidenceVersion);}

export function uploadCostPhotoDisplay<T>(path:string,display:Blob,periodVersion:number,key:string){return uploadRawImageAttachment<T>(path,new File([display],"display.jpg",{type:"image/jpeg"}),periodVersion,key,"x-cost-period-version");}
export function uploadPhotoBoardPhoto<T>(path:string,file:File,version:number,key:string){return uploadRawImageAttachment<T>(path,file,version,key,"x-photo-board-version");}
export function uploadPhotoBoardDisplay<T>(path:string,display:Blob,version:number,key:string){return uploadRawImageAttachment<T>(path,new File([display],"display.jpg",{type:"image/jpeg"}),version,key,"x-photo-board-version");}
export function uploadLibraryFile<T>(path:string,file:File,revision:number,title:string,edition:string,key:string){return uploadRawImageAttachment<T>(path,file,revision,key,"x-library-revision",true,undefined,{"x-library-title":encodeURIComponent(title),"x-library-edition":encodeURIComponent(edition),"x-rights-confirmed":"1"});}
export function uploadEducationAttachment<T>(path:string,file:File,version:number,key:string){return uploadRawImageAttachment<T>(path,file,version,key,"x-education-version",true);}
