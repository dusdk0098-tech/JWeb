import { clearOfflineDrafts } from "./offline-draft";
import React, { useEffect, useState } from "react";
import { api, setCsrf, type User } from "./api";
import { StatusBar } from "./ui";
export function Login({
  onLogin,
  error: outerError,
  notice = "",
  keepDraftsFor = null,
}: {
  onLogin: (u: User) => void;
  error: string;
  notice?: string;
  keepDraftsFor?: string | null; // the account whose device drafts survive this login (after a session expiry)
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [setup, setSetup] = useState<{ needsOperator: boolean; local: boolean } | null>(null), // first-run: no operator yet
    [created, setCreated] = useState("");
  useEffect(() => { api<{ needsOperator: boolean; local: boolean }>("/setup").then(setSetup).catch(() => setSetup(null)); }, []);
  async function createOperator(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setError("");
    const data = new FormData(e.currentTarget);
    try {
      const r = await api<{ email: string }>("/setup/operator", "POST", { name: data.get("name"), email: data.get("email"), password: data.get("password") });
      setCreated(r.email); setSetup({ needsOperator: false, local: true });
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function claimOperator(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setError("");
    const data = new FormData(e.currentTarget);
    try {
      const r = await api<{ email: string }>("/setup/claim", "POST", { email: data.get("email"), password: data.get("password") });
      setCreated(r.email); setSetup({ needsOperator: false, local: true });
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const data = new FormData(e.currentTarget);
    try {
      const s = await api<{ user: User; csrf: string }>("/login", "POST", {
        email: data.get("email"),
        password: data.get("password"),
      });
      setCsrf(s.csrf);
      if (s.user.id !== keepDraftsFor) await clearOfflineDrafts(); // another account → new device key, old drafts gone
      onLogin(s.user);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login">
      <div className="login-intro">
        <img src="/brand/yweb-mark.svg" alt="" width={48} height={48} />
        <span className="brand">Y웹</span>
        <p>현장 안전 기록</p>
        <p className="muted">TBM · 점검 · 안전업무일지 · 작업계획 · 산업안전보건관리비를 한곳에서.</p>
      </div>
      <section className="login-form panel">
        <h2>로그인</h2>
        {notice && <StatusBar tone="warning" role="status">{notice}</StatusBar>}
        <p>운영 담당자가 발급한 계정을 입력하세요.</p>
        <form onSubmit={submit}>
          <label>
            이메일
            <input
              type="email"
              name="email"
              required
              autoComplete="username"
              maxLength={254}
            />
          </label>
          <label>
            비밀번호
            <input
              type="password"
              name="password"
              required
              autoComplete="current-password"
              maxLength={128}
            />
          </label>
          {(error || outerError) && (
            <p role="alert" className="error">
              {error || outerError}
            </p>
          )}
          <button disabled={busy}>{busy ? "확인 중…" : "로그인"}</button>
        </form>
        <p className="muted">
          공개 가입·비밀번호 재설정·SSO는 제공하지 않습니다. 계정은 운영자나 발급 권한을 받은 현장 관리자가 만듭니다.
        </p>
        {created && <StatusBar tone="success" role="status">{created}을(를) 운영자로 정했습니다. 위에서 로그인하세요.</StatusBar>}
        {setup?.needsOperator && setup.local && !created && (
          <details className="ui-notice" open>
            <summary>이 PC에 운영자 계정이 없습니다 · 첫 운영자 만들기</summary>
            <p className="muted">설치한 PC에서 직접 접속했을 때만 보입니다. 운영자는 이 PC에서 계정을 발급하고 비밀번호를 초기화합니다.</p>
            <form onSubmit={createOperator}>
              <label>운영자 이름<input name="name" required maxLength={100} /></label>
              <label>운영자 이메일<input name="email" type="email" required maxLength={254} autoComplete="off" /></label>
              <label>운영자 비밀번호 (12자 이상)<input name="password" type="password" required minLength={12} maxLength={128} autoComplete="new-password" /></label>
              <button disabled={busy}>운영자 계정 만들기</button>
            </form>
            <p className="muted">이미 쓰던 계정이 있다면(이전 버전에서 올린 경우) 그 계정을 운영자로 지정할 수 있습니다.</p>
            <form onSubmit={claimOperator} aria-label="기존 계정을 운영자로 지정">
              <label>기존 계정 이메일<input name="email" type="email" required maxLength={254} autoComplete="username" /></label>
              <label>기존 계정 비밀번호<input name="password" type="password" required maxLength={128} autoComplete="current-password" /></label>
              <button disabled={busy}>이 계정을 운영자로 지정</button>
            </form>
          </details>
        )}
      </section>
    </main>
  );
}
