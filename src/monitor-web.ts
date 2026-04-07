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
        --bg: #f4f2ec;
        --panel: #fffdf8;
        --border: #dad2c4;
        --text: #1e1f1b;
        --muted: #6d705f;
        --green: #197b47;
        --red: #af2c2c;
        --amber: #8a5b00;
        --shadow: rgba(38, 33, 24, 0.08);
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "SF Mono", "IBM Plex Mono", "JetBrains Mono", ui-monospace, monospace;
        background: linear-gradient(180deg, #f7f4ed 0%, var(--bg) 100%);
        color: var(--text);
      }
      main {
        max-width: 1360px;
        margin: 0 auto;
        padding: 24px;
      }
      .topbar {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        align-items: flex-start;
        margin-bottom: 18px;
      }
      .title h1 {
        margin: 0;
        font-size: 28px;
        letter-spacing: -0.03em;
      }
      .title p {
        margin: 8px 0 0;
        color: var(--muted);
        font-size: 13px;
      }
      .controls {
        display: flex;
        align-items: center;
        gap: 12px;
      }
      button {
        border: 1px solid var(--border);
        background: var(--panel);
        color: var(--text);
        border-radius: 999px;
        padding: 10px 16px;
        cursor: pointer;
        box-shadow: 0 8px 24px var(--shadow);
      }
      .error {
        display: none;
        margin-bottom: 16px;
        padding: 12px 14px;
        border: 1px solid rgba(175, 44, 44, 0.25);
        background: rgba(175, 44, 44, 0.08);
        color: var(--red);
        border-radius: 12px;
      }
      .summary-grid {
        display: grid;
        grid-template-columns: repeat(6, minmax(0, 1fr));
        gap: 12px;
        margin-bottom: 18px;
      }
      .summary-card, .panel {
        border: 1px solid var(--border);
        background: var(--panel);
        border-radius: 16px;
        box-shadow: 0 10px 30px var(--shadow);
      }
      .summary-card {
        padding: 14px 16px;
      }
      .summary-label {
        color: var(--muted);
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }
      .summary-value {
        margin-top: 8px;
        font-size: 24px;
        font-weight: 700;
      }
      .summary-value.green { color: var(--green); }
      .summary-value.red { color: var(--red); }
      .summary-value.amber { color: var(--amber); }
      .panel-grid {
        display: grid;
        grid-template-columns: 2fr 1fr;
        gap: 16px;
      }
      .panel {
        padding: 16px;
      }
      .panel h2 {
        margin: 0 0 12px;
        font-size: 18px;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 13px;
      }
      th, td {
        text-align: left;
        padding: 8px 10px;
        border-top: 1px solid #ece5d8;
        vertical-align: top;
      }
      thead th {
        border-top: none;
        color: var(--muted);
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.07em;
      }
      .stack {
        display: grid;
        gap: 16px;
      }
      .meta-list {
        display: grid;
        gap: 10px;
        font-size: 13px;
      }
      .meta-row {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        border-top: 1px solid #ece5d8;
        padding-top: 10px;
      }
      .muted { color: var(--muted); }
      @media (max-width: 1100px) {
        .summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .panel-grid { grid-template-columns: 1fr; }
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
          <span class="muted">Auto-refresh: 250ms</span>
          <button id="refresh-button" type="button">Refresh</button>
        </div>
      </div>
      <div id="error-banner" class="error" role="alert"></div>
      <section class="summary-grid">
        <article class="summary-card">
          <div class="summary-label">Risk</div>
          <div id="risk-mode" class="summary-value">-</div>
        </article>
        <article class="summary-card">
          <div class="summary-label">Total PnL</div>
          <div id="total-pnl" class="summary-value">-</div>
        </article>
        <article class="summary-card">
          <div class="summary-label">Net Inventory</div>
          <div id="net-inventory" class="summary-value">-</div>
        </article>
        <article class="summary-card">
          <div class="summary-label">Open Orders</div>
          <div id="open-orders" class="summary-value">-</div>
        </article>
        <article class="summary-card">
          <div class="summary-label">Positions</div>
          <div id="positions" class="summary-value">-</div>
        </article>
        <article class="summary-card">
          <div class="summary-label">Account</div>
          <div id="account-address" class="summary-value" style="font-size: 16px;">-</div>
        </article>
      </section>
      <div class="panel-grid">
        <div class="stack">
          <section class="panel">
            <h2>Active Markets</h2>
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
          </section>
          <section class="panel">
            <h2>Recent Orders</h2>
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
          </section>
          <section class="panel">
            <h2>Recent Fills</h2>
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
          </section>
        </div>
        <div class="stack">
          <section class="panel">
            <h2>Portfolio</h2>
            <div class="meta-list">
              <div class="meta-row"><span class="muted">Flatten PnL USD</span><span id="portfolio-flatten-pnl">-</span></div>
              <div class="meta-row"><span class="muted">Flatten PnL %</span><span id="portfolio-flatten-pct">-</span></div>
              <div class="meta-row"><span class="muted">Net Inventory USD</span><span id="portfolio-inventory">-</span></div>
              <div class="meta-row"><span class="muted">Open Orders</span><span id="portfolio-open-orders">-</span></div>
              <div class="meta-row"><span class="muted">Normalized Open Orders</span><span id="portfolio-normalized-open-orders">-</span></div>
              <div class="meta-row"><span class="muted">Has Unnormalized Open Orders</span><span id="portfolio-unnormalized-flag">-</span></div>
              <div class="meta-row"><span class="muted">JWT Present</span><span id="portfolio-jwt">-</span></div>
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
        risk.className = 'summary-value ' + riskClass(snapshot.risk.mode);

        const totalPnl = document.getElementById('total-pnl');
        totalPnl.textContent = formatUsd(snapshot.portfolio.flattenPnlUsd);
        totalPnl.className = 'summary-value ' + pnlClass(snapshot.portfolio.flattenPnlUsd);

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
          '<td>' + formatPrice(market.quoteBid) + ' / ' + formatPrice(market.quoteAsk) + ' @ ' + formatUsd(market.quoteBidSizeUsd) + ' / ' + formatUsd(market.quoteAskSizeUsd) + '</td>' +
          '<td>' + formatPrice(market.bestBid) + ' / ' + formatPrice(market.bestAsk) + '</td>' +
          '<td>' + (market.health ?? '-') + '</td>' +
          '<td>' + String(market.quoteCountSinceFill ?? 0) + '</td>' +
          '</tr>'
        );

        renderRows('recent-orders-body', snapshot.recentOrders ?? [], 6, (order) =>
          '<tr>' +
          '<td>' + (order.recordedAt ?? '-') + '</td>' +
          '<td>' + order.marketId + '</td>' +
          '<td>' + (order.side ?? '-') + '</td>' +
          '<td>' + (order.status ?? '-') + '</td>' +
          '<td>' + formatPrice(order.price) + '</td>' +
          '<td>' + formatUsd(order.sizeUsd) + '</td>' +
          '</tr>'
        );

        renderRows('recent-fills-body', snapshot.recentFills ?? [], 6, (fill) =>
          '<tr>' +
          '<td>' + (fill.recordedAt ?? '-') + '</td>' +
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
