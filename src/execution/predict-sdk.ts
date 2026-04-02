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

function decimalToWei(value: number, decimals = 18): bigint {
  const [whole, fraction = ""] = value.toFixed(decimals).split(".");
  return BigInt(`${whole}${fraction}`);
}

function getQuantityWei(order: ManagedOrder): bigint {
  return decimalToWei(order.sizeUsd / order.price);
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
