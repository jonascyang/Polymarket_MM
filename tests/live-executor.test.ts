import { describe, expect, it, vi } from "vitest";
import { ChainId, OrderBuilder } from "@predictdotfun/sdk";
import { Wallet } from "ethers";

import { PredictLiveExecutor } from "../src/execution/live-executor";

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
});
