---
name: test-plz
description: Tests all simulator-testable changes on a branch or commit by reading the git diff, exercising every mapped flow on the iOS Simulator, and reporting pass/fail plus a coverage percentage with gaps. Surfaces bugs, potential issues, and notable changes at the end when worth calling out. Asks for a repo or folder path on first use and remembers it. Uses learn-app when no knowledge map exists. Use when the user says "test plz", "test my changes", "test this branch", or wants pre-push confidence on local React Native or iOS app changes.
---

# Test Plz

Hands-off simulator testing after local code changes. Inventory **every change** on the branch or commit, test **everything the simulator can reach**, and report pass/fail plus a **coverage percentage** so the engineer knows what was verified before pushing.

## When to run

| Trigger | Action |
|---------|--------|
| User says "test plz", `/test-plz`, "test my changes", "test this branch" | Run this skill |
| User changed app logic locally and wants verification | Run this skill |
| User gives a repo path + "test it" | Run this skill |

## Paths

| File | Purpose |
|------|---------|
| `knowledge/test-plz/registry.md` | Local repo registry (path → app slug, bundle ID) |
| `knowledge/apps/<slug>.md` | App map — read before testing; create via **learn-app** if missing |
| `test_cases/apps/<slug>.md` | Runnable cases — prefer when present |
| [test_cases/template.md](../../test_cases/template.md) | Case conventions (3-minute timeout, Last run table) |

All under `knowledge/` and `test_cases/apps/` are gitignored — local only.

---

## Workflow

### 1. Resolve the repo

**If the user named a path in this message**, use it.

**Otherwise**, read `knowledge/test-plz/registry.md`. If one repo is listed, confirm with the user ("Testing changes in `<path>` — OK?"). If several, use **AskQuestion** to pick one. If none, **ask the user for the repo or folder path** before continuing.

Record or update the registry:

```markdown
# test-plz Registry

| Name | Path | App slug | Bundle ID | Notes |
|------|------|----------|-----------|-------|
| my-rn-app | /Users/me/projects/my-rn-app | my-rn-app | com.example.app | Metro on :8081 |
```

Fill **App slug** and **Bundle ID** once known (step 3). Create `knowledge/test-plz/` if missing.

### 2. Inventory every change

In the repo directory, run in parallel:

```bash
git status
git branch --show-current
git log --oneline -10
git diff                    # unstaged
git diff --cached           # staged
git diff main...HEAD        # branch vs main (use master if that's the default)
git diff --name-only main...HEAD   # full file list for inventory
```

Build a **change inventory** — one row per meaningful unit of work (file or distinct behavior):

| # | Change | Source file(s) | User-visible? | Simulator-testable? |
|---|--------|----------------|---------------|---------------------|

Rules for the inventory:

- Include **every changed file** from the diff (branch vs base, plus unstaged/staged if the user is testing working tree).
- For each file, read the diff and split into **distinct behaviors** when one file covers multiple flows (e.g. `HomeScreen.tsx` → form draft save + submit + navigate).
- Mark **User-visible?** — yes if a user could see or trigger it in the app UI.
- Mark **Simulator-testable?** — yes only if open-sim can verify it on the current simulator setup without tools you don't have.

**Not simulator-testable** (still list, with reason):

- `package.json` / lockfile-only dep bumps (unless native rebuild + new UI)
- Pure types, constants, or helpers with no UI surface
- Server/API-only logic with no local mock
- Native module changes when app wasn't rebuilt
- Persistence across cold start (note as testable only if you can `terminate_app` + relaunch)

If the user named a **specific commit**, diff that commit instead of the branch. If not a git repo, inventory the current working tree and note no diff baseline.

Ask the user only when a testable behavior is ambiguous — otherwise derive flows from the diff and code.

### 3. Resolve the app under test

From registry, repo metadata, or the user:

| Source | Look for |
|--------|----------|
| Registry | App slug, bundle ID |
| React Native | `app.json` / `app.config.js` → `ios.bundleIdentifier` or `expo.ios.bundleIdentifier` |
| Native iOS | `*.xcodeproj` / `Info.plist` → `CFBundleIdentifier` |
| User | Display name, simulator app icon |

Derive **app slug** (lowercase, hyphens). Update registry row if new fields were learned.

**Pre-flight** — ask or infer:

- Is the app **already running** on the simulator (hot reload / dev build)?
- Does the simulator need a **rebuild** (`npx react-native run-ios`, Xcode build)?
- Is **Metro** (or another bundler) running?

Do not rebuild unless the user asks or native code changed. For JS-only changes, assume hot reload is enough once the app is foregrounded.

### 4. Get familiar with the app (first time only)

Glob `knowledge/apps/<slug>.md`.

| Knowledge file | Action |
|----------------|--------|
| **Missing** | Read and follow [.cursor/skills/learn-app/SKILL.md](../learn-app/SKILL.md) — full exploration, save map, then return here |
| **Present** | Read it; use documented flows and labels for testing |
| **Stale / step fails** | Re-explore the affected area (learn-app update pattern) or ask the user |

### 5. Build full coverage plan

Goal: **one test for every simulator-testable row** in the change inventory. Do not stop after the first passing flow.

**Sources (merge, don't pick one):**

1. **Change inventory** — every row with Simulator-testable = yes gets a planned test.
2. **Existing test cases** — read `test_cases/apps/<slug>.md`; reuse cases that cover inventory rows.
3. **Knowledge flows** — map rows to flows in `knowledge/apps/<slug>.md`.
4. **Ad-hoc flows** — for rows with no case, write **Given → When → Then** before running.

Track each inventory row through planning:

| Status | Meaning |
|--------|---------|
| `planned` | Mapped to a case or ad-hoc flow, not run yet |
| `tested-pass` | Ran on simulator, assertion met |
| `tested-fail` | Ran on simulator, assertion failed |
| `blocked` | Testable in theory but couldn't run (app not open, missing data, env issue) |
| `skipped` | Not simulator-testable — record reason |

Present a short plan listing **all** planned tests (inventory # + behavior name) unless the user said "just run it".

### 6. Run all planned tests on the simulator

Use **open-sim MCP**. Boot simulator if needed (`list_devices`, `boot_device`).

**Run every `planned` row** — work through the full coverage plan, not just changed-area smoke. Update inventory status after each row.

**Per test** (case file or ad-hoc):

- Clock starts on first **When** step — **3-minute timeout** per test
- Execute **When** steps with documented `label` / `identifier` from knowledge
- Verify **Then** with `describe_ui` (or documented assertion)
- On timeout: record **FAIL (timeout)**, mark row `tested-fail`, move on
- On MCP timeout (~10s): check `/tmp/open-sim/active/result.json` or `describe_ui` before retrying
- On environment block: mark row `blocked` with reason, continue with remaining rows

Track: pass / fail / timeout / blocked per inventory row. Note wall-clock start (first **When**) and end (last **Then** or abort).

While running tests, also collect **findings** for step 7 — things worth telling the engineer beyond pass/fail:

- **Bugs** — UI defects or logic errors (wrong counts, broken sort, missing clear, tap targets blocked, …)
- **Potential issues** — not proven failures but risky (label collisions for automation, flaky coords, missing `accessibilityLabel`, perf jank, edge cases untested)
- **Notable changes** — intentional or incidental diffs worth flagging (renamed buttons, copy changes, new empty states, behavior shifts vs knowledge map) even when tests pass

Do not fix code unless asked. Do not pad the report — if nothing stands out, skip findings entirely.

Tips:

- After `launch_app`, omit `bundleId` on UI tools
- Use `ui_act` for multi-step flows inside one app session
- Prefer knowledge labels over guessing
- Dismiss keyboard before tapping buttons hidden behind it
- For persistence behaviors: `terminate_app` → relaunch → verify state restored

### 7. Report results with coverage

Always end with a coverage summary so the engineer knows what pushing will and won't verify.

**Coverage math:**

```
testable   = rows where Simulator-testable = yes
tested     = tested-pass + tested-fail + blocked   (attempted on simulator)
passed     = tested-pass
coverage % = round(100 × tested / testable)        # attempted coverage
pass rate  = round(100 × passed / testable)        # green-light signal (only if all testable passed)
```

If `blocked > 0` or any `tested-fail`, call out that push confidence is **partial** even when coverage % is high.

```markdown
## test-plz results — <App name>

**Repo:** `<path>` · **Branch:** `<branch>` · **Base:** `<main|commit>`
**Coverage:** **85%** (11/13 simulator-testable behaviors attempted) · **Pass rate:** 92% (12/13 passed)

### Test results

| # | Behavior | Result | Notes |
|---|----------|--------|-------|
| 1 | Settings tab shows entry count | PASS | |
| 2 | Clear all with confirmation | PASS | |
| 3 | Form draft persists after navigate away | FAIL | Draft empty after tab switch |

### Not tested on simulator

| # | Change | Reason |
|---|--------|--------|
| 4 | `types/Entry.ts` | No UI surface — type-only |
| 5 | AsyncStorage cold-start restore | BLOCKED — could not relaunch Expo Go project |

### Push confidence

<One sentence: e.g. "Safe to push UI flows; persistence across cold start was not verified.">

### Findings

**Include this section only when something is worth calling out.** Omit it entirely when tests passed and you found no bugs, risks, or surprising changes — do not write "no issues found."

When present, group briefly:

| Kind | What to include |
|------|-----------------|
| **Bug** | What breaks, how to reproduce, file/line if known from the diff |
| **Potential issue** | What might go wrong and why (unverified edge case, automation gotcha, mismatch with docs) |
| **Notable change** | What changed in the UI or behavior vs before / vs `knowledge/apps/<slug>.md` — even if intentional and tests pass |

Keep each item to one or two sentences. Tie bugs and risks to evidence (failed assertion, `describe_ui` output, or diff hunk). Do not duplicate rows already covered in **Test results** unless adding root-cause or fix context.

**Total run time:** Xm Ys
**Simulator:** <device name>
```

If **Last run** table exists in `test_cases/apps/<slug>.md`, update it (date, pass/fail/timeout counts, total run time, coverage %, notes).

### 8. Follow-ups (offer, don't auto-run)

- New flow worked but no case exists → offer **add-test-case-from-chat**
- UI changed → offer **update-knowledge-from-chat**
- Failure or finding looks like a code bug → point to relevant diff hunk, don't fix unless asked

---

## Registry template

Create `knowledge/test-plz/registry.md` on first use:

```markdown
# test-plz Registry

> Local only — maps repos you test with test-plz.

| Name | Path | App slug | Bundle ID | Notes |
|------|------|----------|-----------|-------|
```

---

## Relationship to other skills

| Skill | Role in test-plz |
|-------|------------------|
| **learn-app** | First-time app mapping before testing |
| **add-test-case-from-chat** | Capture a verified flow after testing |
| **update-knowledge-from-chat** | Patch map when UI differed from doc |

---

## Example prompts

- `/test-plz` — agent asks for repo path, then runs the workflow
- "Test plz — repo is ~/projects/my-rn-app, I changed the reminder save logic"
- "Test my changes on this branch" (repo already in registry)
- "I updated the login screen, test it on the simulator"

## Example session

1. User: "test plz" → agent asks for repo path
2. User: `~/code/Scrib` → agent saves registry, diffs `feature/reminder-fix` vs `main`
3. Builds inventory: 8 files → 10 behaviors (7 simulator-testable, 3 type/config only)
4. No `knowledge/apps/scrib.md` → agent runs **learn-app**, maps Scrib
5. Plans 7 tests (3 existing cases + 4 ad-hoc), runs all 7 on simulator
6. Reports **100% coverage** (7/7 attempted), **86% pass rate** (6/7 passed), lists the 3 non-testable files + 1 failure, optional **Findings** for bugs or notable UI changes, 4m 10s total
