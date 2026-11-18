/**
 * Rainbow Terraces — the living pass on the CPU: a real RainbowTerracesWorld, no renderer.
 *
 * What the air does to the world by itself (its wheel, its happenings, the bell telling the hour),
 * and the events' own shapes that pass added: the twist's helix, the back-to-back's twin bow, the
 * perfect clear's full circle, the bell's rings at a new level, the dusk of a run's end and the
 * next run's dawn. Relations, not tuning numbers: what rises, what returns, what never steps.
 */
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import {
    DUSK, REST_RIG, RainbowTerracesWorld, STROKES, TWIN, fovForAspect,
} from '../../src/themes/rainbow-terraces/rainbow-terraces-world.js';
import { fallbackLayout } from '../../src/themes/rainbow-terraces/rainbow-terraces-composition.js';
import { BELL, TWISTER } from '../../src/themes/rainbow-terraces/rainbow-terraces-events.js';
import { FALL_SLOT, PACKET_SLOTS } from '../../src/themes/rainbow-terraces/rainbow-terraces-falls.js';
import { GLOW } from '../../src/themes/rainbow-terraces/rainbow-terraces-fx.js';
import { HOUR_SECONDS } from '../../src/themes/rainbow-terraces/rainbow-terraces-hours.js';
import {
    AIR_NAMES, AIR_SECONDS, HAPPENINGS, HAPPEN_FIRST, SLOT_SECONDS,
} from '../../src/themes/rainbow-terraces/rainbow-terraces-weather.js';
import { RAINBOW_TERRACES_TETROMINOS } from '../../src/themes/rainbow-terraces/rainbow-terraces-tetrominos.js';

vi.setConfig({ testTimeout: 60_000 }); // every test builds a whole world

const COLORS = RAINBOW_TERRACES_TETROMINOS.colors;
const worlds = [];
afterEach(() => {
    worlds.splice(0).forEach((w) => w.dispose());
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

function makeWorld(quality = 'Low', {
    width = 1600, height = 900, at = 10, reduce = false, air = null, hour = null, happenings = true,
} = {}) {
    const scene = new THREE.Scene();
    const aspect = width / height;
    const camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, REST_RIG.near, REST_RIG.far);
    const world = new RainbowTerracesWorld({
        scene, quality, capture: true, air, hour, happenings,
    }).build();
    worlds.push(world);
    world.bindCamera(camera);
    world.setReducedMotion(reduce);
    world.setViewport(width, height, aspect);
    world.setLayout(fallbackLayout(width, height), aspect);
    settle(world, camera, at);
    return { scene, camera, world };
}

function settle(world, camera, time) {
    world.seek(time);
    const sim = {
        time, delta: 0, pointerX: 0, pointerY: 0,
    };
    world.updateCamera(camera, sim);
    world.update(sim, camera);
}

function frame(world, camera, dt) {
    const sim = {
        time: world.time + dt, delta: dt, pointerX: 0, pointerY: 0,
    };
    world.updateCamera(camera, sim);
    world.update(sim, camera);
}

function run(world, camera, seconds, dt = 1 / 30, each = null) {
    const steps = Math.round(seconds / dt);
    for (let i = 0; i < steps; i++) {
        frame(world, camera, dt);
        each?.(world);
    }
}

const clear = (world, extra = {}) => world.onClear({
    player: 0, rows: [19], lines: 1, combo: 1, cascade: 1, twist: false, perfect: false, b2b: false, screen: null, ...extra,
});
const lock = (world, extra = {}) => world.onLock({
    player: 0, u: 0.3, rows: [12, 11], color: COLORS.T, shape: 'T', hardDrop: false, screen: null, ...extra,
});
/** Every glow the world pushed this frame: [x, y, z, radius, r, g, b, shape]. */
function glows(world) {
    const { mesh } = world.parts.fx.glows;
    const data = mesh.geometry.attributes.aGlowA.data.array;
    const out = [];
    for (let i = 0; i < mesh.count; i++) out.push(Array.from(data.subarray(i * 12, i * 12 + 8)));
    return out;
}
/** The far skein's lights: out over the gulf (it flies a straight line, nearest at mid-frame), above the eye. */
const skeinOf = (world) => glows(world).filter((g) => {
    const d = Math.hypot(g[0], g[1], g[2]);
    return d > 2200 && d < 6500 && g[1] > 300;
});
const secondary = (world) => world.U.strokes.array.slice(7, STROKES).map((row) => ({ z: row.z, w: row.w }));
const finiteUniforms = (world) => Object.entries(world.U).every(([, u]) => {
    const v = u?.value;
    if (typeof v === 'number') return Number.isFinite(v);
    if (v && typeof v.toArray === 'function') return v.toArray().every(Number.isFinite);
    return true;
});

describe('Rainbow Terraces living: the air turns by itself', () => {
    it('lights the same hour differently in every air, with every number sound', () => {
        const seen = AIR_NAMES.map((name, k) => {
            const { world } = makeWorld('Low', { air: k, hour: 0, happenings: false });
            expect(world.air.name, name).toBe(name);
            expect(finiteUniforms(world), name).toBe(true);
            const { U } = world;
            return {
                shower: U.showerAmt.value,
                rays: U.rays.value,
                bowRest: U.bowRest.value,
                cirrus: U.cirrus.value,
                swell: U.seaSwell.value,
                veil: U.veilAmt.value,
                zenith: U.rows.array[0].toArray().slice(0, 3),
            };
        });
        const by = (name) => seen[AIR_NAMES.indexOf(name)];
        expect(by('showers').shower).toBeGreaterThan(by('fair').shower);
        expect(by('showers').bowRest).toBeGreaterThan(by('fair').bowRest);
        expect(by('crystal').shower).toBeLessThan(by('fair').shower);
        expect(by('crystal').cirrus).toBeGreaterThan(by('fair').cirrus);
        expect(by('beams').rays).toBeGreaterThan(by('fair').rays);
        expect(by('mist').veil).toBeGreaterThan(by('fair').veil);
        expect(by('mist').swell).toBeLessThan(by('showers').swell);
        // Five skies: no two airs share a zenith.
        for (let a = 0; a < seen.length; a++) {
            for (let b = a + 1; b < seen.length; b++) {
                const d = Math.hypot(...seen[a].zenith.map((v, i) => v - seen[b].zenith[i]));
                if (!(AIR_NAMES[a] === 'fair' && AIR_NAMES[b] === 'beams')) expect(d, `${AIR_NAMES[a]} ${AIR_NAMES[b]}`).toBeGreaterThan(1e-3);
            }
        }
    });

    it('walks through all five airs by the clock alone, never stepping the light', () => {
        const { world, camera } = makeWorld('Minimal', { at: 0, hour: 0, happenings: false });
        const names = new Set();
        let prev = null;
        // A whole round of the airs at ten frames a second.
        run(world, camera, AIR_SECONDS * AIR_NAMES.length, 1 / 10, (w) => {
            names.add(w.air.name);
            const now = [w.U.keyGain.value, w.U.showerAmt.value, w.U.rays.value, w.U.bowRest.value, w.post.exposure, w.U.seaSwell.value];
            if (prev) now.forEach((v, i) => expect(Math.abs(v - prev[i]), `number ${i} at ${w.time.toFixed(1)}`).toBeLessThan(0.02));
            prev = now;
        });
        expect([...names].sort()).toEqual([...AIR_NAMES].sort());
        expect(finiteUniforms(world)).toBe(true);
    });

    it('lets the wind of the air carry the sky: the mist\'s clock runs faster under the showers than in the mist', () => {
        const drift = (air) => {
            const { world, camera } = makeWorld('Minimal', { air, hour: 0, happenings: false });
            const from = world.U.mistClock.value;
            run(world, camera, 5);
            return world.U.mistClock.value - from;
        };
        expect(drift(AIR_NAMES.indexOf('showers'))).toBeGreaterThan(drift(AIR_NAMES.indexOf('fair')));
        expect(drift(AIR_NAMES.indexOf('mist'))).toBeLessThan(drift(AIR_NAMES.indexOf('fair')));
    });
});

describe('Rainbow Terraces living: what happens by itself', () => {
    it('plays a staged happening as a closed form of its age: lights in the sky, then none', () => {
        const { world, camera } = makeWorld('Low', { hour: 3, happenings: true });
        const quiet = glows(world).length;
        world.stageHappening('flight', world.time);
        run(world, camera, HAPPENINGS.flight.length * 0.5);
        // A skein of far lights, all of them above the horizon and well out over the gulf.
        const far = skeinOf(world);
        expect(far.length).toBeGreaterThanOrEqual(7);
        far.forEach((g) => expect(g[1]).toBeGreaterThan(0));
        run(world, camera, HAPPENINGS.flight.length * 0.5 + 1);
        expect(skeinOf(world)).toHaveLength(0);
        expect(glows(world).length).toBeLessThanOrEqual(quiet + 2);
    });

    it('flies the skein edge to edge at one pace: no bird is born or lost in view, none jumps', () => {
        const { world, camera } = makeWorld('High', { hour: 0, happenings: true });
        world.stageHappening('flight', world.time);
        const { cam } = world.frame;
        const screenX = (g) => {
            const d = Math.hypot(g[0], g[1], g[2]);
            const { r, f } = cam.basis;
            const zf = (g[0] * f[0] + g[1] * f[1] + g[2] * f[2]) / d;
            return 0.5 + (0.5 * ((g[0] * r[0] + g[1] * r[1] + g[2] * r[2]) / d)) / (zf * cam.tanX);
        };
        const skein = () => skeinOf(world);
        frame(world, camera, 1 / 30);
        // As it begins every bird is still outside the frame, and so it ends.
        const first = skein().map(screenX);
        expect(first.length).toBeGreaterThanOrEqual(7);
        expect(first.every((x) => x < 0 || x > 1)).toBe(true);
        let prev = first;
        run(world, camera, HAPPENINGS.flight.length - 0.2, 1 / 30, () => {
            const now = skein().map(screenX);
            if (now.length !== prev.length) return;
            // The whole skein moves together: every bird the same small step.
            const steps = now.map((x, i) => x - prev[i]);
            steps.forEach((s) => expect(Math.abs(s)).toBeLessThan(0.006));
            expect(Math.max(...steps) - Math.min(...steps)).toBeLessThan(0.002);
            prev = now;
        });
        expect(prev.every((x) => x < 0 || x > 1)).toBe(true);
    });

    it('surges the rays for the beams and brings the bow out for a veil of rain, and lets both go', () => {
        const { world, camera } = makeWorld('High', { hour: 0, air: 0, happenings: true });
        const rest = { rays: world.U.rays.value, bow: world.U.bowRest.value };
        world.stageHappening('beams', world.time);
        run(world, camera, HAPPENINGS.beams.length * 0.5);
        expect(world.U.rays.value).toBeGreaterThan(rest.rays + 0.15);
        run(world, camera, HAPPENINGS.beams.length * 0.5 + 0.5);
        expect(world.U.rays.value).toBeCloseTo(rest.rays, 2);
        world.stageHappening('veil', world.time);
        run(world, camera, HAPPENINGS.veil.length * 0.5);
        expect(world.U.bowRest.value).toBeGreaterThan(rest.bow + 0.15);
        run(world, camera, HAPPENINGS.veil.length * 0.5 + 0.5);
        expect(world.U.bowRest.value).toBeCloseTo(rest.bow, 2);
    });

    it('fires a slot\'s one-shot once, whatever the frame rate, and nothing at all when stilled', () => {
        // Find a slot that heaves the plume, by the clock.
        const probe = makeWorld('Minimal', { at: 0, hour: 0, air: 0 }).world;
        let plumeAt = null;
        for (let slot = 0; slot < 400 && plumeAt === null; slot++) {
            probe.applyHour(HAPPEN_FIRST + slot * SLOT_SECONDS + SLOT_SECONDS - 0.5);
            if (probe.happening.kind === 'plume') plumeAt = probe.happening.at;
        }
        expect(plumeAt).not.toBe(null);
        const arms = (dt, happenings) => {
            const { world, camera } = makeWorld('Minimal', {
                at: plumeAt - 1, hour: 0, air: 0, happenings,
            });
            let most = 0;
            run(world, camera, 3, dt, (w) => { most = Math.max(most, (w.sprayArms || []).length); });
            return most;
        };
        expect(arms(1 / 30, true)).toBe(1);
        expect(arms(1 / 7, true)).toBe(1);
        expect(arms(1 / 30, false)).toBe(0);
    });

    it('tells the hour: the bell tolls softly as the light walks into a new hour by the clock', () => {
        const { world, camera } = makeWorld('Minimal', { at: HOUR_SECONDS * 0.5 - 2, air: 0 });
        const before = world.U.toll.value.x;
        run(world, camera, 4);
        const toll = world.U.toll.value;
        expect(toll.x).toBeGreaterThan(before);
        expect(toll.x).toBeCloseTo(HOUR_SECONDS * 0.5, 0);
        expect(toll.y).toBeGreaterThan(0);
        expect(toll.y).toBeLessThan(1); // a new level's toll is the loud one
        expect(world.effects.bells.items.some((b) => world.time - b.at < BELL.life + 1)).toBe(true);
    });

    it('keeps play the first voice: nothing of the air\'s own starts while a run has ended', () => {
        const { world, camera } = makeWorld('Low', { hour: 3 });
        world.onGameOver();
        world.resetSession();
        world.stageHappening('flight', world.time);
        run(world, camera, 6);
        expect(skeinOf(world)).toHaveLength(0);
    });
});

describe('Rainbow Terraces living: a twist winds a helix up the Mother Fall', () => {
    it('draws a climbing helix of lights round the fall, and lets it go', () => {
        const { world, camera } = makeWorld('High', { happenings: false });
        lock(world);
        run(world, camera, 2);
        const before = glows(world).length;
        clear(world, {
            twist: true, lines: 2, rows: [19, 18], combo: 1,
        });
        expect(world.effects.twisters.items.filter((r) => world.time - r.at < TWISTER.life)).toHaveLength(1);
        run(world, camera, TWISTER.climb * 0.6);
        const mid = glows(world);
        expect(mid.length).toBeGreaterThan(before + 20);
        // Streaks wound round the Mother Fall's line: they stand near her, and at many heights.
        const m = world.fallCpu[FALL_SLOT.mother].lip;
        const streaks = mid.filter((g) => g[7] === GLOW.streak && Math.hypot(g[0] - m[0], g[2] - m[2]) < 120);
        expect(streaks.length).toBeGreaterThan(12);
        const ys = streaks.map((g) => g[1]);
        expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(20);
        run(world, camera, TWISTER.life + 1.5);
        expect(glows(world).filter((g) => g[7] === GLOW.streak)).toHaveLength(0);
    });

    it('a twist that clears nothing winds a smaller one; a second twist never cuts the first', () => {
        const { world, camera } = makeWorld('High', { happenings: false });
        lock(world);
        run(world, camera, 2);
        clear(world, { twist: true, lines: 0, rows: [] });
        const [small] = world.effects.twisters.items.filter((r) => world.time - r.at < TWISTER.life);
        expect(small.strength).toBeLessThan(0.9);
        run(world, camera, 0.4);
        clear(world, { twist: true, lines: 2, rows: [19, 18] });
        const live = world.effects.twisters.items.filter((r) => world.time - r.at < TWISTER.life);
        expect(live).toHaveLength(2);
        expect(Math.max(...live.map((r) => r.strength))).toBeGreaterThanOrEqual(1);
    });
});

describe('Rainbow Terraces living: a back-to-back gives the bow its twin', () => {
    it('draws the secondary round, holds it, and lets it fade to nothing: never switched on or off', () => {
        const { world, camera } = makeWorld('High', { happenings: false });
        expect(secondary(world).every((s) => s.z === 0)).toBe(true);
        clear(world, { lines: 2, rows: [19, 18], b2b: true });
        let prev = secondary(world);
        let whole = false;
        run(world, camera, TWIN.fadeAt + TWIN.fade + 2, 1 / 30, (w) => {
            const now = secondary(w);
            now.forEach((s, i) => {
                // The light arrives by running along the stroke and leaves by fading: no stroke's
                // weight steps, and none appears whole.
                expect(Math.abs(s.w - prev[i].w), `stroke ${7 + i} weight`).toBeLessThanOrEqual(TWIN.peak + 1e-6);
                if (prev[i].z === 0 && s.z > 0) expect(s.z).toBeLessThan(0.5);
            });
            if (now.every((s) => s.z >= 1)) whole = true;
            prev = now;
        });
        expect(whole).toBe(true);
        expect(secondary(world).every((s) => s.z === 0 && s.w === 0)).toBe(true);
        expect(world.U.bow.value.w).toBeCloseTo(world.dial, 3); // what it lent the optics is given back
    });

    it('lends the optics a long chain\'s dial while it stands, and holds on through a second back-to-back', () => {
        const { world, camera } = makeWorld('High', { happenings: false });
        clear(world, { lines: 2, rows: [19, 18], b2b: true });
        run(world, camera, TWIN.draw + 0.6);
        expect(world.U.bow.value.w).toBeGreaterThan(7);
        const fadeAt = world.twinFadeAt;
        run(world, camera, 1.5);
        clear(world, { lines: 2, rows: [19, 18], b2b: true });
        expect(world.twinFadeAt).toBeGreaterThan(fadeAt);
        // Not drawn again from nothing: every stroke is still whole.
        frame(world, camera, 1 / 30);
        expect(secondary(world).every((s) => s.z >= 1)).toBe(true);
    });

    it('leaves the secondary to the chain where the chain has painted it', () => {
        const { world, camera } = makeWorld('High', { happenings: false });
        world.onCombo(9);
        run(world, camera, 12);
        const painted = secondary(world).map((s) => s.z);
        expect(painted[0]).toBe(1);
        expect(painted[4]).toBe(0);
        clear(world, {
            lines: 2, rows: [19, 18], b2b: true, combo: 9,
        });
        run(world, camera, TWIN.fadeAt + TWIN.fade + 2);
        // The twin has gone; what the chain painted stands.
        const after = secondary(world).map((s) => s.z);
        expect(after[0]).toBe(1);
        expect(after[1]).toBe(1);
        expect(after[4]).toBe(0);
    });
});

describe('Rainbow Terraces living: a perfect clear closes the full circle', () => {
    it('draws both bows, rings the bell out, floods the rays and runs the seven colours down the falls', () => {
        const { world, camera } = makeWorld('High', { happenings: false, hour: 0, air: 0 });
        const restRays = world.U.rays.value;
        clear(world, {
            lines: 0, rows: [], crown: true, perfect: true,
        });
        expect(world.fullAt).toBeGreaterThan(world.time - 1e-6);
        expect(world.U.toll.value.y).toBeGreaterThan(1);
        // Seven bands on the Mother Fall, each its own colour.
        const rows = world.U.packets.array;
        const bands = [];
        for (let k = 0; k < PACKET_SLOTS; k++) {
            const a = rows[k * 2];
            const b = rows[k * 2 + 1];
            if (a.x === FALL_SLOT.mother && b.w === 0 && a.y > world.U.waterClock.value) bands.push([b.x, b.y, b.z].join());
        }
        expect(new Set(bands).size).toBeGreaterThanOrEqual(7);
        run(world, camera, 4.5);
        expect(world.U.rays.value).toBeGreaterThan(restRays + 0.2);
        expect(world.U.strokes.array.slice(0, 7).every((row) => row.z >= 1)).toBe(true);
        expect(secondary(world).every((s) => s.z >= 1)).toBe(true);
        expect(world.U.bow.value.w).toBeGreaterThan(10); // the band of light runs round both bows
        // The Far Gate's arch is lit: lights standing at the gate's own distance.
        const gate = world.placement.gate.pos;
        const far = Math.hypot(gate[0], gate[1], gate[2]);
        expect(glows(world).filter((g) => Math.abs(Math.hypot(g[0], g[1], g[2]) - far) < far * 0.1).length).toBeGreaterThanOrEqual(6);
        run(world, camera, 14);
        expect(world.U.rays.value).toBeCloseTo(restRays, 1);
        expect(secondary(world).every((s) => s.z === 0)).toBe(true);
        expect(glows(world).filter((g) => Math.abs(Math.hypot(g[0], g[1], g[2]) - far) < far * 0.1)).toHaveLength(0);
    });

    it('is fed, never started again, by a second crown while it stands', () => {
        const { world, camera } = makeWorld('High', { happenings: false });
        clear(world, {
            lines: 0, rows: [], crown: true, perfect: true,
        });
        const at = world.fullAt;
        run(world, camera, 4.5);
        clear(world, {
            lines: 0, rows: [], crown: true, perfect: true,
        });
        frame(world, camera, 1 / 30);
        expect(world.fullAt).toBe(at);
        expect(secondary(world).every((s) => s.z >= 1)).toBe(true);
    });
});

describe('Rainbow Terraces living: a new level rings the bell where it can be seen', () => {
    it('opens rings in the air round the bell, one after another, each wider and fainter', () => {
        const { world, camera } = makeWorld('High', { happenings: false });
        world.levelUp(2);
        const bellRings = () => glows(world).filter((g) => g[7] === GLOW.ring);
        run(world, camera, BELL.gap * (BELL.rings - 1) + 0.3);
        const rings = bellRings();
        expect(rings).toHaveLength(BELL.rings);
        // All round the one bell; the first ring the widest and the faintest by now.
        rings.forEach((g) => expect(Math.hypot(g[0] - rings[0][0], g[1] - rings[0][1], g[2] - rings[0][2])).toBeLessThan(1e-3));
        const radii = rings.map((g) => g[3]);
        expect(radii[0]).toBeGreaterThan(radii[1]);
        expect(radii[1]).toBeGreaterThan(radii[2]);
        run(world, camera, BELL.life + 1);
        expect(bellRings()).toHaveLength(0);
    });
});

describe('Rainbow Terraces living: the dusk of a run\'s end, and the next run\'s dawn', () => {
    it('falls over seconds and stands: the light sinks, the falls thin, the stars come out, the birds go home', () => {
        const { world, camera } = makeWorld('High', { happenings: false, hour: 0, air: 0 });
        const rest = {
            exposure: world.post.exposure, key: world.U.keyGain.value, flow: world.U.flow.value.y, stars: world.U.stars.value,
        };
        world.onGameOver();
        world.resetSession();
        expect(world.ended).toBe(true);
        let prev = 0;
        run(world, camera, DUSK.fall + 1, 1 / 30, (w) => {
            expect(w.dusk).toBeGreaterThanOrEqual(prev - 1e-9); // only ever deeper
            expect(w.dusk - prev).toBeLessThan(0.03); // never a step
            prev = w.dusk;
        });
        expect(world.dusk).toBeCloseTo(1, 5);
        expect(world.post.exposure).toBeLessThan(rest.exposure * 0.8);
        expect(world.U.keyGain.value).toBeLessThan(rest.key * 0.8);
        expect(world.U.flow.value.y).toBeLessThan(rest.flow * 0.6);
        expect(world.U.stars.value).toBeGreaterThan(rest.stars + 0.2);
        // It stands until something lifts it.
        run(world, camera, 20);
        expect(world.dusk).toBeCloseTo(1, 5);
        expect(world.ended).toBe(true);
    });

    it('lifts at the next run: the bell rings the morning in, the falls come back, and all of it returns', () => {
        const { world, camera } = makeWorld('High', { happenings: false, hour: 0, air: 0 });
        const rest = { exposure: world.post.exposure, flow: world.U.flow.value.y };
        world.onGameOver();
        world.resetSession();
        run(world, camera, DUSK.fall + 3);
        const tollBefore = world.U.toll.value.x;
        world.onSessionStart();
        expect(world.ended).toBe(false);
        expect(world.U.toll.value.x).toBeGreaterThan(tollBefore);
        let prev = world.dusk;
        let swollen = 0;
        run(world, camera, DUSK.rise + 4, 1 / 30, (w) => {
            expect(w.dusk).toBeLessThanOrEqual(prev + 1e-9);
            expect(prev - w.dusk).toBeLessThan(0.03);
            prev = w.dusk;
            swollen = Math.max(swollen, w.U.flow.value.y);
        });
        expect(world.dusk).toBe(0);
        expect(world.post.exposure).toBeCloseTo(rest.exposure, 3);
        expect(world.U.flow.value.y).toBeCloseTo(rest.flow, 2);
        expect(swollen).toBeGreaterThan(rest.flow * 1.1); // they came back in a surge
    });

    it('changes nothing for a first run, and lifts quietly when the mode ends instead', () => {
        const { world, camera } = makeWorld('Low', { happenings: false, hour: 0, air: 0 });
        const toll = world.U.toll.value.x;
        world.onSessionStart();
        run(world, camera, 1);
        expect(world.dusk).toBe(0);
        expect(world.U.toll.value.x).toBe(toll);
        world.onGameOver();
        world.resetSession();
        run(world, camera, DUSK.fall + 1);
        const tolled = world.U.toll.value.x;
        world.onSessionStop();
        world.resetSession();
        expect(world.ended).toBe(false);
        run(world, camera, DUSK.rise + 1);
        expect(world.dusk).toBe(0);
        expect(world.U.toll.value.x).toBe(tolled); // no fanfare for leaving
    });

    it('never jumps when a run is lost while its dawn is still rising, or restarted as the dusk falls', () => {
        const { world, camera } = makeWorld('Low', { happenings: false, hour: 0, air: 0 });
        world.onGameOver();
        world.resetSession();
        run(world, camera, DUSK.fall * 0.5);
        const half = world.dusk;
        world.onSessionStart();
        frame(world, camera, 1 / 30);
        expect(Math.abs(world.dusk - half)).toBeLessThan(0.05);
        run(world, camera, DUSK.rise * 0.4);
        const rising = world.dusk;
        world.onGameOver();
        world.resetSession();
        frame(world, camera, 1 / 30);
        expect(Math.abs(world.dusk - rising)).toBeLessThan(0.08);
        run(world, camera, DUSK.fall + 1);
        expect(world.dusk).toBeCloseTo(1, 5);
    });

    it('a second game over while the dusk stands does not toll again', () => {
        const { world, camera } = makeWorld('Low', { happenings: false });
        world.onGameOver();
        world.resetSession();
        run(world, camera, 5);
        const toll = world.U.toll.value.x;
        world.onGameOver();
        expect(world.U.toll.value.x).toBe(toll);
    });
});

describe('Rainbow Terraces living: every frame is still a function of the clock', () => {
    it('replays a busy stretch the same at thirty and at sixty frames a second', () => {
        const play = (dt) => {
            const { world, camera } = makeWorld('Low', { at: 40, hour: 1, air: 2 });
            const script = [
                [0.5, (w) => clear(w, { lines: 2, rows: [19, 18], b2b: true })],
                [1.5, (w) => clear(w, { twist: true, lines: 2, rows: [19, 18] })],
                [2.5, (w) => w.levelUp(2)],
                [4.0, (w) => clear(w, {
                    lines: 0, rows: [], crown: true, perfect: true,
                })],
            ];
            const start = world.time;
            const end = start + 8;
            while (world.time < end - 1e-9) {
                const next = script.find(([at]) => start + at > world.time + 1e-9);
                const until = next ? Math.min(end, start + next[0]) : end;
                const steps = Math.max(1, Math.round((until - world.time) / dt));
                const h = (until - world.time) / steps;
                for (let i = 0; i < steps; i++) frame(world, camera, h);
                if (next && Math.abs(world.time - (start + next[0])) < 1e-6) {
                    next[1](world);
                    script.splice(script.indexOf(next), 1);
                }
            }
            return {
                rays: world.U.rays.value,
                twin: secondary(world).map((s) => s.z + s.w),
                dial: world.U.bow.value.w,
                toll: world.U.toll.value.toArray(),
                key: world.U.keyGain.value,
            };
        };
        const a = play(1 / 30);
        const b = play(1 / 60);
        expect(b.rays).toBeCloseTo(a.rays, 3);
        expect(b.dial).toBeCloseTo(a.dial, 3);
        expect(b.key).toBeCloseTo(a.key, 6);
        b.twin.forEach((v, i) => expect(v).toBeCloseTo(a.twin[i], 3));
        b.toll.forEach((v, i) => expect(v).toBeCloseTo(a.toll[i], 6));
    });
});
