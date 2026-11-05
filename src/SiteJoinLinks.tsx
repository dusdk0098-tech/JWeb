import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { api } from "./api";
type Link = { id: string; expires_at: string; revoked_at: string | null; created_at: string; joined: number };
// 근로자 가입 QR (server/site-signup.ts): the site manager shows or shares the QR; whoever scans it joins this site as an editor.
export function SiteJoinLinks({ siteId }: { siteId: string }) {
  const base = `/sites/${siteId}/join-links`;
  const [items, setItems] = useState<Link[]>([]), [made, setMade] = useState<{ url: string; qr: string; expiresAt: string } | null>(null),
    [days, setDays] = useState(7), [busy, setBusy] = useState(false), [error, setError] = useState(""), [tick, setTick] = useState(0);
  useEffect(() => { api<{ items: Link[] }>(base).then((v) => setItems(v.items)).catch((e) => setError((e as Error).message)); }, [base, tick]);
  async function run(work: () => Promise<void>) {
    setBusy(true); setError("");
    try { await work(); setTick((t) => t + 1); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const make = () => run(async () => {
    const v = await api<{ token: string; expiresAt: string }>(base, "POST", { days }, crypto.randomUUID());
    // Phones need the public domain when this PC serves one; 127.0.0.1 only works on this PC.
    const pub = await api<{ origin: string | null }>("/public-origin").catch(() => ({ origin: null }));
    const url = `${pub.origin ?? location.origin}/signup#t=${v.token}`;
    setMade({ url, expiresAt: v.expiresAt, qr: await QRCode.toDataURL(url, { margin: 1, width: 240, errorCorrectionLevel: "M" }) });
  });
  const now = new Date().toISOString();
  return (
    <section>
      <h3>근로자 가입 QR</h3>
      <p className="muted">QR을 찍은 사람은 이름·생년월일·소속을 넣고 동의하면 바로 이 현장의 작성자로 들어옵니다. QR이 퍼지면 모르는 사람도 가입할 수 있으니 기간을 짧게 두고, 다 쓰면 회수하세요.</p>
      {error && <p role="alert" className="error">{error}</p>}
      <div className="tool-row">
        <label>유효 기간<select value={days} onChange={(e) => setDays(Number(e.target.value))}><option value={1}>1일</option><option value={7}>7일</option><option value={30}>30일</option></select></label>
        <button type="button" disabled={busy} onClick={() => void make()}>가입 QR 만들기</button>
      </div>
      {made && (
        <p role="status">
          새 가입 링크(지금 한 번만 표시): <input readOnly aria-label="가입 링크" value={made.url} onFocus={(e) => e.target.select()} />{" "}
          <button type="button" onClick={() => void navigator.clipboard?.writeText(made.url)}>복사</button> · 만료 {new Date(made.expiresAt).toLocaleString()}
          <br /><img src={made.qr} width={240} height={240} alt="근로자 가입 QR 코드" />
          {/^http:\/\/(127\.0\.0\.1|localhost)/.test(made.url) && " 이 링크는 이 PC에서만 열립니다. 휴대폰으로 쓰려면 \"외부 접속 설정\"을 먼저 켜세요."}
        </p>
      )}
      <ul>
        {items.map((l) => (
          <li key={l.id}>
            {new Date(l.created_at).toLocaleString()} 발급 · 가입 {l.joined}명 · {l.revoked_at ? "회수됨" : l.expires_at <= now ? "만료" : `유효(~${new Date(l.expires_at).toLocaleString()})`}
            {!l.revoked_at && l.expires_at > now && <button type="button" className="secondary" disabled={busy} onClick={() => void run(() => api(`${base}/${l.id}/revoke`, "POST", {}, crypto.randomUUID()))}>회수</button>}
          </li>
        ))}
      </ul>
    </section>
  );
}
