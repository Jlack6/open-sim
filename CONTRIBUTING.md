# Contributing to open-sim

Thanks for your interest in improving open-sim! Contributions of all kinds are welcome — bug reports, docs, new tools, and fixes.

## Prerequisites

- macOS with **Xcode** installed (`xcrun simctl` + XCUITest)
- **Node.js 18+**

## Getting set up

```bash
git clone https://github.com/Jlack6/open-sim.git
cd open-sim
npm ci                 # install exact versions from package-lock.json
npm run build:all    # builds the XCUITest driver + Node server
```

Use `npm ci` (not bare `npm install`) when cloning so you get the exact locked tree. After changing `package.json`, run `npm install`, commit `package-lock.json`, and `npm run deps:verify`.

If you only change TypeScript, `npm run build` is enough. Rebuild the Swift driver with `npm run build:driver` after editing anything under `driver/`.

## Project layout

| Path | What it is |
|------|------------|
| `src/` | The MCP server (TypeScript) — tool definitions, `simctl` wrapper, XCUITest bridge |
| `driver/SimDriverHost/` | The XCUITest driver (Swift) that runs inside the simulator |
| `scripts/build-driver.sh` | Builds the driver with `xcodebuild build-for-testing` |
| `web/` | The project website (static HTML/CSS/JS) |
| `.cursor/skills/` | Cursor skills for app-knowledge workflows |
| `test_cases/template.md` | Shared template for app test suites |

## Before you open a PR

1. **Type-check:** `npm run typecheck` must pass with no errors.
2. **Build:** `npm run build` (and `npm run build:driver` if you touched Swift).
3. **Dependencies:** If you changed `package.json`, run `npm install`, `npm run deps:sync`, `npm install` again, commit `package.json` + `package-lock.json`, and `npm run deps:verify`. All lockfile packages must have exact `overrides`; only official `@modelcontextprotocol/sdk`.
4. **Keep it generic.** A core principle of open-sim is *no hardcoded app logic*. Tools should expose generic primitives; app-specific knowledge belongs in `knowledge/` (local) or `test_cases/`, not in `src/`.
5. **Match the existing style.** Small, focused commits; clear tool descriptions; errors wrapped so a single failure never crashes the server.

## Reporting bugs & requesting features

Open an issue using the templates in `.github/ISSUE_TEMPLATE/`. Include your macOS and Xcode versions, the simulator/runtime in use, and the exact prompt or tool call that triggered the problem.

## Security

Please do **not** file public issues for security problems. See [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE) that covers this project.
