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
  normalizePredictOrderSideAndPrice,
  resolveOutcomeTokenIds,
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
import { EventArchive } from "../recorder/event-archive";
import type { NormalizedBookLevel } from "../recorder/normalizers";
import { openAnalyticsStore } from "../storage/sqlite";
import { evaluateRiskMode, type EvaluateRiskInput, type RiskEvaluation } from "../risk/risk-controller";
import { selectActiveMarkets } from "../strategy/market-selector";
import { buildQuotes, type QuoteMode, type QuotePlan } from "../strategy/quote-engine";
import { nextMarketState, type MarketState } from "../strategy/state-machine";
import {
  resolveRuntimeWhitelistEntry,
  type MarketCandidate,
  type MarketHealth
} from "../strategy/market-filter";

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
  quoteCountSinceFill?: number;
  marketTradeRatePerMinute?: number;
  touchMoveRatePerMinute?: number;
  oneSidedRatio?: number;
  lastQuoteUpdateAtMs?: number;
  marketHealth?: MarketHealth;
  bestBid?: number | null;
  bestAsk?: number | null;
  tokenId?: string;
  complementaryTokenId?: string;
  feeRateBps?: number;
  isNegRisk?: boolean;
  isYieldBearing?: boolean;
  lastFillMid?: number;
  lastFillSide?: ManagedOrderSide;
  toxicUntilMs?: number;
  lastSalePrice?: number | null;
  lastSaleObservedAtMs?: number;
  lastSaleQuoteType?: string | null;
  lastSaleOutcome?: string | null;
  lastSaleStrategy?: string | null;
  tradeAgeMs?: number;
  bidBook?: NormalizedBookLevel[];
  askBook?: NormalizedBookLevel[];
};

export type RuntimeMarketPlan = {
  marketId: number;
  selectedMode: "Quote" | "Protect";
  nextState: MarketState;
  quotes: QuotePlan | null;
};

export type RuntimeCycleInput = {
  mode: RuntimeMode;
  markets: RuntimeMarketInput[];
  currentOrders: ManagedOrder[];
  riskInput: EvaluateRiskInput;
  nowMs?: number;
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

type RuntimeWsClient = {
  connect: PredictWsClient["connect"];
  subscribe: (requestId: number, topics: string[]) => void | Promise<void>;
  respondToHeartbeat: PredictWsClient["respondToHeartbeat"];
};

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
      !market.complementaryTokenId ||
      market.feeRateBps === undefined ||
      market.isNegRisk === undefined ||
      market.isYieldBearing === undefined
    ) {
      return accumulator;
    }

    accumulator[market.id] = {
      marketId: market.id,
      tokenId: market.tokenId,
      complementaryTokenId: market.complementaryTokenId,
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

function parseOptionalNumber(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : null;
}

function roundMetric(value: number): number {
  return Number(value.toFixed(12));
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

export function normalizeOpenOrder(
  order: PredictOrderData,
  marketsById?: Record<number, PredictSdkMarketMetadata>
): ManagedOrder | null {
  const remainingAmountWei = BigInt(order.amount) - BigInt(order.amountFilled);

  if (remainingAmountWei <= 0n) {
    return null;
  }

  const isBid = order.order.side === 0;
  const makerAmount = parseWeiDecimal(order.order.makerAmount);
  const takerAmount = parseWeiDecimal(order.order.takerAmount);
  const executionPrice = isBid ? makerAmount / takerAmount : takerAmount / makerAmount;
  const normalized = normalizePredictOrderSideAndPrice({
    tokenId: order.order.tokenId,
    orderSide: order.order.side,
    price: executionPrice,
    market: marketsById?.[order.marketId]
  });

  if (!Number.isFinite(normalized.price) || normalized.price <= 0) {
    return null;
  }

  const remainingAmount = parseWeiDecimal(remainingAmountWei.toString());
  const sizeUsd = Number((remainingAmount * normalized.price).toFixed(6));

  if (!Number.isFinite(sizeUsd) || sizeUsd <= 0) {
    return null;
  }

  return {
    id: order.id,
    marketId: order.marketId,
    side: normalized.side,
    price: normalized.price,
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
  bearerToken: string | undefined,
  marketsById?: Record<number, PredictSdkMarketMetadata>
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
    .map((order) => normalizeOpenOrder(order, marketsById))
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

  return roundMetric((bestBid + bestAsk) / 2);
}

function getSpread(orderbook: PredictOrderbookData): number {
  const bestBid = typeof orderbook.bids[0]?.[0] === "number" ? orderbook.bids[0][0] : null;
  const bestAsk = typeof orderbook.asks[0]?.[0] === "number" ? orderbook.asks[0][0] : null;

  if (bestBid === null || bestAsk === null) {
    return 1;
  }

  return roundMetric(bestAsk - bestBid);
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
  const recorder = dependencies.recorder ?? new MarketRecorder(database, {
    archive: config.archiveDir ? new EventArchive(config.archiveDir) : undefined
  });

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
      const whitelistEntry = resolveRuntimeWhitelistEntry(market.id);
      services.recorder.recordMarketSnapshot(market);

      const orderbookResponse = await services.restClient.getMarketOrderbook(market.id);
      const normalizedOrderbook = services.recorder.recordOrderbookEvent(
        `predictOrderbook/${market.id}`,
        orderbookResponse.data
      );
      const lastSaleResponse = await services.restClient.getMarketLastSale(market.id);
      const lastSaleObservedAtMs = lastSaleResponse.data ? Date.now() : undefined;
      const lastSalePrice = lastSaleResponse.data
        ? parseOptionalNumber(lastSaleResponse.data.priceInCurrency)
        : null;

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
        marketPool: whitelistEntry?.marketPool ?? "other",
        whitelistTier: whitelistEntry?.whitelistTier,
        isToxic: false,
        currentState: options.stateByMarket?.[market.id] ?? "Observe",
        inventoryUsd: options.inventoryByMarket?.[market.id] ?? 0,
        maxInventoryUsd: options.maxInventoryUsd ?? 15,
        tickSize: getTickSize(market.decimalPrecision),
        oneSidedFill: options.fillByMarket?.[market.id] ?? false,
        quoteCountSinceFill: 0,
        marketTradeRatePerMinute: 0,
        touchMoveRatePerMinute: 0,
        oneSidedRatio: hasTwoSidedBook(orderbookResponse.data) ? 0 : 1,
        lastQuoteUpdateAtMs: undefined,
        marketHealth: "active-risky",
        bestBid: options.bestBidByMarket?.[market.id] ?? normalizedOrderbook.bestBid,
        bestAsk: options.bestAskByMarket?.[market.id] ?? normalizedOrderbook.bestAsk,
        bidBook: normalizedOrderbook.bids,
        askBook: normalizedOrderbook.asks,
        lastSalePrice,
        lastSaleObservedAtMs,
        lastSaleQuoteType: lastSaleResponse.data?.quoteType ?? null,
        lastSaleOutcome: lastSaleResponse.data?.outcome ?? null,
        lastSaleStrategy: lastSaleResponse.data?.strategy ?? null,
        tradeAgeMs:
          lastSaleObservedAtMs !== undefined ? Date.now() - lastSaleObservedAtMs : undefined,
        ...(market.outcomes.length > 0 ? resolveOutcomeTokenIds(market.outcomes) : {}),
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
    nowMs: Date.now(),
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
  const markets = await loadRuntimeMarkets(services, options);
  const privateState = await loadPrivateState(
    services,
    bearerToken,
    buildLiveMarketMetadataMap(markets)
  );
  const marketsWithInventory = markets.map((market) => ({
    ...market,
    inventoryUsd: options.inventoryByMarket?.[market.id] ?? privateState.inventoryByMarket[market.id] ?? market.inventoryUsd
  }));
  const stateBase = {
    mode,
    config,
    bearerToken,
    services,
    options,
    markets: marketsWithInventory,
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
  const privateState = await loadPrivateState(
    state.services,
    bearerToken,
    buildLiveMarketMetadataMap(state.markets)
  );

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

const HIGH_QUOTE_CHURN_THRESHOLD = 6;
const PAUSE_QUOTE_CHURN_THRESHOLD = 12;
const ACTIVE_MARKET_TRADE_RATE_THRESHOLD = 0.2;
const ACTIVE_TOUCH_RATE_THRESHOLD = 0.5;
const THROTTLE_MIN_REFRESH_INTERVAL_MS = 30_000;

function isMarketActiveForChurn(market: RuntimeMarketInput): boolean {
  return (
    (market.marketTradeRatePerMinute ?? 0) >= ACTIVE_MARKET_TRADE_RATE_THRESHOLD ||
    (market.touchMoveRatePerMinute ?? 0) >= ACTIVE_TOUCH_RATE_THRESHOLD
  );
}

function hasHighQuoteToFillRatio(market: RuntimeMarketInput): boolean {
  return (
    (market.quoteCountSinceFill ?? 0) >= HIGH_QUOTE_CHURN_THRESHOLD &&
    isMarketActiveForChurn(market)
  );
}

function shouldPauseMarket(market: RuntimeMarketInput): boolean {
  return (
    (market.quoteCountSinceFill ?? 0) >= PAUSE_QUOTE_CHURN_THRESHOLD &&
    isMarketActiveForChurn(market)
  );
}

function resolveQuoteMode(state: MarketState): QuoteMode | null {
  switch (state) {
    case "Quote":
    case "Throttle":
    case "Protect":
      return state;
    case "Score":
      return "Quote";
    case "Defend":
      return "Protect";
    default:
      return null;
  }
}

function shouldPreserveThrottleQuotes(
  market: RuntimeMarketInput,
  nextState: MarketState,
  nowMs: number
): boolean {
  return (
    nextState === "Throttle" &&
    market.lastQuoteUpdateAtMs !== undefined &&
    nowMs - market.lastQuoteUpdateAtMs < THROTTLE_MIN_REFRESH_INTERVAL_MS
  );
}

function getCurrentMarketOrders(
  currentOrders: ManagedOrder[],
  marketId: number
): ManagedOrder[] {
  return currentOrders.filter((order) => order.marketId === marketId);
}

function buildQuoteOrders(
  market: RuntimeMarketInput,
  nextState: MarketState,
  currentOrders: ManagedOrder[],
  nowMs: number,
  aggregateNetInventoryUsd: number | undefined,
  aggregateNetInventoryCapUsd: number | undefined,
  quoteBudgetUsd: number | undefined
): ManagedOrder[] {
  if (shouldPreserveThrottleQuotes(market, nextState, nowMs)) {
    return getCurrentMarketOrders(currentOrders, market.id);
  }

  const mode = resolveQuoteMode(nextState);

  if (mode === null) {
    return [];
  }

  const quotes = buildQuotes({
    mode,
    fairValue: market.mid,
    inventoryUsd: market.inventoryUsd,
    maxInventoryUsd: market.maxInventoryUsd,
    tickSize: market.tickSize,
    bestBid: market.bestBid,
    bestAsk: market.bestAsk,
    aggregateNetInventoryUsd,
    aggregateNetInventoryCapUsd,
    quoteBudgetUsd
  });

  if (!quotes.canQuote || (quotes.bidSizeUsd <= 0 && quotes.askSizeUsd <= 0)) {
    return [];
  }

  const orders: ManagedOrder[] = [];

  if (quotes.bidSizeUsd > 0) {
    orders.push({
      marketId: market.id,
      side: "bid",
      price: quotes.bid,
      sizeUsd: quotes.bidSizeUsd
    });
  }

  if (quotes.askSizeUsd > 0) {
    orders.push({
      marketId: market.id,
      side: "ask",
      price: quotes.ask,
      sizeUsd: quotes.askSizeUsd
    });
  }

  return orders;
}

export function runRuntimeCycle(input: RuntimeCycleInput): RuntimeCycleResult {
  const policy = getExecutionPolicy(input.mode);
  const risk = evaluateRiskMode(input.riskInput);
  const nowMs = input.nowMs ?? Date.now();
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
        selectedMode: "Protect",
        nextState: "Stop",
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
        hasOneSidedBook: !market.hasTwoSidedBook,
        quoteToFillRatioHigh: hasHighQuoteToFillRatio(market),
        shouldPause: shouldPauseMarket(market),
        isToxic: market.isToxic,
        inventoryUsd: market.inventoryUsd,
        maxInventoryUsd: market.maxInventoryUsd,
        minutesToExit: input.riskInput.minutesToExit ?? Number.POSITIVE_INFINITY,
        riskMode: risk.mode,
        isEligible:
          selectedById.has(market.id) &&
          market.marketHealth !== "inactive-or-toxic"
      });
    }

    const quoteMode = resolveQuoteMode(nextState);
    const quotes = quoteMode !== null
      ? buildQuotes({
          mode: quoteMode,
          fairValue: market.mid,
          inventoryUsd: market.inventoryUsd,
          maxInventoryUsd: market.maxInventoryUsd,
          tickSize: market.tickSize,
          bestBid: market.bestBid,
          bestAsk: market.bestAsk,
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
        input.currentOrders,
        nowMs,
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
