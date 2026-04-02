import { describe, expect, it } from "vitest";

import { createRuntimeLoop, startPollingRuntime } from "../src/runtime/runtime-loop";
import { openAnalyticsStore } from "../src/storage/sqlite";

const config = {
  apiBaseUrl: "https://api.predict.fun/v1",
  wsUrl: "wss://ws.predict.fun/ws",
  apiKey: "key",
  dbPath: ":memory:"
} as const;

async function flushAsyncWork(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function buildPublicRestClient() {
  return {
    async getMarkets() {
      return {
        success: true,
        data: [
          {
            id: 10,
            title: "A",
            question: "A?",
            description: "",
            tradingStatus: "OPEN",
            status: "OPEN",
            isVisible: true,
            isNegRisk: false,
            isYieldBearing: false,
            feeRateBps: 0,
            oracleQuestionId: "oq-10",
            conditionId: "cond-10",
            resolverAddress: "0x0",
            outcomes: [
              { name: "Yes", indexSet: 1, onChainId: "101" },
              { name: "No", indexSet: 2, onChainId: "102" }
            ],
            spreadThreshold: 0.06,
            shareThreshold: 1,
            isBoosted: true,
            polymarketConditionIds: [],
            categorySlug: "crypto",
            createdAt: "2026-04-02T00:00:00Z",
            decimalPrecision: 3,
            marketVariant: "DEFAULT",
            imageUrl: "",
            stats: {
              totalLiquidityUsd: 1000,
              volume24hUsd: 18000,
              volumeTotalUsd: 50000
            }
          },
          {
            id: 11,
            title: "B",
            question: "B?",
            description: "",
            tradingStatus: "OPEN",
            status: "OPEN",
            isVisible: true,
            isNegRisk: false,
            isYieldBearing: false,
            feeRateBps: 0,
            oracleQuestionId: "oq-11",
            conditionId: "cond-11",
            resolverAddress: "0x0",
            outcomes: [
              { name: "Yes", indexSet: 1, onChainId: "111" },
              { name: "No", indexSet: 2, onChainId: "112" }
            ],
            spreadThreshold: 0.06,
            shareThreshold: 1,
            isBoosted: false,
            polymarketConditionIds: [],
            categorySlug: "crypto",
            createdAt: "2026-04-02T00:00:00Z",
            decimalPrecision: 3,
            marketVariant: "DEFAULT",
            imageUrl: "",
            stats: {
              totalLiquidityUsd: 1000,
              volume24hUsd: 15000,
              volumeTotalUsd: 50000
            }
          },
          {
            id: 12,
            title: "C",
            question: "C?",
            description: "",
            tradingStatus: "OPEN",
            status: "OPEN",
            isVisible: true,
            isNegRisk: false,
            isYieldBearing: false,
            feeRateBps: 0,
            oracleQuestionId: "oq-12",
            conditionId: "cond-12",
            resolverAddress: "0x0",
            outcomes: [
              { name: "Yes", indexSet: 1, onChainId: "121" },
              { name: "No", indexSet: 2, onChainId: "122" }
            ],
            spreadThreshold: 0.06,
            shareThreshold: 1,
            isBoosted: false,
            polymarketConditionIds: [],
            categorySlug: "crypto",
            createdAt: "2026-04-02T00:00:00Z",
            decimalPrecision: 3,
            marketVariant: "DEFAULT",
            imageUrl: "",
            stats: {
              totalLiquidityUsd: 1000,
              volume24hUsd: 12000,
              volumeTotalUsd: 50000
            }
          }
        ]
      };
    },
    async getMarketOrderbook(marketId: number) {
      return {
        success: true,
        data: {
          marketId,
          updateTimestampMs: 1,
          bids: [[0.45, 100]],
          asks: [[0.47, 120]]
        }
      };
    },
    async getMarketLastSale() {
      return {
        success: true,
        data: {
          quoteType: "BID",
          outcome: "YES",
          priceInCurrency: "0.46",
          strategy: "LIMIT"
        }
      };
    },
    async getOrders() {
      return {
        success: true,
        data: []
      };
    },
    async getPositions() {
      return {
        success: true,
        data: []
      };
    },
    async getAccount() {
      return {
        success: true,
        data: {
          name: "bot",
          address: "0xabc",
          referral: {},
          points: {}
        }
      };
    }
  };
}

describe("createRuntimeLoop", () => {
  it("subscribes to active market orderbooks after bootstrap", async () => {
    const subscribed: string[][] = [];
    let connectCount = 0;

    const loop = await createRuntimeLoop("shadow", config, {
      database: openAnalyticsStore(":memory:"),
      restClient: buildPublicRestClient(),
      wsClient: {
        connect() {
          connectCount += 1;
          return {} as WebSocket;
        },
        subscribe(_requestId: number, topics: string[]) {
          subscribed.push(topics);
        },
        respondToHeartbeat() {}
      }
    });

    const snapshot = await loop.bootstrap();

    expect(connectCount).toBe(1);
    expect(subscribed).toEqual([["predictOrderbook/10", "predictOrderbook/11", "predictOrderbook/12"]]);
    expect(snapshot.cycleCount).toBe(1);
  });

  it("persists planned market states back onto tracked markets after bootstrap", async () => {
    const loop = await createRuntimeLoop("shadow", config, {
      database: openAnalyticsStore(":memory:"),
      restClient: buildPublicRestClient(),
      wsClient: {
        connect() {
          return {} as WebSocket;
        },
        subscribe() {},
        respondToHeartbeat() {}
      }
    });

    const snapshot = await loop.bootstrap();

    expect(snapshot.markets.map((market) => [market.id, market.currentState])).toEqual([
      [10, "Score"],
      [11, "Defend"],
      [12, "Defend"]
    ]);
  });

  it("subscribes to private wallet events in live mode when a bearer token is available", async () => {
    const subscribed: string[][] = [];

    const loop = await createRuntimeLoop(
      "live",
      {
        ...config,
        bearerToken: "jwt-token"
      },
      {
        database: openAnalyticsStore(":memory:"),
        restClient: buildPublicRestClient(),
        wsClient: {
          connect() {
            return {} as WebSocket;
          },
          subscribe(_requestId: number, topics: string[]) {
            subscribed.push(topics);
          },
          respondToHeartbeat() {}
        }
      }
    );

    await loop.bootstrap();

    expect(subscribed).toEqual([
      [
        "predictOrderbook/10",
        "predictOrderbook/11",
        "predictOrderbook/12",
        "predictWalletEvents/jwt-token"
      ]
    ]);
  });

  it("responds to heartbeats and reruns a cycle on orderbook updates", async () => {
    const heartbeats: Array<number | string> = [];

    const loop = await createRuntimeLoop("shadow", config, {
      database: openAnalyticsStore(":memory:"),
      restClient: buildPublicRestClient(),
      wsClient: {
        connect() {
          return {} as WebSocket;
        },
        subscribe() {},
        respondToHeartbeat(timestamp: number | string) {
          heartbeats.push(timestamp);
        }
      }
    });

    await loop.bootstrap();
    const before = loop.getSnapshot();

    loop.handleServerMessage(JSON.stringify({ type: "heartbeat", data: 123 }));
    loop.handleServerMessage(
      JSON.stringify({
        type: "M",
        topic: "predictOrderbook/10",
        data: {
          marketId: 10,
          updateTimestampMs: 2,
          bids: [[0.49, 100]],
          asks: [[0.5, 120]]
        }
      })
    );

    const after = loop.getSnapshot();

    expect(heartbeats).toEqual([123]);
    expect(after.cycleCount).toBe(before.cycleCount + 1);
    expect(after.markets.find((market) => market.id === 10)?.bestBid).toBe(0.49);
  });

  it("attaches websocket message handling during bootstrap", async () => {
    const socket: { onmessage?: (event: { data: string }) => void } = {};

    const loop = await createRuntimeLoop("shadow", config, {
      database: openAnalyticsStore(":memory:"),
      restClient: buildPublicRestClient(),
      wsClient: {
        connect() {
          return socket as unknown as WebSocket;
        },
        subscribe() {},
        respondToHeartbeat() {}
      }
    });

    await loop.bootstrap();
    const before = loop.getSnapshot();

    socket.onmessage?.({
      data: JSON.stringify({
        type: "M",
        topic: "predictOrderbook/10",
        data: {
          marketId: 10,
          updateTimestampMs: 2,
          bids: [[0.5, 100]],
          asks: [[0.51, 120]]
        }
      })
    });
    await flushAsyncWork();

    const after = loop.getSnapshot();

    expect(after.cycleCount).toBe(before.cycleCount + 1);
    expect(after.markets.find((market) => market.id === 10)?.bestBid).toBe(0.5);
  });

  it("can rerun a cycle without waiting for a websocket event", async () => {
    const loop = await createRuntimeLoop("shadow", config, {
      database: openAnalyticsStore(":memory:"),
      restClient: buildPublicRestClient(),
      wsClient: {
        connect() {
          return {} as WebSocket;
        },
        subscribe() {},
        respondToHeartbeat() {}
      }
    });

    await loop.bootstrap();
    const before = loop.getSnapshot();
    const after = loop.runCycle();

    expect(after.cycleCount).toBe(before.cycleCount + 1);
  });

  it("tracks simulated shadow orders so repeated cycles do not recreate them", async () => {
    const loop = await createRuntimeLoop("shadow", config, {
      database: openAnalyticsStore(":memory:"),
      restClient: buildPublicRestClient(),
      wsClient: {
        connect() {
          return {} as WebSocket;
        },
        subscribe() {},
        respondToHeartbeat() {}
      }
    });

    const bootstrapped = await loop.bootstrap();
    const afterManualCycle = loop.runCycle();

    expect(bootstrapped.result.commands).toHaveLength(0);
    expect(afterManualCycle.result.commands).toHaveLength(0);
  });

  it("executes live create commands and syncs returned orders into local state", async () => {
    const executedCommands: unknown[] = [];

    const loop = await createRuntimeLoop("live", config, {
      database: openAnalyticsStore(":memory:"),
      restClient: buildPublicRestClient(),
      liveExecutor: {
        async syncCommands(commands) {
          executedCommands.push(commands);
          const createCount = commands.filter(
            (command) => command.type === "create"
          ).length;
          return {
            cancelled: {
              success: true,
              removed: [],
              noop: []
            },
            created: Array.from({ length: createCount }, (_, index) => ({
              code: "CREATED",
              orderId: `live-order-${index + 1}`,
              orderHash: `0xhash-${index + 1}`
            }))
          };
        }
      },
      wsClient: {
        connect() {
          return {} as WebSocket;
        },
        subscribe() {},
        respondToHeartbeat() {}
      }
    });

    const bootstrapped = await loop.bootstrap();
    const afterManualCycle = await loop.runCycleAsync();

    expect(executedCommands).toHaveLength(2);
    expect(bootstrapped.result.commands).toHaveLength(0);
    expect(afterManualCycle.result.commands).toHaveLength(0);
  });

  it("updates local live state from private wallet fill events and records fills", async () => {
    const database = openAnalyticsStore(":memory:");
    const loop = await createRuntimeLoop(
      "live",
      {
        ...config,
        bearerToken: "jwt-token"
      },
      {
        database,
        restClient: buildPublicRestClient(),
        wsClient: {
          connect() {
            return {} as WebSocket;
          },
          subscribe() {},
          respondToHeartbeat() {}
        },
        currentOrders: [
          {
            id: "order-1",
            marketId: 10,
            side: "bid",
            price: 0.45,
            sizeUsd: 5
          }
        ]
      }
    );

    await loop.bootstrap();
    const snapshot = await loop.handleServerMessageAsync({
      type: "M",
      topic: "predictWalletEvents/jwt-token",
      data: {
        eventType: "fill",
        marketId: 10,
        orderId: "order-1",
        side: "bid",
        price: 0.45,
        sizeUsd: 2,
        remainingSizeUsd: 3,
        inventoryDeltaUsd: 2
      }
    });

    const fillRow = database
      .prepare("SELECT market_id, order_hash, payload_json FROM fills ORDER BY id DESC LIMIT 1")
      .get() as { market_id: number; order_hash: string; payload_json: string };

    expect(snapshot.markets.find((market) => market.id === 10)?.inventoryUsd).toBe(2);
    expect(fillRow.market_id).toBe(10);
    expect(fillRow.order_hash).toBe("order-1");
    expect(JSON.parse(fillRow.payload_json).sizeUsd).toBe(2);
  });

  it("moves a live market into Defend after a one-sided fill", async () => {
    const loop = await createRuntimeLoop(
      "live",
      {
        ...config,
        bearerToken: "jwt-token"
      },
      {
        database: openAnalyticsStore(":memory:"),
        restClient: buildPublicRestClient(),
        wsClient: {
          connect() {
            return {} as WebSocket;
          },
          subscribe() {},
          respondToHeartbeat() {}
        }
      }
    );

    await loop.bootstrap();
    const snapshot = await loop.handleServerMessageAsync({
      type: "M",
      topic: "predictWalletEvents/jwt-token",
      data: {
        eventType: "fill",
        marketId: 10,
        orderId: "order-1",
        side: "bid",
        price: 0.45,
        sizeUsd: 2,
        remainingSizeUsd: 3,
        inventoryDeltaUsd: 2
      }
    });

    expect(snapshot.markets.find((market) => market.id === 10)?.oneSidedFill).toBe(true);
    expect(
      snapshot.result.marketPlans.find((market) => market.marketId === 10)?.nextState
    ).toBe("Defend");
  });

  it("marks a market toxic after an adverse post-fill price move", async () => {
    let nowMs = 1_000;

    const loop = await createRuntimeLoop(
      "live",
      {
        ...config,
        bearerToken: "jwt-token"
      },
      {
        database: openAnalyticsStore(":memory:"),
        restClient: buildPublicRestClient(),
        nowMs: () => nowMs,
        wsClient: {
          connect() {
            return {} as WebSocket;
          },
          subscribe() {},
          respondToHeartbeat() {}
        }
      }
    );

    await loop.bootstrap();
    await loop.handleServerMessageAsync({
      type: "M",
      topic: "predictWalletEvents/jwt-token",
      data: {
        eventType: "fill",
        marketId: 10,
        orderId: "order-1",
        side: "bid",
        price: 0.45,
        sizeUsd: 2,
        remainingSizeUsd: 3,
        inventoryDeltaUsd: 2
      }
    });

    nowMs += 1_000;
    const snapshot = await loop.handleServerMessageAsync({
      type: "M",
      topic: "predictOrderbook/10",
      data: {
        marketId: 10,
        updateTimestampMs: 2,
        bids: [[0.44, 100]],
        asks: [[0.45, 120]]
      }
    });

    expect(snapshot.markets.find((market) => market.id === 10)?.isToxic).toBe(true);
  });

  it("records risk and market-state telemetry for each cycle", async () => {
    const database = openAnalyticsStore(":memory:");
    const loop = await createRuntimeLoop("shadow", config, {
      database,
      restClient: buildPublicRestClient(),
      wsClient: {
        connect() {
          return {} as WebSocket;
        },
        subscribe() {},
        respondToHeartbeat() {}
      }
    });

    await loop.bootstrap();

    const riskEvent = database
      .prepare("SELECT scope, mode, payload_json FROM risk_events ORDER BY id DESC LIMIT 1")
      .get() as { scope: string; mode: string; payload_json: string };
    const marketStates = database
      .prepare("SELECT market_id, state FROM market_state_events ORDER BY market_id")
      .all() as Array<{ market_id: number; state: string }>;
    const portfolioSnapshot = database
      .prepare(
        "SELECT flatten_pnl_pct, net_inventory_usd, payload_json FROM portfolio_snapshots ORDER BY id DESC LIMIT 1"
      )
      .get() as {
      flatten_pnl_pct: number | null;
      net_inventory_usd: number | null;
      payload_json: string;
    };

    expect(riskEvent.scope).toBe("portfolio");
    expect(riskEvent.mode).toBe("Normal");
    expect(JSON.parse(riskEvent.payload_json).mode).toBe("Normal");
    expect(portfolioSnapshot.flatten_pnl_pct).toBe(0);
    expect(portfolioSnapshot.net_inventory_usd).toBe(0);
    expect(JSON.parse(portfolioSnapshot.payload_json).aggregateNetInventoryUsd).toBe(0);
    expect(marketStates).toEqual([
      { market_id: 10, state: "Score" },
      { market_id: 11, state: "Defend" },
      { market_id: 12, state: "Defend" }
    ]);
  });
});

describe("startPollingRuntime", () => {
  it("boots the loop and schedules periodic cycles", async () => {
    let scheduledCallback: (() => void) | undefined;
    const snapshots: number[] = [];

    const runtime = await startPollingRuntime("shadow", config, {
      database: openAnalyticsStore(":memory:"),
      restClient: buildPublicRestClient(),
      wsClient: {
        connect() {
          return {} as WebSocket;
        },
        subscribe() {},
        respondToHeartbeat() {}
      },
      intervalMs: 5000,
      onCycle(snapshot) {
        snapshots.push(snapshot.cycleCount);
      },
      setTimer(callback) {
        scheduledCallback = callback;
        return 1 as unknown as ReturnType<typeof setInterval>;
      },
      clearTimer() {}
    });

    expect(runtime.loop.getSnapshot().cycleCount).toBe(1);

    scheduledCallback?.();
    await flushAsyncWork();

    expect(runtime.loop.getSnapshot().cycleCount).toBe(2);
    expect(snapshots).toEqual([2]);
  });

  it("clears the timer and closes the websocket when stopped", async () => {
    let clearedTimer: ReturnType<typeof setInterval> | undefined;
    let closeCount = 0;

    const runtime = await startPollingRuntime("shadow", config, {
      database: openAnalyticsStore(":memory:"),
      restClient: buildPublicRestClient(),
      wsClient: {
        connect() {
          return {
            close() {
              closeCount += 1;
            }
          } as unknown as WebSocket;
        },
        subscribe() {},
        respondToHeartbeat() {}
      },
      setTimer() {
        return 7 as unknown as ReturnType<typeof setInterval>;
      },
      clearTimer(timer) {
        clearedTimer = timer;
      }
    });

    runtime.stop();

    expect(clearedTimer).toBe(7 as unknown as ReturnType<typeof setInterval>);
    expect(closeCount).toBe(1);
  });
});
