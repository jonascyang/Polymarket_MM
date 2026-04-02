import { describe, expect, it } from "vitest";

import {
  buildSubscribeMessage,
  normalizeWalletEvent
} from "../src/clients/ws-client";

describe("buildSubscribeMessage", () => {
  it("builds a Predict websocket subscribe frame", () => {
    expect(buildSubscribeMessage(1, ["predictOrderbook/123"])).toEqual({
      method: "subscribe",
      requestId: 1,
      params: ["predictOrderbook/123"]
    });
  });
});

describe("normalizeWalletEvent", () => {
  it("normalizes private wallet fill events into internal strategy events", () => {
    expect(
      normalizeWalletEvent("predictWalletEvents/jwt-token", {
        eventType: "fill",
        marketId: 123,
        orderId: "order-1",
        side: "bid",
        price: 0.45,
        sizeUsd: 2,
        remainingSizeUsd: 3,
        inventoryDeltaUsd: 2
      })
    ).toEqual({
      topic: "predictWalletEvents/jwt-token",
      kind: "fill",
      marketId: 123,
      orderId: "order-1",
      side: "bid",
      price: 0.45,
      sizeUsd: 2,
      inventoryDeltaUsd: 2,
      order: {
        id: "order-1",
        marketId: 123,
        side: "bid",
        price: 0.45,
        sizeUsd: 3
      },
      payload: {
        eventType: "fill",
        marketId: 123,
        orderId: "order-1",
        side: "bid",
        price: 0.45,
        sizeUsd: 2,
        remainingSizeUsd: 3,
        inventoryDeltaUsd: 2
      }
    });
  });
});
