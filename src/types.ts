export type PredictMmConfig = {
  apiBaseUrl: string;
  wsUrl: string;
  apiKey: string;
  dbPath: string;
  archiveDir?: string;
  bearerToken?: string;
  runtimeIntervalMs?: number;
  walletPrivateKey?: string;
  predictAccount?: string;
  r2Endpoint?: string;
  r2Bucket?: string;
  r2AccessKeyId?: string;
  r2SecretAccessKey?: string;
  r2Prefix?: string;
  r2Region?: string;
};
