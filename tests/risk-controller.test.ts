import { describe, expect, it } from "vitest";

import { estimateFlattenPnl } from "../src/risk/flatten-estimator";
import { evaluateRiskMode } from "../src/risk/risk-controller";

describe("estimateFlattenPnl", () => {
  it("subtracts fees and slippage from immediate flatten value", () => {
    const result = estimateFlattenPnl({
      accountEquityUsd: 100,
      realizedPnlUsd: 1.2,
      unrealizedPnlUsd: -0.4,
      estimatedFeesUsd: 0.1,
      estimatedSlippageUsd: 0.2
    });

    expect(result.flattenPnlUsd).toBeCloseTo(0.5);
    expect(result.flattenPnlPct).toBeCloseTo(0.005);
  });
});

describe("evaluateRiskMode", () => {
  it("triggers hard stop at -2 percent flatten pnl", () => {
    const result = evaluateRiskMode({
      flattenPnlPct: -0.021,
      peakDrawdownPct: -0.01
    });

    expect(result.mode).toBe("HardStop");
  });

  it("triggers soft stop when the market is inside the forced exit window", () => {
    const result = evaluateRiskMode({
      flattenPnlPct: -0.002,
      peakDrawdownPct: -0.002,
      minutesToExit: 45
    });

    expect(result.mode).toBe("SoftStop");
    expect(result.reduceOnly).toBe(true);
  });
});
