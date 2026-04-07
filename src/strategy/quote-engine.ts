export type QuoteMode = "Quote" | "Throttle" | "Protect" | "Pause" | "Stop";

export type BuildQuotesInput = {
  mode: QuoteMode;
  fairValue: number;
  inventoryUsd: number;
  maxInventoryUsd: number;
  tickSize: number;
  bestBid?: number | null;
  bestAsk?: number | null;
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
      return tickSize * 2;
    case "Throttle":
      return tickSize * 3;
    case "Protect":
      return tickSize * 4;
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

function getQuoteSizeUsd(input: BuildQuotesInput): number {
  const defaultSize = input.mode === "Quote"
    ? (input.scoreQuoteSizeUsd ?? 6)
    : (input.defendQuoteSizeUsd ?? 4);
  const baseSize = input.quoteBudgetUsd === undefined
    ? defaultSize
    : Math.min(defaultSize, input.quoteBudgetUsd);

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
  const sizeUsd = canQuote ? getQuoteSizeUsd(input) : 0;
  const bidSizeUsd = canQuote && bidEnabled ? sizeUsd : 0;
  const askSizeUsd = canQuote && askEnabled ? sizeUsd : 0;
  const bid = clamp(
    floorToTick(reservationPrice - baseHalfSpread, input.tickSize),
    0,
    1
  );
  const ask = clamp(
    ceilToTick(reservationPrice + baseHalfSpread, input.tickSize),
    0,
    1
  );

  return {
    mode: input.mode,
    bid,
    ask,
    bidSizeUsd,
    askSizeUsd,
    reservationPrice,
    baseHalfSpread,
    sizeUsd,
    canQuote
  };
}
