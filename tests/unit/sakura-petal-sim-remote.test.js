import { readFileSync } from 'node:fs';
import {
    beforeAll, describe, expect, it,
} from 'vitest';
import { SakuraPetalSim } from '../../src/themes/sakura-twilight/sakura-petal-sim.js';
import { SakuraPetalSimRemote } from '../../src/themes/sakura-twilight/sakura-petal-sim-remote.js';
import {
    SAKURA_SURFACE_CEILING, SAKURA_WATER_LEVEL, sakuraSurfaceHeight,
} from '../../src/themes/sakura-twilight/sakura-shape.js';

/**
 * Sakura's petals step in a module Worker in play (sakura-petal-sim-remote.js): 2-3 ms of a storm
 * frame on the page otherwise (play-feel probe 2026-10-16). The worker module itself runs here,
 * behind a Worker double that answers a microtask later with a structured clone, as a real one
 * would. Its frames are the page simulation's, step for step, given the worker's own chances.
 */
const source = (name) => readFileSync(new URL(`../../src/themes/sakura-twilight/${name}`, import.meta.url), 'utf8');

/** The worker's generator (sakura-petal-sim.worker.js), for the page simulation it is checked against. */
function seeded(seed) {
    let state = seed >>> 0;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

let workerHandler = null;
class WorkerDouble {
    constructor() {
        this.onmessage = null;
        this.onerror = null;
        this.terminated = false;
        WorkerDouble.last = this;
    }

    postMessage(data) {
        const copy = structuredClone(data);
        queueMicrotask(() => {
            if (this.terminated) return;
            globalThis.self.postMessage = (reply) => {
                const back = structuredClone(reply);
                queueMicrotask(() => { if (!this.terminated) this.onmessage?.({ data: back }); });
            };
            workerHandler({ data: copy });
        });
    }

    terminate() {
        this.terminated = true;
    }
}

beforeAll(async () => {
    globalThis.self = globalThis.self || {};
    await import('../../src/themes/sakura-twilight/sakura-petal-sim.worker.js');
    workerHandler = globalThis.self.onmessage;
});

const settle = async () => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve(); // eslint-disable-line no-await-in-loop
};

const make = (rng) => new SakuraPetalSim({
    count: 320,
    reserve: 140,
    rng,
    surface: sakuraSurfaceHeight,
    waterLevel: SAKURA_WATER_LEVEL,
    surfaceCeiling: SAKURA_SURFACE_CEILING,
});

const ENV = {
    windX: 0.8,
    windZ: 0.6,
    breeze: 1.4,
    gust: 2.6,
    front: {
        x: 3, strength: 0.9, width: 8, direction: 1,
    },
    fields: [
        {
            kind: 'burst', x: 0, y: 2, z: -6, radius: 9, power: 14, up: 3,
        },
        {
            kind: 'vortex', x: 4, z: -10, reach: 7, radius: 3, top: 6, pull: 2, spin: 5, turn: 1, grip: 2, lift: 4,
        },
    ],
};

describe('Sakura petals stepped in a worker', () => {
    it('shows the page simulation\'s frames, one request at a time', async () => {
        const page = make(seeded(7));
        const reference = make(seeded(7));
        expect(Array.from(page.outPosition)).toEqual(Array.from(reference.outPosition));
        const remote = new SakuraPetalSimRemote(page, () => new WorkerDouble(), 0x5aa7);
        // The worker draws from its own seed from here on: so does the reference.
        reference.rng = seeded(0x5aa7);
        await settle();
        for (let frame = 0; frame < 40; frame += 1) {
            if (frame % 7 === 3) {
                remote.spawn(1, 4, -8, 2, 3, -1, 0.9);
                reference.spawn(1, 4, -8, 2, 3, -1, 0.9);
            }
            remote.step(1 / 120, ENV);
            reference.step(1 / 120, ENV);
            await settle(); // eslint-disable-line no-await-in-loop
            expect(Array.from(remote.outPosition), `frame ${frame}`).toEqual(Array.from(reference.outPosition));
        }
        expect(Array.from(remote.outRotation)).toEqual(Array.from(reference.outRotation));
        expect(Array.from(remote.outLook)).toEqual(Array.from(reference.outLook));
        expect(remote.counts()).toEqual(reference.counts());
        expect(remote.airborne).toBe(reference.airborne);
        remote.dispose();
        expect(WorkerDouble.last.terminated).toBe(true);
    });

    it('carries the time of frames the worker was still busy with into the next request', async () => {
        const remote = new SakuraPetalSimRemote(make(seeded(3)), () => new WorkerDouble());
        await settle();
        remote.step(0.01, ENV);
        remote.step(0.01, ENV); // still in flight: carried
        expect(remote.carry).toBeCloseTo(0.01, 6);
        await settle();
        remote.step(0.01, ENV);
        expect(remote.carry).toBe(0);
        remote.dispose();
    });

    it('hands the simulation back to the page when its worker fails', async () => {
        const remote = new SakuraPetalSimRemote(make(seeded(5)), () => new WorkerDouble());
        await settle();
        WorkerDouble.last.onerror();
        expect(remote.failed).toBe(true);
        const before = remote.local.time;
        remote.step(1 / 60, ENV);
        expect(remote.local.time).toBeGreaterThan(before);
        expect(remote.outPosition).toBe(remote.local.outPosition);
    });

    it('is built by the theme in play only, and its modules import no three', () => {
        const theme = source('sakura-twilight-theme.js');
        expect(theme).toContain("petalWorker: !enabledParam(searchParams(), 'sakuraSyncPetals'),");
        expect(source('sakura-world.js')).toContain('worker: this.petalWorker');
        const modules = [
            'sakura-petal-sim.js', 'sakura-shape.js', 'sakura-petal-sim.worker.js', 'sakura-petal-sim-remote.js',
        ];
        for (const name of modules) {
            expect(source(name), name).not.toMatch(/from 'three/);
        }
    });
});
