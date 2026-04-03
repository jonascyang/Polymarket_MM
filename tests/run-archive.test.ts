import { mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { PredictMmConfig } from "../src/types";
import { parseArchiveCliOptions, runArchiveOnce } from "../src/runtime/run-archive";

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
    r2Prefix: "predict-mm/raw",
    ...overrides
  };
}

describe("run-archive", () => {
  it("parses the optional minimum-age flag", () => {
    expect(parseArchiveCliOptions(["--min-age-ms=12345"])).toEqual({
      minAgeMs: 12345
    });
  });

  it("uploads pending archive files with the configured prefix", async () => {
    const directory = mkdtempSync(join(tmpdir(), "predict-mm-run-archive-"));
    const filePath = join(directory, "orderbook", "2026-04-03", "market_id=123", "10.jsonl");
    const uploads: Array<{ key: string; contentType: string; body: Buffer }> = [];

    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, "{\"event_type\":\"orderbook\"}\n");
    utimesSync(
      filePath,
      new Date("2026-04-03T03:10:00.000Z"),
      new Date("2026-04-03T03:00:00.000Z")
    );

    const result = await runArchiveOnce(
      buildConfig({ archiveDir: directory }),
      {
        nowMs: new Date("2026-04-03T03:10:00.000Z").getTime(),
        minAgeMs: 5 * 60 * 1000,
        client: {
          async putObject(key, body, contentType) {
            uploads.push({
              key,
              contentType,
              body: Buffer.isBuffer(body) ? body : Buffer.from(body)
            });
          }
        }
      }
    );

    expect(result).toEqual([
      {
        sourcePath: filePath,
        objectKey: "predict-mm/raw/orderbook/2026-04-03/market_id=123/10.jsonl.gz",
        bytes: Buffer.byteLength("{\"event_type\":\"orderbook\"}\n", "utf8")
      }
    ]);
    expect(uploads).toHaveLength(1);
    expect(uploads[0]?.key).toBe(
      "predict-mm/raw/orderbook/2026-04-03/market_id=123/10.jsonl.gz"
    );
    expect(uploads[0]?.contentType).toBe("application/x-ndjson");

    rmSync(directory, { recursive: true, force: true });
  });

  it("rejects missing archive config before attempting upload", async () => {
    await expect(
      runArchiveOnce(buildConfig({ archiveDir: undefined }))
    ).rejects.toThrow("run-archive.ts requires PREDICT_MM_ARCHIVE_DIR");

    await expect(
      runArchiveOnce(buildConfig({ r2Endpoint: undefined }))
    ).rejects.toThrow("run-archive.ts requires R2 upload configuration");
  });
});
