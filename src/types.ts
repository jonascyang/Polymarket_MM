export type PredictMmConfig = {
  apiBaseUrl: string;
  wsUrl: string;
  apiKey: string;
  dbPath: string;
  bearerToken?: string;
  runtimeIntervalMs?: number;
  walletPrivateKey?: string;
  predictAccount?: string;
};
