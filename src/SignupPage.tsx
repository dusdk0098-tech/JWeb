import { useEffect, useState } from "react";
import { api, setCsrf } from "./api";
import { SIGNUP_CONSENT } from "../server/consent-text";
// 근로자 QR 가입 (server/site-signup.ts): no login. The token stays in the URL fragment, so it never reaches server logs.
export function SignupPage() {
  const token = new URLSearchParams(location.hash.slice(1)).get("t") ?? "";
  const [info, setInfo] = useState<{ siteName: string; expiresAt: string } | null>(null), [agreed, setAgreed] = useState<string[]>([]),
    [error, setError] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => {
    api<{ csrf: string }>("/session").then((s) => { setCsrf(s.csrf); return api<NonNullable<typeof info>>("/site-join/info", "POST", { token }); })
      .then(setInfo).catch((e) => setError((e as Error).message));
  }, [token]);
  const ids = SIGNUP_CONSENT.items.map((i) => i.id), all = ids.every((id) => agreed.includes(id));
  const toggle = (id: string, on: boolean) => setAgreed(on ? [...agreed, id] : agreed.filter((x) => x !== id));
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setError("");
    const d = new FormData(e.currentTarget), name = String(d.get("name")), birth = String(d.get("birth"));
    try {
      await api("/site-join", "POST", { token, name, birth, affiliation: d.get("affiliation"), consentVersion: SIGNUP_CONSENT.version, agreed });
      const s = await api<{ csrf: string }>("/login/worker", "POST", { name, birth });
      setCsrf(s.csrf);
      location.assign("/");
    } catch (e) { setError((e as Error).message); setBusy(false); }
  }
  return (
    <main className="login">
      <section>
        <h1>Y웹 현장 가입</h1>
        {!info ? <p role={error ? "alert" : undefined} className={error ? "error" : undefined}>{error || "가입 QR을 확인하는 중…"}</p> : (
          <form onSubmit={submit}>
            <h2>{info.siteName}</h2>
            <p className="muted">이름과 생년월일로 가입하고 바로 이 현장에 들어갑니다. 다음부터는 로그인 화면의 &apos;근로자 로그인&apos;에서 같은 이름과 생년월일을 넣으면 됩니다.</p>
            <label>이름<input name="name" required maxLength={100} autoComplete="name" /></label>
            <label>생년월일 6자리<input name="birth" required inputMode="numeric" pattern="\d{6}" maxLength={6} placeholder="예: 850315" autoComplete="off" /></label>
            <label>소속(업체명)<input name="affiliation" required maxLength={100} /></label>
            <fieldset>
              <legend>동의와 서약</legend>
              <label className="check"><input type="checkbox" checked={all} onChange={(e) => setAgreed(e.target.checked ? ids : [])} /> 모두 동의합니다</label>
              {SIGNUP_CONSENT.items.map((i) => (
                <div key={i.id}>
                  <label className="check"><input type="checkbox" checked={agreed.includes(i.id)} onChange={(e) => toggle(i.id, e.target.checked)} /> {i.title}</label>
                  <details><summary>내용 보기</summary><p className="muted">{i.text}</p></details>
                </div>
              ))}
            </fieldset>
            {error && <p role="alert" className="error">{error}</p>}
            <button disabled={busy || !all}>{busy ? "가입 중…" : "가입하고 입장"}</button>
          </form>
        )}
      </section>
    </main>
  );
}
