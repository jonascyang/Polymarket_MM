import { describe, expect, it } from "vitest";

import { nextMarketState } from "../src/strategy/state-machine";

describe("nextMarketState", () => {
  it("moves score markets into defend after a one-sided fill", () => {
    const next = nextMarketState("Score", {
      oneSidedFill: true,
      isToxic: false,
      inventoryUsd: 4,
      maxInventoryUsd: 15,
      minutesToExit: 180,
      riskMode: "Normal",
      isEligible: true
    });

    expect(next).toBe("Defend");
  });

  it("forces exit when the global risk controller triggers a hard stop", () => {
    const next = nextMarketState("Defend", {
      oneSidedFill: false,
      isToxic: false,
      inventoryUsd: 2,
      maxInventoryUsd: 15,
      minutesToExit: 180,
      riskMode: "HardStop",
      isEligible: true
    });

    expect(next).toBe("Exit");
  });
});
