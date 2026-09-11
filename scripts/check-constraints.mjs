#!/usr/bin/env node
/**
 * Enforces the standing constraints AGENTS.md documents but that nothing else
 * can catch: they are all policy about dependencies and output size, so the
 * compiler and the tests are both blind to them.
 *
 * Run after `node bundle.mjs`. Usable locally, not just in CI.
 */
import {readFileSync, statSync} from 'node:fs';
import * as path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(
  readFileSync(path.join(root, 'package.json'), 'utf8'),
);

/**
 * Headroom over the current bundle, not a target. The point is to catch a
 * step change — openai v7 alone would take this to ~300KB — not to police
 * ordinary drift.
 */
const BUNDLE_BUDGET_BYTES = 170_000;

const failures = [];

function checkBundleSize() {
  const bundle = path.join(root, 'out', 'extension.js');
  let size;
  try {
    size = statSync(bundle).size;
  } catch {
    failures.push(
      `out/extension.js is missing — run \`node bundle.mjs\` before this check.`,
    );
    return;
  }

  const percent = ((size / BUNDLE_BUDGET_BYTES) * 100).toFixed(0);
  if (size > BUNDLE_BUDGET_BYTES) {
    failures.push(
      `Bundle is ${size.toLocaleString()} B, over the ${BUNDLE_BUDGET_BYTES.toLocaleString()} B budget.\n` +
        `    A dependency probably grew. See AGENTS.md ("openai is pinned exactly")\n` +
        `    before raising the budget — the pin exists because the SDK imports its\n` +
        `    resource namespaces eagerly and esbuild cannot tree-shake them.`,
    );
    return;
  }
  console.log(
    `bundle        ${size.toLocaleString()} B (${percent}% of budget)`,
  );
}

function checkTypesMatchEngineFloor() {
  const engine = pkg.engines?.vscode ?? '';
  const types = pkg.devDependencies?.['@types/vscode'] ?? '';
  const floor = engine.replace(/^[^0-9]*/, '');

  if (!floor || !types) {
    failures.push('Could not read engines.vscode or @types/vscode.');
    return;
  }
  if (types !== floor) {
    failures.push(
      `@types/vscode (${types}) does not match the engines.vscode floor (${floor}).\n` +
        `    Compiling against newer typings than the declared minimum lets code\n` +
        `    reference API that users on the floor do not have. Raise both together.`,
    );
    return;
  }
  console.log(`@types/vscode ${types} matches engines.vscode floor`);
}

function checkOpenAiPinned() {
  const spec = pkg.dependencies?.openai ?? '';
  if (!/^\d+\.\d+\.\d+$/.test(spec)) {
    failures.push(
      `openai is "${spec}" — it must be an exact version, no range.\n` +
        `    A range resolves past the pin on any install without the lockfile,\n` +
        `    shipping a bundle nobody measured. See AGENTS.md.`,
    );
    return;
  }
  console.log(`openai        pinned at ${spec}`);
}

checkBundleSize();
checkTypesMatchEngineFloor();
checkOpenAiPinned();

if (failures.length > 0) {
  console.error(`\n${failures.length} constraint check(s) failed:\n`);
  for (const failure of failures) {
    console.error(`  - ${failure}\n`);
  }
  process.exit(1);
}

console.log('\nAll constraint checks passed.');
