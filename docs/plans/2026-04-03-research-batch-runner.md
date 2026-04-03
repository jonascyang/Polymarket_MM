# Research Batch Runner Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add one operational entrypoint that runs research collection, report generation, and optional archive upload in one explicit batch command.

**Architecture:** Keep `paper` / `shadow` / `live` unchanged. Add a new `src/runtime/run-batch.ts` CLI that composes existing primitives from `src/research/collector.ts`, `src/runtime/run-report.ts`, and `src/runtime/run-archive.ts`, then emits one machine-readable batch summary plus optional human-readable report text.

**Tech Stack:** TypeScript, `tsx`, Vitest, Node SQLite, existing runtime/research/archive modules

---

### Task 1: Lock the batch CLI contract with failing tests

**Files:**
- Create: `tests/run-batch.test.ts`
- Reference: `tests/run-archive.test.ts`
- Reference: `tests/run-report.test.ts`

**Step 1: Write the failing test for CLI parsing**

Add a test that imports `parseBatchCliOptions` from `src/runtime/run-batch.ts` and asserts this input:

```ts
["--first=25", "--report-json", "--min-age-ms=120000"]
```

produces:

```ts
{
  first: 25,
  reportFormat: "json",
  minAgeMs: 120000
}
```

Also add a second assertion that default parsing returns:

```ts
{
  reportFormat: "text"
}
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/run-batch.test.ts`

Expected: FAIL because `src/runtime/run-batch.ts` and `parseBatchCliOptions` do not exist yet.

**Step 3: Write the failing test for orchestration**

In the same file, add a test for a pure helper:

```ts
await runResearchBatch(config, {
  collector: async () => ({
    sampledMarkets: 2,
    orderbooksRecorded: 2,
    lastSalesRecorded: 1,
    regimeSnapshotsRecorded: 2,
    marketIds: [101, 202]
  }),
  reportRenderer: () => "{\"collection\":{\"sampledMarkets\":2}}",
  archiveRunner: async () => [
    {
      sourcePath: "/tmp/a.jsonl",
      objectKey: "predict-mm/raw/a.jsonl.gz",
      bytes: 10
    }
  ]
})
```

Assert the result shape is:

```ts
{
  collect: {
    sampledMarkets: 2,
    orderbooksRecorded: 2,
    lastSalesRecorded: 1,
    regimeSnapshotsRecorded: 2,
    marketIds: [101, 202]
  },
  report: {
    format: "json",
    output: "{\"collection\":{\"sampledMarkets\":2}}"
  },
  archive: {
    attempted: true,
    uploadedCount: 1,
    uploads: [
      {
        sourcePath: "/tmp/a.jsonl",
        objectKey: "predict-mm/raw/a.jsonl.gz",
        bytes: 10
      }
    ]
  }
}
```

Add one more test where archive config is missing and assert:

```ts
{
  attempted: false,
  uploadedCount: 0,
  uploads: []
}
```

**Step 4: Run test to verify it fails**

Run: `npm test -- tests/run-batch.test.ts`

Expected: FAIL because `runResearchBatch` does not exist yet.

**Step 5: Commit**

```bash
git add tests/run-batch.test.ts
git commit -m "test: define research batch runner contract"
```

### Task 2: Implement the pure batch orchestration module

**Files:**
- Create: `src/runtime/run-batch.ts`
- Modify: `src/runtime/run-report.ts`
- Reference: `src/research/collector.ts`
- Reference: `src/runtime/run-archive.ts`
- Test: `tests/run-batch.test.ts`

**Step 1: Write the minimal orchestration code**

Add these exported types and functions:

```ts
export type BatchCliOptions = {
  first?: number;
  reportFormat: "text" | "json";
  minAgeMs?: number;
};

export type ResearchBatchResult = {
  collect: ResearchCollectorResult;
  report: {
    format: "text" | "json";
    output: string;
  };
  archive: {
    attempted: boolean;
    uploadedCount: number;
    uploads: UploadedArchiveObject[];
  };
};

export function parseBatchCliOptions(argv: string[]): BatchCliOptions
export async function runResearchBatch(
  config: PredictMmConfig,
  options?: RunResearchBatchOptions
): Promise<ResearchBatchResult>
```

Implementation rules:

- `parseBatchCliOptions` accepts:
  - `--first=...`
  - `--report-json`
  - `--min-age-ms=...`
- `runResearchBatch` must:
  - call `runResearchCollectorCycle(config, { first })`
  - open the database once with `openAnalyticsStore(config.dbPath)`
  - call `renderResearchReport(database, reportFormat)`
  - call `runArchiveOnce(config, { minAgeMs })` only when archive config is complete
  - return the structured result object
- If archive config is incomplete, do not throw. Return `attempted: false`.
- Do not change the behavior of `run-collect.ts`, `run-report.ts`, or `run-archive.ts`.

**Step 2: If needed, export one small helper for archive readiness**

If `run-batch.ts` needs a reusable predicate, add the smallest possible helper inside `src/runtime/run-batch.ts`:

```ts
function canRunArchive(config: PredictMmConfig): boolean {
  return Boolean(
    config.archiveDir &&
      config.r2Endpoint &&
      config.r2Bucket &&
      config.r2AccessKeyId &&
      config.r2SecretAccessKey
  );
}
```

Do not move config checks out of `run-archive.ts`. Keep the existing hard failure there for direct `npm run archive`.

**Step 3: Run the targeted test to verify it passes**

Run: `npm test -- tests/run-batch.test.ts`

Expected: PASS

**Step 4: Run adjacent tests to catch regressions**

Run: `npm test -- tests/run-report.test.ts tests/research-collector.test.ts tests/run-archive.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add src/runtime/run-batch.ts src/runtime/run-report.ts tests/run-batch.test.ts
git commit -m "feat: add research batch orchestration"
```

### Task 3: Add the executable script and CLI output shape

**Files:**
- Modify: `src/runtime/run-batch.ts`
- Modify: `package.json`
- Test: `tests/run-batch.test.ts`

**Step 1: Write the failing CLI-output test**

Extend `tests/run-batch.test.ts` with a test for a pure formatter:

```ts
formatResearchBatchOutput(result)
```

Assert it returns JSON with this top-level shape:

```json
{
  "type": "research_batch",
  "collect": { "...": "..." },
  "report": {
    "format": "json",
    "output": "{\"collection\":{\"sampledMarkets\":2}}"
  },
  "archive": {
    "attempted": true,
    "uploadedCount": 1,
    "uploads": [ ... ]
  }
}
```

If `reportFormat` is `text`, keep the text report embedded as the string value of `report.output`. Do not print mixed stdout lines from the formatter.

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/run-batch.test.ts`

Expected: FAIL because `formatResearchBatchOutput` does not exist yet.

**Step 3: Implement the CLI path**

In `src/runtime/run-batch.ts`:

- add `formatResearchBatchOutput(result): string`
- add `main()` that:
  - calls `loadConfig()`
  - parses CLI args
  - runs the batch
  - prints one JSON line from `formatResearchBatchOutput`
- guard execution with:

```ts
if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
```

In `package.json`, add:

```json
"batch": "tsx src/runtime/run-batch.ts"
```

**Step 4: Run the focused tests**

Run: `npm test -- tests/run-batch.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add src/runtime/run-batch.ts package.json tests/run-batch.test.ts
git commit -m "feat: expose batch runtime entrypoint"
```

### Task 4: Document the operational path

**Files:**
- Modify: `README.md`
- Modify: `docs/plans/2026-04-03-research-batch-runner.md`

**Step 1: Update the script list**

Add:

- `npm run batch`: collect once, render a report, and upload archives when archive config is complete

**Step 2: Update the status section**

Clarify these operational rules:

- `batch` is the recommended explicit research operations entrypoint
- `collect`, `report`, and `archive` remain available as focused subcommands
- `paper`, `shadow`, and `live` still do not auto-run research/archive side effects

**Step 3: Add one concrete example**

Document these examples in `README.md`:

```bash
npm run batch -- --first=25
npm run batch -- --first=25 --report-json
npm run batch -- --first=25 --report-json --min-age-ms=300000
```

**Step 4: Run no-op doc verification**

Run: `git diff -- README.md package.json src/runtime/run-batch.ts`

Expected: only the new batch path and its documentation appear.

**Step 5: Commit**

```bash
git add README.md
git commit -m "docs: document research batch entrypoint"
```

### Task 5: Full verification and cleanup

**Files:**
- Verify only

**Step 1: Run the batch-related test set**

Run:

```bash
npm test -- tests/run-batch.test.ts tests/run-report.test.ts tests/research-collector.test.ts tests/research-report.test.ts tests/run-archive.test.ts
```

Expected: PASS

**Step 2: Run project typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS

**Step 3: Run the full test suite**

Run:

```bash
npm test
```

Expected: PASS with zero failing suites.

**Step 4: Manual smoke check**

Run one of:

```bash
npm run batch -- --first=5
npm run batch -- --first=5 --report-json
```

Expected:

- one JSON object printed to stdout
- `collect.sampledMarkets` reflects the run
- `report.output` is present
- `archive.attempted` is `false` without archive config, or `true` with upload results when config is complete

**Step 5: Commit**

```bash
git add README.md package.json src/runtime/run-batch.ts src/runtime/run-report.ts tests/run-batch.test.ts
git commit -m "feat: add research batch runner"
```

### Task 6: Post-implementation decision checkpoint

**Files:**
- None

**Step 1: Re-read the goal**

Confirm the delivered behavior is still:

- one explicit batch entrypoint
- no automatic behavior change for `paper` / `shadow` / `live`
- archive upload remains optional and config-gated

**Step 2: Reject out-of-scope follow-ups for this branch**

Do not add any of these in the same implementation pass:

- scheduler or cron integration
- auto-running batch inside `monitor`
- per-market ranking/sorting/filter flags
- new database schema
- changes to live trading behavior

**Step 3: If more is needed, queue follow-up plans**

The next separate plan can cover one of:

- batch exit codes and alerting semantics
- richer `report --json` filtering
- automation wiring once a stable batch command exists

