import {
  OrderBuilder,
  Side,
  type OrderStrategy
} from "@predictdotfun/sdk";

import type { PredictOutcome } from "../clients/rest-client";
import type { ManagedOrder } from "./order-manager";

export type PredictLimitCreateOrderBody = {
  data: {
    order: Awaited<ReturnType<OrderBuilder["signTypedDataOrder"]>> & {
      hash: string;
    };
    pricePerShare: string;
    strategy: OrderStrategy;
  };
};

export type PredictSdkMarketMetadata = {
  marketId: number;
  tokenId: string;
  feeRateBps: number;
  isNegRisk: boolean;
  isYieldBearing: boolean;
};

const WEI_PRECISION = 18;
const WEI_SCALE = 10n ** 18n;

function normalizeDecimalString(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid decimal value: ${value}`);
  }

  const normalized = value.toString();

  if (normalized.includes("e") || normalized.includes("E")) {
    return value.toFixed(WEI_PRECISION).replace(/\.?0+$/, "");
  }

  return normalized;
}

function decimalStringToWei(value: string, decimals = WEI_PRECISION): bigint {
  const [wholePart, fractionPart = ""] = value.split(".");
  const normalizedFraction = `${fractionPart}${"0".repeat(decimals)}`.slice(0, decimals);

  return BigInt(`${wholePart}${normalizedFraction}`);
}

function decimalToWei(value: number, decimals = WEI_PRECISION): bigint {
  return decimalStringToWei(normalizeDecimalString(value), decimals);
}

function getQuantityWei(order: ManagedOrder): bigint {
  const sizeUsdWei = decimalToWei(order.sizeUsd);
  const pricePerShareWei = decimalToWei(order.price);

  return (sizeUsdWei * WEI_SCALE) / pricePerShareWei;
}

export function resolvePrimaryOutcomeTokenId(
  outcomes: Array<Pick<PredictOutcome, "name" | "onChainId" | "indexSet">>
): string {
  const preferredOutcome =
    outcomes.find((outcome) => outcome.name.trim().toLowerCase() === "yes") ??
    outcomes.find((outcome) => outcome.indexSet === 1) ??
    outcomes[0];

  if (!preferredOutcome) {
    throw new Error("Cannot resolve a primary outcome token for this market");
  }

  return preferredOutcome.onChainId;
}

export async function buildLimitCreateOrderBody(input: {
  orderBuilder: OrderBuilder;
  order: ManagedOrder;
  market: PredictSdkMarketMetadata;
}): Promise<PredictLimitCreateOrderBody> {
  const side = input.order.side === "bid" ? Side.BUY : Side.SELL;
  const pricePerShareWei = decimalToWei(input.order.price);
  const amounts = input.orderBuilder.getLimitOrderAmounts({
    side,
    pricePerShareWei,
    quantityWei: getQuantityWei(input.order)
  });
  const builtOrder = input.orderBuilder.buildOrder("LIMIT", {
    side,
    tokenId: input.market.tokenId,
    makerAmount: amounts.makerAmount,
    takerAmount: amounts.takerAmount,
    feeRateBps: input.market.feeRateBps
  });
  const typedData = input.orderBuilder.buildTypedData(builtOrder, {
    isNegRisk: input.market.isNegRisk,
    isYieldBearing: input.market.isYieldBearing
  });
  const signedOrder = await input.orderBuilder.signTypedDataOrder(typedData);
  const hash = input.orderBuilder.buildTypedDataHash(typedData);

  return {
    data: {
      order: {
        ...signedOrder,
        hash
      },
      pricePerShare: amounts.pricePerShare.toString(),
      strategy: "LIMIT"
    }
  };
}
