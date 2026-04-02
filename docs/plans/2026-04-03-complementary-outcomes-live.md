# Complementary Outcomes Live Execution Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make live two-sided market making work from flat inventory by mapping logical asks onto the complementary outcome instead of selling unavailable shares.

**Architecture:** Runtime market metadata will carry both primary and complementary outcome token information. The live executor and private-state normalization will translate between logical strategy orders and exchange-native token-side orders in both directions.

**Tech Stack:** TypeScript, Vitest, Predict REST/WebSocket API, `@predictdotfun/sdk`

---

### Task 1: Add failing complementary-outcome tests

**Files:**
- Modify: `tests/predict-sdk.test.ts`
- Modify: `tests/live-executor.test.ts`
- Modify: `tests/runtime.test.ts`
- Modify: `tests/ws-client.test.ts`

**Step 1: Write failing tests**

- Add a metadata resolver test that expects both primary and complementary outcome token IDs.
- Add a create-order payload test that expects logical `ask` to sign as a `BUY` on the complementary token at `1 - askPrice`.
- Add private open-order normalization tests that expect complementary-token `BUY` orders to rehydrate as logical asks.
- Add wallet-event normalization tests that expect complementary-token fills/orders to map back to logical asks.

**Step 2: Run tests to verify they fail**

Run: `npm test -- --runInBand`

Expected: new tests fail because runtime/executor still assume one token per market.

### Task 2: Implement complementary-outcome metadata and translation

**Files:**
- Modify: `src/execution/predict-sdk.ts`
- Modify: `src/execution/live-executor.ts`
- Modify: `src/runtime/runtime.ts`
- Modify: `src/clients/ws-client.ts`

**Step 1: Extend metadata**

- Replace single-token market metadata with primary/complementary outcome metadata.
- Preserve current primary-outcome preference rules for selecting the canonical YES side.

**Step 2: Implement forward translation**

- Map logical bid -> primary token BUY at `p`.
- Map logical ask -> complementary token BUY at `1 - p`.

**Step 3: Implement reverse translation**

- When reading open orders and wallet events, detect whether the token is primary or complementary.
- Convert primary BUY back to logical bid.
- Convert complementary BUY back to logical ask at `1 - exchangePrice`.

### Task 3: Verify runtime wiring and regression coverage

**Files:**
- Modify: `src/runtime/runtime.ts`
- Modify: `tests/runtime.test.ts`
- Modify: `tests/runtime-loop.test.ts`

**Step 1: Wire runtime metadata**

- Load both outcome tokens when bootstrapping markets.
- Keep inventory sign conventions unchanged: YES positive, NO negative.

**Step 2: Run targeted and full verification**

Run: `npm run typecheck`
Run: `npm test`

Expected: all tests pass, including new complementary-outcome scenarios.

### Task 4: Commit

**Step 1: Stage and commit**

```bash
git add src tests docs/plans/2026-04-03-complementary-outcomes-live.md
git commit -m "feat: map live asks onto complementary outcomes"
```
