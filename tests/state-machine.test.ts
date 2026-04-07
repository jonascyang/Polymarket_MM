import { describe, expect, it } from "vitest";

import { nextMarketState } from "../src/strategy/state-machine";

describe("nextMarketState", () => {
  it("moves observe markets into quote when healthy and eligible", () => {
    const next = nextMarketState("Observe", {
      oneSidedFill: false,
      hasOneSidedBook: false,
      quoteToFillRatioHigh: false,
      shouldPause: false,
      isToxic: false,
      inventoryUsd: 0,
      maxInventoryUsd: 15,
      minutesToExit: 180,
      riskMode: "Normal",
      isEligible: true
    });

    expect(next).toBe("Quote");
  });

  it("moves quote markets into throttle on excessive quote churn", () => {
    const next = nextMarketState("Quote", {
      oneSidedFill: false,
      hasOneSidedBook: false,
      quoteToFillRatioHigh: true,
      shouldPause: false,
      isToxic: false,
      inventoryUsd: 0,
      maxInventoryUsd: 15,
      minutesToExit: 180,
      riskMode: "Normal",
      isEligible: true
    });

    expect(next).toBe("Throttle");
  });

  it("moves quote markets into protect on one-sided-book pressure", () => {
    const next = nextMarketState("Quote", {
      oneSidedFill: false,
      hasOneSidedBook: true,
      quoteToFillRatioHigh: false,
      shouldPause: false,
      isToxic: false,
      inventoryUsd: 0,
      maxInventoryUsd: 15,
      minutesToExit: 180,
      riskMode: "Normal",
      isEligible: true
    });

    expect(next).toBe("Protect");
  });

  it("moves quote markets into protect once inventory reaches 60% of the per-market cap", () => {
    const next = nextMarketState("Quote", {
      oneSidedFill: false,
      hasOneSidedBook: false,
      quoteToFillRatioHigh: false,
      shouldPause: false,
      isToxic: false,
      inventoryUsd: 9,
      maxInventoryUsd: 15,
      minutesToExit: 180,
      riskMode: "Normal",
      isEligible: true
    });

    expect(next).toBe("Protect");
  });

  it("moves protect markets back into quote once inventory and the book normalize", () => {
    const next = nextMarketState("Protect", {
      oneSidedFill: false,
      hasOneSidedBook: false,
      quoteToFillRatioHigh: false,
      shouldPause: false,
      isToxic: false,
      inventoryUsd: 2,
      maxInventoryUsd: 15,
      minutesToExit: 180,
      riskMode: "Normal",
      isEligible: true
    });

    expect(next).toBe("Quote");
  });

  it("pauses market-level execution before escalating to a global stop", () => {
    const paused = nextMarketState("Quote", {
      oneSidedFill: false,
      hasOneSidedBook: false,
      quoteToFillRatioHigh: false,
      shouldPause: true,
      isToxic: false,
      inventoryUsd: 0,
      maxInventoryUsd: 15,
      minutesToExit: 180,
      riskMode: "Normal",
      isEligible: true
    });

    expect(paused).toBe("Pause");

    const stopped = nextMarketState("Protect", {
      oneSidedFill: false,
      hasOneSidedBook: false,
      quoteToFillRatioHigh: false,
      shouldPause: false,
      isToxic: false,
      inventoryUsd: 0,
      maxInventoryUsd: 15,
      minutesToExit: 180,
      riskMode: "HardStop",
      isEligible: true
    });

    expect(stopped).toBe("Stop");
  });

  it("keeps legacy score and defend transitions compatible during migration", () => {
    const next = nextMarketState("Score", {
      oneSidedFill: true,
      hasOneSidedBook: false,
      quoteToFillRatioHigh: false,
      shouldPause: false,
      isToxic: false,
      inventoryUsd: 4,
      maxInventoryUsd: 15,
      minutesToExit: 180,
      riskMode: "Normal",
      isEligible: true
    });

    expect(next).toBe("Defend");
  });
});
