#!/usr/bin/env node
/** Sync package.json overrides to exact versions for every package in package-lock.json */
import { buildOverridesFromLockfile, readJson, repoRoot, resolvePinVersions, listLockedPackages, writeJson } from "./deps-lib.mjs";

const root = repoRoot();
const pkgPath = `${root}/package.json`;
const lockPath = `${root}/package-lock.json`;
const pkg = readJson(pkgPath);
const lock = readJson(lockPath);

const overrides = buildOverridesFromLockfile(lock);
pkg.overrides = overrides;
writeJson(pkgPath, pkg);

const packages = listLockedPackages(lock);
const pins = resolvePinVersions(packages);
let conflicts = 0;
for (const [, { versions }] of pins) {
  if (versions.size > 1) conflicts++;
}

console.log(`sync-overrides: wrote ${Object.keys(overrides).length} exact overrides to package.json`);
if (conflicts) {
  console.log(`sync-overrides: ${conflicts} package(s) had multiple lockfile versions; pinned highest semver`);
}
console.log("sync-overrides: run npm install && npm run deps:verify");
