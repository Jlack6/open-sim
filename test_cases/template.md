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

---

## Test cases

### TC-<SLUG>-001: <Short title>

**Tags:** smoke

**Given:** <preconditions>

**When:**
1. `<tool>` <args>
2. ...

**Then:** <expected UI state>

**Input:** `<example text if any>`

**Gotchas:** <optional — timeouts, dialogs, label collisions>

---

### TC-<SLUG>-002: <Short title>

**Tags:** regression

**Given:** ...

**When:**
1. ...

**Then:** ...

**Gotchas:** ...

## Not covered yet

- 
