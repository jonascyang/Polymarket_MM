export type FlattenEstimateInput = {
  accountEquityUsd: number;
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  estimatedFeesUsd: number;
  estimatedSlippageUsd: number;
};

export type FlattenEstimate = {
  flattenPnlUsd: number;
  flattenPnlPct: number;
};

export function estimateFlattenPnl(input: FlattenEstimateInput): FlattenEstimate {
  const flattenPnlUsd =
    input.realizedPnlUsd +
    input.unrealizedPnlUsd -
    input.estimatedFeesUsd -
    input.estimatedSlippageUsd;

  return {
    flattenPnlUsd,
    flattenPnlPct: flattenPnlUsd / input.accountEquityUsd
  };
}
