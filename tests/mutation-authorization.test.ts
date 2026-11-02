import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import ts from "typescript";
import type { Request, Response } from "express";
import { openDatabase } from "../server/db.js";
import { siteOperations, HttpError } from "../server/site-operations.js";
function fixture() {
  const db = openDatabase(":memory:"),
    user = randomUUID(),
    site = randomUUID(),
    sid = randomUUID(),
    key = randomUUID(),
    csrf = "synthetic-csrf";
  db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(
    user,
    "synthetic@example.test",
    "Synthetic",
    "not-an-authenticating-hash",
  );
  db.prepare("INSERT INTO sites(id,name) VALUES(?,?)").run(site, "Synthetic");
  db.prepare("INSERT INTO memberships VALUES(?,?,?)").run(
    site,
    user,
    "manager",
  );
  const session = { userId: user, authEpoch: 1, issuedAt: Date.now(), csrf };
  const save = () =>
    db
      .prepare("INSERT OR REPLACE INTO sessions VALUES(?,?,?)")
      .run(sid, JSON.stringify(session), Date.now() + 60000);
  save();
  const req = {
    params: { siteId: site },
    sessionID: sid,
    session,
    get: () => key,
  } as unknown as Request;
  let result: unknown;
  const res = {
    json: (v: unknown) => {
      result = v;
    },
  } as Response;
  return {
    db,
    user,
    site,
    sid,
    req,
    res,
    save,
    result: () => result,
    ...siteOperations(db),
  };
}
test("all shared mutation callsites declare an explicit synchronous authorization guard", () => {
  let count = 0;
  for (const file of readdirSync("server").filter(
    (f) => f.endsWith(".ts") && f !== "site-operations.ts",
  )) {
    const source = ts.createSourceFile(
      file,
      readFileSync("server/" + file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    function visit(node: ts.Node) {
      if (
        ts.isCallExpression(node) &&
        node.expression.getText(source) === "mutate"
      ) {
        count++;
        assert.equal(
          node.arguments.length,
          6,
          file + ": required guard missing",
        );
        const guard = node.arguments[5];
        assert.ok(
          ts.isArrowFunction(guard) || ts.isIdentifier(guard),
          file + ": explicit guard required",
        );
        if (ts.isArrowFunction(guard))
          assert.ok(
            !guard.modifiers?.some(
              (m) => m.kind === ts.SyntaxKind.AsyncKeyword,
            ),
            file + ": guard must finish under lock",
          );
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  assert.equal(
    count,
    178, // 사고·아차사고 기록(작성·수정·확정·조사표 제출일·정정); 계정 발급(운영자 발급·초기화·권한, 현장 관리자 발급·초기화); SC 사진대지 순서; 작업계획 장비 계산(P-02); Phase69 education upload + attach-state; SC 현장 설정 PUT; SC 사진대지 표시본·항목; 교육내용 검수 기록; 사진 보드 생성·저장·사진·표시본; TBM 참여 링크 발급·폐기, 본인 확인값; 작업계획 양식 체크리스트; 현장 자료실 올리기·게시 중지.
    "Re-inventory changed mutation routes; this is a callsite count, not route coverage percentage.",
  );
});
test("locked guard runs before original action and historical receipt; revocation rolls back without receipt disclosure", () => {
  const f = fixture();
  try {
    let actions = 0,
      guards = 0;
    const call = () =>
      f.mutate(
        f.req,
        f.res,
        "synthetic:policy",
        {},
        () => {
          assert.equal(f.db.isTransaction, true);
          actions++;
          f.db
            .prepare("UPDATE sites SET version=version+1 WHERE id=?")
            .run(f.site);
          return { version: 2 };
        },
        () => {
          assert.equal(f.db.isTransaction, true);
          guards++;
          f.access(f.req, true, true);
        },
      );
    call();
    assert.deepEqual(f.result(), { version: 2 });
    assert.equal(actions, 1);
    assert.equal(guards, 1);
    f.db.prepare("UPDATE sites SET version=3 WHERE id=?").run(f.site);
    call();
    assert.deepEqual(f.result(), { version: 2 });
    assert.equal(actions, 1);
    assert.equal(guards, 2); // Historical receipt remains intentional, not current state.
    f.db
      .prepare(
        "UPDATE memberships SET role='viewer' WHERE site_id=? AND user_id=?",
      )
      .run(f.site, f.user);
    assert.throws(
      call,
      (e: unknown) => e instanceof HttpError && e.status === 403,
    );
    assert.equal(guards, 3);
    assert.equal(actions, 1);
    assert.equal(f.db.isTransaction, false);
    assert.equal(
      f.db.prepare("SELECT count(*) n FROM idempotency").get()?.n,
      1,
    );
  } finally {
    f.db.close();
  }
});
test("locked shared helper rejects missing persisted session, changed epoch or csrf before invoking guard/action", () => {
  const f = fixture();
  try {
    let guards = 0,
      actions = 0;
    const call = () =>
      f.mutate(
        f.req,
        f.res,
        "synthetic:session",
        {},
        () => {
          actions++;
          return {};
        },
        () => {
          guards++;
        },
      );
    f.db.prepare("DELETE FROM sessions WHERE sid=?").run(f.sid);
    assert.throws(
      call,
      (e: unknown) => e instanceof HttpError && e.status === 401,
    );
    f.save();
    f.db
      .prepare("UPDATE account_auth SET epoch=epoch+1 WHERE user_id=?")
      .run(f.user);
    assert.throws(
      call,
      (e: unknown) => e instanceof HttpError && e.status === 401,
    );
    f.db.prepare("UPDATE account_auth SET epoch=1 WHERE user_id=?").run(f.user);
    f.db
      .prepare(
        "UPDATE sessions SET data=json_set(data,'$.csrf','changed') WHERE sid=?",
      )
      .run(f.sid);
    assert.throws(
      call,
      (e: unknown) => e instanceof HttpError && e.status === 401,
    );
    assert.equal(guards, 0);
    assert.equal(actions, 0);
    assert.equal(
      f.db.prepare("SELECT count(*) n FROM idempotency").get()?.n,
      0,
    );
    assert.equal(f.db.isTransaction, false);
  } finally {
    f.db.close();
  }
});
