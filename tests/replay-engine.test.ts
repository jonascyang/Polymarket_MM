import { describe, expect, it } from "vitest";

import { openAnalyticsStore } from "../src/storage/sqlite";
import {
  buildReplaySummaryFromAnalytics,
  replayEvents
} from "../src/replay/replay-engine";
import { summarizeReplay } from "../src/replay/report";

describe("replayEvents", () => {
  it("accumulates phase-1 replay metrics from replay events", () => {
    const summary = replayEvents([
      { type: "fill", count: 2, marketId: 10 },
      { type: "state", state: "Score", durationSeconds: 120 },
      { type: "state", state: "Defend", durationSeconds: 480 },
      { type: "flatten", flattenPnlUsd: -0.5, flattenPnlPct: -0.01 },
      { type: "adverse_move", horizonSeconds: 30, bps: 200 },
      { type: "adverse_move", horizonSeconds: 60, bps: 400 },
      {
        type: "quote_lifetime",
        durationSeconds: 60,
        scorable: true,
        topOfBook: true,
        dualSided: false
      }
    ]);

    expect(summary).toEqual({
      fills: 2,
      perMarketFills: { 10: 2 },
      scoreSeconds: 120,
      defendSeconds: 480,
      flattenPnlUsd: -0.5,
      flattenPnlPct: -0.01,
      adverseMove30sBps: 200,
      adverseMove60sBps: 400,
      quoteSurvivalSeconds: 60,
      scorableQuoteSeconds: 60,
      topOfBookSeconds: 60,
      dualSidedQuoteSeconds: 0,
      pointsProxy: 180
    });
  });
});

describe("summarizeReplay", () => {
  it("reports phase-1 replay metrics", () => {
    const summary = summarizeReplay({
      fills: 4,
      perMarketFills: { 10: 3, 11: 1 },
      scoreSeconds: 120,
      defendSeconds: 480,
      flattenPnlUsd: -0.5,
      flattenPnlPct: -0.01,
      adverseMove30sBps: 200,
      adverseMove60sBps: 400,
      quoteSurvivalSeconds: 60,
      scorableQuoteSeconds: 90,
      topOfBookSeconds: 45,
      dualSidedQuoteSeconds: 30,
      pointsProxy: 225
    });

    expect(summary.flattenPnlUsd).toBe(-0.5);
    expect(summary.scoreSeconds).toBe(120);
    expect(summary.totalActiveSeconds).toBe(600);
    expect(summary.marketCountWithFills).toBe(2);
    expect(summary.pointsProxyPerActiveHour).toBe(1350);
  });
});

describe("buildReplaySummaryFromAnalytics", () => {
  it("derives phase-1 metrics from recorded analytics rows", () => {
    const database = openAnalyticsStore(":memory:");

    database
      .prepare(
        "INSERT INTO market_state_events (market_id, state, payload_json, recorded_at) VALUES (?, ?, ?, ?)"
      )
      .run(10, "Score", "{}", "2026-04-02T00:00:00.000Z");
    database
      .prepare(
        "INSERT INTO market_state_events (market_id, state, payload_json, recorded_at) VALUES (?, ?, ?, ?)"
      )
      .run(10, "Defend", "{}", "2026-04-02T00:02:00.000Z");
    database
      .prepare(
        "INSERT INTO market_state_events (market_id, state, payload_json, recorded_at) VALUES (?, ?, ?, ?)"
      )
      .run(10, "Observe", "{}", "2026-04-02T00:10:00.000Z");

    database
      .prepare(
        "INSERT INTO portfolio_snapshots (flatten_pnl_usd, flatten_pnl_pct, net_inventory_usd, payload_json, recorded_at) VALUES (?, ?, ?, ?, ?)"
      )
      .run(-0.5, -0.01, 0, "{}", "2026-04-02T00:10:00.000Z");

    database
      .prepare(
        "INSERT INTO orderbook_events (market_id, best_bid, best_ask, payload_json, recorded_at) VALUES (?, ?, ?, ?, ?)"
      )
      .run(
        10,
        0.5,
        0.52,
        JSON.stringify({ marketId: 10, bestBid: 0.5, bestAsk: 0.52 }),
        "2026-04-02T00:00:00.000Z"
      );
    database
      .prepare(
        "INSERT INTO orderbook_events (market_id, best_bid, best_ask, payload_json, recorded_at) VALUES (?, ?, ?, ?, ?)"
      )
      .run(
        10,
        0.48,
        0.5,
        JSON.stringify({ marketId: 10, bestBid: 0.48, bestAsk: 0.5 }),
        "2026-04-02T00:00:40.000Z"
      );
    database
      .prepare(
        "INSERT INTO orderbook_events (market_id, best_bid, best_ask, payload_json, recorded_at) VALUES (?, ?, ?, ?, ?)"
      )
      .run(
        10,
        0.47,
        0.49,
        JSON.stringify({ marketId: 10, bestBid: 0.47, bestAsk: 0.49 }),
        "2026-04-02T00:01:10.000Z"
      );

    database
      .prepare(
        "INSERT INTO fills (market_id, order_hash, payload_json, recorded_at) VALUES (?, ?, ?, ?)"
      )
      .run(
        10,
        "order-bid",
        JSON.stringify({
          orderId: "order-bid",
          side: "bid",
          price: 0.5,
          sizeUsd: 2
        }),
        "2026-04-02T00:00:10.000Z"
      );

    database
      .prepare(
        "INSERT INTO orders (market_id, order_hash, side, status, payload_json, recorded_at) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(
        10,
        "order-bid",
        "bid",
        "LIVE_OPEN",
        JSON.stringify({ id: "order-bid", marketId: 10, side: "bid", price: 0.5, sizeUsd: 5 }),
        "2026-04-02T00:00:00.000Z"
      );
    database
      .prepare(
        "INSERT INTO orders (market_id, order_hash, side, status, payload_json, recorded_at) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(
        10,
        "order-bid",
        "bid",
        "LIVE_CANCELLED",
        JSON.stringify({ id: "order-bid", marketId: 10, side: "bid", price: 0.5, sizeUsd: 5 }),
        "2026-04-02T00:01:00.000Z"
      );
    database
      .prepare(
        "INSERT INTO orders (market_id, order_hash, side, status, payload_json, recorded_at) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(
        10,
        "order-ask",
        "ask",
        "LIVE_OPEN",
        JSON.stringify({ id: "order-ask", marketId: 10, side: "ask", price: 0.52, sizeUsd: 5 }),
        "2026-04-02T00:00:10.000Z"
      );
    database
      .prepare(
        "INSERT INTO orders (market_id, order_hash, side, status, payload_json, recorded_at) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(
        10,
        "order-ask",
        "ask",
        "LIVE_CANCELLED",
        JSON.stringify({ id: "order-ask", marketId: 10, side: "ask", price: 0.52, sizeUsd: 5 }),
        "2026-04-02T00:01:10.000Z"
      );

    const summary = buildReplaySummaryFromAnalytics(database);

    expect(summary).toEqual({
      fills: 1,
      perMarketFills: { 10: 1 },
      scoreSeconds: 120,
      defendSeconds: 480,
      flattenPnlUsd: -0.5,
      flattenPnlPct: -0.01,
      adverseMove30sBps: 200,
      adverseMove60sBps: 400,
      quoteSurvivalSeconds: 60,
      scorableQuoteSeconds: 120,
      topOfBookSeconds: 120,
      dualSidedQuoteSeconds: 50,
      pointsProxy: 435
    });
  });
});
