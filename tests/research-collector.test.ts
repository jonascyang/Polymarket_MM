import { describe, expect, it } from "vitest";

import type {
  PredictLastSaleData,
  PredictMarket,
  PredictOrderbookData,
  PredictRestClient
} from "../src/clients/rest-client";
import { runResearchCollectorCycle } from "../src/research/collector";
import { openAnalyticsStore } from "../src/storage/sqlite";
import type { PredictMmConfig } from "../src/types";

function buildConfig(overrides: Partial<PredictMmConfig> = {}): PredictMmConfig {
  return {
    apiBaseUrl: "https://api.predict.fun/v1",
    wsUrl: "wss://ws.predict.fun/ws",
    apiKey: "test-api-key",
    dbPath: ":memory:",
    ...overrides
  };
}

function buildMarket(
  id: number,
  overrides: Partial<PredictMarket> = {}
): PredictMarket {
  return {
    id,
    title: `Market ${id}`,
    question: `Question ${id}?`,
    description: "",
    tradingStatus: "OPEN",
    status: "OPEN",
    isVisible: true,
    isNegRisk: false,
    isYieldBearing: false,
    feeRateBps: 200,
    oracleQuestionId: `oracle-${id}`,
    conditionId: `condition-${id}`,
    resolverAddress: "0x0",
    outcomes: [],
    spreadThreshold: 0.06,
    shareThreshold: 1,
    isBoosted: false,
    polymarketConditionIds: [],
    categorySlug: "crypto",
    createdAt: "2026-04-03T00:00:00Z",
    decimalPrecision: 2,
    marketVariant: "DEFAULT",
    imageUrl: "",
    stats: {
      totalLiquidityUsd: 1000,
      volume24hUsd: 1000 * id,
      volumeTotalUsd: 10000 * id
    },
    ...overrides
  };
}

function buildOrderbook(
  marketId: number,
  bid: number,
  ask: number,
  updateTimestampMs: number
): PredictOrderbookData {
  return {
    marketId,
    updateTimestampMs,
    bids: [[bid, 100]],
    asks: [[ask, 120]]
  };
}

describe("runResearchCollectorCycle", () => {
  it("records market snapshots, orderbooks, last sales, and market regimes for the sampled universe", async () => {
    const database = openAnalyticsStore(":memory:");
    const markets = [
      buildMarket(101, {
        isBoosted: true,
        stats: {
          totalLiquidityUsd: 1000,
          volume24hUsd: 24000,
          volumeTotalUsd: 120000
        }
      }),
      buildMarket(202, {
        stats: {
          totalLiquidityUsd: 800,
          volume24hUsd: 12000,
          volumeTotalUsd: 60000
        }
      })
    ];
    const orderbooks = new Map<number, PredictOrderbookData>([
      [101, buildOrderbook(101, 0.44, 0.46, 1001)],
      [202, buildOrderbook(202, 0.31, 0.35, 1002)]
    ]);
    const lastSales = new Map<number, PredictLastSaleData>([
      [
        101,
        {
          quoteType: "ASK",
          outcome: "YES",
          priceInCurrency: "0.46",
          strategy: "LIMIT"
        }
      ],
      [202, null]
    ]);

    const restClient: Pick<
      PredictRestClient,
      "getMarkets" | "getMarketOrderbook" | "getMarketLastSale"
    > = {
      async getMarkets() {
        return {
          success: true,
          data: markets
        };
      },
      async getMarketOrderbook(marketId) {
        return {
          success: true,
          data: orderbooks.get(marketId) as PredictOrderbookData
        };
      },
      async getMarketLastSale(marketId) {
        return {
          success: true,
          data: lastSales.get(marketId) ?? null
        };
      }
    };

    const result = await runResearchCollectorCycle(buildConfig(), {
      database,
      restClient,
      first: 2,
      nowMs: () => Date.parse("2026-04-03T12:00:00.000Z")
    });

    expect(result).toEqual({
      sampledMarkets: 2,
      orderbooksRecorded: 2,
      lastSalesRecorded: 1,
      regimeSnapshotsRecorded: 2,
      marketIds: [101, 202]
    });

    const marketSnapshots = database
      .prepare("SELECT market_id FROM market_snapshots ORDER BY market_id ASC")
      .all() as Array<{ market_id: number }>;
    const lastSaleRows = database
      .prepare("SELECT market_id, price FROM last_sale_events ORDER BY market_id ASC")
      .all() as Array<{ market_id: number; price: number }>;
    const regimeRows = database
      .prepare(
        "SELECT market_id, is_boosted, volume24h_usd, mid, spread, trade_age_ms, is_toxic FROM market_regime_snapshots ORDER BY market_id ASC"
      )
      .all() as Array<{
      market_id: number;
      is_boosted: number;
      volume24h_usd: number;
      mid: number;
      spread: number;
      trade_age_ms: number | null;
      is_toxic: number;
    }>;

    expect(marketSnapshots).toEqual([{ market_id: 101 }, { market_id: 202 }]);
    expect(lastSaleRows).toEqual([{ market_id: 101, price: 0.46 }]);
    expect(regimeRows).toEqual([
      {
        market_id: 101,
        is_boosted: 1,
        volume24h_usd: 24000,
        mid: 0.45,
        spread: 0.02,
        trade_age_ms: 0,
        is_toxic: 0
      },
      {
        market_id: 202,
        is_boosted: 0,
        volume24h_usd: 12000,
        mid: 0.33,
        spread: 0.04,
        trade_age_ms: null,
        is_toxic: 0
      }
    ]);
  });
});
