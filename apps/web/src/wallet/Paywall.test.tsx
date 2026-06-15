// Component test for the paywall sheet. It shows the gold-lock alternate-ending card, offers a direct
// unlock when affordable, reflects the contract PaywallOptions on a 402, and never invents a price.
// No em dashes.

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PaywallSheet } from "./Paywall.js";

describe("PaywallSheet", () => {
  it("shows the alternate-ending card, balance, and a direct unlock when affordable", () => {
    render(<PaywallSheet coinCost={5} balance={10} onChoose={() => {}} onDismiss={() => {}} />);
    expect(screen.getByText(/Unlock the alternate ending/i)).toBeInTheDocument();
    expect(screen.getByTestId("paywall-balance")).toHaveTextContent("10 coins");
    expect(screen.getByTestId("paywall-unlock")).toHaveTextContent("Unlock for 5 coins");
  });

  it("hides the direct unlock when the viewer cannot afford it", () => {
    render(<PaywallSheet coinCost={5} balance={2} onChoose={() => {}} onDismiss={() => {}} />);
    expect(screen.queryByTestId("paywall-unlock")).not.toBeInTheDocument();
  });

  it("offers the rewarded-ad and maybe-later ghosts in the default (no 402) case", () => {
    render(<PaywallSheet coinCost={5} balance={10} onChoose={() => {}} onDismiss={() => {}} />);
    expect(screen.getByTestId("paywall-watch_ad")).toBeInTheDocument();
    expect(screen.getByTestId("paywall-dismiss")).toHaveTextContent(/maybe later/i);
  });

  it("renders exactly the server-offered options on a 402", () => {
    render(
      <PaywallSheet
        coinCost={5}
        balance={0}
        serverOptions={{ error: "insufficient_funds", options: ["buy", "subscribe"] }}
        onChoose={() => {}}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByTestId("paywall-error")).toHaveTextContent(/not have enough coins/i);
    expect(screen.getByTestId("paywall-buy")).toBeInTheDocument();
    expect(screen.getByTestId("paywall-subscribe")).toBeInTheDocument();
    // The default rewarded-ad ghost is replaced by the exact server option set on a 402.
    expect(screen.queryByTestId("paywall-watch_ad")).not.toBeInTheDocument();
  });

  it("reports the chosen option", async () => {
    const onChoose = vi.fn();
    render(<PaywallSheet coinCost={5} balance={10} onChoose={onChoose} onDismiss={() => {}} />);
    await userEvent.click(screen.getByTestId("paywall-unlock"));
    expect(onChoose).toHaveBeenCalledWith("unlock");
  });

  it("is a labelled modal dialog", () => {
    render(<PaywallSheet coinCost={5} balance={10} onChoose={() => {}} onDismiss={() => {}} />);
    expect(screen.getByRole("dialog", { name: /unlock premium content/i })).toBeInTheDocument();
  });
});
