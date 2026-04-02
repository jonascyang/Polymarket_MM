# Predict MM

`predict-mm` is a replayable `predict.fun` market-making runtime built around three ideas:

- points-first quoting
- hard inventory and time exits
- identical core logic across paper, shadow, and live modes

## Environment

Set these variables before running:

- `PREDICT_API_BASE_URL`
- `PREDICT_WS_URL`
- `PREDICT_API_KEY`
- `PREDICT_MM_DB_PATH`
- `PREDICT_AUTH_BEARER_TOKEN` (optional, enables private account/orders/positions reads and can be reused by `npm run live`)
- `PREDICT_RUNTIME_INTERVAL_MS` (optional, polling interval override in milliseconds for the runtime loop)
- `PREDICT_MM_WALLET_PRIVATE_KEY` (required by `npm run live` for signed live order placement)
- `PREDICT_MM_PREDICT_ACCOUNT` (optional, passed through to the official SDK when your trading wallet uses a separate predict account)

Private trading routes also require a JWT obtained through the official auth flow documented at:

- [Predict auth docs](https://dev.predict.fun/doc-663127)
- [Predict API explorer](https://api.predict.fun/docs)

When no bearer token is preconfigured, the runtime can also obtain a JWT through the official auth flow if a signer callback is injected by the host application.
`npm run live` now does this automatically from `PREDICT_MM_WALLET_PRIVATE_KEY`; if `PREDICT_AUTH_BEARER_TOKEN` is already set, it reuses that token instead of re-authenticating.

## Scripts

- `npm test`
- `npm run typecheck`
- `npm run paper`
- `npm run shadow`
- `npm run live`

The three runtime scripts now start a long-lived polling loop, print JSON snapshots on bootstrap and every cycle, and stop cleanly on `SIGINT` / `SIGTERM`.
`npm run live` also wires the official `@predictdotfun/sdk` order builder into the loop so live create/cancel commands are signed and submitted through the official flow.

## Current modules

- REST, auth, and websocket clients
- local analytics store
- market recorder
- market selection
- state machine
- quote engine
- risk controller
- execution reconciliation
- replay summary tooling

## Notes

- The runtime currently provides the execution-policy and orchestration skeleton for `paper`, `shadow`, and `live`.
- Replay currently supports summary aggregation from recorded events; deeper historical playback can build on top of the same interfaces.
