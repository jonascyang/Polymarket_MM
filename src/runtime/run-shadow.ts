import { loadConfig } from "../config";
import { startPollingRuntime } from "./runtime-loop";

async function main(): Promise<void> {
  const config = loadConfig();
  const runtime = await startPollingRuntime("shadow", config, {
    intervalMs: config.runtimeIntervalMs,
    onCycle(snapshot) {
      console.log(JSON.stringify({ type: "runtime_cycle", mode: "shadow", snapshot }));
    }
  });

  console.log(
    JSON.stringify({
      type: "runtime_bootstrap",
      mode: "shadow",
      snapshot: runtime.loop.getSnapshot()
    })
  );

  await new Promise<void>((resolve) => {
    let stopped = false;

    const shutdown = (): void => {
      if (stopped) {
        return;
      }

      stopped = true;
      process.off("SIGINT", shutdown);
      process.off("SIGTERM", shutdown);
      runtime.stop();
      console.log(JSON.stringify({ type: "runtime_stop", mode: "shadow" }));
      resolve();
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });
}

void main();
