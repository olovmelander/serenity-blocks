/**
 * Supernova — the living pass (2026-11): what turns by itself, and the shape each event has.
 *
 * A real world in a THREE.Scene with no renderer. These hold relations, not tuning numbers: the
 * sky turns about its band's pole, the star is restless on a cycle of its own, every shell the
 * star throws off is its own, a lock draws no ring, and every big event writes a different shape
 * on the aura sheet (which has no size at rest).
 */
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import {
    ERUPT_BEAT, HOLE_BACK, HOLE_FALL, HOLE_HOLD, REST_RIG, SupernovaWorld, fovForAspect,
} from '../../src/themes/supernova/supernova-world.js';
import {
    ACTIVITY_CYCLE, AURA_PLUMES, CRITICAL_COMBO, NEBULA, PULSE_PERIOD, RING, ROW_FLIGHT, SHELL_STRIDE, SKY_TURN,
    STREAM_FLIGHT, TAU, bandAnchor, starActivity, starPulse,
} from '../../src/themes/supernova/supernova-core.js';
import { CELLS3_GRID, CELLS3_SIZE } from '../../src/themes/supernova/supernova-tsl.js';
import { fallbackLayout } from '../../src/themes/supernova/supernova-composition.js';

vi.mock('../../src/themes/supernova/supernova-tsl.js', async (importOriginal) => {
    const actual = await importOriginal();
    const baked = new Map();
    const once = (key, make) => {
        if (!baked.has(key)) baked.set(key, make());
        return baked.get(key);
    };
    return {
        ...actual,
        bakeNoise3D: (seed = 1987, size = actual.NOISE3_SIZE) => once(
            `n/${seed}/${size}`,
            () => actual.bakeNoise3D(seed, size),
        ),
        bakeCells3D: (seed = 1987, size = actual.CELLS3_SIZE) => once(
            `c/${seed}/${size}`,
            () => actual.bakeCells3D(seed, size),
        ),
    };
});
vi.setConfig({ testTimeout: 30000 });

function makeWorld(quality = 'High', { width = 1600, height = 900, time = 10 } = {}) {
    const scene = new THREE.Scene();
    const aspect = width / height;
    const camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, REST_RIG.near, REST_RIG.far);
    const world = new SupernovaWorld({ scene, quality, capture: true }).build();
    world.bindCamera(camera);
    world.setViewport(width, height, aspect);
    world.setLayout(fallbackLayout(width, height), aspect);
    world.seek(time);
    world.updateCamera(camera, { time, delta: 0 });
    world.update({ time, delta: 0 }, camera);
    return { scene, camera, world };
}

function run(world, camera, seconds, steps = Math.max(1, Math.round(seconds * 60)), each = null) {
    const t0 = world.time;
    for (let i = 1; i <= steps; i++) {
        const sim = { time: t0 + (seconds * i) / steps, delta: seconds / steps };
        world.updateCamera(camera, sim);
        world.update(sim, camera);
        if (each) each(world);
    }
}

/** Every number the shaders are handed, flat; a name for each that is not finite. */
function notFinite(world) {
    const bad = [];
    for (const [name, node] of Object.entries(world.u)) {
        const values = [];
        if (Array.isArray(node)) node.forEach((entry) => values.push(...(entry?.value ?? entry)?.toArray?.() ?? []));
        else if (node && typeof node === 'object' && 'value' in node) {
            if (typeof node.value === 'number') values.push(node.value);
            else if (typeof node.value?.toArray === 'function') values.push(...node.value.toArray());
        }
        if (values.some((v) => !Number.isFinite(v))) bad.push(name);
    }
    return bad;
}

const bottom = (lines) => Array.from({ length: lines }, (_, i) => 19 - i);
/** The light each shape on the aura sheet has now. */
const auraNow = (world) => ({
    live: world.u.auraLive.value,
    jet: world.u.jet.value.y,
    helix: world.u.helix.value.y,
    disc: world.u.disc.value.y,
    crown: world.u.crown.value.y,
    plumes: world.u.plumeCount.value,
    wisps: world.u.wisps.value,
});
/** The largest light each shape reaches over a stretch of frames. */
function auraPeak(world, camera, seconds) {
    const peak = auraNow(world);
    run(world, camera, seconds, Math.round(seconds * 60), () => {
        const now = auraNow(world);
        for (const key of Object.keys(peak)) peak[key] = Math.max(peak[key], now[key]);
    });
    return peak;
}

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('supernova living: the clocks', () => {
    it('gives the star a slow cycle of restlessness and a slow swell, both pure functions of the clock', () => {
        let low = 1;
        let high = 0;
        for (let t = 0; t < ACTIVITY_CYCLE * 2; t += 0.5) {
            const a = starActivity(t);
            expect(a).toBeGreaterThanOrEqual(0);
            expect(a).toBeLessThanOrEqual(1);
            low = Math.min(low, a);
            high = Math.max(high, a);
            // No step: a frame moves it by a hair.
            expect(Math.abs(starActivity(t + 1 / 60) - a)).toBeLessThan(0.004);
            const s = starPulse(t);
            expect(s).toBeGreaterThanOrEqual(-1);
            expect(s).toBeLessThanOrEqual(1);
        }
        // It is quiet for a stretch of the cycle and stormy for another.
        expect(low).toBeLessThan(0.2);
        expect(high).toBeGreaterThan(0.85);
        expect(starActivity(37.5)).toBe(starActivity(37.5));
        expect(starActivity(Number.NaN)).toBe(starActivity(0));
        // The swell comes round, and rises faster than it sinks.
        expect(starPulse(3)).toBeCloseTo(starPulse(3 + PULSE_PERIOD), 9);
        expect(starPulse(PULSE_PERIOD * 0.32)).toBeCloseTo(1, 6);
        expect(starPulse(0)).toBeCloseTo(-1, 6);
        // A session opens on a star that is already stirring, not a quiet one.
        expect(starActivity(20)).toBeGreaterThan(0.4);
    });

    it('hands the star\'s restlessness to the shaders, and lets hot play stir it up', () => {
        const { camera, world } = makeWorld('High', { time: 20 });
        expect(world.u.activity.value).toBeCloseTo(starActivity(20), 6);
        // A long chain at the brink: stormier than the clock alone says.
        world.onCombo(CRITICAL_COMBO, { silent: true });
        run(world, camera, 3);
        expect(world.u.activity.value).toBeGreaterThan(starActivity(world.time) + 0.1);
        expect(world.u.activity.value).toBeLessThanOrEqual(1);
        world.dispose();
    });

    it('sizes the granules by the star\'s size on screen: a phone\'s small star has fewer, larger cells', () => {
        const wide = makeWorld('High');
        const phone = makeWorld('High', { width: 390, height: 844 });
        expect(phone.world.u.granules.value).toBeLessThan(wide.world.u.granules.value);
        for (const { world } of [wide, phone]) {
            // Never so fine that a cell is much under seven pixels.
            const radiusPx = world.anchors.radius * world.u.viewport.value.y;
            const cellPx = radiusPx / (world.u.granules.value * CELLS3_GRID);
            expect(cellPx).toBeGreaterThan(5);
            world.dispose();
        }
    });

    it('bakes a tileable volume of convection cells: walls, domes and a number for each cell', async () => {
        const { bakeCells3D } = await vi.importActual('../../src/themes/supernova/supernova-tsl.js');
        const data = bakeCells3D(11, 24);
        expect(data).toHaveLength(24 ** 3 * 4);
        expect(Buffer.compare(Buffer.from(bakeCells3D(11, 24)), Buffer.from(data))).toBe(0);
        expect(Buffer.compare(Buffer.from(bakeCells3D(12, 24)), Buffer.from(data))).not.toBe(0);
        let walls = 0;
        let hearts = 0;
        const numbers = new Set();
        for (let i = 0; i < data.length; i += 4) {
            if (data[i + 1] < 26) walls += 1; // on a wall between two cells
            if (data[i] < 40) hearts += 1; // near a cell's own point
            numbers.add(data[i + 2]);
        }
        // Lanes are a share of the volume, not all of it and not none.
        expect(walls / (data.length / 4)).toBeGreaterThan(0.08);
        expect(walls / (data.length / 4)).toBeLessThan(0.5);
        expect(hearts).toBeGreaterThan(0);
        // Many cells, each with its own number.
        expect(numbers.size).toBeGreaterThan(CELLS3_GRID ** 3 / 4);
        expect(CELLS3_SIZE / CELLS3_GRID).toBeGreaterThanOrEqual(6); // voxels a cell: enough for a lane
    });
});

describe('supernova living: the sky', () => {
    it('crosses the band of far suns where the card leaves sky: right of a wide frame, under a phone\'s card', () => {
        const wide = bandAnchor(16 / 9);
        const phone = bandAnchor(390 / 844);
        const card = fallbackLayout(1600, 900).cards[0];
        const { hud } = fallbackLayout(1600, 900);
        expect(wide.x).toBeGreaterThan(Math.max(card.x1, hud.x1));
        expect(wide.lean).toBeLessThan(0.5); // nearly upright
        const tall = fallbackLayout(390, 844).cards[0];
        expect(phone.y).toBeGreaterThan(tall.y1);
        expect(phone.lean).toBeGreaterThan(1); // lying across
        expect(bandAnchor(Number.NaN)).toEqual(bandAnchor(16 / 9));
    });

    it('turns the sky about the pole of its band: a rigid turn whose pole never moves', () => {
        const { camera, world } = makeWorld('High', { time: 5 });
        const rotAt = () => world.u.skyRot.value.clone();
        const a = rotAt();
        // A rotation: its rows are an orthonormal frame.
        const check = new THREE.Matrix3().copy(a).multiply(new THREE.Matrix3().copy(a).transpose());
        check.elements.forEach((v, i) => expect(v).toBeCloseTo(i % 4 === 0 ? 1 : 0, 6));
        expect(a.determinant()).toBeCloseTo(1, 6);
        run(world, camera, 30, 300);
        const b = rotAt();
        // The middle row is the pole: the band's line holds still in the picture...
        const pole = (m) => [m.elements[1], m.elements[4], m.elements[7]];
        pole(b).forEach((v, c) => expect(v).toBeCloseTo(pole(a)[c], 9));
        // ...while what is on the band slides along it, by the sky's own clock.
        const x = (m) => new THREE.Vector3(m.elements[0], m.elements[3], m.elements[6]);
        expect(x(a).angleTo(x(b))).toBeCloseTo((30 * TAU) / SKY_TURN, 5);
        // Where the band crosses the picture lies on it: square to the pole.
        const cam = world.restCamera();
        const anchor = bandAnchor(world.aspect);
        const at = new THREE.Vector3(anchor.x * 2 - 1, 1 - anchor.y * 2, 0.5).unproject(cam).normalize();
        expect(Math.abs(at.dot(new THREE.Vector3(...pole(b))))).toBeLessThan(1e-6);
        // A bright star's rays lie along the picture's own axes, handed over in the sky's frame.
        expect(world.u.skyRight.value.length()).toBeCloseTo(1, 6);
        expect(world.u.skyUp.value.length()).toBeCloseTo(1, 6);
        expect(world.u.skyRight.value.dot(world.u.skyUp.value)).toBeCloseTo(0, 6);
        world.dispose();
    });

    it('keeps the sky turning through a new run, and lands on the same sky after a seek', () => {
        const { camera, world } = makeWorld('High', { time: 40 });
        run(world, camera, 5);
        const turned = world.skyTurn;
        world.resetSession();
        expect(world.skyTurn).toBe(turned);
        const twin = makeWorld('High', { time: 45 });
        twin.world.u.skyRot.value.elements.forEach((v, i) => {
            expect(v).toBeCloseTo(world.u.skyRot.value.elements[i], 5);
        });
        // Reduced motion: it still turns, slower.
        const calm = makeWorld('High', { time: 40 });
        calm.world.setReducedMotion(true);
        const before = calm.world.skyTurn;
        run(calm.world, calm.camera, 5);
        expect(calm.world.skyTurn - before).toBeGreaterThan(0);
        expect(calm.world.skyTurn - before).toBeLessThan((turned - (world.skyTurn - 0)) + (5 * TAU) / SKY_TURN);
        expect(calm.world.skyTurn - before).toBeLessThan(((5 * TAU) / SKY_TURN) * 0.5);
        for (const each of [world, twin.world, calm.world]) each.dispose();
    });
});

describe('supernova living: the nebula', () => {
    it('hands the nebula the remnant\'s axis: the ring\'s own normal, a unit vector', () => {
        const { camera, world } = makeWorld('High');
        const axis = world.u.axis.value;
        expect(axis.length()).toBeCloseTo(1, 6);
        const normal = new THREE.Vector3().setFromMatrixColumn(world.parts.ring.mesh.matrix, 2);
        expect(axis.dot(normal)).toBeCloseTo(1, 6);
        // It rocks over minutes; under reduced motion it stands still.
        const before = axis.clone();
        run(world, camera, 60, 240);
        expect(world.u.axis.value.angleTo(before)).toBeGreaterThan(0.02);
        const calm = makeWorld('High');
        calm.world.setReducedMotion(true);
        run(calm.world, calm.camera, 1, 10);
        const still = calm.world.u.axis.value.clone();
        run(calm.world, calm.camera, 60, 240);
        expect(calm.world.u.axis.value.angleTo(still)).toBeLessThan(1e-6);
        world.dispose();
        calm.world.dispose();
    });

    it('rolls the look of every shell the star throws off anew, the same for the same moment', () => {
        const { camera, world } = makeWorld('High');
        const count = world.tier.shells;
        const lookOf = (w) => w.shellLooks.slice(0, count).map((look) => ({
            gen: look.gen, seed: [...look.seed], freq: look.freq, sharp: look.sharp, cover: look.cover,
        }));
        const first = lookOf(world);
        first.forEach((look) => expect(look.gen).toBe(0));
        // Far enough on that every shell has been replaced from the inside at least once.
        const later = NEBULA.cycle * 1.1;
        world.seek(later);
        world.update({ time: later, delta: 0 }, camera);
        const second = lookOf(world);
        second.forEach((look, k) => {
            expect(look.gen).toBeGreaterThan(0);
            expect(look.seed).not.toEqual(first[k].seed);
            for (const channel of look.seed) {
                expect(channel).toBeGreaterThanOrEqual(0);
                expect(channel).toBeLessThan(1);
            }
            expect(look.freq).toBeGreaterThan(0.5);
            expect(look.freq).toBeLessThan(0.9);
            expect(look.cover).toBeGreaterThan(0.35);
            expect(look.cover).toBeLessThan(0.56);
        });
        // The table carries them.
        for (let k = 0; k < count; k++) {
            const row = world.u.shellRows[k * SHELL_STRIDE + 4];
            expect([row.x, row.y, row.z]).toEqual(second[k].seed);
        }
        // Another world at the same moment has the same nebula.
        const twin = makeWorld('High', { time: later });
        expect(lookOf(twin.world)).toEqual(second);
        // A detonation hurls the shells outward: new ones are born sooner than the clock alone would.
        const calm = makeWorld('High', { time: 30 });
        const blown = makeWorld('High', { time: 30 });
        blown.world.onClear({ rows: bottom(4), lines: 4 });
        run(calm.world, calm.camera, 12, 360);
        run(blown.world, blown.camera, 12, 360);
        expect(blown.world.drift).toBeGreaterThan(calm.world.drift + 20);
        for (const each of [world, twin.world, calm.world, blown.world]) each.dispose();
    });

    it('sheds a bubble on a level change: one more shell in the new element\'s colours, for a while', () => {
        const { camera, world } = makeWorld('High');
        const standing = world.tier.shells;
        expect(world.u.shellCount.value).toBe(standing);
        world.levelUp(2);
        run(world, camera, 1.5);
        expect(world.u.shellCount.value).toBe(standing + 1);
        const o = standing * SHELL_STRIDE;
        const rows = world.u.shellRows;
        const first = { radius: rows[o].x, gain: rows[o + 1].w, kind: rows[o + 3].w };
        expect(first.kind).toBe(0); // a shell of filaments, not a ring
        expect(first.gain).toBeGreaterThan(0);
        run(world, camera, 3);
        // It swells and thins as it joins the standing shells.
        expect(world.u.shellRows[o].x).toBeGreaterThan(first.radius + 1);
        run(world, camera, 12, 240);
        expect(world.u.shellCount.value).toBe(standing);
        // Told silently (a capture resting on a level), nothing is shed.
        world.levelUp(3, { silent: true });
        run(world, camera, 1);
        expect(world.u.shellCount.value).toBe(standing);
        world.dispose();
    });
});

describe('supernova living: an event has a shape of its own', () => {
    it('has no aura at rest: the sheet has no size, and nothing on it is lit', () => {
        const { camera, world } = makeWorld('High', { time: 10 });
        run(world, camera, 2);
        expect(auraNow(world)).toEqual({
            live: 0, jet: 0, helix: 0, disc: 0, crown: 0, plumes: 0, wisps: 0,
        });
        // A lock, and a clear of one or two lines, stay off it too: streams and fronts are theirs.
        world.onLock({ u: 0.4, rows: [19], color: '#ffaa00' });
        world.onClear({ rows: bottom(2), lines: 2 });
        const peak = auraPeak(world, camera, 2);
        expect(peak).toEqual({
            live: 0, jet: 0, helix: 0, disc: 0, crown: 0, plumes: 0, wisps: 0,
        });
        world.dispose();
    });

    it('throws a tongue of plasma off the limb for a hard drop, and none for a lock', () => {
        const { camera, world } = makeWorld('High');
        world.onLock({ u: 0.4, rows: [12], color: '#ff0033' });
        expect(auraPeak(world, camera, 1.5).plumes).toBe(0);
        world.onLock({
            u: 0.4, rows: [12], color: '#ff0033', hardDrop: true,
        });
        // Not before the stream lands...
        run(world, camera, STREAM_FLIGHT * 0.5);
        expect(world.u.plumeCount.value).toBe(0);
        // ...then one plume (the two side streams raise none), a unit direction on the sheet.
        const peak = auraPeak(world, camera, 0.8);
        expect(peak.plumes).toBe(1);
        expect(peak.live).toBe(1);
        expect(peak.jet + peak.helix + peak.disc + peak.crown).toBe(0);
        const row = world.aura.plumes.find((plume) => plume.strength > 0);
        expect(Math.hypot(...row.dir)).toBeCloseTo(1, 5);
        expect(row.rgb).toEqual(expect.arrayContaining([expect.any(Number)]));
        // It is gone in a few seconds and the sheet folds away.
        run(world, camera, 8, 240);
        expect(auraNow(world).live).toBe(0);
        // A drop a second never needs more rows than there are.
        for (let i = 0; i < 12; i++) {
            world.onLock({
                u: 0.1 + i * 0.07, rows: [15], color: '#00ff88', hardDrop: true,
            });
            run(world, camera, 0.35);
            expect(world.u.plumeCount.value).toBeLessThanOrEqual(AURA_PLUMES);
        }
        expect(notFinite(world)).toEqual([]);
        world.dispose();
    });

    it('breaks out along the axis for three lines: two beams, further the deeper a cascade runs', () => {
        const { camera, world } = makeWorld('High');
        world.onClear({ rows: bottom(3), lines: 3 });
        run(world, camera, ROW_FLIGHT * 0.5);
        expect(auraNow(world).jet).toBe(0); // the rows have not arrived yet
        const peak = auraPeak(world, camera, 1);
        expect(peak.jet).toBeGreaterThan(0.3);
        expect(peak.helix + peak.disc + peak.crown + peak.plumes).toBe(0);
        const { reach } = world.aura.jet;
        // The axis's shadow on the sheet is a unit direction.
        const shadow = world.u.auraAxis.value;
        expect(Math.hypot(shadow.x, shadow.y)).toBeCloseTo(1, 6);
        expect(shadow.z).toBeGreaterThan(0.05);
        expect(shadow.z).toBeLessThanOrEqual(1);
        run(world, camera, 10, 300);
        expect(auraNow(world).jet).toBe(0);
        world.onClear({ rows: bottom(3), lines: 3, cascade: 4 });
        run(world, camera, 0.6);
        expect(world.aura.jet.reach).toBeGreaterThan(reach);
        world.dispose();
    });

    it('winds a corkscrew for a twist, a short one for a twist that clears nothing', () => {
        const { camera, world } = makeWorld('High');
        world.onSpin();
        const small = auraPeak(world, camera, 0.6);
        expect(small.helix).toBeGreaterThan(0.1);
        expect(small.jet + small.disc + small.crown + small.plumes).toBe(0);
        const short = world.aura.helix.reach;
        run(world, camera, 8, 240);
        expect(auraNow(world).helix).toBe(0);
        world.onClear({ rows: bottom(2), lines: 2, twist: true });
        const big = auraPeak(world, camera, 1.2);
        expect(big.helix).toBeGreaterThan(small.helix * 1.5);
        expect(world.aura.helix.reach).toBeGreaterThan(short * 1.5);
        // In the rim's colour.
        const { rim } = world._palette;
        expect(world.u.helixCol.value.toArray()).toEqual([rim[0], rim[1], rim[2]]);
        world.dispose();
    });

    it('sends a wave out in the ring\'s own plane for a back-to-back', () => {
        const { camera, world } = makeWorld('High');
        world.onClear({ rows: bottom(2), lines: 2, b2b: true });
        const peak = auraPeak(world, camera, 1.5);
        expect(peak.disc).toBeGreaterThan(0.3);
        expect(peak.jet + peak.helix + peak.crown + peak.plumes).toBe(0);
        // It starts at the ring and runs outward.
        expect(world.aura.disc.reach).toBeGreaterThan(RING.radius);
        // A second one in the run burns brighter.
        const first = world.aura.disc.strength;
        run(world, camera, 9, 270);
        world.onClear({ rows: bottom(2), lines: 2, b2b: true });
        run(world, camera, 0.6);
        expect(world.aura.disc.strength).toBeGreaterThan(first);
        world.dispose();
    });

    it('crowns a perfect clear with rays, held back under Reduce flashing (ADR-0021)', () => {
        const crownPeak = (reduce) => {
            vi.stubGlobal('window', { settings: { reduceFlashing: reduce } });
            const { camera, world } = makeWorld('High');
            world.onCrown();
            const peak = auraPeak(world, camera, 2.5);
            world.dispose();
            return peak;
        };
        const full = crownPeak(false);
        const held = crownPeak(true);
        expect(full.crown).toBeGreaterThan(0.4);
        expect(held.crown).toBeGreaterThan(0);
        expect(held.crown).toBeLessThan(full.crown * 0.6);
    });

    it('gives the flash its beams and the pulsar its ripples, and folds the sheet away after', () => {
        const { camera, world } = makeWorld('High');
        world.onClear({ rows: bottom(4), lines: 4 });
        const early = auraPeak(world, camera, 1.5);
        expect(early.jet).toBeGreaterThan(0.8);
        const later = auraPeak(world, camera, 4);
        expect(later.wisps).toBeGreaterThan(0.2);
        run(world, camera, 30, 600);
        expect(auraNow(world)).toEqual({
            live: 0, jet: 0, helix: 0, disc: 0, crown: 0, plumes: 0, wisps: 0,
        });
        expect(notFinite(world)).toEqual([]);
        world.dispose();
    });

    it('never cuts a shape in flight for a weaker one of its kind', () => {
        const { camera, world } = makeWorld('High');
        world.onClear({ rows: bottom(2), lines: 2, twist: true });
        run(world, camera, 0.5);
        const { birth } = world.aura.helix;
        const before = world.u.helix.value.y;
        world.onSpin(); // a small turn while the big one is still unwinding
        run(world, camera, 1 / 60, 1);
        expect(world.aura.helix.birth).toBe(birth);
        expect(world.u.helix.value.y).toBeGreaterThan(before * 0.9);
        world.dispose();
    });
});

describe('supernova living: the star\'s own eruptions', () => {
    it('erupts on its own beat when it is restless, and skips its turn when it is quiet', () => {
        // The first beats: find one that falls in a stormy stretch and one in a quiet one.
        const beats = Array.from({ length: 12 }, (_, i) => (i + 1) * ERUPT_BEAT);
        const stormy = beats.find((t) => starActivity(t) > 0.6);
        const quiet = beats.find((t) => starActivity(t) < 0.25);
        expect(stormy).toBeGreaterThan(0);
        expect(quiet).toBeGreaterThan(0);
        const fired = (beat) => {
            const { camera, world } = makeWorld('High', { time: beat - 2 });
            const peak = auraPeak(world, camera, 4);
            const out = { plumes: peak.plumes, dir: world.aura.plumes.map((plume) => [...plume.dir]) };
            world.dispose();
            return out;
        };
        expect(fired(stormy).plumes).toBe(1);
        expect(fired(quiet).plumes).toBe(0);
        // The same eruption every time the clock comes to it.
        expect(fired(stormy).dir).toEqual(fired(stormy).dir);
        // A capture that seeks into one finds it in the air.
        const { camera, world } = makeWorld('High', { time: stormy + 1.5 });
        run(world, camera, 1 / 60, 1);
        expect(world.u.plumeCount.value).toBe(1);
        world.dispose();
    });
});

describe('supernova living: a run that ends', () => {
    it('lets the star go dark, and kindles a new one by itself', () => {
        const { camera, world } = makeWorld('High');
        const radius = world.getState().starRadius;
        expect(world.hole()).toBe(0);
        expect(world.u.hole.value).toBe(0);
        world.onGameOver();
        run(world, camera, HOLE_FALL + 0.5);
        // A dark star: small, black, no corona to speak of, the ring lit round it.
        expect(world.hole()).toBeCloseTo(1, 3);
        expect(world.u.hole.value).toBeCloseTo(1, 3);
        expect(world.getState().starRadius).toBeLessThan(radius * 0.5);
        expect(world.u.glare.value.x).toBeLessThan(0.01);
        expect(world.getPostState().fall).toBeGreaterThan(0.05); // it bends the picture toward it
        const { counts } = world.getState();
        // It raises no prominences of its own while it is dark.
        run(world, camera, HOLE_HOLD - 1.5);
        expect(world.getState().counts).toEqual(counts);
        expect(world.hole()).toBeGreaterThan(0.9);
        // It comes back by itself (a menu must not sit over a dead sky).
        run(world, camera, HOLE_BACK + 1.5);
        expect(world.hole()).toBe(0);
        expect(world.getState().starRadius).toBeGreaterThan(radius * 0.9);
        expect(world.getPostState().fall).toBe(0);
        expect(notFinite(world)).toEqual([]);
        world.dispose();
    });

    it('keeps the dark star through the menu\'s reset, and gives way to a new run at once', () => {
        const { camera, world } = makeWorld('High');
        world.onGameOver();
        run(world, camera, HOLE_FALL + 1);
        world.resetSession(); // the mode stops: the menu
        run(world, camera, 0.5);
        expect(world.hole()).toBeGreaterThan(0.9);
        // Told twice, it does not start falling again.
        const { at } = world.over;
        world.onGameOver();
        expect(world.over.at).toBe(at);
        world.onSessionStart();
        run(world, camera, HOLE_BACK + 0.2);
        expect(world.hole()).toBe(0);
        // A new run with no dark star to give way: nothing happens.
        const { until } = world.over;
        world.onSessionStart();
        expect(world.over.until).toBe(until);
        // A seek is a clean slate.
        world.onGameOver();
        world.seek(50);
        expect(world.hole()).toBe(0);
        world.dispose();
    });

    it('does not go off for a run that ends with the star at the brink: its fire fails instead', () => {
        const { camera, world } = makeWorld('High');
        for (let n = 1; n <= CRITICAL_COMBO; n++) world.onCombo(n);
        run(world, camera, 3);
        expect(world.getState().critical).toBeGreaterThan(0.8);
        // As the theme ends a run: the chain is let go first (which begins a collapse), then the
        // world is told the run is over.
        world.onCombo(0);
        expect(world.nova.next).not.toBe(Infinity);
        world.onGameOver();
        expect(world.nova.next).toBe(Infinity);
        run(world, camera, 6);
        expect(world.getState().counts.novas).toBe(0);
        expect(world.hole()).toBeGreaterThan(0.9);
        world.dispose();
    });
});
