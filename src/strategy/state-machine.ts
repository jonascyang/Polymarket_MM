export type MarketState =
  | "Observe"
  | "Quote"
  | "Throttle"
  | "Protect"
  | "Pause"
  | "Stop"
  | "Score"
  | "Defend"
  | "Exit";

export type PortfolioRiskMode = "Normal" | "SoftStop" | "HardStop" | "Catastrophic";

export type MarketStateInput = {
  oneSidedFill: boolean;
  hasOneSidedBook?: boolean;
  quoteToFillRatioHigh?: boolean;
  shouldPause?: boolean;
  isToxic: boolean;
  inventoryUsd: number;
  maxInventoryUsd: number;
  minutesToExit: number;
  riskMode: PortfolioRiskMode;
  isEligible: boolean;
};

function hasReachedExitWindow(input: MarketStateInput): boolean {
  return input.minutesToExit <= 60;
}

function hasExceededInventoryLimit(input: MarketStateInput): boolean {
  return Math.abs(input.inventoryUsd) >= input.maxInventoryUsd * 0.85;
}

function canonicalizeState(state: MarketState): Exclude<
  MarketState,
  "Score" | "Defend" | "Exit"
> {
  switch (state) {
    case "Score":
      return "Quote";
    case "Defend":
      return "Protect";
    case "Exit":
      return "Stop";
    default:
      return state;
  }
}

function toLegacyState(nextState: MarketState): MarketState {
  switch (nextState) {
    case "Quote":
      return "Score";
    case "Throttle":
    case "Protect":
      return "Defend";
    case "Pause":
      return "Observe";
    case "Stop":
      return "Exit";
    default:
      return nextState;
  }
}

export function nextMarketState(
  currentState: MarketState,
  input: MarketStateInput
): MarketState {
  const isLegacyState =
    currentState === "Score" ||
    currentState === "Defend" ||
    currentState === "Exit";
  const state = canonicalizeState(currentState);

  let nextState: MarketState;

  if (input.riskMode === "Catastrophic" || input.riskMode === "HardStop") {
    nextState = "Stop";
  } else if (hasReachedExitWindow(input)) {
    nextState = "Pause";
  } else if (input.shouldPause || !input.isEligible) {
    nextState = state === "Observe" ? "Observe" : "Pause";
  } else {
    const inventoryLimitReached = hasExceededInventoryLimit(input);
    const oneSidedPressure = input.oneSidedFill || input.hasOneSidedBook === true;

    if (input.riskMode === "SoftStop") {
      nextState = state === "Observe" ? "Observe" : "Protect";
    } else {
      switch (state) {
        case "Observe":
          nextState = input.isToxic ? "Protect" : "Quote";
          break;

        case "Quote":
          if (inventoryLimitReached || oneSidedPressure || input.isToxic) {
            nextState = "Protect";
          } else if (input.quoteToFillRatioHigh) {
            nextState = "Throttle";
          } else {
            nextState = "Quote";
          }
          break;

        case "Throttle":
          if (inventoryLimitReached || oneSidedPressure || input.isToxic) {
            nextState = "Protect";
          } else if (!input.quoteToFillRatioHigh) {
            nextState = "Quote";
          } else {
            nextState = "Throttle";
          }
          break;

        case "Protect":
          if (!input.isToxic && !oneSidedPressure && input.inventoryUsd === 0) {
            nextState = "Quote";
          } else {
            nextState = "Protect";
          }
          break;

        case "Pause":
          nextState = "Observe";
          break;

        case "Stop":
          nextState = "Stop";
          break;
      }
    }
  }

  return isLegacyState ? toLegacyState(nextState) : nextState;
}
