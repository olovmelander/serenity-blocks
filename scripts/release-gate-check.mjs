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

if (failed) {
    process.exitCode = 1;
} else {
    console.log('Release gate scaffolding checks passed.');
}
