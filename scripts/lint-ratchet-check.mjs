#!/usr/bin/env node
/**
 * Lint error-count ratchet (ARCHITECTURAL_REMEDIATION_PLAN.md Phase 0.3).
 *
 * The soft `continue-on-error` lint step let every new violation land silently.
 * This check is HARD in CI from day one: it fails when the ESLint *error* count
 * exceeds the committed baseline in lint-ratchet.json, so the count can only
 * shrink. Warnings are reported but not gated (ADR-0002).
 *
 * Usage:
 *   node scripts/lint-ratchet-check.mjs            # gate (CI)
 *   node scripts/lint-ratchet-check.mjs --update   # lower the baseline after a burn-down
 *
 * When the count reaches 0, replace this ratchet with a plain `npm run lint`
 * hard gate and delete the baseline file.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ESLint } from 'eslint';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = path.join(repoRoot, 'lint-ratchet.json');
const update = process.argv.includes('--update');

const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));

const eslint = new ESLint({ cwd: repoRoot, extensions: ['.js'] });
const results = await eslint.lintFiles(['src']);

let errors = 0;
let warnings = 0;
let fatal = 0;
for (const r of results) {
    errors += r.errorCount;
    warnings += r.warningCount;
    fatal += r.fatalErrorCount;
}

console.log(`lint-ratchet: ${errors} errors (baseline ${baseline.maxErrors}), ${warnings} warnings, ${fatal} fatal`);

if (fatal > 0) {
    const formatter = await eslint.loadFormatter('stylish');
    console.error(formatter.format(results.filter((r) => r.fatalErrorCount > 0)));
    console.error(`lint-ratchet: FAIL — ${fatal} fatal (parse) error(s); these are never allowed.`);
    process.exitCode = 1;
} else if (errors > baseline.maxErrors) {
    const formatter = await eslint.loadFormatter('stylish');
    console.error(formatter.format(results.filter((r) => r.errorCount > 0)));
    console.error(
        `lint-ratchet: FAIL — ${errors} errors > baseline ${baseline.maxErrors}. `
        + 'Fix the new violations (do not raise the baseline).',
    );
    process.exitCode = 1;
} else if (update && errors < baseline.maxErrors) {
    writeFileSync(baselinePath, `${JSON.stringify({ ...baseline, maxErrors: errors }, null, 2)}\n`);
    console.log(`lint-ratchet: baseline lowered ${baseline.maxErrors} -> ${errors}. Commit lint-ratchet.json.`);
} else if (errors < baseline.maxErrors) {
    console.warn(
        `lint-ratchet: count shrank (${errors} < ${baseline.maxErrors}) — run `
        + '`node scripts/lint-ratchet-check.mjs --update` and commit the lower baseline '
        + 'so the improvement is locked in.',
    );
} else {
    console.log('lint-ratchet: OK (at baseline).');
}
