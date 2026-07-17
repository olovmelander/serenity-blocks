// Theme lifecycle audit — static guardrail for the theme dispose contract.
//
// Contract being enforced (see PERFORMANCE_STABILITY_AUDIT.md SB-04 and the
// 2026-07-17 remediation log): ThemeManager.disposeThemeInstance() calls
// cleanup(), and BaseTheme.cleanup() -> releaseInactiveResources() -> stop()
// (base-theme.js), so a theme's stop() override IS invoked at terminal
// disposal. The escape hatches this script guards against are therefore:
//
//   1. cleanup() overrides that skip super.cleanup()  — lose the base terminal
//      teardown (containers, standard scene/composer disposal, resilience
//      unsubs).
//   2. stop() overrides that skip super.stop()        — lose the base safety
//      nets (cancelAnimationFrames, clearTrackedResources).
//   3. add/removeEventListener with .bind(this) inline — bind() creates a new
//      function identity each call, so the removal can never match.
//   4. window 'resize' listeners with no visible removal path — neither a
//      matching removeEventListener, nor an eventUnsubscribers-tracked
//      removal, nor BaseTheme.registerEventListener.
//
// The pre-2026-07-17 heuristic "has stop() but no cleanup() override" dated
// from before the cleanup->stop chain existed and flagged 22 themes that are
// correct under the current architecture (all call super.stop(); runtime
// theme-cycle measurements in reports/perf-audit-2026-07-16/ confirmed the
// flagged set did not correlate with real leaks). It was replaced by check 2.

import fs from 'node:fs';
import path from 'node:path';

function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...walk(fullPath));
        } else if (entry.isFile() && entry.name.endsWith('-theme.js')) {
            files.push(fullPath);
        }
    }

    return files;
}

/**
 * Analyze one theme source for lifecycle-contract violations.
 * Exported for unit tests (tests/unit/theme-lifecycle-audit.test.js).
 *
 * @param {string} source - JS source of a theme file
 * @returns {string[]} human-readable issue strings (empty = clean)
 */
export function analyzeThemeSource(source) {
    const issues = [];
    const isBaseTheme = /class\s+BaseTheme/.test(source);
    if (isBaseTheme) return issues;

    const hasCleanup = /\bcleanup\s*\(\s*\)\s*\{/.test(source);
    const callsSuperCleanup = /super\.cleanup\s*\(/.test(source);
    if (hasCleanup && !callsSuperCleanup) {
        issues.push('cleanup() without super.cleanup()');
    }

    // stop() overrides must chain to super.stop() so the base safety nets
    // (cancelAnimationFrames, clearTrackedResources) always run.
    const hasStop = /\bstop\s*\(\s*\)\s*\{/.test(source);
    const callsSuperStop = /super\.stop\s*\(/.test(source);
    if (hasStop && !callsSuperStop) {
        issues.push('stop() without super.stop()');
    }

    if (/window\.addEventListener\([^\n]*\.bind\(this\)/.test(source)) {
        issues.push('window.addEventListener with bind(this)');
    }

    if (/window\.removeEventListener\([^\n]*\.bind\(this\)/.test(source)) {
        issues.push('window.removeEventListener with bind(this)');
    }

    // A raw window resize listener needs a visible removal path: an explicit
    // removeEventListener('resize'), an eventUnsubscribers-tracked removal,
    // or registration through BaseTheme.registerEventListener.
    const rawResizeAdds = (source.match(/window\.addEventListener\(\s*'resize'/g) || []).length;
    if (rawResizeAdds > 0) {
        const rawResizeRemoves = (source.match(/window\.removeEventListener\(\s*'resize'/g) || []).length;
        const trackedResize = /registerEventListener\([^\n]*'resize'/.test(source);
        if (rawResizeRemoves === 0 && !trackedResize) {
            issues.push('window resize listener without a removal path');
        }
    }

    return issues;
}

function toRelative(filePath) {
    return path.relative(process.cwd(), filePath).replaceAll('\\', '/');
}

function main() {
    const rootDir = path.resolve(process.cwd(), 'src', 'themes');
    const files = walk(rootDir);
    const report = files
        .map((filePath) => ({
            relativePath: toRelative(filePath),
            issues: analyzeThemeSource(fs.readFileSync(filePath, 'utf8')),
        }))
        .filter((entry) => entry.issues.length > 0);

    if (report.length === 0) {
        console.log('Theme lifecycle audit passed with no obvious issues.');
        process.exit(0);
    }

    console.log('Theme lifecycle audit found potential issues:\n');
    report.forEach((entry) => {
        console.log(`${entry.relativePath}`);
        entry.issues.forEach((issue) => {
            console.log(`  - ${issue}`);
        });
        console.log('');
    });

    process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
    main();
}
