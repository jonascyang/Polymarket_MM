import { describe, expect, it } from "vitest";

import { selectActiveMarkets } from "../src/strategy/market-selector";
import type { MarketCandidate } from "../src/strategy/market-filter";

describe("selectActiveMarkets", () => {
  it("selects up to three active markets and rejects near-resolution tails", () => {
    const markets: MarketCandidate[] = [
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
        marketPool: "core_sports",
        whitelistTier: "active"
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
        marketPool: "sports_match",
        whitelistTier: "watch"
      }
    ];

    const result = selectActiveMarkets(markets);

    expect(result.active.map((market) => market.id)).toEqual([1]);
  });

  it("prioritizes core sports over boosted satellite tokens", () => {
    const markets: MarketCandidate[] = [
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
        marketPool: "satellite_token",
        whitelistTier: "active"
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
        marketPool: "core_sports",
        whitelistTier: "active"
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
        marketPool: "core_sports",
        whitelistTier: "active"
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
        marketPool: "sports_match",
        whitelistTier: "watch"
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
        marketPool: "core_sports",
        whitelistTier: "active"
      }
    ];

    const result = selectActiveMarkets(markets);

    expect(result.active.map((market) => market.id)).toEqual([11, 12, 10]);
    expect(result.active.map((market) => market.targetMode)).toEqual([
      "Quote",
      "Protect",
      "Protect"
    ]);
  });

  it("prioritizes active whitelist ids ahead of watch ids within the same pool", () => {
    const markets: MarketCandidate[] = [
      {
        id: 1519,
        hoursToResolution: 96,
        mid: 0.44,
        spread: 0.01,
        spreadThreshold: 0.06,
        hasTwoSidedBook: true,
        volume24hUsd: 40000,
        isBoosted: false,
        isVisible: true,
        tradingStatus: "OPEN",
        marketVariant: "DEFAULT",
        isToxic: false,
        marketPool: "core_sports",
        whitelistTier: "watch"
      },
      {
        id: 1469,
        hoursToResolution: 96,
        mid: 0.44,
        spread: 0.01,
        spreadThreshold: 0.06,
        hasTwoSidedBook: true,
        volume24hUsd: 20000,
        isBoosted: false,
        isVisible: true,
        tradingStatus: "OPEN",
        marketVariant: "DEFAULT",
        isToxic: false,
        marketPool: "core_sports",
        whitelistTier: "active"
      }
    ];

    const result = selectActiveMarkets(markets);

    expect(result.active.map((market) => market.id)).toEqual([1469, 1519]);
  });

  it("keeps one satellite token slot when both pools are eligible", () => {
    const markets: MarketCandidate[] = [
      {
        id: 1518,
        hoursToResolution: 120,
        mid: 0.44,
        spread: 0.01,
        spreadThreshold: 0.06,
        hasTwoSidedBook: true,
        volume24hUsd: 60000,
        isBoosted: false,
        isVisible: true,
        tradingStatus: "OPEN",
        marketVariant: "DEFAULT",
        isToxic: false,
        marketPool: "core_sports",
        whitelistTier: "active"
      },
      {
        id: 1471,
        hoursToResolution: 120,
        mid: 0.44,
        spread: 0.01,
        spreadThreshold: 0.06,
        hasTwoSidedBook: true,
        volume24hUsd: 50000,
        isBoosted: false,
        isVisible: true,
        tradingStatus: "OPEN",
        marketVariant: "DEFAULT",
        isToxic: false,
        marketPool: "core_sports",
        whitelistTier: "active"
      },
      {
        id: 1523,
        hoursToResolution: 120,
        mid: 0.44,
        spread: 0.01,
        spreadThreshold: 0.06,
        hasTwoSidedBook: true,
        volume24hUsd: 40000,
        isBoosted: false,
        isVisible: true,
        tradingStatus: "OPEN",
        marketVariant: "DEFAULT",
        isToxic: false,
        marketPool: "core_sports",
        whitelistTier: "active"
      },
      {
        id: 933,
        hoursToResolution: 120,
        mid: 0.44,
        spread: 0.01,
        spreadThreshold: 0.06,
        hasTwoSidedBook: true,
        volume24hUsd: 30000,
        isBoosted: false,
        isVisible: true,
        tradingStatus: "OPEN",
        marketVariant: "DEFAULT",
        isToxic: false,
        marketPool: "satellite_token",
        whitelistTier: "active"
      }
    ];

    const result = selectActiveMarkets(markets);

    expect(result.active.map((market) => market.id)).toEqual([1518, 1471, 933]);
    expect(result.active.map((market) => market.targetMode)).toEqual([
      "Quote",
      "Protect",
      "Protect"
    ]);
  });

  it("prioritizes non-zero inventory markets within the same pool so residual positions stay managed", () => {
    const markets: MarketCandidate[] = [
      {
        id: 1518,
        hoursToResolution: 120,
        mid: 0.44,
        spread: 0.01,
        spreadThreshold: 0.06,
        hasTwoSidedBook: true,
        volume24hUsd: 60000,
        isBoosted: false,
        isVisible: true,
        tradingStatus: "OPEN",
        marketVariant: "DEFAULT",
        isToxic: false,
        marketPool: "core_sports",
        whitelistTier: "active",
        inventoryUsd: 0
      },
      {
        id: 1469,
        hoursToResolution: 120,
        mid: 0.44,
        spread: 0.01,
        spreadThreshold: 0.06,
        hasTwoSidedBook: true,
        volume24hUsd: 50000,
        isBoosted: false,
        isVisible: true,
        tradingStatus: "OPEN",
        marketVariant: "DEFAULT",
        isToxic: false,
        marketPool: "core_sports",
        whitelistTier: "active",
        inventoryUsd: -5.94
      },
      {
        id: 933,
        hoursToResolution: 120,
        mid: 0.44,
        spread: 0.01,
        spreadThreshold: 0.06,
        hasTwoSidedBook: true,
        volume24hUsd: 30000,
        isBoosted: false,
        isVisible: true,
        tradingStatus: "OPEN",
        marketVariant: "DEFAULT",
        isToxic: false,
        marketPool: "satellite_token",
        whitelistTier: "active",
        inventoryUsd: 0
      },
      {
        id: 991,
        hoursToResolution: 120,
        mid: 0.44,
        spread: 0.01,
        spreadThreshold: 0.06,
        hasTwoSidedBook: true,
        volume24hUsd: 15000,
        isBoosted: false,
        isVisible: true,
        tradingStatus: "OPEN",
        marketVariant: "DEFAULT",
        isToxic: false,
        marketPool: "satellite_token",
        whitelistTier: "active",
        inventoryUsd: 1.89
      }
    ];

    const result = selectActiveMarkets(markets);

    expect(result.active.map((market) => market.id)).toEqual([1469, 1518, 991]);
  });
});
