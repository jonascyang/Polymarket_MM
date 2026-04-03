export type QuoteMode = "Quote" | "Throttle" | "Protect" | "Pause" | "Stop";

export type BuildQuotesInput = {
  mode: QuoteMode;
  fairValue: number;
  inventoryUsd: number;
  maxInventoryUsd: number;
  tickSize: number;
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
  reservationPrice: number;
  baseHalfSpread: number;
  sizeUsd: number;
  canQuote: boolean;
};

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

  if (input.quoteBudgetUsd === undefined) {
    return defaultSize;
  }

  return Math.min(defaultSize, input.quoteBudgetUsd);
}

export function buildQuotes(input: BuildQuotesInput): QuotePlan {
  const baseHalfSpread = getBaseHalfSpread(input.mode, input.tickSize);
  const inventoryRatio = clamp(input.inventoryUsd / input.maxInventoryUsd, -1, 1);
  const reservationPrice = clamp(input.fairValue - inventoryRatio * baseHalfSpread, 0, 1);
  const canQuote =
    input.mode !== "Pause" &&
    input.mode !== "Stop" &&
    hasAggregateQuoteCapacity(input);
  const sizeUsd = canQuote ? getQuoteSizeUsd(input) : 0;
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
    reservationPrice,
    baseHalfSpread,
    sizeUsd,
    canQuote
  };
}
