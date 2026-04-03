import { describe, expect, it } from "vitest";

import { buildQuotes } from "../src/strategy/quote-engine";

describe("buildQuotes", () => {
  it("moves the ask closer and the bid farther when inventory is long", () => {
    const quotes = buildQuotes({
      mode: "Protect",
      fairValue: 0.5,
      inventoryUsd: 8,
      maxInventoryUsd: 15,
      tickSize: 0.001
    });

    expect(quotes.ask).toBeLessThan(0.5 + quotes.baseHalfSpread);
    expect(quotes.bid).toBeLessThan(0.5 - quotes.baseHalfSpread);
  });

  it("disables quoting when aggregate net inventory has reached the portfolio cap", () => {
    const quotes = buildQuotes({
      mode: "Quote",
      fairValue: 0.5,
      inventoryUsd: 0,
      maxInventoryUsd: 15,
      tickSize: 0.001,
      aggregateNetInventoryUsd: 45,
      aggregateNetInventoryCapUsd: 45
    });

    expect(quotes.canQuote).toBe(false);
    expect(quotes.sizeUsd).toBe(0);
  });

  it("keeps only the ask active in protect mode when inventory is long", () => {
    const quotes = buildQuotes({
      mode: "Protect",
      fairValue: 0.5,
      inventoryUsd: 8,
      maxInventoryUsd: 15,
      tickSize: 0.001
    });

    expect(quotes.bidSizeUsd).toBe(0);
    expect(quotes.askSizeUsd).toBeGreaterThan(0);
  });

  it("stops quoting the missing side when protect mode sees a one-sided book", () => {
    const quotes = buildQuotes({
      mode: "Protect",
      fairValue: 0.5,
      inventoryUsd: 0,
      maxInventoryUsd: 15,
      tickSize: 0.001,
      bestBid: 0.49,
      bestAsk: null
    });

    expect(quotes.bidSizeUsd).toBeGreaterThan(0);
    expect(quotes.askSizeUsd).toBe(0);
  });
});
