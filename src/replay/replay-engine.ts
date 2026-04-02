import { DatabaseSync } from "node:sqlite";

import type { ReplaySummary } from "./report";

export type ReplayEvent =
  | {
      type: "fill";
      count: number;
      marketId?: number;
    }
  | {
      type: "state";
      state: "Score" | "Defend";
      durationSeconds: number;
    }
  | {
      type: "flatten";
      flattenPnlUsd: number;
      flattenPnlPct: number;
    }
  | {
      type: "adverse_move";
      horizonSeconds: 30 | 60;
      bps: number;
    }
  | {
      type: "quote_lifetime";
      durationSeconds: number;
      scorable: boolean;
      topOfBook: boolean;
      dualSided: boolean;
    };

type TimedRow<T> = T & {
  recordedAtMs: number;
};

type ReplayFillRow = TimedRow<{
  marketId: number;
  side: "bid" | "ask";
  price: number;
}>;

type MarketStateRow = TimedRow<{
  marketId: number;
  state: string;
}>;

type OrderbookRow = TimedRow<{
  marketId: number;
  bestBid: number | null;
  bestAsk: number | null;
}>;

type OrderLifecycleRow = TimedRow<{
  marketId: number;
  orderHash: string;
  side: "bid" | "ask";
  status: string;
  price: number;
}>;

type QuoteInterval = {
  marketId: number;
  side: "bid" | "ask";
  price: number;
  startMs: number;
  endMs: number;
};

const POINTS_PROXY_TOP_OF_BOOK_WEIGHT = 2;
const POINTS_PROXY_DUAL_SIDED_WEIGHT = 1.5;
const ADVERSE_MOVE_BPS_FACTOR = 20_000;

export function createEmptyReplaySummary(): ReplaySummary {
  return {
    fills: 0,
    perMarketFills: {},
    scoreSeconds: 0,
    defendSeconds: 0,
    flattenPnlUsd: 0,
    flattenPnlPct: 0,
    adverseMove30sBps: 0,
    adverseMove60sBps: 0,
    quoteSurvivalSeconds: 0,
    scorableQuoteSeconds: 0,
    topOfBookSeconds: 0,
    dualSidedQuoteSeconds: 0,
    pointsProxy: 0
  };
}

export function replayEvents(events: ReplayEvent[]): ReplaySummary {
  const summary = createEmptyReplaySummary();
  const quoteDurations: number[] = [];
  const adverseMoveTotals = {
    30: { total: 0, count: 0 },
    60: { total: 0, count: 0 }
  };

  for (const event of events) {
    switch (event.type) {
      case "fill":
        summary.fills += event.count;

        if (typeof event.marketId === "number") {
          summary.perMarketFills[event.marketId] =
            (summary.perMarketFills[event.marketId] ?? 0) + event.count;
        }
        break;
      case "state":
        if (event.state === "Score") {
          summary.scoreSeconds += event.durationSeconds;
        } else {
          summary.defendSeconds += event.durationSeconds;
        }
        break;
      case "flatten":
        summary.flattenPnlUsd = event.flattenPnlUsd;
        summary.flattenPnlPct = event.flattenPnlPct;
        break;
      case "adverse_move":
        adverseMoveTotals[event.horizonSeconds].total += event.bps;
        adverseMoveTotals[event.horizonSeconds].count += 1;
        break;
      case "quote_lifetime":
        quoteDurations.push(event.durationSeconds);
        summary.scorableQuoteSeconds += event.scorable ? event.durationSeconds : 0;
        summary.topOfBookSeconds += event.topOfBook ? event.durationSeconds : 0;
        summary.dualSidedQuoteSeconds += event.dualSided ? event.durationSeconds : 0;
        break;
    }
  }

  summary.quoteSurvivalSeconds =
    quoteDurations.length > 0
      ? quoteDurations.reduce((total, duration) => total + duration, 0) / quoteDurations.length
      : 0;
  summary.adverseMove30sBps =
    adverseMoveTotals[30].count > 0 ? adverseMoveTotals[30].total / adverseMoveTotals[30].count : 0;
  summary.adverseMove60sBps =
    adverseMoveTotals[60].count > 0 ? adverseMoveTotals[60].total / adverseMoveTotals[60].count : 0;
  summary.pointsProxy = computePointsProxy(summary);

  return summary;
}

export function buildReplaySummaryFromAnalytics(database: DatabaseSync): ReplaySummary {
  const fills = selectFillRows(database);
  const stateRows = selectMarketStateRows(database);
  const orderbookRows = selectOrderbookRows(database);
  const orderIntervals = selectOrderIntervals(database);
  const flattenSnapshot = selectLatestFlattenSnapshot(database);
  const perMarketStateRows = groupByMarket(stateRows);
  const perMarketOrderbooks = groupByMarket(orderbookRows);
  const fillEvents: ReplayEvent[] = fills.map((fill) => ({
    type: "fill",
    count: 1,
    marketId: fill.marketId
  }));
  const stateEvents = buildStateReplayEvents(stateRows);
  const adverseMoveEvents = fills.flatMap((fill) =>
    buildAdverseMoveEvents(fill, perMarketOrderbooks.get(fill.marketId) ?? [])
  );
  const quoteLifetimeEvents = orderIntervals.map((interval) =>
    buildQuoteLifetimeEvent(
      interval,
      perMarketStateRows.get(interval.marketId) ?? [],
      perMarketOrderbooks.get(interval.marketId) ?? [],
      orderIntervals
    )
  );

  const summary = replayEvents([
    ...fillEvents,
    ...stateEvents,
    {
      type: "flatten",
      flattenPnlUsd: flattenSnapshot?.flattenPnlUsd ?? 0,
      flattenPnlPct: flattenSnapshot?.flattenPnlPct ?? 0
    },
    ...adverseMoveEvents,
    ...quoteLifetimeEvents
  ]);

  summary.dualSidedQuoteSeconds = computeTotalDualSidedQuoteSeconds(orderIntervals);
  summary.pointsProxy = computePointsProxy(summary);

  return summary;
}

function computePointsProxy(summary: ReplaySummary): number {
  return (
    summary.scorableQuoteSeconds +
    summary.topOfBookSeconds * POINTS_PROXY_TOP_OF_BOOK_WEIGHT +
    summary.dualSidedQuoteSeconds * POINTS_PROXY_DUAL_SIDED_WEIGHT
  );
}

function toRecordedAtMs(recordedAt: string): number {
  return new Date(recordedAt).getTime();
}

function groupByMarket<T extends { marketId: number }>(rows: T[]): Map<number, T[]> {
  const grouped = new Map<number, T[]>();

  for (const row of rows) {
    const bucket = grouped.get(row.marketId);

    if (bucket) {
      bucket.push(row);
      continue;
    }

    grouped.set(row.marketId, [row]);
  }

  return grouped;
}

function selectFillRows(database: DatabaseSync): ReplayFillRow[] {
  const rows = database
    .prepare("SELECT market_id, payload_json, recorded_at FROM fills ORDER BY recorded_at ASC")
    .all() as Array<{
    market_id: number;
    payload_json: string;
    recorded_at: string;
  }>;

  return rows.flatMap((row) => {
    const payload = JSON.parse(row.payload_json) as {
      side?: "bid" | "ask";
      price?: number;
    };

    if ((payload.side !== "bid" && payload.side !== "ask") || typeof payload.price !== "number") {
      return [];
    }

    return [
      {
        marketId: row.market_id,
        side: payload.side,
        price: payload.price,
        recordedAtMs: toRecordedAtMs(row.recorded_at)
      }
    ];
  });
}

function selectMarketStateRows(database: DatabaseSync): MarketStateRow[] {
  const rows = database
    .prepare(
      "SELECT market_id, state, recorded_at FROM market_state_events ORDER BY market_id ASC, recorded_at ASC"
    )
    .all() as Array<{
    market_id: number;
    state: string;
    recorded_at: string;
  }>;

  return rows.map((row) => ({
    marketId: row.market_id,
    state: row.state,
    recordedAtMs: toRecordedAtMs(row.recorded_at)
  }));
}

function selectOrderbookRows(database: DatabaseSync): OrderbookRow[] {
  const rows = database
    .prepare(
      "SELECT market_id, best_bid, best_ask, recorded_at FROM orderbook_events ORDER BY market_id ASC, recorded_at ASC"
    )
    .all() as Array<{
    market_id: number;
    best_bid: number | null;
    best_ask: number | null;
    recorded_at: string;
  }>;

  return rows.map((row) => ({
    marketId: row.market_id,
    bestBid: row.best_bid,
    bestAsk: row.best_ask,
    recordedAtMs: toRecordedAtMs(row.recorded_at)
  }));
}

function selectOrderIntervals(database: DatabaseSync): QuoteInterval[] {
  const rows = database
    .prepare(
      "SELECT market_id, order_hash, side, status, payload_json, recorded_at FROM orders ORDER BY market_id ASC, order_hash ASC, recorded_at ASC"
    )
    .all() as Array<{
    market_id: number;
    order_hash: string | null;
    side: "bid" | "ask";
    status: string;
    payload_json: string;
    recorded_at: string;
  }>;
  const lifecycles = rows.flatMap((row) => {
    if (typeof row.order_hash !== "string") {
      return [];
    }

    const payload = JSON.parse(row.payload_json) as {
      price?: number;
    };

    if (typeof payload.price !== "number") {
      return [];
    }

    return [
      {
        marketId: row.market_id,
        orderHash: row.order_hash,
        side: row.side,
        status: row.status,
        price: payload.price,
        recordedAtMs: toRecordedAtMs(row.recorded_at)
      }
    ];
  });
  const byOrder = new Map<string, OrderLifecycleRow[]>();

  for (const row of lifecycles) {
    const key = `${row.marketId}:${row.orderHash}`;
    const bucket = byOrder.get(key);

    if (bucket) {
      bucket.push(row);
      continue;
    }

    byOrder.set(key, [row]);
  }

  return [...byOrder.values()].flatMap((rowsForOrder) => {
    const opened = rowsForOrder.find((row) => row.status.endsWith("_OPEN"));

    if (!opened) {
      return [];
    }

    const closed = rowsForOrder.find(
      (row) => row.recordedAtMs >= opened.recordedAtMs && !row.status.endsWith("_OPEN")
    );

    if (!closed || closed.recordedAtMs <= opened.recordedAtMs) {
      return [];
    }

    return [
      {
        marketId: opened.marketId,
        side: opened.side,
        price: opened.price,
        startMs: opened.recordedAtMs,
        endMs: closed.recordedAtMs
      }
    ];
  });
}

function selectLatestFlattenSnapshot(database: DatabaseSync): {
  flattenPnlUsd: number;
  flattenPnlPct: number;
} | null {
  const row = database
    .prepare(
      "SELECT flatten_pnl_usd, flatten_pnl_pct FROM portfolio_snapshots ORDER BY recorded_at DESC LIMIT 1"
    )
    .get() as
    | {
        flatten_pnl_usd: number | null;
        flatten_pnl_pct: number | null;
      }
    | undefined;

  if (!row) {
    return null;
  }

  return {
    flattenPnlUsd: row.flatten_pnl_usd ?? 0,
    flattenPnlPct: row.flatten_pnl_pct ?? 0
  };
}

function buildStateReplayEvents(stateRows: MarketStateRow[]): ReplayEvent[] {
  const events: ReplayEvent[] = [];

  for (let index = 0; index < stateRows.length - 1; index += 1) {
    const current = stateRows[index];
    const next = stateRows[index + 1];

    if (current.marketId !== next.marketId) {
      continue;
    }

    if (current.state !== "Score" && current.state !== "Defend") {
      continue;
    }

    events.push({
      type: "state",
      state: current.state,
      durationSeconds: (next.recordedAtMs - current.recordedAtMs) / 1000
    });
  }

  return events;
}

function buildAdverseMoveEvents(fill: ReplayFillRow, orderbooks: OrderbookRow[]): ReplayEvent[] {
  return [30, 60]
    .map((horizonSeconds) => {
      const targetTimestamp = fill.recordedAtMs + horizonSeconds * 1000;
      const orderbook = orderbooks.find((row) => row.recordedAtMs >= targetTimestamp);

      if (!orderbook || orderbook.bestBid === null || orderbook.bestAsk === null) {
        return null;
      }

      const mid = (orderbook.bestBid + orderbook.bestAsk) / 2;
      const rawMove = fill.side === "bid" ? fill.price - mid : mid - fill.price;
      const adverseMove = Math.max(0, rawMove);

      return {
        type: "adverse_move" as const,
        horizonSeconds: horizonSeconds as 30 | 60,
        bps: Math.round(adverseMove * ADVERSE_MOVE_BPS_FACTOR)
      };
    })
    .filter((event): event is Extract<ReplayEvent, { type: "adverse_move" }> => event !== null);
}

function buildQuoteLifetimeEvent(
  interval: QuoteInterval,
  stateRows: MarketStateRow[],
  orderbooks: OrderbookRow[],
  allIntervals: QuoteInterval[]
): Extract<ReplayEvent, { type: "quote_lifetime" }> {
  const durationSeconds = (interval.endMs - interval.startMs) / 1000;
  const stateAtOpen = findStateAtTimestamp(stateRows, interval.startMs);
  const orderbookAtOpen = findOrderbookAtTimestamp(orderbooks, interval.startMs);
  const topOfBook =
    !!orderbookAtOpen &&
    ((interval.side === "bid" && orderbookAtOpen.bestBid === interval.price) ||
      (interval.side === "ask" && orderbookAtOpen.bestAsk === interval.price));

  return {
    type: "quote_lifetime",
    durationSeconds,
    scorable: stateAtOpen === "Score" || stateAtOpen === "Defend",
    topOfBook,
    dualSided: false
  };
}

function findStateAtTimestamp(stateRows: MarketStateRow[], timestampMs: number): string | null {
  let activeState: string | null = null;

  for (const row of stateRows) {
    if (row.recordedAtMs > timestampMs) {
      break;
    }

    activeState = row.state;
  }

  return activeState;
}

function findOrderbookAtTimestamp(orderbooks: OrderbookRow[], timestampMs: number): OrderbookRow | null {
  let activeOrderbook: OrderbookRow | null = null;

  for (const row of orderbooks) {
    if (row.recordedAtMs > timestampMs) {
      break;
    }

    activeOrderbook = row;
  }

  return activeOrderbook;
}

function computeDualSidedSeconds(interval: QuoteInterval, allIntervals: QuoteInterval[]): number {
  return allIntervals
    .filter(
      (candidate) =>
        candidate.marketId === interval.marketId &&
        candidate.side !== interval.side &&
        candidate.startMs < interval.endMs &&
        candidate.endMs > interval.startMs
    )
    .reduce((total, candidate) => {
      const overlapMs = Math.min(interval.endMs, candidate.endMs) - Math.max(interval.startMs, candidate.startMs);

      return total + Math.max(0, overlapMs) / 1000;
    }, 0);
}

function computeTotalDualSidedQuoteSeconds(intervals: QuoteInterval[]): number {
  const byMarket = groupByMarket(intervals);
  let totalSeconds = 0;

  for (const marketIntervals of byMarket.values()) {
    const bids = marketIntervals.filter((interval) => interval.side === "bid");
    const asks = marketIntervals.filter((interval) => interval.side === "ask");

    for (const bid of bids) {
      for (const ask of asks) {
        const overlapMs = Math.min(bid.endMs, ask.endMs) - Math.max(bid.startMs, ask.startMs);

        if (overlapMs > 0) {
          totalSeconds += overlapMs / 1000;
        }
      }
    }
  }

  return totalSeconds;
}
