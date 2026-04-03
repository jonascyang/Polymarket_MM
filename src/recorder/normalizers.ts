export type PredictOrderbookLevel = [number, number] | number[];

export type PredictOrderbookPayload = {
  marketId: number;
  updateTimestampMs: number;
  asks: PredictOrderbookLevel[];
  bids: PredictOrderbookLevel[];
  lastOrderSettled?: unknown;
};

export type NormalizedBookLevel = {
  price: number;
  size: number;
};

export type NormalizedOrderbookEvent = {
  topic: string;
  marketId: number;
  updateTimestampMs: number;
  sourceUpdateTimestampMs: number;
  bestBid: number | null;
  bestAsk: number | null;
  mid: number;
  spread: number;
  bids: NormalizedBookLevel[];
  asks: NormalizedBookLevel[];
  bidDepth1: number;
  askDepth1: number;
  bidDepth3: number;
  askDepth3: number;
  bidDepth5: number;
  askDepth5: number;
  imbalance1: number | null;
  imbalance3: number | null;
  imbalance5: number | null;
  payload: PredictOrderbookPayload;
};

function normalizeLevel(level: PredictOrderbookLevel | undefined): NormalizedBookLevel | null {
  const price = level?.[0];
  const size = level?.[1];

  if (
    typeof price !== "number" ||
    !Number.isFinite(price) ||
    typeof size !== "number" ||
    !Number.isFinite(size)
  ) {
    return null;
  }

  return { price, size };
}

function normalizeSide(
  levels: PredictOrderbookLevel[],
  side: "bid" | "ask"
): NormalizedBookLevel[] {
  const normalized = levels
    .map((level) => normalizeLevel(level))
    .filter((level): level is NormalizedBookLevel => level !== null);

  normalized.sort((left, right) =>
    side === "bid" ? right.price - left.price : left.price - right.price
  );

  return normalized.slice(0, 5);
}

function sumDepth(levels: NormalizedBookLevel[], depth: number): number {
  return levels.slice(0, depth).reduce((sum, level) => sum + level.size, 0);
}

function computeImbalance(
  bidDepth: number,
  askDepth: number
): number | null {
  const total = bidDepth + askDepth;

  if (total <= 0) {
    return null;
  }

  return Number(((bidDepth - askDepth) / total).toFixed(12));
}

function roundPrice(value: number): number {
  return Number(value.toFixed(12));
}

function resolveMid(bestBid: number | null, bestAsk: number | null): number {
  if (bestBid === null && bestAsk === null) {
    return 0.5;
  }

  if (bestBid === null) {
    return bestAsk as number;
  }

  if (bestAsk === null) {
    return bestBid;
  }

  return (bestBid + bestAsk) / 2;
}

function resolveRoundedMid(bestBid: number | null, bestAsk: number | null): number {
  return roundPrice(resolveMid(bestBid, bestAsk));
}

function resolveSpread(bestBid: number | null, bestAsk: number | null): number {
  if (bestBid === null || bestAsk === null) {
    return 1;
  }

  return roundPrice(bestAsk - bestBid);
}

export function normalizeOrderbookEvent(
  topic: string,
  payload: PredictOrderbookPayload
): NormalizedOrderbookEvent {
  const bids = normalizeSide(payload.bids, "bid");
  const asks = normalizeSide(payload.asks, "ask");
  const bestBid = bids[0]?.price ?? null;
  const bestAsk = asks[0]?.price ?? null;
  const bidDepth1 = sumDepth(bids, 1);
  const askDepth1 = sumDepth(asks, 1);
  const bidDepth3 = sumDepth(bids, 3);
  const askDepth3 = sumDepth(asks, 3);
  const bidDepth5 = sumDepth(bids, 5);
  const askDepth5 = sumDepth(asks, 5);

  return {
    topic,
    marketId: payload.marketId,
    updateTimestampMs: payload.updateTimestampMs,
    sourceUpdateTimestampMs: payload.updateTimestampMs,
    bestBid,
    bestAsk,
    mid: resolveRoundedMid(bestBid, bestAsk),
    spread: resolveSpread(bestBid, bestAsk),
    bids,
    asks,
    bidDepth1,
    askDepth1,
    bidDepth3,
    askDepth3,
    bidDepth5,
    askDepth5,
    imbalance1: computeImbalance(bidDepth1, askDepth1),
    imbalance3: computeImbalance(bidDepth3, askDepth3),
    imbalance5: computeImbalance(bidDepth5, askDepth5),
    payload
  };
}
