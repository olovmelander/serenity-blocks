import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(new URL('../../electron/main-minimal.js', import.meta.url), 'utf8');

describe('minimal Electron single-instance lifecycle', () => {
    it.each([false, true])('opens windows only for a held single-instance lock (%s)', (gotLock) => {
        const app = new EventEmitter();
        let ready;
        app.whenReady = () => ({ then: (callback) => { ready = callback; } });
        const createWindow = vi.fn();
        const BrowserWindow = { getAllWindows: vi.fn(() => []) };
        runInNewContext(source.slice(source.indexOf('app.whenReady()')), {
            app, gotLock, createWindow, BrowserWindow,
        });

        ready();
        expect(createWindow).toHaveBeenCalledTimes(gotLock ? 1 : 0);
        app.emit('activate');
        expect(createWindow).toHaveBeenCalledTimes(gotLock ? 2 : 0);
        BrowserWindow.getAllWindows.mockReturnValue([{}]);
        app.emit('activate');
        expect(createWindow).toHaveBeenCalledTimes(gotLock ? 2 : 0);
    });
});
