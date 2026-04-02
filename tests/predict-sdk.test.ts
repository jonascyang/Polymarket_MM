import { describe, expect, it } from "vitest";
import { ChainId, OrderBuilder } from "@predictdotfun/sdk";
import { Wallet } from "ethers";

import { buildLimitCreateOrderBody, resolvePrimaryOutcomeTokenId } from "../src/execution/predict-sdk";

describe("resolvePrimaryOutcomeTokenId", () => {
  it("prefers the Yes outcome token when available", () => {
    expect(
      resolvePrimaryOutcomeTokenId([
        { name: "No", indexSet: 2, onChainId: "456" },
        { name: "Yes", indexSet: 1, onChainId: "123" }
      ])
    ).toBe("123");
  });
});

describe("buildLimitCreateOrderBody", () => {
  it("builds an official signed limit-order payload from a managed bid order", async () => {
    const wallet = Wallet.createRandom();
    const orderBuilder = await OrderBuilder.make(ChainId.BnbMainnet, wallet, {
      generateSalt: () => "42"
    });

    const body = await buildLimitCreateOrderBody({
      orderBuilder,
      order: {
        marketId: 10,
        side: "bid",
        price: 0.4,
        sizeUsd: 4
      },
      market: {
        marketId: 10,
        feeRateBps: 200,
        isNegRisk: true,
        isYieldBearing: true,
        tokenId: "123"
      }
    });

    expect(body.data.strategy).toBe("LIMIT");
    expect(body.data.pricePerShare).toBe("400000000000000000");
    expect(body.data.order.salt).toBe("42");
    expect(body.data.order.side).toBe(0);
    expect(body.data.order.tokenId).toBe("123");
    expect(body.data.order.feeRateBps).toBe("200");
    expect(body.data.order.makerAmount).toBe("4000000000000000000");
    expect(body.data.order.takerAmount).toBe("10000000000000000000");
    expect(body.data.order.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
    expect(body.data.order.signature).toMatch(/^0x[a-fA-F0-9]+$/);
  });

  it("preserves exact ask price precision instead of drifting because of float conversion", async () => {
    const wallet = Wallet.createRandom();
    const orderBuilder = await OrderBuilder.make(ChainId.BnbMainnet, wallet, {
      generateSalt: () => "42"
    });

    const body = await buildLimitCreateOrderBody({
      orderBuilder,
      order: {
        marketId: 10,
        side: "ask",
        price: 0.37,
        sizeUsd: 6
      },
      market: {
        marketId: 10,
        feeRateBps: 200,
        isNegRisk: true,
        isYieldBearing: true,
        tokenId: "123"
      }
    });

    expect(body.data.pricePerShare).toBe("370000000000000000");
  });

  it("preserves exact bid price precision for three-decimal quotes", async () => {
    const wallet = Wallet.createRandom();
    const orderBuilder = await OrderBuilder.make(ChainId.BnbMainnet, wallet, {
      generateSalt: () => "42"
    });

    const body = await buildLimitCreateOrderBody({
      orderBuilder,
      order: {
        marketId: 10,
        side: "bid",
        price: 0.122,
        sizeUsd: 6
      },
      market: {
        marketId: 10,
        feeRateBps: 200,
        isNegRisk: true,
        isYieldBearing: true,
        tokenId: "123"
      }
    });

    expect(body.data.pricePerShare).toBe("122000000000000000");
  });
});
