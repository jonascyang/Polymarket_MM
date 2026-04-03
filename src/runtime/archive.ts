import { gzipSync } from "node:zlib";
import { readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export type ArchiveObjectClient = {
  putObject(
    key: string,
    body: Uint8Array | Buffer | string,
    contentType: string
  ): Promise<void>;
};

export type CollectPendingArchiveFilesOptions = {
  nowMs?: number;
  minAgeMs?: number;
};

export type UploadPendingArchivesOptions = CollectPendingArchiveFilesOptions & {
  archiveDir: string;
  prefix?: string;
  client: ArchiveObjectClient;
};

export type UploadedArchiveObject = {
  sourcePath: string;
  objectKey: string;
  bytes: number;
};

function walkFiles(rootDir: string): string[] {
  const pending: string[] = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop() as string;

    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const entryPath = join(current, entry.name);

      if (entry.isDirectory()) {
        stack.push(entryPath);
        continue;
      }

      pending.push(entryPath);
    }
  }

  return pending.sort();
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, "");
}

function resolveContentType(filePath: string): string {
  if (filePath.endsWith(".jsonl") || filePath.endsWith(".jsonl.gz")) {
    return "application/x-ndjson";
  }

  if (filePath.endsWith(".sqlite") || filePath.endsWith(".sqlite.gz")) {
    return "application/vnd.sqlite3";
  }

  return "application/octet-stream";
}

export function collectPendingArchiveFiles(
  rootDir: string,
  options: CollectPendingArchiveFilesOptions = {}
): string[] {
  const nowMs = options.nowMs ?? Date.now();
  const minAgeMs = options.minAgeMs ?? 5 * 60 * 1000;

  return walkFiles(rootDir).filter((filePath) => {
    const stats = statSync(filePath);
    return nowMs - stats.mtimeMs >= minAgeMs;
  });
}

export async function uploadPendingArchives(
  options: UploadPendingArchivesOptions
): Promise<UploadedArchiveObject[]> {
  const uploads: UploadedArchiveObject[] = [];
  const candidates = collectPendingArchiveFiles(options.archiveDir, options);

  for (const filePath of candidates) {
    const rawBody = readFileSync(filePath);
    const alreadyCompressed = filePath.endsWith(".gz");
    const body = alreadyCompressed ? rawBody : gzipSync(rawBody);
    const relativePath = relative(options.archiveDir, filePath).replaceAll("\\", "/");
    const normalizedPrefix = options.prefix ? `${trimSlashes(options.prefix)}/` : "";
    const objectKey = alreadyCompressed
      ? `${normalizedPrefix}${relativePath}`
      : `${normalizedPrefix}${relativePath}.gz`;

    await options.client.putObject(objectKey, body, resolveContentType(filePath));

    uploads.push({
      sourcePath: filePath,
      objectKey,
      bytes: rawBody.length
    });
    rmSync(filePath);
  }

  return uploads;
}
