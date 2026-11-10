import { useEffect, useRef, useState } from "react";
import { deleteDraft, loadDraft, saveDraft } from "./offline-draft";
import { dropOutbox, enqueue, flushOutbox, ownedByEditor, type OutboxRequest } from "./outbox";
export const OFFLINE_SAVE_FAILED = "통신이 끊겨 서버에 저장하지 못했습니다. 입력은 이 기기에 암호화해 7일간 보관합니다. 연결되면 자동으로 한 번 다시 저장합니다. 이 화면을 떠나도 전송 대기에 남습니다.";
// 오프라인 2단계: the encrypted device draft (stage 1) for any editor, plus one automatic save when the connection returns.
// The retry calls the editor's *current* save (via ref), so it sends the latest input with the latest server version — a
// server change in between still ends in the editor's normal 409 conflict, never a silent overwrite.
export function useOfflineDraft<T>(id: string, value: T, saved: T, editable: boolean, save: () => void) {
  const [local, setLocal] = useState<{ value: T; savedAt: string } | null>(null), [waiting, setWaiting] = useState(false);
  const differs = JSON.stringify(value) !== JSON.stringify(saved), latestSave = useRef(save), pending = useRef(false);
  latestSave.current = save;
  // 전송함: a save that failed offline is also queued, so it is sent even after this editor is closed. While the editor is
  // open it owns its queued item (the retry below sends the latest input instead); a new record gets an id per editor
  // instance so several new records written offline queue side by side.
  const instance = useRef("");
  instance.current ||= crypto.randomUUID();
  const newItem = `${id}#${instance.current}`;
  useEffect(() => {
    if (!editable) return;
    ownedByEditor.add(id);
    ownedByEditor.add(newItem);
    return () => { ownedByEditor.delete(id); ownedByEditor.delete(newItem); if (navigator.onLine) void flushOutbox(); };
  }, [id, newItem, editable]);
  useEffect(() => {
    if (!editable) return;
    let active = true;
    void loadDraft<T>(id).then((d) => { if (active && d && JSON.stringify(d.value) !== JSON.stringify(saved)) setLocal(d); });
    return () => { active = false; };
  }, [id]); // checked once per opened record
  useEffect(() => {
    if (!editable || !differs) return;
    const t = setTimeout(() => void saveDraft(id, value), 800);
    return () => clearTimeout(t);
  }, [editable, differs, id, value]);
  useEffect(() => {
    const online = () => { if (!pending.current) return; pending.current = false; setWaiting(false); latestSave.current(); };
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  }, []);
  return {
    local, waiting,
    discard() { void deleteDraft(id); void dropOutbox(id); setLocal(null); },
    // After a successful server save: the device copy is no longer needed.
    saved() { void deleteDraft(id); void dropOutbox(id); void dropOutbox(newItem); setLocal(null); pending.current = false; setWaiting(false); },
    // fetch rejects with TypeError only when the request never reached the server; anything else is the server's answer.
    failed(e: unknown, request?: OutboxRequest) {
      if (!(e instanceof TypeError)) return (e as Error).message;
      pending.current = true; setWaiting(true);
      if (request) {
        void enqueue(request.method === "POST" ? newItem : id, id, request);
        // A queued new record no longer needs the shared "new" draft slot; leaving it would offer an already queued record again.
        if (request.method === "POST") void deleteDraft(id);
      }
      return OFFLINE_SAVE_FAILED;
    },
  };
}
