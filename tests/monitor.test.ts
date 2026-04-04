import { describe, expect, it } from "vitest";

import { buildMonitorSnapshot, formatMonitorSnapshot } from "../src/monitor";
import { openAnalyticsStore } from "../src/storage/sqlite";

describe("buildMonitorSnapshot", () => {
  it("summarizes current risk, active markets, recent orders, recent fills, and replay metrics", () => {
    const database = openAnalyticsStore(":memory:");

    database
      .prepare(
        "INSERT INTO risk_events (scope, mode, payload_json, recorded_at) VALUES (?, ?, ?, ?)"
      )
      .run("portfolio", "Normal", JSON.stringify({ reason: "normal" }), "2026-04-02T00:10:00.000Z");
    database
      .prepare(
        "INSERT INTO portfolio_snapshots (flatten_pnl_usd, flatten_pnl_pct, net_inventory_usd, payload_json, recorded_at) VALUES (?, ?, ?, ?, ?)"
      )
      .run(
        -0.25,
        -0.005,
        8,
        JSON.stringify({
          aggregateNetInventoryUsd: 8,
          privateState: {
            bearerTokenPresent: true,
            accountAddress: "0xabc",
            openOrders: 2,
            normalizedOpenOrders: 1,
            positions: 1,
            positionMarketIds: [110620],
            hasUnnormalizedOpenOrders: true
          }
        }),
        "2026-04-02T00:10:00.000Z"
      );

    database
      .prepare(
        "INSERT INTO market_state_events (market_id, state, payload_json, recorded_at) VALUES (?, ?, ?, ?)"
      )
      .run(999, "Quote", "{}", "2026-04-02T00:00:00.000Z");
    database
      .prepare(
        "INSERT INTO market_state_events (market_id, state, payload_json, recorded_at) VALUES (?, ?, ?, ?)"
      )
      .run(999, "Protect", "{}", "2026-04-02T00:02:00.000Z");
    database
      .prepare(
        "INSERT INTO market_state_events (market_id, state, payload_json, recorded_at) VALUES (?, ?, ?, ?)"
      )
      .run(999, "Observe", "{}", "2026-04-02T00:10:00.000Z");

    database
      .prepare(
        "INSERT INTO market_state_events (market_id, state, payload_json, recorded_at) VALUES (?, ?, ?, ?)"
      )
      .run(
        110620,
        "Quote",
        JSON.stringify({
          marketId: 110620,
          selectedMode: "Quote",
          nextState: "Quote",
          quotes: { bid: 0.32, ask: 0.37, bidSizeUsd: 6, askSizeUsd: 6, sizeUsd: 6 }
        }),
        "2026-04-02T00:12:00.000Z"
      );
    database
      .prepare(
        "INSERT INTO market_state_events (market_id, state, payload_json, recorded_at) VALUES (?, ?, ?, ?)"
      )
      .run(
        1520,
        "Protect",
        JSON.stringify({
          marketId: 1520,
          selectedMode: "Protect",
          nextState: "Protect",
          quotes: { bid: 0.12, ask: 0.129, bidSizeUsd: 0, askSizeUsd: 4, sizeUsd: 4 }
        }),
        "2026-04-02T00:11:00.000Z"
      );

    database
      .prepare(
        "INSERT INTO market_regime_snapshots (market_id, current_state, is_boosted, volume24h_usd, mid, spread, trade_age_ms, is_toxic, payload_json, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        110620,
        "Quote",
        1,
        18000,
        0.345,
        0.01,
        1000,
        0,
        JSON.stringify({ bestBid: 0.34, bestAsk: 0.35, quoteCountSinceFill: 2 }),
        "2026-04-02T00:10:00.000Z"
      );
    database
      .prepare(
        "INSERT INTO market_regime_snapshots (market_id, current_state, is_boosted, volume24h_usd, mid, spread, trade_age_ms, is_toxic, payload_json, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        1520,
        "Protect",
        0,
        15000,
        0.1245,
        0.009,
        2000,
        0,
        JSON.stringify({ bestBid: 0.12, bestAsk: 0.129, quoteCountSinceFill: 7 }),
        "2026-04-02T00:09:00.000Z"
      );

    database
      .prepare(
        "INSERT INTO orderbook_events (market_id, best_bid, best_ask, payload_json, recorded_at) VALUES (?, ?, ?, ?, ?)"
      )
      .run(
        110620,
        0.34,
        0.35,
        JSON.stringify({ marketId: 110620, bestBid: 0.34, bestAsk: 0.35 }),
        "2026-04-02T00:10:00.000Z"
      );

    database
      .prepare(
        "INSERT INTO orders (market_id, order_hash, side, status, payload_json, recorded_at) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(
        110620,
        "order-1",
        "bid",
        "LIVE_OPEN",
        JSON.stringify({
          id: "order-1",
          marketId: 110620,
          side: "bid",
          price: 0.32,
          sizeUsd: 6
        }),
        "2026-04-02T00:10:00.000Z"
      );
    database
      .prepare(
        "INSERT INTO orders (market_id, order_hash, side, status, payload_json, recorded_at) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(
        1520,
        "order-2",
        "ask",
        "LIVE_CANCELLED",
        JSON.stringify({
          id: "order-2",
          marketId: 1520,
          side: "ask",
          price: 0.129,
          sizeUsd: 4
        }),
        "2026-04-02T00:09:30.000Z"
      );

    database
      .prepare(
        "INSERT INTO fills (market_id, order_hash, payload_json, recorded_at) VALUES (?, ?, ?, ?)"
      )
      .run(
        110620,
        "order-1",
        JSON.stringify({
          orderId: "order-1",
          side: "bid",
          price: 0.32,
          sizeUsd: 2,
          inventoryDeltaUsd: 2
        }),
        "2026-04-02T00:10:05.000Z"
      );

    const snapshot = buildMonitorSnapshot(database, { activeMarketLimit: 2 });
    const text = formatMonitorSnapshot(snapshot);

    expect(snapshot.risk.mode).toBe("Normal");
    expect(snapshot.portfolio.flattenPnlUsd).toBe(-0.25);
    expect(snapshot.portfolio.netInventoryUsd).toBe(8);
    expect(snapshot.privateState).toEqual({
      bearerTokenPresent: true,
      accountAddress: "0xabc",
      openOrders: 2,
      normalizedOpenOrders: 1,
      positions: 1,
      positionMarketIds: [110620],
      hasUnnormalizedOpenOrders: true
    });
    expect(snapshot.activeMarkets).toEqual([
      expect.objectContaining({
        marketId: 110620,
        state: "Quote",
        selectedMode: "Quote",
        quoteBid: 0.32,
        quoteAsk: 0.37,
        quoteBidSizeUsd: 6,
        quoteAskSizeUsd: 6,
        health: "active-safe",
        bestBid: 0.34,
        bestAsk: 0.35
      }),
      expect.objectContaining({
        marketId: 1520,
        state: "Protect",
        selectedMode: "Protect",
        quoteBid: 0.12,
        quoteAsk: 0.129,
        quoteBidSizeUsd: 0,
        quoteAskSizeUsd: 4,
        health: "active-risky"
      })
    ]);
    expect(snapshot.recentOrders).toEqual([
      expect.objectContaining({
        marketId: 110620,
        orderHash: "order-1",
        side: "bid",
        status: "LIVE_OPEN",
        price: 0.32,
        sizeUsd: 6
      }),
      expect.objectContaining({
        marketId: 1520,
        orderHash: "order-2",
        side: "ask",
        status: "LIVE_CANCELLED",
        price: 0.129,
        sizeUsd: 4
      })
    ]);
    expect(snapshot.recentFills).toEqual([
      expect.objectContaining({
        marketId: 110620,
        orderHash: "order-1",
        side: "bid",
        price: 0.32,
        sizeUsd: 2
      })
    ]);
    expect(snapshot.replay.fills).toBe(1);
    expect(snapshot.replay.pointsProxy).toBeGreaterThanOrEqual(0);
    expect(text).toContain("Risk: Normal");
    expect(text).toContain("Flatten PnL: -0.25 USD (-0.50%)");
    expect(text).toContain("Private state:");
    expect(text).toContain("Replay metrics:");
    expect(text).toContain("quote=120s");
    expect(text).toContain("protect=480s");
    expect(text).toContain("health=active-safe");
    expect(text).toContain("JWT=yes");
    expect(text).toContain("account=0xabc");
    expect(text).toContain("110620");
    expect(text).toContain("order-1");
  });

  it("formats a colorized terminal view that highlights risk and sections", () => {
    const database = openAnalyticsStore(":memory:");

    database
      .prepare(
        "INSERT INTO risk_events (scope, mode, payload_json, recorded_at) VALUES (?, ?, ?, ?)"
      )
      .run("portfolio", "HardStop", JSON.stringify({ reason: "drawdown" }), "2026-04-02T00:10:00.000Z");
    database
      .prepare(
        "INSERT INTO portfolio_snapshots (flatten_pnl_usd, flatten_pnl_pct, net_inventory_usd, payload_json, recorded_at) VALUES (?, ?, ?, ?, ?)"
      )
      .run(-2.5, -0.025, 12, JSON.stringify({ aggregateNetInventoryUsd: 12 }), "2026-04-02T00:10:00.000Z");
    database
      .prepare(
        "INSERT INTO market_state_events (market_id, state, payload_json, recorded_at) VALUES (?, ?, ?, ?)"
      )
      .run(
        110620,
        "Stop",
        JSON.stringify({
          marketId: 110620,
          selectedMode: "Quote",
          nextState: "Stop",
          quotes: { bid: 0.32, ask: 0.37, bidSizeUsd: 6, askSizeUsd: 6, sizeUsd: 6 }
        }),
        "2026-04-02T00:10:00.000Z"
      );

    const snapshot = buildMonitorSnapshot(database);
    const text = formatMonitorSnapshot(snapshot, { color: true });

    expect(text).toContain("\u001b[31mHardStop\u001b[0m");
    expect(text).toContain("Active markets (1):");
    expect(text).toContain("Recent orders (0):");
    expect(text).toContain("Recent fills (0):");
    expect(text).toContain("Replay metrics:");
    expect(text).toContain("[Stop]");
  });

  it("prefers recorded market health from regime snapshots over recomputing it", () => {
    const database = openAnalyticsStore(":memory:");

    database
      .prepare(
        "INSERT INTO market_state_events (market_id, state, payload_json, recorded_at) VALUES (?, ?, ?, ?)"
      )
      .run(
        10,
        "Quote",
        JSON.stringify({
          marketId: 10,
          selectedMode: "Quote",
          nextState: "Quote",
          quotes: { bid: 0.45, ask: 0.46, bidSizeUsd: 5, askSizeUsd: 5 }
        }),
        "2026-04-02T00:10:00.000Z"
      );
    database
      .prepare(
        "INSERT INTO market_regime_snapshots (market_id, current_state, is_boosted, volume24h_usd, mid, spread, trade_age_ms, is_toxic, payload_json, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        10,
        "Quote",
        0,
        22000,
        0.455,
        0.01,
        500,
        0,
        JSON.stringify({
          bestBid: 0.45,
          bestAsk: 0.46,
          quoteCountSinceFill: 0,
          marketHealth: "inactive-or-toxic"
        }),
        "2026-04-02T00:10:00.000Z"
      );

    const snapshot = buildMonitorSnapshot(database, { activeMarketLimit: 1 });

    expect(snapshot.activeMarkets[0]?.health).toBe("inactive-or-toxic");
  });
});
