import { useState } from "react";
import { api } from "./api";
import { Notice, PageHeader, Section } from "./ui";
type Me = { name: string; affiliation: string; sites: { name: string; role: string }[]; consents: { version: string; at: string; site: string | null }[] };
const ROLE: Record<string, string> = { manager: "현장 관리자", editor: "작성자", viewer: "열람자" };
// 근로자 '내 정보' (server/site-signup.ts): opens only after the date of birth is entered again.
export function WorkerProfile({ onRelogin }: { onRelogin: () => void }) {
  const [me, setMe] = useState<Me | null>(null), [error, setError] = useState(""), [notice, setNotice] = useState(""), [busy, setBusy] = useState(false);
  async function run(work: () => Promise<void>) {
    setBusy(true); setError(""); setNotice("");
    try { await work(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const unlock = (birth: string) => run(async () => { await api("/account/worker/unlock", "POST", { birth }); setMe(await api<Me>("/account/worker")); });
  const save = (body: { name: string; affiliation: string; birth?: string }) => run(async () => {
    const r = await api<{ relogin: boolean }>("/account/worker", "PUT", body);
    if (r.relogin) { onRelogin(); return; }
    setMe(await api<Me>("/account/worker")); setNotice("저장했습니다.");
  });
  return (
    <section className="panel">
      <PageHeader level={1} title="내 정보" />
      <Notice summary="개인정보를 보거나 고치려면 생년월일을 다시 입력하세요.">
        생년월일은 확인용으로 바꾼 값만 저장되어 화면에 다시 보이지 않습니다. 이름이나 생년월일을 바꾸면 모든 기기에서 로그아웃되고, 바꾼 값으로 다시 로그인합니다.
      </Notice>
      {error && <p role="alert" className="error">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {!me ? (
        <form onSubmit={(e) => { e.preventDefault(); void unlock(String(new FormData(e.currentTarget).get("birth"))); }}>
          <label>생년월일 6자리<input name="birth" required inputMode="numeric" pattern="\d{6}" maxLength={6} autoComplete="off" /></label>
          <button disabled={busy}>확인</button>
        </form>
      ) : (
        <>
          <Section level={2} title="가입한 현장">
            <ul>{me.sites.map((s) => <li key={s.name}>{s.name} · {ROLE[s.role] ?? s.role}</li>)}</ul>
            <p className="muted">동의 기록: {me.consents.map((c) => `${new Date(c.at).toLocaleDateString()}${c.site ? ` ${c.site}` : ""}`).join(", ")}</p>
          </Section>
          <Section level={2} title="고치기">
            <form key={me.name + me.affiliation} onSubmit={(e) => { e.preventDefault(); const d = new FormData(e.currentTarget), birth = String(d.get("birth") || ""); void save({ name: String(d.get("name")), affiliation: String(d.get("affiliation")), ...(birth ? { birth } : {}) }); }}>
              <label>이름<input name="name" required maxLength={100} defaultValue={me.name} /></label>
              <label>소속(업체명)<input name="affiliation" required maxLength={100} defaultValue={me.affiliation} /></label>
              <label>생년월일 6자리 (이름을 바꾸거나 잘못 넣었을 때만)<input name="birth" inputMode="numeric" pattern="\d{6}" maxLength={6} autoComplete="off" /></label>
              <button disabled={busy}>저장</button>
            </form>
          </Section>
        </>
      )}
    </section>
  );
}
