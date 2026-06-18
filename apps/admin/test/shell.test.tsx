// Smoke tests for the operator console: the RBAC matrix gates, the nav has all 16 sections routed, and the
// shell renders the role chip + dashboard from the demo fixture (live API unreachable in the test env, so
// the data hooks fall back to the synthetic fixture). No em dashes.
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "../src/App";
import { RouterProvider } from "../src/router/router";
import { NAV_ITEMS } from "../src/shell/nav";
import { can, isReadOnly } from "../src/access/rbac";

describe("nav", () => {
  it("has all 16 sections, each routed under /admin", () => {
    expect(NAV_ITEMS).toHaveLength(16);
    for (const item of NAV_ITEMS) {
      expect(item.path.startsWith("/admin/")).toBe(true);
    }
  });
});

describe("rbac", () => {
  it("ReadOnly can view but cannot mutate", () => {
    expect(can("ReadOnly", "dashboard.view")).toBe(true);
    expect(can("ReadOnly", "content.edit")).toBe(false);
    expect(isReadOnly("ReadOnly")).toBe(true);
  });
  it("Owner can do everything; reward weights are view-only for all", () => {
    expect(can("Owner", "content.publish")).toBe(true);
    expect(can("Owner", "policy.view_reward_weights")).toBe(true);
    expect(can("ReadOnly", "policy.view_reward_weights")).toBe(true);
  });
  it("Finance can payout but not publish content", () => {
    expect(can("Finance", "billing.payout")).toBe(true);
    expect(can("Finance", "content.publish")).toBe(false);
  });
});

describe("shell", () => {
  it("renders the role chip and the dashboard from the demo fallback", async () => {
    window.history.pushState(null, "", "/admin/dashboard");
    render(
      <RouterProvider>
        <App />
      </RouterProvider>,
    );
    await waitFor(() => expect(screen.getByText(/Role: Owner/)).toBeInTheDocument());
    expect(screen.getByText("Operations overview")).toBeInTheDocument();
  });
});
