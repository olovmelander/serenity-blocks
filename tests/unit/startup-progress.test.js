/**
 * The loading screen's progress line follows the boot's real milestones (src/ui/startup-progress.js).
 */
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { markStartup } from '../../src/ui/startup-debug.js';
import {
    STARTUP_PROGRESS_STEPS,
    installStartupProgress,
    resetStartupProgressForTests,
    setStartupProgress,
} from '../../src/ui/startup-progress.js';

function fakeShell() {
    const props = {};
    const classes = new Set();
    return {
        props,
        classes,
        style: { setProperty: (k, v) => { props[k] = v; } },
        classList: { add: (c) => classes.add(c) },
    };
}

describe('the loading screen\'s progress line', () => {
    let shell;
    beforeEach(() => {
        shell = fakeShell();
        vi.stubGlobal('document', { getElementById: (id) => (id === 'startup-shell' ? shell : null) });
        resetStartupProgressForTests();
    });
    afterEach(() => {
        resetStartupProgressForTests();
        vi.unstubAllGlobals();
    });

    it('moves forward only', () => {
        expect(setStartupProgress(0.4)).toBe(0.4);
        expect(setStartupProgress(0.2)).toBe(0.4);
        expect(shell.props['--sb-progress']).toBe('0.400');
        expect(setStartupProgress(0.7)).toBe(0.7);
        expect(shell.props['--sb-progress']).toBe('0.700');
    });

    it('follows the startup trace once installed, and says when it is full', () => {
        installStartupProgress();
        installStartupProgress(); // idempotent
        markStartup('startup-pipeline:app-ready');
        const appReady = STARTUP_PROGRESS_STEPS['startup-pipeline:app-ready'];
        expect(Number(shell.props['--sb-progress'])).toBeCloseTo(appReady, 3);
        markStartup('something-else');
        markStartup('theme-warm:started');
        expect(Number(shell.props['--sb-progress'])).toBeCloseTo(STARTUP_PROGRESS_STEPS['theme-warm:started'], 3);
        expect(shell.classes.has('is-ready')).toBe(false);
        markStartup('boot-warp:visible-start');
        expect(shell.props['--sb-progress']).toBe('1.000');
        expect(shell.classes.has('is-ready')).toBe(true);
    });

    it('orders its milestones as the boot runs them', () => {
        const order = [
            'startup-pipeline:boot-started', 'startup-pipeline:app-ready', 'theme-warm:start',
            'theme-warm:started', 'theme-warm:end', 'intro:show-start', 'boot-warp:theme-ready',
            'boot-warp:committed', 'boot-warp:visible-start',
        ];
        for (let i = 1; i < order.length; i++) {
            expect(STARTUP_PROGRESS_STEPS[order[i]]).toBeGreaterThan(STARTUP_PROGRESS_STEPS[order[i - 1]]);
        }
    });
});
