import { describe, expect, it } from "vitest";

import { openAnalyticsStore } from "../src/storage/sqlite";
import {
  parseReportCliOptions,
  renderResearchReport
} from "../src/runtime/run-report";

describe("run-report", () => {
  it("parses the optional json flag", () => {
    expect(
      parseReportCliOptions(["--db=/tmp/predict-mm.sqlite", "--json"], {})
    ).toEqual({
      dbPath: "/tmp/predict-mm.sqlite",
      format: "json"
    });
  });

  it("renders structured json output when requested", () => {
    const database = openAnalyticsStore(":memory:");

    try {
      const output = renderResearchReport(database, "json");

      expect(JSON.parse(output)).toEqual({
        collection: {
          sampledMarkets: 0,
          orderbookEvents: 0,
          lastSaleEvents: 0,
          orderOpenEvents: 0,
          fills: 0
        },
        marketActivity: [],
        fillRateByDistanceToTouch: [],
        markout: {
          fillCount: 0,
          averageAdverse30sBps: 0,
          averageAdverse60sBps: 0,
          averageMarkout30sUsd: 0,
          averageMarkout60sUsd: 0
        },
        inventoryRecycle: [],
        marketProfiles: []
      });
    } finally {
      database.close();
    }
  });
});
