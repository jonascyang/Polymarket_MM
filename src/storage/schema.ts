export const REQUIRED_TABLES = [
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
    source_update_timestamp_ms INTEGER,
    mid REAL,
    spread REAL,
    bids_json TEXT,
    asks_json TEXT,
    bid_depth_1 REAL,
    ask_depth_1 REAL,
    bid_depth_3 REAL,
    ask_depth_3 REAL,
    bid_depth_5 REAL,
    ask_depth_5 REAL,
    imbalance_1 REAL,
    imbalance_3 REAL,
    imbalance_5 REAL,
    payload_json TEXT NOT NULL,
    recorded_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS last_sale_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    market_id INTEGER NOT NULL,
    price REAL,
    quote_type TEXT,
    outcome TEXT,
    strategy TEXT,
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
  `CREATE TABLE IF NOT EXISTS order_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    market_id INTEGER NOT NULL,
    client_order_key TEXT,
    exchange_order_id TEXT,
    token_id TEXT,
    logical_side TEXT,
    exchange_side TEXT,
    price REAL,
    size_usd REAL,
    size_shares REAL,
    queue_ahead_shares_est REAL,
    event_type TEXT NOT NULL,
    submit_time TEXT,
    ack_time TEXT,
    open_time TEXT,
    cancel_request_time TEXT,
    cancel_ack_time TEXT,
    payload_json TEXT NOT NULL,
    recorded_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS fills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    market_id INTEGER NOT NULL,
    order_hash TEXT,
    side TEXT,
    price REAL,
    size_usd REAL,
    inventory_delta_usd REAL,
    inventory_after_usd REAL,
    mid_at_fill REAL,
    spread_at_fill REAL,
    bid_depth_1_at_fill REAL,
    ask_depth_1_at_fill REAL,
    payload_json TEXT NOT NULL,
    recorded_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS fill_outcomes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fill_id INTEGER NOT NULL,
    mid_plus_1s REAL,
    mid_plus_5s REAL,
    mid_plus_30s REAL,
    mid_plus_60s REAL,
    adverse_move_1s_bps REAL,
    adverse_move_5s_bps REAL,
    adverse_move_30s_bps REAL,
    adverse_move_60s_bps REAL,
    markout_1s_usd REAL,
    markout_5s_usd REAL,
    markout_30s_usd REAL,
    markout_60s_usd REAL,
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
  )`,
  `CREATE TABLE IF NOT EXISTS market_regime_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    market_id INTEGER NOT NULL,
    current_state TEXT,
    minutes_to_resolution REAL,
    is_boosted INTEGER NOT NULL,
    volume24h_usd REAL,
    mid REAL,
    spread REAL,
    trade_age_ms INTEGER,
    is_toxic INTEGER NOT NULL,
    payload_json TEXT NOT NULL,
    recorded_at TEXT NOT NULL
  )`
] as const;

export const REQUIRED_TABLE_COLUMNS: Record<string, Record<string, string>> = {
  orderbook_events: {
    source_update_timestamp_ms: "INTEGER",
    mid: "REAL",
    spread: "REAL",
    bids_json: "TEXT",
    asks_json: "TEXT",
    bid_depth_1: "REAL",
    ask_depth_1: "REAL",
    bid_depth_3: "REAL",
    ask_depth_3: "REAL",
    bid_depth_5: "REAL",
    ask_depth_5: "REAL",
    imbalance_1: "REAL",
    imbalance_3: "REAL",
    imbalance_5: "REAL"
  },
  last_sale_events: {
    price: "REAL",
    quote_type: "TEXT",
    outcome: "TEXT",
    strategy: "TEXT"
  },
  fills: {
    side: "TEXT",
    price: "REAL",
    size_usd: "REAL",
    inventory_delta_usd: "REAL",
    inventory_after_usd: "REAL",
    mid_at_fill: "REAL",
    spread_at_fill: "REAL",
    bid_depth_1_at_fill: "REAL",
    ask_depth_1_at_fill: "REAL"
  }
};
