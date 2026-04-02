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
      .run(-0.25, -0.005, 8, JSON.stringify({ aggregateNetInventoryUsd: 8 }), "2026-04-02T00:10:00.000Z");

    database
      .prepare(
        "INSERT INTO market_state_events (market_id, state, payload_json, recorded_at) VALUES (?, ?, ?, ?)"
      )
      .run(
        110620,
        "Score",
        JSON.stringify({
          marketId: 110620,
          selectedMode: "Score",
          nextState: "Score",
          quotes: { bid: 0.32, ask: 0.37, sizeUsd: 6 }
        }),
        "2026-04-02T00:10:00.000Z"
      );
    database
      .prepare(
        "INSERT INTO market_state_events (market_id, state, payload_json, recorded_at) VALUES (?, ?, ?, ?)"
      )
      .run(
        1520,
        "Defend",
        JSON.stringify({
          marketId: 1520,
          selectedMode: "Defend",
          nextState: "Defend",
          quotes: { bid: 0.12, ask: 0.129, sizeUsd: 4 }
        }),
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

    const snapshot = buildMonitorSnapshot(database);
    const text = formatMonitorSnapshot(snapshot);

    expect(snapshot.risk.mode).toBe("Normal");
    expect(snapshot.portfolio.flattenPnlUsd).toBe(-0.25);
    expect(snapshot.portfolio.netInventoryUsd).toBe(8);
    expect(snapshot.activeMarkets).toEqual([
      expect.objectContaining({
        marketId: 110620,
        state: "Score",
        selectedMode: "Score",
        quoteBid: 0.32,
        quoteAsk: 0.37,
        quoteSizeUsd: 6,
        bestBid: 0.34,
        bestAsk: 0.35
      }),
      expect.objectContaining({
        marketId: 1520,
        state: "Defend",
        selectedMode: "Defend",
        quoteBid: 0.12,
        quoteAsk: 0.129,
        quoteSizeUsd: 4
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
        "Exit",
        JSON.stringify({
          marketId: 110620,
          selectedMode: "Score",
          nextState: "Exit",
          quotes: { bid: 0.32, ask: 0.37, sizeUsd: 6 }
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
    expect(text).toContain("[Exit]");
  });
});
