# Dynamic Capacity Utilization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make quote size scale dynamically with visible queue depth and portfolio utilization so the strategy uses more capital on deep markets without overloading thin levels.

**Architecture:** Keep the existing whitelist, state machine, and top-2 quoting logic. Add a sizing layer in the quote engine that caps each quote by visible queue value, inventory pressure, and portfolio utilization pressure, then expose the resulting size through runtime and monitor snapshots. The live strategy should continue to prefer Quote/Throttle/Protect semantics, but size should now expand or shrink automatically based on market depth and account utilization bands.

**Tech Stack:** TypeScript, existing runtime/state machine/quote-engine modules, existing test runner, systemd live service.

---

### Task 1: Lock the dynamic sizing contract in tests

**Files:**
- Modify: `tests/quote-engine.test.ts`
- Modify: `tests/runtime.test.ts` if the runtime needs a fixture to expose the new size behavior

**Step 1: Write the failing test**

Add a quote-engine test that builds quotes against a deep visible queue and a thin visible queue, then asserts the deep level gets a larger size while the thin level is capped lower. Add a second assertion that portfolio utilization pressure shrinks the chosen size even when depth is large.

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/quote-engine.test.ts tests/runtime.test.ts -t "dynamic capacity"`

Expected: FAIL because quote sizing still uses the old fixed/default size behavior.

**Step 3: Write minimal implementation**

Do not implement anything in this task. Leave the source unchanged so the next task can drive the minimal code change.

**Step 4: Run test to verify it fails**

Run: `npm test -- tests/quote-engine.test.ts tests/runtime.test.ts -t "dynamic capacity"`

Expected: FAIL for the same reason, confirming the test is actually pinning the desired behavior.

**Step 5: Commit**

Do not commit in this task.

---

### Task 2: Implement visible-queue-based quote sizing

**Files:**
- Modify: `src/strategy/quote-engine.ts`
- Modify: `tests/quote-engine.test.ts`

**Step 1: Write the failing test**

Extend the quote-engine test to check the exact cap rule:
- quote size must not exceed `visibleQueueValueUsd * queueShareCap`
- the selected bid/ask level should determine the visible queue value used for the cap
- protect-mode reduce-only sizing must still apply after the cap

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/quote-engine.test.ts -t "visible queue"`

Expected: FAIL because `quote-engine.ts` still does not cap sizes by visible queue value in the source.

**Step 3: Write minimal implementation**

Add the sizing helper inside `src/strategy/quote-engine.ts` so that each side computes:
- base size
- queue cap size
- inventory cap size
- portfolio cap size

Then choose the minimum of those values before emitting the quote.

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/quote-engine.test.ts -t "visible queue"`

Expected: PASS.

**Step 5: Commit**

Commit the source and test changes together with a focused message.

---

### Task 3: Wire portfolio-utilization pressure into runtime quoting

**Files:**
- Modify: `src/runtime/runtime.ts`
- Modify: `tests/runtime.test.ts`

**Step 1: Write the failing test**

Add a runtime test that simulates high portfolio utilization and asserts the runtime passes a smaller effective size to the quote engine while still keeping the market eligible. Also add a low-utilization case that allows the larger deep-market size.

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/runtime.test.ts -t "utilization"`

Expected: FAIL because runtime is not yet applying a utilization-aware size budget.

**Step 3: Write minimal implementation**

Pass the utilization budget from runtime into the quote-sizing path and ensure the state machine still resolves to Quote/Throttle/Protect based on the existing health signals.

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/runtime.test.ts -t "utilization"`

Expected: PASS.

**Step 5: Commit**

Commit the runtime/test changes together.

---

### Task 4: Verify the live snapshot and monitor output still make sense

**Files:**
- Modify: `src/monitor.ts` only if the current snapshot does not surface the new effective quote size clearly
- Modify: `tests/monitor.test.ts` only if a snapshot field changes

**Step 1: Write the failing test**

Add a monitor assertion only if the snapshot schema changes; otherwise skip source edits here.

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/monitor.test.ts`

Expected: PASS if no schema changes are needed; otherwise FAIL until the snapshot is updated.

**Step 3: Write minimal implementation**

Keep the monitor unchanged unless a missing size field blocks verification.

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/monitor.test.ts`

Expected: PASS.

**Step 5: Commit**

Only commit if monitor code changed.

---

### Task 5: End-to-end verification on the live strategy

**Files:**
- No code changes expected

**Step 1: Run targeted tests**

Run:
`npm test -- tests/quote-engine.test.ts tests/runtime.test.ts`

**Step 2: Run the full suite**

Run:
`npm run typecheck && npm test`

Expected: all green.

**Step 3: Verify live behavior**

Check the server journal and monitor snapshot for:
- larger sizes on deep levels
- smaller sizes on thin levels
- preserved Quote/Throttle/Protect behavior
- no new same-price churn

**Step 4: Commit**

No commit if nothing changed.

