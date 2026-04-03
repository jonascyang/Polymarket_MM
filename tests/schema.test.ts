import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";

import { REQUIRED_TABLES } from "../src/storage/schema";
import { openAnalyticsStore } from "../src/storage/sqlite";

describe("storage schema", () => {
  it("declares the recorder, archive, and trading tables", () => {
    expect(REQUIRED_TABLES).toEqual([
      "market_snapshots",
      "orderbook_events",
      "last_sale_events",
      "orders",
      "order_events",
      "fills",
      "fill_outcomes",
      "portfolio_snapshots",
      "market_state_events",
      "risk_events",
      "market_regime_snapshots"
    ]);
  });

  it("migrates an existing analytics database to add archive columns and tables", () => {
    const directory = mkdtempSync(join(tmpdir(), "predict-mm-schema-"));
    const dbPath = join(directory, "analytics.sqlite");
    const legacyDatabase = new DatabaseSync(dbPath);

    legacyDatabase.exec(`
      CREATE TABLE market_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        market_id INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        recorded_at TEXT NOT NULL
      );
      CREATE TABLE orderbook_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        market_id INTEGER NOT NULL,
        best_bid REAL,
        best_ask REAL,
        payload_json TEXT NOT NULL,
        recorded_at TEXT NOT NULL
      );
      CREATE TABLE last_sale_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        market_id INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        recorded_at TEXT NOT NULL
      );
      CREATE TABLE orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        market_id INTEGER NOT NULL,
        order_hash TEXT,
        side TEXT NOT NULL,
        status TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        recorded_at TEXT NOT NULL
      );
      CREATE TABLE fills (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        market_id INTEGER NOT NULL,
        order_hash TEXT,
        payload_json TEXT NOT NULL,
        recorded_at TEXT NOT NULL
      );
      CREATE TABLE portfolio_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        flatten_pnl_usd REAL,
        flatten_pnl_pct REAL,
        net_inventory_usd REAL,
        payload_json TEXT NOT NULL,
        recorded_at TEXT NOT NULL
      );
      CREATE TABLE market_state_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        market_id INTEGER NOT NULL,
        state TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        recorded_at TEXT NOT NULL
      );
      CREATE TABLE risk_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scope TEXT NOT NULL,
        mode TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        recorded_at TEXT NOT NULL
      );
    `);
    legacyDatabase.close();

    const migrated = openAnalyticsStore(dbPath);
    const orderbookColumns = migrated
      .prepare("PRAGMA table_info(orderbook_events)")
      .all() as Array<{ name: string }>;
    const fillColumns = migrated
      .prepare("PRAGMA table_info(fills)")
      .all() as Array<{ name: string }>;
    const tables = migrated
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as Array<{ name: string }>;

    expect(orderbookColumns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "source_update_timestamp_ms",
        "mid",
        "spread",
        "bids_json",
        "asks_json",
        "bid_depth_1",
        "ask_depth_1",
        "bid_depth_3",
        "ask_depth_3",
        "bid_depth_5",
        "ask_depth_5",
        "imbalance_1",
        "imbalance_3",
        "imbalance_5"
      ])
    );
    expect(fillColumns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "side",
        "price",
        "size_usd",
        "inventory_delta_usd",
        "inventory_after_usd",
        "mid_at_fill",
        "spread_at_fill"
      ])
    );
    expect(tables.map((row) => row.name)).toEqual(
      expect.arrayContaining([
        "order_events",
        "fill_outcomes",
        "market_regime_snapshots"
      ])
    );

    migrated.close();
    rmSync(directory, { recursive: true, force: true });
  });
});
