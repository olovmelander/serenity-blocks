import { describe, expect, it, vi } from 'vitest';
import { adoptLateApp } from '../../src/utils/late-app-adoption.js';

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
    return { promise, resolve, reject };
}

describe('adoptLateApp: the app a stalled init produces after the watchdog menu', () => {
    it('wires the app once when the init finishes after the degraded menu', async () => {
        const init = deferred();
        const adopt = vi.fn();
        const adopting = adoptLateApp(init.promise, adopt);
        expect(adopt).not.toHaveBeenCalled(); // the boot has already gone on without it
        const app = { name: 'late' };
        init.resolve(app);
        await adopting;
        expect(adopt).toHaveBeenCalledOnce();
        expect(adopt).toHaveBeenCalledWith(app);
    });

    it('leaves the degraded menu alone when the init fails, without an unhandled rejection', async () => {
        const init = deferred();
        const adopt = vi.fn();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const adopting = adoptLateApp(init.promise, adopt);
        init.reject(new Error('storage never answered'));
        await expect(adopting).resolves.toBeUndefined();
        expect(adopt).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalledOnce();
        warn.mockRestore();
    });

    it('wires nothing for an init that produced no app', async () => {
        const adopt = vi.fn();
        await adoptLateApp(Promise.resolve(null), adopt);
        expect(adopt).not.toHaveBeenCalled();
    });
});
