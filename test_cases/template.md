# <Display Name> — Test Cases

> App slug: `<slug>` · Last updated: <YYYY-MM-DD>

## App under test

| Field | Value |
|-------|-------|
| Display name | |
| Bundle ID | |
| Knowledge map | `knowledge/apps/<slug>.md` |

## Conventions

- **ID:** `TC-<SLUG>-###` (e.g. `TC-SCRIB-001`)
- **Timeout:** **3 minutes** per test case. Clock starts on the first **When** step. If the **Then** condition is not verified within 3 minutes, the case **fails** — stop, record FAIL, and proceed to the next case.
- **Given / When / Then** — steps use open-sim MCP tool names (`launch_app`, `ui_tap`, `ui_type`, `describe_ui`, `open_url`, …)
- **Verify:** one `describe_ui` (or known element) assertion per case unless noted
- **Tags:** `smoke`, `regression`, `navigation`, …
- **Does / Expected:** Each case starts with two plain sentences — **Does** (what the user flow is) and **Expected** (observable outcome). **Then** stays the machine-verifiable check for automation; keep it aligned with **Expected**.
- **Run time:** After a suite run, **print total run time** — wall-clock from the first case’s first **When** step through the last case’s **Then** verified (or suite abort). Format: `Xm Ys` (or `Xs` if under 1 minute). Record it in **Last run** below.

---

## Test cases

### TC-<SLUG>-001: <Short title>

**Does:** <One sentence — what this case exercises.>

**Expected:** <One sentence — what the user should see when it passes.>

**Tags:** smoke

**Given:** <preconditions>

**When:**
1. `<tool>` <args>
2. ...

**Then:** <expected UI state — specific labels/text for describe_ui>

**Input:** `<example text if any>`

**Gotchas:** <optional — timeouts, dialogs, label collisions>

---

### TC-<SLUG>-002: <Short title>

**Does:** <One sentence.>

**Expected:** <One sentence.>

**Tags:** regression

**Given:** ...

**When:**
1. ...

**Then:** ...

**Gotchas:** ...

## Not covered yet

- 

## Last run

Fill in after executing this file (agent or manual run):

| Metric | Value |
|--------|-------|
| Date | YYYY-MM-DD |
| Passed / Failed / Timed out | / / |
| **Total run time** | Xm Ys |
| Notes | |
