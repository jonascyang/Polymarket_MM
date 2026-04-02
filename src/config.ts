import type { PredictMmConfig } from "./types";

type ConfigEnv = Record<string, string | undefined>;

function parseOptionalNumber(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid numeric environment variable: ${value}`);
  }

  return parsed;
}

function requireEnv(env: ConfigEnv, key: keyof ConfigEnv): string {
  const value = env[key];

  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return value;
}

export function parseConfig(env: ConfigEnv): PredictMmConfig {
  return {
    apiBaseUrl: requireEnv(env, "PREDICT_API_BASE_URL"),
    wsUrl: requireEnv(env, "PREDICT_WS_URL"),
    apiKey: requireEnv(env, "PREDICT_API_KEY"),
    dbPath: requireEnv(env, "PREDICT_MM_DB_PATH"),
    bearerToken: env.PREDICT_AUTH_BEARER_TOKEN,
    runtimeIntervalMs: parseOptionalNumber(env.PREDICT_RUNTIME_INTERVAL_MS),
    walletPrivateKey: env.PREDICT_MM_WALLET_PRIVATE_KEY,
    predictAccount: env.PREDICT_MM_PREDICT_ACCOUNT
  };
}

export function loadConfig(): PredictMmConfig {
  return parseConfig(process.env);
}
