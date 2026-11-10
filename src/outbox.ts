// 오프라인 전송함 1단계: saves that never reached the server wait here (encrypted on the device, 7 days, wiped on logout)
// and are sent in order when the connection returns, on app start, or by hand. Text records only — no photos or files.
// A request keeps the idempotency key the editor made for it, so sending it twice still stores it once. Anything the server
// refuses (a newer version, a duplicate day) is kept as "보내지 못함" for the user to look at; nothing is overwritten.
import { api } from "./api";
import { deleteDraft, deleteQueued, listQueued, putQueued } from "./offline-draft";
export type OutboxRequest = { path: string; method: "POST" | "PUT"; body: unknown; key: string; label: string };
type Stored = OutboxRequest & { draftId: string; state: "queued" | "failed"; reason: string };
export type OutboxItem = Stored & { id: string; savedAt: string };
// Item ids an open editor in this tab is handling itself: it re-saves with its latest input when the connection returns.
export const ownedByEditor = new Set<string>();
const listeners = new Set<() => void>();
export function onOutboxChange(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
const changed = () => listeners.forEach((f) => f());
export async function readOutbox(): Promise<OutboxItem[]> {
  return (await listQueued<Stored>()).map((q) => ({ ...q.value, id: q.id, savedAt: q.savedAt }));
}
export async function enqueue(id: string, draftId: string, request: OutboxRequest) {
  await putQueued(id, { ...request, draftId, state: "queued", reason: "" } satisfies Stored);
  changed();
}
export async function dropOutbox(id: string) {
  await deleteQueued(id);
  changed();
}
const stored = (i: OutboxItem): Stored => ({ path: i.path, method: i.method, body: i.body, key: i.key, label: i.label, draftId: i.draftId, state: i.state, reason: i.reason });
// A refused item goes back to the queue only when the user asks for it.
export async function retryOutbox(item: OutboxItem) {
  await putQueued(item.id, { ...stored(item), state: "queued", reason: "" }, item.savedAt);
  await flushOutbox();
}
// Sends in order. A failure with no HTTP status (offline), 401 (signed out) or 5xx (server trouble) stops the run and keeps
// everything for later; any other refusal is the server's answer about that one record, so it is settled and the run goes on.
export async function flushQueue<T>(items: T[], send: (item: T) => Promise<unknown>, settle: (item: T, refusal: string | null) => Promise<void>) {
  for (const item of items) {
    try {
      await send(item);
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === undefined || status === 401 || status >= 500) return "stopped" as const;
      await settle(item, (e as Error).message);
      continue;
    }
    await settle(item, null);
  }
  return "done" as const;
}
let running = false;
export async function flushOutbox() {
  if (running) return;
  running = true;
  try {
    const run = async () => {
      const items = (await readOutbox()).filter((i) => i.state === "queued" && !ownedByEditor.has(i.id));
      await flushQueue(items, (i) => api(i.path, i.method, i.body, i.key), async (i, refusal) => {
        if (refusal !== null) return void (await putQueued(i.id, { ...stored(i), state: "failed", reason: refusal }, i.savedAt));
        await deleteQueued(i.id);
        if (i.method === "PUT") await deleteDraft(i.draftId); // the device copy of that record is now on the server
      });
    };
    // One tab sends at a time.
    if (navigator.locks) await navigator.locks.request("yweb-outbox", { ifAvailable: true }, async (lock) => { if (lock) await run(); });
    else await run();
  } finally {
    running = false;
    changed();
  }
}
