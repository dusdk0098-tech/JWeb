import test from "node:test";
import assert from "node:assert/strict";
import { flushQueue } from "../src/outbox.js";
const refusal = (status: number, message: string) => Object.assign(new Error(message), { status });
async function run(items: string[], answers: Record<string, Error | null>) {
  const sent: string[] = [], settled: [string, string | null][] = [];
  const result = await flushQueue(items, async (i) => { sent.push(i); if (answers[i]) throw answers[i]; }, async (i, r) => { settled.push([i, r]); });
  return { result, sent, settled };
}
test("outbox sends in order and removes what the server accepted", async () => {
  assert.deepEqual(await run(["a", "b", "c"], {}), { result: "done", sent: ["a", "b", "c"], settled: [["a", null], ["b", null], ["c", null]] });
});
test("still offline, signed out or a server error: stop and keep everything that is left", async () => {
  for (const error of [new TypeError("Failed to fetch"), new SyntaxError("not JSON"), refusal(401, "로그인이 필요합니다."), refusal(500, "서버 오류"), refusal(503, "점검 중")])
    assert.deepEqual(await run(["a", "b", "c"], { b: error }), { result: "stopped", sent: ["a", "b"], settled: [["a", null]] }, error.message);
});
test("a refusal of one record (conflict, validation, no permission) is kept as refused and the rest still go", async () => {
  for (const status of [409, 400, 403, 404])
    assert.deepEqual(await run(["a", "b", "c"], { b: refusal(status, "거부 사유") }), { result: "done", sent: ["a", "b", "c"], settled: [["a", null], ["b", "거부 사유"], ["c", null]] }, String(status));
});
