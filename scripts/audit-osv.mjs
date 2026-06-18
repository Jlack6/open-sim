#!/usr/bin/env node
/**
 * Query OSV for every unique name@version in package-lock.json.
 * Usage: node scripts/audit-osv.mjs [--fail-on=high] [--json]
 */
import {
  checkPolicy,
  listLockedPackages,
  maxSeverity,
  queryOsvBatch,
  readJson,
  repoRoot,
  uniqueNameVersions,
} from "./deps-lib.mjs";

const args = process.argv.slice(2);
const failOn = (args.find((a) => a.startsWith("--fail-on="))?.split("=")[1] ?? "high").toUpperCase();
const jsonOut = args.includes("--json");
const failRank = { CRITICAL: 4, HIGH: 3, MODERATE: 2, MEDIUM: 2, LOW: 1, UNKNOWN: 0 }[failOn] ?? 3;

const root = repoRoot();
const lock = readJson(`${root}/package-lock.json`);
const pkg = readJson(`${root}/package.json`);
const pairs = uniqueNameVersions(listLockedPackages(lock));

const results = await queryOsvBatch(pairs);

/** @type {{ package: string, version: string, severity: string, vulns: { id: string, summary: string }[] }[]} */
const findings = [];

for (let i = 0; i < pairs.length; i++) {
  const { name, version } = pairs[i];
  const vulns = results[i]?.vulns ?? [];
  if (!vulns.length) continue;
  const severity = maxSeverity(vulns);
  findings.push({
    package: name,
    version,
    severity,
    vulns: vulns.map((v) => ({
      id: v.id ?? "?",
      summary: (v.summary ?? "").slice(0, 200),
    })),
  });
}

const policy = checkPolicy(lock, pkg);
const policyErrors = policy.errors.filter((e) => !e.startsWith("note:"));
const policyNotes = policy.errors.filter((e) => e.startsWith("note:"));

const report = {
  generated: new Date().toISOString(),
  packagesScanned: pairs.length,
  osvFindings: findings.length,
  findings,
  policyErrors,
  policyNotes,
};

if (jsonOut) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log("# OSV advisory scan (all lockfile packages)");
  console.log(`Generated: ${report.generated}`);
  console.log(`Packages scanned: ${report.packagesScanned}`);
  console.log(`Advisories found: ${report.osvFindings}`);
  console.log("");
  if (!findings.length) {
    console.log("No OSV advisories for locked versions.");
  } else {
    console.log("## Findings");
    for (const f of findings) {
      console.log(`- ${f.package}@${f.version} (${f.severity})`);
      for (const v of f.vulns) {
        console.log(`  - ${v.id}: ${v.summary}`);
      }
    }
  }
  if (policyNotes.length) {
    console.log("");
    console.log("## Lockfile notes");
    for (const n of policyNotes) console.log(`- ${n.replace(/^note: /, "")}`);
  }
}

const worst = findings.reduce((w, f) => {
  const r = { CRITICAL: 4, HIGH: 3, MODERATE: 2, MEDIUM: 2, LOW: 1, UNKNOWN: 0 }[f.severity] ?? 0;
  return Math.max(w, r);
}, 0);

if (worst >= failRank) {
  console.error(`audit-osv: failing (--fail-on=${failOn.toLowerCase()})`);
  process.exit(1);
}

if (policyErrors.length && !jsonOut) {
  console.error("audit-osv: policy errors (run npm run deps:verify):");
  for (const e of policyErrors) console.error(`  - ${e}`);
}

process.exit(0);
