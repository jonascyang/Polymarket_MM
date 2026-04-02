import { describe, expect, it } from "vitest";

import { normalizeOrderbookEvent } from "../src/recorder/normalizers";
import { MarketRecorder } from "../src/recorder/market-recorder";
import { openAnalyticsStore } from "../src/storage/sqlite";

describe("normalizeOrderbookEvent", () => {
  it("converts raw websocket payloads into recorder events", () => {
    const event = normalizeOrderbookEvent("predictOrderbook/123", {
      bids: [[0.45, 100]],
      asks: [[0.47, 120]],
      marketId: 123,
      updateTimestampMs: 1
    });

    expect(event.marketId).toBe(123);
    expect(event.bestBid).toBe(0.45);
    expect(event.bestAsk).toBe(0.47);
    expect(event.topic).toBe("predictOrderbook/123");
  });
});

describe("MarketRecorder", () => {
  it("writes normalized orderbook events to the analytics store", () => {
    const database = openAnalyticsStore(":memory:");
    const recorder = new MarketRecorder(database);

    recorder.recordOrderbookEvent("predictOrderbook/123", {
      bids: [[0.45, 100]],
      asks: [[0.47, 120]],
      marketId: 123,
      updateTimestampMs: 1
    });

    const row = database
      .prepare("SELECT market_id, best_bid, best_ask FROM orderbook_events")
      .get() as { market_id: number; best_bid: number; best_ask: number };

    expect(row).toEqual({
      market_id: 123,
      best_bid: 0.45,
      best_ask: 0.47
    });
  });

  it("bootstraps market snapshots and last sales from the REST client", async () => {
    const database = openAnalyticsStore(":memory:");
    const recorder = new MarketRecorder(database, {
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
    });

    await recorder.bootstrapMarket(123);

    const snapshot = database
      .prepare("SELECT market_id, payload_json FROM market_snapshots")
      .get() as { market_id: number; payload_json: string };
    const lastSale = database
      .prepare("SELECT market_id, payload_json FROM last_sale_events")
      .get() as { market_id: number; payload_json: string };

    expect(snapshot.market_id).toBe(123);
    expect(JSON.parse(snapshot.payload_json).stats.volume24hUsd).toBe(250);
    expect(lastSale.market_id).toBe(123);
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
      inventoryDeltaUsd: 2
    });

    const row = database
      .prepare("SELECT market_id, order_hash, payload_json FROM fills")
      .get() as {
      market_id: number;
      order_hash: string;
      payload_json: string;
    };

    expect(row.market_id).toBe(123);
    expect(row.order_hash).toBe("order-1");
    expect(JSON.parse(row.payload_json).inventoryDeltaUsd).toBe(2);
  });
});
