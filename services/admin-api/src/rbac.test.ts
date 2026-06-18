// RBAC matrix tests. Assert the (role, route, method) allow/deny decision for the 8 roles, the ReadOnly
// rule (read yes, mutate no), per-route role scoping, and the deny-by-default for unknown routes. No em
// dashes.

import { test } from "node:test";
import assert from "node:assert/strict";

import { decide, classifyRoute, ROLES, type Role } from "./rbac.js";

test("classifyRoute maps concrete paths to policy keys", () => {
  assert.equal(classifyRoute("/admin/me"), "me");
  assert.equal(classifyRoute("/admin/dashboard"), "dashboard");
  assert.equal(classifyRoute("/admin/content"), "content");
  assert.equal(classifyRoute("/admin/content/11111111-1111-1111-1111-111111111111"), "content");
  assert.equal(classifyRoute("/admin/content/"), "content");
  assert.equal(classifyRoute("/admin/unknown"), "unknown");
  assert.equal(classifyRoute("/"), "unknown");
});

test("every role may GET its own identity, dashboard, and content", () => {
  for (const role of ROLES) {
    assert.equal(decide(role, "/admin/me", "GET").allow, true, `${role} GET /admin/me`);
    assert.equal(decide(role, "/admin/dashboard", "GET").allow, true, `${role} GET /admin/dashboard`);
    assert.equal(decide(role, "/admin/content", "GET").allow, true, `${role} GET /admin/content`);
    assert.equal(decide(role, "/admin/content/abc", "GET").allow, true, `${role} GET /admin/content/:id`);
  }
});

test("ReadOnly may GET but never mutate (read_only_violation, not role_forbidden)", () => {
  assert.equal(decide("ReadOnly", "/admin/content", "GET").allow, true);
  for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
    const v = decide("ReadOnly", "/admin/content", method);
    assert.equal(v.allow, false, `ReadOnly ${method} must be denied`);
    assert.equal(v.reason, "read_only_violation", `ReadOnly ${method} reason`);
  }
});

test("content writes: Owner/Admin/Content allowed, other roles read-only", () => {
  const writers: Role[] = ["Owner", "Admin", "Content"];
  for (const role of writers) {
    assert.equal(decide(role, "/admin/content", "POST").allow, true, `${role} may write content`);
  }
  const readers: Role[] = ["Finance", "Marketing", "Moderation", "Support", "ReadOnly"];
  for (const role of readers) {
    const v = decide(role, "/admin/content", "POST");
    assert.equal(v.allow, false, `${role} may not write content`);
    assert.equal(v.reason, "read_only_violation");
  }
});

test("unknown route is denied for every role and method (deny by default)", () => {
  for (const role of ROLES) {
    assert.equal(decide(role, "/admin/secret", "GET").allow, false);
    assert.equal(decide(role, "/admin/secret", "GET").reason, "unknown_route");
    assert.equal(decide(role, "/admin/secret", "POST").allow, false);
  }
});

test("Owner and Admin have full write across every surface", () => {
  for (const role of ["Owner", "Admin"] as Role[]) {
    assert.equal(decide(role, "/admin/dashboard", "POST").allow, true);
    assert.equal(decide(role, "/admin/me", "PATCH").allow, true);
    assert.equal(decide(role, "/admin/content", "DELETE").allow, true);
  }
});
