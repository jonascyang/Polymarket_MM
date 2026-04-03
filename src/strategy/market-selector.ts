import { isEligibleMarket, type MarketCandidate } from "./market-filter";

export type SelectedMarketMode = "Score" | "Defend";

export type ActiveMarket = MarketCandidate & {
  targetMode: SelectedMarketMode;
};

export type MarketSelectionResult = {
  active: ActiveMarket[];
};

function getMarketPoolPriority(market: MarketCandidate): number {
  switch (market.marketPool) {
    case "core_sports":
      return 0;
    case "satellite_token":
      return 1;
    default:
      return 2;
  }
}

function compareMarketPriority(left: MarketCandidate, right: MarketCandidate): number {
  const poolPriorityDifference =
    getMarketPoolPriority(left) - getMarketPoolPriority(right);

  if (poolPriorityDifference !== 0) {
    return poolPriorityDifference;
  }

  if (left.volume24hUsd !== right.volume24hUsd) {
    return right.volume24hUsd - left.volume24hUsd;
  }

  if (left.spread !== right.spread) {
    return left.spread - right.spread;
  }

  return left.hoursToResolution - right.hoursToResolution;
}

export function selectActiveMarkets(markets: MarketCandidate[]): MarketSelectionResult {
  const eligibleMarkets = [...markets].filter(isEligibleMarket).sort(compareMarketPriority).slice(0, 3);

  return {
    active: eligibleMarkets.map((market, index) => ({
      ...market,
      targetMode: index === 0 ? "Score" : "Defend"
    }))
  };
}
