/**
 * A desktop quit tore the page down while its cleanup was still running, so the run's
 * demo autosave, the Odyssey session save and debounced Steam Cloud uploads were lost
 * (audit LIFE-14). The main process now asks first and waits for prepareForQuit().
 */
import { describe, expect, it, vi } from 'vitest';
import { installPageTeardown, prepareForQuit } from '../../src/utils/page-teardown.js';

describe('page teardown', () => {
    it('finishes the app cleanup before sending the Cloud uploads it queued', async () => {
        const order = [];
        const app = {
            cleanup: vi.fn(async () => {
                await Promise.resolve();
                order.push('cleanup');
            }),
            cloudSyncManager: { flushPendingUploads: vi.fn(async () => { order.push('cloud'); }) },
        };
        await prepareForQuit(app);
        expect(order).toEqual(['cleanup', 'cloud']);
    });

    it('still sends the Cloud uploads when the cleanup fails', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const app = {
            cleanup: vi.fn(async () => { throw new Error('mode teardown failed'); }),
            cloudSyncManager: { flushPendingUploads: vi.fn(async () => {}) },
        };
        await expect(prepareForQuit(app)).resolves.toBeUndefined();
        expect(app.cloudSyncManager.flushPendingUploads).toHaveBeenCalledTimes(1);
        warn.mockRestore();
    });

    it('settles when Cloud sync has not started (browser build, or a quit during boot)', async () => {
        await expect(prepareForQuit({ cleanup: async () => {}, cloudSyncManager: null })).resolves.toBeUndefined();
    });

    it('cleans up on pagehide and registers the desktop quit handler', async () => {
        const target = new EventTarget();
        let prepare = null;
        const app = { cleanup: vi.fn(async () => {}), cleanupHandlers: [] };
        installPageTeardown(app, { target, desktopApi: { onPrepareQuit: (fn) => { prepare = fn; } } });
        target.dispatchEvent(new Event('pagehide'));
        expect(app.cleanup).toHaveBeenCalledTimes(1);
        await prepare();
        expect(app.cleanup).toHaveBeenCalledTimes(2);
        app.cleanupHandlers.forEach((dispose) => dispose());
        target.dispatchEvent(new Event('pagehide'));
        expect(app.cleanup).toHaveBeenCalledTimes(2);
    });

    it('needs no desktop bridge in the browser build', () => {
        const app = { cleanup: vi.fn(async () => {}), cleanupHandlers: [] };
        expect(() => installPageTeardown(app, { target: new EventTarget(), desktopApi: null })).not.toThrow();
    });
});
