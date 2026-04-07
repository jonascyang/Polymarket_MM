# Top-2 Quote Logic Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move the runtime from fixed-offset passive quotes to fair-value-bounded top-of-book quoting that prefers L1 and falls back to L2.

**Architecture:** Keep market selection and risk structure intact, but change quote placement to consume top-of-book depth and choose between L1/L2 under fair-value bounds. Tighten runtime cadence so `Throttle` reduces churn by holding only still-competitive quotes rather than blindly preserving stale levels.

**Tech Stack:** TypeScript, Vitest, Node sqlite runtime

---

### Task 1: Lock Top-2 Quote Placement

**Files:**
- Modify: `/Users/jonas/Desktop/predictfun-mm/tests/quote-engine.test.ts`
- Modify: `/Users/jonas/Desktop/predictfun-mm/src/strategy/quote-engine.ts`

**Step 1: Write the failing test**

Add tests that cover:
- `Quote` mode choosing L1 when it is within the fair-value bound
- falling back to L2 when L1 is outside the bound
- preferring L2 when L1 is overcrowded and only one tick better

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/quote-engine.test.ts`
Expected: FAIL because `buildQuotes()` does not understand L1/L2 books today.

**Step 3: Write minimal implementation**

Update `buildQuotes()` to:
- accept top-of-book arrays
- compute side bounds from reservation price
- select L1 first and L2 as fallback
- suppress a side if neither L1 nor L2 is legal

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/quote-engine.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add tests/quote-engine.test.ts src/strategy/quote-engine.ts docs/plans/2026-04-08-top2-quote-logic-implementation.md
git commit -m "feat: prefer top-of-book quote placement"
```

### Task 2: Tighten Throttle Refresh Behavior

**Files:**
- Modify: `/Users/jonas/Desktop/predictfun-mm/tests/runtime.test.ts`
- Modify: `/Users/jonas/Desktop/predictfun-mm/src/runtime/runtime.ts`

**Step 1: Write the failing test**

Add a runtime test that proves `Throttle` will reprice if the held quote is no longer in the legal top-two candidate set, even inside the refresh dwell window.

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/runtime.test.ts`
Expected: FAIL because runtime currently preserves throttle quotes solely by elapsed time.

**Step 3: Write minimal implementation**

Update throttle preservation logic to keep current orders only when they still match an allowed top-two quote candidate for the current market state.

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/runtime.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add tests/runtime.test.ts src/runtime/runtime.ts
git commit -m "fix: reprice stale throttle quotes"
```

### Task 3: Align State Thresholds With Top-2 Maker Behavior

**Files:**
- Modify: `/Users/jonas/Desktop/predictfun-mm/tests/state-machine.test.ts`
- Modify: `/Users/jonas/Desktop/predictfun-mm/tests/runtime.test.ts`
- Modify: `/Users/jonas/Desktop/predictfun-mm/src/strategy/state-machine.ts`
- Modify: `/Users/jonas/Desktop/predictfun-mm/src/runtime/runtime.ts`

**Step 1: Write the failing test**

Add tests for:
- `Quote -> Protect` at the new inventory pressure threshold
- `Protect -> Quote` only after inventory and book conditions normalize
- `Pause` triggering only on high churn in low-activity conditions

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/state-machine.test.ts tests/runtime.test.ts`
Expected: FAIL because current thresholds are still the older conservative values.

**Step 3: Write minimal implementation**

Adjust state-machine thresholds and runtime churn gating to match the approved design:
- tighter `Protect` inventory entry
- looser `Quote` retention
- `Pause` reserved for clearly ineffective quoting

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/state-machine.test.ts tests/runtime.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add tests/state-machine.test.ts tests/runtime.test.ts src/strategy/state-machine.ts src/runtime/runtime.ts
git commit -m "feat: tune top-two maker state thresholds"
```

### Task 4: Full Verification

**Files:**
- Modify: `/Users/jonas/Desktop/predictfun-mm/src/runtime/runtime.ts`
- Modify: `/Users/jonas/Desktop/predictfun-mm/src/strategy/quote-engine.ts`
- Modify: `/Users/jonas/Desktop/predictfun-mm/src/strategy/state-machine.ts`
- Modify: `/Users/jonas/Desktop/predictfun-mm/tests/quote-engine.test.ts`
- Modify: `/Users/jonas/Desktop/predictfun-mm/tests/runtime.test.ts`
- Modify: `/Users/jonas/Desktop/predictfun-mm/tests/state-machine.test.ts`

**Step 1: Run focused suite**

Run: `npm test -- tests/quote-engine.test.ts tests/runtime.test.ts tests/state-machine.test.ts`
Expected: PASS

**Step 2: Run full checks**

Run:
- `npm run typecheck`
- `npm test`

Expected: PASS

**Step 3: Commit**

```bash
git add src/strategy/quote-engine.ts src/strategy/state-machine.ts src/runtime/runtime.ts tests/quote-engine.test.ts tests/runtime.test.ts tests/state-machine.test.ts
git commit -m "feat: switch maker runtime to top-two quote placement"
```
