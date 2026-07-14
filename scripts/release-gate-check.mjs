import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { evaluateSteamAppIds } from './release-gate-policy.mjs';

const root = process.cwd();

const requiredFiles = [
    'scripts/theme-lifecycle-audit.mjs',
    'scripts/release-gate-check.mjs',
    'scripts/release-gate-policy.mjs',
    'src/utils/performance-monitor.js',
    'src/utils/release-observability.js',
    'src/themes/theme-manager.js',
    'src/main.js',
    'tests/unit/release-gate.test.js',
];

let failed = false;

for (const relativePath of requiredFiles) {
    const fullPath = path.join(root, relativePath);
    if (!fs.existsSync(fullPath)) {
        console.error(`Missing required file: ${relativePath}`);
        failed = true;
    }
}

// Release blocker: steam_appid.txt must not be Valve's Spacewar placeholder.
// AppID 480 is allowed with a warning during development and blocks releases.
const isReleaseBuild = process.env.SERENITY_RELEASE === '1';
const appIdPolicy = evaluateSteamAppIds({ root, isReleaseBuild });
for (const diagnostic of appIdPolicy.diagnostics) {
    if (diagnostic.level === 'error') console.error(`Release blocker: ${diagnostic.message}`);
    else console.warn(`⚠️  ${diagnostic.message}`);
}
failed ||= appIdPolicy.failed;

// The old gate only grepped source text. Run the focused behavioral suite in
// every non-blocked invocation, including build-win.mjs's packaging path.
if (!failed) {
    const vitestEntry = path.join(root, 'node_modules', 'vitest', 'vitest.mjs');
    const behavioralGate = spawnSync(process.execPath, [
        vitestEntry,
        'run',
        'tests/unit/release-gate.test.js',
    ], {
        cwd: root,
        env: process.env,
        stdio: 'inherit',
    });

    if (behavioralGate.error || behavioralGate.status !== 0) {
        console.error('Behavioral release gate failed.', behavioralGate.error || 'Vitest returned non-zero.');
        failed = true;
    }
}

if (failed) {
    process.exitCode = 1;
} else {
    console.log('Release gate checks passed.');
}
