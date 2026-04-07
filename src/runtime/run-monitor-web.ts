import { pathToFileURL } from "node:url";

import { buildMonitorSnapshot } from "../monitor";
import { createMonitorWebServer } from "../monitor-web";
import { openAnalyticsStore } from "../storage/sqlite";

export type MonitorWebCliOptions = {
  dbPath: string;
  host: string;
  port: number;
};

export function parseMonitorWebCliOptions(
  argv: string[],
  env: NodeJS.ProcessEnv
): MonitorWebCliOptions {
  let dbPath = env.PREDICT_MM_DB_PATH;
  let host = "127.0.0.1";
  let port = 8787;

  for (const argument of argv) {
    if (argument.startsWith("--db=")) {
      dbPath = argument.slice("--db=".length);
      continue;
    }

    if (argument.startsWith("--host=")) {
      host = argument.slice("--host=".length);
      continue;
    }

    if (argument.startsWith("--port=")) {
      const parsed = Number(argument.slice("--port=".length));

      if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
        throw new Error(`Invalid --port value: ${argument}`);
      }

      port = parsed;
    }
  }

  if (!dbPath) {
    throw new Error("run-monitor-web.ts requires --db=... or PREDICT_MM_DB_PATH");
  }

  return {
    dbPath,
    host,
    port
  };
}

export async function main(): Promise<void> {
  const options = parseMonitorWebCliOptions(process.argv.slice(2), process.env);
  const database = openAnalyticsStore(options.dbPath);
  const server = createMonitorWebServer({
    loadSnapshot: () => buildMonitorSnapshot(database)
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => {
      server.off("error", reject);
      console.log(
        `monitor-web listening on http://${options.host}:${options.port} using ${options.dbPath}`
      );
    });

    let stopped = false;

    const shutdown = (): void => {
      if (stopped) {
        return;
      }

      stopped = true;
      server.close(() => {
        database.close();
        process.off("SIGINT", shutdown);
        process.off("SIGTERM", shutdown);
        resolve();
      });
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });
}

const isMainModule =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  void main();
}
