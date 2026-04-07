import { describe, expect, it } from "vitest";

import { PredictLiveSyncError } from "../src/execution/live-executor";
import { createRuntimeLoop, startPollingRuntime } from "../src/runtime/runtime-loop";
import { openAnalyticsStore } from "../src/storage/sqlite";

const PRIMARY_MARKET_ID = 1469;
const SECONDARY_MARKET_ID = 1520;
const TERTIARY_MARKET_ID = 933;

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
            id: PRIMARY_MARKET_ID,
            title: "Oklahoma City Thunder",
            question: "A?",
            description: "",
            tradingStatus: "OPEN",
            status: "OPEN",
            isVisible: true,
            isNegRisk: false,
            isYieldBearing: false,
            feeRateBps: 0,
            oracleQuestionId: "oq-1469",
            conditionId: "cond-1469",
            resolverAddress: "0x0",
            outcomes: [
              { name: "Yes", indexSet: 1, onChainId: "101" },
              { name: "No", indexSet: 2, onChainId: "102" }
            ],
            spreadThreshold: 0.06,
            shareThreshold: 1,
            isBoosted: false,
            polymarketConditionIds: [],
            categorySlug: "2026-nba-champion",
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
            id: SECONDARY_MARKET_ID,
            title: "France",
            question: "B?",
            description: "",
            tradingStatus: "OPEN",
            status: "OPEN",
            isVisible: true,
            isNegRisk: false,
            isYieldBearing: false,
            feeRateBps: 0,
            oracleQuestionId: "oq-1520",
            conditionId: "cond-1520",
            resolverAddress: "0x0",
            outcomes: [
              { name: "Yes", indexSet: 1, onChainId: "111" },
              { name: "No", indexSet: 2, onChainId: "112" }
            ],
            spreadThreshold: 0.06,
            shareThreshold: 1,
            isBoosted: false,
            polymarketConditionIds: [],
            categorySlug: "2026-fifa-world-cup-winner",
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
            id: TERTIARY_MARKET_ID,
            title: "Base token",
            question: "C?",
            description: "",
            tradingStatus: "OPEN",
            status: "OPEN",
            isVisible: true,
            isNegRisk: false,
            isYieldBearing: false,
            feeRateBps: 0,
            oracleQuestionId: "oq-933",
            conditionId: "cond-933",
            resolverAddress: "0x0",
            outcomes: [
              { name: "Yes", indexSet: 1, onChainId: "121" },
              { name: "No", indexSet: 2, onChainId: "122" }
            ],
            spreadThreshold: 0.06,
            shareThreshold: 1,
            isBoosted: false,
            polymarketConditionIds: [],
            categorySlug: "will-base-launch-a-token-in-2026",
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
    expect(subscribed).toEqual([[
      `predictOrderbook/${PRIMARY_MARKET_ID}`,
      `predictOrderbook/${SECONDARY_MARKET_ID}`,
      `predictOrderbook/${TERTIARY_MARKET_ID}`
    ]]);
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
      [PRIMARY_MARKET_ID, "Quote"],
      [SECONDARY_MARKET_ID, "Protect"],
      [TERTIARY_MARKET_ID, "Protect"]
    ]);
  });

  it("tracks quote churn counts for bootstrapped shadow orders", async () => {
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

    expect(snapshot.markets.map((market) => [market.id, market.quoteCountSinceFill])).toEqual([
      [PRIMARY_MARKET_ID, 2],
      [SECONDARY_MARKET_ID, 2],
      [TERTIARY_MARKET_ID, 2]
    ]);
  });

  it("derives rolling market health from touch moves, one-sided samples, and last-sale changes", async () => {
    let market10LastSaleCalls = 0;

    const loop = await createRuntimeLoop("shadow", config, {
      database: openAnalyticsStore(":memory:"),
      restClient: {
        ...buildPublicRestClient(),
        async getMarketLastSale(marketId: number) {
          if (marketId !== PRIMARY_MARKET_ID) {
            return buildPublicRestClient().getMarketLastSale();
          }

          market10LastSaleCalls += 1;

          return {
            success: true,
            data: {
              quoteType: "BID",
              outcome: "YES",
              priceInCurrency: market10LastSaleCalls >= 2 ? "0.47" : "0.46",
              strategy: "LIMIT"
            }
          };
        }
      },
      wsClient: {
        connect() {
          return {} as WebSocket;
        },
        subscribe() {},
        respondToHeartbeat() {}
      },
      nowMs: (() => {
        let now = 10_000;
        return () => {
          now += 10_000;
          return now;
        };
      })()
    });

    await loop.bootstrap();
    await loop.handleServerMessageAsync({
      type: "M",
      topic: `predictOrderbook/${PRIMARY_MARKET_ID}`,
      data: {
        marketId: PRIMARY_MARKET_ID,
        updateTimestampMs: 2,
        bids: [[0.49, 100]],
        asks: []
      }
    });
    const snapshot = await loop.runCycleAsync();
    const market = snapshot.markets.find((candidate) => candidate.id === PRIMARY_MARKET_ID);

    expect(market?.touchMoveRatePerMinute).toBeGreaterThan(0);
    expect(market?.marketTradeRatePerMinute).toBeGreaterThan(0);
    expect(market?.oneSidedRatio).toBeGreaterThan(0);
    expect(market?.marketHealth).toBe("inactive-or-toxic");
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
        `predictOrderbook/${PRIMARY_MARKET_ID}`,
        `predictOrderbook/${SECONDARY_MARKET_ID}`,
        `predictOrderbook/${TERTIARY_MARKET_ID}`,
        "predictWalletEvents/jwt-token"
      ]
    ]);
  });

  it("serializes bootstrap live execution ahead of inbound websocket updates", async () => {
    const syncCommandsCalls: unknown[] = [];
    const reportedErrors: unknown[] = [];
    let socketRef: (WebSocket & {
      onmessage: ((event: { data: string }) => void) | null;
    }) | undefined;

    const loop = await createRuntimeLoop("live", {
      ...config,
      bearerToken: "jwt-token"
    }, {
      database: openAnalyticsStore(":memory:"),
      restClient: buildPublicRestClient(),
      onError(error) {
        reportedErrors.push(error);
      },
      liveExecutor: {
        async syncCommands(commands) {
          syncCommandsCalls.push(commands);
          return {
            cancelled: {
              success: true,
              removed: [],
              noop: []
            },
            created: commands
              .filter((command) => command.type === "create")
              .map((command, index) => ({
                code: "CREATED",
                orderId: `order-${syncCommandsCalls.length}-${index + 1}`,
                orderHash: `hash-${syncCommandsCalls.length}-${index + 1}`,
                order: command.order
              }))
          };
        }
      },
      wsClient: {
        connect() {
          socketRef = {
            onmessage: null
          } as WebSocket & { onmessage: ((event: { data: string }) => void) | null };

          return socketRef;
        },
        async subscribe() {
          socketRef?.onmessage?.({
            data: JSON.stringify({
              topic: `predictOrderbook/${PRIMARY_MARKET_ID}`,
              data: {
                marketId: PRIMARY_MARKET_ID,
                updateTimestampMs: 2,
                bids: [[0.45, 100]],
                asks: [[0.47, 120]]
              }
            })
          });
        },
        respondToHeartbeat() {}
      }
    });

    const snapshot = await loop.bootstrap();
    await flushAsyncWork();

    expect(syncCommandsCalls.length).toBeGreaterThanOrEqual(1);
    expect(reportedErrors).toEqual([]);
    expect(snapshot.result.commands).toHaveLength(0);
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

    loop.handleServerMessage(JSON.stringify({ type: "M", topic: "heartbeat", data: 123 }));
    loop.handleServerMessage(
      JSON.stringify({
        type: "M",
        topic: `predictOrderbook/${PRIMARY_MARKET_ID}`,
        data: {
          marketId: PRIMARY_MARKET_ID,
          updateTimestampMs: 2,
          bids: [[0.49, 100]],
          asks: [[0.5, 120]]
        }
      })
    );

    const after = loop.getSnapshot();

    expect(heartbeats).toEqual([123]);
    expect(after.cycleCount).toBe(before.cycleCount + 1);
    expect(after.markets.find((market) => market.id === PRIMARY_MARKET_ID)?.bestBid).toBe(0.49);
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
        topic: `predictOrderbook/${PRIMARY_MARKET_ID}`,
        data: {
          marketId: PRIMARY_MARKET_ID,
          updateTimestampMs: 2,
          bids: [[0.5, 100]],
          asks: [[0.51, 120]]
        }
      })
    });
    await flushAsyncWork();

    const after = loop.getSnapshot();

    expect(after.cycleCount).toBe(before.cycleCount + 1);
    expect(after.markets.find((market) => market.id === PRIMARY_MARKET_ID)?.bestBid).toBe(0.5);
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
            created: commands
              .filter((command) => command.type === "create")
              .map((command, index) => ({
                code: "CREATED",
                orderId: `live-order-${index + 1}`,
                orderHash: `0xhash-${index + 1}`,
                order: command.order
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

  it("keeps partially created live orders in local state when a later create fails", async () => {
    let syncCallCount = 0;
    const loop = await createRuntimeLoop("live", config, {
      database: openAnalyticsStore(":memory:"),
      restClient: buildPublicRestClient(),
      liveExecutor: {
        async syncCommands(commands) {
          syncCallCount += 1;

          if (syncCallCount === 1) {
            const firstCreate = commands.find(
              (command): command is Extract<(typeof commands)[number], { type: "create" }> =>
                command.type === "create"
            );

            if (!firstCreate) {
              return {
                cancelled: {
                  success: true,
                  removed: [],
                  noop: []
                },
                created: []
              };
            }

            throw new PredictLiveSyncError({
              cancelled: {
                success: true,
                removed: [],
                noop: []
              },
              created: [
                {
                  code: "CREATED",
                  orderId: "partial-live-order-1",
                  orderHash: "0xpartial-1",
                  order: firstCreate.order
                }
              ],
              cause: new Error("second create failed")
            });
          }

          return {
            cancelled: {
              success: true,
              removed: [],
              noop: []
            },
            created: []
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

    await expect(loop.bootstrap()).rejects.toThrow("second create failed");

    const snapshot = loop.getSnapshot();
    expect(
      snapshot.result.commands.some(
        (command) =>
          command.type === "create" &&
          command.order.marketId === PRIMARY_MARKET_ID &&
          command.order.side === "bid"
      )
    ).toBe(false);
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
            marketId: PRIMARY_MARKET_ID,
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
        marketId: PRIMARY_MARKET_ID,
        orderId: "order-1",
        side: "bid",
        price: 0.45,
        sizeUsd: 2,
        remainingSizeUsd: 3,
        inventoryDeltaUsd: 2
      }
    });

    const fillRow = database
      .prepare(
        "SELECT market_id, order_hash, side, price, size_usd, inventory_after_usd, mid_at_fill, spread_at_fill, payload_json FROM fills ORDER BY id DESC LIMIT 1"
      )
      .get() as {
      market_id: number;
      order_hash: string;
      side: string;
      price: number;
      size_usd: number;
      inventory_after_usd: number;
      mid_at_fill: number;
      spread_at_fill: number;
      payload_json: string;
    };
    const orderEventRow = database
      .prepare(
        "SELECT event_type, exchange_order_id, logical_side, size_usd FROM order_events ORDER BY id DESC LIMIT 1"
      )
      .get() as {
      event_type: string;
      exchange_order_id: string;
      logical_side: string;
      size_usd: number;
    };

    expect(snapshot.markets.find((market) => market.id === PRIMARY_MARKET_ID)?.inventoryUsd).toBe(2);
    expect(fillRow.market_id).toBe(PRIMARY_MARKET_ID);
    expect(fillRow.order_hash).toBe("order-1");
    expect(fillRow.side).toBe("bid");
    expect(fillRow.price).toBe(0.45);
    expect(fillRow.size_usd).toBe(2);
    expect(fillRow.inventory_after_usd).toBe(2);
    expect(fillRow.mid_at_fill).toBe(0.46);
    expect(fillRow.spread_at_fill).toBe(0.02);
    expect(orderEventRow).toEqual({
      event_type: "PARTIAL_FILL",
      exchange_order_id: "order-1",
      logical_side: "bid",
      size_usd: 2
    });
    expect(JSON.parse(fillRow.payload_json).sizeUsd).toBe(2);
  });

  it("records private state summary into portfolio telemetry for live monitoring", async () => {
    const database = openAnalyticsStore(":memory:");
    const loop = await createRuntimeLoop(
      "live",
      {
        ...config,
        bearerToken: "jwt-token"
      },
      {
        database,
        restClient: {
          ...buildPublicRestClient(),
          async getOrders() {
            return {
              success: true,
              data: [
                {
                  id: "order-1",
                  marketId: PRIMARY_MARKET_ID,
                  currency: "USDT",
                  amount: "5000000000000000000",
                  amountFilled: "0",
                  isNegRisk: false,
                  isYieldBearing: false,
                  strategy: "LIMIT",
                  status: "OPEN",
                  rewardEarningRate: 0,
                  order: {
                    salt: "1",
                    maker: "0xabc",
                    signer: "0xabc",
                    taker: "0x0000000000000000000000000000000000000000",
                    tokenId: "101",
                    makerAmount: "16000000",
                    takerAmount: "5000000",
                    expiration: 9999999999,
                    nonce: "1",
                    feeRateBps: "0",
                    side: 0,
                    signatureType: 0
                  }
                }
              ]
            };
          },
          async getPositions() {
            return {
              success: true,
              data: [
                {
                  id: "position-1",
                  market: { id: PRIMARY_MARKET_ID },
                  outcome: { name: "Yes", indexSet: 1, onChainId: "101" },
                  amount: "1000000000000000000",
                  valueUsd: "3.5",
                  averageBuyPriceUsd: "0.35",
                  pnlUsd: "0.1"
                }
              ]
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
      }
    );

    await loop.bootstrap();

    const row = database
      .prepare(
        "SELECT payload_json FROM portfolio_snapshots ORDER BY id DESC LIMIT 1"
      )
      .get() as { payload_json: string };
    const payload = JSON.parse(row.payload_json) as {
      privateState?: {
        bearerTokenPresent: boolean;
        accountAddress: string | null;
        openOrders: number;
        normalizedOpenOrders: number;
        positions: number;
        positionMarketIds: number[];
        hasUnnormalizedOpenOrders: boolean;
      };
    };

    expect(payload.privateState).toEqual({
      bearerTokenPresent: true,
      accountAddress: "0xabc",
      openOrders: 1,
      normalizedOpenOrders: 1,
      positions: 1,
      positionMarketIds: [PRIMARY_MARKET_ID],
      hasUnnormalizedOpenOrders: false
    });
  });

  it("moves a live market into Protect after a one-sided fill", async () => {
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
        marketId: PRIMARY_MARKET_ID,
        orderId: "order-1",
        side: "bid",
        price: 0.45,
        sizeUsd: 2,
        remainingSizeUsd: 3,
        inventoryDeltaUsd: 2
      }
    });

    expect(snapshot.markets.find((market) => market.id === PRIMARY_MARKET_ID)?.oneSidedFill).toBe(true);
    expect(
      snapshot.result.marketPlans.find((market) => market.marketId === PRIMARY_MARKET_ID)?.nextState
    ).toBe("Protect");
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
        marketId: PRIMARY_MARKET_ID,
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
      topic: `predictOrderbook/${PRIMARY_MARKET_ID}`,
      data: {
        marketId: PRIMARY_MARKET_ID,
        updateTimestampMs: 2,
        bids: [[0.44, 100]],
        asks: [[0.45, 120]]
      }
    });

    expect(snapshot.markets.find((market) => market.id === PRIMARY_MARKET_ID)?.isToxic).toBe(true);
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
    const marketRegimes = database
      .prepare(
        "SELECT market_id, current_state, is_boosted, volume24h_usd, payload_json FROM market_regime_snapshots ORDER BY market_id"
      )
      .all() as Array<{
      market_id: number;
      current_state: string;
      is_boosted: number;
      volume24h_usd: number;
      payload_json: string;
    }>;
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
      { market_id: TERTIARY_MARKET_ID, state: "Protect" },
      { market_id: PRIMARY_MARKET_ID, state: "Quote" },
      { market_id: SECONDARY_MARKET_ID, state: "Protect" }
    ]);
    expect(
      marketRegimes.map((row) => ({
        market_id: row.market_id,
        current_state: row.current_state,
        is_boosted: row.is_boosted,
        volume24h_usd: row.volume24h_usd,
        marketHealth: JSON.parse(row.payload_json).marketHealth
      }))
    ).toEqual([
      {
        market_id: TERTIARY_MARKET_ID,
        current_state: "Protect",
        is_boosted: 0,
        volume24h_usd: 12000,
        marketHealth: "active-risky"
      },
      {
        market_id: PRIMARY_MARKET_ID,
        current_state: "Quote",
        is_boosted: 0,
        volume24h_usd: 18000,
        marketHealth: "active-safe"
      },
      {
        market_id: SECONDARY_MARKET_ID,
        current_state: "Protect",
        is_boosted: 0,
        volume24h_usd: 15000,
        marketHealth: "active-risky"
      }
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
