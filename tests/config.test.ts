import { describe, expect, it } from "vitest";

import { parseConfig } from "../src/config";

describe("parseConfig", () => {
  it("parses required predict-mm settings", () => {
    const config = parseConfig({
      PREDICT_API_BASE_URL: "https://api.predict.fun/v1",
      PREDICT_WS_URL: "wss://ws.predict.fun/ws",
      PREDICT_API_KEY: "key",
      PREDICT_MM_DB_PATH: "./tmp/predict-mm.sqlite"
    });

    expect(config.apiBaseUrl).toBe("https://api.predict.fun/v1");
    expect(config.wsUrl).toBe("wss://ws.predict.fun/ws");
    expect(config.apiKey).toBe("key");
    expect(config.dbPath).toBe("./tmp/predict-mm.sqlite");
  });

  it("parses an optional bearer token for private-state calls", () => {
    const config = parseConfig({
      PREDICT_API_BASE_URL: "https://api.predict.fun/v1",
      PREDICT_WS_URL: "wss://ws.predict.fun/ws",
      PREDICT_API_KEY: "key",
      PREDICT_MM_DB_PATH: "./tmp/predict-mm.sqlite",
      PREDICT_AUTH_BEARER_TOKEN: "jwt-token"
    });

    expect(config.bearerToken).toBe("jwt-token");
  });

  it("parses an optional runtime interval for polling loops", () => {
    const config = parseConfig({
      PREDICT_API_BASE_URL: "https://api.predict.fun/v1",
      PREDICT_WS_URL: "wss://ws.predict.fun/ws",
      PREDICT_API_KEY: "key",
      PREDICT_MM_DB_PATH: "./tmp/predict-mm.sqlite",
      PREDICT_RUNTIME_INTERVAL_MS: "7000"
    });

    expect(config.runtimeIntervalMs).toBe(7000);
  });

  it("parses optional live execution credentials", () => {
    const config = parseConfig({
      PREDICT_API_BASE_URL: "https://api.predict.fun/v1",
      PREDICT_WS_URL: "wss://ws.predict.fun/ws",
      PREDICT_API_KEY: "key",
      PREDICT_MM_DB_PATH: "./tmp/predict-mm.sqlite",
      PREDICT_MM_WALLET_PRIVATE_KEY: "0xabc123",
      PREDICT_MM_PREDICT_ACCOUNT: "0xdef456"
    });

    expect(config.walletPrivateKey).toBe("0xabc123");
    expect(config.predictAccount).toBe("0xdef456");
  });
});
