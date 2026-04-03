import { openAnalyticsStore } from "../storage/sqlite";
import { buildResearchReport, formatResearchReport } from "../research/report";

export type ReportOutputFormat = "text" | "json";

type ReportCliOptions = {
  dbPath: string;
  format: ReportOutputFormat;
};

export function parseReportCliOptions(
  argv: string[],
  env: NodeJS.ProcessEnv
): ReportCliOptions {
  let dbPath = env.PREDICT_MM_DB_PATH;
  let format: ReportOutputFormat = "text";

  for (const argument of argv) {
    if (argument.startsWith("--db=")) {
      dbPath = argument.slice("--db=".length);
      continue;
    }

    if (argument === "--json") {
      format = "json";
    }
  }

  if (!dbPath) {
    throw new Error("run-report.ts requires --db=... or PREDICT_MM_DB_PATH");
  }

  return {
    dbPath,
    format
  };
}

export function renderResearchReport(
  database: Parameters<typeof buildResearchReport>[0],
  format: ReportOutputFormat
): string {
  const report = buildResearchReport(database);

  if (format === "json") {
    return JSON.stringify(report);
  }

  return formatResearchReport(report);
}

function main(): void {
  const options = parseReportCliOptions(process.argv.slice(2), process.env);
  const database = openAnalyticsStore(options.dbPath);

  try {
    console.log(renderResearchReport(database, options.format));
  } finally {
    database.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
