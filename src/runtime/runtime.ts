import type { DatabaseSync } from "node:sqlite";

import {
  getJwtTokenFromAuthFlow,
  PredictAuthClient,
  type PredictAuthSigner
} from "../clients/auth-client";
import {
  PredictRestClient,
  type PredictAccountData,
  type PredictLastSaleData,
  type PredictMarket,
  type PredictOrderData,
  type PredictOrderbookData,
  type PredictPositionData
} from "../clients/rest-client";
import { PredictWsClient } from "../clients/ws-client";
import { buildEmergencyFlattenOrders } from "../execution/emergency-flatten";
import {
  resolvePrimaryOutcomeTokenId,
  type PredictSdkMarketMetadata
} from "../execution/predict-sdk";
import {
  buildOrderCommands,
  type ManagedOrder,
  type ManagedOrderSide,
  type OrderCommand
} from "../execution/order-manager";
import { diffOrders, type DiffOrdersResult } from "../execution/reconciler";
import type { PredictMmConfig } from "../types";
import { MarketRecorder } from "../recorder/market-recorder";
import { openAnalyticsStore } from "../storage/sqlite";
import { evaluateRiskMode, type EvaluateRiskInput, type RiskEvaluation } from "../risk/risk-controller";
import { selectActiveMarkets } from "../strategy/market-selector";
import { buildQuotes, type QuotePlan } from "../strategy/quote-engine";
import { nextMarketState, type MarketState } from "../strategy/state-machine";
import type { MarketCandidate } from "../strategy/market-filter";

export type RuntimeMode = "paper" | "shadow" | "live";

export type ExecutionPolicy = {
  mode: RuntimeMode;
  placeOrders: boolean;
  recordIntendedOrders: boolean;
  runRecorder: boolean;
  runStrategy: boolean;
  runRisk: boolean;
  runExecution: boolean;
};

export type RuntimeDescriptor = {
  mode: RuntimeMode;
  policy: ExecutionPolicy;
  services: string[];
};

export type RuntimeMarketInput = MarketCandidate & {
  currentState: MarketState;
  inventoryUsd: number;
  maxInventoryUsd: number;
  tickSize: number;
  oneSidedFill: boolean;
  bestBid?: number | null;
  bestAsk?: number | null;
  tokenId?: string;
  feeRateBps?: number;
  isNegRisk?: boolean;
  isYieldBearing?: boolean;
  lastFillMid?: number;
  lastFillSide?: ManagedOrderSide;
  toxicUntilMs?: number;
};

export type RuntimeMarketPlan = {
  marketId: number;
  selectedMode: "Score" | "Defend";
  nextState: MarketState;
  quotes: QuotePlan | null;
};

export type RuntimeCycleInput = {
  mode: RuntimeMode;
  markets: RuntimeMarketInput[];
  currentOrders: ManagedOrder[];
  riskInput: EvaluateRiskInput;
  quoteBudgetUsd?: number;
  suppressCreates?: boolean;
  extraCancelOrderIds?: string[];
  privateState?: RuntimePrivateState;
};

export type RuntimeCycleResult = {
  mode: RuntimeMode;
  policy: ExecutionPolicy;
  risk: RiskEvaluation;
  marketPlans: RuntimeMarketPlan[];
  orderDiff: DiffOrdersResult;
  commands: OrderCommand[];
  privateState?: RuntimePrivateState;
};

type RuntimeRestClient = Pick<
  PredictRestClient,
  "getMarkets" | "getMarketOrderbook" | "getMarketLastSale" | "getOrders" | "getPositions" | "getAccount"
>;

type RuntimeWsClient = Pick<PredictWsClient, "connect" | "subscribe" | "respondToHeartbeat">;

type RuntimeAuthClient = Pick<PredictAuthClient, "getAuthMessage" | "authenticate">;

export type RuntimeServices = {
  config: PredictMmConfig;
  policy: ExecutionPolicy;
  database: DatabaseSync;
  restClient: RuntimeRestClient;
  authClient: RuntimeAuthClient;
  wsClient: RuntimeWsClient;
  recorder: MarketRecorder;
};

export type BootstrappedRuntimeState = {
  mode: RuntimeMode;
  config: PredictMmConfig;
  bearerToken?: string;
  services: RuntimeServices;
  options: RunConfiguredRuntimeOptions;
  markets: RuntimeMarketInput[];
  currentOrders: ManagedOrder[];
  privateState: RuntimePrivateState;
  suppressCreates: boolean;
  result: RuntimeCycleResult;
};

export type RuntimePrivateState = {
  bearerTokenPresent: boolean;
  account: PredictAccountData | null;
  openOrders: PredictOrderData[];
  normalizedOpenOrders: ManagedOrder[];
  positions: PredictPositionData[];
  inventoryByMarket: Record<number, number>;
  hasUnnormalizedOpenOrders: boolean;
};

export type RuntimeServiceDependencies = {
  database?: DatabaseSync;
  restClient?: Partial<RuntimeRestClient>;
  authClient?: Partial<RuntimeAuthClient>;
  wsClient?: Partial<RuntimeWsClient>;
  recorder?: MarketRecorder;
};

export type RunConfiguredRuntimeOptions = RuntimeServiceDependencies & {
  first?: number;
  defaultHoursToResolution?: number;
  hoursToResolutionResolver?: (market: PredictMarket) => number;
  inventoryByMarket?: Record<number, number>;
  stateByMarket?: Partial<Record<number, MarketState>>;
  fillByMarket?: Record<number, boolean>;
  bestBidByMarket?: Record<number, number | null>;
  bestAskByMarket?: Record<number, number | null>;
  currentOrders?: ManagedOrder[];
  minutesToExit?: number;
  quoteBudgetUsd?: number;
  aggregateNetInventoryCapUsd?: number;
  maxInventoryUsd?: number;
  riskInputOverrides?: Partial<EvaluateRiskInput>;
  bearerToken?: string;
  authSigner?: PredictAuthSigner;
};

export function getExecutionPolicy(mode: RuntimeMode): ExecutionPolicy {
  switch (mode) {
    case "paper":
      return {
        mode,
        placeOrders: false,
        recordIntendedOrders: false,
        runRecorder: true,
        runStrategy: true,
        runRisk: true,
        runExecution: false
      };
    case "shadow":
      return {
        mode,
        placeOrders: false,
        recordIntendedOrders: true,
        runRecorder: true,
        runStrategy: true,
        runRisk: true,
        runExecution: true
      };
    case "live":
      return {
        mode,
        placeOrders: true,
        recordIntendedOrders: true,
        runRecorder: true,
        runStrategy: true,
        runRisk: true,
        runExecution: true
      };
  }
}

export function startRuntime(mode: RuntimeMode): RuntimeDescriptor {
  return {
    mode,
    policy: getExecutionPolicy(mode),
    services: ["recorder", "strategy", "risk", "execution"]
  };
}

export function buildLiveMarketMetadataMap(
  markets: RuntimeMarketInput[]
): Record<number, PredictSdkMarketMetadata> {
  return markets.reduce<Record<number, PredictSdkMarketMetadata>>((accumulator, market) => {
    if (
      !market.tokenId ||
      market.feeRateBps === undefined ||
      market.isNegRisk === undefined ||
      market.isYieldBearing === undefined
    ) {
      return accumulator;
    }

    accumulator[market.id] = {
      marketId: market.id,
      tokenId: market.tokenId,
      feeRateBps: market.feeRateBps,
      isNegRisk: market.isNegRisk,
      isYieldBearing: market.isYieldBearing
    };

    return accumulator;
  }, {});
}

function parseUsd(value: string): number {
  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : 0;
}

function parseWeiDecimal(value: string, decimals = 18): number {
  const isNegative = value.startsWith("-");
  const digits = isNegative ? value.slice(1) : value;
  const padded = digits.padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  const normalized = fraction.length > 0 ? `${whole}.${fraction}` : whole;
  const parsed = Number(`${isNegative ? "-" : ""}${normalized}`);

  return Number.isFinite(parsed) ? parsed : 0;
}

export function normalizeOpenOrder(order: PredictOrderData): ManagedOrder | null {
  const remainingAmountWei = BigInt(order.amount) - BigInt(order.amountFilled);

  if (remainingAmountWei <= 0n) {
    return null;
  }

  const isBid = order.order.side === 0;
  const makerAmount = parseWeiDecimal(order.order.makerAmount);
  const takerAmount = parseWeiDecimal(order.order.takerAmount);
  const price = isBid ? makerAmount / takerAmount : takerAmount / makerAmount;

  if (!Number.isFinite(price) || price <= 0) {
    return null;
  }

  const remainingAmount = parseWeiDecimal(remainingAmountWei.toString());
  const sizeUsd = Number((remainingAmount * price).toFixed(6));

  if (!Number.isFinite(sizeUsd) || sizeUsd <= 0) {
    return null;
  }

  return {
    id: order.id,
    marketId: order.marketId,
    side: isBid ? "bid" : "ask",
    price: Number(price.toFixed(6)),
    sizeUsd
  };
}

function getSignedPositionValueUsd(position: PredictPositionData): number {
  const valueUsd = parseUsd(position.valueUsd);
  const outcomeName = position.outcome.name.trim().toLowerCase();

  return outcomeName === "no" ? -valueUsd : valueUsd;
}

async function loadPrivateState(
  services: RuntimeServices,
  bearerToken: string | undefined
): Promise<RuntimePrivateState> {
  if (!bearerToken) {
    return {
      bearerTokenPresent: false,
      account: null,
      openOrders: [],
      normalizedOpenOrders: [],
      positions: [],
      inventoryByMarket: {},
      hasUnnormalizedOpenOrders: false
    };
  }

  const [accountResponse, ordersResponse, positionsResponse] = await Promise.all([
    services.restClient.getAccount(bearerToken),
    services.restClient.getOrders(bearerToken, { status: "OPEN" }),
    services.restClient.getPositions(bearerToken)
  ]);

  const inventoryByMarket = positionsResponse.data.reduce<Record<number, number>>(
    (accumulator, position) => {
      const marketId = position.market.id;
      accumulator[marketId] = (accumulator[marketId] ?? 0) + getSignedPositionValueUsd(position);
      return accumulator;
    },
    {}
  );
  const normalizedOpenOrders = ordersResponse.data
    .map(normalizeOpenOrder)
    .filter((order): order is ManagedOrder => order !== null);

  return {
    bearerTokenPresent: true,
    account: accountResponse.data,
    openOrders: ordersResponse.data,
    normalizedOpenOrders,
    positions: positionsResponse.data,
    inventoryByMarket,
    hasUnnormalizedOpenOrders: ordersResponse.data.length !== normalizedOpenOrders.length
  };
}

async function resolveBearerToken(
  services: RuntimeServices,
  config: PredictMmConfig,
  options: RunConfiguredRuntimeOptions
): Promise<string | undefined> {
  if (options.bearerToken) {
    return options.bearerToken;
  }

  if (config.bearerToken) {
    return config.bearerToken;
  }

  if (options.authSigner) {
    return getJwtTokenFromAuthFlow(services.authClient, options.authSigner);
  }

  return undefined;
}

function getTickSize(decimalPrecision: number): number {
  return 1 / 10 ** decimalPrecision;
}

function getMidPrice(orderbook: PredictOrderbookData): number {
  const bestBid = typeof orderbook.bids[0]?.[0] === "number" ? orderbook.bids[0][0] : null;
  const bestAsk = typeof orderbook.asks[0]?.[0] === "number" ? orderbook.asks[0][0] : null;

  if (bestBid === null && bestAsk === null) {
    return 0.5;
  }

  if (bestBid === null) {
    return bestAsk as number;
  }

  if (bestAsk === null) {
    return bestBid;
  }

  return (bestBid + bestAsk) / 2;
}

function getSpread(orderbook: PredictOrderbookData): number {
  const bestBid = typeof orderbook.bids[0]?.[0] === "number" ? orderbook.bids[0][0] : null;
  const bestAsk = typeof orderbook.asks[0]?.[0] === "number" ? orderbook.asks[0][0] : null;

  if (bestBid === null || bestAsk === null) {
    return 1;
  }

  return bestAsk - bestBid;
}

function hasTwoSidedBook(orderbook: PredictOrderbookData): boolean {
  return orderbook.bids.length > 0 && orderbook.asks.length > 0;
}

function resolveHoursToResolution(
  market: PredictMarket,
  options: RunConfiguredRuntimeOptions
): number {
  if (options.hoursToResolutionResolver) {
    return options.hoursToResolutionResolver(market);
  }

  return options.defaultHoursToResolution ?? 999;
}

export function createRuntimeServices(
  mode: RuntimeMode,
  config: PredictMmConfig,
  dependencies: RuntimeServiceDependencies = {}
): RuntimeServices {
  const policy = getExecutionPolicy(mode);
  const database = dependencies.database ?? openAnalyticsStore(config.dbPath);
  const baseRestClient = new PredictRestClient(config);
  const baseAuthClient = new PredictAuthClient(config);
  const baseWsClient = new PredictWsClient(config.wsUrl);
  const restClient: RuntimeRestClient = {
    getMarkets: dependencies.restClient?.getMarkets?.bind(dependencies.restClient) ?? baseRestClient.getMarkets.bind(baseRestClient),
    getMarketOrderbook:
      dependencies.restClient?.getMarketOrderbook?.bind(dependencies.restClient) ?? baseRestClient.getMarketOrderbook.bind(baseRestClient),
    getMarketLastSale:
      dependencies.restClient?.getMarketLastSale?.bind(dependencies.restClient) ?? baseRestClient.getMarketLastSale.bind(baseRestClient),
    getOrders: dependencies.restClient?.getOrders?.bind(dependencies.restClient) ?? baseRestClient.getOrders.bind(baseRestClient),
    getPositions:
      dependencies.restClient?.getPositions?.bind(dependencies.restClient) ?? baseRestClient.getPositions.bind(baseRestClient),
    getAccount: dependencies.restClient?.getAccount?.bind(dependencies.restClient) ?? baseRestClient.getAccount.bind(baseRestClient)
  };
  const authClient: RuntimeAuthClient = {
    getAuthMessage:
      dependencies.authClient?.getAuthMessage?.bind(dependencies.authClient) ?? baseAuthClient.getAuthMessage.bind(baseAuthClient),
    authenticate:
      dependencies.authClient?.authenticate?.bind(dependencies.authClient) ?? baseAuthClient.authenticate.bind(baseAuthClient)
  };
  const wsClient: RuntimeWsClient = {
    connect: dependencies.wsClient?.connect?.bind(dependencies.wsClient) ?? baseWsClient.connect.bind(baseWsClient),
    subscribe:
      dependencies.wsClient?.subscribe?.bind(dependencies.wsClient) ?? baseWsClient.subscribe.bind(baseWsClient),
    respondToHeartbeat:
      dependencies.wsClient?.respondToHeartbeat?.bind(dependencies.wsClient) ?? baseWsClient.respondToHeartbeat.bind(baseWsClient)
  };
  const recorder = dependencies.recorder ?? new MarketRecorder(database);

  return {
    config,
    policy,
    database,
    restClient,
    authClient,
    wsClient,
    recorder
  };
}

async function loadRuntimeMarkets(
  services: RuntimeServices,
  options: RunConfiguredRuntimeOptions
): Promise<RuntimeMarketInput[]> {
  const marketsResponse = await services.restClient.getMarkets({
    first: options.first ?? 20,
    status: "OPEN",
    includeStats: true,
    sort: "VOLUME_24H_DESC"
  });

  return Promise.all(
    marketsResponse.data.map(async (market) => {
      services.recorder.recordMarketSnapshot(market);

      const orderbookResponse = await services.restClient.getMarketOrderbook(market.id);
      const normalizedOrderbook = services.recorder.recordOrderbookEvent(
        `predictOrderbook/${market.id}`,
        orderbookResponse.data
      );
      const lastSaleResponse = await services.restClient.getMarketLastSale(market.id);

      if (lastSaleResponse.data) {
        services.recorder.recordLastSaleEvent(
          market.id,
          lastSaleResponse.data as Exclude<PredictLastSaleData, null>
        );
      }

      return {
        id: market.id,
        hoursToResolution: resolveHoursToResolution(market, options),
        mid: getMidPrice(orderbookResponse.data),
        spread: getSpread(orderbookResponse.data),
        spreadThreshold: market.spreadThreshold,
        hasTwoSidedBook: hasTwoSidedBook(orderbookResponse.data),
        volume24hUsd: market.stats?.volume24hUsd ?? 0,
        isBoosted: market.isBoosted,
        isVisible: market.isVisible,
        tradingStatus: market.tradingStatus,
        marketVariant: market.marketVariant,
        isToxic: false,
        currentState: options.stateByMarket?.[market.id] ?? "Observe",
        inventoryUsd: options.inventoryByMarket?.[market.id] ?? 0,
        maxInventoryUsd: options.maxInventoryUsd ?? 15,
        tickSize: getTickSize(market.decimalPrecision),
        oneSidedFill: options.fillByMarket?.[market.id] ?? false,
        bestBid: options.bestBidByMarket?.[market.id] ?? normalizedOrderbook.bestBid,
        bestAsk: options.bestAskByMarket?.[market.id] ?? normalizedOrderbook.bestAsk,
        tokenId: market.outcomes.length > 0
          ? resolvePrimaryOutcomeTokenId(market.outcomes)
          : undefined,
        feeRateBps: market.feeRateBps,
        isNegRisk: market.isNegRisk,
        isYieldBearing: market.isYieldBearing
      } satisfies RuntimeMarketInput;
    })
  );
}

export async function runConfiguredRuntimeOnce(
  mode: RuntimeMode,
  config: PredictMmConfig,
  options: RunConfiguredRuntimeOptions = {}
): Promise<RuntimeCycleResult> {
  const state = await bootstrapConfiguredRuntimeState(mode, config, options);

  return state.result;
}

function buildCycleInputFromState(state: Omit<BootstrappedRuntimeState, "result">): RuntimeCycleInput {
  const aggregateNetInventoryUsd = state.markets.reduce(
    (sum, market) => sum + market.inventoryUsd,
    0
  );

  return {
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
  };
}

export async function bootstrapConfiguredRuntimeState(
  mode: RuntimeMode,
  config: PredictMmConfig,
  options: RunConfiguredRuntimeOptions = {}
): Promise<BootstrappedRuntimeState> {
  const services = createRuntimeServices(mode, config, options);
  const bearerToken = await resolveBearerToken(services, config, options);
  const privateState = await loadPrivateState(services, bearerToken);
  const markets = (await loadRuntimeMarkets(services, options)).map((market) => ({
    ...market,
    inventoryUsd: options.inventoryByMarket?.[market.id] ?? privateState.inventoryByMarket[market.id] ?? market.inventoryUsd
  }));
  const stateBase = {
    mode,
    config,
    bearerToken,
    services,
    options,
    markets,
    currentOrders: options.currentOrders ?? privateState.normalizedOpenOrders,
    privateState,
    suppressCreates:
      options.currentOrders === undefined && privateState.hasUnnormalizedOpenOrders
  };

  return {
    ...stateBase,
    result: runRuntimeCycle(buildCycleInputFromState(stateBase))
  };
}

export async function refreshBootstrappedRuntimeState(
  state: BootstrappedRuntimeState
): Promise<void> {
  const bearerToken = await resolveBearerToken(
    state.services,
    state.config,
    state.options
  );
  const privateState = await loadPrivateState(state.services, bearerToken);

  state.privateState = privateState;
  state.suppressCreates =
    state.options.currentOrders === undefined && privateState.hasUnnormalizedOpenOrders;
  if (
    state.options.currentOrders === undefined &&
    !privateState.hasUnnormalizedOpenOrders
  ) {
    state.currentOrders = privateState.normalizedOpenOrders;
  }
  state.markets = state.markets.map((market) => ({
    ...market,
    inventoryUsd:
      state.options.inventoryByMarket?.[market.id] ??
      privateState.inventoryByMarket[market.id] ??
      market.inventoryUsd
  }));
}

function shouldEmergencyFlatten(risk: RiskEvaluation): boolean {
  return risk.forceFlatten || risk.mode === "HardStop" || risk.mode === "Catastrophic";
}

function buildQuoteOrders(
  market: RuntimeMarketInput,
  nextState: MarketState,
  aggregateNetInventoryUsd: number | undefined,
  aggregateNetInventoryCapUsd: number | undefined,
  quoteBudgetUsd: number | undefined
): ManagedOrder[] {
  if (nextState !== "Score" && nextState !== "Defend") {
    return [];
  }

  const quotes = buildQuotes({
    mode: nextState,
    fairValue: market.mid,
    inventoryUsd: market.inventoryUsd,
    maxInventoryUsd: market.maxInventoryUsd,
    tickSize: market.tickSize,
    aggregateNetInventoryUsd,
    aggregateNetInventoryCapUsd,
    quoteBudgetUsd
  });

  if (!quotes.canQuote || quotes.sizeUsd <= 0) {
    return [];
  }

  return [
    {
      marketId: market.id,
      side: "bid",
      price: quotes.bid,
      sizeUsd: quotes.sizeUsd
    },
    {
      marketId: market.id,
      side: "ask",
      price: quotes.ask,
      sizeUsd: quotes.sizeUsd
    }
  ];
}

export function runRuntimeCycle(input: RuntimeCycleInput): RuntimeCycleResult {
  const policy = getExecutionPolicy(input.mode);
  const risk = evaluateRiskMode(input.riskInput);
  const aggregateNetInventoryUsd = input.riskInput.aggregateNetInventoryUsd;
  const aggregateNetInventoryCapUsd = input.riskInput.aggregateNetInventoryCapUsd;

  if (shouldEmergencyFlatten(risk)) {
    const targetOrders = buildEmergencyFlattenOrders(
      input.markets.map((market) => ({
        marketId: market.id,
        inventoryUsd: market.inventoryUsd,
        bestBid: market.bestBid ?? null,
        bestAsk: market.bestAsk ?? null
      }))
    );
    const orderDiff = diffOrders({
      current: input.currentOrders,
      target: targetOrders
    });

    return {
      mode: input.mode,
      policy,
      risk,
      marketPlans: input.markets.map((market) => ({
        marketId: market.id,
        selectedMode: "Defend",
        nextState: "Exit",
        quotes: null
      })),
      orderDiff,
      commands: [
        ...buildOrderCommands(orderDiff),
        ...[...(input.extraCancelOrderIds ?? [])]
          .filter((orderId) => !orderDiff.cancel.some((order) => order.id === orderId))
          .map((orderId) => ({
            type: "cancel" as const,
            orderId
          }))
      ],
      privateState: input.privateState
    };
  }

  const selection = selectActiveMarkets(input.markets);
  const selectedById = new Map(selection.active.map((market) => [market.id, market]));
  const marketPlans: RuntimeMarketPlan[] = [];
  const targetOrders: ManagedOrder[] = [];

  for (const selectedMarket of selection.active) {
    const market = input.markets.find((candidate) => candidate.id === selectedMarket.id);

    if (!market) {
      continue;
    }

    let nextState: MarketState;

    if (market.currentState === "Observe") {
      nextState = risk.mode === "SoftStop" ? "Observe" : selectedMarket.targetMode;
    } else {
      nextState = nextMarketState(market.currentState, {
        oneSidedFill: market.oneSidedFill,
        isToxic: market.isToxic,
        inventoryUsd: market.inventoryUsd,
        maxInventoryUsd: market.maxInventoryUsd,
        minutesToExit: input.riskInput.minutesToExit ?? Number.POSITIVE_INFINITY,
        riskMode: risk.mode,
        isEligible: selectedById.has(market.id)
      });
    }

    const quotes = nextState === "Score" || nextState === "Defend"
      ? buildQuotes({
          mode: nextState,
          fairValue: market.mid,
          inventoryUsd: market.inventoryUsd,
          maxInventoryUsd: market.maxInventoryUsd,
          tickSize: market.tickSize,
          aggregateNetInventoryUsd,
          aggregateNetInventoryCapUsd,
          quoteBudgetUsd: input.quoteBudgetUsd
        })
      : null;

    marketPlans.push({
      marketId: market.id,
      selectedMode: selectedMarket.targetMode,
      nextState,
      quotes
    });

    targetOrders.push(
      ...buildQuoteOrders(
        market,
        nextState,
        aggregateNetInventoryUsd,
        aggregateNetInventoryCapUsd,
        input.quoteBudgetUsd
      )
    );
  }

  const rawOrderDiff = diffOrders({
    current: input.currentOrders,
    target: targetOrders
  });
  const orderDiff: DiffOrdersResult = input.suppressCreates
    ? {
        ...rawOrderDiff,
        create: []
      }
    : rawOrderDiff;

  return {
    mode: input.mode,
    policy,
    risk,
    marketPlans,
    orderDiff,
    commands: buildOrderCommands(orderDiff),
    privateState: input.privateState
  };
}
