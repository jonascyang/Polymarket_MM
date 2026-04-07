# Dynamic Capacity and Utilization Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:writing-plans to implement this design task-by-task.

**Goal:** Make quote size adapt to market conditions so the bot uses capital more efficiently while staying inside visible queue capacity, inventory limits, and a target utilization band above 80%.

**Current State:** Quote sizing is already capped by a fixed budget path and top-of-book selection. The next step is to derive that budget dynamically from the selected quote level's visible queue value, then modulate it by inventory pressure and portfolio utilization.

**Tech Stack:** TypeScript, Vitest, Node sqlite runtime

---

## 1) Sizing Model

Quote size should be the minimum of four limits:

- visible queue capacity at the selected bid/ask level
- per-market inventory pressure
- portfolio utilization pressure
- the mode's base size (`Quote` vs `Protect`)

Proposed formula:

`sizeUsd = min(baseSizeUsd, visibleQueueValueUsd * queueShareCap, inventoryBudgetUsd, portfolioBudgetUsd)`

Where:

- `baseSizeUsd` stays mode-dependent
  - `Quote`: normal quote size
  - `Protect`: smaller defend size
- `visibleQueueValueUsd = selectedLevel.price * selectedLevel.size`
- `queueShareCap` is the configurable share of visible queue value allowed at that level
- `inventoryBudgetUsd` shrinks as market inventory approaches the market cap
- `portfolioBudgetUsd` shrinks as portfolio utilization approaches the hard cap

This keeps the bot from over-sizing thin levels while still allowing deep markets to absorb more capital.

---

## 2) Utilization Bands

The portfolio should be managed in bands rather than with a single hard target.

- Below 70% utilization:
  - expand into more qualifying depth
  - allow larger sizes in deep markets
- 70% to 90% utilization:
  - hold or grow slowly
  - favor stable markets with strong visible depth
- Above 90% utilization:
  - reduce size
  - prefer `Protect`
  - pause the thinnest markets first

The target is to keep the system above 80% most of the time without forcing the bot to overfill weak books.

---

## 3) Market-Aware Modulation

Market conditions should bias the final size before the hard caps apply.

Inputs:

- selected quote price
- visible queue size at that price
- spread
- current state (`Quote`, `Throttle`, `Protect`, `Pause`)
- market inventory distance from cap
- current portfolio utilization

Suggested behavior:

- Deep book, tight spread:
  - allow larger size
- Thin book or wide spread:
  - compress size aggressively
- Inventory near cap:
  - shrink size and prefer the reduce-only side
- `Protect` mode:
  - only quote the inventory-reducing side
  - keep it smaller than `Quote`

If a market has strong depth but the portfolio is already near the utilization ceiling, the inventory and portfolio caps win.

---

## 4) Runtime Flow

Sizing should happen in runtime, not in tests or reporting.

Flow:

1. Runtime selects the market and quote price
2. Runtime reads the selected level's visible queue depth
3. Runtime derives a queue-based budget
4. Runtime applies inventory and portfolio pressure
5. Runtime passes the resulting budget into quote construction
6. Quote engine returns bid/ask sizes that respect all caps

This keeps the strategy responsive to market depth without changing the quote engine into a full portfolio optimizer.

---

## 5) Guardrails

Keep the following hard constraints:

- never exceed the selected level's visible queue share cap
- never exceed the per-market inventory cap
- never exceed the portfolio utilization cap
- `Protect` must remain reduce-only when inventory is already skewed
- `Pause` must still block new quotes

The design should improve capital use, but not at the cost of quoting too large into thin books.

---

## 6) Testing Strategy

Tests should prove:

- a deep selected level allows larger size than a thin selected level
- the same market size is reduced when the visible queue shrinks
- `Protect` quotes size only the inventory-reducing side
- portfolio utilization pressure shrinks quote size even on deep books
- the system can reach a working utilization band without violating the queue cap

The tests should live primarily in `tests/quote-engine.test.ts` and `tests/runtime.test.ts`.

---

## 7) Done Criteria

This design is done when:

- quote size is computed from the selected level's visible queue value
- utilization can be pushed above 80% without oversizing thin books
- inventory pressure and `Protect` mode still work as hard caps
- all tests pass and the live service reflects the new sizing behavior
