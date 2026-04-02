import type { DatabaseSync } from "node:sqlite";

import type {
  PredictApiResponse,
  PredictLastSaleData,
  PredictMarket,
  PredictMarketStats
} from "../clients/rest-client";
import type { ManagedOrder } from "../execution/order-manager";
import { normalizeOrderbookEvent, type NormalizedOrderbookEvent, type PredictOrderbookPayload } from "./normalizers";

type MarketRecorderRestClient = {
  getMarket(marketId: number): Promise<PredictApiResponse<PredictMarket>>;
  getMarketStats(marketId: number): Promise<PredictApiResponse<PredictMarketStats>>;
  getMarketLastSale(marketId: number): Promise<PredictApiResponse<PredictLastSaleData>>;
};

function nowIsoString(): string {
  return new Date().toISOString();
}

export class MarketRecorder {
  constructor(
    private readonly database: DatabaseSync,
    private readonly restClient?: MarketRecorderRestClient
  ) {}

  async bootstrapMarket(marketId: number): Promise<void> {
    if (!this.restClient) {
      throw new Error("MarketRecorder requires a REST client to bootstrap markets");
    }

    const [marketResponse, statsResponse, lastSaleResponse] = await Promise.all([
      this.restClient.getMarket(marketId),
      this.restClient.getMarketStats(marketId),
      this.restClient.getMarketLastSale(marketId)
    ]);

    this.recordMarketSnapshot({
      ...marketResponse.data,
      stats: statsResponse.data
    });

    if (lastSaleResponse.data) {
      this.recordLastSaleEvent(marketId, lastSaleResponse.data);
    }
  }

  recordMarketSnapshot(market: PredictMarket): void {
    this.database
      .prepare(
        "INSERT INTO market_snapshots (market_id, payload_json, recorded_at) VALUES (?, ?, ?)"
      )
      .run(market.id, JSON.stringify(market), nowIsoString());
  }

  recordLastSaleEvent(marketId: number, payload: Exclude<PredictLastSaleData, null>): void {
    this.database
      .prepare(
        "INSERT INTO last_sale_events (market_id, payload_json, recorded_at) VALUES (?, ?, ?)"
      )
      .run(marketId, JSON.stringify(payload), nowIsoString());
  }

  recordOrderbookEvent(
    topic: string,
    payload: PredictOrderbookPayload
  ): NormalizedOrderbookEvent {
    const event = normalizeOrderbookEvent(topic, payload);

    this.database
      .prepare(
        "INSERT INTO orderbook_events (market_id, best_bid, best_ask, payload_json, recorded_at) VALUES (?, ?, ?, ?, ?)"
      )
      .run(
        event.marketId,
        event.bestBid,
        event.bestAsk,
        JSON.stringify(event),
        nowIsoString()
      );

    return event;
  }

  recordManagedOrder(order: ManagedOrder, status: string): void {
    this.database
      .prepare(
        "INSERT INTO orders (market_id, order_hash, side, status, payload_json, recorded_at) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(
        order.marketId,
        order.id ?? null,
        order.side,
        status,
        JSON.stringify(order),
        nowIsoString()
      );
  }

  recordFillEvent(
    marketId: number,
    payload: {
      orderId?: string;
      side?: string;
      price?: number;
      sizeUsd?: number;
      inventoryDeltaUsd?: number;
      [key: string]: unknown;
    }
  ): void {
    this.database
      .prepare(
        "INSERT INTO fills (market_id, order_hash, payload_json, recorded_at) VALUES (?, ?, ?, ?)"
      )
      .run(
        marketId,
        payload.orderId ?? null,
        JSON.stringify(payload),
        nowIsoString()
      );
  }

  recordMarketStateEvent(marketId: number, state: string, payload: unknown): void {
    this.database
      .prepare(
        "INSERT INTO market_state_events (market_id, state, payload_json, recorded_at) VALUES (?, ?, ?, ?)"
      )
      .run(marketId, state, JSON.stringify(payload), nowIsoString());
  }

  recordRiskEvent(scope: string, mode: string, payload: unknown): void {
    this.database
      .prepare(
        "INSERT INTO risk_events (scope, mode, payload_json, recorded_at) VALUES (?, ?, ?, ?)"
      )
      .run(scope, mode, JSON.stringify(payload), nowIsoString());
  }

  recordPortfolioSnapshot(input: {
    flattenPnlUsd?: number | null;
    flattenPnlPct?: number | null;
    netInventoryUsd?: number | null;
    payload: unknown;
  }): void {
    this.database
      .prepare(
        "INSERT INTO portfolio_snapshots (flatten_pnl_usd, flatten_pnl_pct, net_inventory_usd, payload_json, recorded_at) VALUES (?, ?, ?, ?, ?)"
      )
      .run(
        input.flattenPnlUsd ?? null,
        input.flattenPnlPct ?? null,
        input.netInventoryUsd ?? null,
        JSON.stringify(input.payload),
        nowIsoString()
      );
  }
}
