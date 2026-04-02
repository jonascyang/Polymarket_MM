import type { ManagedOrder } from "./order-manager";

export type DiffOrdersInput = {
  current: ManagedOrder[];
  target: ManagedOrder[];
};

export type DiffOrdersResult = {
  cancel: ManagedOrder[];
  create: ManagedOrder[];
  keep: ManagedOrder[];
};

function buildOrderKey(order: ManagedOrder): string {
  return `${order.marketId}:${order.side}:${order.price}:${order.sizeUsd}`;
}

export function diffOrders(input: DiffOrdersInput): DiffOrdersResult {
  const targetByKey = new Map(input.target.map((order) => [buildOrderKey(order), order]));
  const keep: ManagedOrder[] = [];
  const cancel: ManagedOrder[] = [];

  for (const currentOrder of input.current) {
    const key = buildOrderKey(currentOrder);

    if (targetByKey.has(key)) {
      keep.push(currentOrder);
      targetByKey.delete(key);
      continue;
    }

    cancel.push(currentOrder);
  }

  return {
    cancel,
    create: [...targetByKey.values()],
    keep
  };
}
