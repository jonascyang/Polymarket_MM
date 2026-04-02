import type { ManagedOrder, ManagedOrderSide } from "../execution/order-manager";

export type PredictWsSubscribeMessage = {
  method: "subscribe";
  requestId: number;
  params: string[];
};

export type PredictWsHeartbeatMessage = {
  method: "heartbeat";
  data: number | string;
};

export type PredictWsServerMessage = {
  type?: string;
  topic?: string;
  data?: unknown;
};

export type PredictWalletEventKind =
  | "order_opened"
  | "order_updated"
  | "order_cancelled"
  | "fill"
  | "position_delta";

export type PredictWalletEvent =
  | {
      topic: string;
      kind: "order_opened" | "order_updated";
      marketId: number;
      order: ManagedOrder & { id: string };
      payload: unknown;
    }
  | {
      topic: string;
      kind: "order_cancelled";
      marketId: number;
      orderId: string;
      payload: unknown;
    }
  | {
      topic: string;
      kind: "fill";
      marketId: number;
      orderId?: string;
      side?: ManagedOrderSide;
      price?: number;
      sizeUsd?: number;
      inventoryDeltaUsd?: number;
      inventoryUsd?: number;
      order?: ManagedOrder & { id: string };
      payload: unknown;
    }
  | {
      topic: string;
      kind: "position_delta";
      marketId: number;
      inventoryDeltaUsd?: number;
      inventoryUsd?: number;
      payload: unknown;
    };

const WS_CONNECTING = 0;
const WS_OPEN = 1;

export function buildSubscribeMessage(requestId: number, topics: string[]): PredictWsSubscribeMessage {
  return {
    method: "subscribe",
    requestId,
    params: topics
  };
}

export function buildHeartbeatMessage(timestamp: number | string): PredictWsHeartbeatMessage {
  return {
    method: "heartbeat",
    data: timestamp
  };
}

export function parseServerMessage(rawMessage: string): PredictWsServerMessage {
  return JSON.parse(rawMessage) as PredictWsServerMessage;
}

export function isHeartbeatEvent(message: PredictWsServerMessage): boolean {
  return message.type === "heartbeat";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function normalizeSide(value: unknown): ManagedOrderSide | undefined {
  if (value === 0 || value === "0") {
    return "bid";
  }

  if (value === 1 || value === "1") {
    return "ask";
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === "bid" || normalized === "buy" || normalized === "yes") {
    return "bid";
  }

  if (normalized === "ask" || normalized === "sell" || normalized === "no") {
    return "ask";
  }

  return undefined;
}

function normalizeWalletEventKind(value: unknown): PredictWalletEventKind | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase().replace(/[-\s]/g, "_");
  const mapped: Record<string, PredictWalletEventKind> = {
    fill: "fill",
    filled: "fill",
    match: "fill",
    order_opened: "order_opened",
    order_created: "order_opened",
    order_accepted: "order_opened",
    order_updated: "order_updated",
    order_changed: "order_updated",
    order_cancelled: "order_cancelled",
    order_canceled: "order_cancelled",
    order_removed: "order_cancelled",
    position_delta: "position_delta",
    inventory_delta: "position_delta"
  };

  return mapped[normalized];
}

function resolveMarketId(payload: Record<string, unknown>): number | undefined {
  const direct = asNumber(payload.marketId);

  if (direct !== undefined) {
    return direct;
  }

  const market = asRecord(payload.market);
  const nested = market ? asNumber(market.id) : undefined;

  return nested;
}

function buildManagedOrder(
  payload: Record<string, unknown>,
  marketId: number,
  fallbackOrderId?: string
): (ManagedOrder & { id: string }) | undefined {
  const orderId = asString(payload.id) ?? asString(payload.orderId) ?? fallbackOrderId;
  const side = normalizeSide(payload.side);
  const price = asNumber(payload.price) ?? asNumber(payload.pricePerShare);
  const sizeUsd =
    asNumber(payload.remainingSizeUsd) ??
    asNumber(payload.openSizeUsd) ??
    asNumber(payload.sizeUsd);

  if (!orderId || !side || price === undefined || sizeUsd === undefined) {
    return undefined;
  }

  return {
    id: orderId,
    marketId,
    side,
    price,
    sizeUsd
  };
}

export function normalizeWalletEvent(
  topic: string,
  payload: unknown
): PredictWalletEvent | null {
  if (!topic.startsWith("predictWalletEvents/")) {
    return null;
  }

  const record = asRecord(payload);

  if (!record) {
    return null;
  }

  const kind = normalizeWalletEventKind(
    record.eventType ?? record.type ?? record.kind ?? record.status
  );
  const marketId = resolveMarketId(record);

  if (!kind || marketId === undefined) {
    return null;
  }

  const orderRecord = asRecord(record.order);
  const orderId = asString(record.orderId);

  switch (kind) {
    case "order_opened":
    case "order_updated": {
      const order = buildManagedOrder(orderRecord ?? record, marketId, orderId);
      return order
        ? {
            topic,
            kind,
            marketId,
            order,
            payload
          }
        : null;
    }
    case "order_cancelled": {
      const resolvedOrderId =
        orderId ?? asString(orderRecord?.id) ?? asString(orderRecord?.orderId);

      return resolvedOrderId
        ? {
            topic,
            kind,
            marketId,
            orderId: resolvedOrderId,
            payload
          }
        : null;
    }
    case "fill": {
      const side = normalizeSide(record.side ?? orderRecord?.side);
      const price = asNumber(record.price ?? record.pricePerShare ?? orderRecord?.price);
      const sizeUsd = asNumber(record.sizeUsd ?? record.fillSizeUsd);
      const inventoryDeltaUsd = asNumber(
        record.inventoryDeltaUsd ?? record.positionDeltaUsd
      );
      const inventoryUsd = asNumber(record.inventoryUsd ?? record.positionUsd);
      const order = buildManagedOrder(
        orderRecord ?? record,
        marketId,
        orderId ?? asString(orderRecord?.id)
      );

      const normalizedEvent: PredictWalletEvent = {
        topic,
        kind,
        marketId,
        orderId: orderId ?? order?.id,
        side,
        price,
        sizeUsd,
        inventoryDeltaUsd,
        inventoryUsd,
        order,
        payload
      };

      if (normalizedEvent.inventoryUsd === undefined) {
        delete normalizedEvent.inventoryUsd;
      }

      return normalizedEvent;
    }
    case "position_delta":
      return {
        topic,
        kind,
        marketId,
        inventoryDeltaUsd: asNumber(
          record.inventoryDeltaUsd ?? record.positionDeltaUsd
        ),
        inventoryUsd: asNumber(record.inventoryUsd ?? record.positionUsd),
        payload
      };
  }
}

export class PredictWsClient {
  private socket: WebSocket | null = null;

  constructor(private readonly wsUrl: string) {}

  connect(): WebSocket {
    const socket = new WebSocket(this.wsUrl);
    this.socket = socket;
    return socket;
  }

  private async waitForOpenSocket(): Promise<WebSocket> {
    if (!this.socket) {
      throw new Error("Predict websocket is not connected");
    }

    if (this.socket.readyState === WS_OPEN) {
      return this.socket;
    }

    if (this.socket.readyState !== WS_CONNECTING) {
      throw new Error("Predict websocket is not open");
    }

    await new Promise<void>((resolve, reject) => {
      const handleOpen = (): void => {
        cleanup();
        resolve();
      };
      const handleError = (): void => {
        cleanup();
        reject(new Error("Predict websocket failed to connect"));
      };
      const cleanup = (): void => {
        this.socket?.removeEventListener("open", handleOpen);
        this.socket?.removeEventListener("error", handleError);
      };

      this.socket?.addEventListener("open", handleOpen);
      this.socket?.addEventListener("error", handleError);
    });

    return this.socket;
  }

  async subscribe(requestId: number, topics: string[]): Promise<void> {
    if (!this.socket) {
      throw new Error("Predict websocket is not connected");
    }

    const socket = await this.waitForOpenSocket();

    socket.send(JSON.stringify(buildSubscribeMessage(requestId, topics)));
  }

  respondToHeartbeat(timestamp: number | string): void {
    if (!this.socket) {
      throw new Error("Predict websocket is not connected");
    }

    this.socket.send(JSON.stringify(buildHeartbeatMessage(timestamp)));
  }
}
