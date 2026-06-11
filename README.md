# open-sim

A custom **Model Context Protocol (MCP)** server that lets Claude drive the **iOS Simulator** end-to-end — device control via `simctl`, and **in-app UI** via a generic XCUITest driver.

No hardcoded apps or labels. Claude looks at what's on screen, decides what to do, and acts.

## Requirements

- macOS with **Xcode** installed (`xcrun simctl` + XCUITest)
- **Node.js 18+**

## Install & build

```bash
npm install
npm run build:all    # builds XCUITest driver + Node server
```

Or separately:

```bash
npm run build:driver   # compile SimDriverUITests (first time / after Swift changes)
npm run build          # compile MCP server
```

## Connect to Cursor

`.cursor/mcp.json` is already configured:

```json
{
  "mcpServers": {
    "open-sim": {
      "command": "node",
      "args": ["${workspaceFolder}/dist/index.js"]
    }
  }
}
```

Open this folder in Cursor → **Settings → MCP** → enable `open-sim`.

## How it works (fluid, no hardcoding)

```
You: "Open Settings and turn on Airplane Mode"
         ↓
Claude: boot_device → launch_app / open_url / ui_tap
         describe_ui  → reads accessibility tree (labels, frames, types)
         screenshot   → sees the screen
         ui_tap       → taps by labelContains:"Airplane" or coordinates
         screenshot   → verifies
```

**Nothing is baked in per app.** The server exposes generic primitives. Claude reasons about whatever is on screen.

### Targeting options (all fluid)

| Method | Example | When to use |
|--------|---------|-------------|
| `labelContains` | `"Settings"`, `"Sign In"` | Most common — uses visible text |
| `identifier` | `"Safari"`, `"email_field"` | When accessibility identifiers exist |
| `type` | `button`, `switch`, `textField` | Filter by element kind |
| `x` / `y` (0–1) | `x: 0.5, y: 0.9` | Coordinates from screenshot + screen size |
| `ui_swipe` | `direction: "left"` | Navigate home screen pages, scroll lists |

After `launch_app`, the bundle ID is remembered — you don't need to repeat it for UI tools.

## Performance (persistent driver)

The XCUITest runner is the slow part of UI automation — a normal `xcodebuild test`
cold-start takes ~15-25s. To avoid paying that on *every* command, the server keeps a
**persistent daemon**: the test runner is launched once and then loops, reading
sequence-numbered commands from `/tmp/open-sim/active/command.json` and writing
results to `result.json`.

| Action | Cold start each command (old) | Persistent daemon (now) |
|--------|------------------------------|--------------------------|
| First command | ~20-25s | ~13s (one-time) |
| Tap | ~20-25s | ~2-3s |
| describe_ui | ~25-30s | ~4-7s |
| 6-command flow | ~120-150s | ~30s |

The daemon stays alive for 15 min of idle time, then exits; the next command respawns
it automatically. It's also respawned if the simulator restarts or the device changes.
Timeouts are tuned to fail fast: ~30s for daemon startup, ~10s per UI command, ~1s for
app foreground waits — so a bad command surfaces in seconds, not minutes.
A `daemon.flag` file in the active dir signals daemon mode to the in-simulator runner
(env vars don't propagate into the test process). Delete it to force single-shot mode
for debugging. Batch related actions with `ui_act` to share a single round-trip.

## Example prompts

- "Boot iPhone 17 Pro, show me what's on the home screen."
- "Tap the Settings app, describe what's on screen, then toggle the first switch you find."
- "Launch com.example.MyApp, type hello@example.com into the email field, and screenshot."
- "Swipe left on the home screen, tap Safari, and describe the page."
- "Set dark mode, override status bar to 9:41 with full battery, screenshot."

## Tools

### Device & OS (`simctl`)

| Tool | Description |
|------|-------------|
| `list_devices` | List simulators + state + UDIDs |
| `boot_device` / `shutdown_device` | Boot or shut down |
| `open_simulator` | Open the Simulator GUI |
| `install_app` / `launch_app` / `terminate_app` | App lifecycle |
| `screenshot` | Capture screen (returns image) |
| `set_location` / `set_privacy` / `set_appearance` | Environment |
| `set_status_bar` / `push_notification` | Status bar & push |
| `run_simctl` | Raw `simctl` escape hatch |

### In-app UI (XCUITest — any app)

| Tool | Description |
|------|-------------|
| `describe_ui` | Accessibility tree: labels, types, frames, hittable state |
| `ui_tap` | Tap by query (`labelContains`, `identifier`, `type`) or normalized coordinates |
| `ui_swipe` | Swipe direction or drag between coordinate pairs |
| `ui_type` | Type text; optionally focus a field first via query or coordinates |
| `ui_long_press` | Long press element or coordinate |
| `ui_wait` | Pause for animations/loading |
| `ui_act` | Run up to 20 actions in one XCUITest session (faster) |

## Architecture

```
Claude (Cursor MCP)
    ↓ stdio
open-sim (Node) ── simctl ──→ device/OS control
    ↓ spawns once: xcodebuild test-without-building (daemon)
SimDriverUITests (Swift) ── poll loop ──→ tap / swipe / type / describe on any app
```

The XCUITest driver lives in `driver/SimDriverHost/`. The runner starts once and polls
`/tmp/open-sim/active/command.json` for sequence-numbered commands, writing results to
`result.json` — keeping the session warm across calls. No app-specific logic.

## Development

```bash
npm run watch          # recompile TypeScript on change
npm run build:driver   # rebuild after Swift changes
npm run typecheck
```

## License

MIT
