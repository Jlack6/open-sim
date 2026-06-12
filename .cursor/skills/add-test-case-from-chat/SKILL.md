---
name: add-test-case-from-chat
description: Adds one or more test cases to test_cases/apps/ from the current chat. Creates the app file from test_cases/template.md if missing. Asks the user which cases to add when multiple flows are candidates. Use when the user says "add test case", "save this as a test", or wants chat automation turned into TC-* scenarios.
---

# Add Test Case From Chat

Turn session experience into numbered, runnable test cases in `test_cases/apps/<slug>.md`. Does **not** update `knowledge/` — use **update-knowledge-from-chat** for that.

## When to run

| Trigger | Action |
|---------|--------|
| User says "add test case", "save as test", `/add-test-case-from-chat` | Run this skill |
| Chat completed one or more verifiable flows worth regression-testing | Offer this skill, or run if user asked to capture tests |
| User names specific flows to capture | Add only those (skip disambiguation if unambiguous) |

## Paths

| File | In git? |
|------|---------|
| [test_cases/template.md](../../test_cases/template.md) | Yes — copy structure & conventions |
| `test_cases/apps/<slug>.md` | No — local, gitignored |

Slug = lowercase with hyphens (`Scrib` → `scrib`). Uppercase slug in IDs (`TC-SCRIB-001`).

## Workflow

### 1. Identify the app

From chat: display name, bundle ID, or slug.

Pull **App under test** fields from `knowledge/apps/<slug>.md` if it exists (display name, bundle ID). If knowledge is missing, infer from the session or ask the user.

### 2. Mine the chat for test-case candidates

Review the conversation for flows that were **executed or specified clearly enough** to write Given/When/Then:

- End-to-end task with verifiable **Then** (banner, cell text, empty state, tab visible, …)
- Exact MCP steps used (`launch_app`, `ui_tap`, `ui_type`, `describe_ui`, `open_url`, …)
- **Input** strings, coordinates, identifiers from the session
- **Gotchas** and failure lessons worth repeating

One candidate = one user-facing task ("Create timed reminder", not "tap Add").

**Do not** invent steps that weren't walked or agreed in chat.

### 3. Ask the user which cases to add

**Required when two or more candidates exist** (or the scope is unclear).

Use **AskQuestion** (preferred) or a short numbered list in chat. Each option = one proposed case:

- Short title (future `TC-<SLUG>-###` headline)
- One-line summary of what **Then** verifies

Example options:

1. **Create coffee reminder** — Reminders tab shows "grab coffee…" at 4:00 PM
2. **Write personal scrib** — Scrib tab shows note + "Note saved." banner
3. **Share Safari page to Feed** — Feed tab shows shared article

If the user already named specific flows ("add tests for the coffee reminder and the scrib"), add **only** those — no question needed.

If **zero** clear candidates, say so and ask what they want captured.

### 4. Prepare or open the test file

```
test_cases/apps/<slug>.md
```

**File missing:** create from [test_cases/template.md](../../test_cases/template.md):

- Fill **App under test** (display name, bundle ID, knowledge map path)
- Copy **Conventions** block from template (includes 3-minute timeout)
- Start **Test cases** section

**File exists:** read it. Note highest `TC-<SLUG>-###` ID; new cases continue numbering.

### 5. Write each selected case

Append (or insert before `## Not covered yet`) using this shape:

```markdown
### TC-<SLUG>-###: <Short title>

**Tags:** smoke | regression | …

**Given:** <preconditions>

**When:**
1. `<tool>` <args>
2. ...

**Then:** <expected UI state — specific labels/text>

**Input:** `<if applicable>`

**Gotchas:** <optional>
```

**Rules:**

- **When** steps = open-sim MCP tool names with concrete args from the session
- **Then** = one verifiable assertion (what `describe_ui` should show)
- Inherit **3-minute global timeout** from Conventions (do not repeat per case unless overriding)
- Avoid duplicating an existing case — update the matching case if the flow changed
- If a flow is now covered, remove or trim the matching bullet under **Not covered yet**

Bump file header: `Last updated: <today>`.

### 6. Report to user

Short summary:

- File path (`test_cases/apps/<slug>.md`)
- IDs added or updated (`TC-SCRIB-011`, …)
- What each **Then** checks
- Anything skipped because it wasn't selected or wasn't verifiable

## Chat → test case checklist

Before saving each case:

- [ ] App slug and bundle ID correct
- [ ] Next ID not colliding with existing cases
- [ ] **Given** sets up only what the case needs (not whole suite state)
- [ ] **When** uses exact labels/identifiers/types from the session
- [ ] **Then** is observable (not vague "works")
- [ ] Gotchas capture label collisions, timeouts, flaky steps
- [ ] User confirmed selection when multiple candidates existed

## Relationship to other skills

| Skill | Scope |
|-------|-------|
| **learn-app** | Cold exploration; may seed initial test cases |
| **update-knowledge-from-chat** | Patch `knowledge/apps/`; optionally touch tests |
| **add-test-case-from-chat** | Add/update `test_cases/apps/` only, with user pick when ambiguous |

Prefer this skill when the user explicitly wants test cases. Prefer **update-knowledge-from-chat** when the primary goal is knowledge, with tests as a side effect.

## Example prompts

- "Add test cases from this chat for Scrib"
- "Save the coffee reminder flow as a test case"
- `/add-test-case-from-chat` — then choose from proposed list
- "Add tests for 1 and 3" — after you presented numbered options
