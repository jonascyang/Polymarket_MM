import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

import type { PredictMmConfig } from "../types";
import type { ArchiveObjectClient } from "../runtime/archive";

type RequiredR2Config = Pick<
  PredictMmConfig,
  "r2Endpoint" | "r2Bucket" | "r2AccessKeyId" | "r2SecretAccessKey" | "r2Region"
>;

export function createR2ObjectClient(config: RequiredR2Config): ArchiveObjectClient {
  if (
    !config.r2Endpoint ||
    !config.r2Bucket ||
    !config.r2AccessKeyId ||
    !config.r2SecretAccessKey
  ) {
    throw new Error("createR2ObjectClient requires endpoint, bucket, access key, and secret key");
  }

  const client = new S3Client({
    region: config.r2Region ?? "auto",
    endpoint: config.r2Endpoint,
    credentials: {
      accessKeyId: config.r2AccessKeyId,
      secretAccessKey: config.r2SecretAccessKey
    }
  });

  return {
    async putObject(key, body, contentType): Promise<void> {
      await client.send(
        new PutObjectCommand({
          Bucket: config.r2Bucket,
          Key: key,
          Body: body,
          ContentType: contentType
        })
      );
    }
  };
}
