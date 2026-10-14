/**
 * Kaleidosonic — the world's choreography, run without a renderer: a THREE.Scene, a camera, and the
 * world driven in fixed steps (camera, then events, then the frame, as the theme does).
 *
 * The look is still being tuned, so the beats are held as relations: a hard drop strikes harder
 * than a soft lock, a stage of the kaleidoscope opens only once the chain has reached it, the dive
 * lands exactly one lattice period on, the core hangs in open air beside the card. Every number is
 * read from the core, the quality tiers and the uniforms the world writes.
 */
import {
    describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { readFileSync } from 'node:fs';
import {
    KALEIDOSONIC_PARTS, KaleidosonicWorld, PHASE_WRAP, REST_RIG, fovForAspect,
} from '../../src/themes/kaleidosonic/kaleidosonic-world.js';
import {
    DIVE_LENGTH, EYE, FOLD_AT, MOODS, MOOD_COLOURS, NOTES, PIECE_CODE, PIECE_COLORS, PIECE_ORDER, REFOLDS, TAU, TEMPLE,
    TIMING, hexToLinear, marchTemple, moodMix, templeDistance,
} from '../../src/themes/kaleidosonic/kaleidosonic-core.js';
import {
    HARMONICS, HARMONIC_ROWS, STRIKES, STRIKE_ROWS,
} from '../../src/themes/kaleidosonic/kaleidosonic-tsl.js';
import { tierFor } from '../../src/themes/kaleidosonic/kaleidosonic-quality.js';
import { cardUnion, fallbackLayout, outsideKeepOut } from '../../src/themes/kaleidosonic/kaleidosonic-composition.js';
import { applyCameraBreath } from '../../src/themes/shared/camera-breath.js';

vi.setConfig({ testTimeout: 30_000 });

const START = 10;
/** What KaleidosonicTheme calls (the theme test's list), and the rest pose the playground uses. */
const WORLD_METHODS = [
    'build', 'bindCamera', 'showOnlyParts', 'setViewport', 'setLayout', 'setReducedMotion', 'seek', 'resetSession',
    'updateCamera', 'onLock', 'onClear', 'onCombo', 'levelUp', 'update', 'prerender', 'getPostState', 'getState',
    'dispose', 'onB2B', 'onGameOver', 'onSessionStart', 'exportSessionState', 'importSessionState', 'restCamera',
];
/** Frames of [aspect, buffer width, buffer height] the composition is checked on. */
const FRAMES = {
    '16:9': [16 / 9, 1920, 1080],
    '21:9': [21 / 9, 2520, 1080],
    '4:3': [4 / 3, 1440, 1080],
    'phone 9:19.5': [9 / 19.5, 900, 1950],
};
const P = TEMPLE.period;

const sim = (time, delta, pointerX = 0, pointerY = 0) => ({
    time, delta, pointerX, pointerY,
});

function makeWorld(quality = 'Minimal', frame = FRAMES['16:9']) {
    const [aspect, width, height] = frame;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, REST_RIG.near, REST_RIG.far);
    const world = new KaleidosonicWorld({ scene, quality, capture: true });
    const built = world.build();
    world.bindCamera(camera);
    world.setViewport(width, height, aspect);
    return {
        scene, camera, world, built,
    };
}

/** A fresh world for one test, disposed after it. */
function withWorld(fn, quality, frame) {
    const w = makeWorld(quality, frame);
    try {
        return fn(w);
    } finally {
        w.world.dispose();
    }
}

/** Seek a world to `time` and draw that frame, as a capture does. */
function begin({ world, camera }, time = START) {
    world.seek(time);
    world.updateCamera(camera, sim(time, 0));
    world.update(sim(time, 0), camera);
}

/** The eye's Euler z with no T-spin roll at the world's time: its level pose under the shared camera breath. */
function levelRoll({ world }) {
    const level = new THREE.PerspectiveCamera();
    world.pose(level, world.time);
    applyCameraBreath(level, world.time);
    return level.rotation.z;
}

/** Run the world from its current time to `to` in steps of dt, as the theme's frames do. */
function stepTo({ world, camera }, to, dt = 1 / 30, each = null) {
    const from = world.time;
    const steps = Math.max(1, Math.round((to - from) / dt));
    const h = (to - from) / steps;
    for (let i = 1; i <= steps; i += 1) {
        const time = from + i * h;
        world.updateCamera(camera, sim(time, 0));
        world.update(sim(time, h), camera);
        each?.(time);
    }
}

const objectCount = (root) => {
    let n = 0;
    root.traverse(() => { n += 1; });
    return n;
};

/** The strike rows the shader reads this frame (only the live ones). */
function strikeRows(world) {
    const rows = world.u.tables.strikes;
    // The world writes them newest first; read them oldest first (the order they struck in).
    return Array.from({ length: world.u.counts.value.x }, (_, k) => {
        const [A, B, C] = rows.slice(k * STRIKE_ROWS, k * STRIKE_ROWS + 3);
        return {
            at: [A.x, A.y, A.z], age: A.w, rgb: [B.x, B.y, B.z], strength: B.w, wavelength: C.x, speed: C.y, hard: C.z,
        };
    }).reverse().sort((a, b) => b.age - a.age);
}

/** The harmonic rows the shader reads this frame (only the live ones). */
function harmonicRows(world) {
    const rows = world.u.tables.harmonics;
    return Array.from({ length: world.u.counts.value.y }, (_, k) => {
        const [A, B] = rows.slice(k * HARMONIC_ROWS, k * HARMONIC_ROWS + 2);
        return {
            reach: A.x, age: A.y, mode: A.z, strength: A.w, rgb: [B.x, B.y, B.z],
        };
    });
}

/** Ten cells of one piece code (or a list of codes) per row. */
const rowsOf = (lines, code) => Array.from(
    { length: lines * 10 },
    (_, i) => (Array.isArray(code) ? code[i % code.length] : code),
);

/** Where a world-space point lands on the rest camera's screen (fractions, y down). */
function onScreen(world, point) {
    world.restRay(0.5, 0.5); // poses the rest camera
    const v = new THREE.Vector3(...point).project(world.restCam);
    return { x: (v.x + 1) / 2, y: (1 - v.y) / 2 };
}

/** A session with something of everything in it, from the world's current time. */
function play(w) {
    const { world } = w;
    const t = world.time;
    world.onLock({
        u: 0.2, rows: [18], color: PIECE_COLORS[0], shape: 'I',
    });
    world.onClear({ lines: 2, combo: 1, rowCodes: rowsOf(2, PIECE_CODE.I) });
    world.onCombo(1);
    stepTo(w, t + 1);
    world.levelUp(2);
    for (let n = 2; n <= 6; n++) {
        world.onLock({
            u: n / 7,
            rows: [19],
            color: PIECE_COLORS[n % 7],
            shape: PIECE_ORDER[n % 7],
            hardDrop: n === 3,
            distance: 12,
        });
        world.onClear({
            lines: 1, combo: n, tspin: n === 4, rowCodes: rowsOf(1, n % 7),
        });
        world.onCombo(n);
        stepTo(w, world.time + 0.8);
    }
    world.onLock({
        u: 0.7, rows: [19, 18, 17, 16], color: PIECE_COLORS[3], shape: 'L',
    });
    world.onClear({ lines: 4, combo: 1, rowCodes: rowsOf(4, [3, 3, 5]) });
    world.onCombo(0);
    world.onB2B(2);
    stepTo(w, world.time + 1.2);
    world.onClear({ lines: 1, perfect: true });
    stepTo(w, world.time + 1.5);
}

describe('KaleidosonicWorld build', () => {
    it.each(['Minimal', 'High'])('builds every named part at %s into one root, once, and returns itself', (quality) => {
        withWorld(({ world, scene, built }) => {
            expect(built).toBe(world);
            expect(world.quality).toBe(quality);
            expect(world.tier).toBe(tierFor(quality));
            expect(Object.keys(world.parts).sort()).toEqual([...KALEIDOSONIC_PARTS].sort());
            expect(world.root.parent).toBe(scene);
            for (const name of KALEIDOSONIC_PARTS) {
                const part = world.parts[name];
                for (const mesh of part.meshes || [part.mesh]) expect(mesh.parent, name).toBe(world.root);
            }
            // Node materials only (both renderer backends), and the march covers the frame.
            const plain = [];
            world.root.traverse((object) => {
                if (object.material && !object.material.isNodeMaterial) plain.push(object.name || object.type);
            });
            expect(plain).toEqual([]);
            expect(world.parts.temple.mesh.frustumCulled).toBe(false);
            for (const method of WORLD_METHODS) expect(world[method], method).toBeTypeOf('function');
            expect(KaleidosonicWorld.prepareSync(quality)).toMatchObject({ quality });
            // Building twice builds nothing more.
            const children = world.root.children.length;
            const objects = objectCount(world.root);
            expect(world.build()).toBe(world);
            expect(world.root.children).toHaveLength(children);
            expect(objectCount(world.root)).toBe(objects);
            expect(scene.children.filter((c) => c === world.root)).toHaveLength(1);
        }, quality);
    });

    it.each(['Minimal', 'High'])('creates nothing at event time at %s: the same scene after a session', (quality) => {
        withWorld((w) => {
            const { world, scene } = w;
            begin(w);
            const count = () => ({
                scene: scene.children.length, root: world.root.children.length, objects: objectCount(world.root),
            });
            const before = count();
            play(w);
            world.onGameOver();
            stepTo(w, world.time + TIMING.sink);
            world.onSessionStart();
            world.resetSession();
            stepTo(w, world.time + 5, 1 / 15);
            expect(count()).toEqual(before);
            expect(world.u.tables.strikes).toHaveLength(STRIKES * STRIKE_ROWS);
            expect(world.u.tables.harmonics).toHaveLength(HARMONICS * HARMONIC_ROWS);
        }, quality);
    });

    it('shows only the parts a capture asks for, and all of them again', () => {
        withWorld(({ world }) => {
            world.showOnlyParts([]);
            expect(world.parts.temple.mesh.visible).toBe(false);
            world.showOnlyParts(KALEIDOSONIC_PARTS);
            expect(world.parts.temple.mesh.visible).toBe(true);
        });
    });

    it('hands the post one object every frame, with finite values and the mood\'s own flash', () => {
        withWorld((w) => {
            const { world } = w;
            begin(w);
            const post = world.getPostState();
            world.onClear({ lines: 4, combo: 1 });
            for (let k = 1; k <= 20; k++) {
                stepTo(w, START + k / 10);
                expect(world.getPostState()).toBe(post);
            }
            for (const key of ['exposure', 'bloomBoost', 'fringe', 'flash', 'saturation']) {
                expect(Number.isFinite(post[key]), key).toBe(true);
            }
            expect(post.exposure).toBeGreaterThan(0);
            // The flash is the core's colour at full strength: the mood's heart, normalised.
            const { heart } = MOODS[moodMix(world.moodPlace()).from];
            expect(Math.max(...post.flashColour)).toBeCloseTo(1, 12);
            post.flashColour.forEach((v, i) => expect(v).toBeCloseTo(heart[i] / Math.max(...heart), 12));
        });
    });
});

describe('KaleidosonicWorld: the eye', () => {
    it('rests at the eye, looking down its diagonal, on the lens for its aspect', () => {
        withWorld(({ world, camera }) => {
            world.restCamera(camera);
            expect(camera.position.toArray()).toEqual([EYE.x, EYE.y, EYE.z]);
            expect(camera.fov).toBeCloseTo(fovForAspect(16 / 9), 12);
            const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
            expect(forward.dot(new THREE.Vector3(...EYE.dir))).toBeGreaterThan(0.9);
            // It stands in open air.
            expect(templeDistance(EYE.x, EYE.y, EYE.z)).toBeGreaterThan(0.05);
        });
    });

    it('drifts with the clock and leans with the pointer; reduced motion takes the pointer away', () => {
        withWorld((w) => {
            const { world, camera } = w;
            begin(w);
            const at = (t, px = 0) => {
                world.updateCamera(camera, sim(t, 0, px));
                return { q: camera.quaternion.clone(), p: camera.position.clone() };
            };
            expect(at(20).q.angleTo(at(37).q)).toBeGreaterThan(1e-4); // the lens breathes
            expect(at(20).p.distanceTo(at(20, 1).p)).toBeGreaterThan(1e-3); // the pointer leans it
            world.setReducedMotion(true);
            expect(at(20).p.distanceTo(at(20, 1).p)).toBeLessThan(1e-9);
            expect(at(20).q.angleTo(at(20, 1).q)).toBeLessThan(1e-6); // angleTo's own precision
            world.setReducedMotion(false);
        });
    });
});

describe('KaleidosonicWorld: locks strike notes', () => {
    it('fills a strike row in the piece\'s colour and at its note, and lets it expire', () => {
        withWorld((w) => {
            const { world } = w;
            begin(w);
            expect(world.u.counts.value.x).toBe(0);
            world.onLock({
                u: 0.2, rows: [14], color: PIECE_COLORS[PIECE_CODE.T], shape: 'T',
            });
            stepTo(w, START + 0.1);
            expect(world.u.counts.value.x).toBe(1);
            world.onLock({
                u: 0.8, rows: [16], color: PIECE_COLORS[PIECE_CODE.O], shape: 'O',
            });
            stepTo(w, START + 0.2);
            expect(world.u.counts.value.x).toBe(2);
            const [first, second] = strikeRows(world);
            expect(first.age).toBeCloseTo(0.2, 9);
            expect(second.age).toBeCloseTo(0.1, 9);
            first.rgb.forEach((v, i) => expect(v).toBeCloseTo(hexToLinear(PIECE_COLORS[PIECE_CODE.T])[i], 9));
            second.rgb.forEach((v, i) => expect(v).toBeCloseTo(hexToLinear(PIECE_COLORS[PIECE_CODE.O])[i], 9));
            expect(first.strength).toBeGreaterThan(0);
            // Each at its own pitch: the T rings higher (shorter ripples) than the O.
            expect(first.wavelength).toBe(NOTES[PIECE_CODE.T].wavelength);
            expect(second.wavelength).toBe(NOTES[PIECE_CODE.O].wavelength);
            expect(first.wavelength).toBeLessThan(second.wavelength);
            first.at.forEach((v) => expect(Number.isFinite(v)).toBe(true));
            expect(world.counts.locks).toBe(2);
            // Gone once its wavefront has rung out, the newer one a little after the older.
            stepTo(w, START + TIMING.strike + 0.05);
            expect(world.u.counts.value.x).toBe(1);
            stepTo(w, START + TIMING.strike + 0.15);
            expect(world.u.counts.value.x).toBe(0);
        });
    });

    it('strikes a hard drop harder than a soft lock, and kicks the eye', () => {
        withWorld((w) => {
            const { world, camera } = w;
            begin(w);
            stepTo(w, START + 0.1);
            const still = camera.position.clone();
            begin(w);
            world.onLock({
                u: 0.3, rows: [12], color: PIECE_COLORS[2], shape: 'Z',
            });
            world.onLock({
                u: 0.3, rows: [12], color: PIECE_COLORS[2], shape: 'Z', hardDrop: true, distance: 16,
            });
            stepTo(w, START + 0.1);
            const [soft, hard] = strikeRows(world);
            expect(hard.strength).toBeGreaterThan(soft.strength);
            expect([soft.hard, hard.hard]).toEqual([0, 1]);
            expect(world.counts).toMatchObject({ locks: 2, drops: 1 });
            expect(camera.position.distanceTo(still)).toBeGreaterThan(1e-3);
            // Under reduced motion the strike is as hard, and the eye stays where it was.
            begin(w);
            world.setReducedMotion(true);
            world.onLock({
                u: 0.3, rows: [12], color: PIECE_COLORS[2], shape: 'Z', hardDrop: true, distance: 16,
            });
            stepTo(w, START + 0.1);
            expect(strikeRows(world)[0].strength).toBe(hard.strength);
            const calm = camera.position.clone();
            world.setReducedMotion(false);
            begin(w);
            world.setReducedMotion(true);
            stepTo(w, START + 0.1);
            expect(camera.position.distanceTo(calm)).toBeLessThan(1e-9);
            world.setReducedMotion(false);
        });
    });

    it('strikes from the temple beside the card: a left column left of it, a right column right of it', () => {
        withWorld((w) => {
            const { world } = w;
            begin(w);
            const card = cardUnion(world.layout);
            world.onLock({
                u: 0.05, rows: [10], color: PIECE_COLORS[0], shape: 'I',
            });
            world.onLock({
                u: 0.95, rows: [10], color: PIECE_COLORS[1], shape: 'T',
            });
            stepTo(w, START + 1 / 30);
            const [left, right] = strikeRows(world).map((row) => onScreen(world, row.at));
            expect(left.x).toBeLessThan(card.x0);
            expect(right.x).toBeGreaterThan(card.x1);
            // Each rings from where its column points (the rest eye's ray through the site).
            const site = world.sitePoint(0.05, 10);
            expect(left.x).toBeCloseTo(site.x, 6);
            expect(left.y).toBeCloseTo(site.y, 6);
        });
    });

    it('rings round its strike slots, the newest replacing the oldest', () => {
        withWorld((w) => {
            const { world } = w;
            begin(w);
            for (let k = 0; k <= STRIKES; k++) {
                world.onLock({
                    u: k % 2 ? 0.8 : 0.2, rows: [12], color: PIECE_COLORS[k % 7], shape: PIECE_ORDER[k % 7],
                });
                stepTo(w, world.time + 0.05);
            }
            expect(world.strikes).toHaveLength(STRIKES);
            // The thirteenth landed in the first slot.
            expect(world.strikes[0].birth).toBeCloseTo(START + STRIKES * 0.05, 9);
            expect(world.strikes[1].birth).toBeCloseTo(START + 0.05, 9);
            // No more rows than the tier draws.
            expect(world.u.counts.value.x).toBeLessThanOrEqual(world.tier.strikes);
            // A seek forgets every strike.
            begin(w);
            expect(world.u.counts.value.x).toBe(0);
        });
    });

    // A tier that draws fewer strikes than are ringing (Minimal 6, Low 8, Medium 10) keeps the
    // NEWEST: in fast play the lock that just landed always shows its wavefront.
    it('draws the newest strikes when more are ringing than the tier draws', () => {
        withWorld((w) => {
            const { world } = w;
            begin(w);
            const cap = world.tier.strikes;
            expect(cap).toBeLessThan(STRIKES);
            for (let k = 0; k < cap + 2; k++) {
                world.onLock({
                    u: 0.2 + 0.05 * k, rows: [14], color: PIECE_COLORS[k % 7], shape: PIECE_ORDER[k % 7],
                });
                stepTo(w, world.time + 0.2);
            }
            const ages = strikeRows(world).map((row) => row.age);
            expect(ages).toHaveLength(cap);
            // The lock that just landed (0.2 s ago) rings.
            expect(Math.min(...ages)).toBeCloseTo(0.2, 6);
        }, 'Minimal');
    });
});

describe('KaleidosonicWorld: clears sound harmonics and refold the temple', () => {
    it('writes a harmonic in the colour the cleared rows were made of, more lines stronger', () => {
        withWorld((w) => {
            const { world } = w;
            begin(w);
            world.onClear({ lines: 1, combo: 1, rowCodes: rowsOf(1, [PIECE_CODE.Z, PIECE_CODE.Z, PIECE_CODE.T]) });
            world.onClear({ lines: 3, combo: 1, rowCodes: rowsOf(3, PIECE_CODE.J) });
            stepTo(w, START + 0.2);
            const [one, three] = harmonicRows(world);
            expect(world.u.counts.value.y).toBe(2);
            expect([one.mode, three.mode]).toEqual([1, 3]);
            expect(three.strength).toBeGreaterThan(one.strength);
            one.rgb.forEach((v, i) => expect(v).toBeCloseTo(hexToLinear(PIECE_COLORS[PIECE_CODE.Z])[i], 9));
            three.rgb.forEach((v, i) => expect(v).toBeCloseTo(hexToLinear(PIECE_COLORS[PIECE_CODE.J])[i], 9));
            // The shell runs outward with its age.
            const { reach } = one;
            stepTo(w, START + 0.6);
            expect(harmonicRows(world)[0].reach).toBeGreaterThan(reach);
            // A clear of garbage alone (or of nothing known) sounds in the mood's own colour.
            world.onClear({ lines: 1, combo: 1, rowCodes: rowsOf(1, PIECE_CODE.GARBAGE) });
            world.onClear({ lines: 1, combo: 1 });
            stepTo(w, START + 0.7);
            const { neonA } = MOODS[moodMix(world.moodPlace()).from];
            const [, , garbage, none] = harmonicRows(world);
            garbage.rgb.forEach((v, i) => expect(v).toBeCloseTo(neonA[i], 12));
            none.rgb.forEach((v, i) => expect(v).toBeCloseTo(neonA[i], 12));
            expect(world.counts.clears).toBe(4);
            // Rung out after its time.
            stepTo(w, START + 0.7 + TIMING.harmonic + 0.1);
            expect(world.u.counts.value.y).toBe(0);
        });
    });

    it('refolds the temple one step a clear (two for a long chain), springing to each shape in turn', () => {
        withWorld((w) => {
            const { world } = w;
            begin(w);
            expect(world.u.shape.value.x).toBe(REFOLDS[0]);
            world.onClear({ lines: 1, combo: 1 });
            expect(world.refoldIndex).toBe(1);
            stepTo(w, START + TIMING.refold * 3, 1 / 30, () => {
                expect(world.u.shape.value.x).toBeGreaterThanOrEqual(TEMPLE.sMin);
                expect(world.u.shape.value.x).toBeLessThanOrEqual(TEMPLE.sMax);
            });
            expect(world.u.shape.value.x).toBeCloseTo(REFOLDS[1], 3);
            world.onClear({ lines: 1, combo: 5 });
            expect(world.refoldIndex).toBe(3);
            stepTo(w, world.time + TIMING.refold * 3);
            expect(world.u.shape.value.x).toBeCloseTo(REFOLDS[3], 3);
            // The walk loops round the refolds.
            for (let i = 0; i < REFOLDS.length - 3; i++) world.onClear({ lines: 1, combo: 1 });
            stepTo(w, world.time + TIMING.refold * 3);
            expect(world.refoldIndex % REFOLDS.length).toBe(0);
            expect(world.u.shape.value.x).toBeCloseTo(REFOLDS[0], 3);
            // Its detail is the tier's at most, whatever the trance asks.
            expect(world.u.shape.value.y).toBeLessThanOrEqual(world.tier.folds);
        });
    });

    it('dives one lattice period down the open lane on four lines, and lands seamlessly', () => {
        withWorld((w) => {
            const { world, camera } = w;
            begin(w);
            world.onClear({ lines: 3, combo: 1 });
            stepTo(w, START + 0.5);
            expect(world.counts.dives).toBe(0);
            expect(world.diveTravel).toBe(0);
            const at = world.time;
            world.onClear({ lines: 4, combo: 1 });
            expect(world.counts).toMatchObject({ quads: 1, dives: 1 });
            let travel = 0;
            const clearance = [];
            stepTo(w, at + TIMING.dive * 0.999, 1 / 120, () => {
                expect(world.diveTravel).toBeGreaterThanOrEqual(travel);
                travel = world.diveTravel;
                const dive = world.diveOffset();
                expect(world.u.dive.value.toArray()).toEqual(dive);
                // Along the lane, and the eye never flies through stone.
                expect(dive[1]).toBe(0);
                expect(dive[0]).toBeCloseTo(dive[2], 12);
                const { x, y, z } = camera.position;
                const s = world.sSpring.x;
                clearance.push(templeDistance(x + dive[0], y + dive[1], z + dive[2], s, TEMPLE.detailDeep));
            });
            expect(Math.min(...clearance)).toBeGreaterThan(0.05);
            // Just before landing it is a whole number of periods on, the lattice the same as at the start.
            const landing = world.diveOffset();
            expect(world.diveTravel).toBeCloseTo(DIVE_LENGTH, 4);
            for (const axis of [0, 2]) {
                expect(Math.abs(landing[axis] / P - Math.round(landing[axis] / P)), `axis ${axis}`).toBeLessThan(1e-4);
                expect(Math.round(landing[axis] / P)).not.toBe(0);
            }
            const [x, y, z] = [EYE.x, EYE.y, EYE.z];
            const exact = EYE.dir.map((v) => Math.round((v * DIVE_LENGTH) / P) * P);
            expect(templeDistance(x + exact[0], y + exact[1], z + exact[2])).toBeCloseTo(templeDistance(x, y, z), 9);
            // Then the flight is over and the offset is back to none.
            stepTo(w, at + TIMING.dive + 0.1);
            expect(world.diveTravel).toBe(0);
            expect(world.u.dive.value.toArray().map(Math.abs)).toEqual([0, 0, 0]);
        });
    });

    it('queues a four-line clear made during a dive and flies it after', () => {
        withWorld((w) => {
            const { world } = w;
            begin(w);
            world.onClear({ lines: 4, combo: 1 });
            stepTo(w, START + TIMING.dive * 0.5);
            world.onClear({ lines: 4, combo: 1 });
            expect(world.counts.dives).toBe(1);
            expect(world.diveQueue).toBe(1);
            stepTo(w, START + TIMING.dive + 0.2);
            expect(world.counts.dives).toBe(2);
            expect(world.diveQueue).toBe(0);
            expect(world.diveTravel).toBeGreaterThan(0);
            stepTo(w, START + 2 * TIMING.dive + 0.3);
            expect(world.diveTravel).toBe(0);
        });
    });
});

describe('KaleidosonicWorld: the chain folds the lens', () => {
    it('opens the kaleidoscope\'s stages in order, each only once the chain has reached it', () => {
        withWorld((w) => {
            const { world } = w;
            begin(w);
            const top = FOLD_AT[FOLD_AT.length - 1] + 1;
            let trance = 0;
            for (let n = 1; n <= top; n++) {
                world.onCombo(n);
                stepTo(w, world.time + TIMING.foldIn + 0.3, 1 / 30, () => {
                    FOLD_AT.forEach((at, k) => {
                        if (world.folds[k] > 0) expect(world.combo, `stage ${k}`).toBeGreaterThanOrEqual(at);
                    });
                });
                FOLD_AT.forEach((at, k) => expect(world.folds[k], `stage ${k} at chain ${n}`).toBe(n >= at ? 1 : 0));
                expect(world.u.lensS.value.toArray().slice(0, 3)).toEqual(world.folds);
                expect(world.trance).toBeGreaterThan(trance);
                ({ trance } = world);
            }
            expect(world.u.state.value.x).toBe(world.trance);
            // A broken chain lets them go: eased out, not snapped.
            world.onCombo(0);
            stepTo(w, world.time + TIMING.foldOut * 0.5);
            world.folds.forEach((v) => {
                expect(v).toBeGreaterThan(0);
                expect(v).toBeLessThan(1);
            });
            stepTo(w, world.time + TIMING.foldOut * 0.5 + 0.1);
            expect(world.folds).toEqual([0, 0, 0]);
            expect(world.trance).toBeLessThan(trance);
        });
    });

    it('opens every stage at once on a perfect clear, holds the mandala, then lets it go', () => {
        withWorld((w) => {
            const { world } = w;
            begin(w);
            world.onClear({ lines: 2, combo: 1, perfect: true });
            expect(world.counts.perfects).toBe(1);
            stepTo(w, START + TIMING.foldIn + 0.1);
            expect(world.folds).toEqual([1, 1, 1]);
            stepTo(w, START + TIMING.mandalaHold - 0.2);
            expect(world.folds).toEqual([1, 1, 1]);
            const held = world.u.state.value.z;
            expect(held).toBeGreaterThan(0.9);
            stepTo(w, START + TIMING.mandalaHold + TIMING.foldOut + 0.2);
            expect(world.folds).toEqual([0, 0, 0]);
            expect(world.u.state.value.z).toBeLessThan(held);
        });
    });

    it('rolls the eye a full turn on a T-spin, once, and comes back level', () => {
        withWorld((w) => {
            const { world, camera } = w;
            begin(w);
            expect(camera.rotation.z).toBeCloseTo(levelRoll(w), 12);
            world.onClear({ lines: 2, combo: 1, tspin: true });
            expect(world.counts.tspins).toBe(1);
            stepTo(w, START + TIMING.roll * 0.5);
            expect(Math.abs(camera.rotation.z)).toBeGreaterThan(0.5);
            // A second T-spin mid-roll does not start it over.
            const { rollAt } = world;
            world.onTSpin();
            expect(world.rollAt).toBe(rollAt);
            stepTo(w, START + TIMING.roll + 0.05);
            expect(camera.rotation.z).toBeCloseTo(levelRoll(w), 12);
        });
    });

    it('under reduced motion neither dives nor rolls, and still answers the clear', () => {
        withWorld((w) => {
            const { world, camera } = w;
            begin(w);
            world.setReducedMotion(true);
            world.onClear({ lines: 4, combo: 1, tspin: true });
            expect(world.counts).toMatchObject({ quads: 1, tspins: 1, dives: 0 });
            stepTo(w, START + TIMING.dive, 1 / 30, () => {
                expect(world.diveTravel).toBe(0);
                expect(camera.rotation.z).toBe(0);
            });
            expect(world.u.dive.value.toArray().map(Math.abs)).toEqual([0, 0, 0]);
            expect(world.counts.clears).toBe(1);
            world.setReducedMotion(false);
        });
    });

    it('switched on mid-flight, reduced motion stops the dive, the roll, the kick and the turn', () => {
        withWorld((w) => {
            const { world, camera } = w;
            begin(w);
            world.onCombo(FOLD_AT[1] + 1);
            world.onLock({
                u: 0.3, rows: [19], hardDrop: true, distance: 16, color: PIECE_COLORS[0], shape: 'I',
            });
            world.onClear({ lines: 4, combo: 1, tspin: true });
            world.onClear({ lines: 4, combo: 2 });
            stepTo(w, START + TIMING.dive * 0.4);
            expect(world.diveTravel).toBeGreaterThan(0);
            expect(world.diveQueue).toBe(1);
            expect(Math.abs(camera.rotation.z)).toBeGreaterThan(0.1);
            world.setReducedMotion(true);
            stepTo(w, world.time + 1 / 30);
            expect(world.diveTravel).toBe(0);
            expect(world.diveQueue).toBe(0);
            expect(world.kick.x).toBe(0);
            expect(world.turn).toBe(0);
            expect(camera.rotation.z).toBe(0);
            stepTo(w, world.time + TIMING.dive * 2, 1 / 30, () => expect(world.diveTravel).toBe(0));
        });
    });

    it('turns the open mirror with a roll, in small steps all the way round, never flipping it', () => {
        withWorld((w) => {
            const { world } = w;
            begin(w);
            world.onCombo(FOLD_AT[0]);
            stepTo(w, START + TIMING.foldIn + 0.1);
            expect(world.folds[0]).toBe(1);
            world.onClear({ lines: 1, combo: FOLD_AT[0], tspin: true });
            let last = world.u.lens.value.x;
            let turned = 0;
            let largest = 0;
            stepTo(w, world.time + TIMING.roll + 0.05, 1 / 60, () => {
                const now = world.u.lens.value.x;
                const step = Math.abs(((now - last + Math.PI * 3) % TAU) - Math.PI);
                largest = Math.max(largest, step);
                turned += step;
                last = now;
            });
            // The mirror's line follows the core's bearing (the core's half always kept): a full
            // turn with the roll, and no frame jumps it across.
            expect(turned).toBeGreaterThan(TAU * 0.9);
            expect(largest).toBeLessThan(0.2);
        });
    });

    it('sounds a meditation click\'s clear without a flash or a dive', () => {
        withWorld((w) => {
            const { world } = w;
            begin(w);
            world.onClear({
                lines: 4, combo: 1, perfect: true, screen: { x: 0.3, y: 0.4 },
            });
            expect(world.counts).toMatchObject({
                clears: 1, quads: 1, perfects: 1, dives: 0,
            });
            stepTo(w, START + 0.2, 1 / 30, () => {
                expect(world.u.state.value.w).toBe(0);
                expect(world.diveTravel).toBe(0);
            });
            expect(world.u.counts.value.y).toBe(1);
        });
    });

    it('flashes at most once in a short while, however many flashing clears land', () => {
        withWorld((w) => {
            const { world } = w;
            begin(w);
            world.onClear({ lines: 4, combo: 1, perfect: true });
            expect(world.flash).toBeCloseTo(0.6, 12);
            stepTo(w, START + 0.1);
            const fading = world.flash;
            world.onClear({ lines: 4, combo: 2 });
            expect(world.flash).toBe(fading);
            stepTo(w, START + 0.4);
            world.onClear({ lines: 4, combo: 3 });
            expect(world.flash).toBeCloseTo(0.6, 12);
        });
    });

    it('brightens only the core on a lock: the light on the stone keeps to the pulse', () => {
        withWorld((w) => {
            const { world } = w;
            begin(w);
            world.onLock({
                u: 0.3, rows: [19], hardDrop: true, distance: 16, color: PIECE_COLORS[0], shape: 'I',
            });
            stepTo(w, START + 0.05);
            const [light, , , flare] = world.u.heartState.value.toArray();
            expect(flare).toBeGreaterThan(0.3);
            expect(Math.abs(light - 1)).toBeLessThanOrEqual(0.08 * (0.4 + world.trance) + 1e-12);
        });
    });
});

describe('KaleidosonicWorld: moods, the drone and the sinking light', () => {
    const heartRow = MOOD_COLOURS.indexOf('heart');

    it('writes the two moods it is between and the mix, from the wheel', () => {
        withWorld((w) => {
            const { world } = w;
            begin(w);
            const { from, to, mix } = moodMix(world.moodPlace());
            expect(world.u.moodMix.value).toBe(mix);
            const rows = world.u.tables.moods;
            expect(rows[heartRow].toArray().slice(0, 3)).toEqual(MOODS[from].heart);
            expect(rows[heartRow + MOOD_COLOURS.length].toArray().slice(0, 3)).toEqual(MOODS[to].heart);
            expect(world.getState().mood).toMatchObject({ from: MOODS[from].name, to: MOODS[to].name });
        });
    });

    it('drifts the palette with the clock alone, with no level-up', () => {
        withWorld((w) => {
            const { world } = w;
            begin(w);
            const start = world.getState().mood.place;
            const mixStart = world.u.moodMix.value;
            stepTo(w, START + 60, 0.25);
            expect(world.getState().mood.place - start).toBeGreaterThan(0.5);
            expect(world.u.moodMix.value).not.toBeCloseTo(mixStart, 2);
            expect(world.counts.levelUps).toBe(0);
        });
    });

    it('steps the mood wheel forward on a level-up; a silent one lands at once', () => {
        withWorld((w) => {
            const { world } = w;
            begin(w);
            const clockOnly = (t) => t / TIMING.mood;
            world.levelUp(2);
            expect(world.counts.levelUps).toBe(1);
            stepTo(w, START + TIMING.levelTurn + 0.2);
            expect(world.moodPlace() - clockOnly(world.time)).toBeCloseTo(1, 9);
            expect(world.getState()).toMatchObject({ level: 2 });
            world.levelUp(4, { silent: true });
            expect(world.moodPlace() - clockOnly(world.time)).toBeCloseTo(3, 9);
            stepTo(w, world.time + 1 / 30);
            expect(world.getState().level).toBe(4);
        });
    });

    it('keeps the moods and clears the chain, the strikes and the harmonics for a new run', () => {
        withWorld((w) => {
            const { world } = w;
            begin(w);
            world.levelUp(3);
            stepTo(w, START + TIMING.levelTurn + 0.2);
            for (let n = 1; n <= 4; n++) world.onCombo(n);
            world.onB2B(2);
            world.onLock({
                u: 0.3, rows: [10], color: PIECE_COLORS[2], shape: 'Z',
            });
            world.onClear({ lines: 2, combo: 4 });
            stepTo(w, world.time + 0.1);
            expect(world.u.counts.value.toArray().slice(0, 2)).toEqual([1, 1]);
            const place = world.moodPlace();
            world.resetSession();
            expect(world).toMatchObject({
                level: 1, combo: 0, peak: 0, b2b: 0,
            });
            expect(world.moodPlace()).toBe(place);
            stepTo(w, world.time + 1 / 30);
            expect(world.u.counts.value.toArray().slice(0, 2)).toEqual([0, 0]);
            expect(world.moodPlace()).toBeCloseTo(place + 1 / 30 / TIMING.mood, 9);
            // The next run's level-up steps on from where the moods are.
            world.levelUp(2);
            stepTo(w, world.time + TIMING.levelTurn + 0.2);
            expect(world.moodPlace() - world.time / TIMING.mood).toBeCloseTo(3, 9);
        });
    });

    it('holds a drone for a back-to-back run and lets it go after', () => {
        withWorld((w) => {
            const { world } = w;
            begin(w);
            expect(world.u.heartState.value.y).toBe(0);
            world.onB2B(3);
            stepTo(w, START + 4);
            expect(world.u.heartState.value.y).toBeGreaterThan(0.9);
            world.onB2B(0);
            stepTo(w, START + 10);
            expect(world.u.heartState.value.y).toBeLessThan(0.05);
        });
    });

    it('sinks the light at game over and raises it for the next run', () => {
        withWorld((w) => {
            const { world } = w;
            begin(w);
            const lit = world.getPostState().exposure;
            world.onGameOver();
            expect(world.counts.gameOvers).toBe(1);
            stepTo(w, START + TIMING.sink + 0.2);
            expect(world.u.heartState.value.z).toBe(1);
            expect(world.getPostState().exposure).toBeLessThan(lit);
            world.onSessionStart();
            stepTo(w, world.time + TIMING.rise + 0.2);
            expect(world.u.heartState.value.z).toBe(0);
            // The next lock raises it too.
            world.onGameOver();
            stepTo(w, world.time + 1);
            world.onLock({
                u: 0.3, rows: [10], color: PIECE_COLORS[2], shape: 'Z',
            });
            stepTo(w, world.time + TIMING.rise + 0.2);
            expect(world.u.heartState.value.z).toBe(0);
        });
    });

    it('forgets a chain left alone for a long while', () => {
        withWorld((w) => {
            const { world } = w;
            begin(w);
            world.onCombo(5);
            stepTo(w, START + TIMING.idle - 1, 0.25);
            expect(world.combo).toBe(5);
            stepTo(w, START + TIMING.idle + 1, 0.25);
            expect(world.combo).toBe(0);
        });
    });
});

describe('KaleidosonicWorld: the composition round the card', () => {
    it.each(Object.keys(FRAMES))('hangs the core in open air at %s, beside the card and in sight', (label) => {
        const frame = FRAMES[label];
        withWorld(({ world }) => {
            const [aspect] = frame;
            const card = cardUnion(world.layout);
            const h = world.heartWorld;
            expect(templeDistance(h.x, h.y, h.z), 'open air').toBeGreaterThan(0.05);
            expect(world.u.heart.value.toArray().slice(0, 3)).toEqual(h.toArray());
            expect(world.u.heart.value.w).toBeGreaterThan(0);
            const screen = world.heartScreen;
            if (aspect < 0.75) {
                expect(screen.y, 'above the card').toBeLessThan(card.y0);
                expect(Math.abs(screen.x - 0.5)).toBeLessThan(0.1);
            } else {
                expect(screen.x, 'left of the card').toBeLessThan(card.x0);
                expect(screen.y).toBeGreaterThan(0.2);
                expect(screen.y).toBeLessThan(0.8);
            }
            // It sits on its own screen point, with no stone between it and the eye.
            const seen = onScreen(world, h.toArray());
            expect(seen.x).toBeCloseTo(screen.x, 6);
            expect(seen.y).toBeCloseTo(screen.y, 6);
            const [o, d] = world.restRay(screen.x, screen.y);
            const reach = Math.hypot(h.x - o[0], h.y - o[1], h.z - o[2]);
            expect(marchTemple(o, d, { far: reach })).toBeNull();
        }, 'Minimal', frame);
    });

    it('draws the core smaller on a tall frame, where it hangs in the narrow strip above the card', () => {
        const radius = (frame) => withWorld(({ world }) => world.u.heart.value.w, 'Minimal', frame);
        expect(radius(FRAMES['phone 9:19.5'])).toBeLessThan(radius(FRAMES['16:9']));
    });

    it('with several boards side by side, hangs the core above them and strikes under each player\'s own card', () => {
        withWorld(({ world }) => {
            const cards = [
                {
                    x0: 0.08, y0: 0.14, x1: 0.46, y1: 0.86,
                },
                {
                    x0: 0.54, y0: 0.14, x1: 0.92, y1: 0.86,
                },
            ];
            const boards = [null, {
                x0: 0.15, y0: 0.3, x1: 0.39, y1: 0.8,
            }, {
                x0: 0.61, y0: 0.3, x1: 0.85, y1: 0.8,
            }, null, null];
            const solo = world.u.heart.value.w;
            world.setLayout({
                cardCount: 2, cards, hud: null, boards,
            }, 16 / 9);
            expect(world.heartScreen.y, 'above the cards').toBeLessThan(0.14);
            expect(Math.abs(world.heartScreen.x - 0.5)).toBeLessThan(0.1);
            expect(world.u.heart.value.w).toBeLessThan(solo);
            expect(templeDistance(world.heartWorld.x, world.heartWorld.y, world.heartWorld.z)).toBeGreaterThan(0.05);
            for (const [player, card] of [[1, cards[0]], [2, cards[1]]]) {
                for (const u of [0, 0.5, 1]) {
                    const p = world.sitePoint(u, 10, player);
                    expect(p.x, `player ${player}, u ${u}`).toBeGreaterThanOrEqual(card.x0 - 1e-9);
                    expect(p.x, `player ${player}, u ${u}`).toBeLessThanOrEqual(card.x1 + 1e-9);
                    expect(p.y, `player ${player}, u ${u}`).toBeGreaterThan(0.86);
                    expect(p.y).toBeLessThan(1);
                }
            }
            // A lock carries its player through to the strike's site, and strikes under that card.
            const site = vi.spyOn(world, 'sitePoint');
            world.onLock({
                player: 2, u: 0.5, rows: [10], color: PIECE_COLORS[1], shape: 'T',
            });
            expect(site).toHaveBeenCalledWith(0.5, 10, 2);
            const slot = world.strikes[(world.strikeCursor - 1 + STRIKES) % STRIKES];
            const struck = onScreen(world, [slot.x, slot.y, slot.z]);
            expect(struck.x).toBeGreaterThan(cards[1].x0);
            expect(struck.x).toBeLessThan(cards[1].x1);
            site.mockRestore();
        });
    });

    it.each(Object.keys(FRAMES))('aims every lock at %s outside the card and the HUD', (label) => {
        const frame = FRAMES[label];
        withWorld(({ world }) => {
            const [aspect, width, height] = frame;
            const layout = fallbackLayout(width, height);
            const card = cardUnion(layout);
            const misses = [];
            for (let i = 0; i <= 20; i++) {
                const u = i / 20;
                for (const row of [0, 5, 10, 15, 19]) {
                    const p = world.sitePoint(u, row);
                    const at = `u ${u}, row ${row}: ${p.x.toFixed(3)}, ${p.y.toFixed(3)}`;
                    if (!outsideKeepOut(layout, p, 0)) misses.push(at);
                    expect(p.x).toBeGreaterThan(0);
                    expect(p.x).toBeLessThan(1);
                    expect(p.y).toBeGreaterThan(0);
                    expect(p.y).toBeLessThan(1);
                }
            }
            expect(misses).toEqual([]);
            if (aspect >= 0.75) {
                // The board's left edge strikes left of the card, its right edge right of it.
                expect(world.sitePoint(0, 10).x).toBeLessThan(card.x0);
                expect(world.sitePoint(1, 10).x).toBeGreaterThan(card.x1);
                expect(world.sitePoint(0.25, 10).x).toBeGreaterThan(world.sitePoint(0, 10).x);
            } else {
                expect(world.sitePoint(0, 10).y).toBeGreaterThan(card.y1);
                expect(world.sitePoint(1, 10).x).toBeGreaterThan(world.sitePoint(0, 10).x);
            }
            // The floor rows strike lower on the screen than the top rows.
            expect(world.sitePoint(0.2, 19).y).toBeGreaterThan(world.sitePoint(0.2, 0).y);
        }, 'Minimal', frame);
    });

    it('follows a live card: the core and the strikes move to stay beside it', () => {
        withWorld(({ world }) => {
            const card = {
                x0: 0.5, y0: 0.08, x1: 0.68, y1: 0.92,
            };
            world.setLayout({
                cardCount: 1, cards: [card], hud: null, boards: [null, null, null, null, null],
            }, 16 / 9);
            expect(world.layoutLive).toBe(true);
            expect(world.heartScreen.x).toBeLessThan(card.x0);
            expect(world.sitePoint(0, 10).x).toBeLessThan(card.x0);
            expect(world.sitePoint(1, 10).x).toBeGreaterThan(card.x1);
            expect(templeDistance(world.heartWorld.x, world.heartWorld.y, world.heartWorld.z)).toBeGreaterThan(0.05);
            // The board gone: back to where the solo board would hang.
            world.setLayout(null);
            expect(world.layoutLive).toBe(false);
            expect(world.layout.cardCount).toBe(0);
        });
    });
});

describe('KaleidosonicWorld: determinism and state', () => {
    /** What a capture would see: every uniform the materials read and what the post is handed. */
    const read = ({ world }) => ({
        shape: world.u.shape.value.toArray(),
        breath: world.u.breath.value,
        pulse: world.u.pulse.value,
        time: world.u.time.value,
        lens: world.u.lens.value.toArray(),
        lensS: world.u.lensS.value.toArray(),
        dive: world.u.dive.value.toArray(),
        state: world.u.state.value.toArray(),
        heartState: world.u.heartState.value.toArray(),
        heart: world.u.heart.value.toArray(),
        moodMix: world.u.moodMix.value,
        counts: world.u.counts.value.toArray(),
        strikes: strikeRows(world),
        harmonics: harmonicRows(world),
        camera: world.u.camWorld.value.toArray(),
        post: structuredClone(world.getPostState()),
        diag: world.getState(),
    });

    it('seeks deterministically: a seek and the same events draw the same frame as a fresh world', () => {
        withWorld((w) => {
            begin(w);
            play(w);
            const first = read(w);
            expect(first.diag.counts).toMatchObject({
                locks: 7, drops: 1, clears: 8, quads: 1, tspins: 1, perfects: 1, levelUps: 1, dives: 1,
            });
            begin(w);
            play(w);
            expect(read(w)).toEqual(first);
            const fresh = makeWorld();
            try {
                begin(fresh);
                play(fresh);
                expect(read(fresh)).toEqual(first);
            } finally {
                fresh.world.dispose();
            }
        });
    });

    it('keeps every phase wrapped and every uniform finite over a very long session', () => {
        withWorld((w) => {
            const { world, camera } = w;
            begin(w, 0);
            const bad = [];
            const check = (t) => {
                for (const [key, node] of Object.entries(world.u)) {
                    // (uniformArray nodes carry their rows in the tables, checked below)
                    if (key === 'tables' || node?.value === null || node?.value === undefined) continue;
                    const { value } = node;
                    const values = typeof value === 'number' ? [value] : value.toArray?.() ?? [];
                    if (!values.every(Number.isFinite)) bad.push(`${key} at ${t} s`);
                }
                for (const [table, rows] of Object.entries(world.u.tables)) {
                    rows.forEach((row, r) => {
                        if (!row.toArray().every(Number.isFinite)) bad.push(`${table}[${r}] at ${t} s`);
                    });
                }
            };
            let combo = 0;
            for (let frame = 1; frame <= 16000; frame++) {
                const t = frame * 0.25;
                if (frame % 12 === 0) {
                    world.onLock({
                        u: (frame * 0.173) % 1,
                        rows: [19 - (frame % 20)],
                        color: PIECE_COLORS[(frame / 12) % 8],
                        shape: PIECE_ORDER[(frame / 12) % 8],
                        hardDrop: frame % 36 === 0,
                        distance: frame % 19,
                    });
                }
                if (frame % 24 === 0) {
                    const lines = 1 + (frame % 4);
                    combo = frame % 480 < 360 ? combo + 1 : 0;
                    world.onClear({ lines, combo: Math.max(1, combo), tspin: frame % 192 === 0 });
                    world.onCombo(combo);
                    world.onB2B(lines === 4 ? Math.min(4, world.b2b + 1) : 0);
                }
                if (frame % 2000 === 0) world.onClear({ lines: 4, perfect: true });
                if (frame % 1600 === 0) world.levelUp(world.level + 1);
                if (frame === 9000) world.onGameOver();
                if (frame === 9100) world.resetSession();
                world.updateCamera(camera, sim(t, 0, Math.sin(t), Math.cos(t * 0.7)));
                world.update(sim(t, 0.25), camera);
                if (frame % 400 === 0) check(t);
            }
            expect(bad.slice(0, 10)).toEqual([]);
            expect(world.time).toBe(4000);
            // Phases are integrated and wrapped before upload: the shaders never see a huge number.
            for (const key of ['breath', 'pulse']) {
                expect(world.u[key].value, key).toBeGreaterThanOrEqual(0);
                expect(world.u[key].value, key).toBeLessThan(PHASE_WRAP);
            }
            expect(world.u.time.value).toBeLessThan(3600);
            expect(world.counts.locks).toBeGreaterThan(1000);
            expect(world.counts.gameOvers).toBe(1);
        });
    });

    it('wraps the breath and the pulse where every multiple the shaders take of them closes a whole period', () => {
        // Every `breath.mul(k)` / `pulse.mul(k)` in the temple's shader, and the bare phase itself
        // (the world's own sin(pulse)): k · PHASE_WRAP must be a whole number of turns, or the
        // wrap shows as a jump in that pattern.
        const temple = new URL('../../src/themes/kaleidosonic/kaleidosonic-temple.js', import.meta.url);
        const source = readFileSync(temple, 'utf8');
        const multiples = new Set([1]);
        for (const m of source.matchAll(/(?:breath|pulse)\.mul\(([\d.]+)\)/g)) multiples.add(Number(m[1]));
        expect(multiples.size).toBeGreaterThan(4);
        for (const k of multiples) {
            const turns = (k * PHASE_WRAP) / TAU;
            expect(Math.abs(turns - Math.round(turns)), `× ${k}: ${turns} turns`).toBeLessThan(1e-9);
        }
    });

    it('round-trips a session through export and import (structured-clone equal)', () => {
        withWorld((w) => {
            begin(w);
            play(w);
            const snapshot = structuredClone(w.world.exportSessionState());
            expect(snapshot).toEqual(w.world.exportSessionState());
            const other = makeWorld();
            try {
                begin(other, w.world.time);
                other.world.importSessionState(snapshot);
                expect(structuredClone(other.world.exportSessionState())).toEqual(snapshot);
                for (const t of [w.world.time, w.world.time + 3, w.world.time + 250]) {
                    expect(other.world.wheel.place(t), `t = ${t}`).toBeCloseTo(w.world.wheel.place(t), 12);
                }
                // A snapshot of another shape, or none, changes nothing.
                other.world.importSessionState(null);
                other.world.importSessionState(undefined);
                expect(structuredClone(other.world.exportSessionState())).toEqual(snapshot);
            } finally {
                other.world.dispose();
            }
        });
    });

    it('draws the carried trance, folds and shape the same after an import as the world it came from', () => {
        withWorld((w) => {
            begin(w);
            for (let n = 1; n <= FOLD_AT[1]; n++) {
                w.world.onClear({ lines: 1, combo: n });
                w.world.onCombo(n);
                stepTo(w, w.world.time + 0.6);
            }
            // Mid-chain, the refolds settled (the spring's speed is not part of a session).
            stepTo(w, w.world.time + TIMING.refold * 3);
            expect(w.world.folds.slice(0, 2)).toEqual([1, 1]);
            const snapshot = structuredClone(w.world.exportSessionState());
            const other = makeWorld();
            try {
                begin(other, w.world.time);
                other.world.importSessionState(snapshot);
                const t = w.world.time + 1 / 30;
                for (const v of [w, other]) stepTo(v, t);
                expect(other.world.u.shape.value.x).toBeCloseTo(w.world.u.shape.value.x, 6);
                expect(other.world.u.lensS.value.toArray()).toEqual(w.world.u.lensS.value.toArray());
                expect(other.world.u.state.value.x).toBeCloseTo(w.world.u.state.value.x, 12);
                expect(other.world.moodPlace()).toBeCloseTo(w.world.moodPlace(), 12);
            } finally {
                other.world.dispose();
            }
        });
    });

    // A world rebuilt in place after a game over (a quality change on the game-over screen, a GPU
    // recovery) keeps the sunk light, the drone and a held mandala: the snapshot carries the eased
    // `sink`, `drone` and `mandalaAt`, not only the targets.
    it('keeps the light sunk through a rebuild after a game over', () => {
        withWorld((w) => {
            begin(w);
            w.world.onGameOver();
            stepTo(w, START + TIMING.sink + 1);
            const snapshot = structuredClone(w.world.exportSessionState());
            const other = makeWorld();
            try {
                begin(other, w.world.time);
                other.world.importSessionState(snapshot);
                const t = w.world.time + 1 / 30;
                for (const v of [w, other]) stepTo(v, t);
                expect(other.world.u.heartState.value.z).toBeCloseTo(w.world.u.heartState.value.z, 3);
                expect(other.world.getPostState().exposure).toBeCloseTo(w.world.getPostState().exposure, 3);
            } finally {
                other.world.dispose();
            }
        });
    });
});

describe('KaleidosonicWorld teardown', () => {
    it('disposes once, however often it is asked, and lets go of the scene', () => {
        const own = makeWorld();
        const { world, scene } = own;
        begin(own);
        world.onLock({
            u: 0.3, rows: [12], color: PIECE_COLORS[1], shape: 'T',
        });
        const { geometry, material } = world.parts.temple;
        const disposeGeometry = vi.spyOn(geometry, 'dispose');
        const disposeMaterial = vi.spyOn(material, 'dispose');
        world.dispose();
        expect(() => world.dispose()).not.toThrow();
        expect(disposeGeometry).toHaveBeenCalledOnce();
        expect(disposeMaterial).toHaveBeenCalledOnce();
        expect(world.disposed).toBe(true);
        expect(world.root.parent).toBeNull();
        expect(scene.children).not.toContain(world.root);
        // What a late caller does to a retired world is harmless.
        expect(() => {
            world.prerender({});
            world.getPostState();
            world.getState();
        }).not.toThrow();
    });
});
