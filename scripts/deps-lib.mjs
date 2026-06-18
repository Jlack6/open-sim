import fs from "node:fs";
import path from "node:path";

/** @typedef {{ name: string, version: string, path: string, dev: boolean }} LockedPackage */

export const BLOCKED_SCOPES = ["@iflow-mcp/", "@open-sim/"];
export const BLOCKED_PACKAGE_NAMES = new Set([
  "plain-crypto-js",
  "typescript-validation-schema",
  "typescript-react-query",
  "typescript-resolvers",
]);

export const ALLOWED_MCP_PACKAGES = new Set(["@modelcontextprotocol/sdk"]);

export function repoRoot() {
  const root = process.cwd();
  if (!fs.existsSync(path.join(root, "package.json"))) {
    throw new Error("run from repo root (package.json not found)");
  }
  return root;
}

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function writeJson(file, data) {
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

/** Every installed package from package-lock.json (including nested paths). */
export function listLockedPackages(lock) {
  /** @type {LockedPackage[]} */
  const out = [];
  for (const [pkgPath, meta] of Object.entries(lock.packages ?? {})) {
    if (!pkgPath.startsWith("node_modules/")) continue;
    const name = pkgPath.replace(/^node_modules\//, "").split("node_modules/").pop();
    out.push({
      name,
      version: meta.version ?? "?",
      path: pkgPath,
      dev: !!meta.dev,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

/** Unique package name → version to pin. On version conflict, use highest semver. */
export function resolvePinVersions(packages) {
  /** @type {Map<string, { version: string, versions: Set<string> }>} */
  const map = new Map();
  for (const pkg of packages) {
    if (!map.has(pkg.name)) {
      map.set(pkg.name, { version: pkg.version, versions: new Set([pkg.version]) });
      continue;
    }
    const entry = map.get(pkg.name);
    entry.versions.add(pkg.version);
    if (compareSemver(pkg.version, entry.version) > 0) {
      entry.version = pkg.version;
    }
  }
  return map;
}

/** @returns {Record<string, string>} */
export function buildOverridesFromLockfile(lock) {
  const pins = resolvePinVersions(listLockedPackages(lock));
  /** @type {Record<string, string>} */
  const overrides = {};
  for (const [name, { version }] of [...pins.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    overrides[name] = version;
  }
  return overrides;
}

export function compareSemver(a, b) {
  const pa = a.replace(/^v/, "").split("-")[0].split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.replace(/^v/, "").split("-")[0].split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da > db ? 1 : -1;
  }
  return 0;
}

/** Unique name@version pairs for OSV (nested duplicate names kept). */
export function uniqueNameVersions(packages) {
  const seen = new Set();
  /** @type {{ name: string, version: string }[]} */
  const out = [];
  for (const pkg of packages) {
    const key = `${pkg.name}@${pkg.version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name: pkg.name, version: pkg.version });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

export function checkPolicy(lock, pkg) {
  const packages = listLockedPackages(lock);
  const errors = [];

  for (const name of BLOCKED_PACKAGE_NAMES) {
    if (packages.some((p) => p.name === name)) {
      errors.push(`blocked malware/typosquat package: ${name}`);
    }
  }

  for (const scope of BLOCKED_SCOPES) {
    const prefix = scope.replace(/\/$/, "");
    if (packages.some((p) => p.name.startsWith(prefix + "/") || p.name === prefix)) {
      errors.push(`blocked scope in lockfile: ${scope}*`);
    }
  }

  const mcp = packages.filter((p) => p.name.startsWith("@modelcontextprotocol/")).map((p) => p.name);
  const mcpUnique = [...new Set(mcp)];
  for (const name of mcpUnique) {
    if (!ALLOWED_MCP_PACKAGES.has(name)) {
      errors.push(`disallowed MCP package: ${name} (only @modelcontextprotocol/sdk allowed)`);
    }
  }
  if (mcpUnique.length === 0) {
    errors.push("missing required @modelcontextprotocol/sdk");
  }

  const sections = ["dependencies", "devDependencies"];
  for (const key of sections) {
    for (const [name, range] of Object.entries(pkg[key] ?? {})) {
      if (/^[~^]/.test(range) || range.includes(" ") || range.includes("||")) {
        errors.push(`direct dep must be exact version: ${name} ${range}`);
      }
    }
  }

  for (const [, meta] of Object.entries(lock.packages ?? {})) {
    if (meta.hasInstallScript) {
      errors.push("package with install script in lockfile");
      break;
    }
    if (meta.resolved && !meta.resolved.startsWith("https://registry.npmjs.org/")) {
      errors.push(`non-registry URL: ${meta.resolved}`);
      break;
    }
    if (meta.resolved && !meta.integrity) {
      errors.push("missing integrity hash in lockfile");
      break;
    }
  }

  const expected = buildOverridesFromLockfile(lock);
  const actual = pkg.overrides ?? {};
  for (const [name, version] of Object.entries(expected)) {
    if (actual[name] !== version) {
      errors.push(`override mismatch for ${name}: expected ${version}, got ${actual[name] ?? "(missing)"}`);
    }
  }
  for (const name of Object.keys(actual)) {
    if (!(name in expected)) {
      errors.push(`stale override not in lockfile: ${name}`);
    }
  }

  const pins = resolvePinVersions(packages);
  for (const [name, { version, versions }] of pins.entries()) {
    if (versions.size > 1) {
      errors.push(
        `note: ${name} has ${versions.size} versions in lockfile (${[...versions].join(", ")}); overrides pin ${version}`,
      );
    }
  }

  return { errors, packages, expectedOverrides: expected };
}

const SEVERITY_RANK = { CRITICAL: 4, HIGH: 3, MODERATE: 2, MEDIUM: 2, LOW: 1, UNKNOWN: 0 };

export function maxSeverity(vulns) {
  let max = "UNKNOWN";
  let rank = 0;
  for (const v of vulns) {
    for (const id of v.ids ?? []) {
      const sev = (id.severity ?? "UNKNOWN").toUpperCase();
      const r = SEVERITY_RANK[sev] ?? 0;
      if (r > rank) {
        rank = r;
        max = sev;
      }
    }
  }
  return max;
}

export async function queryOsvBatch(queries, batchSize = 50) {
  /** @type {unknown[]} */
  const results = [];
  for (let i = 0; i < queries.length; i += batchSize) {
    const chunk = queries.slice(i, i + batchSize);
    const res = await fetch("https://api.osv.dev/v1/querybatch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        queries: chunk.map(({ name, version }) => ({
          package: { name, ecosystem: "npm" },
          version,
        })),
      }),
    });
    if (!res.ok) {
      throw new Error(`OSV querybatch failed: ${res.status} ${await res.text()}`);
    }
    const body = await res.json();
    results.push(...(body.results ?? []));
  }
  return results;
}
