import { useEffect, useState } from "react";
import { dropOutbox, flushOutbox, onOutboxChange, readOutbox, retryOutbox, type OutboxItem } from "./outbox";
// Every piece of text in a queued request, so a refused record can still be read and copied.
const texts = (v: unknown): string[] => (typeof v === "string" ? (v.trim() ? [v] : []) : v && typeof v === "object" ? Object.values(v).flatMap(texts) : []);
// 전송 대기: shown only while something is waiting or was refused. Sends on connection return, on app start and by hand.
export function OutboxStatus() {
  const [items, setItems] = useState<OutboxItem[]>([]), [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    const load = () => void readOutbox().then((v) => active && setItems(v));
    const off = onOutboxChange(load), online = () => void flushOutbox();
    load();
    window.addEventListener("online", online);
    if (navigator.onLine) void flushOutbox();
    return () => { active = false; off(); window.removeEventListener("online", online); };
  }, []);
  if (!items.length) return null;
  const queued = items.filter((i) => i.state === "queued"), refused = items.filter((i) => i.state === "failed");
  const run = async (action: () => Promise<void>) => { setBusy(true); try { await action(); } finally { setBusy(false); } };
  return (
    <details className="notice outbox">
      <summary>
        <span role="status">{[queued.length > 0 && `전송 대기 ${queued.length}건`, refused.length > 0 && `보내지 못함 ${refused.length}건`].filter(Boolean).join(" · ")}</span>
      </summary>
      <p>
        통신이 끊겨 서버에 닿지 못한 저장입니다. 이 기기에 암호화해 최대 7일 보관하고, 연결되면 차례로 보냅니다. 로그아웃하면
        지워집니다. 사진과 파일은 전송 대기에 넣지 않습니다.
      </p>
      {queued.length > 0 && <button type="button" disabled={busy} onClick={() => void run(flushOutbox)}>지금 보내기</button>}
      <ul>
        {items.map((i) => (
          <li key={i.id}>
            <strong>{i.label}</strong> · {new Date(i.savedAt).toLocaleString()} · {i.state === "queued" ? "전송 대기" : "보내지 못함"}
            {i.state === "failed" && (
              <>
                <p role="alert">{i.reason}</p>
                <p>
                  서버가 받지 않았습니다. 덮어쓰지 않고 그대로 두었습니다.
                  {i.method === "PUT" ? " 해당 기록을 열면 '기기 초안 복원'으로 최신본 위에 다시 저장할 수 있습니다." : " 아래 내용을 확인해 기존 기록에 직접 옮기세요."}
                </p>
                <details>
                  <summary>보내려던 내용 보기</summary>
                  <pre>{texts(i.body).join("\n")}</pre>
                </details>
                <button type="button" className="secondary" disabled={busy} onClick={() => void run(() => retryOutbox(i))}>다시 보내기</button>
              </>
            )}
            <button type="button" className="secondary" disabled={busy}
              onClick={() => { if (window.confirm(`${i.label}의 보내지 않은 저장을 이 기기에서 지울까요? 되돌릴 수 없습니다.`)) void run(() => dropOutbox(i.id)); }}>
              버리기
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
