import { describe, expect, it } from "vitest";

import { buildEmergencyFlattenOrders } from "../src/execution/emergency-flatten";
import { applySimulatedOrderCommands, buildOrderCommands } from "../src/execution/order-manager";
import { diffOrders } from "../src/execution/reconciler";

describe("diffOrders", () => {
  it("cancels risk-increasing orders during hard stop", () => {
    const result = diffOrders({
      current: [{ id: "1", side: "bid", marketId: 1, price: 0.45, sizeUsd: 5 }],
      target: []
    });

    expect(result.cancel.map((order) => order.id)).toEqual(["1"]);
  });
});

describe("buildEmergencyFlattenOrders", () => {
  it("builds aggressive exit orders from current inventory", () => {
    const orders = buildEmergencyFlattenOrders([
      {
        marketId: 1,
        inventoryUsd: 8,
        bestBid: 0.44,
        bestAsk: 0.46
      }
    ]);

    expect(orders).toEqual([
      {
        marketId: 1,
        side: "ask",
        price: 0.44,
        sizeUsd: 8
      }
    ]);
  });
});

describe("applySimulatedOrderCommands", () => {
  it("updates local open-order state after cancel and create commands", () => {
    const commands = buildOrderCommands({
      cancel: [{ id: "open-1", side: "bid", marketId: 1, price: 0.45, sizeUsd: 5 }],
      create: [{ side: "ask", marketId: 2, price: 0.55, sizeUsd: 3 }]
    });

    const result = applySimulatedOrderCommands({
      currentOrders: [{ id: "open-1", side: "bid", marketId: 1, price: 0.45, sizeUsd: 5 }],
      commands,
      idFactory: () => "shadow-1"
    });

    expect(result.cancelledOrderIds).toEqual(["open-1"]);
    expect(result.cancelledOrders).toEqual([
      {
        id: "open-1",
        side: "bid",
        marketId: 1,
        price: 0.45,
        sizeUsd: 5
      }
    ]);
    expect(result.createdOrders).toEqual([
      {
        id: "shadow-1",
        side: "ask",
        marketId: 2,
        price: 0.55,
        sizeUsd: 3
      }
    ]);
    expect(result.currentOrders).toEqual(result.createdOrders);
  });
});
