export type PredictOrderbookLevel = [number, number] | number[];

export type PredictOrderbookPayload = {
  marketId: number;
  updateTimestampMs: number;
  asks: PredictOrderbookLevel[];
  bids: PredictOrderbookLevel[];
  lastOrderSettled?: unknown;
};

export type NormalizedOrderbookEvent = {
  topic: string;
  marketId: number;
  updateTimestampMs: number;
  bestBid: number | null;
  bestAsk: number | null;
  payload: PredictOrderbookPayload;
};

function getPrice(level: PredictOrderbookLevel | undefined): number | null {
  if (!level || typeof level[0] !== "number") {
    return null;
  }

  return level[0];
}

export function normalizeOrderbookEvent(
  topic: string,
  payload: PredictOrderbookPayload
): NormalizedOrderbookEvent {
  const bestBid = payload.bids.reduce<number | null>((currentBest, level) => {
    const price = getPrice(level);

    if (price === null) {
      return currentBest;
    }

    if (currentBest === null || price > currentBest) {
      return price;
    }

    return currentBest;
  }, null);

  const bestAsk = payload.asks.reduce<number | null>((currentBest, level) => {
    const price = getPrice(level);

    if (price === null) {
      return currentBest;
    }

    if (currentBest === null || price < currentBest) {
      return price;
    }

    return currentBest;
  }, null);

  return {
    topic,
    marketId: payload.marketId,
    updateTimestampMs: payload.updateTimestampMs,
    bestBid,
    bestAsk,
    payload
  };
}
