#!/usr/bin/env node
/**
 * verify-manifest.js
 *
 * Compares a deployment manifest (deployment-manifest.json) against the
 * contract registry (registry.json) for a given network and reports drift.
 *
 * Three drift types are detected:
 *   MISSING  — registry has a non-empty address but the manifest has no entry
 *   MISMATCH — both have an entry for the alias but the addresses differ
 *   STALE    — manifest has an entry that has no corresponding registry alias,
 *              or the registry address is empty (manifest is out of date)
 *
 * Usage:
 *   node contracts/scripts/verify-manifest.js \
 *       --manifest contracts/scripts/deployment-manifest.json \
 *       --registry contracts/registry.json \
 *       --network testnet
 *
 * Options:
 *   --manifest  Path to deployment-manifest.json (required).
 *               If the file does not exist the script exits 0 (no deployment
 *               has been recorded yet — that is not an error in CI).
 *   --registry  Path to registry.json
 *               (default: contracts/registry.json relative to this script)
 *   --network   Network name: testnet | mainnet | local
 *               (default: taken from manifest.network)
 *
 * Exit codes:
 *   0 — manifest absent (skip) or all entries agree
 *   1 — one or more drift issues found
 */

"use strict";

const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// Name mapping: deploy name (in manifest) → registry alias (in registry.json)
// Mirrors the REGISTRY_KEY_MAP in deploy.sh.
// ---------------------------------------------------------------------------
const MANIFEST_TO_REGISTRY = {
  yield_vault: "vault",
  strategies: "strategy",
  optimistic_governance: "governance",
  emission_controller: "emissionController",
  liquid_staking: "liquidStaking",
};

// Inverted map: registry alias → manifest deploy name
const REGISTRY_TO_MANIFEST = Object.fromEntries(
  Object.entries(MANIFEST_TO_REGISTRY).map(([m, r]) => [r, m])
);

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i].startsWith("--") && i + 1 < argv.length) {
      args[argv[i].slice(2)] = argv[i + 1];
      i++;
    }
  }
  return args;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  const args = parseArgs(process.argv);

  if (!args.manifest) {
    console.error("ERROR: --manifest <path> is required.");
    process.exit(1);
  }

  const defaultRegistryPath = path.join(__dirname, "../registry.json");
  const registryPath = args.registry ?? defaultRegistryPath;

  // Graceful skip when manifest is absent (typical on branches without a deployment).
  if (!fs.existsSync(args.manifest)) {
    console.log("No deployment manifest found — skipping verification.");
    process.exit(0);
  }

  // Load manifest
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(args.manifest, "utf8"));
  } catch (err) {
    console.error(`ERROR: Failed to parse manifest at ${args.manifest}: ${err.message}`);
    process.exit(1);
  }

  if (!manifest.contracts || typeof manifest.contracts !== "object") {
    console.error("ERROR: manifest.contracts is missing or not an object.");
    process.exit(1);
  }

  const network = args.network ?? manifest.network;
  if (!network) {
    console.error("ERROR: --network is required (or manifest.network must be set).");
    process.exit(1);
  }

  // Load registry
  if (!fs.existsSync(registryPath)) {
    console.error(`ERROR: registry.json not found at ${registryPath}`);
    process.exit(1);
  }

  let registry;
  try {
    registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  } catch (err) {
    console.error(`ERROR: Failed to parse registry at ${registryPath}: ${err.message}`);
    process.exit(1);
  }

  const networkContracts = registry[network];
  if (!networkContracts || typeof networkContracts !== "object") {
    console.error(`ERROR: registry.json has no entry for network "${network}".`);
    process.exit(1);
  }

  console.log(`--- Verifying deployment manifest against registry [${network}] ---`);
  console.log(`  Manifest:  ${args.manifest}`);
  console.log(`  Registry:  ${registryPath}`);
  console.log();

  const issues = [];

  // 1. For each registry alias with a non-empty address, check the manifest.
  for (const [alias, registryAddr] of Object.entries(networkContracts)) {
    if (!registryAddr) continue; // empty registry entry — contract not yet deployed

    const manifestKey = REGISTRY_TO_MANIFEST[alias] ?? alias;
    const manifestAddr = manifest.contracts[manifestKey];

    if (!manifestAddr) {
      issues.push({
        type: "MISSING",
        label: alias,
        detail: `registry: ${registryAddr} | manifest: not found (looked for key "${manifestKey}")`,
      });
    } else if (manifestAddr !== registryAddr) {
      issues.push({
        type: "MISMATCH",
        label: alias,
        detail: `registry: ${registryAddr} | manifest: ${manifestAddr}`,
      });
    }
  }

  // 2. For each manifest entry, check the registry has a matching non-empty address.
  for (const [manifestKey, manifestAddr] of Object.entries(manifest.contracts)) {
    if (!manifestAddr) continue;

    const registryAlias = MANIFEST_TO_REGISTRY[manifestKey] ?? manifestKey;
    const registryAddr = networkContracts[registryAlias];

    if (!registryAddr) {
      // Only report STALE if we didn't already flag a MISMATCH for this alias above.
      const alreadyReported = issues.some(
        (i) => (i.type === "MISSING" || i.type === "MISMATCH") && i.label === registryAlias
      );
      if (!alreadyReported) {
        issues.push({
          type: "STALE",
          label: manifestKey,
          detail: `manifest: ${manifestAddr} | registry["${registryAlias}"]: ${registryAddr === undefined ? "not found" : "empty"}`,
        });
      }
    }
  }

  // Output
  if (issues.length === 0) {
    console.log("Result: PASSED — manifest and registry agree.");
    process.exit(0);
  }

  const WIDTH = 8; // pad type column
  for (const issue of issues) {
    console.log(`${issue.type.padEnd(WIDTH)} ${issue.label}`);
    console.log(`         (${issue.detail})`);
  }

  console.log();
  console.log(`Result: FAILED (${issues.length} issue(s))`);
  process.exit(1);
}

main();
