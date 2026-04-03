import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export type ArchiveCategory =
  | "market-snapshots"
  | "orderbook"
  | "last-sale"
  | "order-events"
  | "fills"
  | "portfolio"
  | "market-regime"
  | "fill-outcomes";

export type ArchiveEnvelope = {
  event_type: string;
  recorded_at: string;
  market_id?: number;
  payload: unknown;
};

export type AppendArchiveEventInput = {
  category: ArchiveCategory;
  eventType: string;
  payload: unknown;
  recordedAt?: string;
  marketId?: number;
};

export class EventArchive {
  constructor(
    private readonly rootDir: string,
    private readonly now: () => Date = () => new Date()
  ) {}

  append(input: AppendArchiveEventInput): string {
    const recordedAt = input.recordedAt ?? this.now().toISOString();
    const timestamp = new Date(recordedAt);
    const datePath = recordedAt.slice(0, 10);
    const hour = recordedAt.slice(11, 13);
    const directoryParts = [this.rootDir, input.category, datePath];

    if (input.marketId !== undefined) {
      directoryParts.push(`market_id=${input.marketId}`);
    }

    const directory = join(...directoryParts);
    const filePath = join(directory, `${hour}.jsonl`);
    const envelope: ArchiveEnvelope = {
      event_type: input.eventType,
      recorded_at: Number.isNaN(timestamp.getTime())
        ? this.now().toISOString()
        : timestamp.toISOString(),
      ...(input.marketId !== undefined ? { market_id: input.marketId } : {}),
      payload: input.payload
    };

    mkdirSync(directory, { recursive: true });
    appendFileSync(filePath, `${JSON.stringify(envelope)}\n`, "utf8");

    return filePath;
  }
}
