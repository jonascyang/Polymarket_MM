import { describe, expect, it, vi } from "vitest";

import {
  buildSubscribeMessage,
  normalizeWalletEvent,
  PredictWsClient
} from "../src/clients/ws-client";

describe("buildSubscribeMessage", () => {
  it("builds a Predict websocket subscribe frame", () => {
    expect(buildSubscribeMessage(1, ["predictOrderbook/123"])).toEqual({
      method: "subscribe",
      requestId: 1,
      params: ["predictOrderbook/123"]
    });
  });

  it("waits for an opening websocket before sending the subscribe frame", async () => {
    const listeners = new Map<string, Set<() => void>>();
    const send = vi.fn();
    const socket = {
      readyState: 0,
      send,
      addEventListener(type: string, listener: () => void) {
        const current = listeners.get(type) ?? new Set<() => void>();
        current.add(listener);
        listeners.set(type, current);
      },
      removeEventListener(type: string, listener: () => void) {
        listeners.get(type)?.delete(listener);
      }
    };
    const client = new PredictWsClient("wss://ws.predict.fun/ws");

    (
      client as unknown as {
        socket: typeof socket;
      }
    ).socket = socket;

    const subscription = client.subscribe(1, ["predictOrderbook/123"]);

    expect(send).not.toHaveBeenCalled();
    socket.readyState = 1;
    listeners.get("open")?.forEach((listener) => listener());
    await subscription;

    expect(send).toHaveBeenCalledWith(
      JSON.stringify(buildSubscribeMessage(1, ["predictOrderbook/123"]))
    );
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
