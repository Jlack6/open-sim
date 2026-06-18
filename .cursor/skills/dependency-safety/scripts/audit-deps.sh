#!/usr/bin/env bash
# Collect dependency and supply-chain signals for the dependency-safety skill.
# Run from the open-sim repo root: .cursor/skills/dependency-safety/scripts/audit-deps.sh
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "error: not inside a git repository" >&2
  exit 1
}
cd "$ROOT"

if [[ ! -f package.json || ! -f package-lock.json ]]; then
  echo "error: package.json and package-lock.json are required" >&2
  exit 1
fi

echo "# Dependency audit data"
echo ""
echo "Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "Repo: $(basename "$ROOT")"
echo ""

echo "## Direct dependencies (package.json)"
node -e "
const pkg = require('./package.json');
const sections = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
for (const key of sections) {
  const deps = pkg[key];
  if (!deps || !Object.keys(deps).length) continue;
  console.log('### ' + key);
  for (const [name, range] of Object.entries(deps).sort()) {
    console.log('- ' + name + ' ' + range);
  }
  console.log('');
}
console.log('Node engine:', pkg.engines?.node ?? '(not specified)');
"

echo ""
echo "## Lockfile summary (package-lock.json)"
node -e "
const lock = require('./package-lock.json');
const entries = Object.entries(lock.packages || {}).filter(([k]) => k.startsWith('node_modules/'));
const direct = lock.packages[''] || {};
const byLicense = {};
const prod = [];
const dev = [];
const installScripts = [];
const badResolved = [];
const missingIntegrity = [];

for (const [path, meta] of entries) {
  const name = path.replace(/^node_modules\//, '').split('node_modules/').pop();
  const version = meta.version || '?';
  const license = meta.license || 'UNKNOWN';
  byLicense[license] = (byLicense[license] || 0) + 1;
  const row = name + '@' + version;
  if (meta.dev) dev.push(row); else prod.push(row);
  if (meta.hasInstallScript) installScripts.push(row);
  if (meta.resolved && !meta.resolved.startsWith('https://registry.npmjs.org/')) badResolved.push(row + ' -> ' + meta.resolved);
  if (meta.resolved && !meta.integrity) missingIntegrity.push(row);
}

console.log('- lockfileVersion:', lock.lockfileVersion);
console.log('- total locked packages:', entries.length);
console.log('- production transitive:', prod.length);
console.log('- dev transitive:', dev.length);
console.log('- direct prod deps:', Object.keys(direct.dependencies || {}).length);
console.log('- direct dev deps:', Object.keys(direct.devDependencies || {}).length);
console.log('');
console.log('### Licenses in lockfile');
for (const [lic, count] of Object.entries(byLicense).sort((a, b) => b[1] - a[1])) {
  console.log('- ' + lic + ': ' + count);
}
console.log('');
console.log('### Supply-chain signals');
console.log('- non-registry resolved URLs:', badResolved.length);
if (badResolved.length) badResolved.forEach((r) => console.log('  - ' + r));
console.log('- missing integrity hashes:', missingIntegrity.length);
if (missingIntegrity.length) missingIntegrity.forEach((r) => console.log('  - ' + r));
console.log('- packages with install scripts:', installScripts.length);
if (installScripts.length) installScripts.forEach((r) => console.log('  - ' + r));
"

echo ""
echo "## npm audit"
if ! command -v npm >/dev/null 2>&1; then
  echo "npm not found — skip audit"
else
  npm audit --json 2>/dev/null | node -e "
const report = JSON.parse(require('fs').readFileSync(0, 'utf8'));
const meta = report.metadata?.vulnerabilities || {};
console.log('- critical:', meta.critical ?? 0);
console.log('- high:', meta.high ?? 0);
console.log('- moderate:', meta.moderate ?? 0);
console.log('- low:', meta.low ?? 0);
console.log('- info:', meta.info ?? 0);
console.log('- total dependencies scanned:', report.metadata?.dependencies?.total ?? '?');
const vulns = report.vulnerabilities || {};
const names = Object.keys(vulns);
if (!names.length) {
  console.log('');
  console.log('No known vulnerabilities reported by npm audit.');
} else {
  console.log('');
  console.log('### Advisories');
  for (const name of names.sort()) {
    const v = vulns[name];
    const sev = v.severity || '?';
    const via = Array.isArray(v.via) ? v.via.map((x) => (typeof x === 'string' ? x : x.name)).filter(Boolean).join(', ') : '';
    console.log('- ' + name + ' (' + sev + ')' + (via ? ' via ' + via : ''));
    if (v.range) console.log('  range: ' + v.range);
    if (v.fixAvailable) console.log('  fixAvailable: ' + JSON.stringify(v.fixAvailable));
  }
}
" || echo "npm audit failed — run \`npm audit\` manually"
fi

echo ""
echo "## Lockfile drift (package.json vs lockfile)"
node -e "
const pkg = require('./package.json');
const lock = require('./package-lock.json');
const root = lock.packages[''] || {};
const sections = ['dependencies', 'devDependencies'];
let drift = 0;
for (const key of sections) {
  const declared = pkg[key] || {};
  const locked = root[key] || {};
  for (const name of new Set([...Object.keys(declared), ...Object.keys(locked)])) {
    if (declared[name] && !locked[name]) {
      console.log('- missing from lockfile:', name, declared[name]);
      drift++;
    } else if (!declared[name] && locked[name]) {
      console.log('- in lockfile but not package.json:', name, locked[name]);
      drift++;
    } else if (declared[name] !== locked[name]) {
      console.log('- range mismatch:', name, 'declared', declared[name], 'locked', locked[name]);
      drift++;
    }
  }
}
if (!drift) console.log('No drift detected between package.json ranges and lockfile root entry.');
"

echo ""
echo "## Key packages (web research targets)"
node -e "
const lock = require('./package-lock.json');
const watch = new Set([
  '@modelcontextprotocol/sdk', 'zod', 'typescript', '@types/node',
  'express', 'hono', '@hono/node-server', 'jose', 'ajv', 'qs',
  'body-parser', 'cookie', 'cross-spawn', 'eventsource', 'fast-uri',
  'path-to-regexp', 'ip-address', 'express-rate-limit', 'cors', 'raw-body',
]);
for (const [path, meta] of Object.entries(lock.packages || {})) {
  if (!path.startsWith('node_modules/')) continue;
  const name = path.replace(/^node_modules\\//, '').split('node_modules/').pop();
  if (!watch.has(name)) continue;
  console.log('- ' + name + '@' + (meta.version || '?'));
}
"

echo ""
echo "## Full locked package list"
node -e "
const lock = require('./package-lock.json');
const entries = Object.entries(lock.packages || {})
  .filter(([k]) => k.startsWith('node_modules/'))
  .map(([path, meta]) => {
    const name = path.replace(/^node_modules\//, '').split('node_modules/').pop();
    return { name, version: meta.version || '?', dev: !!meta.dev, license: meta.license || 'UNKNOWN' };
  })
  .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
for (const row of entries) {
  console.log('- ' + row.name + '@' + row.version + (row.dev ? ' (dev)' : '') + ' [' + row.license + ']');
}
"
