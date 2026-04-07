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

const SIZE_USD_MATCH_TOLERANCE = 0.001;

function ordersMatch(currentOrder: ManagedOrder, targetOrder: ManagedOrder): boolean {
  return (
    currentOrder.marketId === targetOrder.marketId &&
    currentOrder.side === targetOrder.side &&
    currentOrder.price === targetOrder.price &&
    Math.abs(currentOrder.sizeUsd - targetOrder.sizeUsd) <= SIZE_USD_MATCH_TOLERANCE
  );
}

export function diffOrders(input: DiffOrdersInput): DiffOrdersResult {
  const keep: ManagedOrder[] = [];
  const cancel: ManagedOrder[] = [];
  const unmatchedTargets = [...input.target];

  for (const currentOrder of input.current) {
    const matchingTargetIndex = unmatchedTargets.findIndex((targetOrder) =>
      ordersMatch(currentOrder, targetOrder)
    );

    if (matchingTargetIndex >= 0) {
      keep.push(currentOrder);
      unmatchedTargets.splice(matchingTargetIndex, 1);
      continue;
    }

    cancel.push(currentOrder);
  }

  return {
    cancel,
    create: unmatchedTargets,
    keep
  };
}
