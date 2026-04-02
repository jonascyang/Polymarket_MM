import type { PredictMmConfig } from "../types";

export type MarketStatusFilter = "OPEN" | "RESOLVED";

export type MarketSort =
  | "CHANCE_24H_CHANGE_ASC"
  | "CHANCE_24H_CHANGE_DESC"
  | "VOLUME_24H_ASC"
  | "VOLUME_24H_DESC"
  | "VOLUME_24H_CHANGE_ASC"
  | "VOLUME_24H_CHANGE_DESC"
  | "VOLUME_TOTAL_ASC"
  | "VOLUME_TOTAL_DESC";

export type MarketsQuery = {
  first?: number;
  after?: string;
  isBoosted?: boolean;
  status?: MarketStatusFilter;
  tagIds?: string;
  marketVariant?: string;
  includeStats?: boolean;
  sort?: MarketSort;
};

export type PredictApiResponse<T> = {
  success: boolean;
  cursor?: string;
  data: T;
};

export type PredictRestClientOptions = {
  bearerToken?: string;
};

export type PredictMarketStats = {
  totalLiquidityUsd: number;
  volume24hUsd: number;
  volumeTotalUsd: number;
};

export type PredictOrderbookLevel = [number, number] | number[];

export type PredictOrderbookData = {
  marketId: number;
  updateTimestampMs: number;
  lastOrderSettled?: unknown;
  asks: PredictOrderbookLevel[];
  bids: PredictOrderbookLevel[];
};

export type PredictLastSaleData = {
  quoteType: string;
  outcome: string;
  priceInCurrency: string;
  strategy: string;
} | null;

export type PredictContractOrder = {
  hash?: string;
  salt: string;
  maker: string;
  signer: string;
  taker: string;
  tokenId: string;
  makerAmount: string;
  takerAmount: string;
  expiration: number;
  nonce: string;
  feeRateBps: string;
  side: number;
  signatureType: number;
  signature?: string;
};

export type PredictOrderStatus = "OPEN" | "FILLED" | "EXPIRED" | "CANCELLED" | "INVALIDATED";

export type PredictOrderStatusFilter = "OPEN" | "FILLED";

export type PredictOrderData = {
  order: PredictContractOrder;
  id: string;
  marketId: number;
  currency: string;
  amount: string;
  amountFilled: string;
  isNegRisk: boolean;
  isYieldBearing: boolean;
  strategy: string;
  status: PredictOrderStatus;
  rewardEarningRate: number;
};

export type PredictOutcome = {
  name: string;
  indexSet: number;
  onChainId: string;
  status?: string;
};

export type PredictCreateOrderRequest = {
  data: {
    order: Omit<PredictContractOrder, "expiration"> & {
      expiration: string | number;
      hash?: string;
      signature: string;
    };
    pricePerShare: string;
    strategy: "MARKET" | "LIMIT";
    slippageBps?: string;
    isFillOrKill?: boolean;
    isMinAmountOut?: boolean;
  };
};

export type PredictCreateOrderResponse = {
  code: string;
  orderId: string;
  orderHash: string;
};

export type PredictRemoveOrdersRequest = {
  data: {
    ids: string[];
  };
};

export type PredictRemoveOrdersResponse = {
  success: boolean;
  removed: string[];
  noop: string[];
};

export type PredictPositionData = {
  id: string;
  market: Pick<PredictMarket, "id">;
  outcome: PredictOutcome;
  amount: string;
  valueUsd: string;
  averageBuyPriceUsd: string;
  pnlUsd: string;
};

export type PredictAccountData = {
  name: string;
  address: string;
  imageUrl?: string;
  referral: unknown;
  points: unknown;
};

export type OrdersQuery = {
  first?: number;
  after?: string;
  status?: PredictOrderStatusFilter;
};

export type PositionSort =
  | "AMOUNT_DESC"
  | "EVENT_BLOCK_ASC"
  | "EVENT_BLOCK_DESC"
  | "SHARES_VALUE_DESC"
  | "RETURN_DESC";

export type PositionsQuery = {
  first?: number;
  after?: string;
  marketId?: number;
  categoryId?: string;
  isResolved?: boolean;
  sort?: PositionSort;
};

export type PredictMarket = {
  id: number;
  title: string;
  question: string;
  description: string;
  tradingStatus: string;
  status: string;
  isVisible: boolean;
  isNegRisk: boolean;
  isYieldBearing: boolean;
  feeRateBps: number;
  oracleQuestionId: string;
  conditionId: string;
  resolverAddress: string;
  outcomes: PredictOutcome[];
  spreadThreshold: number;
  shareThreshold: number;
  isBoosted: boolean;
  polymarketConditionIds: string[];
  categorySlug: string;
  createdAt: string;
  decimalPrecision: number;
  marketVariant: string;
  imageUrl: string;
  stats?: PredictMarketStats | null;
};

function appendQueryParam(params: URLSearchParams, key: string, value: string | number | boolean | undefined): void {
  if (value === undefined) {
    return;
  }

  params.append(key, String(value));
}

export function buildMarketsPath(query: MarketsQuery = {}): string {
  const params = new URLSearchParams();

  appendQueryParam(params, "first", query.first);
  appendQueryParam(params, "after", query.after);
  appendQueryParam(params, "isBoosted", query.isBoosted);
  appendQueryParam(params, "status", query.status);
  appendQueryParam(params, "tagIds", query.tagIds);
  appendQueryParam(params, "marketVariant", query.marketVariant);
  appendQueryParam(params, "includeStats", query.includeStats);
  appendQueryParam(params, "sort", query.sort);

  const queryString = params.toString();

  return queryString ? `/markets?${queryString}` : "/markets";
}

function buildOrdersPath(query: OrdersQuery = {}): string {
  const params = new URLSearchParams();

  appendQueryParam(params, "first", query.first);
  appendQueryParam(params, "after", query.after);
  appendQueryParam(params, "status", query.status);

  const queryString = params.toString();

  return queryString ? `/orders?${queryString}` : "/orders";
}

function buildPositionsPath(query: PositionsQuery = {}): string {
  const params = new URLSearchParams();

  appendQueryParam(params, "first", query.first);
  appendQueryParam(params, "after", query.after);
  appendQueryParam(params, "marketId", query.marketId);
  appendQueryParam(params, "categoryId", query.categoryId);
  appendQueryParam(params, "isResolved", query.isResolved);
  appendQueryParam(params, "sort", query.sort);

  const queryString = params.toString();

  return queryString ? `/positions?${queryString}` : "/positions";
}

export function buildApiHeaders(apiKey: string, bearerToken?: string): HeadersInit {
  const headers: Record<string, string> = {
    "x-api-key": apiKey
  };

  if (bearerToken) {
    headers.Authorization = `Bearer ${bearerToken}`;
  }

  return headers;
}

export class PredictRestClient {
  constructor(private readonly config: PredictMmConfig) {}

  async request<T>(
    path: string,
    init: RequestInit = {},
    options: PredictRestClientOptions = {}
  ): Promise<PredictApiResponse<T>> {
    const response = await fetch(`${this.config.apiBaseUrl}${path}`, {
      ...init,
      headers: {
        ...buildApiHeaders(this.config.apiKey, options.bearerToken),
        ...(init.headers ?? {})
      }
    });

    if (!response.ok) {
      throw new Error(`Predict API request failed: ${response.status} ${response.statusText} (${path})`);
    }

    return (await response.json()) as PredictApiResponse<T>;
  }

  getMarkets(query: MarketsQuery = {}): Promise<PredictApiResponse<PredictMarket[]>> {
    return this.request<PredictMarket[]>(buildMarketsPath(query));
  }

  getMarket(marketId: number): Promise<PredictApiResponse<PredictMarket>> {
    return this.request<PredictMarket>(`/markets/${marketId}`);
  }

  getMarketStats(marketId: number): Promise<PredictApiResponse<PredictMarketStats>> {
    return this.request<PredictMarketStats>(`/markets/${marketId}/stats`);
  }

  getMarketOrderbook(marketId: number): Promise<PredictApiResponse<PredictOrderbookData>> {
    return this.request<PredictOrderbookData>(`/markets/${marketId}/orderbook`);
  }

  getMarketLastSale(marketId: number): Promise<PredictApiResponse<PredictLastSaleData>> {
    return this.request<PredictLastSaleData>(`/markets/${marketId}/last-sale`);
  }

  getOrders(
    bearerToken: string,
    query: OrdersQuery = {}
  ): Promise<PredictApiResponse<PredictOrderData[]>> {
    return this.request<PredictOrderData[]>(buildOrdersPath(query), {}, { bearerToken });
  }

  createOrder(
    bearerToken: string,
    body: PredictCreateOrderRequest
  ): Promise<PredictApiResponse<PredictCreateOrderResponse>> {
    return this.request<PredictCreateOrderResponse>(
      "/orders",
      {
        method: "POST",
        headers: {
          "content-type": "application/json; charset=utf-8"
        },
        body: JSON.stringify(body)
      },
      { bearerToken }
    );
  }

  removeOrders(
    bearerToken: string,
    ids: string[]
  ): Promise<PredictRemoveOrdersResponse> {
    return fetch(`${this.config.apiBaseUrl}/orders/remove`, {
      method: "POST",
      headers: {
        ...buildApiHeaders(this.config.apiKey, bearerToken),
        "content-type": "application/json; charset=utf-8"
      },
      body: JSON.stringify({
        data: {
          ids
        }
      })
    }).then(async (response) => {
      if (!response.ok) {
        throw new Error(
          `Predict API request failed: ${response.status} ${response.statusText} (/orders/remove)`
        );
      }

      return (await response.json()) as PredictRemoveOrdersResponse;
    });
  }

  getPositions(
    bearerToken: string,
    query: PositionsQuery = {}
  ): Promise<PredictApiResponse<PredictPositionData[]>> {
    return this.request<PredictPositionData[]>(buildPositionsPath(query), {}, { bearerToken });
  }

  getAccount(bearerToken: string): Promise<PredictApiResponse<PredictAccountData>> {
    return this.request<PredictAccountData>("/account", {}, { bearerToken });
  }
}
