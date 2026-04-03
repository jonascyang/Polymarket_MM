import type { DatabaseSync } from "node:sqlite";

import { loadConfig } from "../config";
import { runResearchCollectorCycle, type ResearchCollectorResult } from "../research/collector";
import { openAnalyticsStore } from "../storage/sqlite";
import type { PredictMmConfig } from "../types";
import { renderResearchReport, type ReportOutputFormat } from "./run-report";
import { runArchiveOnce, type RunArchiveOnceOptions } from "./run-archive";
import type { UploadedArchiveObject } from "./archive";

export type BatchCliOptions = {
  first?: number;
  reportFormat: ReportOutputFormat;
  minAgeMs?: number;
};

export type ResearchBatchResult = {
  collect: ResearchCollectorResult;
  report: {
    format: ReportOutputFormat;
    output: string;
  };
  archive: {
    attempted: boolean;
    uploadedCount: number;
    uploads: UploadedArchiveObject[];
  };
};

type CollectRunner = (
  config: PredictMmConfig,
  options: {
    database: DatabaseSync;
    first?: number;
  }
) => Promise<ResearchCollectorResult>;

type ReportRenderer = (
  database: DatabaseSync,
  format: ReportOutputFormat
) => string;

type ArchiveRunner = (
  config: PredictMmConfig,
  options: RunArchiveOnceOptions
) => Promise<UploadedArchiveObject[]>;

export type RunResearchBatchOptions = Partial<BatchCliOptions> & {
  collector?: CollectRunner;
  reportRenderer?: ReportRenderer;
  archiveRunner?: ArchiveRunner;
  database?: DatabaseSync;
};

function parsePositiveNumber(value: string, flagName: string): number {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${flagName} value: ${value}`);
  }

  return parsed;
}

export function parseBatchCliOptions(argv: string[]): BatchCliOptions {
  const options: BatchCliOptions = {
    reportFormat: "text"
  };

  for (const argument of argv) {
    if (argument.startsWith("--first=")) {
      options.first = parsePositiveNumber(
        argument.slice("--first=".length),
        "--first"
      );
      continue;
    }

    if (argument === "--report-json") {
      options.reportFormat = "json";
      continue;
    }

    if (argument.startsWith("--min-age-ms=")) {
      options.minAgeMs = parsePositiveNumber(
        argument.slice("--min-age-ms=".length),
        "--min-age-ms"
      );
    }
  }

  return options;
}

function canRunArchive(config: PredictMmConfig): boolean {
  return Boolean(
    config.archiveDir &&
      config.r2Endpoint &&
      config.r2Bucket &&
      config.r2AccessKeyId &&
      config.r2SecretAccessKey
  );
}

export async function runResearchBatch(
  config: PredictMmConfig,
  options: RunResearchBatchOptions = {}
): Promise<ResearchBatchResult> {
  const database = options.database ?? openAnalyticsStore(config.dbPath);
  const collector = options.collector ?? runResearchCollectorCycle;
  const reportRenderer = options.reportRenderer ?? renderResearchReport;
  const archiveRunner = options.archiveRunner ?? runArchiveOnce;

  try {
    const collect = await collector(config, {
      database,
      first: options.first
    });
    const reportFormat = options.reportFormat ?? "text";
    const report = {
      format: reportFormat,
      output: reportRenderer(database, reportFormat)
    };

    if (!canRunArchive(config)) {
      return {
        collect,
        report,
        archive: {
          attempted: false,
          uploadedCount: 0,
          uploads: []
        }
      };
    }

    const uploads = await archiveRunner(config, {
      minAgeMs: options.minAgeMs
    });

    return {
      collect,
      report,
      archive: {
        attempted: true,
        uploadedCount: uploads.length,
        uploads
      }
    };
  } finally {
    if (!options.database) {
      database.close();
    }
  }
}

export function formatResearchBatchOutput(result: ResearchBatchResult): string {
  return JSON.stringify({
    type: "research_batch",
    ...result
  });
}

async function main(): Promise<void> {
  const config = loadConfig();
  const options = parseBatchCliOptions(process.argv.slice(2));
  const result = await runResearchBatch(config, options);

  console.log(formatResearchBatchOutput(result));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
