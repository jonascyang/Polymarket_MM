# Balanced Whitelist Maker Design

**Date:** 2026-04-03

**Goal:** Build a first-phase maker strategy that focuses on a small whitelist of high-activity markets, satisfies platform spread constraints, avoids long periods of meaningless quote churn, and keeps losses bounded even if the strategy is only breakeven or slightly negative.

## Context

The current mainnet market universe is broad but low quality for blanket market making. Based on public-market scans using the official Predict endpoints:

- `GET /v1/markets`
- `GET /v1/markets/{id}/orderbook`
- `GET /v1/markets/{id}/last-sale`

the `OPEN` universe is heavily concentrated in a small number of markets and contains a large number of thin or one-sided books. The current codebase already has a basic strategy skeleton in:

- `/Users/jonas/Desktop/predictfun-mm/src/strategy/market-filter.ts`
- `/Users/jonas/Desktop/predictfun-mm/src/strategy/market-selector.ts`
- `/Users/jonas/Desktop/predictfun-mm/src/strategy/state-machine.ts`
- `/Users/jonas/Desktop/predictfun-mm/src/runtime/runtime.ts`
- `/Users/jonas/Desktop/predictfun-mm/src/runtime/runtime-loop.ts`

That skeleton is still oriented toward an older boost-first selection model. This design replaces that with a whitelist-first, activity-aware model.

Official references:

- [Get markets](https://dev.predict.fun/get-markets-25326905e0)
- [Get the orderbook for a market](https://dev.predict.fun/get-the-orderbook-for-a-market-25326908e0)
- [Get market last sale information](https://dev.predict.fun/get-market-last-sale-information-25326907e0)
- [Understanding the Orderbook](https://dev.predict.fun/understanding-the-orderbook-685654m0)

## Non-Goals

- No predictive alpha model.
- No full-platform blanket quoting.
- No assumption that `isBoosted` equals baseline points eligibility.
- No requirement for strong profitability in phase 1.
- No aggressive taker flow or cross-market arb in the first release.

## Chosen Approach

The strategy will be a `balanced whitelist maker`:

- `core sports pool`
  - Long-duration sports outrights only.
  - Examples: World Cup winner, NBA champion, Champions League winner, selective EPL winner markets.
- `satellite token pool`
  - Small set of token launch / FDV markets.
  - Examples: OpenSea token/FDV, Polymarket token, MegaETH FDV, selective Abstract FDV markets.

The strategy acts as a constrained passive maker:

- quote only on approved markets
- quote only within spread rules
- prefer near-touch passive liquidity
- accept some idle quoting
- penalize excessive quote churn with no fills
- use strict inventory and loss controls

## Market Pool Model

Each market is assigned one of three operational labels:

- `active-safe`
  - Stable enough for normal phase-1 quoting.
- `active-risky`
  - Has real activity but needs smaller size, lower update frequency, and tighter risk gates.
- `inactive-or-toxic`
  - Observe only. No quoting.

The whitelist is not global. It is explicitly maintained from public-market research and later adjusted from live results.

## Entry Rules

A market must pass all three filters to be quotable.

### 1. Structural Filter

- `tradingStatus === OPEN`
- `isVisible === true`
- book is two-sided often enough
- spread is within platform MM/points requirements
- market is in the approved sports or token/FDV whitelist

### 2. Activity Filter

- recent market trade rate is above the minimum threshold
- recent 24h volume is above the minimum threshold
- recent orderbook updates show active touch movement

### 3. Toxicity Filter

- recent post-fill adverse move is not persistently too high
- one-sided-book ratio is below threshold
- refill speed is acceptable

## Key Metrics

The strategy should not use raw timeouts as standalone decisions. It should use windows and ratios.

### Market Activity

- `market_trade_rate`
  - real market trades per window
- `touch_move_rate`
  - best-bid / best-ask update frequency
- `one_sided_ratio`
  - time share where one book side is missing

### Our Participation

- `our_fill_rate`
  - fills per window
- `quote_to_fill_ratio`
  - quote changes relative to fills
- `time_at_touch_without_fill`
  - cumulative time near touch with no execution

### Toxicity

- `post_fill_adverse_move_5s`
- `post_fill_adverse_move_30s`
- `post_fill_adverse_move_60s`
- `refill_speed`

### Risk

- `per_market_inventory`
- `per_market_loss_budget`
- `daily_pnl_floor`

## State Machine

The current `Observe / Score / Defend / Exit` model should evolve into a more operationally explicit state machine:

- `Observe`
  - collect data, no quoting
- `Quote`
  - normal quoting
- `Throttle`
  - reduce update rate and/or size
- `Protect`
  - one-sided-book protection or inventory-protection mode
- `Pause`
  - temporarily stop quoting this market
- `Stop`
  - global hard stop

The important change is that inactivity alone does not trigger immediate withdrawal. Instead:

- low activity -> reduce update frequency
- low fill efficiency -> reduce size and/or widen quote distance
- persistent quote churn with no fills -> pause market

## One-Sided Book Handling

One-sided books should not trigger unconditional full cancellation. Instead:

- stop posting on the missing side
- keep or reduce the opposite side depending on inventory needs
- wait for a short recovery window
- if the market remains one-sided too long, pause new quoting

This protects against quoting into a distorted book without overreacting to short-lived book gaps.

## Risk Rules

### Market-Level

- inventory cap blocks further accumulation in the same direction
- repeated adverse selection reduces size first, pauses market second
- prolonged high quote churn with very low fill efficiency pauses market

### Global

- daily PnL floor triggers strategy stop
- catastrophic inventory or execution mismatch triggers strategy stop

## Why This Design

This design matches the actual platform shape:

- concentrated activity
- mixed market quality
- some markets with real taker flow
- many markets that can waste effort or look like fake liquidity if managed badly

It also matches the operating objective:

- get meaningful fills
- stay within platform spread requirements
- avoid pointless churn
- keep losses bounded

## Implementation Boundaries

Phase 1 implementation should stop at:

- whitelist-aware market filtering
- pool-aware selection
- explicit market health metrics
- state-machine transitions for throttling and protection
- hard risk floors

Phase 1 should not include:

- predictive fair value models
- cross-market portfolio optimization
- multi-market neg-risk execution
- automated points optimization logic

## Success Criteria

Phase 1 is successful if it can show:

- meaningful fills on approved markets
- low incidence of pointless quote churn
- bounded daily losses
- clear separation between safe, risky, and inactive markets
- better market understanding for the next strategy phase
