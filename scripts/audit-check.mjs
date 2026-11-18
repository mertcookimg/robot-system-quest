// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// `npm audit --audit-level=high` with a short, reviewed allowlist.
//
// npm audit cannot ignore a single advisory. When an advisory in build-only
// tooling has no patched release yet and does not affect this project, list
// it below with a reason and an expiry date. Every other high or critical
// advisory still fails. An allowlisted advisory fails again once its entry
// expires, or as soon as it reaches the production dependency tree.
//
// Usage: node scripts/audit-check.mjs

import { spawnSync } from "node:child_process";

const ALLOWLIST = [
  {
    id: "GHSA-fc5q-39xc-vjpf",
    package: "picomatch",
    reason:
      "ReDoS through attacker-controlled glob patterns. picomatch runs only inside Vite at " +
      "build and dev time with glob patterns written in this repository, and it is not part " +
      "of the published site. No patched release exists yet (affects <=4.0.7, the latest), " +
      "and `npm audit fix --force` would downgrade Vite 8 to 6.2.7.",
    expires: "2027-01-31",
  },
];

const FAILING = new Set(["high", "critical"]);
const today = new Date().toISOString().slice(0, 10);

/** High/critical advisories reported by `npm audit`, keyed by GHSA id. */
function highAdvisories(args) {
  // A fixed command string: the shell is needed to resolve npm on Windows.
  const result = spawnSync(`npm audit --json ${args}`, { encoding: "utf8", shell: true });
  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    console.error("npm audit did not return JSON.\n" + result.stdout + result.stderr);
    process.exit(1);
  }
  if (report.error) {
    console.error(`npm audit failed: ${report.error.summary ?? JSON.stringify(report.error)}`);
    process.exit(1);
  }
  const advisories = new Map();
  for (const vulnerability of Object.values(report.vulnerabilities ?? {})) {
    for (const via of vulnerability.via) {
      // String entries point at another vulnerable package; objects are advisories.
      if (typeof via !== "object" || !FAILING.has(via.severity)) continue;
      advisories.set(String(via.url).split("/").pop(), via);
    }
  }
  return advisories;
}

const advisories = highAdvisories("");
// The allowlist only covers build tooling: an advisory that also reaches the
// production dependency tree (what ships with the site) always fails.
const production = highAdvisories("--omit=dev");

let failed = false;
for (const [id, advisory] of advisories) {
  const allowed = ALLOWLIST.find((entry) => entry.id === id);
  const label = `${advisory.severity} ${advisory.name} ${advisory.range}: ${advisory.title} (${advisory.url})`;
  if (!allowed) {
    console.error(`FAIL ${label}`);
    failed = true;
  } else if (production.has(id)) {
    console.error(
      `FAIL ${label}\n     now reaches production dependencies; the allowlist no longer applies`,
    );
    failed = true;
  } else if (allowed.expires < today) {
    console.error(
      `FAIL ${label}\n     allowlist entry expired on ${allowed.expires}; review it again`,
    );
    failed = true;
  } else {
    console.warn(`ALLOW ${label}\n     until ${allowed.expires}: ${allowed.reason}`);
  }
}

for (const entry of ALLOWLIST) {
  if (!advisories.has(entry.id)) {
    console.warn(
      `NOTE ${entry.id} (${entry.package}) is no longer reported; remove it from the allowlist.`,
    );
  }
}

if (failed) process.exit(1);
console.log(`npm audit: no unreviewed high or critical advisories (${advisories.size} reported).`);
