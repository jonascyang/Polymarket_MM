import { describe, expect, it, vi, beforeEach } from "vitest";
import type { PredictMmConfig } from "../src/types";

const mocks = vi.hoisted(() => {
  const send = vi.fn(async () => undefined);
  const S3Client = vi.fn(function S3Client(this: { send: typeof send }, _input: unknown) {
    this.send = send;
  });
  const PutObjectCommand = vi.fn(function PutObjectCommand(
    this: { input: unknown },
    input: unknown
  ) {
    this.input = input;
  });

  return {
    send,
    S3Client,
    PutObjectCommand
  };
});

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: mocks.S3Client,
  PutObjectCommand: mocks.PutObjectCommand
}));

import { createR2ObjectClient } from "../src/clients/r2-client";

function buildConfig(overrides: Partial<PredictMmConfig> = {}): PredictMmConfig {
  return {
    apiBaseUrl: "https://api.predict.fun/v1",
    wsUrl: "wss://ws.predict.fun",
    apiKey: "test-api-key",
    dbPath: "/tmp/predict-mm.sqlite",
    archiveDir: "/tmp/archive",
    r2Endpoint: "https://account-id.r2.cloudflarestorage.com",
    r2Bucket: "predict-mm",
    r2AccessKeyId: "access-key",
    r2SecretAccessKey: "secret-key",
    ...overrides
  };
}

describe("createR2ObjectClient", () => {
  beforeEach(() => {
    mocks.send.mockClear();
    mocks.S3Client.mockClear();
    mocks.PutObjectCommand.mockClear();
  });

  it("builds an S3-compatible client with R2 config and uploads objects into the configured bucket", async () => {
    const config = buildConfig();
    const client = createR2ObjectClient(config);
    const body = Buffer.from("{\"ok\":true}\n", "utf8");

    await client.putObject(
      "predict-mm/raw/orderbook/2026-04-03/market_id=123/10.jsonl.gz",
      body,
      "application/x-ndjson"
    );

    expect(mocks.S3Client).toHaveBeenCalledWith({
      region: "auto",
      endpoint: "https://account-id.r2.cloudflarestorage.com",
      credentials: {
        accessKeyId: "access-key",
        secretAccessKey: "secret-key"
      }
    });
    expect(mocks.PutObjectCommand).toHaveBeenCalledWith({
      Bucket: "predict-mm",
      Key: "predict-mm/raw/orderbook/2026-04-03/market_id=123/10.jsonl.gz",
      Body: body,
      ContentType: "application/x-ndjson"
    });
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });

  it("uses the explicit R2 region override when present", async () => {
    const config = buildConfig({ r2Region: "wnam" });
    const client = createR2ObjectClient(config);

    await client.putObject("test.jsonl.gz", "ok", "application/x-ndjson");

    expect(mocks.S3Client).toHaveBeenCalledWith({
      region: "wnam",
      endpoint: "https://account-id.r2.cloudflarestorage.com",
      credentials: {
        accessKeyId: "access-key",
        secretAccessKey: "secret-key"
      }
    });
  });
});
