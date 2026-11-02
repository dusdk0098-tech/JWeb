import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Writable } from "node:stream";
import { createElement } from "react";
import { renderToPipeableStream, renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import {
  deferredPanel,
  loadPanel,
  PanelLoadError,
  PanelLoadFailure,
  PanelLoadBoundary,
} from "../src/DeferredPanel.js";
test("lazy maintenance preserves App state/navigation/dirty/busy functions", () => {
  const before = readFileSync(
      new URL("./fixtures/ui2-main.tsx.txt", import.meta.url),
      "utf8",
    ).replace(/\r\n/g, "\n"),
    after = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8").replace(
      /\r\n/g,
      "\n",
    ),
    printer = ts.createPrinter();
  function bodies(text: string) {
    const file = ts.createSourceFile(
      "main.tsx",
      text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    return file.statements
      .filter((s) => !ts.isImportDeclaration(s))
      .map((s) => printer.printNode(ts.EmitHint.Unspecified, s, file));
  }
  // UI 개편 PR 2 reset the fixture to the current App (the shell moved to AppShell, the home to Home).
  // Later PRs add their exact substitutions below so the whole non-import AST is still compared.
  let expected = before;
  const changes: Array<[string, string]> = [];
  for (const [source, replacement] of changes) {
    assert.equal(expected.split(source).length, 2);
    expected = expected.replace(source, replacement);
  }
  assert.deepEqual(bodies(after), bodies(expected));
  const registry = readFileSync(
    new URL("../src/DomainPanels.tsx", import.meta.url),
    "utf8",
  );
  assert.equal((registry.match(/export const /g) || []).length, 21);
  assert.equal((registry.match(/\bimport\("\.\//g) || []).length, 42); // 21 type imports +21 dynamic expressions
});
test("panel download retry is explicit, props preserved, and business render errors are not hidden", async () => {
  let calls = 0;
  const Screen = ({ value }: { value: string }) =>
      createElement("p", null, value),
    loader = async () => {
      calls++;
      if (calls === 1) throw new Error("synthetic unavailable chunk");
      return { default: Screen };
    };
  await assert.rejects(loadPanel(loader), PanelLoadError);
  const recovered = await loadPanel(loader);
  assert.equal(calls, 2);
  assert.equal(
    renderToStaticMarkup(
      createElement(recovered.default, { value: "<synthetic>" }),
    ),
    "<p>&lt;synthetic&gt;</p>",
  );
  let retries = 0;
  const fallback = PanelLoadFailure({
    retry: () => {
      retries++;
    },
  });
  const button = fallback.props.children[1];
  button.props.onClick();
  assert.equal(retries, 1);
  const html = renderToStaticMarkup(fallback);
  assert.match(html, /현장\/메뉴 선택은 그대로/);
  assert.match(html, /저장 요청을 다시 보내는 동작이 아닙니다/);
  const boundary = new PanelLoadBoundary({
    retry: () => {},
    children: "loaded",
  });
  assert.equal(boundary.render(), "loaded");
  boundary.state = PanelLoadBoundary.getDerivedStateFromError(
    new PanelLoadError(),
  );
  assert.ok(boundary.render());
  const business = new Error("synthetic business rendering error");
  boundary.state = PanelLoadBoundary.getDerivedStateFromError(business);
  assert.throws(
    () => boundary.render(),
    (e) => e === business,
  );
});
test("deferred panel asynchronous server render forwards typed props without business API calls", async () => {
  const Screen = deferredPanel<{ siteId: string }>(async () => ({
    default: ({ siteId }) => createElement("p", null, "Selected " + siteId),
  }));
  const text = await new Promise<string>((resolve, reject) => {
    let output = "";
    const sink = new Writable({
      write(chunk, _encoding, done) {
        output += chunk.toString();
        done();
      },
    });
    sink.on("finish", () => resolve(output));
    const stream = renderToPipeableStream(
      createElement(Screen, { siteId: "synthetic-site" }),
      {
        onAllReady() {
          stream.pipe(sink);
        },
        onError: reject,
      },
    );
  });
  assert.match(text, /Selected synthetic-site/);
});
