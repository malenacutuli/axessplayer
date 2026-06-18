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

test("classifyRoute maps the section 4-6 surfaces", () => {
  assert.equal(classifyRoute("/admin/story-graph/abc"), "storyGraph");
  assert.equal(classifyRoute("/admin/story-graph/abc/validate"), "storyGraph");
  assert.equal(classifyRoute("/admin/story-graph/abc/simulate"), "storyGraph");
  assert.equal(classifyRoute("/admin/media-factory/jobs"), "mediaFactory");
  assert.equal(classifyRoute("/admin/accessibility"), "accessibility");
});

test("story-graph: reads open to all, validate/simulate writes gated to Content/Owner/Admin", () => {
  for (const role of ROLES) {
    assert.equal(decide(role, "/admin/story-graph/abc", "GET").allow, true, `${role} reads graph`);
    assert.equal(decide(role, "/admin/media-factory/jobs", "GET").allow, true, `${role} reads jobs`);
    assert.equal(decide(role, "/admin/accessibility", "GET").allow, true, `${role} reads a11y`);
  }
  const writers: Role[] = ["Owner", "Admin", "Content"];
  for (const role of writers) {
    assert.equal(decide(role, "/admin/story-graph/abc/validate", "POST").allow, true, `${role} validate`);
    assert.equal(decide(role, "/admin/story-graph/abc/simulate", "POST").allow, true, `${role} simulate`);
  }
  const readers: Role[] = ["Finance", "Marketing", "Moderation", "Support", "ReadOnly"];
  for (const role of readers) {
    const v = decide(role, "/admin/story-graph/abc/validate", "POST");
    assert.equal(v.allow, false, `${role} may not run the validate seam`);
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

// ---- Section 7-9 additions --------------------------------------------------------------------------

test("classifyRoute maps the section 7-9 surfaces and destructive seams", () => {
  assert.equal(classifyRoute("/admin/brands"), "brands");
  assert.equal(classifyRoute("/admin/brands/abc"), "brands");
  assert.equal(classifyRoute("/admin/campaigns"), "campaigns");
  assert.equal(classifyRoute("/admin/placements"), "placements");
  assert.equal(classifyRoute("/admin/users"), "users");
  assert.equal(classifyRoute("/admin/users/abc"), "users");
  assert.equal(classifyRoute("/admin/creators"), "creators");
  assert.equal(classifyRoute("/admin/creators/abc"), "creators");
  assert.equal(classifyRoute("/admin/payouts"), "payouts");
  // The destructive seams classify to their elevated-write surfaces, NOT to the underlying read surface,
  // so a delete/export is gdpr and a ban/refund is moderation (most-specific-first ordering).
  assert.equal(classifyRoute("/admin/users/abc/export"), "gdpr");
  assert.equal(classifyRoute("/admin/users/abc/delete"), "gdpr");
  assert.equal(classifyRoute("/admin/users/abc/ban"), "moderation");
  assert.equal(classifyRoute("/admin/users/abc/refund"), "moderation");
});

test("brands ad-plane: Marketing/Admin/Owner write, everyone else read-only", () => {
  for (const role of ["Marketing", "Admin", "Owner"] as Role[]) {
    assert.equal(decide(role, "/admin/brands", "GET").allow, true, `${role} reads brands`);
    assert.equal(decide(role, "/admin/brands", "POST").allow, true, `${role} writes brands`);
  }
  for (const role of ["Content", "Finance", "Moderation", "Support", "ReadOnly"] as Role[]) {
    assert.equal(decide(role, "/admin/brands", "GET").allow, true, `${role} reads brands`);
    const v = decide(role, "/admin/brands", "POST");
    assert.equal(v.allow, false, `${role} may not write brands`);
    assert.equal(v.reason, "read_only_violation");
  }
});

test("users surface: Support/Admin/Owner write, everyone else read-only; all read", () => {
  for (const role of ROLES) {
    assert.equal(decide(role, "/admin/users", "GET").allow, true, `${role} reads users`);
    assert.equal(decide(role, "/admin/users/abc", "GET").allow, true, `${role} reads a user`);
  }
  for (const role of ["Support", "Admin", "Owner"] as Role[]) {
    assert.equal(decide(role, "/admin/users", "POST").allow, true, `${role} writes users`);
  }
  for (const role of ["Content", "Finance", "Marketing", "Moderation", "ReadOnly"] as Role[]) {
    assert.equal(decide(role, "/admin/users", "POST").allow, false, `${role} may not write users`);
  }
});

test("creators surface: Admin/Owner write, all read; payouts: Finance/Owner write", () => {
  for (const role of ROLES) {
    assert.equal(decide(role, "/admin/creators", "GET").allow, true, `${role} reads creators`);
    assert.equal(decide(role, "/admin/payouts", "GET").allow, true, `${role} reads payouts`);
  }
  for (const role of ["Admin", "Owner"] as Role[]) {
    assert.equal(decide(role, "/admin/creators", "POST").allow, true, `${role} writes creators`);
  }
  for (const role of ["Content", "Finance", "Marketing", "Moderation", "Support", "ReadOnly"] as Role[]) {
    assert.equal(decide(role, "/admin/creators", "POST").allow, false, `${role} may not write creators`);
  }
  assert.equal(decide("Finance", "/admin/payouts", "POST").allow, true, "Finance writes payouts");
  assert.equal(decide("Owner", "/admin/payouts", "POST").allow, true, "Owner writes payouts");
  for (const role of ["Content", "Marketing", "Support", "ReadOnly"] as Role[]) {
    assert.equal(decide(role, "/admin/payouts", "POST").allow, false, `${role} may not write payouts`);
  }
});

test("destructive GDPR seams require an elevated write role (Admin/Owner only)", () => {
  for (const role of ["Admin", "Owner"] as Role[]) {
    assert.equal(decide(role, "/admin/users/abc/export", "POST").allow, true, `${role} may run gdpr export`);
    assert.equal(decide(role, "/admin/users/abc/delete", "POST").allow, true, `${role} may run gdpr delete`);
  }
  // Every non-elevated role (including Support, which owns the read surface) is denied the destructive seam.
  for (const role of ["Content", "Finance", "Marketing", "Moderation", "Support", "ReadOnly"] as Role[]) {
    const exp = decide(role, "/admin/users/abc/export", "POST");
    assert.equal(exp.allow, false, `${role} may not run gdpr export`);
    // gdpr is NONE for these roles, so the denial is role_forbidden (the surface is not theirs at all),
    // not merely read_only_violation.
    assert.equal(exp.reason, "role_forbidden", `${role} export denial reason`);
  }
});

test("ban requires Moderation/Admin/Owner; refund requires Finance/Moderation/Admin/Owner", () => {
  for (const role of ["Moderation", "Admin", "Owner"] as Role[]) {
    assert.equal(decide(role, "/admin/users/abc/ban", "POST").allow, true, `${role} may ban`);
    assert.equal(decide(role, "/admin/users/abc/refund", "POST").allow, true, `${role} may refund`);
  }
  assert.equal(decide("Finance", "/admin/users/abc/refund", "POST").allow, true, "Finance may refund");
  for (const role of ["Content", "Marketing", "Support", "ReadOnly"] as Role[]) {
    assert.equal(decide(role, "/admin/users/abc/ban", "POST").allow, false, `${role} may not ban`);
    assert.equal(decide(role, "/admin/users/abc/refund", "POST").allow, false, `${role} may not refund`);
  }
});

// ---- Section 10-12 additions: monetization, analytics, growth ---------------------------------------

test("classifyRoute maps the section 10-12 surfaces (including a pricing-edit sub-path)", () => {
  assert.equal(classifyRoute("/admin/monetization"), "monetization");
  assert.equal(classifyRoute("/admin/monetization/pricing"), "monetization");
  assert.equal(classifyRoute("/admin/analytics"), "analytics");
  assert.equal(classifyRoute("/admin/analytics?dim=funnel"), "analytics");
  assert.equal(classifyRoute("/admin/growth"), "growth");
});

test("monetization: read for all; pricing edit (write) only Finance/Admin/Owner", () => {
  for (const role of ROLES) {
    assert.equal(decide(role, "/admin/monetization", "GET").allow, true, `${role} reads monetization`);
  }
  for (const role of ["Finance", "Admin", "Owner"] as Role[]) {
    assert.equal(decide(role, "/admin/monetization/pricing", "POST").allow, true, `${role} edits pricing`);
  }
  for (const role of ["Content", "Marketing", "Moderation", "Support", "ReadOnly"] as Role[]) {
    const v = decide(role, "/admin/monetization/pricing", "POST");
    assert.equal(v.allow, false, `${role} may not edit pricing`);
    assert.equal(v.reason, "read_only_violation");
  }
});

test("analytics is a broad-read surface: every role reads, and there is no analytics write capability", () => {
  for (const role of ROLES) {
    assert.equal(decide(role, "/admin/analytics", "GET").allow, true, `${role} reads analytics`);
    // No role has write on analytics (it is a pure read surface): even Owner/Admin get read_only_violation.
    assert.equal(decide(role, "/admin/analytics", "POST").allow, false, `${role} cannot write analytics`);
    assert.equal(decide(role, "/admin/analytics", "POST").reason, "read_only_violation");
  }
});

test("growth: read for all; write only Marketing/Admin/Owner", () => {
  for (const role of ROLES) {
    assert.equal(decide(role, "/admin/growth", "GET").allow, true, `${role} reads growth`);
  }
  for (const role of ["Marketing", "Admin", "Owner"] as Role[]) {
    assert.equal(decide(role, "/admin/growth", "POST").allow, true, `${role} writes growth`);
  }
  for (const role of ["Content", "Finance", "Moderation", "Support", "ReadOnly"] as Role[]) {
    assert.equal(decide(role, "/admin/growth", "POST").allow, false, `${role} may not write growth`);
  }
});

// ---- Section 13-15 additions: moderation queue, trust, finance --------------------------------------

test("classifyRoute maps the section 13-15 surfaces and their seams", () => {
  assert.equal(classifyRoute("/admin/moderation/queue"), "moderationQueue");
  assert.equal(classifyRoute("/admin/moderation/policy"), "moderationQueue");
  assert.equal(classifyRoute("/admin/moderation/items/abc/takedown"), "moderationQueue");
  assert.equal(classifyRoute("/admin/trust/consent"), "trust");
  assert.equal(classifyRoute("/admin/trust/provenance"), "trust");
  assert.equal(classifyRoute("/admin/trust/gdpr"), "trust");
  // A trust consent /delete resolves to the trust surface, NOT to the generic gdpr (/delete) bucket.
  assert.equal(classifyRoute("/admin/trust/consent/abc/delete"), "trust");
  assert.equal(classifyRoute("/admin/trust/gdpr/abc/delete"), "trust");
  assert.equal(classifyRoute("/admin/finance"), "finance");
  // A finance payout-run resolves to the finance surface, not to a destructive bucket.
  assert.equal(classifyRoute("/admin/finance/payouts/run"), "finance");
});

test("moderation queue: read for all; action seams (write) only Moderation/Admin/Owner", () => {
  for (const role of ROLES) {
    assert.equal(decide(role, "/admin/moderation/queue", "GET").allow, true, `${role} reads queue`);
    assert.equal(decide(role, "/admin/moderation/policy", "GET").allow, true, `${role} reads policy`);
  }
  for (const role of ["Moderation", "Admin", "Owner"] as Role[]) {
    assert.equal(decide(role, "/admin/moderation/items/abc/takedown", "POST").allow, true, `${role} may take down`);
  }
  for (const role of ["Content", "Finance", "Marketing", "Support", "ReadOnly"] as Role[]) {
    const v = decide(role, "/admin/moderation/items/abc/takedown", "POST");
    assert.equal(v.allow, false, `${role} may not take down`);
    assert.equal(v.reason, "read_only_violation");
  }
});

test("trust: read for all; consent hard-delete + GDPR delete (write) only Admin/Owner", () => {
  for (const role of ROLES) {
    assert.equal(decide(role, "/admin/trust/consent", "GET").allow, true, `${role} reads consent`);
    assert.equal(decide(role, "/admin/trust/provenance", "GET").allow, true, `${role} reads provenance`);
  }
  for (const role of ["Admin", "Owner"] as Role[]) {
    assert.equal(decide(role, "/admin/trust/consent/abc/delete", "POST").allow, true, `${role} hard-deletes consent`);
    assert.equal(decide(role, "/admin/trust/gdpr/abc/delete", "POST").allow, true, `${role} GDPR deletes`);
  }
  for (const role of ["Content", "Finance", "Marketing", "Moderation", "Support", "ReadOnly"] as Role[]) {
    const v = decide(role, "/admin/trust/consent/abc/delete", "POST");
    assert.equal(v.allow, false, `${role} may not hard-delete consent`);
    assert.equal(v.reason, "read_only_violation");
  }
});

test("finance: read for all; payout-run (write) only Finance/Owner", () => {
  for (const role of ROLES) {
    assert.equal(decide(role, "/admin/finance", "GET").allow, true, `${role} reads finance`);
  }
  for (const role of ["Finance", "Owner"] as Role[]) {
    assert.equal(decide(role, "/admin/finance/payouts/run", "POST").allow, true, `${role} may run payouts`);
  }
  for (const role of ["Content", "Marketing", "Moderation", "Support", "ReadOnly"] as Role[]) {
    const v = decide(role, "/admin/finance/payouts/run", "POST");
    assert.equal(v.allow, false, `${role} may not run payouts`);
    assert.equal(v.reason, "read_only_violation");
  }
  // Admin also has full finance write (Owner/Admin see everything).
  assert.equal(decide("Admin", "/admin/finance/payouts/run", "POST").allow, true);
});

test("classifyRoute maps the section 16-17 surfaces", () => {
  assert.equal(classifyRoute("/admin/health"), "health");
  assert.equal(classifyRoute("/admin/health/"), "health");
  assert.equal(classifyRoute("/admin/settings/audit"), "settings");
  assert.equal(classifyRoute("/admin/settings/roles"), "settings");
  assert.equal(classifyRoute("/admin/settings/flags/new_player"), "settings");
});

test("health: read only Admin/Owner/Support; no write surface; others 403", () => {
  for (const role of ["Owner", "Admin", "Support"] as Role[]) {
    assert.equal(decide(role, "/admin/health", "GET").allow, true, `${role} reads health`);
  }
  for (const role of ["Content", "Finance", "Marketing", "Moderation", "ReadOnly"] as Role[]) {
    const v = decide(role, "/admin/health", "GET");
    assert.equal(v.allow, false, `${role} may not read health`);
    assert.equal(v.reason, "role_forbidden");
  }
});

test("settings: audit/roles read is broad; flag toggle (write) only Owner/Admin", () => {
  for (const role of ROLES) {
    assert.equal(decide(role, "/admin/settings/audit", "GET").allow, true, `${role} reads the audit trail`);
    assert.equal(decide(role, "/admin/settings/roles", "GET").allow, true, `${role} reads the roles grid`);
  }
  for (const role of ["Owner", "Admin"] as Role[]) {
    assert.equal(decide(role, "/admin/settings/flags/x", "POST").allow, true, `${role} toggles flags`);
  }
  for (const role of ["Content", "Finance", "Marketing", "Moderation", "Support", "ReadOnly"] as Role[]) {
    const v = decide(role, "/admin/settings/flags/x", "POST");
    assert.equal(v.allow, false, `${role} may not toggle flags`);
    assert.equal(v.reason, "read_only_violation");
  }
});
