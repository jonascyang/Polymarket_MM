import { describe, expect, it, vi } from "vitest";
import { Wallet } from "ethers";
import {
  createPredictAccountAuthSigner,
  createWalletAuthSigner
} from "../src/clients/auth-client";

import {
  buildLiveMarketMetadataMap,
  bootstrapConfiguredRuntimeState,
  refreshBootstrappedRuntimeState,
  getExecutionPolicy,
  normalizeOpenOrder,
  runConfiguredRuntimeOnce,
  runRuntimeCycle,
  type RuntimeMarketInput
} from "../src/runtime/runtime";
import { openAnalyticsStore } from "../src/storage/sqlite";

describe("getExecutionPolicy", () => {
  it("disables real order placement in shadow mode", () => {
    expect(getExecutionPolicy("shadow").placeOrders).toBe(false);
  });

  it("enables real order placement in live mode", () => {
    expect(getExecutionPolicy("live").placeOrders).toBe(true);
  });

  it("builds a wallet-backed auth signer from a private key", async () => {
    const wallet = Wallet.createRandom();
    const signer = createWalletAuthSigner(wallet.privateKey);
    const message = "predict-auth-message";

    expect(signer.signer).toBe(wallet.address);
    expect(await signer.signMessage(message)).toBe(
      await wallet.signMessage(message)
    );
  });

  it("builds a predict-account auth signer from a privy wallet and deposit address", async () => {
    const privyWallet = Wallet.createRandom();
    const predictAccount = Wallet.createRandom().address;
    const signPredictAccountMessage = vi.fn(async (message: string) => `sig:${message}`);
    const signer = await createPredictAccountAuthSigner({
      privateKey: privyWallet.privateKey,
      predictAccount,
      builderFactory: async ({ privateKey, predictAccount: configuredAccount }) => {
        expect(privateKey).toBe(privyWallet.privateKey);
        expect(configuredAccount).toBe(predictAccount);

        return {
          signPredictAccountMessage
        };
      }
    });

    expect(signer.signer).toBe(predictAccount);
    expect(await signer.signMessage("predict-auth-message")).toBe(
      "sig:predict-auth-message"
    );
    expect(signPredictAccountMessage).toHaveBeenCalledWith("predict-auth-message");
  });
});

describe("runRuntimeCycle", () => {
  it("builds intended quotes in shadow mode without enabling real placement", () => {
    const result = runRuntimeCycle({
      mode: "shadow",
      markets: [
        {
          id: 10,
          hoursToResolution: 96,
          mid: 0.44,
          spread: 0.01,
          spreadThreshold: 0.06,
          hasTwoSidedBook: true,
          volume24hUsd: 18000,
          isBoosted: true,
          isVisible: true,
          tradingStatus: "OPEN",
          marketVariant: "DEFAULT",
          isToxic: false,
          currentState: "Observe",
          inventoryUsd: 0,
          maxInventoryUsd: 15,
          tickSize: 0.001,
          oneSidedFill: false
        },
        {
          id: 11,
          hoursToResolution: 90,
          mid: 0.48,
          spread: 0.02,
          spreadThreshold: 0.06,
          hasTwoSidedBook: true,
          volume24hUsd: 15000,
          isBoosted: false,
          isVisible: true,
          tradingStatus: "OPEN",
          marketVariant: "DEFAULT",
          isToxic: false,
          currentState: "Observe",
          inventoryUsd: 0,
          maxInventoryUsd: 15,
          tickSize: 0.001,
          oneSidedFill: false
        },
        {
          id: 12,
          hoursToResolution: 88,
          mid: 0.53,
          spread: 0.02,
          spreadThreshold: 0.06,
          hasTwoSidedBook: true,
          volume24hUsd: 12000,
          isBoosted: false,
          isVisible: true,
          tradingStatus: "OPEN",
          marketVariant: "DEFAULT",
          isToxic: false,
          currentState: "Observe",
          inventoryUsd: 0,
          maxInventoryUsd: 15,
          tickSize: 0.001,
          oneSidedFill: false
        }
      ],
      currentOrders: [],
      riskInput: {
        flattenPnlPct: -0.001,
        peakDrawdownPct: -0.001,
        aggregateNetInventoryUsd: 0,
        aggregateNetInventoryCapUsd: 45,
        minutesToExit: 180
      }
    });

    expect(result.policy.placeOrders).toBe(false);
    expect(result.risk.mode).toBe("Normal");
    expect(result.marketPlans.map((plan) => [plan.marketId, plan.nextState])).toEqual([
      [10, "Quote"],
      [11, "Protect"],
      [12, "Protect"]
    ]);
    expect(result.orderDiff.create).toHaveLength(6);
  });

  it("scales quote sizes with portfolio utilization pressure", () => {
    const market: RuntimeMarketInput = {
      id: 1518,
      hoursToResolution: 96,
      mid: 0.5,
      spread: 0.002,
      spreadThreshold: 0.06,
      hasTwoSidedBook: true,
      volume24hUsd: 18000,
      isBoosted: true,
      isVisible: true,
      tradingStatus: "OPEN",
      marketVariant: "DEFAULT",
      isToxic: false,
      currentState: "Observe",
      inventoryUsd: 0,
      maxInventoryUsd: 15,
      tickSize: 0.001,
      oneSidedFill: false,
      marketPool: "core_sports" as const,
      whitelistTier: "active" as const,
      marketHealth: "active-safe" as const,
      bidBook: [
        { price: 0.499, size: 300 },
        { price: 0.497, size: 100 }
      ],
      askBook: [
        { price: 0.501, size: 300 },
        { price: 0.503, size: 100 }
      ],
      bestBid: 0.499,
      bestAsk: 0.501
    };

    const lowUtilization = runRuntimeCycle({
      mode: "shadow",
      markets: [market],
      currentOrders: [],
      privateState: {
        bearerTokenPresent: true,
        account: null,
        openOrders: [],
        normalizedOpenOrders: [],
        positions: [],
        inventoryByMarket: {},
        hasUnnormalizedOpenOrders: false
      },
      riskInput: {
        flattenPnlPct: -0.001,
        peakDrawdownPct: -0.001,
        aggregateNetInventoryUsd: 0,
        aggregateNetInventoryCapUsd: 45,
        minutesToExit: 180
      }
    });

    const highUtilization = runRuntimeCycle({
      mode: "shadow",
      markets: [market],
      currentOrders: [],
      privateState: {
        bearerTokenPresent: true,
        account: null,
        openOrders: [],
        normalizedOpenOrders: [],
        positions: [
          {
            id: "position-a",
            market: { id: 1518 },
            outcome: { name: "Yes", indexSet: 1, onChainId: "1518-yes" },
            amount: "1000000000000000000",
            valueUsd: "50",
            averageBuyPriceUsd: "0.5",
            pnlUsd: "0"
          },
          {
            id: "position-b",
            market: { id: 1518 },
            outcome: { name: "No", indexSet: 2, onChainId: "1518-no" },
            amount: "1000000000000000000",
            valueUsd: "45",
            averageBuyPriceUsd: "0.5",
            pnlUsd: "0"
          }
        ],
        inventoryByMarket: {},
        hasUnnormalizedOpenOrders: false
      },
      riskInput: {
        flattenPnlPct: -0.001,
        peakDrawdownPct: -0.001,
        aggregateNetInventoryUsd: 0,
        aggregateNetInventoryCapUsd: 45,
        minutesToExit: 180
      }
    });

    expect(lowUtilization.orderDiff.create).toEqual([
      {
        marketId: 1518,
        side: "bid",
        price: 0.499,
        sizeUsd: 12
      },
      {
        marketId: 1518,
        side: "ask",
        price: 0.501,
        sizeUsd: 12
      }
    ]);
    expect(highUtilization.orderDiff.create).toEqual([
      {
        marketId: 1518,
        side: "bid",
        price: 0.499,
        sizeUsd: 4.5
      },
      {
        marketId: 1518,
        side: "ask",
        price: 0.501,
        sizeUsd: 4.5
      }
    ]);
  });

  it("throttles markets after repeated quote churn without fills", () => {
    const result = runRuntimeCycle({
      mode: "shadow",
      markets: [
        {
          id: 10,
          hoursToResolution: 96,
          mid: 0.44,
          spread: 0.01,
          spreadThreshold: 0.06,
          hasTwoSidedBook: true,
          volume24hUsd: 18000,
          isBoosted: true,
          isVisible: true,
          tradingStatus: "OPEN",
          marketVariant: "DEFAULT",
          isToxic: false,
          currentState: "Quote",
          inventoryUsd: 0,
          maxInventoryUsd: 15,
          tickSize: 0.001,
          oneSidedFill: false,
          quoteCountSinceFill: 6,
          marketTradeRatePerMinute: 0.3
        }
      ],
      currentOrders: [],
      riskInput: {
        flattenPnlPct: -0.001,
        peakDrawdownPct: -0.001,
        aggregateNetInventoryUsd: 0,
        aggregateNetInventoryCapUsd: 45,
        minutesToExit: 180
      }
    });

    expect(result.marketPlans).toHaveLength(1);
    expect(result.marketPlans[0]?.nextState).toBe("Throttle");
  });

  it("pauses markets after prolonged quote churn without fills", () => {
    const result = runRuntimeCycle({
      mode: "shadow",
      markets: [
        {
          id: 10,
          hoursToResolution: 96,
          mid: 0.44,
          spread: 0.01,
          spreadThreshold: 0.06,
          hasTwoSidedBook: true,
          volume24hUsd: 18000,
          isBoosted: true,
          isVisible: true,
          tradingStatus: "OPEN",
          marketVariant: "DEFAULT",
          isToxic: false,
          currentState: "Quote",
          inventoryUsd: 0,
          maxInventoryUsd: 15,
          tickSize: 0.001,
          oneSidedFill: false,
          quoteCountSinceFill: 12,
          marketTradeRatePerMinute: 0.3
        }
      ],
      currentOrders: [],
      riskInput: {
        flattenPnlPct: -0.001,
        peakDrawdownPct: -0.001,
        aggregateNetInventoryUsd: 0,
        aggregateNetInventoryCapUsd: 45,
        minutesToExit: 180
      }
    });

    expect(result.marketPlans).toHaveLength(1);
    expect(result.marketPlans[0]?.nextState).toBe("Throttle");
  });

  it("pauses quiet markets once quote churn stays high without real trade activity", () => {
    const result = runRuntimeCycle({
      mode: "shadow",
      markets: [
        {
          id: 10,
          hoursToResolution: 96,
          mid: 0.44,
          spread: 0.01,
          spreadThreshold: 0.06,
          hasTwoSidedBook: true,
          volume24hUsd: 18000,
          isBoosted: true,
          isVisible: true,
          tradingStatus: "OPEN",
          marketVariant: "DEFAULT",
          isToxic: false,
          currentState: "Quote",
          inventoryUsd: 0,
          maxInventoryUsd: 15,
          tickSize: 0.001,
          oneSidedFill: false,
          quoteCountSinceFill: 12,
          marketTradeRatePerMinute: 0,
          touchMoveRatePerMinute: 0
        }
      ],
      currentOrders: [],
      riskInput: {
        flattenPnlPct: -0.001,
        peakDrawdownPct: -0.001,
        aggregateNetInventoryUsd: 0,
        aggregateNetInventoryCapUsd: 45,
        minutesToExit: 180
      }
    });

    expect(result.marketPlans[0]?.nextState).toBe("Pause");
  });

  it("switches to emergency flatten on hard stop", () => {
    const result = runRuntimeCycle({
      mode: "live",
      markets: [
        {
          id: 10,
          hoursToResolution: 96,
          mid: 0.44,
          spread: 0.01,
          spreadThreshold: 0.06,
          hasTwoSidedBook: true,
          volume24hUsd: 18000,
          isBoosted: true,
          isVisible: true,
          tradingStatus: "OPEN",
          marketVariant: "DEFAULT",
          isToxic: false,
          currentState: "Protect",
          inventoryUsd: 8,
          maxInventoryUsd: 15,
          tickSize: 0.001,
          oneSidedFill: false,
          bestBid: 0.44,
          bestAsk: 0.46
        }
      ],
      currentOrders: [
        {
          id: "open-bid",
          marketId: 10,
          side: "bid",
          price: 0.43,
          sizeUsd: 5
        }
      ],
      riskInput: {
        flattenPnlPct: -0.021,
        peakDrawdownPct: -0.01,
        aggregateNetInventoryUsd: 8,
        aggregateNetInventoryCapUsd: 45,
        minutesToExit: 180
      }
    });

    expect(result.risk.mode).toBe("HardStop");
    expect(result.orderDiff.cancel.map((order) => order.id)).toEqual(["open-bid"]);
    expect(result.orderDiff.create).toEqual([
      {
        marketId: 10,
        side: "ask",
        price: 0.44,
        sizeUsd: 8
      }
    ]);
  });

  it("quotes only the inventory-relieving side in protect mode", () => {
    const result = runRuntimeCycle({
      mode: "shadow",
      markets: [
        {
          id: 10,
          hoursToResolution: 96,
          mid: 0.44,
          spread: 0.01,
          spreadThreshold: 0.06,
          hasTwoSidedBook: true,
          volume24hUsd: 18000,
          isBoosted: true,
          isVisible: true,
          tradingStatus: "OPEN",
          marketVariant: "DEFAULT",
          isToxic: false,
          currentState: "Protect",
          inventoryUsd: 8,
          maxInventoryUsd: 15,
          tickSize: 0.001,
          oneSidedFill: false,
          bestBid: 0.44,
          bestAsk: 0.46
        }
      ],
      currentOrders: [],
      riskInput: {
        flattenPnlPct: -0.001,
        peakDrawdownPct: -0.001,
        aggregateNetInventoryUsd: 8,
        aggregateNetInventoryCapUsd: 45,
        minutesToExit: 180
      }
    });

    expect(result.marketPlans[0]?.nextState).toBe("Protect");
    expect(result.orderDiff.create).toEqual([
      {
        marketId: 10,
        side: "ask",
        price: 0.46,
        sizeUsd: 4
      }
    ]);
  });

  it("switches into drain after a one-sided fill and only quotes a non-loss-making exit", () => {
    const result = runRuntimeCycle({
      mode: "shadow",
      markets: [
        {
          id: 10,
          hoursToResolution: 96,
          mid: 0.5,
          spread: 0.002,
          spreadThreshold: 0.06,
          hasTwoSidedBook: true,
          volume24hUsd: 18000,
          isBoosted: true,
          isVisible: true,
          tradingStatus: "OPEN",
          marketVariant: "DEFAULT",
          isToxic: false,
          currentState: "Quote",
          inventoryUsd: 4,
          maxInventoryUsd: 15,
          tickSize: 0.001,
          oneSidedFill: true,
          bestBid: 0.499,
          bestAsk: 0.501,
          askBook: [
            { price: 0.501, size: 40 },
            { price: 0.502, size: 40 }
          ]
        }
      ],
      currentOrders: [],
      privateState: {
        bearerTokenPresent: true,
        account: null,
        openOrders: [],
        normalizedOpenOrders: [],
        positions: [
          {
            id: "position-1",
            market: { id: 10 },
            outcome: { name: "Yes", indexSet: 1, onChainId: "10-yes" },
            amount: "1000000000000000000",
            valueUsd: "4",
            averageBuyPriceUsd: "0.503",
            pnlUsd: "0"
          }
        ],
        inventoryByMarket: { 10: 4 },
        hasUnnormalizedOpenOrders: false
      },
      riskInput: {
        flattenPnlPct: -0.001,
        peakDrawdownPct: -0.001,
        aggregateNetInventoryUsd: 4,
        aggregateNetInventoryCapUsd: 45,
        minutesToExit: 180
      }
    });

    expect(result.marketPlans[0]?.nextState).toBe("Drain");
    expect(result.orderDiff.create).toEqual([
      {
        marketId: 10,
        side: "ask",
        price: 0.504,
        sizeUsd: 8
      }
    ]);
  });

  it("places a drain exit once the selected price clears the market break-even floor", () => {
    const result = runRuntimeCycle({
      mode: "shadow",
      markets: [
        {
          id: 10,
          hoursToResolution: 96,
          mid: 0.5,
          spread: 0.002,
          spreadThreshold: 0.06,
          hasTwoSidedBook: true,
          volume24hUsd: 18000,
          isBoosted: true,
          isVisible: true,
          tradingStatus: "OPEN",
          marketVariant: "DEFAULT",
          isToxic: false,
          currentState: "Quote",
          inventoryUsd: 4,
          maxInventoryUsd: 15,
          tickSize: 0.001,
          oneSidedFill: true,
          bestBid: 0.503,
          bestAsk: 0.504,
          askBook: [
            { price: 0.504, size: 40 },
            { price: 0.505, size: 40 }
          ]
        }
      ],
      currentOrders: [],
      privateState: {
        bearerTokenPresent: true,
        account: null,
        openOrders: [],
        normalizedOpenOrders: [],
        positions: [
          {
            id: "position-1",
            market: { id: 10 },
            outcome: { name: "Yes", indexSet: 1, onChainId: "10-yes" },
            amount: "1000000000000000000",
            valueUsd: "4",
            averageBuyPriceUsd: "0.503",
            pnlUsd: "0"
          }
        ],
        inventoryByMarket: { 10: 4 },
        hasUnnormalizedOpenOrders: false
      },
      riskInput: {
        flattenPnlPct: -0.001,
        peakDrawdownPct: -0.001,
        aggregateNetInventoryUsd: 4,
        aggregateNetInventoryCapUsd: 45,
        minutesToExit: 180
      }
    });

    expect(result.marketPlans[0]?.nextState).toBe("Drain");
    expect(result.orderDiff.create).toEqual([
      {
        marketId: 10,
        side: "ask",
        price: 0.504,
        sizeUsd: 2.016
      }
    ]);
  });

  it("promotes an existing non-zero inventory market into drain instead of leaving it paused", () => {
    const result = runRuntimeCycle({
      mode: "shadow",
      markets: [
        {
          id: 10,
          hoursToResolution: 96,
          mid: 0.4,
          spread: 0.001,
          spreadThreshold: 0.06,
          hasTwoSidedBook: true,
          volume24hUsd: 20000,
          isBoosted: false,
          isVisible: true,
          tradingStatus: "OPEN",
          marketVariant: "DEFAULT",
          isToxic: false,
          currentState: "Protect",
          inventoryUsd: -5.94,
          maxInventoryUsd: 15,
          tickSize: 0.001,
          oneSidedFill: false,
          quoteCountSinceFill: 12,
          marketTradeRatePerMinute: 0,
          touchMoveRatePerMinute: 0,
          bestBid: 0.399,
          bestAsk: 0.4,
          bidBook: [
            { price: 0.399, size: 124.44 },
            { price: 0.397, size: 280 }
          ],
          askBook: [
            { price: 0.4, size: 5223.40115 },
            { price: 0.401, size: 160 }
          ],
          marketPool: "core_sports",
          whitelistTier: "active",
          marketHealth: "active-risky"
        }
      ],
      currentOrders: [],
      privateState: {
        bearerTokenPresent: true,
        account: null,
        openOrders: [],
        normalizedOpenOrders: [],
        positions: [
          {
            id: "position-1",
            market: { id: 10 },
            outcome: { name: "No", indexSet: 2, onChainId: "10-no" },
            amount: "9900900000000000000",
            valueUsd: "5.94",
            averageBuyPriceUsd: "0.606",
            pnlUsd: "-0.06"
          }
        ],
        inventoryByMarket: { 10: -5.94 },
        hasUnnormalizedOpenOrders: false
      },
      riskInput: {
        flattenPnlPct: -0.001,
        peakDrawdownPct: -0.001,
        aggregateNetInventoryUsd: -5.94,
        aggregateNetInventoryCapUsd: 45,
        minutesToExit: 180
      }
    });

    expect(result.marketPlans[0]?.nextState).toBe("Drain");
    expect(result.orderDiff.create).toEqual([
      {
        marketId: 10,
        side: "bid",
        price: 0.393,
        sizeUsd: 8
      }
    ]);
  });

  it("drains an existing long inventory from protect mode even when break-even sits outside the top two asks", () => {
    const result = runRuntimeCycle({
      mode: "shadow",
      markets: [
        {
          id: 10,
          hoursToResolution: 96,
          mid: 0.5,
          spread: 0.002,
          spreadThreshold: 0.06,
          hasTwoSidedBook: true,
          volume24hUsd: 18000,
          isBoosted: true,
          isVisible: true,
          tradingStatus: "OPEN",
          marketVariant: "DEFAULT",
          isToxic: false,
          currentState: "Protect",
          inventoryUsd: 4,
          maxInventoryUsd: 15,
          tickSize: 0.001,
          oneSidedFill: false,
          bestBid: 0.499,
          bestAsk: 0.501,
          askBook: [
            { price: 0.501, size: 40 },
            { price: 0.502, size: 40 }
          ],
          marketPool: "core_sports",
          whitelistTier: "active",
          marketHealth: "active-safe"
        }
      ],
      currentOrders: [],
      privateState: {
        bearerTokenPresent: true,
        account: null,
        openOrders: [],
        normalizedOpenOrders: [],
        positions: [
          {
            id: "position-1",
            market: { id: 10 },
            outcome: { name: "Yes", indexSet: 1, onChainId: "10-yes" },
            amount: "1000000000000000000",
            valueUsd: "4",
            averageBuyPriceUsd: "0.503",
            pnlUsd: "0"
          }
        ],
        inventoryByMarket: { 10: 4 },
        hasUnnormalizedOpenOrders: false
      },
      riskInput: {
        flattenPnlPct: -0.001,
        peakDrawdownPct: -0.001,
        aggregateNetInventoryUsd: 4,
        aggregateNetInventoryCapUsd: 45,
        minutesToExit: 180
      }
    });

    expect(result.marketPlans[0]?.nextState).toBe("Drain");
    expect(result.orderDiff.create).toEqual([
      {
        marketId: 10,
        side: "ask",
        price: 0.504,
        sizeUsd: 8
      }
    ]);
  });

  it("keeps existing orders in place while throttle cadence blocks a refresh", () => {
    const result = runRuntimeCycle({
      mode: "shadow",
      markets: [
        {
          id: 10,
          hoursToResolution: 96,
          mid: 0.44,
          spread: 0.01,
          spreadThreshold: 0.06,
          hasTwoSidedBook: true,
          volume24hUsd: 18000,
          isBoosted: true,
          isVisible: true,
          tradingStatus: "OPEN",
          marketVariant: "DEFAULT",
          isToxic: false,
          currentState: "Throttle",
          inventoryUsd: 0,
          maxInventoryUsd: 15,
          tickSize: 0.001,
          oneSidedFill: false,
          quoteCountSinceFill: 6,
          marketTradeRatePerMinute: 1,
          touchMoveRatePerMinute: 1,
          lastQuoteUpdateAtMs: 1_000
        }
      ],
      currentOrders: [
        {
          id: "bid-1",
          marketId: 10,
          side: "bid",
          price: 0.439,
          sizeUsd: 4
        },
        {
          id: "ask-1",
          marketId: 10,
          side: "ask",
          price: 0.441,
          sizeUsd: 4
        }
      ],
      riskInput: {
        flattenPnlPct: -0.001,
        peakDrawdownPct: -0.001,
        aggregateNetInventoryUsd: 0,
        aggregateNetInventoryCapUsd: 45,
        minutesToExit: 180
      },
      nowMs: 20_000
    });

    expect(result.marketPlans[0]?.nextState).toBe("Throttle");
    expect(result.orderDiff.create).toEqual([]);
    expect(result.orderDiff.cancel).toEqual([]);
  });

  it("reprices throttle quotes immediately when the held orders fall outside the current top-two candidates", () => {
    const result = runRuntimeCycle({
      mode: "shadow",
      markets: [
        {
          id: 10,
          hoursToResolution: 96,
          mid: 0.5,
          spread: 0.002,
          spreadThreshold: 0.06,
          hasTwoSidedBook: true,
          volume24hUsd: 18000,
          isBoosted: true,
          isVisible: true,
          tradingStatus: "OPEN",
          marketVariant: "DEFAULT",
          isToxic: false,
          currentState: "Throttle",
          inventoryUsd: 0,
          maxInventoryUsd: 15,
          tickSize: 0.001,
          oneSidedFill: false,
          quoteCountSinceFill: 6,
          marketTradeRatePerMinute: 1,
          touchMoveRatePerMinute: 1,
          lastQuoteUpdateAtMs: 10_000,
          bidBook: [
            { price: 0.499, size: 99 },
            { price: 0.498, size: 20 }
          ],
          askBook: [
            { price: 0.501, size: 99 },
            { price: 0.502, size: 20 }
          ],
          bestBid: 0.499,
          bestAsk: 0.501
        }
      ],
      currentOrders: [
        {
          id: "bid-1",
          marketId: 10,
          side: "bid",
          price: 0.495,
          sizeUsd: 4
        },
        {
          id: "ask-1",
          marketId: 10,
          side: "ask",
          price: 0.505,
          sizeUsd: 4
        }
      ],
      riskInput: {
        flattenPnlPct: -0.001,
        peakDrawdownPct: -0.001,
        aggregateNetInventoryUsd: 0,
        aggregateNetInventoryCapUsd: 45,
        minutesToExit: 180
      },
      nowMs: 20_000
    });

    expect(result.marketPlans[0]?.nextState).toBe("Throttle");
    expect(result.orderDiff.cancel.map((order) => order.id).sort()).toEqual(["ask-1", "bid-1"]);
    expect(result.orderDiff.create).toEqual([
      {
        marketId: 10,
        side: "bid",
        price: 0.499,
        sizeUsd: 4
      },
      {
        marketId: 10,
        side: "ask",
        price: 0.501,
        sizeUsd: 4
      }
    ]);
  });
});

describe("runConfiguredRuntimeOnce", () => {
  it("normalizes private open orders from the official order payload", () => {
    const normalized = normalizeOpenOrder({
      id: "order-1",
      marketId: 10,
      currency: "USDT",
      amount: "10000000000000000000",
      amountFilled: "2000000000000000000",
      isNegRisk: true,
      isYieldBearing: true,
      strategy: "LIMIT",
      status: "OPEN",
      rewardEarningRate: 5,
      order: {
        salt: "1",
        maker: "0xmaker",
        signer: "0xmaker",
        taker: "0x0000000000000000000000000000000000000000",
        tokenId: "123",
        makerAmount: "4000000000000000000",
        takerAmount: "10000000000000000000",
        expiration: 9999999999,
        nonce: "1",
        feeRateBps: "200",
        side: 0,
        signatureType: 0
      }
    });

    expect(normalized).toEqual({
      id: "order-1",
      marketId: 10,
      side: "bid",
      price: 0.4,
      sizeUsd: 3.2
    });
  });

  it("maps complementary-outcome buy orders back into logical asks", () => {
    const normalized = normalizeOpenOrder(
      {
        id: "order-2",
        marketId: 10,
        currency: "USDT",
        amount: "10000000000000000000",
        amountFilled: "2000000000000000000",
        isNegRisk: true,
        isYieldBearing: true,
        strategy: "LIMIT",
        status: "OPEN",
        rewardEarningRate: 5,
        order: {
          salt: "1",
          maker: "0xmaker",
          signer: "0xmaker",
          taker: "0x0000000000000000000000000000000000000000",
          tokenId: "456",
          makerAmount: "6000000000000000000",
          takerAmount: "10000000000000000000",
          expiration: 9999999999,
          nonce: "1",
          feeRateBps: "200",
          side: 0,
          signatureType: 0
        }
      },
      {
        10: {
          marketId: 10,
          tokenId: "123",
          complementaryTokenId: "456",
          feeRateBps: 200,
          isNegRisk: true,
          isYieldBearing: true
        }
      }
    );

    expect(normalized).toEqual({
      id: "order-2",
      marketId: 10,
      side: "ask",
      price: 0.4,
      sizeUsd: 4.8
    });
  });

  it("derives live execution metadata from runtime markets", () => {
    const metadata = buildLiveMarketMetadataMap([
      {
        id: 10,
        hoursToResolution: 96,
        mid: 0.44,
        spread: 0.01,
        spreadThreshold: 0.06,
        hasTwoSidedBook: true,
        volume24hUsd: 18000,
        isBoosted: true,
        isVisible: true,
        tradingStatus: "OPEN",
        marketVariant: "DEFAULT",
        isToxic: false,
        currentState: "Observe",
        inventoryUsd: 0,
        maxInventoryUsd: 15,
        tickSize: 0.001,
        oneSidedFill: false,
        isNegRisk: true,
        isYieldBearing: true,
        feeRateBps: 200,
        tokenId: "123",
        complementaryTokenId: "456"
      }
    ]);

    expect(metadata).toEqual({
      10: {
        marketId: 10,
        tokenId: "123",
        complementaryTokenId: "456",
        feeRateBps: 200,
        isNegRisk: true,
        isYieldBearing: true
      }
    });
  });

  it("uses normalized private open orders instead of suppressing creates", async () => {
    const state = await bootstrapConfiguredRuntimeState(
      "live",
      {
        apiBaseUrl: "https://api.predict.fun/v1",
        wsUrl: "wss://ws.predict.fun/ws",
        apiKey: "key",
        dbPath: ":memory:",
        bearerToken: "jwt"
      },
      {
        database: openAnalyticsStore(":memory:"),
        restClient: {
          async getMarkets() {
            return {
              success: true,
              data: [
                {
                  id: 1518,
                  title: "Spain",
                  question: "A?",
                  description: "",
                  tradingStatus: "OPEN",
                  status: "OPEN",
                  isVisible: true,
                  isNegRisk: true,
                  isYieldBearing: true,
                  feeRateBps: 200,
                  oracleQuestionId: "oq-1518",
                  conditionId: "cond-1518",
                  resolverAddress: "0x0",
                  outcomes: [
                    { name: "Yes", indexSet: 1, onChainId: "123" },
                    { name: "No", indexSet: 2, onChainId: "456" }
                  ],
                  spreadThreshold: 0.06,
                  shareThreshold: 1,
                  isBoosted: true,
                  polymarketConditionIds: [],
                  categorySlug: "2026-fifa-world-cup-winner",
                  createdAt: "2026-04-02T00:00:00Z",
                  decimalPrecision: 3,
                  marketVariant: "DEFAULT",
                  imageUrl: "",
                  stats: {
                    totalLiquidityUsd: 1000,
                    volume24hUsd: 18000,
                    volumeTotalUsd: 50000
                  }
                }
              ]
            };
          },
          async getMarketOrderbook() {
            return {
              success: true,
              data: {
                marketId: 10,
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
              data: [
                {
                  id: "order-1",
                  marketId: 10,
                  currency: "USDT",
                  amount: "10000000000000000000",
                  amountFilled: "2000000000000000000",
                  isNegRisk: true,
                  isYieldBearing: true,
                  strategy: "LIMIT",
                  status: "OPEN",
                  rewardEarningRate: 5,
                  order: {
                    salt: "1",
                    maker: "0xmaker",
                    signer: "0xmaker",
                    taker: "0x0000000000000000000000000000000000000000",
                    tokenId: "123",
                    makerAmount: "4000000000000000000",
                    takerAmount: "10000000000000000000",
                    expiration: 9999999999,
                    nonce: "1",
                    feeRateBps: "200",
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
        }
      }
    );

    expect(state.suppressCreates).toBe(false);
    expect(state.currentOrders).toEqual([
      {
        id: "order-1",
        marketId: 10,
        side: "bid",
        price: 0.4,
        sizeUsd: 3.2
      }
    ]);
  });

  it("loads missing whitelist markets from later market pages", async () => {
    const getMarketsCalls: Array<string | undefined> = [];
    const buildMarket = (
      id: number,
      title: string,
      categorySlug: string,
      volume24hUsd: number
    ) => ({
      id,
      title,
      question: `${title}?`,
      description: "",
      tradingStatus: "OPEN",
      status: "OPEN",
      isVisible: true,
      isNegRisk: categorySlug.includes("nba") || categorySlug.includes("fifa"),
      isYieldBearing: categorySlug.includes("nba") || categorySlug.includes("fifa"),
      feeRateBps: 200,
      oracleQuestionId: `oq-${id}`,
      conditionId: `cond-${id}`,
      resolverAddress: "0x0",
      outcomes: [
        { name: "Yes", indexSet: 1, onChainId: `${id}-yes` },
        { name: "No", indexSet: 2, onChainId: `${id}-no` }
      ],
      spreadThreshold: 0.06,
      shareThreshold: 1,
      isBoosted: false,
      polymarketConditionIds: [],
      categorySlug,
      createdAt: "2026-04-02T00:00:00Z",
      decimalPrecision: 3,
      marketVariant: "DEFAULT",
      imageUrl: "",
      stats: {
        totalLiquidityUsd: 1000,
        volume24hUsd,
        volumeTotalUsd: volume24hUsd * 2
      }
    });

    const state = await bootstrapConfiguredRuntimeState(
      "live",
      {
        apiBaseUrl: "https://api.predict.fun/v1",
        wsUrl: "wss://ws.predict.fun/ws",
        apiKey: "key",
        dbPath: ":memory:",
        bearerToken: "jwt"
      },
      {
        first: 2,
        database: openAnalyticsStore(":memory:"),
        restClient: {
          async getMarkets(query = {}) {
            getMarketsCalls.push(query.after);

            if (!query.after) {
              return {
                success: true,
                cursor: "page-2",
                data: [
                  buildMarket(1518, "Spain", "2026-fifa-world-cup-winner", 500000),
                  buildMarket(933, "Base", "will-base-launch-a-token-by", 700000)
                ]
              };
            }

            expect(query.after).toBe("page-2");

            return {
              success: true,
              data: [
                buildMarket(991, "Polymarket", "will-polymarket-launch-a-token-by", 280000),
                buildMarket(1469, "Oklahoma City Thunder", "2026-nba-champion", 27000)
              ]
            };
          },
          async getMarketOrderbook(marketId) {
            const midByMarket: Record<number, number> = {
              1518: 0.1575,
              933: 0.3595,
              991: 0.8755,
              1469: 0.3995
            };
            const mid = midByMarket[marketId] ?? 0.5;

            return {
              success: true,
              data: {
                marketId,
                updateTimestampMs: 1,
                bids: [[Number((mid - 0.0005).toFixed(3)), 100]],
                asks: [[Number((mid + 0.0005).toFixed(3)), 120]]
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
              data: [
                {
                  id: "position-1469-no",
                  market: { id: 1469 },
                  outcome: { name: "No", indexSet: 2, onChainId: "1469-no" },
                  amount: "10000000000000000000",
                  valueUsd: "5.94",
                  averageBuyPriceUsd: "0.606",
                  pnlUsd: "-0.06"
                },
                {
                  id: "position-991-yes",
                  market: { id: 991 },
                  outcome: { name: "Yes", indexSet: 1, onChainId: "991-yes" },
                  amount: "10000000000000000000",
                  valueUsd: "1.83",
                  averageBuyPriceUsd: "0.8722",
                  pnlUsd: "-0.14"
                }
              ]
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
        }
      }
    );

    expect(getMarketsCalls).toEqual([undefined, "page-2"]);
    expect(state.markets.some((market) => market.id === 1469)).toBe(true);
    expect(state.markets.some((market) => market.id === 991)).toBe(true);
    expect(state.result.marketPlans.map((plan) => [plan.marketId, plan.selectedMode])).toEqual([
      [1469, "Quote"],
      [1518, "Protect"],
      [991, "Protect"]
    ]);
  });

  it("refreshes live current orders from normalized private open orders", async () => {
    let orderBookVersion = 1;

    const state = await bootstrapConfiguredRuntimeState(
      "live",
      {
        apiBaseUrl: "https://api.predict.fun/v1",
        wsUrl: "wss://ws.predict.fun/ws",
        apiKey: "key",
        dbPath: ":memory:",
        bearerToken: "jwt"
      },
      {
        database: openAnalyticsStore(":memory:"),
        restClient: {
          async getMarkets() {
            return {
              success: true,
              data: [
                {
                  id: 1469,
                  title: "Oklahoma City Thunder",
                  question: "A?",
                  description: "",
                  tradingStatus: "OPEN",
                  status: "OPEN",
                  isVisible: true,
                  isNegRisk: true,
                  isYieldBearing: true,
                  feeRateBps: 200,
                  oracleQuestionId: "oq-1469",
                  conditionId: "cond-1469",
                  resolverAddress: "0x0",
                  outcomes: [
                    { name: "Yes", indexSet: 1, onChainId: "123" },
                    { name: "No", indexSet: 2, onChainId: "456" }
                  ],
                  spreadThreshold: 0.06,
                  shareThreshold: 1,
                  isBoosted: true,
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
                }
              ]
            };
          },
          async getMarketOrderbook() {
            return {
              success: true,
              data: {
                marketId: 10,
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
            if (orderBookVersion === 1) {
              return {
                success: true,
                data: [
                  {
                    id: "order-1",
                    marketId: 10,
                    currency: "USDT",
                    amount: "10000000000000000000",
                    amountFilled: "2000000000000000000",
                    isNegRisk: true,
                    isYieldBearing: true,
                    strategy: "LIMIT",
                    status: "OPEN",
                    rewardEarningRate: 5,
                    order: {
                      salt: "1",
                      maker: "0xmaker",
                      signer: "0xmaker",
                      taker: "0x0000000000000000000000000000000000000000",
                      tokenId: "123",
                      makerAmount: "4000000000000000000",
                      takerAmount: "10000000000000000000",
                      expiration: 9999999999,
                      nonce: "1",
                      feeRateBps: "200",
                      side: 0,
                      signatureType: 0
                    }
                  }
                ]
              };
            }

            return {
              success: true,
              data: [
                {
                  id: "order-2",
                  marketId: 10,
                  currency: "USDT",
                  amount: "10000000000000000000",
                  amountFilled: "0",
                  isNegRisk: true,
                  isYieldBearing: true,
                  strategy: "LIMIT",
                  status: "OPEN",
                  rewardEarningRate: 5,
                  order: {
                    salt: "2",
                    maker: "0xmaker",
                    signer: "0xmaker",
                    taker: "0x0000000000000000000000000000000000000000",
                    tokenId: "123",
                    makerAmount: "6000000000000000000",
                    takerAmount: "10000000000000000000",
                    expiration: 9999999999,
                    nonce: "2",
                    feeRateBps: "200",
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
        }
      }
    );

    orderBookVersion = 2;
    await refreshBootstrappedRuntimeState(state);

    expect(state.currentOrders).toEqual([
      {
        id: "order-2",
        marketId: 10,
        side: "bid",
        price: 0.6,
        sizeUsd: 6
      }
    ]);
  });

  it("bootstraps market data from the REST client and records snapshots", async () => {
    const database = openAnalyticsStore(":memory:");
    const result = await runConfiguredRuntimeOnce(
      "paper",
      {
        apiBaseUrl: "https://api.predict.fun/v1",
        wsUrl: "wss://ws.predict.fun/ws",
        apiKey: "key",
        dbPath: ":memory:"
      },
      {
        database,
        restClient: {
          async getMarkets() {
            return {
              success: true,
              data: [
                {
                  id: 1469,
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
                  outcomes: [],
                  spreadThreshold: 0.06,
                  shareThreshold: 1,
                  isBoosted: true,
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
                  id: 1520,
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
                  outcomes: [],
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
                  id: 933,
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
                  outcomes: [],
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
          }
        }
      }
    );

    const counts = {
      snapshots: database.prepare("SELECT COUNT(*) AS count FROM market_snapshots").get() as { count: number },
      orderbooks: database.prepare("SELECT COUNT(*) AS count FROM orderbook_events").get() as { count: number },
      lastSales: database.prepare("SELECT COUNT(*) AS count FROM last_sale_events").get() as { count: number }
    };

    expect(result.marketPlans).toHaveLength(3);
    expect(counts.snapshots.count).toBe(3);
    expect(counts.orderbooks.count).toBe(3);
    expect(counts.lastSales.count).toBe(3);
  });

  it("loads private account state when a bearer token is configured", async () => {
    const result = await runConfiguredRuntimeOnce(
      "shadow",
      {
        apiBaseUrl: "https://api.predict.fun/v1",
        wsUrl: "wss://ws.predict.fun/ws",
        apiKey: "key",
        dbPath: ":memory:",
        bearerToken: "jwt-token"
      },
      {
        database: openAnalyticsStore(":memory:"),
        restClient: {
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
                  outcomes: [],
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
              data: [
                {
                  id: "order-1",
                  marketId: 10,
                  currency: "USDT",
                  amount: "5",
                  amountFilled: "0",
                  isNegRisk: false,
                  isYieldBearing: false,
                  strategy: "LIMIT",
                  status: "OPEN",
                  rewardEarningRate: 10,
                  order: {
                    hash: "hash-1",
                    salt: "1",
                    maker: "0xmaker",
                    signer: "0xsigner",
                    taker: "0x0",
                    tokenId: "1",
                    makerAmount: "5",
                    takerAmount: "2.25",
                    expiration: 1,
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
                  market: {
                    id: 10
                  },
                  outcome: {
                    name: "No",
                    indexSet: 0,
                    onChainId: "1"
                  },
                  amount: "10",
                  valueUsd: "7",
                  averageBuyPriceUsd: "0.7",
                  pnlUsd: "0.5"
                }
              ]
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
        }
      }
    );

    expect(result.privateState?.account?.address).toBe("0xabc");
    expect(result.privateState?.openOrders.map((order) => order.id)).toEqual(["order-1"]);
    expect(result.privateState?.inventoryByMarket[10]).toBe(-7);
    expect(result.orderDiff.create).toHaveLength(0);
  });

  it("acquires a jwt from the auth client when a signer is provided", async () => {
    let authenticateCallCount = 0;

    const result = await runConfiguredRuntimeOnce(
      "shadow",
      {
        apiBaseUrl: "https://api.predict.fun/v1",
        wsUrl: "wss://ws.predict.fun/ws",
        apiKey: "key",
        dbPath: ":memory:"
      },
      {
        database: openAnalyticsStore(":memory:"),
        authSigner: {
          signer: "0xsigner",
          async signMessage(message: string) {
            expect(message).toBe("sign-this-message");
            return "signed-message";
          }
        },
        authClient: {
          async getAuthMessage() {
            return {
              success: true,
              data: {
                message: "sign-this-message"
              }
            };
          },
          async authenticate(body) {
            authenticateCallCount += 1;
            expect(body).toEqual({
              signer: "0xsigner",
              signature: "signed-message",
              message: "sign-this-message"
            });
            return {
              success: true,
              data: {
                token: "jwt-from-auth-flow"
              }
            };
          }
        },
        restClient: {
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
                  outcomes: [],
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
          async getOrders(bearerToken: string) {
            expect(bearerToken).toBe("jwt-from-auth-flow");
            return {
              success: true,
              data: []
            };
          },
          async getPositions(bearerToken: string) {
            expect(bearerToken).toBe("jwt-from-auth-flow");
            return {
              success: true,
              data: []
            };
          },
          async getAccount(bearerToken: string) {
            expect(bearerToken).toBe("jwt-from-auth-flow");
            return {
              success: true,
              data: {
                name: "bot",
                address: "0xsigner",
                referral: {},
                points: {}
              }
            };
          }
        }
      }
    );

    expect(authenticateCallCount).toBe(1);
    expect(result.privateState?.account?.address).toBe("0xsigner");
  });

  it("assigns runtime whitelist pool and tier metadata during bootstrap", async () => {
    const state = await bootstrapConfiguredRuntimeState(
      "paper",
      {
        apiBaseUrl: "https://api.predict.fun/v1",
        wsUrl: "wss://ws.predict.fun/ws",
        apiKey: "key",
        dbPath: ":memory:"
      },
      {
        database: openAnalyticsStore(":memory:"),
        restClient: {
          async getMarkets() {
            return {
              success: true,
              data: [
                {
                  id: 1469,
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
                  outcomes: [],
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
                  id: 1520,
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
                  outcomes: [],
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
                    volume24hUsd: 12000,
                    volumeTotalUsd: 50000
                  }
                },
                {
                  id: 933,
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
                  outcomes: [],
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
                    volume24hUsd: 22000,
                    volumeTotalUsd: 50000
                  }
                },
                {
                  id: 122491,
                  title: "Pistons vs 76ers",
                  question: "D?",
                  description: "",
                  tradingStatus: "OPEN",
                  status: "OPEN",
                  isVisible: true,
                  isNegRisk: false,
                  isYieldBearing: false,
                  feeRateBps: 0,
                  oracleQuestionId: "oq-122491",
                  conditionId: "cond-122491",
                  resolverAddress: "0x0",
                  outcomes: [],
                  spreadThreshold: 0.06,
                  shareThreshold: 1,
                  isBoosted: true,
                  polymarketConditionIds: [],
                  categorySlug: "nba-det-phi-2026-04-04",
                  createdAt: "2026-04-02T00:00:00Z",
                  decimalPrecision: 3,
                  marketVariant: "SPORTS_TEAM_MATCH",
                  imageUrl: "",
                  stats: {
                    totalLiquidityUsd: 1000,
                    volume24hUsd: 26000,
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
            return { success: true, data: [] };
          },
          async getPositions() {
            return { success: true, data: [] };
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
        }
      }
    );

    expect(
      state.markets.map((market) => ({
        id: market.id,
        marketPool: market.marketPool,
        whitelistTier: market.whitelistTier
      }))
    ).toEqual([
      { id: 1469, marketPool: "core_sports", whitelistTier: "active" },
      { id: 1520, marketPool: "core_sports", whitelistTier: "active" },
      { id: 933, marketPool: "satellite_token", whitelistTier: "active" },
      { id: 122491, marketPool: "other", whitelistTier: undefined }
    ]);
  });
});
