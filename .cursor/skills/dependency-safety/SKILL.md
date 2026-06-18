---
name: dependency-safety
description: Audits all open-sim dependencies via lockfile, npm audit, OSV (every package), full override pins, and MCP policy. Updates DEPENDENCY-SAFETY.md. Use when the user says "dependency safety", "security audit", or "check dependencies".
---

# Dependency Safety

Full dependency and security audit for **open-sim**. Be transparent — run real checks, web-research key packages, score confidence, update [DEPENDENCY-SAFETY.md](../../../DEPENDENCY-SAFETY.md), and tell the user what risks matter.

## When to run

| Trigger | Action |
|---------|--------|
| "dependency safety", "security audit", "check dependencies" | Run full workflow |
| Before release or after `package.json` / lockfile changes | Run full workflow |
| "is open-sim safe for company use?" | Run full workflow |

## Workflow

```
Dependency safety:
- [ ] 1. audit-deps.sh + npm audit
- [ ] 2. npm run deps:verify (all-package pins + OSV scan)
- [ ] 3. Secret scan
- [ ] 4. Web research — ecosystem supply-chain news (OSV already covers all packages)
- [ ] 5. Application security (src/) — brief
- [ ] 6. Score confidence
- [ ] 7. Update DEPENDENCY-SAFETY.md
- [ ] 8. Tell user: score, risks, link to DEPENDENCY-SAFETY.md
```

### 1. Automated audit

```bash
.cursor/skills/dependency-safety/scripts/audit-deps.sh
npm audit --audit-level=high
```

Read full output — **all** locked packages, not just key ones.

### 2. Full dependency verify + OSV (all packages)

```bash
npm run deps:verify
```

This runs:

- `verify-deps.sh` — every lockfile package has a matching exact `override`; MCP policy; integrity; no install scripts
- `audit-osv.mjs` — OSV advisory lookup for **every** unique `name@version` (~94 packages); fails on high/critical

If overrides are stale after a bump: `npm run deps:sync && npm install && npm run deps:verify`.

### 3. Secret scan

```bash
./scripts/check-no-secrets.sh --tracked
```

Fail blocks a Good score — fix before finishing.

### 4. Ecosystem web research

Read [web-research.md](web-research.md). OSV in step 2 already covers **all** packages for known CVEs. The agent still runs **1–2 web searches** for recent supply-chain news (Shai-Hulud, MCP attacks, compromised maintainers) that may not be in OSV yet.

Do **not** manually Google all 94 package names — `deps:verify` + OSV replaces that.

### 5. Application security (brief)

Skim `src/simctl.ts`, `src/xcui.ts`, `src/index.ts`:

- `StdioServerTransport` only (no HTTP listener)
- `execFile`/`spawn` without shell
- Zod on tool inputs
- `run_simctl` = intentional — [SECURITY.md](../../../SECURITY.md)

### 6. Confidence score

Apply [confidence-rubric.md](confidence-rubric.md). Fill the score table in DEPENDENCY-SAFETY.md.

Tell the user the **number**, **label** (Good / Fair / Poor), and **one sentence why**.

### 7. Update DEPENDENCY-SAFETY.md

**Always** rewrite [DEPENDENCY-SAFETY.md](../../../DEPENDENCY-SAFETY.md) at repo root. Keep it **simple** — one screenful. Structure:

1. **Last audited** (UTC date) + **Confidence** score + label
2. **Summary** table (audit, lockfile, install scripts, secret scan, malware)
3. **Potential risks** — three subsections:
   - *By design* (`run_simctl`, agent automation)
   - *Dependency / ecosystem* — table: Risk | Severity for open-sim | Notes
   - *What this audit does not cover*
4. **Direct dependencies** table (locked version + web status)
5. **Confidence score** breakdown table
6. Link to SECURITY.md

Do not paste all 95 packages — link `package-lock.json`.

### 8. User message

After updating the file, tell the user:

1. Confidence score and label
2. Top 2–4 risks that matter (skip noise marked Installed only)
3. Whether anything needs action now
4. Link: [DEPENDENCY-SAFETY.md](../../../DEPENDENCY-SAFETY.md)

Optional: also fill [report-template.md](report-template.md) for a long chat report if the user asked for detail.

---

## Rating (plain language)

| Label | When |
|-------|------|
| **Good** (85–100) | Audit clean, lockfile sound, key CVEs patched or N/A for stdio |
| **Fair** (70–84) | Moderate issues or incomplete web research |
| **Poor** (&lt;70) | Unpatched high/critical CVE, secret fail, or malware signal |

---

## Scope

| Area | Check |
|------|-------|
| npm | `package.json`, `package-lock.json` (~95 packages) |
| Swift | No Podfile / SPM externals in `driver/` |
| `web/` | Static only; note external CDN URLs |
| CI | `.github/workflows/` — action pins, no secrets |

---

## After dependency changes

1. `npm install` → `npm run deps:sync` → `npm install` → `npm run deps:verify`
2. Re-run this skill
3. DEPENDENCY-SAFETY.md must reflect new versions and scores
