import type { DatabaseSync } from "node:sqlite";

import { buildReplaySummaryFromAnalytics } from "./replay/replay-engine";
import { summarizeReplay, type ReplaySummaryReport } from "./replay/report";

type LatestRiskRow = {
  scope: string | null;
  mode: string;
  payloadJson: string;
  recordedAt: string;
};

type LatestPortfolioRow = {
  flattenPnlUsd: number | null;
  flattenPnlPct: number | null;
  netInventoryUsd: number | null;
  payloadJson: string;
  recordedAt: string;
};

export type ActiveMarketMonitorRow = {
  marketId: number;
  state: string;
  selectedMode: string | null;
  quoteBid: number | null;
  quoteAsk: number | null;
  quoteSizeUsd: number | null;
  bestBid: number | null;
  bestAsk: number | null;
  recordedAt: string;
};

export type RecentOrderMonitorRow = {
  marketId: number;
  orderHash: string | null;
  side: string;
  status: string;
  price: number | null;
  sizeUsd: number | null;
  recordedAt: string;
};

export type RecentFillMonitorRow = {
  marketId: number;
  orderHash: string | null;
  side: string | null;
  price: number | null;
  sizeUsd: number | null;
  inventoryDeltaUsd: number | null;
  recordedAt: string;
};

export type MonitorSnapshot = {
  generatedAt: string;
  risk: {
    scope: string | null;
    mode: string;
    reason: string | null;
    recordedAt: string | null;
  };
  portfolio: {
    flattenPnlUsd: number | null;
    flattenPnlPct: number | null;
    netInventoryUsd: number | null;
    recordedAt: string | null;
  };
  activeMarkets: ActiveMarketMonitorRow[];
  recentOrders: RecentOrderMonitorRow[];
  recentFills: RecentFillMonitorRow[];
  replay: ReplaySummaryReport;
};

export type MonitorSnapshotOptions = {
  activeMarketLimit?: number;
  recentOrderLimit?: number;
  recentFillLimit?: number;
};

export function buildMonitorSnapshot(
  database: DatabaseSync,
  options: MonitorSnapshotOptions = {}
): MonitorSnapshot {
  const activeMarketLimit = options.activeMarketLimit ?? 3;
  const recentOrderLimit = options.recentOrderLimit ?? 5;
  const recentFillLimit = options.recentFillLimit ?? 5;
  const latestRisk = selectLatestRisk(database);
  const latestPortfolio = selectLatestPortfolio(database);
  const activeMarkets = selectActiveMarkets(database, activeMarketLimit);
  const recentOrders = selectRecentOrders(database, recentOrderLimit);
  const recentFills = selectRecentFills(database, recentFillLimit);
  const replay = summarizeReplay(buildReplaySummaryFromAnalytics(database));
  const riskPayload = latestRisk ? parseUnknownJson(latestRisk.payloadJson) : {};

  return {
    generatedAt: new Date().toISOString(),
    risk: {
      scope: latestRisk?.scope ?? null,
      mode: latestRisk?.mode ?? "Unknown",
      reason: asString(riskPayload.reason),
      recordedAt: latestRisk?.recordedAt ?? null
    },
    portfolio: {
      flattenPnlUsd: latestPortfolio?.flattenPnlUsd ?? null,
      flattenPnlPct: latestPortfolio?.flattenPnlPct ?? null,
      netInventoryUsd: latestPortfolio?.netInventoryUsd ?? null,
      recordedAt: latestPortfolio?.recordedAt ?? null
    },
    activeMarkets,
    recentOrders,
    recentFills,
    replay
  };
}

export function formatMonitorSnapshot(snapshot: MonitorSnapshot): string {
  const lines = [
    `Updated: ${snapshot.generatedAt}`,
    `Risk: ${snapshot.risk.mode}${snapshot.risk.reason ? ` (${snapshot.risk.reason})` : ""}`,
    `Flatten PnL: ${formatUsd(snapshot.portfolio.flattenPnlUsd)} (${formatPercent(snapshot.portfolio.flattenPnlPct)})`,
    `Net Inventory: ${formatUsd(snapshot.portfolio.netInventoryUsd)}`,
    `Replay: fills=${snapshot.replay.fills}, score=${formatSeconds(snapshot.replay.scoreSeconds)}, defend=${formatSeconds(snapshot.replay.defendSeconds)}, pointsProxy=${formatDecimal(snapshot.replay.pointsProxy)}, adverse30=${formatBps(snapshot.replay.adverseMove30sBps)}, adverse60=${formatBps(snapshot.replay.adverseMove60sBps)}`,
    "",
    "Active markets:"
  ];

  if (snapshot.activeMarkets.length === 0) {
    lines.push("- none");
  } else {
    for (const market of snapshot.activeMarkets) {
      lines.push(
        `- ${market.marketId} ${market.state} mode=${market.selectedMode ?? "-"} quote=${formatQuote(
          market.quoteBid,
          market.quoteAsk,
          market.quoteSizeUsd
        )} book=${formatBook(market.bestBid, market.bestAsk)}`
      );
    }
  }

  lines.push("", "Recent orders:");

  if (snapshot.recentOrders.length === 0) {
    lines.push("- none");
  } else {
    for (const order of snapshot.recentOrders) {
      lines.push(
        `- ${order.recordedAt} ${order.status} market=${order.marketId} ${order.side} ${formatPrice(
          order.price
        )} size=${formatUsd(order.sizeUsd)} order=${order.orderHash ?? "-"}`
      );
    }
  }

  lines.push("", "Recent fills:");

  if (snapshot.recentFills.length === 0) {
    lines.push("- none");
  } else {
    for (const fill of snapshot.recentFills) {
      lines.push(
        `- ${fill.recordedAt} market=${fill.marketId} ${fill.side ?? "-"} ${formatPrice(
          fill.price
        )} size=${formatUsd(fill.sizeUsd)} invDelta=${formatUsd(fill.inventoryDeltaUsd)} order=${fill.orderHash ?? "-"}`
      );
    }
  }

  return lines.join("\n");
}

function selectLatestRisk(database: DatabaseSync): LatestRiskRow | null {
  const row = database
    .prepare(
      "SELECT scope, mode, payload_json, recorded_at FROM risk_events ORDER BY recorded_at DESC, id DESC LIMIT 1"
    )
    .get() as
    | {
        scope: string | null;
        mode: string;
        payload_json: string;
        recorded_at: string;
      }
    | undefined;

  if (!row) {
    return null;
  }

  return {
    scope: row.scope,
    mode: row.mode,
    payloadJson: row.payload_json,
    recordedAt: row.recorded_at
  };
}

function selectLatestPortfolio(database: DatabaseSync): LatestPortfolioRow | null {
  const row = database
    .prepare(
      "SELECT flatten_pnl_usd, flatten_pnl_pct, net_inventory_usd, payload_json, recorded_at FROM portfolio_snapshots ORDER BY recorded_at DESC, id DESC LIMIT 1"
    )
    .get() as
    | {
        flatten_pnl_usd: number | null;
        flatten_pnl_pct: number | null;
        net_inventory_usd: number | null;
        payload_json: string;
        recorded_at: string;
      }
    | undefined;

  if (!row) {
    return null;
  }

  return {
    flattenPnlUsd: row.flatten_pnl_usd,
    flattenPnlPct: row.flatten_pnl_pct,
    netInventoryUsd: row.net_inventory_usd,
    payloadJson: row.payload_json,
    recordedAt: row.recorded_at
  };
}

function selectActiveMarkets(
  database: DatabaseSync,
  limit: number
): ActiveMarketMonitorRow[] {
  const latestBooks = selectLatestBooksByMarket(database);
  const rows = database
    .prepare(
      `SELECT market_id, state, payload_json, recorded_at
       FROM market_state_events
       WHERE id IN (
         SELECT MAX(id) FROM market_state_events GROUP BY market_id
       )
       ORDER BY recorded_at DESC, id DESC
       LIMIT ?`
    )
    .all(limit) as Array<{
    market_id: number;
    state: string;
    payload_json: string;
    recorded_at: string;
  }>;

  return rows.map((row) => {
    const payload = parseUnknownJson(row.payload_json);
    const quotes = asRecord(payload.quotes);
    const latestBook = latestBooks.get(row.market_id);

    return {
      marketId: row.market_id,
      state: row.state,
      selectedMode: asString(payload.selectedMode),
      quoteBid: asNumber(quotes.bid),
      quoteAsk: asNumber(quotes.ask),
      quoteSizeUsd: asNumber(quotes.sizeUsd),
      bestBid: latestBook?.bestBid ?? null,
      bestAsk: latestBook?.bestAsk ?? null,
      recordedAt: row.recorded_at
    };
  });
}

function selectLatestBooksByMarket(
  database: DatabaseSync
): Map<number, { bestBid: number | null; bestAsk: number | null }> {
  const rows = database
    .prepare(
      `SELECT market_id, best_bid, best_ask
       FROM orderbook_events
       WHERE id IN (
         SELECT MAX(id) FROM orderbook_events GROUP BY market_id
       )`
    )
    .all() as Array<{
    market_id: number;
    best_bid: number | null;
    best_ask: number | null;
  }>;

  return new Map(
    rows.map((row) => [
      row.market_id,
      { bestBid: row.best_bid, bestAsk: row.best_ask }
    ])
  );
}

function selectRecentOrders(database: DatabaseSync, limit: number): RecentOrderMonitorRow[] {
  const rows = database
    .prepare(
      "SELECT market_id, order_hash, side, status, payload_json, recorded_at FROM orders ORDER BY recorded_at DESC, id DESC LIMIT ?"
    )
    .all(limit) as Array<{
    market_id: number;
    order_hash: string | null;
    side: string;
    status: string;
    payload_json: string;
    recorded_at: string;
  }>;

  return rows.map((row) => {
    const payload = parseUnknownJson(row.payload_json);

    return {
      marketId: row.market_id,
      orderHash: row.order_hash,
      side: row.side,
      status: row.status,
      price: asNumber(payload.price),
      sizeUsd: asNumber(payload.sizeUsd),
      recordedAt: row.recorded_at
    };
  });
}

function selectRecentFills(database: DatabaseSync, limit: number): RecentFillMonitorRow[] {
  const rows = database
    .prepare(
      "SELECT market_id, order_hash, payload_json, recorded_at FROM fills ORDER BY recorded_at DESC, id DESC LIMIT ?"
    )
    .all(limit) as Array<{
    market_id: number;
    order_hash: string | null;
    payload_json: string;
    recorded_at: string;
  }>;

  return rows.map((row) => {
    const payload = parseUnknownJson(row.payload_json);

    return {
      marketId: row.market_id,
      orderHash: row.order_hash,
      side: asString(payload.side),
      price: asNumber(payload.price),
      sizeUsd: asNumber(payload.sizeUsd),
      inventoryDeltaUsd: asNumber(payload.inventoryDeltaUsd),
      recordedAt: row.recorded_at
    };
  });
}

function parseUnknownJson(value: string): Record<string, unknown> {
  return asRecord(JSON.parse(value));
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatUsd(value: number | null): string {
  if (value === null) {
    return "n/a";
  }

  return `${value.toFixed(2)} USD`;
}

function formatPercent(value: number | null): string {
  if (value === null) {
    return "n/a";
  }

  return `${(value * 100).toFixed(2)}%`;
}

function formatDecimal(value: number): string {
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(2);
}

function formatSeconds(value: number): string {
  return `${Math.round(value)}s`;
}

function formatBps(value: number): string {
  return `${formatDecimal(value)}bps`;
}

function formatPrice(value: number | null): string {
  if (value === null) {
    return "n/a";
  }

  return value.toFixed(3).replace(/\.?0+$/, "");
}

function formatQuote(
  bid: number | null,
  ask: number | null,
  sizeUsd: number | null
): string {
  return `${formatPrice(bid)}/${formatPrice(ask)} size=${formatUsd(sizeUsd)}`;
}

function formatBook(bid: number | null, ask: number | null): string {
  return `${formatPrice(bid)}/${formatPrice(ask)}`;
}
