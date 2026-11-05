import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';

vi.mock('../../src/main.js', () => ({}));

beforeEach(() => {
    vi.resetModules();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('desktop entry startup diagnostics', () => {
    it.each(['synchronous', 'asynchronous'])('logs a %s IPC failure without blocking the renderer import', async (kind) => {
        const error = new Error('startup telemetry unavailable');
        const rejected = Promise.reject(error);
        // Keep the baseline reproduction local to this assertion rather than producing
        // an unrelated runner-level unhandled rejection before the fix is installed.
        rejected.catch(() => {});
        const shell = { set: vi.fn(), markBundleStarted: vi.fn(), fail: vi.fn() };
        vi.stubGlobal('window', {
            __serenityStartupShell: shell,
            electronAPI: {
                invoke: vi.fn(() => {
                    if (kind === 'synchronous') throw error;
                    return rejected;
                }),
            },
        });

        await import('../../src/entry-desktop.js');
        await vi.dynamicImportSettled();

        expect(console.warn).toHaveBeenCalledWith('[DesktopEntry] Failed to report renderer entry start:', error);
        expect(shell.markBundleStarted).toHaveBeenCalledWith('Renderer bundle loaded');
        expect(shell.fail).not.toHaveBeenCalled();
    });

    it('loads the renderer when the desktop IPC API is absent', async () => {
        const shell = { markBundleStarted: vi.fn() };
        vi.stubGlobal('window', { __serenityStartupShell: shell });
        await import('../../src/entry-desktop.js');
        await vi.dynamicImportSettled();
        expect(shell.markBundleStarted).toHaveBeenCalledOnce();
        expect(console.warn).not.toHaveBeenCalled();
    });
});
