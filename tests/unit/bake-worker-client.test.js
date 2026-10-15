import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import { bakeInWorker } from '../../src/themes/shared/bake-worker-client.js';
import { buffersOf } from '../../src/themes/shared/bake-worker-host.js';
import {
    bakeOnce, isBaked, primeBake, resetBakeCache,
} from '../../src/themes/shared/bake-cache.js';

/** A Worker stand-in that answers each job on a later microtask, as serveBakes would. */
function fakeWorker(bakes, { fail = new Set(), crash = false } = {}) {
    const worker = {
        posted: [],
        terminated: false,
        onmessage: null,
        onerror: null,
        postMessage(message) {
            worker.posted.push(message);
            queueMicrotask(() => {
                if (crash) { worker.onerror?.(new Error('boom')); return; }
                const { id, kind, args } = message;
                if (fail.has(kind)) worker.onmessage?.({ data: { id, ok: false, error: 'no' } });
                else worker.onmessage?.({ data: { id, ok: true, value: bakes[kind](...args) } });
            });
        },
        terminate() { worker.terminated = true; },
    };
    return worker;
}

/** Only its presence matters: the client checks `typeof Worker` before `createWorker()`. */
class WorkerStub {}

const keyOf = ({ kind, args }) => `test:${kind}:${args.join(':')}`;
const BAKES = { field: (n) => new Float32Array(n), table: (n) => ({ data: new Uint8Array(n) }) };

afterEach(() => {
    resetBakeCache();
    vi.unstubAllGlobals();
});

describe('bakes in a worker', () => {
    it('resolves at once and leaves everything to the build without a Worker', async () => {
        vi.stubGlobal('Worker', undefined);
        const createWorker = vi.fn();
        const result = await bakeInWorker({ jobs: [{ kind: 'field', args: [4] }], keyOf, createWorker });
        expect(result).toEqual({ viaWorker: false, baked: 0, cached: 0 });
        expect(createWorker).not.toHaveBeenCalled();
    });

    it('bakes only what the cache lacks, and primes it under the bakes\' own keys', async () => {
        vi.stubGlobal('Worker', WorkerStub);
        bakeOnce('test:field:4', () => new Float32Array(4));
        let worker;
        const result = await bakeInWorker({
            jobs: [{ kind: 'field', args: [4] }, { kind: 'field', args: [8] }, { kind: 'table', args: [3] }],
            keyOf,
            createWorker: () => { worker = fakeWorker(BAKES); return worker; },
            toCached: (job, value) => (job.kind === 'table' ? { ...value, rebuilt: true } : value),
        });
        expect(result).toEqual({ viaWorker: true, baked: 2, cached: 1 });
        expect(worker.posted.map((m) => m.args[0])).toEqual([8, 3]);
        expect(worker.terminated).toBe(true);
        expect(isBaked('test:field:8')).toBe(true);
        // What the build will ask for now comes from the cache.
        const make = vi.fn();
        expect(bakeOnce('test:table:3', make).rebuilt).toBe(true);
        expect(make).not.toHaveBeenCalled();
    });

    it('leaves a failed job to the build, and finishes when the worker dies', async () => {
        vi.stubGlobal('Worker', WorkerStub);
        const partial = await bakeInWorker({
            jobs: [{ kind: 'field', args: [2] }, { kind: 'table', args: [2] }],
            keyOf,
            createWorker: () => fakeWorker(BAKES, { fail: new Set(['table']) }),
        });
        expect(partial).toEqual({ viaWorker: true, baked: 1, cached: 0 });
        expect(isBaked('test:table:2')).toBe(false);
        const crashed = await bakeInWorker({
            jobs: [{ kind: 'field', args: [5] }],
            keyOf,
            createWorker: () => fakeWorker(BAKES, { crash: true }),
        });
        expect(crashed).toEqual({ viaWorker: true, baked: 0, cached: 0 });
        expect(isBaked('test:field:5')).toBe(false);
    });

    it('keeps the first result when the build baked a key while the worker ran', () => {
        const mine = new Float32Array(2);
        bakeOnce('test:field:2', () => mine);
        expect(primeBake('test:field:2', new Float32Array(2))).toBe(mine);
    });
});

describe('the worker side transfers every typed array a bake returns', () => {
    it('finds buffers at the top, in arrays and in objects', () => {
        const a = new Float32Array(2);
        const b = new Uint16Array(2);
        const c = new Uint8Array(2);
        const found = buffersOf({ data: a, mips: [{ data: b }], c });
        expect([...found].sort((x, y) => x.byteLength - y.byteLength)).toEqual([c.buffer, b.buffer, a.buffer]);
    });
});
