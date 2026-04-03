import { describe, expect, it } from "vitest";

import { selectActiveMarkets } from "../src/strategy/market-selector";

describe("selectActiveMarkets", () => {
  it("selects up to three active markets and rejects near-resolution tails", () => {
    const markets = [
      {
        id: 1,
        hoursToResolution: 72,
        mid: 0.42,
        spread: 0.01,
        spreadThreshold: 0.06,
        hasTwoSidedBook: true,
        volume24hUsd: 15000,
        isBoosted: false,
        isVisible: true,
        tradingStatus: "OPEN",
        marketVariant: "DEFAULT",
        isToxic: false,
        marketPool: "core_sports"
      },
      {
        id: 2,
        hoursToResolution: 4,
        mid: 0.95,
        spread: 0.01,
        spreadThreshold: 0.06,
        hasTwoSidedBook: true,
        volume24hUsd: 22000,
        isBoosted: true,
        isVisible: true,
        tradingStatus: "OPEN",
        marketVariant: "DEFAULT",
        isToxic: false,
        marketPool: "sports_match"
      }
    ];

    const result = selectActiveMarkets(markets);

    expect(result.active.map((market) => market.id)).toEqual([1]);
  });

  it("prioritizes core sports over boosted satellite tokens", () => {
    const result = selectActiveMarkets([
      {
        id: 10,
        hoursToResolution: 96,
        mid: 0.44,
        spread: 0.01,
        spreadThreshold: 0.06,
        hasTwoSidedBook: true,
        volume24hUsd: 30000,
        isBoosted: true,
        isVisible: true,
        tradingStatus: "OPEN",
        marketVariant: "DEFAULT",
        isToxic: false,
        marketPool: "satellite_token"
      },
      {
        id: 11,
        hoursToResolution: 90,
        mid: 0.48,
        spread: 0.02,
        spreadThreshold: 0.06,
        hasTwoSidedBook: true,
        volume24hUsd: 18000,
        isBoosted: false,
        isVisible: true,
        tradingStatus: "OPEN",
        marketVariant: "DEFAULT",
        isToxic: false,
        marketPool: "core_sports"
      },
      {
        id: 12,
        hoursToResolution: 88,
        mid: 0.53,
        spread: 0.02,
        spreadThreshold: 0.06,
        hasTwoSidedBook: true,
        volume24hUsd: 15000,
        isBoosted: false,
        isVisible: true,
        tradingStatus: "OPEN",
        marketVariant: "DEFAULT",
        isToxic: false,
        marketPool: "core_sports"
      },
      {
        id: 13,
        hoursToResolution: 86,
        mid: 0.51,
        spread: 0.01,
        spreadThreshold: 0.06,
        hasTwoSidedBook: true,
        volume24hUsd: 50000,
        isBoosted: true,
        isVisible: true,
        tradingStatus: "OPEN",
        marketVariant: "DEFAULT",
        isToxic: false,
        marketPool: "sports_match"
      },
      {
        id: 14,
        hoursToResolution: 86,
        mid: 0.51,
        spread: 0.08,
        spreadThreshold: 0.06,
        hasTwoSidedBook: true,
        volume24hUsd: 60000,
        isBoosted: false,
        isVisible: true,
        tradingStatus: "OPEN",
        marketVariant: "DEFAULT",
        isToxic: false,
        marketPool: "core_sports"
      }
    ]);

    expect(result.active.map((market) => market.id)).toEqual([11, 12, 10]);
    expect(result.active.map((market) => market.targetMode)).toEqual([
      "Score",
      "Defend",
      "Defend"
    ]);
  });
});
