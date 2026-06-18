# Dependency safety

**Last audited:** 2026-06-18T01:28Z (UTC)  
**Confidence:** 100 / 100 — **Good** (npm audit + OSV clean on all 94 packages; full override pins; no install scripts; secret scan pass)

Re-run: `npm run deps:verify` or say `dependency safety` in Cursor

### Pinning policy (all packages)

| Layer | How |
|-------|-----|
| Direct deps (4) | Exact versions in `package.json` |
| All lockfile packages (94) | Exact `overrides` — `npm run deps:sync` |
| Advisories | OSV for every `name@version` — `npm run deps:audit-osv` |
| MCP | Only `@modelcontextprotocol/sdk` |
| Verify | `npm run deps:verify` |

---

## Summary

open-sim installs **94 npm packages**. All from `registry.npmjs.org` with integrity hashes. **94 exact overrides.** **No install scripts.** `npm audit` and **OSV** report **0** advisories.

| Check | Result |
|-------|--------|
| npm audit | 0 critical / high / moderate / low |
| OSV (all 94 packages) | 0 advisories |
| Override pins | 94 / 94 |
| Lockfile integrity | Pass |
| Install scripts | 0 |
| Secret scan | Pass |
| Blocked malware / fake MCP names | Not in tree |
| `binding.gyp` in installed packages | None |

---

## Potential risks

### By design (not dependency bugs)

- **`run_simctl`** — arbitrary `simctl` subcommands ([SECURITY.md](SECURITY.md))
- **AI-driven automation** — the agent picks tools; scope what you authorize
- **Local execution** — `simctl`, `xcodebuild`, XCUITest on your Mac

### Dependency / ecosystem

| Risk | Severity for open-sim | Notes |
|------|----------------------|-------|
| MCP SDK past HTTP CVEs | **Low** | sdk@1.29.0 patched. **Stdio only** — HTTP paths inactive at runtime. |
| Transitive HTTP stack (express, hono, …) | **Low** | Installed, not started as a server. All pinned versions clean in OSV. |
| npm worms (Miasma, Phantom Gyp, Shai-Hulud, @redhat-cloud-services) | **Low today** | Jun 2026 campaigns target other packages/scopes. None in our lockfile. 0 install scripts; no `binding.gyp`. |
| MCP ecosystem targeting | **Info** | Industry-wide; we use official `@modelcontextprotocol/sdk` only. |
| Google Fonts CDN (`web/`) | **Info** | Website visitors only. |

### What this audit does not cover

- Cursor, Xcode, or simulator apps you automate
- Zero-days not yet in OSV/npm (ecosystem news checked this run — nothing new affecting our tree)
- Future compromised versions if you bump deps without re-running `deps:verify`

---

## Direct dependencies

| Package | Locked | Status |
|---------|--------|--------|
| `@modelcontextprotocol/sdk` | 1.29.0 | Official; OSV clean |
| `zod` | 3.25.76 | OSV clean |
| `typescript` | 5.9.3 (dev) | OSV clean |
| `@types/node` | 22.19.20 (dev) | OSV clean |

Full tree: [package-lock.json](package-lock.json)

---

## Confidence score

| Factor | Points | This run |
|--------|--------|----------|
| npm audit clean | 25 | 25 |
| Lockfile sound | 20 | 20 |
| No install scripts | 15 | 15 |
| Secret scan pass | 15 | 15 |
| OSV all packages clean | 15 | 15 |
| No malware signals | 10 | 10 |
| **Total** | **100** | **100** |

| Score | Meaning |
|-------|---------|
| 85–100 | **Good** |
| 70–84 | **Fair** |
| &lt;70 | **Poor** |

---

## Report a problem

[SECURITY.md](SECURITY.md) (private). After bumps: `npm install` → `deps:sync` → `npm install` → `deps:verify`.
