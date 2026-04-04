export type RiskMode = "Normal" | "SoftStop" | "HardStop" | "Catastrophic";

export type EvaluateRiskInput = {
  flattenPnlPct: number;
  peakDrawdownPct: number;
  aggregateNetInventoryUsd?: number;
  aggregateNetInventoryCapUsd?: number;
  minutesToExit?: number;
  softStopPct?: number;
  hardStopPct?: number;
  catastrophicStopPct?: number;
  trailingHardStopPct?: number;
};

export type RiskEvaluation = {
  mode: RiskMode;
  reduceOnly: boolean;
  forceExit: boolean;
  forceFlatten: boolean;
  reason: string;
};

const DEFAULT_SOFT_STOP_PCT = -0.01;
const DEFAULT_HARD_STOP_PCT = -0.02;
const DEFAULT_CATASTROPHIC_STOP_PCT = -0.03;
const DEFAULT_TRAILING_HARD_STOP_PCT = -0.015;
const DEFAULT_EXIT_WINDOW_MINUTES = 60;

export function evaluateRiskMode(input: EvaluateRiskInput): RiskEvaluation {
  const softStopPct = input.softStopPct ?? DEFAULT_SOFT_STOP_PCT;
  const hardStopPct = input.hardStopPct ?? DEFAULT_HARD_STOP_PCT;
  const catastrophicStopPct = input.catastrophicStopPct ?? DEFAULT_CATASTROPHIC_STOP_PCT;
  const trailingHardStopPct =
    input.trailingHardStopPct ?? DEFAULT_TRAILING_HARD_STOP_PCT;
  const hasExceededAggregateInventoryCap =
    input.aggregateNetInventoryUsd !== undefined &&
    input.aggregateNetInventoryCapUsd !== undefined &&
    Math.abs(input.aggregateNetInventoryUsd) >= input.aggregateNetInventoryCapUsd;
  const isInsideExitWindow =
    input.minutesToExit !== undefined &&
    input.minutesToExit <= DEFAULT_EXIT_WINDOW_MINUTES;

  if (input.flattenPnlPct <= catastrophicStopPct) {
    return {
      mode: "Catastrophic",
      reduceOnly: true,
      forceExit: true,
      forceFlatten: true,
      reason: "flatten-pnl-catastrophic-stop"
    };
  }

  if (
    input.flattenPnlPct <= hardStopPct ||
    input.peakDrawdownPct <= trailingHardStopPct
  ) {
    return {
      mode: "HardStop",
      reduceOnly: true,
      forceExit: true,
      forceFlatten: true,
      reason: "flatten-pnl-hard-stop"
    };
  }

  if (
    input.flattenPnlPct <= softStopPct ||
    hasExceededAggregateInventoryCap ||
    isInsideExitWindow
  ) {
    return {
      mode: "SoftStop",
      reduceOnly: true,
      forceExit: false,
      forceFlatten: false,
      reason: isInsideExitWindow
        ? "time-exit-window"
        : hasExceededAggregateInventoryCap
          ? "aggregate-inventory-cap"
          : "flatten-pnl-soft-stop"
    };
  }

  return {
    mode: "Normal",
    reduceOnly: false,
    forceExit: false,
    forceFlatten: false,
    reason: "normal"
  };
}
