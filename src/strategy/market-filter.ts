export type MarketCandidate = {
  id: number;
  hoursToResolution: number;
  mid: number;
  spread: number;
  spreadThreshold: number;
  hasTwoSidedBook: boolean;
  volume24hUsd: number;
  isBoosted: boolean;
  isVisible: boolean;
  tradingStatus: string;
  marketVariant: string;
  isToxic: boolean;
  isLive?: boolean;
};

export function passesStructureFilter(market: MarketCandidate): boolean {
  return (
    market.tradingStatus === "OPEN" &&
    market.isVisible &&
    market.hoursToResolution >= 48 &&
    market.mid >= 0.1 &&
    market.mid <= 0.9 &&
    market.marketVariant !== "CRYPTO_UP_DOWN" &&
    !market.isLive
  );
}

export function passesLiquidityFilter(market: MarketCandidate): boolean {
  return (
    market.hasTwoSidedBook &&
    market.volume24hUsd >= 1000 &&
    market.spread <= Math.min(0.05, market.spreadThreshold * 0.8)
  );
}

export function passesToxicityFilter(market: MarketCandidate): boolean {
  return !market.isToxic;
}

export function isEligibleMarket(market: MarketCandidate): boolean {
  return (
    passesStructureFilter(market) &&
    passesLiquidityFilter(market) &&
    passesToxicityFilter(market)
  );
}
