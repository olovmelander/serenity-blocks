#!/usr/bin/env node
/**
 * TypeScript-coverage ratchet (ARCHITECTURAL_REMEDIATION_PLAN.md Phase 3a).
 *
 * The typecheck is opt-in (checkJs:false; only files carrying `// @ts-check`
 * are checked — see tsconfig.json), which means coverage can silently REGRESS:
 * deleting a pragma removes the file from the gate with no signal. This check
 * is HARD in CI: every file listed in ts-ratchet.json must still carry its
 * pragma. Coverage growth is locked in with --update.
 *
 * Usage:
 *   node scripts/ts-ratchet-check.mjs            # gate (CI)
 *   node scripts/ts-ratchet-check.mjs --update   # adopt newly-pragma'd files
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = path.join(repoRoot, 'ts-ratchet.json');
const update = process.argv.includes('--update');

const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));

// Enumerate pragma'd files via git (tracked files only, cross-platform).
const tracked = execFileSync('git', ['ls-files', 'src/**/*.js'], { cwd: repoRoot, encoding: 'utf8' })
    .split('\n').filter(Boolean);
const pragmad = tracked.filter((file) => {
    const head = readFileSync(path.join(repoRoot, file), 'utf8').slice(0, 200);
    return /^\s*\/\/ @ts-check/m.test(head);
}).map((file) => file.replace(/\\/g, '/')).sort();

const lost = baseline.checkedFiles.filter((f) => !pragmad.includes(f));
const gained = pragmad.filter((f) => !baseline.checkedFiles.includes(f));

console.log(`ts-ratchet: ${pragmad.length} pragma'd files (baseline ${baseline.checkedFiles.length})`);

if (lost.length > 0) {
    console.error('ts-ratchet: FAIL — these files lost their // @ts-check pragma (coverage only ratchets forward):');
    for (const f of lost) console.error(`  - ${f}`);
    process.exitCode = 1;
} else if (update && gained.length > 0) {
    writeFileSync(baselinePath, `${JSON.stringify({ ...baseline, checkedFiles: pragmad }, null, 2)}\n`);
    console.log(`ts-ratchet: baseline grown by ${gained.length} file(s). Commit ts-ratchet.json.`);
} else if (gained.length > 0) {
    console.warn(`ts-ratchet: ${gained.length} newly-pragma'd file(s) not in the baseline — run `
        + '`node scripts/ts-ratchet-check.mjs --update` and commit so the coverage is locked in:');
    for (const f of gained) console.warn(`  + ${f}`);
} else {
    console.log('ts-ratchet: OK (at baseline).');
}
