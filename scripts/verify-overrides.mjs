#!/usr/bin/env node
import { checkPolicy, readJson, repoRoot } from "./deps-lib.mjs";

const root = repoRoot();
const pkg = readJson(`${root}/package.json`);
const lock = readJson(`${root}/package-lock.json`);
const { errors, packages, expectedOverrides } = checkPolicy(lock, pkg);

const hard = errors.filter((e) => !e.startsWith("note:"));
const notes = errors.filter((e) => e.startsWith("note:"));

if (hard.length) {
  for (const e of hard) console.error(`verify-deps: ${e}`);
  process.exit(1);
}

console.log(
  `open-sim: ✓ all ${packages.length} lockfile packages covered (${Object.keys(expectedOverrides).length} overrides, official MCP SDK only)`,
);
for (const n of notes) {
  console.log(`open-sim: ℹ ${n.replace(/^note: /, "")}`);
}
