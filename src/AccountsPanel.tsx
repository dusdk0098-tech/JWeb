import { useEffect, useState } from "react";
import { api } from "./api";
import { Notice, PageHeader, StatusChip, TechDetails } from "./ui";
// 계정 발급 (운영자 · 설치 PC 전용). The server decides every right; this screen only shows the forms.
type Account = { id: string; email: string; name: string; operator: boolean; issuer: boolean };
type Signup = { id: string; login_id: string; name: string; affiliation: string; site_name: string; note: string; created_at: string };
export function AccountsPanel() {
  const [items, setItems] = useState<Account[] | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [reset, setReset] = useState<string | null>(null); // account whose password is being reset
  const [signups, setSignups] = useState<{ items: Signup[]; sites: { id: string; name: string }[] } | null>(null); // 현장 관리자 가입 신청
  const load = () => Promise.all([
    api<{ items: Account[] }>("/accounts").then((v) => setItems(v.items)),
    api<{ items: Signup[]; sites: { id: string; name: string }[] }>("/manager-signups").then(setSignups),
  ]).catch((e) => setError((e as Error).message));
  useEffect(() => { void load(); }, []);
  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true); setError(""); setNotice("");
    try { await action(); setNotice(done); await load(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <section className="panel">
      <PageHeader level={1} title="계정 발급" />
      <Notice summary="운영자가 이 PC에서 계정을 만들고, 비밀번호를 초기화하고, 현장 관리자에게 발급 권한을 줍니다.">
        공개 가입·이메일 발송·셀프 재설정은 없습니다. 첫 비밀번호는 직접 전달하고, 받은 사람이 "내 비밀번호"에서 바꾸게 하세요.
        발급 권한을 받은 현장 관리자는 현장 관리에서 자기 현장에 들어갈 계정만 만들 수 있습니다. 모든 발급·초기화는 누가 했는지 기록됩니다.
        비밀번호 초기화는 그 계정의 로그인을 모두 끊습니다. 명령줄 발급(`npm run provision`)도 그대로 쓸 수 있습니다.
      </Notice>
      {error && <p role="alert" className="error">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <form onSubmit={(e) => { e.preventDefault(); const f = e.currentTarget, d = new FormData(f); void run(() => api("/accounts", "POST", { name: d.get("name"), email: d.get("email"), password: d.get("password"), issuer: d.get("issuer") === "on" }, crypto.randomUUID()).then(() => f.reset()), "계정을 만들었습니다. 비밀번호를 직접 전달하세요."); }}>
        <fieldset disabled={busy}>
          <legend>새 계정</legend>
          <div className="grid">
            <label>이름<input name="name" required maxLength={100} /></label>
            <label>이메일<input name="email" type="email" required maxLength={254} autoComplete="off" /></label>
            <label>첫 비밀번호 (12자 이상)<input name="password" type="password" required minLength={12} maxLength={128} autoComplete="new-password" /></label>
          </div>
          <label><input type="checkbox" name="issuer" />계정 발급 권한 (현장 관리자가 자기 현장 계정을 만들 수 있음)</label>
          <button>계정 만들기</button>
        </fieldset>
      </form>
      <h2>관리자 가입 신청 <span className="muted">{signups ? `${signups.items.length}건` : "조회 중"}</span></h2>
      {signups?.items.length === 0 && <p className="muted">기다리는 신청이 없습니다.</p>}
      {signups?.items.map((s) => (
        <article key={s.id} className="record-row">
          <div className="record-row-main">
            <h2>{s.name} · {s.affiliation}</h2>
            <p>아이디 {s.login_id} · 맡을 현장 {s.site_name}{s.note ? ` · ${s.note}` : ""} · {new Date(s.created_at).toLocaleString()} 신청</p>
            <form className="inline-create" onSubmit={(e) => { e.preventDefault(); const target = String(new FormData(e.currentTarget).get("target")); void run(() => api(`/manager-signups/${s.id}/approve`, "POST", target === "new" ? { newSiteName: s.site_name } : { siteId: target }, crypto.randomUUID()), `${s.name}님을 현장 관리자로 승인했습니다.`); }}>
              <label>현장<select name="target" defaultValue="new"><option value="new">새 현장 만들기: {s.site_name}</option>{signups.sites.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
              <button disabled={busy}>승인</button>
            </form>
            <form className="inline-create" onSubmit={(e) => { e.preventDefault(); const note = String(new FormData(e.currentTarget).get("note")); void run(() => api(`/manager-signups/${s.id}/reject`, "POST", { note }, crypto.randomUUID()), "신청을 반려했습니다."); }}>
              <label>반려 사유<input name="note" required maxLength={500} /></label>
              <button className="secondary" disabled={busy}>반려</button>
            </form>
          </div>
        </article>
      ))}
      <h2>계정 목록 <span className="muted">{items ? `${items.length}개` : "조회 중"}</span></h2>
      {items?.map((a) => (
        <article key={a.id} className="record-row">
          <div className="record-row-main"><h2>{a.name}</h2><p>{a.email}</p></div>
          {a.operator && <StatusChip tone="done">운영자</StatusChip>}
          {a.issuer && <StatusChip tone="draft">발급 권한</StatusChip>}
          <button type="button" className="secondary" disabled={busy} onClick={() => run(() => api(`/accounts/${a.id}/grants`, "PUT", { operator: a.operator, issuer: !a.issuer }, crypto.randomUUID()), a.issuer ? "발급 권한을 회수했습니다." : "발급 권한을 주었습니다.")}>
            {a.issuer ? "발급 권한 회수" : "발급 권한 주기"}
          </button>
          <button type="button" className="secondary" disabled={busy} onClick={() => setReset(reset === a.id ? null : a.id)}>비밀번호 초기화</button>
          {reset === a.id && (
            <form className="inline-create" onSubmit={(e) => { e.preventDefault(); const d = new FormData(e.currentTarget); void run(() => api(`/accounts/${a.id}/password`, "POST", { password: d.get("password") }, crypto.randomUUID()).then(() => setReset(null)), `${a.name} 계정의 비밀번호를 초기화했습니다. 기존 로그인은 모두 끊겼습니다.`); }}>
              <label>새 비밀번호 (12자 이상)<input name="password" type="password" required minLength={12} maxLength={128} autoComplete="new-password" /></label>
              <button disabled={busy}>초기화</button>
            </form>
          )}
          <TechDetails><p>계정 ID {a.id}</p></TechDetails>
        </article>
      ))}
    </section>
  );
}
