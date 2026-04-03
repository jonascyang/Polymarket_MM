import { describe, expect, it } from "vitest";

import { MarketRecorder } from "../src/recorder/market-recorder";
import {
  buildResearchReport,
  formatResearchReport
} from "../src/research/report";
import { openAnalyticsStore } from "../src/storage/sqlite";

describe("buildResearchReport", () => {
  it("summarizes market activity, fill quality, and inventory recycling from analytics data", () => {
    const database = openAnalyticsStore(":memory:");
    const recorder = new MarketRecorder(database, {
      now: (() => {
        const timestamps = [
          "2026-04-03T12:00:00.000Z",
          "2026-04-03T12:00:01.000Z",
          "2026-04-03T12:00:02.000Z",
          "2026-04-03T12:00:03.000Z",
          "2026-04-03T12:00:04.000Z",
          "2026-04-03T12:00:05.000Z",
          "2026-04-03T12:00:30.000Z",
          "2026-04-03T12:00:31.000Z",
          "2026-04-03T12:01:00.000Z",
          "2026-04-03T12:01:01.000Z"
        ].map((value) => new Date(value));
        let index = 0;
        return () => timestamps[Math.min(index++, timestamps.length - 1)] as Date;
      })()
    });

    database
      .prepare("INSERT INTO market_snapshots (market_id, payload_json, recorded_at) VALUES (?, ?, ?)")
      .run(
        101,
        JSON.stringify({ id: 101, decimalPrecision: 2 }),
        "2026-04-03T11:59:59.000Z"
      );
    database
      .prepare("INSERT INTO market_snapshots (market_id, payload_json, recorded_at) VALUES (?, ?, ?)")
      .run(
        202,
        JSON.stringify({ id: 202, decimalPrecision: 2 }),
        "2026-04-03T11:59:59.000Z"
      );

    recorder.recordOrderbookEvent("predictOrderbook/101", {
      marketId: 101,
      updateTimestampMs: 1,
      bids: [[0.45, 100]],
      asks: [[0.47, 120]]
    });
    recorder.recordOrderbookEvent("predictOrderbook/202", {
      marketId: 202,
      updateTimestampMs: 2,
      bids: [[0.29, 50]],
      asks: [[0.35, 40]]
    });
    recorder.recordLastSaleEvent(101, {
      quoteType: "ASK",
      outcome: "YES",
      priceInCurrency: "0.47",
      strategy: "LIMIT"
    });
    recorder.recordMarketRegimeSnapshot({
      marketId: 101,
      currentState: "Observe",
      isBoosted: true,
      volume24hUsd: 24000,
      mid: 0.46,
      spread: 0.02,
      tradeAgeMs: 0,
      isToxic: false
    });
    recorder.recordMarketRegimeSnapshot({
      marketId: 202,
      currentState: "Observe",
      isBoosted: false,
      volume24hUsd: 6000,
      mid: 0.32,
      spread: 0.06,
      isToxic: true
    });
    recorder.recordOrderEvent({
      marketId: 101,
      orderId: "touch-fill",
      eventType: "LIVE_OPEN",
      logicalSide: "bid",
      price: 0.45,
      sizeUsd: 4.5
    });
    recorder.recordOrderEvent({
      marketId: 101,
      orderId: "far-miss",
      eventType: "LIVE_OPEN",
      logicalSide: "bid",
      price: 0.43,
      sizeUsd: 4.3
    });
    recorder.recordFillEvent(101, {
      orderId: "touch-fill",
      side: "bid",
      price: 0.45,
      sizeUsd: 4.5,
      inventoryDeltaUsd: 4.5,
      inventoryAfterUsd: 4.5
    });
    recorder.recordOrderbookEvent("predictOrderbook/101", {
      marketId: 101,
      updateTimestampMs: 3,
      bids: [[0.43, 100]],
      asks: [[0.45, 100]]
    });
    recorder.recordFillEvent(101, {
      orderId: "inventory-reset",
      side: "ask",
      price: 0.45,
      sizeUsd: 4.5,
      inventoryDeltaUsd: -4.5,
      inventoryAfterUsd: 0
    });
    recorder.recordFillOutcome({
      fillId: 1,
      adverseMove30sBps: 111.111111,
      adverseMove60sBps: 0,
      markout30sUsd: -0.05,
      markout60sUsd: 0.1
    });
    recorder.recordFillOutcome({
      fillId: 2,
      adverseMove30sBps: 0,
      adverseMove60sBps: 0,
      markout30sUsd: 0,
      markout60sUsd: 0
    });

    const report = buildResearchReport(database);
    const text = formatResearchReport(report);

    expect(report.collection).toEqual({
      sampledMarkets: 2,
      orderbookEvents: 3,
      lastSaleEvents: 1,
      orderOpenEvents: 2,
      fills: 2
    });
    expect(
      report.marketActivity.map((row) => ({
        marketId: row.marketId,
        segment: row.segment
      }))
    ).toEqual([
      { marketId: 101, segment: "tradable" },
      { marketId: 202, segment: "toxic_or_thin" }
    ]);
    expect(report.fillRateByDistanceToTouch).toEqual([
      { distanceTicks: 0, orderCount: 1, filledCount: 1, fillRate: 1 },
      { distanceTicks: 2, orderCount: 1, filledCount: 0, fillRate: 0 }
    ]);
    expect(report.markout).toEqual({
      fillCount: 2,
      averageAdverse30sBps: 55.555556,
      averageAdverse60sBps: 0,
      averageMarkout30sUsd: -0.025,
      averageMarkout60sUsd: 0.05
    });
    expect(report.inventoryRecycle).toEqual([
      {
        marketId: 101,
        completedCycles: 1,
        openCycles: 0,
        averageSecondsToFlat: 30
      }
    ]);
    expect(report.marketProfiles).toEqual([
      {
        marketId: 101,
        segment: "tradable",
        volume24hUsd: 24000,
        spread: 0.02,
        fillRateAtTouch: 1,
        fillRateNearTouch: 0,
        averageAdverse30sBps: 55.555556,
        averageMarkout30sUsd: -0.025,
        averageSecondsToFlat: 30,
        fills: 2
      },
      {
        marketId: 202,
        segment: "toxic_or_thin",
        volume24hUsd: 6000,
        spread: 0.06,
        fillRateAtTouch: 0,
        fillRateNearTouch: 0,
        averageAdverse30sBps: 0,
        averageMarkout30sUsd: 0,
        averageSecondsToFlat: 0,
        fills: 0
      }
    ]);
    expect(text).toContain("Collection coverage");
    expect(text).toContain("Market activity");
    expect(text).toContain("Fill rate by distance-to-touch");
    expect(text).toContain("Inventory recycle");
    expect(text).toContain("Market profiles");
    expect(text).toContain("market=101 segment=tradable");
  });

  it("derives markout from fills and later orderbooks when fill outcomes are absent", () => {
    const database = openAnalyticsStore(":memory:");
    const recorder = new MarketRecorder(database, {
      now: (() => {
        const timestamps = [
          "2026-04-03T12:00:00.000Z",
          "2026-04-03T12:00:01.000Z",
          "2026-04-03T12:00:31.000Z",
          "2026-04-03T12:01:01.000Z"
        ].map((value) => new Date(value));
        let index = 0;
        return () => timestamps[Math.min(index++, timestamps.length - 1)] as Date;
      })()
    });

    recorder.recordOrderbookEvent("predictOrderbook/101", {
      marketId: 101,
      updateTimestampMs: 1,
      bids: [[0.45, 100]],
      asks: [[0.47, 120]]
    });
    recorder.recordFillEvent(101, {
      orderId: "derived-fill",
      side: "bid",
      price: 0.45,
      sizeUsd: 4.5,
      inventoryDeltaUsd: 4.5,
      inventoryAfterUsd: 4.5,
      midAtFill: 0.46
    });
    recorder.recordOrderbookEvent("predictOrderbook/101", {
      marketId: 101,
      updateTimestampMs: 2,
      bids: [[0.43, 100]],
      asks: [[0.45, 100]]
    });
    recorder.recordOrderbookEvent("predictOrderbook/101", {
      marketId: 101,
      updateTimestampMs: 3,
      bids: [[0.47, 100]],
      asks: [[0.49, 100]]
    });

    const report = buildResearchReport(database);

    expect(report.markout).toEqual({
      fillCount: 1,
      averageAdverse30sBps: 200,
      averageAdverse60sBps: 0,
      averageMarkout30sUsd: -0.1,
      averageMarkout60sUsd: 0.3
    });
    expect(report.marketProfiles).toEqual([
      {
        marketId: 101,
        segment: "watch",
        volume24hUsd: null,
        spread: null,
        fillRateAtTouch: 0,
        fillRateNearTouch: 0,
        averageAdverse30sBps: 200,
        averageMarkout30sUsd: -0.1,
        averageSecondsToFlat: 0,
        fills: 1
      }
    ]);
  });
});
