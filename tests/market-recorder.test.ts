import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { EventArchive } from "../src/recorder/event-archive";
import { normalizeOrderbookEvent } from "../src/recorder/normalizers";
import { MarketRecorder } from "../src/recorder/market-recorder";
import { openAnalyticsStore } from "../src/storage/sqlite";

describe("normalizeOrderbookEvent", () => {
  it("converts raw websocket payloads into recorder events", () => {
    const event = normalizeOrderbookEvent("predictOrderbook/123", {
      bids: [
        [0.45, 100],
        [0.44, 75],
        [0.43, 25]
      ],
      asks: [
        [0.47, 120],
        [0.48, 60],
        [0.49, 20]
      ],
      marketId: 123,
      updateTimestampMs: 1
    });

    expect(event.marketId).toBe(123);
    expect(event.bestBid).toBe(0.45);
    expect(event.bestAsk).toBe(0.47);
    expect(event.mid).toBe(0.46);
    expect(event.spread).toBe(0.02);
    expect(event.bids).toEqual([
      { price: 0.45, size: 100 },
      { price: 0.44, size: 75 },
      { price: 0.43, size: 25 }
    ]);
    expect(event.asks).toEqual([
      { price: 0.47, size: 120 },
      { price: 0.48, size: 60 },
      { price: 0.49, size: 20 }
    ]);
    expect(event.bidDepth1).toBe(100);
    expect(event.askDepth1).toBe(120);
    expect(event.bidDepth3).toBe(200);
    expect(event.askDepth3).toBe(200);
    expect(event.bidDepth5).toBe(200);
    expect(event.askDepth5).toBe(200);
    expect(event.imbalance1).toBeCloseTo(-0.090909, 5);
    expect(event.sourceUpdateTimestampMs).toBe(1);
    expect(event.topic).toBe("predictOrderbook/123");
  });
});

describe("MarketRecorder", () => {
  it("writes normalized orderbook events to the analytics store and archive buffer", () => {
    const database = openAnalyticsStore(":memory:");
    const directory = mkdtempSync(join(tmpdir(), "predict-mm-archive-"));
    const recorder = new MarketRecorder(database, {
      archive: new EventArchive(directory)
    });

    recorder.recordOrderbookEvent("predictOrderbook/123", {
      bids: [
        [0.45, 100],
        [0.44, 75]
      ],
      asks: [
        [0.47, 120],
        [0.48, 60]
      ],
      marketId: 123,
      updateTimestampMs: 1
    });

    const row = database
      .prepare(
        "SELECT market_id, best_bid, best_ask, mid, spread, source_update_timestamp_ms, bid_depth_1, ask_depth_3, bids_json FROM orderbook_events"
      )
      .get() as {
      market_id: number;
      best_bid: number;
      best_ask: number;
      mid: number;
      spread: number;
      source_update_timestamp_ms: number;
      bid_depth_1: number;
      ask_depth_3: number;
      bids_json: string;
    };
    const archiveFile = join(
      directory,
      "orderbook",
      new Date().toISOString().slice(0, 10),
      "market_id=123",
      `${new Date().toISOString().slice(11, 13)}.jsonl`
    );

    expect(row).toEqual({
      market_id: 123,
      best_bid: 0.45,
      best_ask: 0.47,
      mid: 0.46,
      spread: 0.02,
      source_update_timestamp_ms: 1,
      bid_depth_1: 100,
      ask_depth_3: 180,
      bids_json: JSON.stringify([
        { price: 0.45, size: 100 },
        { price: 0.44, size: 75 }
      ])
    });
    expect(readFileSync(archiveFile, "utf8")).toContain("\"event_type\":\"orderbook\"");
    expect(readFileSync(archiveFile, "utf8")).toContain("\"market_id\":123");

    rmSync(directory, { recursive: true, force: true });
  });

  it("bootstraps market snapshots and last sales from the REST client", async () => {
    const database = openAnalyticsStore(":memory:");
    const recorder = new MarketRecorder(database, {
      restClient: {
        async getMarket() {
          return {
            success: true,
            data: {
              id: 123,
              title: "Test market",
              question: "Will this test pass?",
              description: "",
              tradingStatus: "OPEN",
              status: "OPEN",
              isVisible: true,
              isNegRisk: false,
              isYieldBearing: false,
              feeRateBps: 0,
              oracleQuestionId: "oq",
              conditionId: "cond",
              resolverAddress: "0x0",
              outcomes: [],
              spreadThreshold: 0.06,
              shareThreshold: 1,
              isBoosted: false,
              polymarketConditionIds: [],
              categorySlug: "crypto",
              createdAt: "2026-04-02T00:00:00Z",
              decimalPrecision: 2,
              marketVariant: "DEFAULT",
              imageUrl: ""
            }
          };
        },
        async getMarketStats() {
          return {
            success: true,
            data: {
              totalLiquidityUsd: 1000,
              volume24hUsd: 250,
              volumeTotalUsd: 10000
            }
          };
        },
        async getMarketLastSale() {
          return {
            success: true,
            data: {
              quoteType: "BID",
              outcome: "YES",
              priceInCurrency: "0.47",
              strategy: "LIMIT"
            }
          };
        }
      }
    });

    await recorder.bootstrapMarket(123);

    const snapshot = database
      .prepare("SELECT market_id, payload_json FROM market_snapshots")
      .get() as { market_id: number; payload_json: string };
    const lastSale = database
      .prepare(
        "SELECT market_id, price, quote_type, outcome, strategy, payload_json FROM last_sale_events"
      )
      .get() as {
      market_id: number;
      price: number;
      quote_type: string;
      outcome: string;
      strategy: string;
      payload_json: string;
    };

    expect(snapshot.market_id).toBe(123);
    expect(JSON.parse(snapshot.payload_json).stats.volume24hUsd).toBe(250);
    expect(lastSale.market_id).toBe(123);
    expect(lastSale.price).toBe(0.47);
    expect(lastSale.quote_type).toBe("BID");
    expect(lastSale.outcome).toBe("YES");
    expect(lastSale.strategy).toBe("LIMIT");
    expect(JSON.parse(lastSale.payload_json).priceInCurrency).toBe("0.47");
  });

  it("records managed-order lifecycle events for shadow execution", () => {
    const database = openAnalyticsStore(":memory:");
    const recorder = new MarketRecorder(database);

    recorder.recordManagedOrder(
      {
        id: "shadow-1",
        marketId: 123,
        side: "bid",
        price: 0.45,
        sizeUsd: 5
      },
      "SHADOW_OPEN"
    );

    const row = database
      .prepare("SELECT market_id, order_hash, side, status, payload_json FROM orders")
      .get() as {
      market_id: number;
      order_hash: string;
      side: string;
      status: string;
      payload_json: string;
    };

    expect(row.market_id).toBe(123);
    expect(row.order_hash).toBe("shadow-1");
    expect(row.side).toBe("bid");
    expect(row.status).toBe("SHADOW_OPEN");
    expect(JSON.parse(row.payload_json).sizeUsd).toBe(5);
  });

  it("records normalized fill events in the analytics store", () => {
    const database = openAnalyticsStore(":memory:");
    const recorder = new MarketRecorder(database);

    recorder.recordFillEvent(123, {
      orderId: "order-1",
      side: "bid",
      price: 0.45,
      sizeUsd: 2,
      inventoryDeltaUsd: 2,
      inventoryAfterUsd: 2,
      midAtFill: 0.46,
      spreadAtFill: 0.02
    });

    const row = database
      .prepare(
        "SELECT market_id, order_hash, side, price, size_usd, inventory_delta_usd, inventory_after_usd, mid_at_fill, spread_at_fill, payload_json FROM fills"
      )
      .get() as {
      market_id: number;
      order_hash: string;
      side: string;
      price: number;
      size_usd: number;
      inventory_delta_usd: number;
      inventory_after_usd: number;
      mid_at_fill: number;
      spread_at_fill: number;
      payload_json: string;
    };

    expect(row.market_id).toBe(123);
    expect(row.order_hash).toBe("order-1");
    expect(row.side).toBe("bid");
    expect(row.price).toBe(0.45);
    expect(row.size_usd).toBe(2);
    expect(row.inventory_delta_usd).toBe(2);
    expect(row.inventory_after_usd).toBe(2);
    expect(row.mid_at_fill).toBe(0.46);
    expect(row.spread_at_fill).toBe(0.02);
    expect(JSON.parse(row.payload_json).inventoryDeltaUsd).toBe(2);
  });

  it("records order lifecycle events into the archive schema", () => {
    const database = openAnalyticsStore(":memory:");
    const recorder = new MarketRecorder(database);

    recorder.recordOrderEvent({
      marketId: 123,
      orderId: "order-1",
      eventType: "LIVE_OPEN",
      logicalSide: "bid",
      price: 0.45,
      sizeUsd: 5,
      queueAheadSharesEst: 125,
      payload: {
        orderId: "order-1"
      }
    });

    const row = database
      .prepare(
        "SELECT market_id, exchange_order_id, logical_side, price, size_usd, queue_ahead_shares_est, event_type, payload_json FROM order_events"
      )
      .get() as {
      market_id: number;
      exchange_order_id: string;
      logical_side: string;
      price: number;
      size_usd: number;
      queue_ahead_shares_est: number;
      event_type: string;
      payload_json: string;
    };

    expect(row.market_id).toBe(123);
    expect(row.exchange_order_id).toBe("order-1");
    expect(row.logical_side).toBe("bid");
    expect(row.price).toBe(0.45);
    expect(row.size_usd).toBe(5);
    expect(row.queue_ahead_shares_est).toBe(125);
    expect(row.event_type).toBe("LIVE_OPEN");
    expect(JSON.parse(row.payload_json).orderId).toBe("order-1");
  });
});
