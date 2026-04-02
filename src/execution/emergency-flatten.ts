import type { ManagedOrder } from "./order-manager";

export type FlattenPosition = {
  marketId: number;
  inventoryUsd: number;
  bestBid: number | null;
  bestAsk: number | null;
};

export function buildEmergencyFlattenOrders(
  positions: FlattenPosition[]
): ManagedOrder[] {
  const orders: ManagedOrder[] = [];

  for (const position of positions) {
    if (position.inventoryUsd === 0) {
      continue;
    }

    if (position.inventoryUsd > 0) {
      orders.push({
        marketId: position.marketId,
        side: "ask",
        price: position.bestBid ?? position.bestAsk ?? 0,
        sizeUsd: Math.abs(position.inventoryUsd)
      });
      continue;
    }

    orders.push({
      marketId: position.marketId,
      side: "bid",
      price: position.bestAsk ?? position.bestBid ?? 1,
      sizeUsd: Math.abs(position.inventoryUsd)
    });
  }

  return orders;
}
