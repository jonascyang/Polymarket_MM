import type { DatabaseSync } from "node:sqlite";

import { PredictRestClient } from "../clients/rest-client";
import { MarketRecorder } from "../recorder/market-recorder";
import { EventArchive } from "../recorder/event-archive";
import { openAnalyticsStore } from "../storage/sqlite";
import type { PredictMmConfig } from "../types";

type CollectorRestClient = Pick<
  PredictRestClient,
  "getMarkets" | "getMarketOrderbook" | "getMarketLastSale"
>;

export type ResearchCollectorOptions = {
  database?: DatabaseSync;
  restClient?: CollectorRestClient;
  recorder?: MarketRecorder;
  first?: number;
  nowMs?: () => number;
};

export type ResearchCollectorResult = {
  sampledMarkets: number;
  orderbooksRecorded: number;
  lastSalesRecorded: number;
  regimeSnapshotsRecorded: number;
  marketIds: number[];
};

function roundMetric(value: number): number {
  return Number(value.toFixed(12));
}

function buildRestClient(
  config: PredictMmConfig,
  options: ResearchCollectorOptions
): CollectorRestClient {
  if (options.restClient) {
    return options.restClient;
  }

  return new PredictRestClient(config);
}

function buildRecorder(
  config: PredictMmConfig,
  database: DatabaseSync,
  options: ResearchCollectorOptions
): MarketRecorder {
  if (options.recorder) {
    return options.recorder;
  }

  return new MarketRecorder(database, {
    archive: config.archiveDir ? new EventArchive(config.archiveDir) : undefined
  });
}

export async function runResearchCollectorCycle(
  config: PredictMmConfig,
  options: ResearchCollectorOptions = {}
): Promise<ResearchCollectorResult> {
  const nowMs = options.nowMs ?? Date.now;
  const database = options.database ?? openAnalyticsStore(config.dbPath);
  const restClient = buildRestClient(config, options);
  const recorder = buildRecorder(config, database, options);
  const marketsResponse = await restClient.getMarkets({
    first: options.first ?? 20,
    status: "OPEN",
    includeStats: true,
    sort: "VOLUME_24H_DESC"
  });

  let orderbooksRecorded = 0;
  let lastSalesRecorded = 0;
  let regimeSnapshotsRecorded = 0;
  const marketIds: number[] = [];

  for (const market of marketsResponse.data) {
    recorder.recordMarketSnapshot(market);
    marketIds.push(market.id);

    const [orderbookResponse, lastSaleResponse] = await Promise.all([
      restClient.getMarketOrderbook(market.id),
      restClient.getMarketLastSale(market.id)
    ]);
    const orderbookEvent = recorder.recordOrderbookEvent(
      `predictOrderbook/${market.id}`,
      orderbookResponse.data
    );
    const lastSale = lastSaleResponse.data;

    orderbooksRecorded += 1;

    if (lastSale) {
      recorder.recordLastSaleEvent(market.id, lastSale);
      lastSalesRecorded += 1;
    }

    const observedAtMs = lastSale ? nowMs() : undefined;

    recorder.recordMarketRegimeSnapshot({
      marketId: market.id,
      currentState: "Observe",
      isBoosted: market.isBoosted,
      volume24hUsd: market.stats?.volume24hUsd ?? 0,
      mid: orderbookEvent.mid,
      spread: orderbookEvent.spread,
      tradeAgeMs:
        observedAtMs === undefined ? undefined : Math.max(0, nowMs() - observedAtMs),
      isToxic: false
    });
    regimeSnapshotsRecorded += 1;
  }

  return {
    sampledMarkets: marketsResponse.data.length,
    orderbooksRecorded,
    lastSalesRecorded,
    regimeSnapshotsRecorded,
    marketIds
  };
}
