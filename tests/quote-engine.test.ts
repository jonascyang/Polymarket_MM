import { describe, expect, it } from "vitest";

import { buildQuotes } from "../src/strategy/quote-engine";

describe("buildQuotes", () => {
  it("prefers the first level when it is inside the fair-value bound", () => {
    const quotes = buildQuotes({
      mode: "Quote",
      fairValue: 0.5,
      inventoryUsd: 0,
      maxInventoryUsd: 15,
      tickSize: 0.001,
      bidBook: [
        { price: 0.499, size: 40 },
        { price: 0.498, size: 15 }
      ],
      askBook: [
        { price: 0.501, size: 35 },
        { price: 0.502, size: 12 }
      ]
    });

    expect(quotes.bid).toBe(0.499);
    expect(quotes.ask).toBe(0.501);
  });

  it("falls back to the second level when the first level is outside the fair-value bound", () => {
    const quotes = buildQuotes({
      mode: "Quote",
      fairValue: 0.5,
      inventoryUsd: 0,
      maxInventoryUsd: 15,
      tickSize: 0.001,
      bidBook: [
        { price: 0.5, size: 12 },
        { price: 0.499, size: 8 }
      ],
      askBook: [
        { price: 0.5, size: 12 },
        { price: 0.501, size: 8 }
      ]
    });

    expect(quotes.bid).toBe(0.499);
    expect(quotes.ask).toBe(0.501);
  });

  it("prefers the second level when the first level queue is overcrowded by more than 25x", () => {
    const quotes = buildQuotes({
      mode: "Quote",
      fairValue: 0.5,
      inventoryUsd: 0,
      maxInventoryUsd: 15,
      tickSize: 0.001,
      bidBook: [
        { price: 0.499, size: 200 },
        { price: 0.498, size: 6 }
      ],
      askBook: [
        { price: 0.501, size: 200 },
        { price: 0.502, size: 6 }
      ]
    });

    expect(quotes.bid).toBe(0.498);
    expect(quotes.ask).toBe(0.502);
  });

  it("caps quote size to a visible-queue derived budget on the selected bid price", () => {
    const visibleQueueUsd = 50 * 0.397;
    const queueShareCap = 0.1;
    const expectedSizeUsd = visibleQueueUsd * queueShareCap;

    const quotes = buildQuotes({
      mode: "Protect",
      fairValue: 0.3985,
      inventoryUsd: -8,
      maxInventoryUsd: 15,
      tickSize: 0.001,
      bidBook: [
        { price: 0.399, size: 129.63 },
        { price: 0.397, size: 50 }
      ],
      askBook: [
        { price: 0.4, size: 5325.7938 },
        { price: 0.401, size: 110.016 }
      ]
    });

    expect(quotes.bid).toBe(0.397);
    expect(quotes.bidSizeUsd).toBeCloseTo(expectedSizeUsd, 6);
    expect(quotes.sizeUsd).toBeCloseTo(expectedSizeUsd, 6);
  });

  it("caps protect size to a visible-queue derived budget on the selected ask price", () => {
    const visibleQueueUsd = 30 * 0.879;
    const queueShareCap = 0.1;
    const expectedSizeUsd = visibleQueueUsd * queueShareCap;

    const quotes = buildQuotes({
      mode: "Protect",
      fairValue: 0.8775,
      inventoryUsd: 8,
      maxInventoryUsd: 15,
      tickSize: 0.001,
      bestBid: 0.861,
      bestAsk: 0.878,
      askBook: [
        { price: 0.878, size: 1423.505 },
        { price: 0.879, size: 30 }
      ]
    });

    expect(quotes.ask).toBe(0.879);
    expect(quotes.bidSizeUsd).toBe(0);
    expect(quotes.askSizeUsd).toBeCloseTo(expectedSizeUsd, 6);
    expect(quotes.sizeUsd).toBeCloseTo(expectedSizeUsd, 6);
  });

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

  it("drops a side completely when neither of the top two levels is inside the fair-value bound", () => {
    const quotes = buildQuotes({
      mode: "Quote",
      fairValue: 0.5,
      inventoryUsd: 0,
      maxInventoryUsd: 15,
      tickSize: 0.001,
      bidBook: [
        { price: 0.5, size: 5 },
        { price: 0.4995, size: 5 }
      ],
      askBook: [
        { price: 0.5005, size: 5 },
        { price: 0.5, size: 5 }
      ]
    });

    expect(quotes.bidSizeUsd).toBe(0);
    expect(quotes.askSizeUsd).toBe(0);
  });

  it("skips quoting when the remaining quote budget is below the platform minimum order value", () => {
    const quotes = buildQuotes({
      mode: "Quote",
      fairValue: 0.5,
      inventoryUsd: 0,
      maxInventoryUsd: 15,
      tickSize: 0.001,
      quoteBudgetUsd: 0.5
    });

    expect(quotes.sizeUsd).toBe(0);
    expect(quotes.bidSizeUsd).toBe(0);
    expect(quotes.askSizeUsd).toBe(0);
  });
});
