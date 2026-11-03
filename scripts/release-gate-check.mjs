import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { evaluatePrivacyPolicy, evaluateSteamAppIds } from './release-gate-policy.mjs';

const root = process.cwd();

const requiredFiles = [
    'scripts/theme-lifecycle-audit.mjs',
    'scripts/release-gate-check.mjs',
    'scripts/release-gate-policy.mjs',
    'scripts/palette-guideline-check.mjs',
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

// Steam AppID: no build ships a steam_appid.txt (always checked); a release build
// (SERENITY_RELEASE=1) also needs the game's own AppID in electron/steam-app-id.js.
const isReleaseBuild = process.env.SERENITY_RELEASE === '1';
const appIdPolicy = evaluateSteamAppIds({ root, isReleaseBuild });
for (const diagnostic of appIdPolicy.diagnostics) {
    if (diagnostic.level === 'error') console.error(`Release blocker: ${diagnostic.message}`);
    else console.warn(`⚠️  ${diagnostic.message}`);
}
failed ||= appIdPolicy.failed;

// The privacy page needs a contact before a store build.
const privacyPolicy = evaluatePrivacyPolicy({ root, isReleaseBuild });
for (const diagnostic of privacyPolicy.diagnostics) {
    if (diagnostic.level === 'error') console.error(`Release blocker: ${diagnostic.message}`);
    else console.warn(`⚠️  ${diagnostic.message}`);
}
failed ||= privacyPolicy.failed;

// Piece palettes stay clear of the familiar shape-to-hue roles (scripts/palette-guideline-check.mjs).
// Run here so CI (npm run check:release-gates) and every packaging run enforce it.
const paletteGate = spawnSync(process.execPath, [path.join(root, 'scripts', 'palette-guideline-check.mjs')], {
    cwd: root,
    env: process.env,
    encoding: 'utf8',
});
if (paletteGate.error || paletteGate.status !== 0) {
    process.stdout.write(paletteGate.stdout || '');
    process.stderr.write(paletteGate.stderr || '');
    console.error('Palette gate failed.', paletteGate.error || '');
    failed = true;
} else {
    console.log((paletteGate.stdout || '').trim().split(/\r?\n/).pop());
}

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
