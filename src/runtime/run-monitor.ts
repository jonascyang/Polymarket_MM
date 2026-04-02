import { openAnalyticsStore } from "../storage/sqlite";
import { buildMonitorSnapshot, formatMonitorSnapshot } from "../monitor";

type MonitorCliOptions = {
  dbPath: string;
  intervalMs: number;
  once: boolean;
};

function parseCliOptions(argv: string[], env: NodeJS.ProcessEnv): MonitorCliOptions {
  let dbPath = env.PREDICT_MM_DB_PATH;
  let intervalMs = 5000;
  let once = false;

  for (const argument of argv) {
    if (argument === "--once") {
      once = true;
      continue;
    }

    if (argument.startsWith("--db=")) {
      dbPath = argument.slice("--db=".length);
      continue;
    }

    if (argument.startsWith("--interval-ms=")) {
      const parsed = Number(argument.slice("--interval-ms=".length));

      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`Invalid --interval-ms value: ${argument}`);
      }

      intervalMs = parsed;
    }
  }

  if (!dbPath) {
    throw new Error("run-monitor.ts requires --db=... or PREDICT_MM_DB_PATH");
  }

  return {
    dbPath,
    intervalMs,
    once
  };
}

function render(databasePath: string): void {
  const database = openAnalyticsStore(databasePath);

  try {
    const snapshot = buildMonitorSnapshot(database);
    console.log(formatMonitorSnapshot(snapshot));
  } finally {
    database.close();
  }
}

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2), process.env);

  if (options.once) {
    render(options.dbPath);
    return;
  }

  render(options.dbPath);

  await new Promise<void>((resolve) => {
    const timer = setInterval(() => {
      console.clear();
      render(options.dbPath);
    }, options.intervalMs);

    let stopped = false;

    const shutdown = (): void => {
      if (stopped) {
        return;
      }

      stopped = true;
      clearInterval(timer);
      process.off("SIGINT", shutdown);
      process.off("SIGTERM", shutdown);
      resolve();
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });
}

void main();
