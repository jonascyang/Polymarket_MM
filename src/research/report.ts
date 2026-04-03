import type { DatabaseSync } from "node:sqlite";

export type ResearchCollectionSummary = {
  sampledMarkets: number;
  orderbookEvents: number;
  lastSaleEvents: number;
  orderOpenEvents: number;
  fills: number;
};

export type ResearchMarketActivityRow = {
  marketId: number;
  volume24hUsd: number | null;
  spread: number | null;
  isBoosted: boolean;
  isToxic: boolean;
  currentState: string | null;
  hasOneSidedBook: boolean;
  quoteCountSinceFill: number;
  segment: "tradable" | "watch" | "toxic_or_thin";
  health: "active-safe" | "active-risky" | "inactive-or-toxic";
};

export type ResearchFillRateRow = {
  distanceTicks: number;
  orderCount: number;
  filledCount: number;
  fillRate: number;
};

export type ResearchMarkoutSummary = {
  fillCount: number;
  averageAdverse30sBps: number;
  averageAdverse60sBps: number;
  averageMarkout30sUsd: number;
  averageMarkout60sUsd: number;
};

export type ResearchInventoryRecycleRow = {
  marketId: number;
  completedCycles: number;
  openCycles: number;
  averageSecondsToFlat: number;
};

export type ResearchReport = {
  collection: ResearchCollectionSummary;
  marketActivity: ResearchMarketActivityRow[];
  fillRateByDistanceToTouch: ResearchFillRateRow[];
  markout: ResearchMarkoutSummary;
  inventoryRecycle: ResearchInventoryRecycleRow[];
  marketProfiles: ResearchMarketProfileRow[];
};

type ResearchFillRow = {
  marketId: number;
  side: "bid" | "ask";
  price: number;
  sizeUsd: number;
  recordedAtMs: number;
};

type ResearchOrderbookRow = {
  marketId: number;
  bestBid: number | null;
  bestAsk: number | null;
  recordedAtMs: number;
};

export type ResearchMarketProfileRow = {
  marketId: number;
  segment: ResearchMarketActivityRow["segment"];
  health: ResearchMarketActivityRow["health"];
  volume24hUsd: number | null;
  spread: number | null;
  fillRateAtTouch: number;
  fillRateNearTouch: number;
  averageAdverse30sBps: number;
  averageMarkout30sUsd: number;
  averageSecondsToFlat: number;
  fills: number;
};

function roundMetric(value: number, decimals = 6): number {
  const scale = 10 ** decimals;
  const adjusted =
    value >= 0
      ? value + Number.EPSILON
      : value - Number.EPSILON;

  return Math.round(adjusted * scale) / scale;
}

function formatNumber(value: number | null): string {
  if (value === null) {
    return "-";
  }

  return Number.isInteger(value) ? String(value) : value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

function classifyMarketSegment(input: {
  isToxic: boolean;
  spread: number | null;
  volume24hUsd: number | null;
  isBoosted: boolean;
}): ResearchMarketActivityRow["segment"] {
  if (
    input.isToxic ||
    input.spread === null ||
    input.spread >= 0.05 ||
    (input.volume24hUsd ?? 0) < 10000
  ) {
    return "toxic_or_thin";
  }

  if ((input.volume24hUsd ?? 0) >= 20000 || input.isBoosted) {
    return "tradable";
  }

  return "watch";
}

function classifyMarketHealth(input: {
  segment: ResearchMarketActivityRow["segment"];
  currentState: string | null;
  hasOneSidedBook: boolean;
  quoteCountSinceFill: number;
}): ResearchMarketActivityRow["health"] {
  if (input.segment === "toxic_or_thin" || input.hasOneSidedBook) {
    return "inactive-or-toxic";
  }

  if (
    input.currentState === "Protect" ||
    input.currentState === "Throttle" ||
    input.currentState === "Pause" ||
    input.currentState === "Defend" ||
    input.currentState === "Exit" ||
    input.quoteCountSinceFill >= 6
  ) {
    return "active-risky";
  }

  return "active-safe";
}

function getCollectionSummary(database: DatabaseSync): ResearchCollectionSummary {
  const counts = database
    .prepare(
      `SELECT
        (SELECT COUNT(DISTINCT market_id) FROM market_snapshots) AS sampled_markets,
        (SELECT COUNT(*) FROM orderbook_events) AS orderbook_events,
        (SELECT COUNT(*) FROM last_sale_events) AS last_sale_events,
        (SELECT COUNT(*) FROM order_events WHERE event_type LIKE '%OPEN%') AS order_open_events,
        (SELECT COUNT(*) FROM fills) AS fills`
    )
    .get() as {
    sampled_markets: number;
    orderbook_events: number;
    last_sale_events: number;
    order_open_events: number;
    fills: number;
  };

  return {
    sampledMarkets: counts.sampled_markets,
    orderbookEvents: counts.orderbook_events,
    lastSaleEvents: counts.last_sale_events,
    orderOpenEvents: counts.order_open_events,
    fills: counts.fills
  };
}

function getMarketActivity(database: DatabaseSync): ResearchMarketActivityRow[] {
  const rows = database
    .prepare(
      `SELECT
        market_id,
        volume24h_usd,
        spread,
        is_boosted,
        is_toxic,
        current_state,
        json_extract(payload_json, '$.bestBid') AS best_bid,
        json_extract(payload_json, '$.bestAsk') AS best_ask,
        COALESCE(json_extract(payload_json, '$.quoteCountSinceFill'), 0) AS quote_count_since_fill
      FROM market_regime_snapshots
      WHERE id IN (
        SELECT MAX(id)
        FROM market_regime_snapshots
        GROUP BY market_id
      )
      ORDER BY COALESCE(volume24h_usd, 0) DESC, market_id ASC`
    )
    .all() as Array<{
    market_id: number;
    volume24h_usd: number | null;
    spread: number | null;
    is_boosted: number;
    is_toxic: number;
    current_state: string | null;
    best_bid: number | null;
    best_ask: number | null;
    quote_count_since_fill: number | null;
  }>;

  return rows.map((row) => {
    const isToxic = row.is_toxic === 1;
    const spread = row.spread;
    const volume24hUsd = row.volume24h_usd;
    const segment = classifyMarketSegment({
      isToxic,
      spread,
      volume24hUsd,
      isBoosted: row.is_boosted === 1
    });
    const hasOneSidedBook =
      (row.best_bid === null && row.best_ask !== null) ||
      (row.best_bid !== null && row.best_ask === null);
    const quoteCountSinceFill = row.quote_count_since_fill ?? 0;

    return {
      marketId: row.market_id,
      volume24hUsd,
      spread,
      isBoosted: row.is_boosted === 1,
      isToxic,
      currentState: row.current_state,
      hasOneSidedBook,
      quoteCountSinceFill,
      segment,
      health: classifyMarketHealth({
        segment,
        currentState: row.current_state,
        hasOneSidedBook,
        quoteCountSinceFill
      })
    };
  });
}

function getFillRateByDistanceToTouch(database: DatabaseSync): ResearchFillRateRow[] {
  const rows = database
    .prepare(
      `SELECT
        CAST(
          ROUND(
            ABS(
              oe.price - CASE
                WHEN oe.logical_side = 'bid' THEN ob.best_bid
                ELSE ob.best_ask
              END
            ) / CASE
              WHEN json_extract(ms.payload_json, '$.decimalPrecision') IS NULL THEN 0.01
              ELSE 1.0 / CAST(POWER(10, json_extract(ms.payload_json, '$.decimalPrecision')) AS REAL)
            END
          ) AS INTEGER
        ) AS distance_ticks,
        COUNT(*) AS order_count,
        SUM(CASE WHEN f.id IS NULL THEN 0 ELSE 1 END) AS filled_count
      FROM order_events oe
      JOIN market_snapshots ms
        ON ms.market_id = oe.market_id
       AND ms.id = (
         SELECT MAX(id)
         FROM market_snapshots
         WHERE market_id = oe.market_id
           AND recorded_at <= oe.recorded_at
       )
      JOIN orderbook_events ob
        ON ob.market_id = oe.market_id
       AND ob.id = (
         SELECT MAX(id)
         FROM orderbook_events
         WHERE market_id = oe.market_id
           AND recorded_at <= oe.recorded_at
       )
      LEFT JOIN fills f
        ON f.order_hash = oe.exchange_order_id
      WHERE oe.event_type LIKE '%OPEN%'
        AND oe.logical_side IN ('bid', 'ask')
        AND oe.price IS NOT NULL
      GROUP BY distance_ticks
      ORDER BY distance_ticks ASC`
    )
    .all() as Array<{
    distance_ticks: number;
    order_count: number;
    filled_count: number;
  }>;

  return rows.map((row) => ({
    distanceTicks: row.distance_ticks,
    orderCount: row.order_count,
    filledCount: row.filled_count,
    fillRate: row.order_count === 0 ? 0 : roundMetric(row.filled_count / row.order_count)
  }));
}

function getMarkoutSummary(database: DatabaseSync): ResearchMarkoutSummary {
  const precomputedCount = database
    .prepare("SELECT COUNT(*) AS count FROM fill_outcomes")
    .get() as { count: number };

  if (precomputedCount.count === 0) {
    return deriveMarkoutSummary(database);
  }

  const row = database
    .prepare(
      `SELECT
        COUNT(*) AS fill_count,
        AVG(COALESCE(adverse_move_30s_bps, 0)) AS average_adverse_30s_bps,
        AVG(COALESCE(adverse_move_60s_bps, 0)) AS average_adverse_60s_bps,
        AVG(COALESCE(markout_30s_usd, 0)) AS average_markout_30s_usd,
        AVG(COALESCE(markout_60s_usd, 0)) AS average_markout_60s_usd
      FROM fill_outcomes`
    )
    .get() as {
    fill_count: number;
    average_adverse_30s_bps: number | null;
    average_adverse_60s_bps: number | null;
    average_markout_30s_usd: number | null;
    average_markout_60s_usd: number | null;
  };

  return {
    fillCount: row.fill_count,
    averageAdverse30sBps: roundMetric(row.average_adverse_30s_bps ?? 0),
    averageAdverse60sBps: roundMetric(row.average_adverse_60s_bps ?? 0),
    averageMarkout30sUsd: roundMetric(row.average_markout_30s_usd ?? 0),
    averageMarkout60sUsd: roundMetric(row.average_markout_60s_usd ?? 0)
  };
}

function selectResearchFillRows(database: DatabaseSync): ResearchFillRow[] {
  const rows = database
    .prepare(
      "SELECT market_id, side, price, size_usd, recorded_at FROM fills WHERE side IN ('bid', 'ask') AND price IS NOT NULL AND size_usd IS NOT NULL ORDER BY market_id ASC, recorded_at ASC, id ASC"
    )
    .all() as Array<{
    market_id: number;
    side: "bid" | "ask";
    price: number;
    size_usd: number;
    recorded_at: string;
  }>;

  return rows.map((row) => ({
    marketId: row.market_id,
    side: row.side,
    price: row.price,
    sizeUsd: row.size_usd,
    recordedAtMs: Date.parse(row.recorded_at)
  }));
}

function selectResearchOrderbooks(database: DatabaseSync): Map<number, ResearchOrderbookRow[]> {
  const rows = database
    .prepare(
      "SELECT market_id, best_bid, best_ask, recorded_at FROM orderbook_events ORDER BY market_id ASC, recorded_at ASC, id ASC"
    )
    .all() as Array<{
    market_id: number;
    best_bid: number | null;
    best_ask: number | null;
    recorded_at: string;
  }>;
  const grouped = new Map<number, ResearchOrderbookRow[]>();

  for (const row of rows) {
    const bucket = grouped.get(row.market_id) ?? [];
    bucket.push({
      marketId: row.market_id,
      bestBid: row.best_bid,
      bestAsk: row.best_ask,
      recordedAtMs: Date.parse(row.recorded_at)
    });
    grouped.set(row.market_id, bucket);
  }

  return grouped;
}

function deriveMarkoutSummary(database: DatabaseSync): ResearchMarkoutSummary {
  const fills = selectResearchFillRows(database);
  const orderbooksByMarket = selectResearchOrderbooks(database);
  let adverse30Total = 0;
  let adverse30Count = 0;
  let adverse60Total = 0;
  let adverse60Count = 0;
  let markout30Total = 0;
  let markout30Count = 0;
  let markout60Total = 0;
  let markout60Count = 0;

  for (const fill of fills) {
    const quantity = fill.price > 0 ? fill.sizeUsd / fill.price : 0;
    const orderbooks = orderbooksByMarket.get(fill.marketId) ?? [];

    for (const horizonSeconds of [30, 60] as const) {
      const targetTimestamp = fill.recordedAtMs + horizonSeconds * 1000;
      const orderbook = orderbooks.find(
        (row) =>
          row.recordedAtMs >= targetTimestamp &&
          row.bestBid !== null &&
          row.bestAsk !== null
      );

      if (!orderbook || quantity <= 0) {
        continue;
      }

      const bestBid = orderbook.bestBid;
      const bestAsk = orderbook.bestAsk;

      if (bestBid === null || bestAsk === null) {
        continue;
      }

      const mid = (bestBid + bestAsk) / 2;
      const adverseMove =
        fill.side === "bid"
          ? Math.max(0, fill.price - mid)
          : Math.max(0, mid - fill.price);
      const adverseMoveBps = adverseMove * 20_000;
      const markoutUsd =
        fill.side === "bid"
          ? quantity * (mid - fill.price)
          : quantity * (fill.price - mid);

      if (horizonSeconds === 30) {
        adverse30Total += adverseMoveBps;
        adverse30Count += 1;
        markout30Total += markoutUsd;
        markout30Count += 1;
      } else {
        adverse60Total += adverseMoveBps;
        adverse60Count += 1;
        markout60Total += markoutUsd;
        markout60Count += 1;
      }
    }
  }

  return {
    fillCount: fills.length,
    averageAdverse30sBps:
      adverse30Count === 0 ? 0 : roundMetric(adverse30Total / adverse30Count),
    averageAdverse60sBps:
      adverse60Count === 0 ? 0 : roundMetric(adverse60Total / adverse60Count),
    averageMarkout30sUsd:
      markout30Count === 0 ? 0 : roundMetric(markout30Total / markout30Count),
    averageMarkout60sUsd:
      markout60Count === 0 ? 0 : roundMetric(markout60Total / markout60Count)
  };
}

function getInventoryRecycle(database: DatabaseSync): ResearchInventoryRecycleRow[] {
  const rows = database
    .prepare(
      `SELECT
        market_id,
        inventory_after_usd,
        recorded_at
      FROM fills
      WHERE inventory_after_usd IS NOT NULL
      ORDER BY market_id ASC, recorded_at ASC, id ASC`
    )
    .all() as Array<{
    market_id: number;
    inventory_after_usd: number;
    recorded_at: string;
  }>;
  const byMarket = new Map<number, typeof rows>();

  for (const row of rows) {
    const current = byMarket.get(row.market_id) ?? [];
    current.push(row);
    byMarket.set(row.market_id, current);
  }

  return Array.from(byMarket.entries())
    .map(([marketId, fills]) => {
      let cycleStartAt: number | null = null;
      let completedCycles = 0;
      let openCycles = 0;
      let totalSecondsToFlat = 0;

      for (const fill of fills) {
        const recordedAtMs = Date.parse(fill.recorded_at);
        const isFlat = fill.inventory_after_usd === 0;

        if (cycleStartAt === null && !isFlat) {
          cycleStartAt = recordedAtMs;
          continue;
        }

        if (cycleStartAt !== null && isFlat) {
          completedCycles += 1;
          totalSecondsToFlat += Math.max(0, (recordedAtMs - cycleStartAt) / 1000);
          cycleStartAt = null;
        }
      }

      if (cycleStartAt !== null) {
        openCycles = 1;
      }

      if (completedCycles === 0 && openCycles === 0) {
        return null;
      }

      return {
        marketId,
        completedCycles,
        openCycles,
        averageSecondsToFlat:
          completedCycles === 0 ? 0 : roundMetric(totalSecondsToFlat / completedCycles)
      };
    })
    .filter((row): row is ResearchInventoryRecycleRow => row !== null);
}

function getMarketFillRates(database: DatabaseSync): Map<number, {
  fillRateAtTouch: number;
  fillRateNearTouch: number;
}> {
  const rows = database
    .prepare(
      `SELECT
        oe.market_id AS market_id,
        CAST(
          ROUND(
            ABS(
              oe.price - CASE
                WHEN oe.logical_side = 'bid' THEN ob.best_bid
                ELSE ob.best_ask
              END
            ) / CASE
              WHEN json_extract(ms.payload_json, '$.decimalPrecision') IS NULL THEN 0.01
              ELSE 1.0 / CAST(POWER(10, json_extract(ms.payload_json, '$.decimalPrecision')) AS REAL)
            END
          ) AS INTEGER
        ) AS distance_ticks,
        COUNT(*) AS order_count,
        SUM(CASE WHEN f.id IS NULL THEN 0 ELSE 1 END) AS filled_count
      FROM order_events oe
      JOIN market_snapshots ms
        ON ms.market_id = oe.market_id
       AND ms.id = (
         SELECT MAX(id)
         FROM market_snapshots
         WHERE market_id = oe.market_id
           AND recorded_at <= oe.recorded_at
       )
      JOIN orderbook_events ob
        ON ob.market_id = oe.market_id
       AND ob.id = (
         SELECT MAX(id)
         FROM orderbook_events
         WHERE market_id = oe.market_id
           AND recorded_at <= oe.recorded_at
       )
      LEFT JOIN fills f
        ON f.order_hash = oe.exchange_order_id
      WHERE oe.event_type LIKE '%OPEN%'
        AND oe.logical_side IN ('bid', 'ask')
        AND oe.price IS NOT NULL
      GROUP BY oe.market_id, distance_ticks
      ORDER BY oe.market_id ASC, distance_ticks ASC`
    )
    .all() as Array<{
    market_id: number;
    distance_ticks: number;
    order_count: number;
    filled_count: number;
  }>;
  const result = new Map<number, {
    fillRateAtTouch: number;
    fillRateNearTouch: number;
  }>();

  for (const row of rows) {
    const current = result.get(row.market_id) ?? {
      fillRateAtTouch: 0,
      fillRateNearTouch: 0
    };
    const fillRate =
      row.order_count === 0 ? 0 : roundMetric(row.filled_count / row.order_count);

    if (row.distance_ticks === 0) {
      current.fillRateAtTouch = fillRate;
    }

    if (row.distance_ticks === 1) {
      current.fillRateNearTouch = fillRate;
    }

    result.set(row.market_id, current);
  }

  return result;
}

function getPerMarketMarkout(database: DatabaseSync): Map<number, {
  averageAdverse30sBps: number;
  averageMarkout30sUsd: number;
  fills: number;
}> {
  const precomputedCount = database
    .prepare("SELECT COUNT(*) AS count FROM fill_outcomes")
    .get() as { count: number };

  if (precomputedCount.count > 0) {
    const rows = database
      .prepare(
        `SELECT
          f.market_id AS market_id,
          COUNT(*) AS fills,
          AVG(COALESCE(fo.adverse_move_30s_bps, 0)) AS average_adverse_30s_bps,
          AVG(COALESCE(fo.markout_30s_usd, 0)) AS average_markout_30s_usd
        FROM fills f
        LEFT JOIN fill_outcomes fo
          ON fo.fill_id = f.id
        GROUP BY f.market_id
        ORDER BY f.market_id ASC`
      )
      .all() as Array<{
      market_id: number;
      fills: number;
      average_adverse_30s_bps: number | null;
      average_markout_30s_usd: number | null;
    }>;

    return new Map(
      rows.map((row) => [
        row.market_id,
        {
          averageAdverse30sBps: roundMetric(row.average_adverse_30s_bps ?? 0),
          averageMarkout30sUsd: roundMetric(row.average_markout_30s_usd ?? 0),
          fills: row.fills
        }
      ])
    );
  }

  const fills = selectResearchFillRows(database);
  const orderbooksByMarket = selectResearchOrderbooks(database);
  const aggregates = new Map<number, {
    adverse30Total: number;
    markout30Total: number;
    count: number;
  }>();

  for (const fill of fills) {
    const quantity = fill.price > 0 ? fill.sizeUsd / fill.price : 0;
    const orderbooks = orderbooksByMarket.get(fill.marketId) ?? [];
    const targetTimestamp = fill.recordedAtMs + 30_000;
    const orderbook = orderbooks.find(
      (row) =>
        row.recordedAtMs >= targetTimestamp &&
        row.bestBid !== null &&
        row.bestAsk !== null
    );

    const current = aggregates.get(fill.marketId) ?? {
      adverse30Total: 0,
      markout30Total: 0,
      count: 0
    };

    if (orderbook && quantity > 0) {
      const bestBid = orderbook.bestBid;
      const bestAsk = orderbook.bestAsk;

      if (bestBid !== null && bestAsk !== null) {
        const mid = (bestBid + bestAsk) / 2;
        const adverseMove =
          fill.side === "bid"
            ? Math.max(0, fill.price - mid)
            : Math.max(0, mid - fill.price);
        const markoutUsd =
          fill.side === "bid"
            ? quantity * (mid - fill.price)
            : quantity * (fill.price - mid);

        current.adverse30Total += adverseMove * 20_000;
        current.markout30Total += markoutUsd;
      }
    }

    current.count += 1;
    aggregates.set(fill.marketId, current);
  }

  return new Map(
    Array.from(aggregates.entries()).map(([marketId, value]) => [
      marketId,
      {
        averageAdverse30sBps:
          value.count === 0 ? 0 : roundMetric(value.adverse30Total / value.count),
        averageMarkout30sUsd:
          value.count === 0 ? 0 : roundMetric(value.markout30Total / value.count),
        fills: value.count
      }
    ])
  );
}

function getMarketProfiles(database: DatabaseSync): ResearchMarketProfileRow[] {
  const activity = getMarketActivity(database);
  const fillRates = getMarketFillRates(database);
  const markout = getPerMarketMarkout(database);
  const recycle = new Map(
    getInventoryRecycle(database).map((row) => [row.marketId, row])
  );
  const marketIds = new Set<number>();

  for (const row of activity) {
    marketIds.add(row.marketId);
  }

  for (const marketId of fillRates.keys()) {
    marketIds.add(marketId);
  }

  for (const marketId of markout.keys()) {
    marketIds.add(marketId);
  }

  for (const marketId of recycle.keys()) {
    marketIds.add(marketId);
  }

  return Array.from(marketIds)
    .sort((a, b) => a - b)
    .map((marketId) => {
      const activityRow = activity.find((row) => row.marketId === marketId);
      const fillRate = fillRates.get(marketId);
      const markoutRow = markout.get(marketId);
      const recycleRow = recycle.get(marketId);

      return {
        marketId,
        segment: activityRow?.segment ?? "watch",
        health: activityRow?.health ?? "active-risky",
        volume24hUsd: activityRow?.volume24hUsd ?? null,
        spread: activityRow?.spread ?? null,
        fillRateAtTouch: fillRate?.fillRateAtTouch ?? 0,
        fillRateNearTouch: fillRate?.fillRateNearTouch ?? 0,
        averageAdverse30sBps: markoutRow?.averageAdverse30sBps ?? 0,
        averageMarkout30sUsd: markoutRow?.averageMarkout30sUsd ?? 0,
        averageSecondsToFlat: recycleRow?.averageSecondsToFlat ?? 0,
        fills: markoutRow?.fills ?? 0
      };
    });
}

export function buildResearchReport(database: DatabaseSync): ResearchReport {
  return {
    collection: getCollectionSummary(database),
    marketActivity: getMarketActivity(database),
    fillRateByDistanceToTouch: getFillRateByDistanceToTouch(database),
    markout: getMarkoutSummary(database),
    inventoryRecycle: getInventoryRecycle(database),
    marketProfiles: getMarketProfiles(database)
  };
}

export function formatResearchReport(report: ResearchReport): string {
  const lines = [
    "Collection coverage",
    `sampledMarkets=${report.collection.sampledMarkets} orderbookEvents=${report.collection.orderbookEvents} lastSaleEvents=${report.collection.lastSaleEvents} orderOpenEvents=${report.collection.orderOpenEvents} fills=${report.collection.fills}`,
    "",
    "Market activity"
  ];

  if (report.marketActivity.length === 0) {
    lines.push("- none");
  } else {
    for (const row of report.marketActivity) {
      lines.push(
        `- market=${row.marketId} segment=${row.segment} health=${row.health} state=${row.currentState ?? "-"} volume24h=${formatNumber(row.volume24hUsd)} spread=${formatNumber(row.spread)} oneSided=${row.hasOneSidedBook ? "yes" : "no"} quoteCountSinceFill=${row.quoteCountSinceFill} boosted=${row.isBoosted ? "yes" : "no"} toxic=${row.isToxic ? "yes" : "no"}`
      );
    }
  }

  lines.push("", "Fill rate by distance-to-touch");

  if (report.fillRateByDistanceToTouch.length === 0) {
    lines.push("- none");
  } else {
    for (const row of report.fillRateByDistanceToTouch) {
      lines.push(
        `- ticks=${row.distanceTicks} orders=${row.orderCount} filled=${row.filledCount} fillRate=${formatNumber(row.fillRate)}`
      );
    }
  }

  lines.push(
    "",
    "Markout",
    `fillCount=${report.markout.fillCount} adverse30sBps=${formatNumber(report.markout.averageAdverse30sBps)} adverse60sBps=${formatNumber(report.markout.averageAdverse60sBps)} markout30sUsd=${formatNumber(report.markout.averageMarkout30sUsd)} markout60sUsd=${formatNumber(report.markout.averageMarkout60sUsd)}`,
    "",
    "Inventory recycle"
  );

  if (report.inventoryRecycle.length === 0) {
    lines.push("- none");
  } else {
    for (const row of report.inventoryRecycle) {
      lines.push(
        `- market=${row.marketId} completedCycles=${row.completedCycles} openCycles=${row.openCycles} averageSecondsToFlat=${formatNumber(row.averageSecondsToFlat)}`
      );
    }
  }

  lines.push("", "Market profiles");

  if (report.marketProfiles.length === 0) {
    lines.push("- none");
  } else {
    for (const row of report.marketProfiles) {
      lines.push(
        `- market=${row.marketId} segment=${row.segment} health=${row.health} volume24h=${formatNumber(row.volume24hUsd)} spread=${formatNumber(row.spread)} fills=${row.fills} fillRateAtTouch=${formatNumber(row.fillRateAtTouch)} fillRateNearTouch=${formatNumber(row.fillRateNearTouch)} adverse30sBps=${formatNumber(row.averageAdverse30sBps)} markout30sUsd=${formatNumber(row.averageMarkout30sUsd)} secondsToFlat=${formatNumber(row.averageSecondsToFlat)}`
      );
    }
  }

  return lines.join("\n");
}
