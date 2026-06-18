// Unit tests for the C12 auth-boundary classifier: anonymous-allowed vs session-required, fail-closed
// defaults, prefix matching, and path normalization.
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyRoute, requiresSession, normalizePath } from "./authBoundary.js";

test("anonymous-allowed routes do not require a session", () => {
  assert.equal(classifyRoute("POST", "/auth/verify"), "anonymous");
  assert.equal(classifyRoute("GET", "/profile/username-available?u=malena"), "anonymous");
  assert.equal(classifyRoute("GET", "/health"), "anonymous");
  assert.equal(requiresSession("POST", "/auth/verify"), false);
});

test("feed browse is anonymous, including sub-paths", () => {
  assert.equal(classifyRoute("GET", "/feed"), "anonymous");
  assert.equal(classifyRoute("GET", "/feed/trending"), "anonymous");
  assert.equal(classifyRoute("GET", "/feed/series/abc"), "anonymous");
});

test("wallet/save/download/consent style writes require a session", () => {
  assert.equal(classifyRoute("POST", "/profile"), "session");
  assert.equal(classifyRoute("GET", "/me"), "session");
  assert.equal(classifyRoute("POST", "/consent"), "session");
  assert.equal(requiresSession("POST", "/consent"), true);
});

test("unknown routes fail closed to session-required", () => {
  assert.equal(classifyRoute("GET", "/wallet"), "session");
  assert.equal(classifyRoute("POST", "/something/new"), "session");
  assert.equal(classifyRoute("DELETE", "/profile"), "session");
});

test("method must match for a rule to apply", () => {
  // /me is GET-only in the table; a POST /me is not the anonymous-or-session GET rule, so it fails closed.
  assert.equal(classifyRoute("POST", "/me"), "session");
  // /auth/verify is POST-only; a GET is unmatched -> fail closed.
  assert.equal(classifyRoute("GET", "/auth/verify"), "session");
});

test("normalizePath strips query and trailing slash but keeps root", () => {
  assert.equal(normalizePath("/me/"), "/me");
  assert.equal(normalizePath("/feed/?x=1"), "/feed");
  assert.equal(normalizePath("/"), "/");
  assert.equal(normalizePath("/auth/verify?token=abc"), "/auth/verify");
});

test("trailing slash does not change classification", () => {
  assert.equal(classifyRoute("GET", "/feed/"), "anonymous");
  assert.equal(classifyRoute("POST", "/consent/"), "session");
});
