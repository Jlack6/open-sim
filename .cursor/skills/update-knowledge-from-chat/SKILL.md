---
name: update-knowledge-from-chat
description: Merges new app learnings from the current chat into knowledge/apps/ without a full re-exploration. Use when the user asks to update knowledge from chat, after completing novel open-sim app work, or when a session discovered flows, elements, or gotchas not already documented.
---

# Update Knowledge From Chat

Incrementally improve `knowledge/apps/<slug>.md` from what you just did in this conversation — not a full remap (see **learn-app** for that).

## When to run

| Trigger | Action |
|---------|--------|
| User says "update knowledge", "save what we learned", etc. | Run this skill for the app(s) discussed |
| You finished app automation and hit new UI, flows, or failures | Offer to update, or run if user expects continuous learning |
| Existing knowledge was wrong or incomplete | Correct the file; note what changed |

**Do not** replace the whole file. **Merge** deltas.

## Workflow

### 1. Identify the app

From chat context: display name, bundle ID, or slug. Slug = lowercase with hyphens (`Scrib` → `scrib`).

Target: `knowledge/apps/<slug>.md` and optionally `test_cases/apps/<slug>.md`

If missing, run **learn-app** first or create from [learn-app/template.md](../learn-app/template.md).

### 2. Mine the chat for learnings

Review the conversation for anything **not already** in the knowledge file:

- **New flows** — task you completed end-to-end (steps, tools, labels)
- **New elements** — buttons, fields, identifiers discovered via `describe_ui`
- **Screen updates** — non-empty states, edit modes, confirmation dialogs
- **Gotchas** — timeouts that still succeeded, ambiguous labels, duplicate actions to avoid
- **Corrections** — old doc was wrong or "not yet explored" is now explored
- **Success checks** — what `describe_ui` showed when the task worked

Ignore routine steps already documented identically.

### 3. Merge into the knowledge file

Read the existing file. Apply **surgical edits** only:

| Section | What to add |
|---------|-------------|
| `### Screens` | New elements, populated states, edit modes |
| `## Flows` | New `### Flow name` blocks (same format as learn-app) |
| `## Element quick reference` | New rows; don't duplicate existing rows |
| `**Gotchas:**` under a flow | Append new bullets |
| `## Not yet explored` | Remove items you now covered |
| Header | Bump `Last updated: <today>` |

**Merge rules:**
- Prefer **adding** over rewriting unless something is wrong
- One flow per user-facing task ("Delete reminder", not "tap Edit")
- Record exact `label`, `identifier`, `type` from the session
- Include **failure lessons** (e.g. MCP timeout ≠ action failed — verify before retrying)
- Disambiguate colliding labels (nav `Done` vs tab `Done`)

### 3b. Update test cases (when flow is regression-worthy)

If you added or materially changed a flow worth regression-testing, run **add-test-case-from-chat** or add/update a case in `test_cases/apps/<slug>.md` (see [test_cases/template.md](../../test_cases/template.md)).

### 4. Report to user

Short summary:
- Files updated (`knowledge/` and/or `test_cases/`)
- What was added (flows, test cases, elements, gotchas)
- What remains in "Not yet explored"

## What to capture (examples)

From a typical session:

```
New flow: Delete reminder
  Edit → minus.circle.fill (index 0) → Delete → one cell remains

New state: Scrib list with notes
  cell + staticText title; "1 active note" footer; per-note Done button

Gotcha: ui_act timeout may still complete — describe_ui before retrying

Gotcha: Don't batch create flows blindly; verify list after timeout
```

## Chat → knowledge checklist

Before saving, confirm you captured:

- [ ] Launch path (if different from doc)
- [ ] Tab/screen reached
- [ ] Each tap target (`label` / `identifier` / `index`)
- [ ] Input field `type` (`textField` vs `textView`)
- [ ] Confirm button label
- [ ] Success check from final `describe_ui`
- [ ] Gotchas worth repeating
- [ ] Removed stale "not yet explored" entries

## Relationship to learn-app

| Skill | Scope |
|-------|-------|
| **learn-app** | Cold exploration — map entire app from simulator |
| **update-knowledge-from-chat** | Warm update — patch knowledge from session experience |

Use both: learn-app for first contact; this skill after every session that teaches something new.

## Example prompts

- "Update Scrib knowledge from what we just did"
- "Save the delete-reminder flow to knowledge"
- (After novel automation) "I found the edit mode — want me to update knowledge/apps/scrib.md?"
