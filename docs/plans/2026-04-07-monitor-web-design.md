# Monitor Web Design

**Date:** 2026-04-07

**Goal:** Add a lightweight server-local web monitor that exposes the existing runtime monitor snapshot through a small HTTP service and a single auto-refreshing HTML page.

## Context

The current runtime monitor is terminal-only:

- `/Users/jonas/Desktop/predictfun-mm/src/monitor.ts`
- `/Users/jonas/Desktop/predictfun-mm/src/runtime/run-monitor.ts`

That path already builds the right operational snapshot from the analytics SQLite database:

- risk mode
- aggregate portfolio state
- active markets and current quotes
- recent orders
- recent fills
- replay-derived metrics

The missing piece is a server-local web surface that can be opened through an SSH tunnel while the live strategy runs on the same host.

## Requirements

The first version must:

- listen on `127.0.0.1` only
- require no frontend framework
- reuse the existing monitor snapshot instead of creating a second query path
- show aggregate portfolio PnL
- show active markets, recent orders, recent fills, risk, inventory, and account state
- refresh automatically
- expose a machine-readable JSON snapshot endpoint

The first version does not need:

- authentication beyond loopback binding
- charts
- historical browsing
- per-market PnL
- write actions or controls

## Chosen Approach

Add a minimal built-in HTTP service with two endpoints:

- `GET /api/snapshot`
  - returns the current monitor snapshot as JSON
- `GET /`
  - serves a single HTML page with a small inline script
  - polls `/api/snapshot` every 2 seconds

The server should live beside the existing CLI monitor and share the same database-opening logic. The page should render a restrained operations UI with five sections:

1. top summary
2. active markets
3. recent orders
4. recent fills
5. portfolio / private state

## Data Model

The page should render directly from `MonitorSnapshot` in:

- `/Users/jonas/Desktop/predictfun-mm/src/monitor.ts`

This keeps the browser view aligned with the terminal monitor. If the snapshot shape needs adjustment for the web page, the change should happen in `monitor.ts`, not in a web-only query layer.

## Operational Model

The web monitor should run as a separate process and must not interfere with:

- `predictfun-mm-live.service`
- `predictfun-mm-shadow.service`
- `predictfun-mm-batch.service`

It should read the same SQLite database in read-only practice through the existing analytics store path. The service should be suitable for `systemd` and default to a fixed loopback port.

## UI Model

The page should use:

- a light background
- compact tables
- monospace numerics
- green/red only for PnL and risk severity
- a visible last-updated timestamp
- a manual refresh button
- a clear error banner when snapshot fetch fails

The page should optimize for scanning operational state, not presentation polish.

## API and Runtime Compatibility

This feature is intentionally decoupled from Predict REST/WS APIs. It depends only on the local analytics database and existing runtime event recording. That keeps the web monitor stable even if remote API details shift, as long as the runtime continues to populate the same analytics tables.

## Success Criteria

This design is successful if:

- the user can SSH tunnel to a loopback-only page and see current runtime state
- the page shows the same core information as the CLI monitor
- the service runs independently from the live strategy
- deployment only requires one new script and one new `systemd` unit
