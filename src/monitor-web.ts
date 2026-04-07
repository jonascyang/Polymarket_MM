import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import type { MonitorSnapshot } from "./monitor";

export type MonitorWebServerOptions = {
  loadSnapshot: () => MonitorSnapshot;
  title?: string;
};

export function createMonitorWebServer(options: MonitorWebServerOptions) {
  const html = renderMonitorWebHtml({ title: options.title });

  return createServer((request, response) => {
    void handleMonitorWebRequest(request, response, options.loadSnapshot, html);
  });
}

export function renderMonitorWebHtml(options: { title?: string } = {}): string {
  const title = options.title ?? "Predict.fun MM Monitor";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root {
        --bg: #06080b;
        --surface: #0b0f14;
        --line: #18202c;
        --line-strong: #273142;
        --text: #d4dbe5;
        --muted: #7f8b9d;
        --accent: #8dd6ff;
        --green: #28c76f;
        --red: #ff5c5c;
        --amber: #f2b84b;
      }
      * { box-sizing: border-box; min-width: 0; }
      html { height: 100%; }
      body {
        margin: 0;
        min-height: 100%;
        font-family: "IBM Plex Mono", "SF Mono", "JetBrains Mono", ui-monospace, monospace;
        background: var(--bg);
        color: var(--text);
      }
      main {
        max-width: 1480px;
        margin: 0 auto;
        padding: 16px 18px 24px;
      }
      .topbar {
        display: flex;
        justify-content: space-between;
        align-items: flex-end;
        gap: 16px;
        padding-bottom: 12px;
        border-bottom: 1px solid var(--line-strong);
      }
      .title h1 {
        margin: 0;
        font-size: 15px;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: var(--accent);
      }
      .title p {
        margin: 4px 0 0;
        color: var(--muted);
        font-size: 11px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .controls {
        display: flex;
        align-items: center;
        gap: 12px;
        color: var(--muted);
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }
      button {
        border: 1px solid var(--line-strong);
        background: transparent;
        color: var(--text);
        padding: 6px 10px;
        cursor: pointer;
        font: inherit;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }
      button:hover {
        color: var(--accent);
        border-color: var(--accent);
      }
      .error {
        display: none;
        margin-top: 10px;
        padding: 8px 0;
        border-bottom: 1px solid rgba(255, 92, 92, 0.35);
        color: var(--red);
      }
      .status-strip {
        display: grid;
        grid-template-columns: repeat(6, minmax(0, 1fr));
        margin-top: 14px;
        border-top: 1px solid var(--line);
        border-bottom: 1px solid var(--line);
        background: var(--surface);
      }
      .metric {
        padding: 10px 12px;
        border-right: 1px solid var(--line);
      }
      .metric:last-child {
        border-right: none;
      }
      .metric-label {
        display: block;
        color: var(--muted);
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.14em;
        margin-bottom: 6px;
      }
      .metric-value {
        display: block;
        font-size: 14px;
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .metric-value.green { color: var(--green); }
      .metric-value.red { color: var(--red); }
      .metric-value.amber { color: var(--amber); }
      .workspace {
        display: grid;
        grid-template-columns: 2fr 1fr;
        gap: 16px;
        margin-top: 16px;
      }
      .stack {
        display: grid;
        gap: 18px;
      }
      .section {
        border-top: 1px solid var(--line-strong);
        padding-top: 10px;
      }
      .section-head {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: baseline;
        margin-bottom: 8px;
      }
      .section-head h2 {
        margin: 0 0 12px;
        font-size: 11px;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: var(--muted);
      }
      .section-head span {
        color: var(--muted);
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.12em;
      }
      .table-wrap {
        overflow-x: auto;
        border-bottom: 1px solid var(--line);
      }
      table {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
        font-size: 12px;
      }
      th, td {
        text-align: left;
        padding: 8px 10px;
        border-top: 1px solid var(--line);
        vertical-align: top;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        max-width: 0;
      }
      thead th {
        border-top: none;
        color: var(--muted);
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.14em;
        font-weight: 500;
      }
      tbody tr:hover {
        background: rgba(141, 214, 255, 0.04);
      }
      .wrap {
        white-space: normal;
        text-overflow: clip;
        overflow-wrap: anywhere;
      }
      .portfolio-grid {
        display: grid;
        gap: 0;
        font-size: 13px;
        border-bottom: 1px solid var(--line);
      }
      .portfolio-row {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        padding: 8px 0;
        border-top: 1px solid var(--line);
      }
      .muted { color: var(--muted); }
      @media (max-width: 1100px) {
        .status-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .workspace { grid-template-columns: 1fr; }
      }
      @media (max-width: 720px) {
        .topbar {
          flex-direction: column;
          align-items: flex-start;
        }
        .controls {
          flex-wrap: wrap;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <div class="topbar">
        <div class="title">
          <h1>${escapeHtml(title)}</h1>
          <p>Last updated <span id="last-updated">-</span></p>
        </div>
        <div class="controls">
          <span>Desk view</span>
          <span>Auto-refresh: 250ms</span>
          <button id="refresh-button" type="button">Refresh</button>
        </div>
      </div>
      <div id="error-banner" class="error" role="alert"></div>
      <section class="status-strip">
        <div class="metric">
          <span class="metric-label">Risk</span>
          <span id="risk-mode" class="metric-value">-</span>
        </div>
        <div class="metric">
          <span class="metric-label">Total PnL</span>
          <span id="total-pnl" class="metric-value">-</span>
        </div>
        <div class="metric">
          <span class="metric-label">Net Inventory</span>
          <span id="net-inventory" class="metric-value">-</span>
        </div>
        <div class="metric">
          <span class="metric-label">Open Orders</span>
          <span id="open-orders" class="metric-value">-</span>
        </div>
        <div class="metric">
          <span class="metric-label">Positions</span>
          <span id="positions" class="metric-value">-</span>
        </div>
        <div class="metric">
          <span class="metric-label">Account</span>
          <span id="account-address" class="metric-value wrap">-</span>
        </div>
      </section>
      <div class="workspace">
        <div class="stack">
          <section class="section">
            <div class="section-head">
              <h2>Active Markets</h2>
              <span>Live routing state</span>
            </div>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Market</th>
                    <th>State</th>
                    <th>Mode</th>
                    <th>Quote</th>
                    <th>Book</th>
                    <th>Health</th>
                    <th>Churn</th>
                  </tr>
                </thead>
                <tbody id="active-markets-body"></tbody>
              </table>
            </div>
          </section>
          <section class="section">
            <div class="section-head">
              <h2>Recent Orders</h2>
              <span>Execution tape</span>
            </div>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Market</th>
                    <th>Side</th>
                    <th>Status</th>
                    <th>Price</th>
                    <th>Size</th>
                  </tr>
                </thead>
                <tbody id="recent-orders-body"></tbody>
              </table>
            </div>
          </section>
          <section class="section">
            <div class="section-head">
              <h2>Recent Fills</h2>
              <span>Fill tape</span>
            </div>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Market</th>
                    <th>Side</th>
                    <th>Price</th>
                    <th>Size</th>
                    <th>Inventory Delta</th>
                  </tr>
                </thead>
                <tbody id="recent-fills-body"></tbody>
              </table>
            </div>
          </section>
        </div>
        <div class="stack">
          <section class="section">
            <div class="section-head">
              <h2>Portfolio</h2>
              <span>Account state</span>
            </div>
            <div class="portfolio-grid">
              <div class="portfolio-row"><span class="muted">Flatten PnL USD</span><span id="portfolio-flatten-pnl">-</span></div>
              <div class="portfolio-row"><span class="muted">Flatten PnL %</span><span id="portfolio-flatten-pct">-</span></div>
              <div class="portfolio-row"><span class="muted">Net Inventory USD</span><span id="portfolio-inventory">-</span></div>
              <div class="portfolio-row"><span class="muted">Open Orders</span><span id="portfolio-open-orders">-</span></div>
              <div class="portfolio-row"><span class="muted">Normalized Open Orders</span><span id="portfolio-normalized-open-orders">-</span></div>
              <div class="portfolio-row"><span class="muted">Has Unnormalized Open Orders</span><span id="portfolio-unnormalized-flag">-</span></div>
              <div class="portfolio-row"><span class="muted">JWT Present</span><span id="portfolio-jwt">-</span></div>
            </div>
          </section>
        </div>
      </div>
    </main>
    <script>
      const state = {
        timer: null
      };

      function formatUsd(value) {
        if (value === null || value === undefined || Number.isNaN(value)) return "-";
        return Number(value).toFixed(2) + " USD";
      }

      function formatPct(value) {
        if (value === null || value === undefined || Number.isNaN(value)) return "-";
        return (Number(value) * 100).toFixed(2) + "%";
      }

      function formatPrice(value) {
        if (value === null || value === undefined || Number.isNaN(value)) return "-";
        return Number(value).toFixed(3);
      }

      function riskClass(mode) {
        if (mode === "Normal") return "green";
        if (mode === "SoftStop") return "amber";
        if (mode === "HardStop" || mode === "Catastrophic") return "red";
        return "";
      }

      function pnlClass(value) {
        if (value === null || value === undefined || Number.isNaN(value) || value === 0) return "";
        return value < 0 ? "red" : "green";
      }

      function rowOrNone(columns, text) {
        return '<tr><td colspan="' + columns + '" class="muted">' + text + '</td></tr>';
      }

      function renderRows(targetId, rows, columns, buildRow) {
        const target = document.getElementById(targetId);
        target.innerHTML = rows.length === 0 ? rowOrNone(columns, 'none') : rows.map(buildRow).join('');
      }

      function applySnapshot(snapshot) {
        document.getElementById('last-updated').textContent = snapshot.generatedAt ?? '-';
        const risk = document.getElementById('risk-mode');
        risk.textContent = snapshot.risk.mode + (snapshot.risk.reason ? ' (' + snapshot.risk.reason + ')' : '');
        risk.className = 'metric-value ' + riskClass(snapshot.risk.mode);

        const totalPnl = document.getElementById('total-pnl');
        totalPnl.textContent = formatUsd(snapshot.portfolio.flattenPnlUsd);
        totalPnl.className = 'metric-value ' + pnlClass(snapshot.portfolio.flattenPnlUsd);

        document.getElementById('net-inventory').textContent = formatUsd(snapshot.portfolio.netInventoryUsd);
        document.getElementById('open-orders').textContent = String(snapshot.privateState?.openOrders ?? 0);
        document.getElementById('positions').textContent = String(snapshot.privateState?.positions ?? 0);
        document.getElementById('account-address').textContent = snapshot.privateState?.accountAddress ?? '-';

        document.getElementById('portfolio-flatten-pnl').textContent = formatUsd(snapshot.portfolio.flattenPnlUsd);
        document.getElementById('portfolio-flatten-pct').textContent = formatPct(snapshot.portfolio.flattenPnlPct);
        document.getElementById('portfolio-inventory').textContent = formatUsd(snapshot.portfolio.netInventoryUsd);
        document.getElementById('portfolio-open-orders').textContent = String(snapshot.privateState?.openOrders ?? 0);
        document.getElementById('portfolio-normalized-open-orders').textContent = String(snapshot.privateState?.normalizedOpenOrders ?? 0);
        document.getElementById('portfolio-unnormalized-flag').textContent = snapshot.privateState?.hasUnnormalizedOpenOrders ? 'yes' : 'no';
        document.getElementById('portfolio-jwt').textContent = snapshot.privateState?.bearerTokenPresent ? 'yes' : 'no';

        renderRows('active-markets-body', snapshot.activeMarkets ?? [], 7, (market) =>
          '<tr>' +
          '<td>' + market.marketId + '</td>' +
          '<td>' + (market.state ?? '-') + '</td>' +
          '<td>' + (market.selectedMode ?? '-') + '</td>' +
          '<td class="wrap">' + formatPrice(market.quoteBid) + ' / ' + formatPrice(market.quoteAsk) + ' @ ' + formatUsd(market.quoteBidSizeUsd) + ' / ' + formatUsd(market.quoteAskSizeUsd) + '</td>' +
          '<td>' + formatPrice(market.bestBid) + ' / ' + formatPrice(market.bestAsk) + '</td>' +
          '<td>' + (market.health ?? '-') + '</td>' +
          '<td>' + String(market.quoteCountSinceFill ?? 0) + '</td>' +
          '</tr>'
        );

        renderRows('recent-orders-body', snapshot.recentOrders ?? [], 6, (order) =>
          '<tr>' +
          '<td class="wrap">' + (order.recordedAt ?? '-') + '</td>' +
          '<td>' + order.marketId + '</td>' +
          '<td>' + (order.side ?? '-') + '</td>' +
          '<td>' + (order.status ?? '-') + '</td>' +
          '<td>' + formatPrice(order.price) + '</td>' +
          '<td>' + formatUsd(order.sizeUsd) + '</td>' +
          '</tr>'
        );

        renderRows('recent-fills-body', snapshot.recentFills ?? [], 6, (fill) =>
          '<tr>' +
          '<td class="wrap">' + (fill.recordedAt ?? '-') + '</td>' +
          '<td>' + fill.marketId + '</td>' +
          '<td>' + (fill.side ?? '-') + '</td>' +
          '<td>' + formatPrice(fill.price) + '</td>' +
          '<td>' + formatUsd(fill.sizeUsd) + '</td>' +
          '<td>' + formatUsd(fill.inventoryDeltaUsd) + '</td>' +
          '</tr>'
        );
      }

      async function refreshSnapshot() {
        const banner = document.getElementById('error-banner');

        try {
          const response = await fetch('/api/snapshot');
          if (!response.ok) {
            const payload = await response.json().catch(() => ({ error: 'request failed' }));
            throw new Error(payload.error || 'request failed');
          }

          const snapshot = await response.json();
          banner.style.display = 'none';
          banner.textContent = '';
          applySnapshot(snapshot);
        } catch (error) {
          banner.style.display = 'block';
          banner.textContent = 'Snapshot load failed: ' + (error?.message ?? String(error));
        }
      }

      document.getElementById('refresh-button').addEventListener('click', () => {
        void refreshSnapshot();
      });

      void refreshSnapshot();
      state.timer = setInterval(() => void refreshSnapshot(), 250);
    </script>
  </body>
</html>`;
}

async function handleMonitorWebRequest(
  request: IncomingMessage,
  response: ServerResponse,
  loadSnapshot: () => MonitorSnapshot,
  html: string
): Promise<void> {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", "http://127.0.0.1");

  if (method === "GET" && url.pathname === "/") {
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store"
    });
    response.end(html);
    return;
  }

  if (method === "GET" && url.pathname === "/api/snapshot") {
    try {
      const snapshot = loadSnapshot();
      response.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store"
      });
      response.end(JSON.stringify(snapshot));
    } catch (error) {
      response.writeHead(500, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store"
      });
      response.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : String(error)
        })
      );
    }

    return;
  }

  if (method === "GET" && url.pathname === "/favicon.ico") {
    response.writeHead(204);
    response.end();
    return;
  }

  response.writeHead(404, {
    "content-type": "text/plain; charset=utf-8"
  });
  response.end("Not found");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
