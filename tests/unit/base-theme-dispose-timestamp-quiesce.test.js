/**
 * @fileoverview BaseTheme.disposeRenderer quiesces WebGPU timestamp queries before
 * releasing the GPU (three r185 upstream race).
 *
 * r185 `WebGPUBackend.dispose()` fires the timestamp pools' ASYNC `dispose()` without
 * awaiting it and then destroys the owned device, so an in-flight
 * `resolveTimestampsAsync()` rejects against a dead device and three logs
 * "Error resolving queries" — once per pool. The Electron theme harness caught it on
 * black-hole (GPU-timed DRS samples at 15 Hz + compute at 2 Hz → exactly two errors).
 * The helper now stops new queries, keeps every observable teardown step synchronous,
 * and defers only `renderer.dispose()` until pending resolves settle (bounded).
 */

import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { BaseTheme } from '../../src/themes/base-theme.js';

class TestTheme extends BaseTheme {
    constructor() {
        super('quiesce-test-theme');
    }

    async createScene() {
        return undefined;
    }
}

function makeRenderer({ webgpu = true, pending = {} } = {}) {
    const parent = { removeChild: vi.fn() };
    const domElement = { parentNode: parent };
    const backend = webgpu
        ? {
            isWebGPUBackend: true,
            trackTimestamp: true,
            timestampQueryPool: {
                render: pending.render ? { pendingResolve: pending.render } : null,
                compute: pending.compute ? { pendingResolve: pending.compute } : null,
            },
        }
        : { isWebGLBackend: true };
    return {
        domElement,
        backend,
        setAnimationLoop: vi.fn(),
        dispose: vi.fn(),
        _parent: parent,
    };
}

const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });

describe('BaseTheme.disposeRenderer — WebGPU timestamp quiesce (r185)', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('releases synchronously when no timestamp resolve is in flight', () => {
        const theme = new TestTheme();
        const renderer = makeRenderer();
        theme.renderer = renderer;
        theme.disposeRenderer();
        expect(renderer.setAnimationLoop).toHaveBeenCalledWith(null);
        expect(renderer.dispose).toHaveBeenCalledTimes(1);
        expect(renderer._parent.removeChild).toHaveBeenCalledTimes(1);
        expect(theme.renderer).toBeNull();
        expect(renderer.backend.trackTimestamp).toBe(false); // no new queries
    });

    it('defers ONLY the GPU release until pending resolves settle; teardown stays synchronous', async () => {
        const theme = new TestTheme();
        let settleRender; let settleCompute;
        const renderer = makeRenderer({
            pending: {
                render: new Promise((resolve) => { settleRender = resolve; }),
                compute: new Promise((resolve) => { settleCompute = resolve; }),
            },
        });
        theme.renderer = renderer;
        theme.disposeRenderer();

        // Observable teardown happened now.
        expect(renderer.setAnimationLoop).toHaveBeenCalledWith(null);
        expect(renderer._parent.removeChild).toHaveBeenCalledTimes(1);
        expect(theme.renderer).toBeNull();
        expect(renderer.backend.trackTimestamp).toBe(false);
        // ...but the device-destroying dispose waits for the in-flight maps.
        expect(renderer.dispose).not.toHaveBeenCalled();

        settleRender(1.5);
        await flush();
        expect(renderer.dispose).not.toHaveBeenCalled(); // compute still pending

        settleCompute(0.4);
        await flush();
        expect(renderer.dispose).toHaveBeenCalledTimes(1);
    });

    it('never wedges on a stuck query — releases after the bound even if a resolve never settles', async () => {
        vi.useFakeTimers();
        const theme = new TestTheme();
        const renderer = makeRenderer({ pending: { render: new Promise(() => {}) } });
        theme.renderer = renderer;
        theme.disposeRenderer();
        expect(renderer.dispose).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(350);
        expect(renderer.dispose).toHaveBeenCalledTimes(1);
    });

    it('still releases when a pending resolve REJECTS (the r185 dead-device path)', async () => {
        const theme = new TestTheme();
        const renderer = makeRenderer({ pending: { render: Promise.reject(new DOMException('destroyed')) } });
        theme.renderer = renderer;
        theme.disposeRenderer();
        await flush();
        expect(renderer.dispose).toHaveBeenCalledTimes(1);
    });

    it('leaves WebGL renderers on the synchronous path untouched', () => {
        const theme = new TestTheme();
        const renderer = makeRenderer({ webgpu: false });
        theme.renderer = renderer;
        theme.disposeRenderer();
        expect(renderer.dispose).toHaveBeenCalledTimes(1);
    });
});
