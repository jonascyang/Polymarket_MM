# Monitor Web Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a loopback-only monitor web service that exposes the existing runtime monitor snapshot through JSON and a simple auto-refreshing HTML page.

**Architecture:** Reuse `buildMonitorSnapshot` as the single source of truth, then add a minimal Node HTTP server entrypoint that serves `/api/snapshot` and `/`. Keep the UI server-side static and dependency-free, then deploy it as its own `systemd` service without touching the live runtime process.

**Tech Stack:** TypeScript, Node `http`, existing SQLite monitor snapshot, Vitest, existing `tsx` runtime scripts, systemd.

---

### Task 1: Lock the web monitor contract with failing tests

**Files:**
- Create: `/Users/jonas/Desktop/predictfun-mm/tests/monitor-web.test.ts`
- Reference: `/Users/jonas/Desktop/predictfun-mm/tests/monitor.test.ts`
- Reference: `/Users/jonas/Desktop/predictfun-mm/src/monitor.ts`

**Step 1: Write the failing test**

Add tests that prove:

- `/api/snapshot` returns JSON derived from `MonitorSnapshot`
- `/` returns HTML containing the approved sections
- failed snapshot reads return a `500` JSON error for `/api/snapshot`

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/monitor-web.test.ts`

Expected: FAIL because no HTTP monitor server exists yet.

**Step 3: Write minimal implementation**

Create the smallest possible HTTP handler contract needed by the tests. Keep it local to the web monitor module and do not change runtime behavior.

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/monitor-web.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add tests/monitor-web.test.ts src/runtime/run-monitor-web.ts src/monitor-web.ts
git commit -m "feat: add monitor web endpoints"
```

### Task 2: Implement the HTML dashboard shell

**Files:**
- Create: `/Users/jonas/Desktop/predictfun-mm/src/monitor-web.ts`
- Modify: `/Users/jonas/Desktop/predictfun-mm/tests/monitor-web.test.ts`

**Step 1: Write the failing test**

Extend tests to prove the HTML includes:

- top summary
- active markets section
- recent orders section
- recent fills section
- portfolio section
- auto-refresh client script

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/monitor-web.test.ts`

Expected: FAIL because the HTML shell is incomplete.

**Step 3: Write minimal implementation**

Implement a single rendered HTML document with inline CSS and JavaScript. Keep styling restrained and keep all data loading through `/api/snapshot`.

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/monitor-web.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add tests/monitor-web.test.ts src/monitor-web.ts
git commit -m "feat: add monitor web dashboard shell"
```

### Task 3: Add the runtime CLI entrypoint and package script

**Files:**
- Create: `/Users/jonas/Desktop/predictfun-mm/src/runtime/run-monitor-web.ts`
- Modify: `/Users/jonas/Desktop/predictfun-mm/package.json`
- Modify: `/Users/jonas/Desktop/predictfun-mm/tests/monitor-web.test.ts`

**Step 1: Write the failing test**

Add tests that prove CLI parsing supports:

- `--db=...`
- `--host=...`
- `--port=...`

and defaults to loopback binding.

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/monitor-web.test.ts`

Expected: FAIL because the CLI entrypoint and parser do not exist yet.

**Step 3: Write minimal implementation**

Add the entrypoint, keep defaults conservative, and add a `monitor-web` package script.

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/monitor-web.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add tests/monitor-web.test.ts src/runtime/run-monitor-web.ts package.json
git commit -m "feat: add monitor web cli entrypoint"
```

### Task 4: Add deployment assets and usage docs

**Files:**
- Create: `/Users/jonas/Desktop/predictfun-mm/ops/systemd/predictfun-mm-monitor.service`
- Modify: `/Users/jonas/Desktop/predictfun-mm/tests/systemd-assets.test.ts`
- Modify: `/Users/jonas/Desktop/predictfun-mm/README.md`

**Step 1: Write the failing test**

Add or extend tests to prove the new `systemd` asset exists and uses:

- `monitor-web`
- loopback host
- explicit port

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/systemd-assets.test.ts`

Expected: FAIL because the service asset does not exist yet.

**Step 3: Write minimal implementation**

Add the systemd unit and document:

- SSH tunnel usage
- local browser URL
- service management commands

Keep the README changes limited to the new monitor web flow.

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/systemd-assets.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add tests/systemd-assets.test.ts ops/systemd/predictfun-mm-monitor.service README.md
git commit -m "ops: add monitor web service"
```

### Task 5: Run full verification and deploy to the server

**Files:**
- Verify only: `/Users/jonas/Desktop/predictfun-mm/src/monitor.ts`
- Verify only: `/Users/jonas/Desktop/predictfun-mm/src/monitor-web.ts`
- Verify only: `/Users/jonas/Desktop/predictfun-mm/src/runtime/run-monitor-web.ts`
- Verify only: `/Users/jonas/Desktop/predictfun-mm/ops/systemd/predictfun-mm-monitor.service`

**Step 1: Run focused tests**

Run: `npm test -- tests/monitor.test.ts tests/monitor-web.test.ts tests/systemd-assets.test.ts`

Expected: PASS.

**Step 2: Run repo verification**

Run:

```bash
npm run typecheck
npm test
```

Expected: PASS.

**Step 3: Deploy to server**

Update the server checkout, install dependencies if needed, install the new systemd unit, enable and start the monitor service, then verify:

- `curl http://127.0.0.1:<port>/api/snapshot`
- HTML reachable on loopback
- live service remains healthy

**Step 4: Commit deployment-ready changes**

```bash
git add docs/plans/2026-04-07-monitor-web-design.md docs/plans/2026-04-07-monitor-web-implementation.md
git commit -m "docs: plan monitor web service"
```
