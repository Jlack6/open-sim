# Confidence score rubric

Use when updating [DEPENDENCY-SAFETY.md](../../../DEPENDENCY-SAFETY.md) after each audit.

## Points (max 100)

| Factor | Points | Pass when |
|--------|--------|-----------|
| npm audit | 25 | 0 critical + 0 high (moderate → 15; any high/critical unpatched → 0) |
| Lockfile sound | 20 | Committed, no drift, all `registry.npmjs.org`, all have `integrity` |
| No install scripts | 15 | `hasInstallScript` count = 0 |
| Secret scan | 15 | `check-no-secrets.sh --tracked` exits 0 |
| Web research | 15 | OSV clean for all packages in `deps:verify`; agent supply-chain news optional |
| Malware signals | 10 | No typosquat names, no non-registry `resolved`, no known-malware package names |

## OSV / advisory deductions (from the 15-point bucket)

| Situation | Deduct |
|-----------|--------|
| `deps:verify` passes OSV for all packages | 0 |
| OSV reports high/critical at locked version | 15 (entire bucket) |
| Did not run `deps:verify` / OSV | 15 (entire bucket) |

## Label

| Score | Label |
|-------|-------|
| 85–100 | **Good** |
| 70–84 | **Fair** |
| &lt;70 | **Poor** |

## npm audit deductions (override)

If locked tree has unpatched **critical** or **high** CVE with no acceptable rationale, cap total score at **69** regardless of other factors.
