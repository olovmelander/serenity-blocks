import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(new URL('../../src/main.js', import.meta.url), 'utf8');

function createVisibilityHarness(behavior = 'reduce') {
    const listeners = new Set();
    const document = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
    const start = source.indexOf('    setupVisibilityThrottling() {');
    const end = source.indexOf('\n    /**', start);
    const owner = runInNewContext(`({${source.slice(start, end)}})`, {
        window: {
            electronAPI: {
                onRuntimeEvent: (handler) => {
                    listeners.add(handler);
                    return () => listeners.delete(handler);
                },
            },
        },
        document,
        desktopRuntimeConfig: {},
        installFocusPause: vi.fn(),
        installThemeKeys: vi.fn(),
        console: { log: vi.fn() },
    });
    const app = {
        settingsManager: { get: () => ({ backgroundTabBehavior: behavior }) },
        isTabVisible: true,
        cleanupHandlers: [],
        handleVisibilityChange: vi.fn(),
    };
    owner.setupVisibilityThrottling.call(app);
    return {
        app,
        listeners,
        emit: (payload) => listeners.forEach((listener) => listener(payload)),
    };
}

describe('desktop focus events', () => {
    it('restores rendering after a minimized window receives native focus', () => {
        const { app, emit } = createVisibilityHarness();
        emit({ type: 'window-focus-changed', focused: false });
        expect(app.isTabVisible).toBe(false);
        expect(app.handleVisibilityChange).toHaveBeenLastCalledWith(false);

        // electron/main.js emits { type, ...payload }, with focused at the top level.
        emit({ type: 'window-focus-changed', focused: true });
        expect(app.isTabVisible).toBe(true);
        expect(app.handleVisibilityChange).toHaveBeenLastCalledWith(true);
    });

    it('preserves the continue-in-background preference and ignores unrelated events', () => {
        const { app, emit } = createVisibilityHarness('continue');
        emit({ type: 'window-focus-changed', focused: false });
        emit({ type: 'steam-status', focused: false });
        expect(app.isTabVisible).toBe(true);
        expect(app.handleVisibilityChange).not.toHaveBeenCalled();
    });

    it('unsubscribes the desktop listener when the application cleans up', () => {
        const { app, emit, listeners } = createVisibilityHarness();
        expect(listeners.size).toBe(1);
        app.cleanupHandlers.forEach((dispose) => dispose());
        expect(listeners.size).toBe(0);
        emit({ type: 'window-focus-changed', focused: false });
        expect(app.handleVisibilityChange).not.toHaveBeenCalled();
    });
});
