import { afterEach, describe, expect, it } from "vitest";
import { once } from "node:events";
import type { AddressInfo } from "node:net";

import type { MonitorSnapshot } from "../src/monitor";
import {
  createMonitorWebServer,
  renderMonitorWebHtml
} from "../src/monitor-web";
import { parseMonitorWebCliOptions } from "../src/runtime/run-monitor-web";

const SNAPSHOT: MonitorSnapshot = {
  generatedAt: "2026-04-07T12:00:00.000Z",
  risk: {
    scope: "portfolio",
    mode: "Normal",
    reason: "stable",
    recordedAt: "2026-04-07T11:59:59.000Z"
  },
  portfolio: {
    flattenPnlUsd: 12.5,
    flattenPnlPct: 0.025,
    netInventoryUsd: 34,
    recordedAt: "2026-04-07T11:59:59.000Z"
  },
  privateState: {
    bearerTokenPresent: true,
    accountAddress: "0xabc",
    openOrders: 6,
    normalizedOpenOrders: 6,
    positions: 2,
    positionMarketIds: [1518, 933],
    hasUnnormalizedOpenOrders: false
  },
  activeMarkets: [
    {
      marketId: 1518,
      state: "Quote",
      selectedMode: "Quote",
      quoteBid: 0.42,
      quoteAsk: 0.44,
      quoteBidSizeUsd: 12,
      quoteAskSizeUsd: 12,
      bestBid: 0.421,
      bestAsk: 0.439,
      health: "active-safe",
      quoteCountSinceFill: 2,
      recordedAt: "2026-04-07T11:59:58.000Z"
    }
  ],
  recentOrders: [
    {
      marketId: 1518,
      orderHash: "order-1",
      side: "bid",
      status: "LIVE_OPEN",
      price: 0.42,
      sizeUsd: 12,
      recordedAt: "2026-04-07T11:59:58.000Z"
    }
  ],
  recentFills: [
    {
      marketId: 933,
      orderHash: "fill-1",
      side: "ask",
      price: 0.67,
      sizeUsd: 5,
      inventoryDeltaUsd: -5,
      recordedAt: "2026-04-07T11:59:57.000Z"
    }
  ],
  replay: {
    fills: 3,
    perMarketFills: { 1518: 2, 933: 1 },
    quoteSeconds: 600,
    protectSeconds: 120,
    flattenPnlUsd: 12.5,
    flattenPnlPct: 0.025,
    pointsProxy: 4.5,
    adverseMove30sBps: -12,
    adverseMove60sBps: -8,
    quoteSurvivalSeconds: 480,
    scorableQuoteSeconds: 540,
    topOfBookSeconds: 510,
    dualSidedQuoteSeconds: 420,
    totalActiveSeconds: 720,
    marketCountWithFills: 2,
    pointsProxyPerActiveHour: 22.5
  }
};

const serversToClose = new Set<ReturnType<typeof createMonitorWebServer>>();

afterEach(async () => {
  for (const server of serversToClose) {
    server.close();
    await once(server, "close");
  }

  serversToClose.clear();
});

describe("createMonitorWebServer", () => {
  it("serves the current snapshot as JSON at /api/snapshot", async () => {
    const server = createMonitorWebServer({
      loadSnapshot: () => SNAPSHOT
    });
    serversToClose.add(server);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");

    const address = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}/api/snapshot`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual(SNAPSHOT);
  });

  it("serves a static dashboard shell at /", async () => {
    const server = createMonitorWebServer({
      loadSnapshot: () => SNAPSHOT
    });
    serversToClose.add(server);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");

    const address = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}/`);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(html).toContain("Predict.fun MM Monitor");
    expect(html).toContain("Active Markets");
    expect(html).toContain("Recent Orders");
    expect(html).toContain("Recent Fills");
    expect(html).toContain("Portfolio");
    expect(html).toContain("fetch('/api/snapshot')");
    expect(html).toContain("Total PnL");
    expect(html).toContain("Refresh");
  });

  it("returns a structured 500 error from /api/snapshot when snapshot loading fails", async () => {
    const server = createMonitorWebServer({
      loadSnapshot: () => {
        throw new Error("boom");
      }
    });
    serversToClose.add(server);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");

    const address = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}/api/snapshot`);

    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({
      error: "boom"
    });
  });
});

describe("renderMonitorWebHtml", () => {
  it("renders the approved operational sections", () => {
    const html = renderMonitorWebHtml();

    expect(html).toContain("Risk");
    expect(html).toContain("Net Inventory");
    expect(html).toContain("Active Markets");
    expect(html).toContain("Recent Orders");
    expect(html).toContain("Recent Fills");
    expect(html).toContain("Portfolio");
    expect(html).toContain("Last updated");
  });

  it("uses fixed 250ms polling for the fast-refresh dashboard mode", () => {
    const html = renderMonitorWebHtml();

    expect(html).toContain("Auto-refresh: 250ms");
    expect(html).toContain("setInterval(() => void refreshSnapshot(), 250)");
  });

  it("uses a minimal terminal layout without cards and with overflow-safe tables", () => {
    const html = renderMonitorWebHtml();

    expect(html).not.toContain("summary-card");
    expect(html).not.toContain("box-shadow");
    expect(html).not.toContain("border-radius");
    expect(html).toContain("table-layout: fixed");
    expect(html).toContain("text-overflow: ellipsis");
    expect(html).toContain("overflow-wrap: anywhere");
  });
});

describe("parseMonitorWebCliOptions", () => {
  it("defaults to loopback host and the standard monitor port", () => {
    expect(
      parseMonitorWebCliOptions([], {
        PREDICT_MM_DB_PATH: "/tmp/test.sqlite"
      })
    ).toEqual({
      dbPath: "/tmp/test.sqlite",
      host: "127.0.0.1",
      port: 8787
    });
  });

  it("parses explicit db, host, and port overrides", () => {
    expect(
      parseMonitorWebCliOptions(
        ["--db=/tmp/override.sqlite", "--host=127.0.0.2", "--port=9000"],
        {}
      )
    ).toEqual({
      dbPath: "/tmp/override.sqlite",
      host: "127.0.0.2",
      port: 9000
    });
  });
});
