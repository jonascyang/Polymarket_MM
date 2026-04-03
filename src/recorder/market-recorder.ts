import type { DatabaseSync } from "node:sqlite";

import type {
  PredictApiResponse,
  PredictLastSaleData,
  PredictMarket,
  PredictMarketStats
} from "../clients/rest-client";
import type { ManagedOrder } from "../execution/order-manager";
import { EventArchive } from "./event-archive";
import {
  normalizeOrderbookEvent,
  type NormalizedOrderbookEvent,
  type PredictOrderbookPayload
} from "./normalizers";

type MarketRecorderRestClient = {
  getMarket(marketId: number): Promise<PredictApiResponse<PredictMarket>>;
  getMarketStats(marketId: number): Promise<PredictApiResponse<PredictMarketStats>>;
  getMarketLastSale(marketId: number): Promise<PredictApiResponse<PredictLastSaleData>>;
};

export type RecordOrderEventInput = {
  marketId: number;
  eventType: string;
  payload?: unknown;
  orderId?: string;
  clientOrderKey?: string;
  tokenId?: string;
  logicalSide?: string;
  exchangeSide?: string;
  price?: number;
  sizeUsd?: number;
  sizeShares?: number;
  queueAheadSharesEst?: number;
  submitTime?: string;
  ackTime?: string;
  openTime?: string;
  cancelRequestTime?: string;
  cancelAckTime?: string;
};

export type RecordFillEventInput = {
  orderId?: string;
  side?: string;
  price?: number;
  sizeUsd?: number;
  inventoryDeltaUsd?: number;
  inventoryAfterUsd?: number;
  inventoryUsd?: number;
  midAtFill?: number;
  spreadAtFill?: number;
  bidDepth1AtFill?: number;
  askDepth1AtFill?: number;
  [key: string]: unknown;
};

export type RecordMarketRegimeSnapshotInput = {
  marketId: number;
  currentState?: string;
  minutesToResolution?: number;
  isBoosted: boolean;
  volume24hUsd?: number;
  mid?: number;
  spread?: number;
  tradeAgeMs?: number;
  isToxic: boolean;
  payload?: unknown;
};

export type RecordFillOutcomeInput = {
  fillId: number;
  midPlus1s?: number;
  midPlus5s?: number;
  midPlus30s?: number;
  midPlus60s?: number;
  adverseMove1sBps?: number;
  adverseMove5sBps?: number;
  adverseMove30sBps?: number;
  adverseMove60sBps?: number;
  markout1sUsd?: number;
  markout5sUsd?: number;
  markout30sUsd?: number;
  markout60sUsd?: number;
};

export type MarketRecorderOptions = {
  restClient?: MarketRecorderRestClient;
  archive?: EventArchive;
  now?: () => Date;
};

function parseNumeric(value: string): number | null {
  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : null;
}

export class MarketRecorder {
  private readonly restClient?: MarketRecorderRestClient;
  private readonly archive?: EventArchive;
  private readonly now: () => Date;

  constructor(
    private readonly database: DatabaseSync,
    options: MarketRecorderOptions = {}
  ) {
    this.restClient = options.restClient;
    this.archive = options.archive;
    this.now = options.now ?? (() => new Date());
  }

  private nowIsoString(): string {
    return this.now().toISOString();
  }

  private archiveEvent(
    category:
      | "market-snapshots"
      | "orderbook"
      | "last-sale"
      | "order-events"
      | "fills"
      | "portfolio"
      | "market-regime"
      | "fill-outcomes",
    eventType: string,
    payload: unknown,
    recordedAt: string,
    marketId?: number
  ): void {
    this.archive?.append({
      category,
      eventType,
      payload,
      recordedAt,
      marketId
    });
  }

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
    const recordedAt = this.nowIsoString();

    this.database
      .prepare(
        "INSERT INTO market_snapshots (market_id, payload_json, recorded_at) VALUES (?, ?, ?)"
      )
      .run(market.id, JSON.stringify(market), recordedAt);

    this.archiveEvent("market-snapshots", "market_snapshot", market, recordedAt, market.id);
  }

  recordLastSaleEvent(marketId: number, payload: Exclude<PredictLastSaleData, null>): void {
    const recordedAt = this.nowIsoString();
    const price = parseNumeric(payload.priceInCurrency);

    this.database
      .prepare(
        "INSERT INTO last_sale_events (market_id, price, quote_type, outcome, strategy, payload_json, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        marketId,
        price,
        payload.quoteType,
        payload.outcome,
        payload.strategy,
        JSON.stringify(payload),
        recordedAt
      );

    this.archiveEvent("last-sale", "last_sale", payload, recordedAt, marketId);
  }

  recordOrderbookEvent(
    topic: string,
    payload: PredictOrderbookPayload
  ): NormalizedOrderbookEvent {
    const recordedAt = this.nowIsoString();
    const event = normalizeOrderbookEvent(topic, payload);

    this.database
      .prepare(
        `INSERT INTO orderbook_events (
          market_id,
          best_bid,
          best_ask,
          source_update_timestamp_ms,
          mid,
          spread,
          bids_json,
          asks_json,
          bid_depth_1,
          ask_depth_1,
          bid_depth_3,
          ask_depth_3,
          bid_depth_5,
          ask_depth_5,
          imbalance_1,
          imbalance_3,
          imbalance_5,
          payload_json,
          recorded_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        event.marketId,
        event.bestBid,
        event.bestAsk,
        event.sourceUpdateTimestampMs,
        event.mid,
        event.spread,
        JSON.stringify(event.bids),
        JSON.stringify(event.asks),
        event.bidDepth1,
        event.askDepth1,
        event.bidDepth3,
        event.askDepth3,
        event.bidDepth5,
        event.askDepth5,
        event.imbalance1,
        event.imbalance3,
        event.imbalance5,
        JSON.stringify(event),
        recordedAt
      );

    this.archiveEvent("orderbook", "orderbook", event, recordedAt, event.marketId);

    return event;
  }

  recordManagedOrder(order: ManagedOrder, status: string): void {
    const recordedAt = this.nowIsoString();

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
        recordedAt
      );
  }

  recordOrderEvent(input: RecordOrderEventInput): void {
    const recordedAt = this.nowIsoString();
    const payload = input.payload ?? {
      orderId: input.orderId ?? null,
      eventType: input.eventType
    };

    this.database
      .prepare(
        `INSERT INTO order_events (
          market_id,
          client_order_key,
          exchange_order_id,
          token_id,
          logical_side,
          exchange_side,
          price,
          size_usd,
          size_shares,
          queue_ahead_shares_est,
          event_type,
          submit_time,
          ack_time,
          open_time,
          cancel_request_time,
          cancel_ack_time,
          payload_json,
          recorded_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.marketId,
        input.clientOrderKey ?? null,
        input.orderId ?? null,
        input.tokenId ?? null,
        input.logicalSide ?? null,
        input.exchangeSide ?? null,
        input.price ?? null,
        input.sizeUsd ?? null,
        input.sizeShares ?? null,
        input.queueAheadSharesEst ?? null,
        input.eventType,
        input.submitTime ?? null,
        input.ackTime ?? null,
        input.openTime ?? null,
        input.cancelRequestTime ?? null,
        input.cancelAckTime ?? null,
        JSON.stringify(payload),
        recordedAt
      );

    this.archiveEvent("order-events", input.eventType, payload, recordedAt, input.marketId);
  }

  recordFillEvent(marketId: number, payload: RecordFillEventInput): void {
    const recordedAt = this.nowIsoString();
    const inventoryAfterUsd = payload.inventoryAfterUsd ?? payload.inventoryUsd ?? null;

    this.database
      .prepare(
        `INSERT INTO fills (
          market_id,
          order_hash,
          side,
          price,
          size_usd,
          inventory_delta_usd,
          inventory_after_usd,
          mid_at_fill,
          spread_at_fill,
          bid_depth_1_at_fill,
          ask_depth_1_at_fill,
          payload_json,
          recorded_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        marketId,
        payload.orderId ?? null,
        payload.side ?? null,
        payload.price ?? null,
        payload.sizeUsd ?? null,
        payload.inventoryDeltaUsd ?? null,
        inventoryAfterUsd,
        payload.midAtFill ?? null,
        payload.spreadAtFill ?? null,
        payload.bidDepth1AtFill ?? null,
        payload.askDepth1AtFill ?? null,
        JSON.stringify(payload),
        recordedAt
      );

    this.archiveEvent("fills", "fill", payload, recordedAt, marketId);
  }

  recordFillOutcome(input: RecordFillOutcomeInput): void {
    const recordedAt = this.nowIsoString();

    this.database
      .prepare(
        `INSERT INTO fill_outcomes (
          fill_id,
          mid_plus_1s,
          mid_plus_5s,
          mid_plus_30s,
          mid_plus_60s,
          adverse_move_1s_bps,
          adverse_move_5s_bps,
          adverse_move_30s_bps,
          adverse_move_60s_bps,
          markout_1s_usd,
          markout_5s_usd,
          markout_30s_usd,
          markout_60s_usd,
          recorded_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.fillId,
        input.midPlus1s ?? null,
        input.midPlus5s ?? null,
        input.midPlus30s ?? null,
        input.midPlus60s ?? null,
        input.adverseMove1sBps ?? null,
        input.adverseMove5sBps ?? null,
        input.adverseMove30sBps ?? null,
        input.adverseMove60sBps ?? null,
        input.markout1sUsd ?? null,
        input.markout5sUsd ?? null,
        input.markout30sUsd ?? null,
        input.markout60sUsd ?? null,
        recordedAt
      );

    this.archiveEvent("fill-outcomes", "fill_outcome", input, recordedAt);
  }

  recordMarketStateEvent(marketId: number, state: string, payload: unknown): void {
    this.database
      .prepare(
        "INSERT INTO market_state_events (market_id, state, payload_json, recorded_at) VALUES (?, ?, ?, ?)"
      )
      .run(marketId, state, JSON.stringify(payload), this.nowIsoString());
  }

  recordRiskEvent(scope: string, mode: string, payload: unknown): void {
    this.database
      .prepare(
        "INSERT INTO risk_events (scope, mode, payload_json, recorded_at) VALUES (?, ?, ?, ?)"
      )
      .run(scope, mode, JSON.stringify(payload), this.nowIsoString());
  }

  recordPortfolioSnapshot(input: {
    flattenPnlUsd?: number | null;
    flattenPnlPct?: number | null;
    netInventoryUsd?: number | null;
    payload: unknown;
  }): void {
    const recordedAt = this.nowIsoString();

    this.database
      .prepare(
        "INSERT INTO portfolio_snapshots (flatten_pnl_usd, flatten_pnl_pct, net_inventory_usd, payload_json, recorded_at) VALUES (?, ?, ?, ?, ?)"
      )
      .run(
        input.flattenPnlUsd ?? null,
        input.flattenPnlPct ?? null,
        input.netInventoryUsd ?? null,
        JSON.stringify(input.payload),
        recordedAt
      );

    this.archiveEvent("portfolio", "portfolio_snapshot", input.payload, recordedAt);
  }

  recordMarketRegimeSnapshot(input: RecordMarketRegimeSnapshotInput): void {
    const recordedAt = this.nowIsoString();
    const payload = input.payload ?? input;

    this.database
      .prepare(
        `INSERT INTO market_regime_snapshots (
          market_id,
          current_state,
          minutes_to_resolution,
          is_boosted,
          volume24h_usd,
          mid,
          spread,
          trade_age_ms,
          is_toxic,
          payload_json,
          recorded_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.marketId,
        input.currentState ?? null,
        input.minutesToResolution ?? null,
        input.isBoosted ? 1 : 0,
        input.volume24hUsd ?? null,
        input.mid ?? null,
        input.spread ?? null,
        input.tradeAgeMs ?? null,
        input.isToxic ? 1 : 0,
        JSON.stringify(payload),
        recordedAt
      );

    this.archiveEvent("market-regime", "market_regime", payload, recordedAt, input.marketId);
  }
}
