import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

const requiredFiles = [
    'scripts/theme-lifecycle-audit.mjs',
    'scripts/release-gate-check.mjs',
    'src/utils/performance-monitor.js',
    'src/themes/theme-manager.js',
    'src/main.js',
];

const sourceChecks = [
    {
        file: 'src/utils/performance-monitor.js',
        patterns: ['getReleaseGateSnapshot', 'recordThemeSwitch', 'recordEvent'],
    },
    {
        file: 'src/main.js',
        patterns: ['setupObservabilityHooks', 'runThemeSwitchSoak', 'vite:preloadError'],
    },
    {
        file: 'src/themes/theme-manager.js',
        patterns: ['performanceMonitor.recordThemeSwitch', 'getAvailableThemes'],
    },
];

let failed = false;

for (const relativePath of requiredFiles) {
    const fullPath = path.join(root, relativePath);
    if (!fs.existsSync(fullPath)) {
        console.error(`Missing required file: ${relativePath}`);
        failed = true;
    }
}

for (const check of sourceChecks) {
    const fullPath = path.join(root, check.file);
    if (!fs.existsSync(fullPath)) {
        failed = true;
        continue;
    }

    const source = fs.readFileSync(fullPath, 'utf8');
    for (const pattern of check.patterns) {
        if (!source.includes(pattern)) {
            console.error(`Missing pattern "${pattern}" in ${check.file}`);
            failed = true;
        }
    }
}

// ---------------------------------------------------------------------------
// Release blocker: steam_appid.txt must not be Valve's Spacewar placeholder.
// ---------------------------------------------------------------------------
// Shipping with AppID 480 initializes Steamworks against the wrong app, breaking
// leaderboards, P2P matchmaking, achievements, and cloud saves. 480 is expected
// during development, so this only HARD-FAILS the gate for a release build
// (SERENITY_RELEASE=1); otherwise it prints a prominent warning.
const isReleaseBuild = process.env.SERENITY_RELEASE === '1';
const PLACEHOLDER_APPID = '480';
const appIdFiles = ['steam_appid.txt', 'electron/steam_appid.txt'];

for (const relativePath of appIdFiles) {
    const fullPath = path.join(root, relativePath);
    if (!fs.existsSync(fullPath)) continue;

    const appId = fs.readFileSync(fullPath, 'utf8').trim();
    if (appId === PLACEHOLDER_APPID) {
        const message = `${relativePath} is still the Spacewar placeholder AppID (480) — set the real Steam AppID before release.`;
        if (isReleaseBuild) {
            console.error(`Release blocker: ${message}`);
            failed = true;
        } else {
            console.warn(`⚠️  ${message}`);
        }
    }
}

if (failed) {
    process.exitCode = 1;
} else {
    console.log('Release gate scaffolding checks passed.');
}
