import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Login } from "../src/Login.js";
import { Minutes } from "../src/Minutes.js";
import { SiteManagement } from "../src/SiteManagement.js";
import type { Site } from "../src/api.js";
const site: Site = {
  id: "synthetic-site",
  name: "<script>site</script>",
  version: 1,
  role: "manager",
};
// Server rendering checks only initial markup. It does not execute useEffect,
// browser events, asynchronous navigation, layout, or focus behavior.
test("extracted Login preserves bounded credential fields and escapes outer error", () => {
  const html = renderToStaticMarkup(
    createElement(Login, {
      onLogin: () => assert.fail("render must not log in"),
      error: "<script>error</script>",
    }),
  );
  assert.match(html, /<input type="text" required="" autoComplete="username" maxLength="254" name="email"\/>/); // e-mail or login ID
  assert.match(html, /maxLength="254"/);
  assert.match(html, /type="password"/);
  assert.match(html, /maxLength="128"/);
  assert.match(html, /autoComplete="current-password"/);
  assert.match(html, /role="alert"/);
  assert.match(html, /&lt;script&gt;error&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});
test("extracted meeting initial view retains loading, pagination and role-specific create button", () => {
  const render = (role: Site["role"]) =>
    renderToStaticMarkup(
      createElement(Minutes, {
        site: { ...site, role },
        open: () => assert.fail("render must not open editor"),
      }),
    );
  for (const role of ["manager", "editor"] as const)
    assert.match(render(role), /새 회의록/);
  const viewer = render("viewer");
  assert.doesNotMatch(viewer, /새 회의록/);
  assert.match(viewer, /불러오는 중/);
  assert.equal((viewer.match(/disabled=""/g) || []).length, 2);
});
test("extracted site management retains manager controls and least-privilege role default", () => {
  const html = renderToStaticMarkup(
    createElement(SiteManagement, {
      site,
      sites: [site],
      refresh: async () => assert.fail("render must not mutate"),
    }),
  );
  assert.match(html, /&lt;script&gt;site&lt;\/script&gt;/);
  assert.match(html, /이름 저장/);
  assert.match(html, /기존 계정 이메일/);
  assert.match(html, /<option value="viewer" selected="">/);
  assert.match(html, /마지막 관리자/);
  assert.doesNotMatch(html, /<script>/);
});
test("extracted site management hides member mutations from viewer or no selected site", () => {
  for (const selected of [{ ...site, role: "viewer" as const }, undefined]) {
    const html = renderToStaticMarkup(
      createElement(SiteManagement, {
        site: selected,
        sites: selected ? [selected] : [],
        refresh: async () => {},
      }),
    );
    assert.match(html, /현장 만들기/);
    assert.doesNotMatch(html, /기존 계정 이메일|이름 저장|접근 해제/);
  }
});
