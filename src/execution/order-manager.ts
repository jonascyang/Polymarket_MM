export type ManagedOrderSide = "bid" | "ask";

export type ManagedOrder = {
  id?: string;
  marketId: number;
  side: ManagedOrderSide;
  price: number;
  sizeUsd: number;
};

export type OrderCommand =
  | {
      type: "cancel";
      orderId: string;
    }
  | {
      type: "create";
      order: ManagedOrder;
    };

export function buildOrderCommands(input: {
  cancel: ManagedOrder[];
  create: ManagedOrder[];
}): OrderCommand[] {
  return [
    ...input.cancel
      .filter((order): order is ManagedOrder & { id: string } => typeof order.id === "string")
      .map((order) => ({
        type: "cancel" as const,
        orderId: order.id
      })),
    ...input.create.map((order) => ({
      type: "create" as const,
      order
    }))
  ];
}

export type ApplySimulatedOrderCommandsInput = {
  currentOrders: ManagedOrder[];
  commands: OrderCommand[];
  idFactory?: (order: ManagedOrder, index: number) => string;
};

export type ApplySimulatedOrderCommandsResult = {
  currentOrders: ManagedOrder[];
  cancelledOrderIds: string[];
  cancelledOrders: Array<ManagedOrder & { id: string }>;
  createdOrders: Array<ManagedOrder & { id: string }>;
};

export function applySimulatedOrderCommands(
  input: ApplySimulatedOrderCommandsInput
): ApplySimulatedOrderCommandsResult {
  const cancelledOrderIds = input.commands
    .filter((command): command is Extract<OrderCommand, { type: "cancel" }> => command.type === "cancel")
    .map((command) => command.orderId);
  const cancelledOrderIdSet = new Set(cancelledOrderIds);
  const cancelledOrders = input.currentOrders.filter(
    (order): order is ManagedOrder & { id: string } =>
      typeof order.id === "string" && cancelledOrderIdSet.has(order.id)
  );
  const currentOrders = input.currentOrders.filter(
    (order) => !order.id || !cancelledOrderIdSet.has(order.id)
  );
  const idFactory =
    input.idFactory ??
    ((order: ManagedOrder, index: number) =>
      `simulated:${order.marketId}:${order.side}:${index}`);
  const createdOrders = input.commands
    .filter((command): command is Extract<OrderCommand, { type: "create" }> => command.type === "create")
    .map((command, index) => ({
      ...command.order,
      id: idFactory(command.order, index)
    }));

  return {
    currentOrders: [...currentOrders, ...createdOrders],
    cancelledOrderIds,
    cancelledOrders,
    createdOrders
  };
}
