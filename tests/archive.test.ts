import {
  existsSync,
  mkdirSync,
  rmSync,
  utimesSync,
  writeFileSync
} from "node:fs";
import { gunzipSync } from "node:zlib";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  collectPendingArchiveFiles,
  uploadPendingArchives
} from "../src/runtime/archive";

describe("archive runner", () => {
  it("collects archive files older than the minimum age", () => {
    const directory = mkdtempSync(join(tmpdir(), "predict-mm-archive-runner-"));
    const oldFile = join(directory, "orderbook", "2026-04-03", "market_id=123", "10.jsonl");
    const freshFile = join(directory, "fills", "2026-04-03", "10.jsonl");

    mkdirSync(dirname(oldFile), { recursive: true });
    mkdirSync(dirname(freshFile), { recursive: true });
    writeFileSync(oldFile, "{\"ok\":true}\n");
    writeFileSync(freshFile, "{\"ok\":true}\n");

    const now = new Date("2026-04-03T03:10:00.000Z");
    utimesSync(oldFile, now, new Date("2026-04-03T03:00:00.000Z"));
    utimesSync(freshFile, now, new Date("2026-04-03T03:09:00.000Z"));

    const candidates = collectPendingArchiveFiles(directory, {
      nowMs: now.getTime(),
      minAgeMs: 5 * 60 * 1000
    });

    expect(candidates).toEqual([oldFile]);

    rmSync(directory, { recursive: true, force: true });
  });

  it("compresses and uploads pending archive files before deleting them locally", async () => {
    const directory = mkdtempSync(join(tmpdir(), "predict-mm-archive-upload-"));
    const filePath = join(directory, "orderbook", "2026-04-03", "market_id=123", "10.jsonl");
    const uploads: Array<{ key: string; body: Buffer; contentType: string }> = [];

    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, "{\"event_type\":\"orderbook\",\"payload\":{\"ok\":true}}\n");
    utimesSync(
      filePath,
      new Date("2026-04-03T03:10:00.000Z"),
      new Date("2026-04-03T03:00:00.000Z")
    );

    const uploaded = await uploadPendingArchives({
      archiveDir: directory,
      minAgeMs: 5 * 60 * 1000,
      nowMs: new Date("2026-04-03T03:10:00.000Z").getTime(),
      prefix: "predict-mm/raw",
      client: {
        async putObject(key, body, contentType) {
          uploads.push({
            key,
            body: Buffer.isBuffer(body) ? body : Buffer.from(body),
            contentType
          });
        }
      }
    });

    expect(uploaded).toEqual([
      {
        sourcePath: filePath,
        objectKey: "predict-mm/raw/orderbook/2026-04-03/market_id=123/10.jsonl.gz",
        bytes: Buffer.byteLength(
          "{\"event_type\":\"orderbook\",\"payload\":{\"ok\":true}}\n",
          "utf8"
        )
      }
    ]);
    expect(uploads).toHaveLength(1);
    expect(uploads[0]?.key).toBe(
      "predict-mm/raw/orderbook/2026-04-03/market_id=123/10.jsonl.gz"
    );
    expect(uploads[0]?.contentType).toBe("application/x-ndjson");
    expect(gunzipSync(uploads[0]?.body ?? Buffer.alloc(0)).toString("utf8")).toContain(
      "\"event_type\":\"orderbook\""
    );
    expect(existsSync(filePath)).toBe(false);

    rmSync(directory, { recursive: true, force: true });
  });
});
