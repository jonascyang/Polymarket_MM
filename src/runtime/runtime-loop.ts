import {
  isHeartbeatEvent,
  normalizeWalletEvent,
  parseServerMessage,
  type PredictWalletEvent,
  type PredictWsServerMessage
} from "../clients/ws-client";
import { applySimulatedOrderCommands } from "../execution/order-manager";
import type { PredictMmConfig } from "../types";
import type { PredictOrderbookData } from "../clients/rest-client";
import {
  bootstrapConfiguredRuntimeState,
  buildLiveMarketMetadataMap,
  refreshBootstrappedRuntimeState,
  runRuntimeCycle,
  type BootstrappedRuntimeState,
  type RunConfiguredRuntimeOptions,
  type RuntimeCycleResult
} from "./runtime";
import type { PredictLiveExecutor } from "../execution/live-executor";
import type { ManagedOrder, OrderCommand } from "../execution/order-manager";

export type RuntimeLoopSnapshot = {
  cycleCount: number;
  markets: BootstrappedRuntimeState["markets"];
  result: RuntimeCycleResult;
  subscribedTopics: string[];
};

export type RuntimeLoop = {
  bootstrap: () => Promise<RuntimeLoopSnapshot>;
  handleServerMessage: (raw: string | PredictWsServerMessage) => RuntimeLoopSnapshot;
  handleServerMessageAsync: (
    raw: string | PredictWsServerMessage
  ) => Promise<RuntimeLoopSnapshot>;
  runCycle: () => RuntimeLoopSnapshot;
  runCycleAsync: () => Promise<RuntimeLoopSnapshot>;
  getSnapshot: () => RuntimeLoopSnapshot;
  stop: () => void;
};

export type RuntimeLoopOptions = RunConfiguredRuntimeOptions & {
  liveExecutor?: Pick<PredictLiveExecutor, "syncCommands">;
  privateStateRefreshIntervalCycles?: number;
  onError?: (error: unknown) => void | Promise<void>;
  nowMs?: () => number;
};

export type PollingRuntimeOptions = RuntimeLoopOptions & {
  intervalMs?: number;
  onCycle?: (snapshot: RuntimeLoopSnapshot) => void | Promise<void>;
  setTimer?: (
    callback: () => void | Promise<void>,
    intervalMs: number
  ) => ReturnType<typeof setInterval>;
  clearTimer?: (timer: ReturnType<typeof setInterval>) => void;
};

export type PollingRuntime = {
  loop: RuntimeLoop;
  stop: () => void;
};

const TOXIC_PRICE_JUMP_TICKS = 3;
const TOXIC_SPREAD_THRESHOLD_RATIO = 0.8;
const TOXIC_ADVERSE_FILL_TICKS = 2;
const TOXIC_COOLDOWN_MS = 30_000;

function buildSubscriptionTopics(state: BootstrappedRuntimeState): string[] {
  const topics = state.result.marketPlans.map(
    (plan) => `predictOrderbook/${plan.marketId}`
  );

  if (state.mode === "live" && state.bearerToken) {
    topics.push(`predictWalletEvents/${state.bearerToken}`);
  }

  return topics;
}

function updateMarketFromOrderbook(
  state: BootstrappedRuntimeState,
  topic: string,
  payload: PredictOrderbookData,
  nowMs: number
): void {
  const event = state.services.recorder.recordOrderbookEvent(topic, payload);
  const market = state.markets.find((candidate) => candidate.id === event.marketId);

  if (!market) {
    return;
  }

  const previousMid = market.mid;

  market.bestBid = event.bestBid;
  market.bestAsk = event.bestAsk;
  market.bidBook = event.bids;
  market.askBook = event.asks;
  market.hasTwoSidedBook = event.bestBid !== null && event.bestAsk !== null;

  if (event.bestBid !== null && event.bestAsk !== null) {
    market.mid = event.mid;
    market.spread = event.spread;
  } else if (event.bestBid !== null) {
    market.mid = event.bestBid;
  } else if (event.bestAsk !== null) {
    market.mid = event.bestAsk;
  } else {
    market.mid = 0.5;
  }

  if (event.bestBid === null || event.bestAsk === null) {
    market.spread = 1;
  }

  const priceJumpTicks = Math.abs(market.mid - previousMid) / market.tickSize;
  const spreadNearThreshold =
    market.spread >= market.spreadThreshold * TOXIC_SPREAD_THRESHOLD_RATIO;
  const adverseFillMove =
    market.lastFillMid !== undefined &&
    market.lastFillSide !== undefined &&
    ((market.lastFillSide === "bid" &&
      market.mid <=
        market.lastFillMid - market.tickSize * TOXIC_ADVERSE_FILL_TICKS) ||
      (market.lastFillSide === "ask" &&
        market.mid >=
          market.lastFillMid + market.tickSize * TOXIC_ADVERSE_FILL_TICKS));

  if (
    priceJumpTicks >= TOXIC_PRICE_JUMP_TICKS ||
    spreadNearThreshold ||
    adverseFillMove
  ) {
    market.isToxic = true;
    market.toxicUntilMs = nowMs + TOXIC_COOLDOWN_MS;
    return;
  }

  if ((market.toxicUntilMs ?? 0) <= nowMs) {
    market.isToxic = false;
  }
}

function estimateQueueAheadShares(
  state: BootstrappedRuntimeState,
  order: Pick<ManagedOrder, "marketId" | "side" | "price">
): number | undefined {
  const market = state.markets.find((candidate) => candidate.id === order.marketId);

  if (!market) {
    return undefined;
  }

  const levels = order.side === "bid" ? market.bidBook : market.askBook;

  if (!levels || levels.length === 0) {
    return undefined;
  }

  const queueAhead = levels.reduce((sum, level) => {
    if (order.side === "bid") {
      if (level.price > order.price || level.price === order.price) {
        return sum + level.size;
      }

      return sum;
    }

    if (level.price < order.price || level.price === order.price) {
      return sum + level.size;
    }

    return sum;
  }, 0);

  return Number(queueAhead.toFixed(6));
}

function getTopOfBookDepth(
  state: BootstrappedRuntimeState,
  marketId: number
): { bidDepth1AtFill?: number; askDepth1AtFill?: number } {
  const market = state.markets.find((candidate) => candidate.id === marketId);

  return {
    bidDepth1AtFill: market?.bidBook?.[0]?.size,
    askDepth1AtFill: market?.askBook?.[0]?.size
  };
}

function rerunCycle(state: BootstrappedRuntimeState): RuntimeCycleResult {
  const aggregateNetInventoryUsd = state.markets.reduce(
    (sum, market) => sum + market.inventoryUsd,
    0
  );

  return runRuntimeCycle({
    mode: state.mode,
    markets: state.markets,
    currentOrders: state.currentOrders,
    quoteBudgetUsd: state.options.quoteBudgetUsd,
    suppressCreates: state.suppressCreates,
    extraCancelOrderIds: state.privateState.normalizedOpenOrders
      .map((order) => order.id)
      .filter((orderId): orderId is string => typeof orderId === "string"),
    privateState: state.privateState,
    riskInput: {
      flattenPnlPct: 0,
      peakDrawdownPct: 0,
      aggregateNetInventoryUsd,
      aggregateNetInventoryCapUsd: state.options.aggregateNetInventoryCapUsd ?? 45,
      minutesToExit: state.options.minutesToExit ?? 180,
      ...(state.options.riskInputOverrides ?? {})
    }
  });
}

function applyMarketPlanStates(state: BootstrappedRuntimeState): void {
  for (const plan of state.result.marketPlans) {
    const market = state.markets.find((candidate) => candidate.id === plan.marketId);

    if (market) {
      market.currentState = plan.nextState;
    }
  }
}

function upsertManagedOrder(
  currentOrders: ManagedOrder[],
  nextOrder: ManagedOrder & { id: string }
): ManagedOrder[] {
  return [
    ...currentOrders.filter((order) => order.id !== nextOrder.id),
    nextOrder
  ];
}

function setMarketInventory(
  state: BootstrappedRuntimeState,
  marketId: number,
  input: {
    inventoryUsd?: number;
    inventoryDeltaUsd?: number;
  }
): void {
  const market = state.markets.find((candidate) => candidate.id === marketId);

  if (!market) {
    return;
  }

  if (input.inventoryUsd !== undefined) {
    market.inventoryUsd = input.inventoryUsd;
  } else if (input.inventoryDeltaUsd !== undefined) {
    market.inventoryUsd += input.inventoryDeltaUsd;
  }

  if (market.inventoryUsd === 0) {
    market.oneSidedFill = false;
    market.lastFillMid = undefined;
    market.lastFillSide = undefined;
  }

  state.privateState.inventoryByMarket[marketId] = market.inventoryUsd;
}

function incrementQuoteCountSinceFill(
  state: BootstrappedRuntimeState,
  orders: Pick<ManagedOrder, "marketId">[]
): void {
  const quoteCountsByMarket = orders.reduce<Map<number, number>>((accumulator, order) => {
    accumulator.set(order.marketId, (accumulator.get(order.marketId) ?? 0) + 1);
    return accumulator;
  }, new Map());

  for (const market of state.markets) {
    const increment = quoteCountsByMarket.get(market.id);

    if (increment === undefined) {
      continue;
    }

    market.quoteCountSinceFill = (market.quoteCountSinceFill ?? 0) + increment;
  }
}

function updatePrivateOpenOrders(
  state: BootstrappedRuntimeState,
  nextOrders: ManagedOrder[]
): void {
  state.privateState.normalizedOpenOrders = nextOrders;

  if (!state.privateState.hasUnnormalizedOpenOrders) {
    state.currentOrders = nextOrders;
  }
}

function applyWalletEventToState(
  state: BootstrappedRuntimeState,
  event: PredictWalletEvent
): void {
  switch (event.kind) {
    case "order_opened":
      state.services.recorder.recordManagedOrder(event.order, "LIVE_OPEN");
      state.services.recorder.recordOrderEvent({
        marketId: event.marketId,
        orderId: event.order.id,
        eventType: "LIVE_OPEN",
        logicalSide: event.order.side,
        price: event.order.price,
        sizeUsd: event.order.sizeUsd,
        queueAheadSharesEst: estimateQueueAheadShares(state, event.order),
        payload: event.payload
      });
      updatePrivateOpenOrders(state, upsertManagedOrder(state.privateState.normalizedOpenOrders, event.order));
      return;
    case "order_updated":
      state.services.recorder.recordManagedOrder(event.order, "LIVE_UPDATED");
      state.services.recorder.recordOrderEvent({
        marketId: event.marketId,
        orderId: event.order.id,
        eventType: "LIVE_UPDATED",
        logicalSide: event.order.side,
        price: event.order.price,
        sizeUsd: event.order.sizeUsd,
        queueAheadSharesEst: estimateQueueAheadShares(state, event.order),
        payload: event.payload
      });
      updatePrivateOpenOrders(state, upsertManagedOrder(state.privateState.normalizedOpenOrders, event.order));
      return;
    case "order_cancelled": {
      const cancelledOrder = state.privateState.normalizedOpenOrders.find(
        (order) => order.id === event.orderId
      );

      if (cancelledOrder) {
        state.services.recorder.recordManagedOrder(cancelledOrder, "LIVE_CANCELLED");
        state.services.recorder.recordOrderEvent({
          marketId: event.marketId,
          orderId: event.orderId,
          eventType: "LIVE_CANCELLED",
          logicalSide: cancelledOrder.side,
          price: cancelledOrder.price,
          sizeUsd: cancelledOrder.sizeUsd,
          queueAheadSharesEst: estimateQueueAheadShares(state, cancelledOrder),
          payload: event.payload
        });
      }

      updatePrivateOpenOrders(
        state,
        state.privateState.normalizedOpenOrders.filter(
          (order) => order.id !== event.orderId
        )
      );
      return;
    }
    case "fill":
      {
        const { bidDepth1AtFill, askDepth1AtFill } = getTopOfBookDepth(
          state,
          event.marketId
        );
        const marketBeforeFill = state.markets.find(
          (candidate) => candidate.id === event.marketId
        );
        const inventoryAfterUsd =
          event.inventoryUsd ??
          ((marketBeforeFill?.inventoryUsd ?? 0) + (event.inventoryDeltaUsd ?? 0));

      state.services.recorder.recordFillEvent(event.marketId, {
        orderId: event.orderId,
        side: event.side,
        price: event.price,
        sizeUsd: event.sizeUsd,
        inventoryDeltaUsd: event.inventoryDeltaUsd,
        inventoryUsd: event.inventoryUsd,
        inventoryAfterUsd,
        midAtFill: marketBeforeFill?.mid,
        spreadAtFill: marketBeforeFill?.spread,
        bidDepth1AtFill,
        askDepth1AtFill
      });
      }

      setMarketInventory(state, event.marketId, {
        inventoryUsd: event.inventoryUsd,
        inventoryDeltaUsd: event.inventoryDeltaUsd
      });

      state.services.recorder.recordOrderEvent({
        marketId: event.marketId,
        orderId: event.orderId,
        eventType: event.order ? "PARTIAL_FILL" : "FILLED",
        logicalSide: event.side,
        price: event.price,
        sizeUsd: event.sizeUsd,
        payload: event.payload
      });

      {
        const market = state.markets.find((candidate) => candidate.id === event.marketId);

        if (market) {
          market.quoteCountSinceFill = 0;

          if (event.side && market.inventoryUsd !== 0) {
            market.oneSidedFill = true;
            market.lastFillMid = market.mid;
            market.lastFillSide = event.side;
          }
        }
      }

      if (event.order) {
        updatePrivateOpenOrders(
          state,
          upsertManagedOrder(state.privateState.normalizedOpenOrders, event.order)
        );
      } else if (event.orderId) {
        updatePrivateOpenOrders(
          state,
          state.privateState.normalizedOpenOrders.filter(
            (order) => order.id !== event.orderId
          )
        );
      }

      return;
    case "position_delta":
      setMarketInventory(state, event.marketId, {
        inventoryUsd: event.inventoryUsd,
        inventoryDeltaUsd: event.inventoryDeltaUsd
      });
      return;
  }
}

function syncSimulatedShadowOrders(
  state: BootstrappedRuntimeState,
  nextShadowOrderId: () => string
): void {
  if (state.mode !== "shadow" || state.result.commands.length === 0) {
    return;
  }

  const applied = applySimulatedOrderCommands({
    currentOrders: state.currentOrders,
    commands: state.result.commands,
    idFactory: () => nextShadowOrderId()
  });

  for (const order of applied.cancelledOrders) {
    state.services.recorder.recordManagedOrder(order, "SHADOW_CANCELLED");
    state.services.recorder.recordOrderEvent({
      marketId: order.marketId,
      orderId: order.id,
      eventType: "SHADOW_CANCELLED",
      logicalSide: order.side,
      price: order.price,
      sizeUsd: order.sizeUsd,
      queueAheadSharesEst: estimateQueueAheadShares(state, order),
      payload: order
    });
  }

  for (const order of applied.createdOrders) {
    state.services.recorder.recordManagedOrder(order, "SHADOW_OPEN");
    state.services.recorder.recordOrderEvent({
      marketId: order.marketId,
      orderId: order.id,
      eventType: "SHADOW_OPEN",
      logicalSide: order.side,
      price: order.price,
      sizeUsd: order.sizeUsd,
      queueAheadSharesEst: estimateQueueAheadShares(state, order),
      payload: order
    });
  }

  incrementQuoteCountSinceFill(state, applied.createdOrders);
  state.currentOrders = applied.currentOrders;
  state.result = rerunCycle(state);
}

function syncLiveOrders(
  state: BootstrappedRuntimeState,
  commands: OrderCommand[],
  createdOrderIds: string[]
): void {
  const cancelOrderIds = commands
    .filter((command): command is Extract<OrderCommand, { type: "cancel" }> => command.type === "cancel")
    .map((command) => command.orderId);
  const cancelledOrderIdSet = new Set(cancelOrderIds);
  const cancelledOrders = state.currentOrders.filter(
    (order): order is ManagedOrder & { id: string } =>
      typeof order.id === "string" && cancelledOrderIdSet.has(order.id)
  );
  const survivingOrders = state.currentOrders.filter(
    (order) => !order.id || !cancelledOrderIdSet.has(order.id)
  );
  const createCommands = commands.filter(
    (command): command is Extract<OrderCommand, { type: "create" }> =>
      command.type === "create"
  );

  if (createCommands.length !== createdOrderIds.length) {
    throw new Error(
      `Live execution returned ${createdOrderIds.length} created orders for ${createCommands.length} create commands`
    );
  }

  const createdOrders = createCommands.map((command, index) => ({
    ...command.order,
    id: createdOrderIds[index]
  }));

  for (const order of cancelledOrders) {
    state.services.recorder.recordManagedOrder(order, "LIVE_CANCELLED");
    state.services.recorder.recordOrderEvent({
      marketId: order.marketId,
      orderId: order.id,
      eventType: "LIVE_CANCELLED",
      logicalSide: order.side,
      price: order.price,
      sizeUsd: order.sizeUsd,
      queueAheadSharesEst: estimateQueueAheadShares(state, order),
      payload: order
    });
  }

  for (const order of createdOrders) {
    state.services.recorder.recordManagedOrder(order, "LIVE_OPEN");
    state.services.recorder.recordOrderEvent({
      marketId: order.marketId,
      orderId: order.id,
      eventType: "LIVE_OPEN",
      logicalSide: order.side,
      price: order.price,
      sizeUsd: order.sizeUsd,
      queueAheadSharesEst: estimateQueueAheadShares(state, order),
      payload: order
    });
  }

  incrementQuoteCountSinceFill(state, createdOrders);
  state.currentOrders = [...survivingOrders, ...createdOrders];
  state.result = rerunCycle(state);
}

async function syncExecutionState(
  state: BootstrappedRuntimeState,
  nextShadowOrderId: () => string,
  liveExecutor?: Pick<PredictLiveExecutor, "syncCommands">
): Promise<void> {
  const commands = state.result.commands;

  if (commands.length === 0) {
    return;
  }

  if (state.mode === "shadow") {
    syncSimulatedShadowOrders(state, nextShadowOrderId);
    return;
  }

  if (state.mode !== "live" || !liveExecutor) {
    return;
  }

  const execution = await liveExecutor.syncCommands(
    commands,
    buildLiveMarketMetadataMap(state.markets)
  );

  syncLiveOrders(
    state,
    commands,
    execution.created.map((order) => order.orderId)
  );
}

async function maybeRefreshPrivateState(
  state: BootstrappedRuntimeState,
  cycleCount: number,
  refreshIntervalCycles: number | undefined
): Promise<void> {
  if (
    state.mode !== "live" ||
    !state.privateState.bearerTokenPresent ||
    !refreshIntervalCycles ||
    refreshIntervalCycles <= 0 ||
    cycleCount === 0 ||
    cycleCount % refreshIntervalCycles !== 0
  ) {
    return;
  }

  await refreshBootstrappedRuntimeState(state);
}

function recordCycleTelemetry(state: BootstrappedRuntimeState): void {
  const aggregateNetInventoryUsd = state.markets.reduce(
    (sum, market) => sum + market.inventoryUsd,
    0
  );
  const flattenPnlPct = state.options.riskInputOverrides?.flattenPnlPct ?? 0;
  const nowMs = Date.now();

  state.services.recorder.recordRiskEvent(
    "portfolio",
    state.result.risk.mode,
    state.result.risk
  );
  state.services.recorder.recordPortfolioSnapshot({
    flattenPnlPct,
    netInventoryUsd: aggregateNetInventoryUsd,
    payload: {
      ...state.result.risk,
      flattenPnlPct,
      aggregateNetInventoryUsd,
      privateState: {
        bearerTokenPresent: state.privateState.bearerTokenPresent,
        accountAddress: state.privateState.account?.address ?? null,
        openOrders: state.privateState.openOrders.length,
        normalizedOpenOrders: state.privateState.normalizedOpenOrders.length,
        positions: state.privateState.positions.length,
        positionMarketIds: state.privateState.positions.map((position) => position.market.id),
        hasUnnormalizedOpenOrders: state.privateState.hasUnnormalizedOpenOrders
      }
    }
  });

  for (const plan of state.result.marketPlans) {
    state.services.recorder.recordMarketStateEvent(
      plan.marketId,
      plan.nextState,
      plan
    );
  }

  for (const market of state.markets) {
    state.services.recorder.recordMarketRegimeSnapshot({
      marketId: market.id,
      currentState: market.currentState,
      minutesToResolution: market.hoursToResolution * 60,
      isBoosted: market.isBoosted,
      volume24hUsd: market.volume24hUsd,
      mid: market.mid,
      spread: market.spread,
      tradeAgeMs:
        market.lastSaleObservedAtMs !== undefined
          ? nowMs - market.lastSaleObservedAtMs
          : market.tradeAgeMs,
      isToxic: market.isToxic,
      payload: {
        bestBid: market.bestBid ?? null,
        bestAsk: market.bestAsk ?? null,
        bidDepth1: market.bidBook?.[0]?.size ?? null,
        askDepth1: market.askBook?.[0]?.size ?? null,
        quoteCountSinceFill: market.quoteCountSinceFill ?? 0
      }
    });
  }
}

function reportRuntimeError(
  onError: ((error: unknown) => void | Promise<void>) | undefined,
  error: unknown
): void {
  if (onError) {
    void onError(error);
    return;
  }

  console.error(error);
}

export async function createRuntimeLoop(
  mode: BootstrappedRuntimeState["mode"],
  config: PredictMmConfig,
  options: RuntimeLoopOptions = {}
): Promise<RuntimeLoop> {
  const state = await bootstrapConfiguredRuntimeState(mode, config, options);
  let cycleCount = 0;
  let subscribedTopics: string[] = [];
  let bootstrapped = false;
  let socket: WebSocket | null = null;
  let shadowOrderSequence = 0;
  let asyncQueue = Promise.resolve();
  const nextShadowOrderId = (): string => {
    shadowOrderSequence += 1;
    return `shadow:${shadowOrderSequence}`;
  };

  const getSnapshot = (): RuntimeLoopSnapshot => ({
    cycleCount,
    markets: state.markets,
    result: state.result,
    subscribedTopics
  });

  const runSerialized = <T>(task: () => Promise<T>): Promise<T> => {
    const nextRun = asyncQueue.then(task, task);
    asyncQueue = nextRun.then(
      () => undefined,
      () => undefined
    );
    return nextRun;
  };

  const handleServerMessage = (
    raw: string | PredictWsServerMessage
  ): RuntimeLoopSnapshot => {
    const message = typeof raw === "string" ? parseServerMessage(raw) : raw;

    if (isHeartbeatEvent(message)) {
      if (message.data !== undefined) {
        state.services.wsClient.respondToHeartbeat(message.data as number | string);
      }

      return getSnapshot();
    }

    if (
      message.topic?.startsWith("predictOrderbook/") &&
      message.data &&
      typeof message.data === "object"
    ) {
      updateMarketFromOrderbook(
        state,
        message.topic,
        message.data as PredictOrderbookData,
        options.nowMs?.() ?? Date.now()
      );
      state.result = rerunCycle(state);
      syncSimulatedShadowOrders(state, nextShadowOrderId);
      applyMarketPlanStates(state);
      recordCycleTelemetry(state);
      cycleCount += 1;
    }

    if (
      message.topic?.startsWith("predictWalletEvents/") &&
      message.data !== undefined
    ) {
      const event = normalizeWalletEvent(
        message.topic,
        message.data,
        buildLiveMarketMetadataMap(state.markets)
      );

      if (event) {
        applyWalletEventToState(state, event);
        state.result = rerunCycle(state);
        applyMarketPlanStates(state);
        recordCycleTelemetry(state);
        cycleCount += 1;
      }
    }

    return getSnapshot();
  };

  const handleServerMessageAsync = async (
    raw: string | PredictWsServerMessage
  ): Promise<RuntimeLoopSnapshot> =>
    runSerialized(async () => {
    const message = typeof raw === "string" ? parseServerMessage(raw) : raw;

    if (isHeartbeatEvent(message)) {
      if (message.data !== undefined) {
        state.services.wsClient.respondToHeartbeat(message.data as number | string);
      }

      return getSnapshot();
    }

    if (
      message.topic?.startsWith("predictOrderbook/") &&
      message.data &&
      typeof message.data === "object"
    ) {
      updateMarketFromOrderbook(
        state,
        message.topic,
        message.data as PredictOrderbookData,
        options.nowMs?.() ?? Date.now()
      );
      state.result = rerunCycle(state);
      await syncExecutionState(state, nextShadowOrderId, options.liveExecutor);
      applyMarketPlanStates(state);
      recordCycleTelemetry(state);
      cycleCount += 1;
    }

    if (
      message.topic?.startsWith("predictWalletEvents/") &&
      message.data !== undefined
    ) {
      const event = normalizeWalletEvent(
        message.topic,
        message.data,
        buildLiveMarketMetadataMap(state.markets)
      );

      if (event) {
        applyWalletEventToState(state, event);
        state.result = rerunCycle(state);
        applyMarketPlanStates(state);
        recordCycleTelemetry(state);
        cycleCount += 1;
      }
    }

    return getSnapshot();
    });

  const runCycleAsync = (): Promise<RuntimeLoopSnapshot> =>
    runSerialized(async () => {
      await maybeRefreshPrivateState(
        state,
        cycleCount,
        options.privateStateRefreshIntervalCycles ?? 3
      );
      state.result = rerunCycle(state);
      await syncExecutionState(state, nextShadowOrderId, options.liveExecutor);
      applyMarketPlanStates(state);
      recordCycleTelemetry(state);
      cycleCount += 1;
      return getSnapshot();
    });

  return {
    async bootstrap(): Promise<RuntimeLoopSnapshot> {
      if (bootstrapped) {
        return getSnapshot();
      }

      socket = state.services.wsClient.connect();

      if (socket) {
        socket.onmessage = (event: MessageEvent): void => {
          if (typeof event.data === "string") {
            void handleServerMessageAsync(event.data).catch((error) => {
              reportRuntimeError(options.onError, error);
            });
          }
        };
      }

      subscribedTopics = buildSubscriptionTopics(state);

      return runSerialized(async () => {
        if (subscribedTopics.length > 0) {
          await state.services.wsClient.subscribe(1, subscribedTopics);
        }

        await syncExecutionState(state, nextShadowOrderId, options.liveExecutor);
        applyMarketPlanStates(state);
        recordCycleTelemetry(state);
        cycleCount = 1;
        bootstrapped = true;
        return getSnapshot();
      });
    },
    handleServerMessage,
    handleServerMessageAsync,
    runCycle(): RuntimeLoopSnapshot {
      state.result = rerunCycle(state);
      syncSimulatedShadowOrders(state, nextShadowOrderId);
      applyMarketPlanStates(state);
      recordCycleTelemetry(state);
      cycleCount += 1;
      return getSnapshot();
    },
    runCycleAsync,
    getSnapshot,
    stop(): void {
      if (socket) {
        socket.onmessage = null;
        socket.close();
        socket = null;
      }
    }
  };
}

export async function startPollingRuntime(
  mode: BootstrappedRuntimeState["mode"],
  config: PredictMmConfig,
  options: PollingRuntimeOptions = {}
): Promise<PollingRuntime> {
  const loop = await createRuntimeLoop(mode, config, options);
  await loop.bootstrap();

  const setTimer = options.setTimer ?? setInterval;
  const clearTimer = options.clearTimer ?? clearInterval;
  let cycleInFlight = false;
  const timer = setTimer(() => {
    if (cycleInFlight) {
      return;
    }

    cycleInFlight = true;
    void loop
      .runCycleAsync()
      .then((snapshot) => options.onCycle?.(snapshot))
      .catch((error) => reportRuntimeError(options.onError, error))
      .finally(() => {
        cycleInFlight = false;
      });
  }, options.intervalMs ?? 5000);

  return {
    loop,
    stop(): void {
      clearTimer(timer);
      loop.stop();
    }
  };
}
