import { describe, expect, it, vi } from "vitest";
import { ChainId, OrderBuilder } from "@predictdotfun/sdk";
import { Wallet } from "ethers";

import {
  PredictLiveExecutor,
  PredictLiveSyncError
} from "../src/execution/live-executor";

describe("PredictLiveExecutor", () => {
  it("removes cancels in batch and submits signed limit creates", async () => {
    const wallet = Wallet.createRandom();
    const orderBuilder = await OrderBuilder.make(ChainId.BnbMainnet, wallet, {
      generateSalt: () => "42"
    });
    const createOrder = vi.fn().mockResolvedValue({
      success: true,
      data: {
        code: "CREATED",
        orderId: "order-2",
        orderHash: "0xhash"
      }
    });
    const removeOrders = vi.fn().mockResolvedValue({
      success: true,
      removed: ["order-1"],
      noop: []
    });
    const executor = new PredictLiveExecutor({
      bearerToken: "jwt-token",
      restClient: {
        createOrder,
        removeOrders
      },
      orderBuilder
    });

    await executor.syncCommands(
      [
        { type: "cancel", orderId: "order-1" },
        {
          type: "create",
          order: {
            marketId: 10,
            side: "bid",
            price: 0.4,
            sizeUsd: 4
          }
        }
      ],
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

    expect(removeOrders).toHaveBeenCalledWith("jwt-token", ["order-1"]);
    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(createOrder.mock.calls[0]?.[0]).toBe("jwt-token");
    expect(createOrder.mock.calls[0]?.[1].data.strategy).toBe("LIMIT");
    expect(createOrder.mock.calls[0]?.[1].data.order.side).toBe(0);
    expect(createOrder.mock.calls[0]?.[1].data.order.tokenId).toBe("123");
  });

  it("maps logical asks onto complementary outcome buy orders", async () => {
    const wallet = Wallet.createRandom();
    const orderBuilder = await OrderBuilder.make(ChainId.BnbMainnet, wallet, {
      generateSalt: () => "42"
    });
    const createOrder = vi.fn().mockResolvedValue({
      success: true,
      data: {
        code: "CREATED",
        orderId: "order-2",
        orderHash: "0xhash"
      }
    });
    const executor = new PredictLiveExecutor({
      bearerToken: "jwt-token",
      restClient: {
        createOrder,
        removeOrders: vi.fn().mockResolvedValue({
          success: true,
          removed: [],
          noop: []
        })
      },
      orderBuilder
    });

    await executor.syncCommands(
      [
        {
          type: "create",
          order: {
            marketId: 10,
            side: "ask",
            price: 0.37,
            sizeUsd: 6
          }
        }
      ],
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

    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(createOrder.mock.calls[0]?.[1].data.order.side).toBe(0);
    expect(createOrder.mock.calls[0]?.[1].data.order.tokenId).toBe("456");
    expect(createOrder.mock.calls[0]?.[1].data.pricePerShare).toBe("630000000000000000");
  });

  it("surfaces partial creates so runtime state can stay in sync after a later failure", async () => {
    const wallet = Wallet.createRandom();
    const orderBuilder = await OrderBuilder.make(ChainId.BnbMainnet, wallet, {
      generateSalt: () => "42"
    });
    const createOrder = vi
      .fn()
      .mockResolvedValueOnce({
        success: true,
        data: {
          code: "CREATED",
          orderId: "order-1",
          orderHash: "0xhash-1"
        }
      })
      .mockRejectedValueOnce(new Error("second create failed"));
    const executor = new PredictLiveExecutor({
      bearerToken: "jwt-token",
      restClient: {
        createOrder,
        removeOrders: vi.fn().mockResolvedValue({
          success: true,
          removed: [],
          noop: []
        })
      },
      orderBuilder
    });

    let thrown: unknown;

    try {
      await executor.syncCommands(
        [
          {
            type: "create",
            order: {
              marketId: 10,
              side: "bid",
              price: 0.4,
              sizeUsd: 4
            }
          },
          {
            type: "create",
            order: {
              marketId: 11,
              side: "ask",
              price: 0.37,
              sizeUsd: 6
            }
          }
        ],
        {
          10: {
            marketId: 10,
            tokenId: "123",
            complementaryTokenId: "456",
            feeRateBps: 200,
            isNegRisk: true,
            isYieldBearing: true
          },
          11: {
            marketId: 11,
            tokenId: "789",
            complementaryTokenId: "987",
            feeRateBps: 200,
            isNegRisk: true,
            isYieldBearing: true
          }
        }
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(PredictLiveSyncError);
    expect((thrown as PredictLiveSyncError).created).toHaveLength(1);
    expect((thrown as PredictLiveSyncError).created[0]?.order.marketId).toBe(10);
    expect((thrown as PredictLiveSyncError).cause).toBeInstanceOf(Error);
  });
});
