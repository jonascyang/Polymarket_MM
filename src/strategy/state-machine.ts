export type MarketState = "Observe" | "Score" | "Defend" | "Exit";

export type PortfolioRiskMode = "Normal" | "SoftStop" | "HardStop" | "Catastrophic";

export type MarketStateInput = {
  oneSidedFill: boolean;
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

export function nextMarketState(
  currentState: MarketState,
  input: MarketStateInput
): MarketState {
  if (input.riskMode === "Catastrophic" || input.riskMode === "HardStop") {
    return "Exit";
  }

  if (hasReachedExitWindow(input) || hasExceededInventoryLimit(input)) {
    return "Exit";
  }

  if (input.riskMode === "SoftStop") {
    return currentState === "Observe" ? "Observe" : "Defend";
  }

  switch (currentState) {
    case "Observe":
      if (!input.isEligible) {
        return "Observe";
      }

      return input.isToxic ? "Defend" : "Score";

    case "Score":
      if (input.oneSidedFill || input.isToxic || input.inventoryUsd !== 0) {
        return "Defend";
      }

      return "Score";

    case "Defend":
      if (!input.isEligible) {
        return "Observe";
      }

      if (!input.isToxic && input.inventoryUsd === 0) {
        return "Score";
      }

      return "Defend";

    case "Exit":
      return input.isEligible ? "Observe" : "Exit";
  }
}
