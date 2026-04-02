import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PredictRestClient,
  buildMarketsPath
} from "../src/clients/rest-client";

describe("buildMarketsPath", () => {
  it("builds the open-market query", () => {
    expect(
      buildMarketsPath({
        first: 100,
        status: "OPEN",
        includeStats: true,
        sort: "VOLUME_24H_DESC"
      })
    ).toBe("/markets?first=100&status=OPEN&includeStats=true&sort=VOLUME_24H_DESC");
  });
});

describe("PredictRestClient private order routes", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts signed orders to the official /orders endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          code: "CREATED",
          orderId: "order-1",
          orderHash: "0xhash"
        }
      })
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new PredictRestClient({
      apiBaseUrl: "https://api.predict.fun/v1",
      wsUrl: "wss://ws.predict.fun/ws",
      apiKey: "key",
      dbPath: ":memory:"
    });

    await client.createOrder("jwt-token", {
      data: {
        order: {
          hash: "0xhash",
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
          signatureType: 0,
          signature: "0xsig"
        },
        pricePerShare: "400000000000000000",
        strategy: "LIMIT"
      }
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.predict.fun/v1/orders");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      headers: expect.objectContaining({
        "x-api-key": "key",
        Authorization: "Bearer jwt-token",
        "content-type": "application/json; charset=utf-8"
      }),
      body: JSON.stringify({
        data: {
          order: {
            hash: "0xhash",
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
            signatureType: 0,
            signature: "0xsig"
          },
          pricePerShare: "400000000000000000",
          strategy: "LIMIT"
        }
      })
    });
  });

  it("posts order ids to /orders/remove", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        removed: ["order-1"],
        noop: []
      })
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new PredictRestClient({
      apiBaseUrl: "https://api.predict.fun/v1",
      wsUrl: "wss://ws.predict.fun/ws",
      apiKey: "key",
      dbPath: ":memory:"
    });

    await client.removeOrders("jwt-token", ["order-1"]);

    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.predict.fun/v1/orders/remove");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      headers: expect.objectContaining({
        "x-api-key": "key",
        Authorization: "Bearer jwt-token",
        "content-type": "application/json; charset=utf-8"
      }),
      body: JSON.stringify({
        data: {
          ids: ["order-1"]
        }
      })
    });
  });
});
