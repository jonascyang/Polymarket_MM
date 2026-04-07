import { isEligibleMarket, type MarketCandidate } from "./market-filter";

export type SelectedMarketMode = "Quote" | "Protect";

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

function getMarketHealthPriority(market: MarketCandidate): number {
  switch (market.marketHealth) {
    case "active-safe":
      return 0;
    case "active-risky":
      return 1;
    case "inactive-or-toxic":
      return 2;
    default:
      return 1;
  }
}

function getWhitelistTierPriority(market: MarketCandidate): number {
  switch (market.whitelistTier) {
    case "active":
      return 0;
    case "watch":
      return 1;
    default:
      return 2;
  }
}

function compareMarketPriority(left: MarketCandidate, right: MarketCandidate): number {
  const healthPriorityDifference =
    getMarketHealthPriority(left) - getMarketHealthPriority(right);

  if (healthPriorityDifference !== 0) {
    return healthPriorityDifference;
  }

  const whitelistTierDifference =
    getWhitelistTierPriority(left) - getWhitelistTierPriority(right);

  if (whitelistTierDifference !== 0) {
    return whitelistTierDifference;
  }

  const poolPriorityDifference =
    getMarketPoolPriority(left) - getMarketPoolPriority(right);

  if (poolPriorityDifference !== 0) {
    return poolPriorityDifference;
  }

  const leftInventoryUsd = Math.abs(left.inventoryUsd ?? 0);
  const rightInventoryUsd = Math.abs(right.inventoryUsd ?? 0);

  if (leftInventoryUsd !== rightInventoryUsd) {
    return rightInventoryUsd - leftInventoryUsd;
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
  const eligibleMarkets = [...markets].filter(isEligibleMarket).sort(compareMarketPriority);
  const sportsMarkets = eligibleMarkets.filter((market) => market.marketPool === "core_sports");
  const tokenMarkets = eligibleMarkets.filter((market) => market.marketPool === "satellite_token");

  let selectedMarkets: MarketCandidate[];

  if (sportsMarkets.length > 0 && tokenMarkets.length > 0) {
    const guaranteedMarkets = [sportsMarkets[0], tokenMarkets[0]];
    const selectedIds = new Set(guaranteedMarkets.map((market) => market.id));
    const remainingMarkets = eligibleMarkets.filter((market) => !selectedIds.has(market.id));

    selectedMarkets = [...guaranteedMarkets];

    for (const market of remainingMarkets) {
      if (selectedMarkets.length >= 3) {
        break;
      }

      selectedMarkets.push(market);
    }

    selectedMarkets.sort(compareMarketPriority);
  } else {
    selectedMarkets = eligibleMarkets.slice(0, 3);
  }

  return {
    active: selectedMarkets.map((market, index) => ({
      ...market,
      targetMode: index === 0 ? "Quote" : "Protect"
    }))
  };
}
