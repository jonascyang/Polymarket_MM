import { loadConfig } from "../config";
import { runResearchCollectorCycle } from "../research/collector";

type CollectCliOptions = {
  intervalMs: number;
  once: boolean;
  first?: number;
};

function parseCliOptions(argv: string[], env: NodeJS.ProcessEnv): CollectCliOptions {
  let intervalMs = Number(env.PREDICT_RUNTIME_INTERVAL_MS ?? "5000");
  let once = false;
  let first: number | undefined;

  for (const argument of argv) {
    if (argument === "--once") {
      once = true;
      continue;
    }

    if (argument.startsWith("--interval-ms=")) {
      intervalMs = Number(argument.slice("--interval-ms=".length));
      continue;
    }

    if (argument.startsWith("--first=")) {
      first = Number(argument.slice("--first=".length));
    }
  }

  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new Error(`Invalid interval: ${intervalMs}`);
  }

  if (first !== undefined && (!Number.isFinite(first) || first <= 0)) {
    throw new Error(`Invalid first: ${first}`);
  }

  return {
    intervalMs,
    once,
    first
  };
}

async function main(): Promise<void> {
  const config = loadConfig();
  const options = parseCliOptions(process.argv.slice(2), process.env);

  const runOnce = async (): Promise<void> => {
    const result = await runResearchCollectorCycle(config, {
      first: options.first
    });
    console.log(JSON.stringify({ type: "research_collect_cycle", result }));
  };

  await runOnce();

  if (options.once) {
    return;
  }

  await new Promise<void>((resolve) => {
    const timer = setInterval(() => {
      void runOnce();
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
