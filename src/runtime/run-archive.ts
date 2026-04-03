import { loadConfig } from "../config";
import { createR2ObjectClient } from "../clients/r2-client";
import type { PredictMmConfig } from "../types";
import {
  uploadPendingArchives,
  type ArchiveObjectClient,
  type UploadedArchiveObject
} from "./archive";

export type ArchiveCliOptions = {
  minAgeMs?: number;
};

export type RunArchiveOnceOptions = ArchiveCliOptions & {
  nowMs?: number;
  client?: ArchiveObjectClient;
};

export function parseArchiveCliOptions(argv: string[]): ArchiveCliOptions {
  const options: ArchiveCliOptions = {};

  for (const argument of argv) {
    if (!argument.startsWith("--min-age-ms=")) {
      continue;
    }

    const parsed = Number(argument.slice("--min-age-ms=".length));

    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error(`Invalid --min-age-ms value: ${argument}`);
    }

    options.minAgeMs = parsed;
  }

  return options;
}

function assertArchiveConfig(
  config: PredictMmConfig
): asserts config is PredictMmConfig & {
  archiveDir: string;
  r2Endpoint: string;
  r2Bucket: string;
  r2AccessKeyId: string;
  r2SecretAccessKey: string;
} {
  if (!config.archiveDir) {
    throw new Error("run-archive.ts requires PREDICT_MM_ARCHIVE_DIR");
  }

  if (
    !config.r2Endpoint ||
    !config.r2Bucket ||
    !config.r2AccessKeyId ||
    !config.r2SecretAccessKey
  ) {
    throw new Error("run-archive.ts requires R2 upload configuration");
  }
}

export async function runArchiveOnce(
  config: PredictMmConfig,
  options: RunArchiveOnceOptions = {}
): Promise<UploadedArchiveObject[]> {
  assertArchiveConfig(config);

  const client = options.client ?? createR2ObjectClient(config);

  return uploadPendingArchives({
    archiveDir: config.archiveDir,
    prefix: config.r2Prefix,
    client,
    nowMs: options.nowMs,
    minAgeMs: options.minAgeMs
  });
}

async function main(): Promise<void> {
  const config = loadConfig();
  const options = parseArchiveCliOptions(process.argv.slice(2));
  const uploaded = await runArchiveOnce(config, options);

  console.log(
    JSON.stringify({
      type: "archive_upload",
      uploadedCount: uploaded.length,
      uploads: uploaded
    })
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
