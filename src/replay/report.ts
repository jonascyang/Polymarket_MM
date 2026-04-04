export type ReplaySummary = {
  fills: number;
  perMarketFills: Record<number, number>;
  quoteSeconds: number;
  protectSeconds: number;
  flattenPnlUsd: number;
  flattenPnlPct: number;
  adverseMove30sBps: number;
  adverseMove60sBps: number;
  quoteSurvivalSeconds: number;
  scorableQuoteSeconds: number;
  topOfBookSeconds: number;
  dualSidedQuoteSeconds: number;
  pointsProxy: number;
};

export type ReplaySummaryReport = ReplaySummary & {
  totalActiveSeconds: number;
  marketCountWithFills: number;
  pointsProxyPerActiveHour: number;
};

export function summarizeReplay(summary: ReplaySummary): ReplaySummaryReport {
  const totalActiveSeconds = summary.quoteSeconds + summary.protectSeconds;

  return {
    ...summary,
    totalActiveSeconds,
    marketCountWithFills: Object.keys(summary.perMarketFills).length,
    pointsProxyPerActiveHour:
      totalActiveSeconds > 0 ? (summary.pointsProxy * 3600) / totalActiveSeconds : 0
  };
}
