import { describe, expect, it } from "vitest";

import type { UploadedArchiveObject } from "../src/runtime/archive";
import {
  formatResearchBatchOutput,
  parseBatchCliOptions,
  runResearchBatch
} from "../src/runtime/run-batch";
import type { PredictMmConfig } from "../src/types";

function buildConfig(overrides: Partial<PredictMmConfig> = {}): PredictMmConfig {
  return {
    apiBaseUrl: "https://api.predict.fun/v1",
    wsUrl: "wss://ws.predict.fun/ws",
    apiKey: "test-api-key",
    dbPath: ":memory:",
    ...overrides
  };
}

describe("run-batch", () => {
  it("parses batch cli options", () => {
    expect(parseBatchCliOptions([])).toEqual({
      reportFormat: "text"
    });

    expect(
      parseBatchCliOptions([
        "--first=25",
        "--report-json",
        "--min-age-ms=120000"
      ])
    ).toEqual({
      first: 25,
      reportFormat: "json",
      minAgeMs: 120000
    });
  });

  it("aggregates collect, report, and archive results", async () => {
    const uploads: UploadedArchiveObject[] = [
      {
        sourcePath: "/tmp/a.jsonl",
        objectKey: "predict-mm/raw/a.jsonl.gz",
        bytes: 10
      }
    ];

    const result = await runResearchBatch(buildConfig({
      archiveDir: "/tmp/archive",
      r2Endpoint: "https://account-id.r2.cloudflarestorage.com",
      r2Bucket: "predict-mm",
      r2AccessKeyId: "access-key",
      r2SecretAccessKey: "secret-key"
    }), {
      first: 25,
      reportFormat: "json",
      minAgeMs: 120000,
      collector: async () => ({
        sampledMarkets: 2,
        orderbooksRecorded: 2,
        lastSalesRecorded: 1,
        regimeSnapshotsRecorded: 2,
        marketIds: [101, 202]
      }),
      reportRenderer: () => "{\"collection\":{\"sampledMarkets\":2}}",
      archiveRunner: async () => uploads
    });

    expect(result).toEqual({
      collect: {
        sampledMarkets: 2,
        orderbooksRecorded: 2,
        lastSalesRecorded: 1,
        regimeSnapshotsRecorded: 2,
        marketIds: [101, 202]
      },
      report: {
        format: "json",
        output: "{\"collection\":{\"sampledMarkets\":2}}"
      },
      archive: {
        attempted: true,
        uploadedCount: 1,
        uploads
      }
    });
  });

  it("skips archive upload when archive config is incomplete", async () => {
    const result = await runResearchBatch(buildConfig(), {
      collector: async () => ({
        sampledMarkets: 2,
        orderbooksRecorded: 2,
        lastSalesRecorded: 1,
        regimeSnapshotsRecorded: 2,
        marketIds: [101, 202]
      }),
      reportRenderer: () => "Collection coverage"
    });

    expect(result.archive).toEqual({
      attempted: false,
      uploadedCount: 0,
      uploads: []
    });
  });

  it("formats batch output as one json object", () => {
    const output = formatResearchBatchOutput({
      collect: {
        sampledMarkets: 2,
        orderbooksRecorded: 2,
        lastSalesRecorded: 1,
        regimeSnapshotsRecorded: 2,
        marketIds: [101, 202]
      },
      report: {
        format: "json",
        output: "{\"collection\":{\"sampledMarkets\":2}}"
      },
      archive: {
        attempted: true,
        uploadedCount: 1,
        uploads: [
          {
            sourcePath: "/tmp/a.jsonl",
            objectKey: "predict-mm/raw/a.jsonl.gz",
            bytes: 10
          }
        ]
      }
    });

    expect(JSON.parse(output)).toEqual({
      type: "research_batch",
      collect: {
        sampledMarkets: 2,
        orderbooksRecorded: 2,
        lastSalesRecorded: 1,
        regimeSnapshotsRecorded: 2,
        marketIds: [101, 202]
      },
      report: {
        format: "json",
        output: "{\"collection\":{\"sampledMarkets\":2}}"
      },
      archive: {
        attempted: true,
        uploadedCount: 1,
        uploads: [
          {
            sourcePath: "/tmp/a.jsonl",
            objectKey: "predict-mm/raw/a.jsonl.gz",
            bytes: 10
          }
        ]
      }
    });
  });
});
