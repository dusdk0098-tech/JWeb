import { useEffect, useRef, useState } from "react";
import { api, loadCsrf } from "./api";
import { EDUCATION_SIGNATURE_CONSENT, TBM_SIGNATURE_CONSENT } from "../server/consent-text";
// MOB-01: no-login participation page for a TBM or a 교육일지 (the invitation decides which). The token stays in the URL fragment, so it never reaches server logs.
// 2단계: the worker reads the consent text and either signs (grant) or records participation only (deny).
export function JoinPage() {
  const token = new URLSearchParams(location.hash.slice(1)).get("t") ?? "";
  const [info, setInfo] = useState<{ title: string; date: string; location: string; kind?: "education" } | null>(null), [name, setName] = useState(""), [birthDate, setBirthDate] = useState(""),
    [result, setResult] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false), [drawn, setDrawn] = useState(false);
  const pad = useRef<HTMLCanvasElement>(null), drawing = useRef(false);
  const education = info?.kind === "education", consent = education ? EDUCATION_SIGNATURE_CONSENT : TBM_SIGNATURE_CONSENT;
  useEffect(() => {
    loadCsrf().then(() => api<NonNullable<typeof info>>("/join/info", "POST", { token }))
      .then(setInfo).catch((e) => setError(e.message));
  }, [token]);
  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    return [((e.clientX - box.left) * e.currentTarget.width) / box.width, ((e.clientY - box.top) * e.currentTarget.height) / box.height] as const;
  };
  function clearPad() {
    const c = pad.current, g = c?.getContext("2d");
    if (c && g) { g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); }
    setDrawn(false);
  }
  useEffect(clearPad, [info]);
  async function submit(decision: "grant" | "deny") {
    setBusy(true); setError("");
    try {
      const signature = decision === "grant" ? pad.current!.toDataURL("image/png") : undefined;
      const r = await api<{ already: boolean; name: string; at: string; signed?: boolean }>("/join", "POST", { token, name, birthDate, consentVersion: consent.version, decision, signature });
      setResult(`${r.name}님의 참여를 ${r.already ? "이미 " : ""}기록했습니다${r.already ? "" : r.signed ? "(서명 포함)" : "(서명 없이)"} — ${new Date(r.at).toLocaleString()}. ${education ? "담당자가 확인한 뒤 교육 참석을 기록합니다. 이 기록만으로 교육 이수가 되지는 않습니다." : "담당자가 확인한 뒤 TBM 명부에 반영합니다."}`);
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  const ready = !busy && !!name.trim() && !!birthDate;
  return <main className="workspace">
    <section className="panel">
      <h1>{!info ? "참여 확인" : education ? "교육 참여 확인" : "TBM 참여 확인"}</h1>
      {info && <p>{info.title} · {info.date} · {info.location}</p>}
      <p>{education ? "교육 참여 명단" : "TBM 명부"}에 있는 이름과 생년월일을 입력하세요. 생년월일은 비교에만 쓰고 저장하지 않습니다.</p>
      {error && <p role="alert">{error}</p>}
      {result ? <p role="status">{result}</p> : info && <form onSubmit={(e) => e.preventDefault()}>
        <label>이름<input required maxLength={100} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label>생년월일<input required type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} /></label>
        <h2>서명 동의</h2>
        <p style={{ whiteSpace: "pre-wrap" }}>{consent.text}</p>
        <p>아래 칸에 손가락이나 마우스로 서명하세요.</p>
        <canvas ref={pad} width={600} height={200} role="img" aria-label={`서명 칸${drawn ? ", 서명함" : ", 비어 있음"}`} style={{ width: "100%", maxWidth: 600, border: "1px solid #888", touchAction: "none" }}
          onPointerDown={(e) => { drawing.current = true; e.currentTarget.setPointerCapture(e.pointerId); const g = e.currentTarget.getContext("2d")!, [x, y] = point(e); g.beginPath(); g.moveTo(x, y); }}
          onPointerMove={(e) => { if (!drawing.current) return; const g = e.currentTarget.getContext("2d")!, [x, y] = point(e); g.lineWidth = 3; g.lineCap = "round"; g.strokeStyle = "#111"; g.lineTo(x, y); g.stroke(); setDrawn(true); }}
          onPointerUp={() => { drawing.current = false; }} />
        <button type="button" disabled={busy} onClick={clearPad}>서명 지우기</button>
        <button type="button" disabled={!ready || !drawn} onClick={() => void submit("grant")}>동의하고 서명 제출</button>
        <button type="button" disabled={!ready} onClick={() => void submit("deny")}>동의하지 않고 참여만 기록</button>
      </form>}
    </section>
  </main>;
}
