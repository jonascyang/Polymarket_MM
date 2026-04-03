import { describe, expect, it } from "vitest";

import {
  isEligibleMarket,
  type MarketCandidate
} from "../src/strategy/market-filter";

function buildMarket(overrides: Partial<MarketCandidate> = {}): MarketCandidate {
  return {
    id: 1,
    hoursToResolution: 96,
    mid: 0.5,
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
    ...overrides
  };
}

describe("isEligibleMarket", () => {
  it("allows approved sports outrights", () => {
    expect(
      isEligibleMarket(
        buildMarket({
          marketPool: "core_sports",
          marketVariant: "DEFAULT",
          hoursToResolution: 168,
          volume24hUsd: 25000
        })
      )
    ).toBe(true);
  });

  it("allows approved token and FDV markets", () => {
    expect(
      isEligibleMarket(
        buildMarket({
          marketPool: "satellite_token",
          marketVariant: "DEFAULT",
          hoursToResolution: 120,
          volume24hUsd: 22000
        })
      )
    ).toBe(true);
  });

  it("rejects boosted match markets outside the approved pool", () => {
    expect(
      isEligibleMarket(
        buildMarket({
          marketPool: "sports_match",
          isBoosted: true,
          hoursToResolution: 6,
          marketVariant: "SPORTS_TEAM_MATCH",
          volume24hUsd: 30000
        })
      )
    ).toBe(false);
  });

  it("rejects one-sided books and wide spreads", () => {
    expect(
      isEligibleMarket(
        buildMarket({
          hasTwoSidedBook: false
        })
      )
    ).toBe(false);

    expect(
      isEligibleMarket(
        buildMarket({
          spread: 0.08
        })
      )
    ).toBe(false);
  });
});
