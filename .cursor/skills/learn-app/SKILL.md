---
name: learn-app
description: Maps iOS apps via open-sim MCP and saves navigation flows to knowledge/ for future automation. Use when the user says "learn app", "map app", or "document app"; when given an app to explore; or before automating a task in a specific app (e.g. "go to Scrib and make a reminder").
---

# Learn App

Build reusable app context for open-sim. Output lives in `knowledge/apps/` (gitignored, local only).

## When to read vs write

| Situation | Action |
|-----------|--------|
| User asks to learn/map/document an app | **Write** — run full exploration, save or update knowledge file |
| User asks to do something in a known app | **Read first** — check `knowledge/apps/<slug>.md`; use it to plan MCP steps |
| Knowledge file exists but is stale | **Update** — re-explore changed areas, merge into existing file |

## App slug

Derive from display name: lowercase, hyphens (`Scrib` → `scrib`, `Apple Reminders` → `apple-reminders`).

Knowledge path: `knowledge/apps/<slug>.md`

## Exploration workflow

Use open-sim MCP. Boot simulator if needed (`list_devices`, `boot_device`).

### 1. Resolve the app

```
list_apps → find bundle ID and display name
launch_app  OR  home screen → ui_tap label="<display name>"
describe_ui → confirm foreground app
```

Record: `bundleId`, `displayName`, home-screen `label`/`identifier`.

### 2. Map structure (breadth-first)

For each major area (tabs, nav stacks, modals):

1. `describe_ui` with `bundleId`
2. Note hittable elements: `label`, `identifier`, `type`, tab order
3. `ui_tap` into the area
4. `describe_ui` again — record child screens
5. Go back (back button, other tab, or `terminate_app` + relaunch)

Cover: tab bar, primary actions (+, Add, Create), settings, empty states, example prompts.

Use `ui_act` to batch navigation when exploring several tabs in one session.

### 3. Walk key flows (depth)

For each important user journey, execute it once and record exact steps:

- Launch path (home icon vs `launch_app`)
- Taps: prefer `label` or `labelContains`; note `identifier` when stable
- Text entry: field `type` and placeholder `value`
- Confirm/save button label
- Expected result (what `describe_ui` shows after)

Think like test cases: **Given → When → Then**.

Example flow to capture:

> **Create timed reminder**
> Given: Reminders tab
> When: tap Add → type "say hi to mom in 5 minutes" → tap Create Reminder
> Then: cell with title + scheduled time appears in list

### 4. Save knowledge file

Copy [template.md](template.md), fill every section, write to `knowledge/apps/<slug>.md`.

Create `knowledge/apps/` if missing.

### 5. Report to user

Summarize: screens found, flows documented, file path. Note gaps (permissions dialogs, login, paywalls not explored).

## Using knowledge during automation

Before any app-specific open-sim task:

1. Glob `knowledge/apps/*.md`
2. Match by slug, display name, or bundle ID
3. If found: follow documented launch path and flows; only `describe_ui` when the doc is ambiguous or the step fails
4. If missing: tell user no map exists; offer to run learn-app first

Prefer documented `label`/`identifier` over guessing. Fall back to `describe_ui` + reasoning when UI changed.

## Tips

- `describe_ui` can take ~10s; wait for results or read `/tmp/open-sim/active/result.json` if MCP times out
- After `launch_app`, omit `bundleId` on UI tools (session remembers it)
- To return home: `describe_ui` without bundleId (driver presses Home), or `terminate_app`
- Do not store screenshots in knowledge/ — labels and steps are enough
- Keep flows task-oriented ("make a reminder"), not just screen inventories

## Example prompts

**Learn:** "Learn the Scrib app" / "Map out Settings and save it"

**Use:** "Go to Scrib and make a reminder to say hi to mom" → read `knowledge/apps/scrib.md`, execute Create timed reminder flow
