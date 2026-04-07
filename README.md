# Predict MM

`predict-mm` is a replayable `predict.fun` market-making runtime with a local analytics store, research collection utilities, and archive/report tooling around the same recorded event stream.

## Status

Primary runtime entrypoints are:

- `npm run paper`
- `npm run shadow`
- `npm run live`
- `npm run monitor`

Research and archive entrypoints are explicit operational commands:

- `npm run collect` samples open markets, orderbooks, last sales, and regime snapshots into the local SQLite store
- `npm run report` reads the local SQLite store and prints a research summary
- `npm run archive` uploads local archive files to R2 when archive and R2 configuration are present
- `npm run batch` combines collection, reporting, and optional archive upload in one explicit operational command

`docs/plans/` contains planning artifacts. The executable entrypoints are the scripts above plus the runtime modules under `src/runtime/`.

## Environment

Core configuration:

- `PREDICT_API_BASE_URL`
- `PREDICT_WS_URL`
- `PREDICT_API_KEY`
- `PREDICT_MM_DB_PATH`

Optional runtime configuration:

- `PREDICT_AUTH_BEARER_TOKEN`
- `PREDICT_RUNTIME_INTERVAL_MS`
- `PREDICT_MM_WALLET_PRIVATE_KEY`
- `PREDICT_MM_PREDICT_ACCOUNT`

Optional archive configuration:

- `PREDICT_MM_ARCHIVE_DIR`
- `PREDICT_MM_R2_ENDPOINT`
- `PREDICT_MM_R2_BUCKET`
- `PREDICT_MM_R2_ACCESS_KEY_ID`
- `PREDICT_MM_R2_SECRET_ACCESS_KEY`
- `PREDICT_MM_R2_PREFIX`
- `PREDICT_MM_R2_REGION`

Private trading routes require a JWT obtained through the official auth flow documented at:

- [Predict auth docs](https://dev.predict.fun/doc-663127)
- [Predict API explorer](https://api.predict.fun/docs)

When `PREDICT_AUTH_BEARER_TOKEN` is not set, `npm run live` can obtain a JWT automatically:

- for EOAs, it signs the auth message with `wallet.signMessage`
- for Predict Accounts, it uses the official `@predictdotfun/sdk` order builder with `PREDICT_MM_PREDICT_ACCOUNT`

## Scripts

- `npm test`: run the Vitest suite
- `npm run typecheck`: run TypeScript typechecking
- `npm run paper`: start the paper runtime loop
- `npm run shadow`: start the shadow runtime loop
- `npm run live`: start the live runtime loop with signed order placement
- `npm run monitor`: render a terminal snapshot from the local SQLite store
- `npm run collect`: run the research sampler once, or continuously unless `--once` is passed
- `npm run report`: print the research report from the local SQLite store
- `npm run archive`: upload pending local archive objects to R2
- `npm run batch`: run the recommended explicit research operations flow once

`paper`, `shadow`, and `live` print JSON bootstrap/cycle snapshots and stop cleanly on `SIGINT` / `SIGTERM`.
`monitor` supports `--once` and `--interval-ms=...`.
`collect` supports `--once`, `--interval-ms=...`, and `--first=...`.
`report` supports `--db=...` and `--json`.
`archive` supports `--min-age-ms=...`.
`batch` is intended to accept `--first=...`, `--report-json`, and `--min-age-ms=...`.

Examples:

```bash
npm run batch -- --first=25
npm run batch -- --first=25 --report-json
npm run batch -- --first=25 --report-json --min-age-ms=300000
```

## Current modules

- REST, auth, websocket, and R2 clients
- local analytics SQLite store
- market recorder and local event archive
- runtime loop and live execution wiring
- monitor, replay, and research report tooling

## Balanced whitelist maker

The runtime now operates as a balanced whitelist maker:

- `core sports pool`: long-horizon sports winner markets
- `satellite token pool`: a smaller token launch / FDV market set

Market execution states are:

- `Quote`: normal near-touch quoting
- `Throttle`: same quoting model with slower refresh cadence and smaller churn
- `Protect`: single-sided or inventory-relieving quoting only
- `Pause`: market stays observed but does not place fresh quotes
- `Stop`: market is fully stopped because portfolio or market risk escalated

Research and monitor outputs expose the current runtime health classification:

- `active-safe`
- `active-risky`
- `inactive-or-toxic`

`npm run monitor` now prints health, per-side quote sizes, and replay totals using the same `quote` / `protect` language as the runtime.

## Server operation

The recommended server setup is:

- keep `npm run shadow` running continuously under `systemd`
- run `npm run batch -- --first=100 --report-json` on an hourly timer
- use `npm run monitor -- --once` manually against the same SQLite database when you want a point-in-time terminal view

Deployment assets live in:

- `ops/systemd/predictfun-mm-shadow.service`
- `ops/systemd/predictfun-mm-batch.service`
- `ops/systemd/predictfun-mm-batch.timer`

Create `/etc/predictfun-mm/predictfun-mm.env` with at least:

```bash
PREDICT_MM_WORKDIR=/opt/predictfun-mm
PREDICT_API_BASE_URL=https://api.predict.fun/v1
PREDICT_WS_URL=wss://ws.predict.fun/ws
PREDICT_API_KEY=...
PREDICT_MM_DB_PATH=/var/lib/predictfun-mm/predict-mm.sqlite
PREDICT_RUNTIME_INTERVAL_MS=5000
```

Optional environment values like `PREDICT_AUTH_BEARER_TOKEN`, archive settings, and R2 credentials can live in the same file.

Install and enable the services:

```bash
sudo mkdir -p /etc/predictfun-mm
cd /opt/predictfun-mm
npm install
sudo cp ops/systemd/predictfun-mm-shadow.service /etc/systemd/system/
sudo cp ops/systemd/predictfun-mm-batch.service /etc/systemd/system/
sudo cp ops/systemd/predictfun-mm-batch.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now predictfun-mm-shadow.service
sudo systemctl enable --now predictfun-mm-batch.timer
```

Inspect them with:

```bash
sudo systemctl status predictfun-mm-shadow.service
sudo systemctl status predictfun-mm-batch.timer
sudo journalctl -u predictfun-mm-shadow.service -f
sudo journalctl -u predictfun-mm-batch.service -n 100
```

## Notes

- `collect`, `report`, and `archive` are not wired into the default `paper` / `shadow` / `live` loops. They are focused operational utilities.
- `batch` is the recommended explicit research operations entrypoint.
- Local event archiving is only active when `PREDICT_MM_ARCHIVE_DIR` is configured.
- Remote archive upload is only active when the R2 configuration is present and `npm run archive` or `npm run batch` is executed.
