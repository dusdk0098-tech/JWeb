import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { api } from "./api";
type Invitations = { invitations: { id: string; expires_at: string; revoked_at: string | null; created_at: string; current: boolean }[]; events: { id: string; worker_id: string; worker_name: string; at: string; current: number; decision: "grant" | "deny" | null; signed: number }[] };
// MOB-01 1단계: issue/revoke a time-limited participation link and see who confirmed. Applying it to the roster stays manual.
// Used for TBM and, with kind="education", for 교육일지 (same server mechanism).
export function TbmInvitations({ path, draft, writable, kind = "tbm" }: { path: string; draft: boolean; writable: boolean; kind?: "tbm" | "education" }) {
  const education = kind === "education";
  const [data, setData] = useState<Invitations | null>(null), [link, setLink] = useState<{ url: string; expiresAt: string; qr: string } | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(""), [tick, setTick] = useState(0);
  useEffect(() => {
    let active = true;
    api<Invitations>(path).then((v) => active && setData(v)).catch((e) => active && setError(e.message));
    return () => { active = false; };
  }, [path, tick]);
  async function run(sub: string, made = false) {
    setBusy(true); setError("");
    try {
      const v = await api<Invitations & { token?: string; expiresAt?: string }>(path + sub, "POST", {}, crypto.randomUUID());
      setData(v);
      if (made && v.token) {
        // Phones need the public domain when this PC serves one; 127.0.0.1 only works on this PC.
        const pub = await api<{ origin: string | null }>("/public-origin").catch(() => ({ origin: null }));
        const url = `${pub.origin ?? location.origin}/join#t=${v.token}`;
        setLink({ url, expiresAt: v.expiresAt!, qr: await QRCode.toDataURL(url, { margin: 1, width: 240, errorCorrectionLevel: "M" }) });
      }
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const now = new Date().toISOString();
  return <section>
    <h3>참여 링크 · QR (QR 참여 1단계)</h3>
    <p className="muted">{education
      ? "참여 명단에 있고 명부에서 생년월일을 등록한 사람만 이름·생년월일로 참여를 기록합니다. 기록은 참석을 자동으로 바꾸지 않고 교육 이수를 뜻하지도 않으므로 아래 참여 명단에서 직접 기록하세요. 링크는 2시간 뒤 만료되고, 교육일지 내용을 고치거나 보관 확정하면 쓸 수 없습니다."
      : "명부에 있고 생년월일이 등록된 사람만 이름·생년월일로 참여를 기록합니다. 기록은 참석 상태를 자동으로 바꾸지 않으므로 아래 명부에서 직접 반영하세요. 링크는 2시간 뒤 만료되고, TBM 내용이 바뀌거나 확정되면 쓸 수 없습니다."}</p>
    {error && <p role="alert">{error}</p>}
    {writable && draft && <button disabled={busy} onClick={() => void run("", true)}>참여 링크 만들기</button>}
    {link && <p role="status">새 링크(지금 한 번만 표시): <input readOnly aria-label="참여 링크" value={link.url} onFocus={(e) => e.target.select()} /> <button onClick={() => void navigator.clipboard?.writeText(link.url)}>복사</button> · 만료 {new Date(link.expiresAt).toLocaleString()}<br /><img src={link.qr} width={240} height={240} alt="참여 링크 QR 코드" /> 화면을 근로자에게 보여 주거나 인쇄해 휴대폰 카메라로 읽게 하세요.{/^http:\/\/(127\.0\.0\.1|localhost)/.test(link.url) && " 이 링크는 이 PC에서만 열립니다. 휴대폰으로 쓰려면 \"외부 접속 설정\"을 먼저 켜세요."}</p>}
    {data && <>
      <ul>{data.invitations.map((i) => <li key={i.id}>{new Date(i.created_at).toLocaleString()} 발급 · {i.revoked_at ? "폐기됨" : i.expires_at <= now ? "만료" : !i.current ? (education ? "교육일지 내용 변경으로 사용 불가" : "TBM 내용 변경으로 사용 불가") : `유효(~${new Date(i.expires_at).toLocaleTimeString()})`}
        {writable && !i.revoked_at && i.expires_at > now && <button disabled={busy} onClick={() => void run(`/${i.id}/revoke`)}>폐기</button>}</li>)}</ul>
      <p>참여 기록 {data.events.length}건{data.events.length ? ": " + data.events.map((e) => `${e.worker_name}(${new Date(e.at).toLocaleTimeString()}${e.signed ? " · 서명" : e.decision === "deny" ? " · 서명 동의 안 함" : ""}${e.current ? "" : (education ? " · 이전 교육일지 내용" : " · 이전 TBM 버전")})`).join(", ") : ""}</p>
      {data.events.filter((e) => e.signed).map((e) => <figure key={e.id}><img src={`/api${path.replace("/invitations", "")}/participation/${e.id}/signature`} width={240} height={80} alt={`${e.worker_name} 서명`} /><figcaption>{e.worker_name} 서명 · {new Date(e.at).toLocaleString()}</figcaption></figure>)}
      <button disabled={busy} onClick={() => setTick((t) => t + 1)}>참여 기록 새로 조회</button>
    </>}
  </section>;
}
