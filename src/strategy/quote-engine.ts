export type QuoteMode = "Quote" | "Throttle" | "Protect" | "Pause" | "Stop";

export type QuoteBookLevel = {
  price: number;
  size: number;
};

export type BuildQuotesInput = {
  mode: QuoteMode;
  fairValue: number;
  inventoryUsd: number;
  maxInventoryUsd: number;
  tickSize: number;
  bestBid?: number | null;
  bestAsk?: number | null;
  bidBook?: QuoteBookLevel[];
  askBook?: QuoteBookLevel[];
  scoreQuoteSizeUsd?: number;
  defendQuoteSizeUsd?: number;
  quoteBudgetUsd?: number;
  aggregateNetInventoryUsd?: number;
  aggregateNetInventoryCapUsd?: number;
};

export type QuotePlan = {
  mode: QuoteMode;
  bid: number;
  ask: number;
  bidSizeUsd: number;
  askSizeUsd: number;
  reservationPrice: number;
  baseHalfSpread: number;
  sizeUsd: number;
  canQuote: boolean;
};

const MIN_PLATFORM_ORDER_VALUE_USD = 0.9;
const TOP_OF_BOOK_QUEUE_MULTIPLIER = 25;
const DEFAULT_VISIBLE_QUEUE_SHARE_CAP = 0.1;
const PRICE_EPSILON = 1e-9;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function floorToTick(value: number, tickSize: number): number {
  return Math.floor(value / tickSize) * tickSize;
}

function ceilToTick(value: number, tickSize: number): number {
  return Math.ceil(value / tickSize) * tickSize;
}

function getBaseHalfSpread(mode: QuoteMode, tickSize: number): number {
  switch (mode) {
    case "Quote":
    case "Throttle":
      return tickSize;
    case "Protect":
      return tickSize * 2;
    case "Pause":
    case "Stop":
      return tickSize * 8;
  }
}

function hasAggregateQuoteCapacity(input: BuildQuotesInput): boolean {
  if (
    input.aggregateNetInventoryUsd === undefined ||
    input.aggregateNetInventoryCapUsd === undefined
  ) {
    return true;
  }

  return Math.abs(input.aggregateNetInventoryUsd) < input.aggregateNetInventoryCapUsd;
}

function getQuoteSizeUsd(
  input: BuildQuotesInput,
  visibleQueueBudgetUsd?: number
): number {
  const defaultSize = input.mode === "Quote"
    ? (input.scoreQuoteSizeUsd ?? 6)
    : (input.defendQuoteSizeUsd ?? 4);
  const baseSize = Math.min(
    defaultSize,
    input.quoteBudgetUsd ?? Number.POSITIVE_INFINITY,
    visibleQueueBudgetUsd ?? Number.POSITIVE_INFINITY
  );

  if (baseSize < MIN_PLATFORM_ORDER_VALUE_USD) {
    return 0;
  }

  return baseSize;
}

function getQuoteSideAvailability(input: BuildQuotesInput): {
  bidEnabled: boolean;
  askEnabled: boolean;
} {
  if (input.mode !== "Protect") {
    return {
      bidEnabled: true,
      askEnabled: true
    };
  }

  if (input.inventoryUsd > 0) {
    return {
      bidEnabled: false,
      askEnabled: true
    };
  }

  if (input.inventoryUsd < 0) {
    return {
      bidEnabled: true,
      askEnabled: false
    };
  }

  if (input.bestBid != null && input.bestAsk == null) {
    return {
      bidEnabled: true,
      askEnabled: false
    };
  }

  if (input.bestBid == null && input.bestAsk != null) {
    return {
      bidEnabled: false,
      askEnabled: true
    };
  }

  return {
    bidEnabled: true,
    askEnabled: true
  };
}

function normalizeBookSide(
  levels: QuoteBookLevel[] | undefined,
  bestPrice: number | null | undefined
): QuoteBookLevel[] {
  const normalized = (levels ?? [])
    .filter(
      (level) =>
        Number.isFinite(level.price) &&
        Number.isFinite(level.size) &&
        level.size >= 0
    )
    .slice(0, 2);

  if (normalized.length > 0) {
    return normalized;
  }

  if (bestPrice == null || !Number.isFinite(bestPrice)) {
    return [];
  }

  return [{ price: bestPrice, size: 0 }];
}

function getVisibleQueueBudgetUsd(
  level: QuoteBookLevel | undefined,
  shareCap: number
): number | undefined {
  if (!level || level.size <= 0) {
    return undefined;
  }

  return level.price * level.size * shareCap;
}

function shouldPreferSecondLevel(
  firstLevel: QuoteBookLevel,
  secondLevel: QuoteBookLevel | undefined,
  orderSizeUsd: number,
  tickSize: number
): boolean {
  if (!secondLevel || orderSizeUsd <= 0) {
    return false;
  }

  return (
    Math.abs(firstLevel.price - secondLevel.price) <= tickSize + PRICE_EPSILON &&
    firstLevel.size >= orderSizeUsd * TOP_OF_BOOK_QUEUE_MULTIPLIER
  );
}

function validBidCandidates(levels: QuoteBookLevel[], bidCap: number): QuoteBookLevel[] {
  return levels
    .filter((level) => level.price <= bidCap + PRICE_EPSILON)
    .sort((left, right) => right.price - left.price);
}

function validAskCandidates(levels: QuoteBookLevel[], askFloor: number): QuoteBookLevel[] {
  return levels
    .filter((level) => level.price >= askFloor - PRICE_EPSILON)
    .sort((left, right) => left.price - right.price);
}

function selectBidQuote(
  levels: QuoteBookLevel[],
  bidCap: number,
  fallbackBid: number,
  bidSizeUsd: number,
  tickSize: number
): { price: number; level?: QuoteBookLevel } | null {
  if (levels.length === 0) {
    return { price: fallbackBid };
  }

  const valid = validBidCandidates(levels, bidCap);

  if (valid.length === 0) {
    return null;
  }

  if (shouldPreferSecondLevel(valid[0], valid[1], bidSizeUsd, tickSize)) {
    return { price: valid[1]!.price, level: valid[1]! };
  }

  return { price: valid[0]!.price, level: valid[0]! };
}

function selectAskQuote(
  levels: QuoteBookLevel[],
  askFloor: number,
  fallbackAsk: number,
  askSizeUsd: number,
  tickSize: number
): { price: number; level?: QuoteBookLevel } | null {
  if (levels.length === 0) {
    return { price: fallbackAsk };
  }

  const valid = validAskCandidates(levels, askFloor);

  if (valid.length === 0) {
    return null;
  }

  if (shouldPreferSecondLevel(valid[0], valid[1], askSizeUsd, tickSize)) {
    return { price: valid[1]!.price, level: valid[1]! };
  }

  return { price: valid[0]!.price, level: valid[0]! };
}

function isClosePrice(left: number, right: number): boolean {
  return Math.abs(left - right) <= PRICE_EPSILON;
}

export function isQuotePriceCompetitive(
  input: BuildQuotesInput,
  side: "bid" | "ask",
  price: number,
  sizeUsd: number
): boolean {
  if (input.mode === "Pause" || input.mode === "Stop" || sizeUsd <= 0) {
    return false;
  }

  const { bidEnabled, askEnabled } = getQuoteSideAvailability(input);

  if ((side === "bid" && !bidEnabled) || (side === "ask" && !askEnabled)) {
    return false;
  }

  const baseHalfSpread = getBaseHalfSpread(input.mode, input.tickSize);
  const inventoryRatio = clamp(input.inventoryUsd / input.maxInventoryUsd, -1, 1);
  const reservationPrice = clamp(input.fairValue - inventoryRatio * baseHalfSpread, 0, 1);
  const fallbackBid = clamp(
    floorToTick(reservationPrice - baseHalfSpread, input.tickSize),
    0,
    1
  );
  const fallbackAsk = clamp(
    ceilToTick(reservationPrice + baseHalfSpread, input.tickSize),
    0,
    1
  );

  if (side === "bid") {
    const levels = normalizeBookSide(input.bidBook, input.bestBid);

    if (levels.length === 0) {
      return isClosePrice(price, fallbackBid);
    }

    return validBidCandidates(levels, fallbackBid).some((level) =>
      isClosePrice(level.price, price)
    );
  }

  const levels = normalizeBookSide(input.askBook, input.bestAsk);

  if (levels.length === 0) {
    return isClosePrice(price, fallbackAsk);
  }

  return validAskCandidates(levels, fallbackAsk).some((level) =>
    isClosePrice(level.price, price)
  );
}

export function buildQuotes(input: BuildQuotesInput): QuotePlan {
  const baseHalfSpread = getBaseHalfSpread(input.mode, input.tickSize);
  const inventoryRatio = clamp(input.inventoryUsd / input.maxInventoryUsd, -1, 1);
  const reservationPrice = clamp(input.fairValue - inventoryRatio * baseHalfSpread, 0, 1);
  const { bidEnabled, askEnabled } = getQuoteSideAvailability(input);
  const canQuote =
    input.mode !== "Pause" &&
    input.mode !== "Stop" &&
    (bidEnabled || askEnabled) &&
    hasAggregateQuoteCapacity(input);
  const defaultQuoteSizeUsd = canQuote ? getQuoteSizeUsd(input) : 0;
  const provisionalBidSizeUsd = canQuote && bidEnabled ? defaultQuoteSizeUsd : 0;
  const provisionalAskSizeUsd = canQuote && askEnabled ? defaultQuoteSizeUsd : 0;
  const fallbackBid = clamp(
    floorToTick(reservationPrice - baseHalfSpread, input.tickSize),
    0,
    1
  );
  const fallbackAsk = clamp(
    ceilToTick(reservationPrice + baseHalfSpread, input.tickSize),
    0,
    1
  );
  const selectedBid = selectBidQuote(
    normalizeBookSide(input.bidBook, input.bestBid),
    fallbackBid,
    fallbackBid,
    provisionalBidSizeUsd,
    input.tickSize
  );
  const selectedAsk = selectAskQuote(
    normalizeBookSide(input.askBook, input.bestAsk),
    fallbackAsk,
    fallbackAsk,
    provisionalAskSizeUsd,
    input.tickSize
  );
  const bidVisibleQueueBudgetUsd = getVisibleQueueBudgetUsd(
    selectedBid?.level,
    DEFAULT_VISIBLE_QUEUE_SHARE_CAP
  );
  const askVisibleQueueBudgetUsd = getVisibleQueueBudgetUsd(
    selectedAsk?.level,
    DEFAULT_VISIBLE_QUEUE_SHARE_CAP
  );
  const bidSizeUsd =
    canQuote && selectedBid !== null && bidEnabled
      ? getQuoteSizeUsd(input, bidVisibleQueueBudgetUsd)
      : 0;
  const askSizeUsd =
    canQuote && selectedAsk !== null && askEnabled
      ? getQuoteSizeUsd(input, askVisibleQueueBudgetUsd)
      : 0;

  return {
    mode: input.mode,
    bid: selectedBid?.price ?? fallbackBid,
    ask: selectedAsk?.price ?? fallbackAsk,
    bidSizeUsd,
    askSizeUsd,
    reservationPrice,
    baseHalfSpread,
    sizeUsd: canQuote ? Math.max(bidSizeUsd, askSizeUsd) : 0,
    canQuote
  };
}
