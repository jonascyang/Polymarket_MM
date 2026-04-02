import { loadConfig } from "../config";
import {
  createWalletAuthSigner,
  getJwtTokenFromAuthFlow,
  PredictAuthClient
} from "../clients/auth-client";
import { PredictRestClient } from "../clients/rest-client";
import { PredictLiveExecutor } from "../execution/live-executor";
import { startPollingRuntime } from "./runtime-loop";

async function main(): Promise<void> {
  const config = loadConfig();
  const walletPrivateKey = config.walletPrivateKey;

  if (!walletPrivateKey) {
    throw new Error(
      "run-live.ts requires PREDICT_MM_WALLET_PRIVATE_KEY for signed live order placement"
    );
  }

  const bearerToken =
    config.bearerToken ??
    (await getJwtTokenFromAuthFlow(
      new PredictAuthClient(config),
      createWalletAuthSigner(walletPrivateKey)
    ));

  const liveExecutor = await PredictLiveExecutor.make({
    bearerToken,
    restClient: new PredictRestClient(config),
    walletPrivateKey,
    predictAccount: config.predictAccount
  });
  const runtime = await startPollingRuntime("live", config, {
    intervalMs: config.runtimeIntervalMs,
    liveExecutor,
    onCycle(snapshot) {
      console.log(JSON.stringify({ type: "runtime_cycle", mode: "live", snapshot }));
    },
    onError(error) {
      console.error(
        JSON.stringify({
          type: "runtime_error",
          mode: "live",
          error: error instanceof Error ? error.message : String(error)
        })
      );
    }
  });

  console.log(
    JSON.stringify({
      type: "runtime_bootstrap",
      mode: "live",
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
      console.log(JSON.stringify({ type: "runtime_stop", mode: "live" }));
      resolve();
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });
}

void main();
