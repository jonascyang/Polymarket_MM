import { describe, expect, it } from "vitest";

import { REQUIRED_TABLES } from "../src/storage/schema";

describe("storage schema", () => {
  it("declares the recorder and trading tables", () => {
    expect(REQUIRED_TABLES).toEqual([
      "market_snapshots",
      "orderbook_events",
      "last_sale_events",
      "orders",
      "fills",
      "portfolio_snapshots",
      "market_state_events",
      "risk_events"
    ]);
  });
});
