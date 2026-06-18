# Advisory & leak research (all packages)

Every dependency-safety run must cover **all** packages in `package-lock.json`, not a short list.

## Automated — every package

| Step | Command | What it does |
|------|---------|----------------|
| OSV advisories | `npm run deps:audit-osv` | Queries [OSV](https://osv.dev) for **every** unique `name@version` in the lockfile (~94 packages) |
| npm audit | `npm audit` | npm’s CVE database on the full tree |
| Pin verification | `npm run deps:verify` | Exact overrides for **all** lockfile packages + MCP policy + integrity |
| Lockfile scan | `audit-deps.sh` | Lists all packages, install scripts, registry URLs |

`deps:verify` runs pin checks **and** OSV with `--fail-on=high`.

After changing dependencies:

```bash
npm install
npm run deps:sync    # refresh overrides for all lockfile packages
npm install        # apply overrides
npm run deps:verify
```

## Agent — ecosystem news (once per run)

WebSearch (human-readable leaks not always in OSV yet):

```
npm supply chain attack MCP 2026
npm malware preinstall 2026
```

Confirm lockfile contains **none** of: PhantomRaven typosquats, `plain-crypto-js`, compromised `@redhat-cloud-services/*`, malicious `axios` versions (`1.14.1`, `0.30.4`). These are also blocked in `scripts/deps-lib.mjs`.

## Policy enforced on every package

| Policy | Enforcement |
|--------|-------------|
| Exact pin | `overrides` in `package.json` — one exact version per package name (`deps:sync`) |
| Direct deps exact | No `^` / `~` in `dependencies` / `devDependencies` |
| MCP only official SDK | Only `@modelcontextprotocol/sdk` under `@modelcontextprotocol/*` |
| Registry + integrity | Every lockfile entry |
| No install scripts | Every lockfile entry |
| Blocked malware names | Scanned across full lockfile |

## Runtime tags (when reporting findings)

| Tag | Meaning |
|-----|---------|
| **Runtime** | Affects open-sim today (stdio MCP, local simctl) |
| **Installed only** | In `node_modules` but no HTTP server started |
| **By design** | `run_simctl`, agent automation — see SECURITY.md |
| **Disputed** | Advisory disputed by maintainer |

open-sim uses `StdioServerTransport` only — MCP SDK HTTP CVEs are usually **Installed only**.
