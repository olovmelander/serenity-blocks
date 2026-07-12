/**
 * Behavioral release gates (remediation plan Phase 3b).
 *
 * These assertions replace the old source-substring checks. They prove the
 * observability snapshot aggregates real samples and that ThemeManager records
 * successful lifecycle transitions while activating two themes through its
 * production activation path.
 */
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import {
    mkdtempSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eventBus, EVENTS } from '../../src/events/event-bus.js';
import { ThemeManager } from '../../src/themes/theme-manager.js';
import { PerformanceMonitor, performanceMonitor } from '../../src/utils/performance-monitor.js';
import {
    createRuntimeValidation,
    installPreloadErrorRecovery,
} from '../../src/utils/release-observability.js';
import { evaluateSteamAppIds } from '../../scripts/release-gate-policy.mjs';

const temporaryGateRoots = [];

class ReleaseGateThemeManager extends ThemeManager {
    initializeRegistry() {}
}

function installFakeDom() {
    const created = [];
    const body = {
        firstChild: null,
        children: [],
        insertBefore(node) {
            this.children.unshift(node);
            this.firstChild = this.children[0];
        },
        appendChild(node) {
            this.children.push(node);
            this.firstChild = this.children[0];
        },
    };

    vi.stubGlobal('document', {
        body,
        getElementById: (id) => created.find((node) => node.id === id) || null,
        createElement: (tagName) => {
            const node = {
                tagName,
                id: '',
                className: '',
                style: {},
            };
            created.push(node);
            return node;
        },
    });

    return created;
}

function createFakeTheme(name, lifecycle) {
    const theme = {
        name,
        isActive: false,
        hasStarted: false,
        start: vi.fn(async () => {
            lifecycle.push(`start:${name}`);
            theme.isActive = true;
            theme.hasStarted = true;
        }),
        cleanup: vi.fn(() => {
            lifecycle.push(`cleanup:${name}`);
            theme.isActive = false;
        }),
    };
    return theme;
}

function createGateWorkspace(appId) {
    const root = mkdtempSync(join(tmpdir(), 'serenity-release-gate-'));
    temporaryGateRoots.push(root);
    writeFileSync(join(root, 'steam_appid.txt'), `${appId}\n`, 'utf8');

    return root;
}

describe('behavioral release gates', () => {
    afterEach(() => {
        while (temporaryGateRoots.length > 0) {
            rmSync(temporaryGateRoots.pop(), { recursive: true, force: true });
        }
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('warns for a dev placeholder, blocks it in release, and accepts a real AppID', () => {
        const root = createGateWorkspace('480');

        const devResult = evaluateSteamAppIds({ root });
        expect(devResult.failed).toBe(false);
        expect(devResult.diagnostics).toEqual([
            expect.objectContaining({ level: 'warning', message: expect.stringContaining('Spacewar placeholder') }),
        ]);

        const blockedRelease = evaluateSteamAppIds({ root, isReleaseBuild: true });
        expect(blockedRelease.failed).toBe(true);
        expect(blockedRelease.diagnostics[0]).toMatchObject({ level: 'error' });

        writeFileSync(join(root, 'steam_appid.txt'), '123456\n', 'utf8');
        expect(evaluateSteamAppIds({ root, isReleaseBuild: true })).toEqual({
            diagnostics: [],
            failed: false,
        });
    });

    it('recovers once from preload errors and removes the listener on cleanup', () => {
        const listeners = new Map();
        const reload = vi.fn();
        const windowRef = {
            location: { reload },
            addEventListener: vi.fn((name, handler) => listeners.set(name, handler)),
            removeEventListener: vi.fn((name, handler) => {
                if (listeners.get(name) === handler) listeners.delete(name);
            }),
        };
        const logError = vi.fn();
        const preventDefault = vi.fn();
        const cleanup = installPreloadErrorRecovery({ windowRef, logError });

        listeners.get('vite:preloadError')({ preventDefault });
        listeners.get('vite:preloadError')({ preventDefault });

        expect(preventDefault).toHaveBeenCalledTimes(2);
        expect(reload).toHaveBeenCalledTimes(1);
        expect(logError).toHaveBeenCalledTimes(2);

        cleanup();
        expect(listeners.has('vite:preloadError')).toBe(false);
    });

    it('runs the theme soak over available themes and returns release-gate evidence', async () => {
        const themeManager = {
            getAvailableThemes: vi.fn(() => ['ocean', 'winter']),
            switchTheme: vi.fn(async () => {}),
        };
        const snapshot = { frameTime: { p95: 16 } };
        const monitor = { getReleaseGateSnapshot: vi.fn(() => snapshot) };
        const wait = vi.fn(async () => {});
        const storeDesktopBenchmark = vi.fn(async () => ({ stored: true }));
        const times = [100, 175];
        const validation = createRuntimeValidation({
            themeManager,
            performanceMonitor: monitor,
            storeDesktopBenchmark,
            now: () => times.shift(),
            wait,
        });

        const result = await validation.runThemeSwitchSoak({ iterations: 3, delayMs: 4 });

        expect(themeManager.getAvailableThemes).toHaveBeenCalledOnce();
        expect(themeManager.switchTheme.mock.calls.map(([themeName]) => themeName)).toEqual([
            'ocean', 'winter', 'ocean',
        ]);
        expect(wait).toHaveBeenCalledTimes(3);
        expect(wait).toHaveBeenCalledWith(4);
        expect(result).toEqual({ iterations: 3, elapsedMs: 75, releaseGates: snapshot });
        expect(validation.getReleaseGates()).toBe(snapshot);

        await expect(validation.captureDesktopBenchmark('  release-smoke  ', { build: 'abc' })).resolves.toEqual({
            stage: 'release-smoke',
            report: { stored: true },
            releaseGates: snapshot,
        });
        expect(storeDesktopBenchmark).toHaveBeenCalledWith('release-smoke', { build: 'abc' });
    });

    it('builds the release snapshot from recorded samples and runtime events', () => {
        const monitor = new PerformanceMonitor();
        monitor.frameTimes = [8, 16, 24, 32];
        monitor.fpsHistory = [30, 60, 90, 120];
        monitor.metrics.memoryUsed = 128;
        monitor.metrics.contextRestoreCount = 2;
        monitor.memoryHistory = [96, 144, 120];
        monitor.recordThemeSwitch({
            fromTheme: 'forest',
            toTheme: 'ocean',
            durationMs: 37,
        });
        monitor.recordEvent('diagnostic', { status: 'ready' });
        monitor.setNetworkStats({ snapshotBytesP95: 74, reliableMsgsPerSec: 3 });

        expect(monitor.getReleaseGateSnapshot()).toEqual({
            frameTime: { p50: 24, p95: 32, p99: 32 },
            fps: { p50: 90, p05: 30 },
            memory: { currentMb: 128, peakMb: 144 },
            themeSwitches: { count: 1, maxDurationMs: 37 },
            runtime: {
                contextRestoreCount: 2,
                recentEvents: [
                    {
                        type: 'theme_switch',
                        timestamp: expect.any(Number),
                        payload: {
                            fromTheme: 'forest',
                            toTheme: 'ocean',
                            durationMs: 37,
                        },
                    },
                    {
                        type: 'diagnostic',
                        timestamp: expect.any(Number),
                        payload: { status: 'ready' },
                    },
                ],
            },
            network: { snapshotBytesP95: 74, reliableMsgsPerSec: 3 },
        });
    });

    it('activates two themes and records both completed switches', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const containers = installFakeDom();
        const lifecycle = [];
        const renderer = {
            clearThemeResources: vi.fn(() => lifecycle.push('clear-renderer')),
        };
        const assetManager = {};
        const manager = new ReleaseGateThemeManager(renderer, {
            assetManager,
            audioManager: null,
        });
        expect(manager.getAvailableThemes()).toEqual(expect.arrayContaining(['ocean', 'winter']));
        const themes = new Map([
            ['ocean', createFakeTheme('ocean', lifecycle)],
            ['winter', createFakeTheme('winter', lifecycle)],
        ]);
        const changedThemes = [];
        const unsubscribe = eventBus.on(EVENTS.THEME_CHANGED, ({ themeName }) => {
            changedThemes.push(themeName);
        });
        const recordThemeSwitch = vi.spyOn(performanceMonitor, 'recordThemeSwitch')
            .mockImplementation(() => {});

        manager.themesSuspended = false;
        manager.queueAdjacentThemePreload = vi.fn();
        manager.loadTheme = vi.fn(async (themeName) => {
            lifecycle.push(`load:${themeName}`);
            const theme = themes.get(themeName);
            manager.themeInstances.set(themeName, theme);
            return theme;
        });

        try {
            await manager.switchTheme('ocean');
            await manager.switchTheme('winter');
        } finally {
            unsubscribe();
        }

        expect(lifecycle).toEqual([
            'load:ocean',
            'start:ocean',
            'cleanup:ocean',
            'clear-renderer',
            'load:winter',
            'start:winter',
        ]);
        expect(changedThemes).toEqual(['ocean', 'winter']);
        expect(containers.map(({ id }) => id)).toEqual(['ocean-theme', 'winter-theme']);
        expect(themes.get('ocean').start).toHaveBeenCalledWith(renderer, {
            assetManager,
            audioManager: null,
        });
        expect(themes.get('winter').start).toHaveBeenCalledWith(renderer, {
            assetManager,
            audioManager: null,
        });
        expect(themes.get('ocean').cleanup).toHaveBeenCalledTimes(1);
        expect(manager.activeTheme).toBe(themes.get('winter'));
        expect(manager.activeThemeName).toBe('winter');
        expect(recordThemeSwitch).toHaveBeenCalledTimes(2);
        expect(recordThemeSwitch).toHaveBeenNthCalledWith(1, {
            fromTheme: 'forest',
            toTheme: 'ocean',
            durationMs: expect.any(Number),
        });
        expect(recordThemeSwitch).toHaveBeenNthCalledWith(2, {
            fromTheme: 'ocean',
            toTheme: 'winter',
            durationMs: expect.any(Number),
        });
        for (const [{ durationMs }] of recordThemeSwitch.mock.calls) {
            expect(durationMs).toBeGreaterThanOrEqual(0);
        }
    });
});
