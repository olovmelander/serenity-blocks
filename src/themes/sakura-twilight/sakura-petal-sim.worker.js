/* eslint-disable no-restricted-globals -- `self` is the Worker global scope */
/**
 * Web Worker entry for Sakura's petals in play (sakura-petal-sim-remote.js): the same simulation
 * (sakura-petal-sim.js) and the same surface (sakura-shape.js), stepped here so a storm's petals
 * cost the page's frame nothing but a copy. Pure math only: neither module imports three.
 */
import { SakuraPetalSim } from './sakura-petal-sim.js';
import { SAKURA_SURFACE_CEILING, SAKURA_WATER_LEVEL, sakuraSurfaceHeight } from './sakura-shape.js';

/** A seeded generator for the petals' own chances (the page keeps its random sequence). */
function seeded(seed) {
    let state = seed >>> 0;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

let sim = null;

self.onmessage = (event) => {
    const data = event?.data || {};
    if (data.type === 'init') {
        // (Its construction resets it with throwaway chances: the page's state replaces that state.)
        sim = new SakuraPetalSim({
            ...data.options,
            rng: () => 0.5,
            surface: sakuraSurfaceHeight,
            waterLevel: SAKURA_WATER_LEVEL,
            surfaceCeiling: SAKURA_SURFACE_CEILING,
        });
        sim.adopt(data.state);
        // From the handover on, the petals' chances come from the worker's own seed.
        sim.rng = seeded(data.seed);
        return;
    }
    if (data.type !== 'step' || !sim) return;
    if (data.reset) sim.reset();
    data.spawns.forEach((args) => sim.spawn(...args));
    sim.step(data.dt, data.env);
    const { out } = data;
    out.position.set(sim.outPosition);
    out.rotation.set(sim.outRotation);
    out.look.set(sim.outLook);
    self.postMessage(
        {
            type: 'frame', out, airborne: sim.airborne, time: sim.time, counts: sim.counts(),
        },
        [out.position.buffer, out.rotation.buffer, out.look.buffer],
    );
};
