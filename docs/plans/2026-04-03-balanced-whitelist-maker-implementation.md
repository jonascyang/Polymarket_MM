# Balanced Whitelist Maker Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the current boost-first market selection logic with a whitelist-first, activity-aware maker loop for long-duration sports markets plus a small token/FDV satellite pool.

**Architecture:** Extend the existing strategy stack instead of creating a new one. Keep market qualification in `market-filter`, market ranking in `market-selector`, state transitions in `state-machine`, and runtime-derived health inputs in `runtime` / `runtime-loop`. The first release remains passive, whitelist-based, and rule-driven.

**Tech Stack:** TypeScript, Vitest, Node SQLite, existing Predict REST/WS clients, existing runtime / strategy modules.

---

### Task 1: Replace boost-first eligibility with whitelist-aware filters

**Files:**
- Modify: `/Users/jonas/Desktop/predictfun-mm/src/strategy/market-filter.ts`
- Create: `/Users/jonas/Desktop/predictfun-mm/tests/market-filter.test.ts`
- Reference: `/Users/jonas/Desktop/predictfun-mm/tests/market-selector.test.ts`

**Step 1: Write the failing tests**

Add tests that prove:

- sports outrights in the approved pool can pass
- token/FDV markets in the approved pool can pass
- boosted short-horizon match markets do not pass just because they are boosted
- one-sided books and wide-spread markets fail eligibility

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/market-filter.test.ts`

Expected: FAIL because whitelist/pool-aware logic does not exist yet.

**Step 3: Write minimal implementation**

Add explicit fields and filter helpers for:

- pool membership
- approved lane
- activity eligibility
- one-sided-book tolerance

Keep the API small and local to `market-filter.ts`.

**Step 4: Run tests to verify they pass**

Run: `npm test -- tests/market-filter.test.ts tests/market-selector.test.ts`

Expected: PASS for the new filter tests, and existing selector behavior may fail until Task 2.

**Step 5: Commit**

```bash
git add tests/market-filter.test.ts src/strategy/market-filter.ts
git commit -m "feat: add whitelist-aware market filters"
```

### Task 2: Re-rank selected markets by pool and execution quality

**Files:**
- Modify: `/Users/jonas/Desktop/predictfun-mm/src/strategy/market-selector.ts`
- Modify: `/Users/jonas/Desktop/predictfun-mm/tests/market-selector.test.ts`

**Step 1: Write the failing tests**

Update selector tests to prove:

- core sports outrights rank ahead of satellite token markets when both qualify
- token/FDV markets are still eligible as satellite entries
- boosted status is no longer the top priority key
- low-quality markets are excluded even with high 24h volume

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/market-selector.test.ts`

Expected: FAIL because current selector sorts boosted markets first and slices the top 3.

**Step 3: Write minimal implementation**

Update `compareMarketPriority` and `selectActiveMarkets` to sort on:

- eligibility label
- pool priority (`core sports` before `satellite token`)
- activity quality
- spread quality
- volume

Keep the selected set intentionally small.

**Step 4: Run tests to verify they pass**

Run: `npm test -- tests/market-selector.test.ts tests/market-filter.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add tests/market-selector.test.ts src/strategy/market-selector.ts
git commit -m "feat: prioritize whitelist market pools"
```

### Task 3: Expand the state machine for throttling and protection

**Files:**
- Modify: `/Users/jonas/Desktop/predictfun-mm/src/strategy/state-machine.ts`
- Create: `/Users/jonas/Desktop/predictfun-mm/tests/state-machine.test.ts`

**Step 1: Write the failing tests**

Add tests for:

- `Observe -> Quote` when market is eligible and healthy
- `Quote -> Throttle` when quote churn rises with poor fill efficiency
- `Quote -> Protect` on one-sided-book protection or inventory pressure
- `Protect -> Quote` when the book normalizes
- `Pause` and `Stop` transitions when market or global risk limits are hit

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/state-machine.test.ts`

Expected: FAIL because the current state machine only supports `Observe / Score / Defend / Exit`.

**Step 3: Write minimal implementation**

Replace the old state set with the new operational states:

- `Observe`
- `Quote`
- `Throttle`
- `Protect`
- `Pause`
- `Stop`

Keep transition helpers pure and deterministic.

**Step 4: Run tests to verify they pass**

Run: `npm test -- tests/state-machine.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add tests/state-machine.test.ts src/strategy/state-machine.ts
git commit -m "feat: add throttling and protection states"
```

### Task 4: Derive market health inputs inside the runtime loop

**Files:**
- Modify: `/Users/jonas/Desktop/predictfun-mm/src/runtime/runtime.ts`
- Modify: `/Users/jonas/Desktop/predictfun-mm/src/runtime/runtime-loop.ts`
- Modify: `/Users/jonas/Desktop/predictfun-mm/src/types.ts`
- Modify: `/Users/jonas/Desktop/predictfun-mm/tests/runtime.test.ts`
- Modify: `/Users/jonas/Desktop/predictfun-mm/tests/runtime-loop.test.ts`

**Step 1: Write the failing tests**

Add or update runtime tests to prove the runtime computes and carries:

- market trade rate
- one-sided-book ratio or current one-sided status
- quote-to-fill ratio
- inventory pressure
- market health label for selector/state-machine input

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/runtime.test.ts tests/runtime-loop.test.ts`

Expected: FAIL because these health inputs are not yet represented in the runtime state.

**Step 3: Write minimal implementation**

Extend runtime snapshots and tracked market state with the minimum health inputs needed by the new selector and state machine. Reuse existing recorder and live data instead of building a second data path.

**Step 4: Run tests to verify they pass**

Run: `npm test -- tests/runtime.test.ts tests/runtime-loop.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add tests/runtime.test.ts tests/runtime-loop.test.ts src/runtime/runtime.ts src/runtime/runtime-loop.ts src/types.ts
git commit -m "feat: track market health in runtime loop"
```

### Task 5: Make quote generation respect throttle and protect modes

**Files:**
- Modify: `/Users/jonas/Desktop/predictfun-mm/src/strategy/quote-engine.ts`
- Modify: `/Users/jonas/Desktop/predictfun-mm/src/risk/risk-controller.ts`
- Modify: `/Users/jonas/Desktop/predictfun-mm/tests/quote-engine.test.ts`
- Modify: `/Users/jonas/Desktop/predictfun-mm/tests/risk-controller.test.ts`

**Step 1: Write the failing tests**

Add tests that prove:

- `Quote` mode emits normal near-touch quotes
- `Throttle` mode reduces update cadence or size
- `Protect` mode suppresses the missing-side quote and/or keeps only the inventory-relieving side
- loss-floor and inventory caps stop further accumulation

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/quote-engine.test.ts tests/risk-controller.test.ts`

Expected: FAIL because the current quote engine and risk controller do not understand the new modes.

**Step 3: Write minimal implementation**

Keep this strictly rule-based. Do not add predictive fair-value logic. Use only:

- state-machine output
- inventory direction
- market health flags
- hard risk limits

**Step 4: Run tests to verify they pass**

Run: `npm test -- tests/quote-engine.test.ts tests/risk-controller.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add tests/quote-engine.test.ts tests/risk-controller.test.ts src/strategy/quote-engine.ts src/risk/risk-controller.ts
git commit -m "feat: enforce throttle and protection quote rules"
```

### Task 6: Expose the new eligibility and health model in research output

**Files:**
- Modify: `/Users/jonas/Desktop/predictfun-mm/src/research/report.ts`
- Modify: `/Users/jonas/Desktop/predictfun-mm/src/runtime/run-report.ts`
- Modify: `/Users/jonas/Desktop/predictfun-mm/tests/research-report.test.ts`
- Modify: `/Users/jonas/Desktop/predictfun-mm/tests/run-report.test.ts`
- Modify: `/Users/jonas/Desktop/predictfun-mm/README.md`

**Step 1: Write the failing tests**

Add report tests that prove the output can distinguish:

- `active-safe`
- `active-risky`
- `inactive-or-toxic`

and that it surfaces the key supporting metrics used by the strategy.

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/research-report.test.ts tests/run-report.test.ts`

Expected: FAIL because the current report only emits `tradable / watch / toxic_or_thin`.

**Step 3: Write minimal implementation**

Extend report rows and rendered output to show the new strategy-facing classification and the core health metrics. Keep existing report output working.

**Step 4: Run tests to verify they pass**

Run: `npm test -- tests/research-report.test.ts tests/run-report.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add tests/research-report.test.ts tests/run-report.test.ts src/research/report.ts src/runtime/run-report.ts README.md
git commit -m "feat: report whitelist maker health labels"
```

### Task 7: Full verification and cleanup

**Files:**
- Verify only; no intentional new files

**Step 1: Run targeted suites**

Run:

```bash
npm test -- tests/market-filter.test.ts tests/market-selector.test.ts tests/state-machine.test.ts tests/runtime.test.ts tests/runtime-loop.test.ts tests/quote-engine.test.ts tests/risk-controller.test.ts tests/research-report.test.ts tests/run-report.test.ts
```

Expected: PASS.

**Step 2: Run full project verification**

Run:

```bash
npm run typecheck
npm test
```

Expected: PASS.

**Step 3: Inspect git diff**

Run:

```bash
git status --short
git diff --stat
```

Expected: only the intended whitelist-maker strategy changes remain.

**Step 4: Commit the final integration**

```bash
git add .
git commit -m "feat: add balanced whitelist maker controls"
```

**Step 5: Stop**

Do not expand scope into predictive models, neg-risk execution, or cross-market arb in this phase.
