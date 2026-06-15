// Component test for the paywall. It reflects the contract PaywallOptions, offers a direct unlock
// when affordable, and never invents a price. No em dashes.

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Paywall } from "./Paywall.js";

describe("Paywall", () => {
  it("shows the cost and balance and a direct unlock when affordable", () => {
    render(
      <Paywall title="Premium ending" coinCost={5} balance={10} onChoose={() => {}} onDismiss={() => {}} />,
    );
    expect(screen.getByText(/costs 5 coins/i)).toBeInTheDocument();
    expect(screen.getByTestId("paywall-balance")).toHaveTextContent("10 coins");
    expect(screen.getByTestId("paywall-unlock")).toBeInTheDocument();
  });

  it("hides the direct unlock when the viewer cannot afford it", () => {
    render(
      <Paywall title="Premium ending" coinCost={5} balance={2} onChoose={() => {}} onDismiss={() => {}} />,
    );
    expect(screen.queryByTestId("paywall-unlock")).not.toBeInTheDocument();
  });

  it("renders exactly the server-offered options on a 402", () => {
    render(
      <Paywall
        title="Premium ending"
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
    expect(screen.queryByTestId("paywall-watch_ad")).not.toBeInTheDocument();
  });

  it("reports the chosen option", async () => {
    const onChoose = vi.fn();
    render(
      <Paywall title="Premium ending" coinCost={5} balance={10} onChoose={onChoose} onDismiss={() => {}} />,
    );
    await userEvent.click(screen.getByTestId("paywall-unlock"));
    expect(onChoose).toHaveBeenCalledWith("unlock");
  });

  it("is a labelled modal dialog", () => {
    render(
      <Paywall title="Premium ending" coinCost={5} balance={10} onChoose={() => {}} onDismiss={() => {}} />,
    );
    expect(screen.getByRole("dialog", { name: /unlock premium content/i })).toBeInTheDocument();
  });
});
