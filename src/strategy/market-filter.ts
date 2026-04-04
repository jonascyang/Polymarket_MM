export type MarketPool = "core_sports" | "satellite_token" | "sports_match" | "other";
export type MarketHealth = "active-safe" | "active-risky" | "inactive-or-toxic";
export type WhitelistTier = "active" | "watch";

type RuntimeWhitelistEntry = {
  marketPool: "core_sports" | "satellite_token";
  whitelistTier: WhitelistTier;
};

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
  marketPool?: MarketPool;
  marketHealth?: MarketHealth;
  whitelistTier?: WhitelistTier;
};

const RUNTIME_MARKET_WHITELIST = new Map<number, RuntimeWhitelistEntry>([
  [1469, { marketPool: "core_sports", whitelistTier: "active" }],
  [1520, { marketPool: "core_sports", whitelistTier: "active" }],
  [1533, { marketPool: "core_sports", whitelistTier: "active" }],
  [1489, { marketPool: "core_sports", whitelistTier: "active" }],
  [1519, { marketPool: "core_sports", whitelistTier: "watch" }],
  [1532, { marketPool: "core_sports", whitelistTier: "watch" }],
  [1585, { marketPool: "core_sports", whitelistTier: "watch" }],
  [9331, { marketPool: "satellite_token", whitelistTier: "active" }],
  [940, { marketPool: "satellite_token", whitelistTier: "active" }],
  [9330, { marketPool: "satellite_token", whitelistTier: "active" }],
  [9327, { marketPool: "satellite_token", whitelistTier: "active" }],
  [993, { marketPool: "satellite_token", whitelistTier: "watch" }],
  [947, { marketPool: "satellite_token", whitelistTier: "watch" }]
]);

const APPROVED_MARKET_POOLS: ReadonlySet<MarketPool> = new Set([
  "core_sports",
  "satellite_token"
]);

export function passesWhitelistFilter(market: MarketCandidate): boolean {
  // Runtime wiring adds explicit pool labels in later tasks; keep current callers on legacy behavior until then.
  return market.marketPool === undefined || APPROVED_MARKET_POOLS.has(market.marketPool);
}

export function resolveRuntimeWhitelistEntry(
  marketId: number
): RuntimeWhitelistEntry | null {
  return RUNTIME_MARKET_WHITELIST.get(marketId) ?? null;
}

export function passesStructureFilter(market: MarketCandidate): boolean {
  return (
    market.tradingStatus === "OPEN" &&
    market.isVisible &&
    passesWhitelistFilter(market) &&
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
