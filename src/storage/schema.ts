export const REQUIRED_TABLES = [
  "market_snapshots",
  "orderbook_events",
  "last_sale_events",
  "orders",
  "fills",
  "portfolio_snapshots",
  "market_state_events",
  "risk_events"
] as const;

export const CREATE_TABLE_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS market_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    market_id INTEGER NOT NULL,
    payload_json TEXT NOT NULL,
    recorded_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS orderbook_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    market_id INTEGER NOT NULL,
    best_bid REAL,
    best_ask REAL,
    payload_json TEXT NOT NULL,
    recorded_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS last_sale_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    market_id INTEGER NOT NULL,
    payload_json TEXT NOT NULL,
    recorded_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    market_id INTEGER NOT NULL,
    order_hash TEXT,
    side TEXT NOT NULL,
    status TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    recorded_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS fills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    market_id INTEGER NOT NULL,
    order_hash TEXT,
    payload_json TEXT NOT NULL,
    recorded_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS portfolio_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    flatten_pnl_usd REAL,
    flatten_pnl_pct REAL,
    net_inventory_usd REAL,
    payload_json TEXT NOT NULL,
    recorded_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS market_state_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    market_id INTEGER NOT NULL,
    state TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    recorded_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS risk_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scope TEXT NOT NULL,
    mode TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    recorded_at TEXT NOT NULL
  )`
] as const;
