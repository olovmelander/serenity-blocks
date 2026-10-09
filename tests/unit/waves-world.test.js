/**
 * Waves — the world's choreography, on the CPU.
 *
 * A real WavesWorld is built into a real scene with a real camera; nothing here needs a renderer,
 * because the world is a function of its clock plus a little eased state and the tables the water
 * reads (rings, ribbons, bands), and every one of those is plain numbers the tests can read back.
 *
 * The strengths, speeds and lifetimes are tuned by eye and keep moving: the tests assert what
 * follows what (a hard drop is stronger, a longer chain opens the barrel further, the clock runs
 * slower inside a hold) and read every constant they need from the modules.
 */
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import {
    HOLD_SCALE, HOLD_SECONDS, REST_RIG, WavesWorld, aimPlunge, aimStain, fovForAspect, holdScale, openForCombo,
} from '../../src/themes/waves/waves-world.js';
import {
    FLOW, WAVE, axisOffset, landingDistance, pieceLight,
} from '../../src/themes/waves/waves-core.js';
import { QUALITY, QUALITY_NAMES } from '../../src/themes/waves/waves-quality.js';
import { boardPoint, fallbackLayout, viewFor } from '../../src/themes/waves/waves-composition.js';
import { BAND_SLOTS } from '../../src/themes/waves/waves-water.js';
import { leapersFor } from '../../src/themes/waves/waves-life.js';
import { GRAVITY } from '../../src/themes/waves/waves-spray.js';
import { POST_LOOK } from '../../src/themes/waves/waves-post.js';

vi.setConfig({ testTimeout: 30_000 }); // every test builds a wave or two, on a machine that may be busy

const DT = 1 / 60;
const EYE = REST_RIG.eye;
const PARTS = ['dolphins', 'mist', 'rain', 'sky', 'spray', 'water'];
const HIT_KINDS = ['floor', 'lip', 'wall'];
const worlds = [];

/** A point of the tube's own section at the eye, in the ellipse's units: inside is less than 1. */
const inTube = (p) => ((p.x - axisOffset(0)) / WAVE.a) ** 2 + ((p.y - WAVE.b) / WAVE.b) ** 2;

/** One frame: the camera first (events aim through it), then the world. */
function frame(world, camera, delta = 0, extra = null) {
    const sim = { time: world.time + delta, delta, ...extra };
    world.updateCamera(camera, sim);
    world.update(sim, camera);
}

function makeWorld(quality = 'Minimal', {
    width = 1600, height = 900, live = true, seed = undefined, layout = null, at = 10,
} = {}) {
    const scene = new THREE.Scene();
    const aspect = width / height;
    const camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, REST_RIG.near, REST_RIG.far);
    const world = new WavesWorld({
        scene, quality, capture: true, seed,
    }).build();
    world.setViewport(width, height, aspect);
    // As the theme does on its first frame: the live rects, or null when no board is on screen.
    world.setLayout(live ? (layout || fallbackLayout(width, height)) : null, aspect);
    world.bindCamera(camera);
    world.seek(at);
    frame(world, camera);
    worlds.push(world);
    return { scene, camera, world };
}

/** Advance the world by `seconds`, a sixtieth at a time; `each(i)` runs before frame i. */
function run(world, camera, seconds, each = null) {
    const steps = Math.round(seconds / DT);
    for (let i = 1; i <= steps; i++) {
        each?.(i);
        frame(world, camera, DT);
    }
}

const rowsOf = (list, count) => list.slice(0, count).map((row) => row.toArray());
const rings = (world) => rowsOf(world.ringRows, world.ringCount);
/** Each ribbon as [head, tint]: (u, z, birth, strength) and (r, g, b, tail). */
const ribbons = (world) => {
    const rows = rowsOf(world.ribbonRows, world.ribbonCount * 2);
    return Array.from({ length: world.ribbonCount }, (_, i) => [rows[i * 2], rows[i * 2 + 1]]);
};
/** The bands of light on their way down the tube: (birth, strength, width, twist). */
const liveBands = (world) => world.bandRows.filter((row) => row.y > 0).map((row) => row.toArray());
const bySlotless = (rows) => [...rows].sort((p, q) => p[0] - q[0] || p[1] - q[1]);

/** How many drops of the spray pool have been thrown since it was last emptied. */
function thrown(world) {
    const start = world.spray.geometry.getAttribute('aStart');
    let n = 0;
    for (let i = 0; i < world.spray.count; i++) if (start.getW(i) > -1000) n += 1;
    return n;
}

/** Everything that decides what a frame looks like, as plain numbers. */
function picture(world) {
    const { U } = world;
    return {
        state: world.getState(),
        post: world.getPostState(),
        rings: rings(world),
        ribbons: ribbons(world),
        bands: world.bandRows.map((row) => row.toArray()),
        uniforms: {
            time: U.time.value,
            open: U.open.value,
            warm: U.warm.value,
            glow: U.glow.value,
            tear: U.tear.value,
            ripple: U.ripple.value,
            bulge: U.bulge.value.toArray(),
            counts: U.counts.value.toArray(),
        },
        spray: Array.from(world.spray.data),
        pod: Array.from(world.pod.data),
    };
}

/** A few seconds of play from a seek, as the theme and the playground replay a capture. */
function play(world, camera) {
    world.seek(3);
    frame(world, camera);
    run(world, camera, 6, (i) => {
        if (i === 30) world.onLock({ u: 0.2, rows: [12, 11], color: '#ff7b52' });
        if (i === 60) {
            world.onLock({
                u: 0.8, rows: [18], hardDrop: true, color: '#7eeeff',
            });
        }
        if (i === 90) {
            world.onClear({ rows: [19, 18, 17], lines: 3, tspin: true });
            world.onCombo(5);
        }
        if (i === 150) world.onClear({ rows: [19, 18, 17, 16], lines: 4 });
        if (i === 200) world.levelUp(2);
    });
    return picture(world);
}

/** The smallest chain that calls `n` dolphins or more. */
function chainFor(n) {
    for (let combo = 1; combo < 200; combo++) if (leapersFor(combo) >= n) return combo;
    throw new Error(`no chain calls ${n} dolphins`);
}

afterEach(() => {
    for (const world of worlds.splice(0)) world.dispose();
    vi.restoreAllMocks();
});

describe('waves world: build', () => {
    it.each(QUALITY_NAMES)('builds the %s tier from node materials, with every part and every table', (quality) => {
        const { scene, world } = makeWorld(quality);
        const tier = QUALITY[quality];
        expect(world.tier).toBe(tier);
        expect(scene.children).toEqual([world.group]);
        // The whole picture on every tier, each part under the world's group and drawn.
        expect(Object.keys(world.parts).sort()).toEqual(PARTS);
        const materials = new Set();
        for (const name of PARTS) {
            const { mesh } = world.parts[name];
            expect(mesh.parent, name).toBe(world.group);
            expect(mesh.visible, name).toBe(true);
            expect(mesh.material.isNodeMaterial, name).toBe(true);
            expect(mesh.material.isShaderMaterial, name).not.toBe(true);
            materials.add(mesh.material);
        }
        expect(materials.size).toBe(PARTS.length);
        // What the tier pays for.
        expect(world.pod.count).toBe(tier.dolphins);
        expect(world.spray.count).toBe(tier.spray);
        expect(world.parts.rain.mesh.geometry.instanceCount).toBe(tier.droplets);
        expect(world.ringRows).toHaveLength(tier.rings);
        expect(world.ribbonRows).toHaveLength(tier.ribbons * 2);
        expect(world.bandRows).toHaveLength(BAND_SLOTS);
        expect(world.noise.image.width).toBe(tier.noise);
        expect(POST_LOOK[quality]).toBeTruthy();
        // At rest, at the time it was put at.
        expect(world.getState()).toMatchObject({
            quality,
            time: 10,
            clock: 10,
            combo: 0,
            level: 1,
            open: 0,
            landing: landingDistance(0),
            warm: 0,
            glow: 0,
            rings: 0,
            ribbons: 0,
            airborne: 0,
            holding: false,
            locks: 0,
            clears: 0,
            leaps: 0,
            flow: FLOW,
            tube: { a: WAVE.a, b: WAVE.b },
        });
        expect(world.U.time.value).toBe(10);
        expect(world.U.sun.value.length()).toBeCloseTo(1, 9);
        expect(world.U.sun.value.y).toBeGreaterThan(0); // the sun is up
        expect(thrown(world)).toBe(0);
    });

    it('falls back to the High tier for a quality it does not know, and is not in the scene until built', () => {
        const scene = new THREE.Scene();
        const world = new WavesWorld({ scene, quality: 'Nonsense' });
        expect(world.tier).toBe(QUALITY.High);
        expect(new WavesWorld({ scene }).tier).toBe(QUALITY.High);
        expect(scene.children).toHaveLength(0);
        expect(world.parts).toEqual({});
        // Before it is built it can already be asked where it is, and put somewhere else.
        expect(() => {
            world.seek(4);
            world.resetSession();
            world.getState();
        }).not.toThrow();
        expect(world.getState()).toMatchObject({ time: 4, clock: 4, airborne: 0 });
        // A lock before there is a camera to aim through is not a lock.
        world.onLock({ u: 0.5 });
        expect(world.getState().locks).toBe(0);
    });

    it('stands the sun where it is told to', () => {
        const scene = new THREE.Scene();
        const low = new WavesWorld({ scene, sun: { azimuth: 0, elevation: 2 } });
        const high = new WavesWorld({ scene, sun: { azimuth: 0, elevation: 40 } });
        const left = new WavesWorld({ scene, sun: { azimuth: 30 } });
        expect(high.sunDir.y).toBeGreaterThan(low.sunDir.y);
        expect(low.sunDir.x).toBeCloseTo(0, 9);
        expect(low.sunDir.z).toBeLessThan(0); // ahead, down the line
        expect(left.sunDir.x).toBeLessThan(0); // to the left of it, where the barrel opens
        for (const world of [low, high, left]) {
            expect(world.sunDir.length()).toBeCloseTo(1, 9);
            expect(world.U.sun.value.toArray()).toEqual(world.sunDir.toArray());
        }
    });

    it('draws only the named parts when asked', () => {
        const { world } = makeWorld('Low');
        world.showOnlyParts(['sky', 'water', 'no-such-part']);
        for (const name of PARTS) {
            expect(world.parts[name].mesh.visible, name).toBe(name === 'sky' || name === 'water');
        }
        world.showOnlyParts([]);
        expect(PARTS.some((name) => world.parts[name].mesh.visible)).toBe(false);
        world.showOnlyParts(PARTS);
        expect(PARTS.every((name) => world.parts[name].mesh.visible)).toBe(true);
    });

    it('releases every geometry, material and texture it made, leaves the scene and survives a second dispose', () => {
        const { scene, world } = makeWorld('Medium');
        const made = new Map();
        scene.traverse((object) => {
            if (object.geometry) made.set(object.geometry, `geometry of ${object.name || object.type}`);
            if (object.material) made.set(object.material, `material ${object.material.name || object.type}`);
        });
        made.set(world.noise, 'the noise texture');
        expect(made.size).toBe(PARTS.length * 2 + 1);
        const spies = [...made.entries()].map(([resource, label]) => [vi.spyOn(resource, 'dispose'), label]);
        const { group } = world;
        world.dispose();
        expect(scene.children).toHaveLength(0);
        expect(group.parent).toBeNull();
        expect(group.children).toHaveLength(0);
        expect(spies.filter(([spy]) => spy.mock.calls.length === 0).map(([, label]) => label)).toEqual([]);
        expect(world.parts).toEqual({});
        for (const key of ['pod', 'spray', 'noise', 'camera']) expect(world[key], key).toBeNull();
        expect(() => world.dispose()).not.toThrow();
        // What a retired world is still asked by its owner on the way out is harmless.
        expect(() => {
            world.getState();
            world.getPostState();
            world.setViewport(800, 600, 800 / 600);
            world.setLayout(null);
            world.setReducedMotion(true);
            world.showOnlyParts(['sky']);
            world.onLock({ u: 0.5 });
            world.resetSession();
            world.seek(3);
        }).not.toThrow();
        expect(world.getState()).toMatchObject({ airborne: 0, rings: 0, ribbons: 0 });
    });
});

describe('waves world: locks', () => {
    it('adds one ring and one ribbon for a lock, stamped with the clock and the piece\'s light', () => {
        const { camera, world } = makeWorld('Low');
        world.onLock({ rows: [12, 11], u: 0.3, color: '#ff7b52' });
        expect(world.getState()).toMatchObject({ rings: 1, ribbons: 1, locks: 1 });
        const [[, , ringBirth, ringStrength]] = rings(world);
        expect(ringBirth).toBe(10);
        expect(ringStrength).toBeGreaterThan(0);
        const [[head, tint]] = ribbons(world);
        expect(head[2]).toBe(10);
        expect(head[3]).toBeGreaterThan(0);
        // The ribbon is the piece's own colour at full strength, with a tail to draw out.
        expect(tint.slice(0, 3)).toEqual(pieceLight('#ff7b52'));
        expect(tint[3]).toBeGreaterThan(0);
        // A crown of drops where it went in.
        expect(thrown(world)).toBeGreaterThan(0);
        // The water is told on the next frame.
        expect(world.U.counts.value.toArray().slice(0, 2)).toEqual([0, 0]);
        frame(world, camera);
        expect(world.U.counts.value.toArray().slice(0, 2)).toEqual([1, 1]);

        // Later locks are stamped with the clock of their own moment, after the ones before them.
        run(world, camera, 0.5);
        world.onLock({ rows: [19], u: 0.7, color: '#7eeeff' });
        expect(world.getState()).toMatchObject({ rings: 2, ribbons: 2, locks: 2 });
        expect(rings(world)[1][2]).toBe(world.clock);
        expect(ribbons(world)[1][0][2]).toBe(world.clock);
        expect(world.clock).toBeCloseTo(10.5, 9);
        expect(ribbons(world)[1][1].slice(0, 3)).toEqual(pieceLight('#7eeeff'));
        // The first ribbon kept its own colour: the rows are copies, not one shared light.
        expect(ribbons(world)[0][1].slice(0, 3)).toEqual(pieceLight('#ff7b52'));
        // A piece with no colour leaves foam white.
        world.onLock({ rows: [19], u: 0.5 });
        expect(ribbons(world)[2][1].slice(0, 3)).toEqual(pieceLight(null));
    });

    it('strikes harder on a hard drop: a stronger ring, a stronger ribbon, more spray, more light', () => {
        const soft = makeWorld('Low');
        const hard = makeWorld('Low');
        soft.world.onLock({ u: 0.3, rows: [18], color: '#7eeeff' });
        hard.world.onLock({
            u: 0.3, rows: [18], color: '#7eeeff', hardDrop: true,
        });
        const [softRing] = rings(soft.world);
        const [hardRing] = rings(hard.world);
        const [[softHead, softTint]] = ribbons(soft.world);
        const [[hardHead, hardTint]] = ribbons(hard.world);
        // The same place, the same colour...
        expect(hardRing.slice(0, 3)).toEqual(softRing.slice(0, 3));
        expect(hardHead.slice(0, 3)).toEqual(softHead.slice(0, 3));
        expect(hardTint.slice(0, 3)).toEqual(softTint.slice(0, 3));
        // ...struck harder.
        expect(hardRing[3]).toBeGreaterThan(softRing[3]);
        expect(hardHead[3]).toBeGreaterThan(softHead[3]);
        expect(hardTint[3]).toBeGreaterThanOrEqual(softTint[3]);
        expect(thrown(hard.world)).toBeGreaterThan(thrown(soft.world));
        // Only the hard drop lights the frame.
        expect(soft.world.getPostState().flash).toBe(0);
        expect(hard.world.getPostState().flash).toBeGreaterThan(0);
        frame(soft.world, soft.camera, DT);
        frame(hard.world, hard.camera, DT);
        expect(hard.world.U.glow.value).toBeGreaterThan(soft.world.U.glow.value);
        expect(hard.world.U.tear.value).toBeGreaterThan(soft.world.U.tear.value);
        expect(hard.world.getState().locks).toBe(1);
        // Anything but true is not a hard drop.
        const loose = makeWorld('Low');
        loose.world.onLock({
            u: 0.3, rows: [18], color: '#7eeeff', hardDrop: 'yes',
        });
        expect(rings(loose.world)).toEqual([softRing]);
    });

    it('aims a lock through the card it locked in: its stain and its plunge are where the aim says', () => {
        const { world } = makeWorld('Low');
        const { cards: [card], boards: [board] } = world.layout;
        const cast = vi.spyOn(world, 'castScreen');
        world.onLock({ rows: [12, 11], u: 0.1, color: '#ffe08f' });
        // The piece: its column, and the middle one of its rows.
        const piece = boardPoint(board, 0.1, 11);
        const stain = aimStain(card, piece, 0.1, 11);
        const plunge = aimPlunge(card, piece, 0.1);
        expect(cast).toHaveBeenCalledTimes(2);
        expect(cast.mock.calls[0].slice(0, 2)).toEqual([stain.x, stain.y]);
        expect(cast.mock.calls[1].slice(0, 2)).toEqual([plunge.x, plunge.y]);
        // The ribbon starts where the stain's ray met the wave; the ring where the plunge's did.
        const [wall, foot] = cast.mock.results.map((result) => result.value);
        expect(wall).not.toBe(foot);
        const [[head]] = ribbons(world);
        expect(head.slice(0, 2)).toEqual([wall.u, wall.z]);
        expect(rings(world)[0].slice(0, 2)).toEqual([foot.u, foot.z]);
        for (const hit of [wall, foot]) {
            expect(HIT_KINDS).toContain(hit.kind);
            expect(Number.isFinite(hit.u + hit.z)).toBe(true);
        }
        // The plunge is water the eye can see: its ray went down, to the trough or the foot of the face.
        expect(foot.y).toBeLessThan(EYE.y);
        expect(foot.z).toBeLessThan(0);
    });

    it('puts a lock on the left of the board and one on the right at different places, both ahead', () => {
        const strays = [];
        for (const [width, height] of [[1600, 900], [2560, 1080], [1280, 800]]) {
            const { world } = makeWorld('Minimal', { width, height });
            world.onLock({ rows: [19], u: 0.1 });
            world.onLock({ rows: [19], u: 0.9 });
            const [left, right] = rings(world);
            const where = `${width}x${height}`;
            // Different water for different columns...
            if (!(Math.hypot(left[0] - right[0], left[1] - right[1]) > 0.1)) {
                strays.push(`${where}: both rings at (${left[0]}, ${left[1]})`);
            }
            // ...ahead of the eye, where it can be seen.
            if (!(left[1] < 0 && right[1] < 0)) strays.push(`${where}: a ring behind the eye`);
            const [[leftHead], [rightHead]] = ribbons(world);
            if (!(Math.hypot(leftHead[0] - rightHead[0], leftHead[1] - rightHead[1]) > 0.1)) {
                strays.push(`${where}: both ribbons at (${leftHead[0]}, ${leftHead[1]})`);
            }
            if (!(leftHead[1] < 0 && rightHead[1] < 0)) strays.push(`${where}: a ribbon behind the eye`);
            // A piece high on the board and one on the floor do not draw the same ribbon either.
            world.onLock({ rows: [2], u: 0.1 });
            const [, , [highHead]] = ribbons(world);
            if (!(Math.hypot(highHead[0] - leftHead[0], highHead[1] - leftHead[1]) > 0.05)) {
                strays.push(`${where}: a high piece and a low one stain the same water`);
            }
        }
        expect(strays).toEqual([]);
    });

    it('answers a lock on every screen shape with finite rows, whatever the column and the row', () => {
        for (const [width, height] of [[1600, 900], [2560, 1080], [1024, 768], [430, 932], [932, 430]]) {
            const { camera, world } = makeWorld('Minimal', { width, height });
            let n = 0;
            for (let row = 1; row <= 19; row += 6) {
                for (let column = 0; column <= 10; column += 5) {
                    world.onLock({ rows: [row], u: column / 10, hardDrop: (n += 1) % 3 === 0 });
                    const numbers = [...rings(world).flat(), ...ribbons(world).flat(2)];
                    expect(numbers.every(Number.isFinite), `${width}x${height}, row ${row}`).toBe(true);
                    frame(world, camera, DT);
                }
            }
            expect(world.spray.data.every(Number.isFinite), `${width}x${height}`).toBe(true);
            expect(world.getState().locks).toBe(12);
        }
    });

    it('aims at the click when a mode has no board, and at the solo board\'s place when nothing is said', () => {
        const { world } = makeWorld('Low', { live: false });
        expect(world.hasBoard).toBe(false);
        const cast = vi.spyOn(world, 'castScreen');
        world.onLock({ screen: { x: 0.2, y: 0.6 }, color: '#ffe08f' });
        expect(cast.mock.calls.map((call) => call.slice(0, 2))).toEqual([[0.2, 0.6], [0.2, 0.6]]);
        cast.mockClear();
        // No board on screen: the stylesheet's solo board, a card in the middle of the screen.
        world.onLock({ rows: [19], u: 0.5 });
        const solo = world.aimLayout();
        expect(solo.cardCount).toBe(0);
        expect((solo.boards[0].x0 + solo.boards[0].x1) / 2).toBeCloseTo(0.5, 6);
        const piece = boardPoint(solo.boards[0], 0.5, 19);
        const stain = aimStain(solo.cards[0], piece, 0.5, 19);
        expect(cast.mock.calls[0].slice(0, 2)).toEqual([stain.x, stain.y]);
        // Nothing said at all: the middle column, on the floor.
        cast.mockClear();
        world.onLock({});
        expect(cast.mock.calls[0].slice(0, 2)).toEqual([stain.x, stain.y]);
        expect(world.getState()).toMatchObject({ locks: 3, rings: 3, ribbons: 3 });
    });

    it('follows the board it is given, and answers a player with no board at the first one on screen', () => {
        const at = (x0) => ({
            cardCount: 1,
            cards: [{
                x0: x0 - 0.02, y0: 0.1, x1: x0 + 0.22, y1: 0.8,
            }],
            hud: null,
            boards: [{
                x0, y0: 0.2, x1: x0 + 0.2, y1: 0.78,
            }, null, null, null, null],
        });
        const { world } = makeWorld('Minimal', { layout: at(0.2) });
        expect(world.hasBoard).toBe(true);
        const cast = vi.spyOn(world, 'castScreen');
        const plungeX = () => cast.mock.calls[cast.mock.calls.length - 1][0];
        world.onLock({ u: 0.5, rows: [10] });
        const first = plungeX();
        world.setLayout(at(0.6));
        world.onLock({ u: 0.5, rows: [10] });
        const second = plungeX();
        // The card moved right: so did the water the piece fell into.
        expect(second).toBeGreaterThan(first + 0.2);
        world.onLock({ u: 0.5, rows: [10], player: 3 });
        expect(plungeX()).toBe(second);
        // The board gone: back to aiming at where the solo board would be.
        world.setLayout(null);
        expect(world.hasBoard).toBe(false);
        world.onLock({ u: 0.5, rows: [10] });
        expect(plungeX()).toBeGreaterThan(0);
        expect(plungeX()).toBeLessThan(1);
        expect(world.getState().locks).toBe(4);
    });

    it('never holds more rings or ribbons than its tier pays for, and keeps them in order of birth', () => {
        const { camera, world } = makeWorld('Minimal');
        const { rings: maxRings, ribbons: maxRibbons } = world.tier;
        const ringSlots = [...world.ringRows];
        const ribbonSlots = [...world.ribbonRows];
        const births = [];
        for (let i = 0; i < maxRibbons * 3; i++) {
            run(world, camera, 3 * DT);
            world.onLock({ u: (i % 10) / 10 + 0.05, rows: [19 - (i % 12)], hardDrop: i % 2 === 0 });
            births.push(world.clock);
            expect(world.ringCount).toBe(Math.min(i + 1, maxRings));
            expect(world.ribbonCount).toBe(Math.min(i + 1, maxRibbons));
            expect(world.dripCount).toBeLessThanOrEqual(maxRibbons);
            // The oldest went first: what is left is the latest, oldest to newest.
            expect(rings(world).map((row) => row[2])).toEqual(births.slice(-maxRings));
            expect(ribbons(world).map(([head]) => head[2])).toEqual(births.slice(-maxRibbons));
        }
        // The tables are the vectors the water's uniforms were built from: never replaced, never more.
        expect(world.ringRows).toHaveLength(maxRings);
        expect(world.ribbonRows).toHaveLength(maxRibbons * 2);
        world.ringRows.forEach((row, i) => expect(row).toBe(ringSlots[i]));
        world.ribbonRows.forEach((row, i) => expect(row).toBe(ribbonSlots[i]));
        frame(world, camera, DT);
        expect(world.U.counts.value.toArray().slice(0, 2)).toEqual([maxRings, maxRibbons]);
        expect(thrown(world)).toBeLessThanOrEqual(world.spray.count);
        // Every stain still on its way to the lip gets there and falls, once: none is left waiting.
        const rain = vi.spyOn(world.spray, 'throwLip');
        const waiting = world.dripCount;
        run(world, camera, 40);
        expect(world.dripCount).toBe(0);
        expect(rain).toHaveBeenCalledTimes(waiting);
        expect(world.drips).toHaveLength(maxRibbons);
    });

    it('lets a ring and a ribbon run their course, the older one first', () => {
        const { camera, world } = makeWorld('Low');
        world.onLock({ u: 0.3, rows: [19], color: '#ff7b52' });
        run(world, camera, 1);
        world.onLock({ u: 0.7, rows: [19], color: '#7eeeff' });
        const second = world.clock;
        // Neither is gone the moment after.
        run(world, camera, 0.5);
        expect(world.getState()).toMatchObject({ rings: 2, ribbons: 2 });
        const seen = { rings: new Set([2]), ribbons: new Set([2]) };
        let frames = 0;
        while ((world.ringCount > 0 || world.ribbonCount > 0) && frames < 60 * 60) {
            frame(world, camera, DT);
            frames += 1;
            seen.rings.add(world.ringCount);
            seen.ribbons.add(world.ribbonCount);
            // While one of two is left it is the later one.
            if (world.ringCount === 1) expect(rings(world)[0][2]).toBe(second);
            if (world.ribbonCount === 1) expect(ribbons(world)[0][0][2]).toBe(second);
        }
        expect(world.getState()).toMatchObject({ rings: 0, ribbons: 0 });
        expect([...seen.rings]).toEqual([2, 1, 0]);
        expect([...seen.ribbons]).toEqual([2, 1, 0]);
        expect(world.U.counts.value.toArray().slice(0, 2)).toEqual([0, 0]);
        // A new lock starts the tables again from their first row.
        world.onLock({ u: 0.5, rows: [19] });
        expect(rings(world)).toHaveLength(1);
        expect(rings(world)[0][2]).toBe(world.clock);
    });

    it('lets a stain that reaches the lip fall from it as rain of the piece\'s colour, once', () => {
        const { camera, world } = makeWorld('Medium');
        // A piece whose stain starts on the wave (not past the lip's edge) has a way to go to the edge.
        let staining = null;
        for (const u of [0.1, 0.3, 0.5, 0.7, 0.9]) {
            const before = world.getState().drips;
            world.onLock({ u, rows: [14], color: '#ff2020' });
            if (world.getState().drips > before) {
                staining = u;
                break;
            }
        }
        expect(staining, 'no column of the solo board stains the wall').not.toBeNull();
        expect(world.getState().drips).toBe(1);
        const [drip] = world.drips;
        expect(drip.at).toBeGreaterThan(world.clock);
        const rain = vi.spyOn(world.spray, 'throwLip');
        let frames = 0;
        while (world.getState().drips > 0 && frames < 60 * 60) {
            frame(world, camera, DT);
            frames += 1;
        }
        expect(world.getState().drips).toBe(0);
        expect(rain).toHaveBeenCalledOnce();
        // It fell when the ribbon got there, from the lip, in the piece's red.
        expect(world.clock).toBeGreaterThanOrEqual(drip.at);
        expect(world.clock - drip.at).toBeLessThan(2 * DT);
        const [when, , options] = rain.mock.calls[0];
        expect(when).toBe(world.clock);
        expect(options.n).toBeGreaterThan(0);
        expect(options.rgb[0]).toBeGreaterThan(options.rgb[1]);
        expect(options.rgb[0]).toBeGreaterThan(options.rgb[2]);
        expect(options.to).toBeGreaterThan(options.from);
        run(world, camera, 2);
        expect(rain).toHaveBeenCalledOnce();
    });
});

describe('waves world: where a lock is aimed', () => {
    const SHAPES = [[1600, 900], [1920, 1080], [2560, 1080], [1280, 800], [1024, 768], [430, 932], [932, 430]];
    const cells = [];
    for (const u of [0, 0.1, 0.5, 0.9, 1]) for (const row of [0, 6, 12, 19]) cells.push([u, row]);
    const inside = (p, rect) => p.x > rect.x0 && p.x < rect.x1 && p.y > rect.y0 && p.y < rect.y1;

    it('keeps the stain and the plunge on the screen for every window and every cell of the board', () => {
        const off = [];
        for (const [width, height] of SHAPES) {
            const layout = fallbackLayout(width, height);
            const [card] = layout.cards;
            const [board] = layout.boards;
            for (const [u, row] of cells) {
                const piece = boardPoint(board, u, row);
                const aims = { stain: aimStain(card, piece, u, row), plunge: aimPlunge(card, piece, u) };
                for (const [name, aim] of Object.entries(aims)) {
                    if (!(aim.x >= 0 && aim.x <= 1 && aim.y >= 0 && aim.y <= 1)) {
                        off.push(`${width}x${height}, u ${u}, row ${row}: ${name} at (${aim.x}, ${aim.y})`);
                    }
                }
            }
        }
        expect(off).toEqual([]);
    });

    it('starts the stain beside the card on a wide screen, in plain view, a different arc for every piece', () => {
        for (const [width, height] of SHAPES.filter(([w, h]) => w / h > 1.5)) {
            const layout = fallbackLayout(width, height);
            const [card] = layout.cards;
            const [board] = layout.boards;
            const where = `${width}x${height}`;
            const starts = cells.map(([u, row]) => ({ ...aimStain(card, boardPoint(board, u, row), u, row) }));
            // Never behind the card, where it could not be seen: left of it, above its middle.
            expect(starts.filter((p) => inside(p, card)), where).toEqual([]);
            expect(starts.every((p) => p.x < card.x0 && p.y < (card.y0 + card.y1) / 2), where).toBe(true);
            // The column and the row each move it.
            const at = (u, row) => aimStain(card, boardPoint(board, u, row), u, row);
            const column = Math.hypot(at(0.1, 10).x - at(0.9, 10).x, at(0.1, 10).y - at(0.9, 10).y);
            const depth = Math.hypot(at(0.5, 2).x - at(0.5, 18).x, at(0.5, 2).y - at(0.5, 18).y);
            expect(column, where).toBeGreaterThan(0.005);
            expect(depth, where).toBeGreaterThan(0.005);
        }
    });

    it('puts the plunge beside or below the card when there is water to be seen there', () => {
        for (const [width, height] of SHAPES.filter(([w, h]) => w / h > 1.2)) {
            const layout = fallbackLayout(width, height);
            const [card] = layout.cards;
            const [board] = layout.boards;
            const where = `${width}x${height}`;
            const at = (u) => ({ ...aimPlunge(card, boardPoint(board, u, 19), u) });
            for (const u of [0, 0.1, 0.4, 0.6, 0.9, 1]) expect(inside(at(u), card), `${where}, u ${u}`).toBe(false);
            // A piece on the left goes in left of one on the right.
            expect(at(0.1).x, where).toBeLessThan(at(0.9).x);
        }
    });

    it('starts the stain over a card that fills the width, or behind the piece when it fills the height too', () => {
        // A card with no room beside it: a phone held upright.
        const roomAbove = {
            x0: 0.03, y0: 0.25, x1: 0.97, y1: 0.8,
        };
        const noRoom = {
            x0: 0.03, y0: 0.01, x1: 0.97, y1: 0.99,
        };
        for (const [u, row] of cells) {
            const piece = { x: 0.1 + 0.8 * u, y: 0.3 + 0.02 * row };
            const over = aimStain(roomAbove, piece, u, row);
            // Above the card, over the piece's own column.
            expect(over.x).toBe(piece.x);
            expect(over.y).toBeLessThan(roomAbove.y0);
            expect(over.y).toBeGreaterThan(0);
            // Nowhere to show it: behind the piece itself.
            expect(aimStain(noRoom, piece, u, row)).toEqual(piece);
        }
        // With room on its left the same card is left alone: the stain starts beside it.
        const beside = {
            x0: 0.35, y0: 0.25, x1: 0.65, y1: 0.8,
        };
        const piece = { x: 0.5, y: 0.6 };
        expect(aimStain(beside, piece, 0.5, 10).x).toBeLessThan(beside.x0);
        expect(aimStain(beside, piece, 0.5, 10).y).toBeLessThan((beside.y0 + beside.y1) / 2);
    });

    it('plunges under the column when the card leaves water below it, else beside the card\'s foot', () => {
        const short = {
            x0: 0.35, y0: 0.1, x1: 0.65, y1: 0.75,
        };
        const tall = {
            x0: 0.35, y0: 0.02, x1: 0.65, y1: 0.97,
        };
        const full = {
            x0: 0.03, y0: 0.02, x1: 0.97, y1: 0.97,
        };
        for (const u of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
            const piece = { x: 0.35 + 0.3 * u, y: 0.7 };
            // Water below the card: straight down from the piece's column, into that strip.
            const under = aimPlunge(short, piece, u);
            expect(under.x).toBe(piece.x);
            expect(under.y).toBeGreaterThan(short.y1);
            expect(under.y).toBeLessThan(1);
            // The card reaches the foot of the screen: beside it, on the side the column is nearer.
            const aside = aimPlunge(tall, piece, u);
            if (u < 0.5) expect(aside.x).toBeLessThan(tall.x0);
            else expect(aside.x).toBeGreaterThan(tall.x1);
            expect(aside.x).toBeGreaterThan(0);
            expect(aside.x).toBeLessThan(1);
            expect(aside.y).toBeGreaterThan((tall.y0 + tall.y1) / 2); // low: at its foot
            // No room below and none beside: under the column all the same, at the very foot.
            const squeezed = aimPlunge(full, { x: 0.03 + 0.94 * u, y: 0.7 }, u);
            expect(squeezed.x).toBe(0.03 + 0.94 * u);
            expect(squeezed.y).toBeGreaterThan(full.y1);
            expect(squeezed.y).toBeLessThan(1);
        }
        // Further from the middle column is further out from the card's foot.
        const piece = { x: 0.5, y: 0.7 };
        expect(aimPlunge(tall, piece, 0.1).x).toBeLessThan(aimPlunge(tall, piece, 0.4).x);
        expect(aimPlunge(tall, piece, 0.9).x).toBeGreaterThan(aimPlunge(tall, piece, 0.6).x);
    });

    it('writes into what it is given', () => {
        const layout = fallbackLayout(1600, 900);
        const piece = boardPoint(layout.boards[0], 0.3, 12);
        const out = { x: 9, y: 9 };
        expect(aimStain(layout.cards[0], piece, 0.3, 12, out)).toBe(out);
        expect(out).toEqual(aimStain(layout.cards[0], piece, 0.3, 12));
        expect(aimPlunge(layout.cards[0], piece, 0.3, out)).toBe(out);
        expect(out).toEqual(aimPlunge(layout.cards[0], piece, 0.3));
    });
});

describe('waves world: clears', () => {
    it.each([1, 2, 3, 4])('sends a band of light down the tube for each of %s lines, and the lip throws', (lines) => {
        const { camera, world } = makeWorld('Low');
        const throwLip = vi.spyOn(world.spray, 'throwLip');
        const rest = { ...world.getPostState() };
        expect(liveBands(world)).toHaveLength(0);
        world.onClear({ rows: [19, 18, 17, 16].slice(0, lines), lines });
        expect(world.getState().clears).toBe(1);
        // One band a line, one after another from this moment.
        const bands = bySlotless(liveBands(world));
        expect(bands).toHaveLength(lines);
        expect(bands[0][0]).toBe(world.clock);
        for (let i = 1; i < bands.length; i++) expect(bands[i][0]).toBeGreaterThan(bands[i - 1][0]);
        for (const [, strength, width] of bands) {
            expect(strength).toBeGreaterThan(0);
            expect(width).toBeGreaterThan(0);
        }
        // The lip throws a sheet of spray off its edge.
        expect(throwLip).toHaveBeenCalled();
        expect(throwLip.mock.calls[0][0]).toBe(world.clock);
        expect(thrown(world)).toBeGreaterThan(0);
        // On the next frame the barrel has opened a little, the water is lit and the lip tears.
        frame(world, camera, DT);
        expect(world.U.open.value).toBeGreaterThan(0);
        expect(world.getState().landing).toBeLessThan(landingDistance(0));
        expect(world.U.glow.value).toBeGreaterThan(0);
        expect(world.U.tear.value).toBeGreaterThan(0);
        expect(world.getPostState().flash).toBeGreaterThan(rest.flash);
        expect(world.getPostState().bloomBoost).toBeGreaterThan(rest.bloomBoost);
        // Only four lines hold the wave.
        expect(world.getState().holding).toBe(lines === 4);
        // Long after, the barrel is back at rest and the bands have run out of tube.
        run(world, camera, 40);
        expect(liveBands(world)).toHaveLength(0);
        expect(world.U.open.value).toBeLessThan(1e-3);
        expect(world.U.glow.value).toBeLessThan(1e-3);
        expect(world.U.tear.value).toBeLessThan(1e-3);
        expect(world.getState().holding).toBe(false);
    });

    it('answers more lines with more: a wider opening, more light, more spray', () => {
        const after = (lines) => {
            const { camera, world } = makeWorld('Low');
            world.onClear({ lines });
            frame(world, camera, DT);
            return {
                open: world.U.open.value, glow: world.U.glow.value, tear: world.U.tear.value, spray: thrown(world),
            };
        };
        const results = [1, 2, 3, 4].map(after);
        for (let i = 1; i < results.length; i++) {
            expect(results[i].open).toBeGreaterThan(results[i - 1].open);
            expect(results[i].glow).toBeGreaterThanOrEqual(results[i - 1].glow);
            expect(results[i].tear).toBeGreaterThanOrEqual(results[i - 1].tear);
            expect(results[i].spray).toBeGreaterThan(results[i - 1].spray);
        }
        expect(results[3].glow).toBeGreaterThan(results[0].glow);
        for (const { open, tear } of results) {
            expect(open).toBeLessThanOrEqual(1);
            expect(tear).toBeLessThanOrEqual(1);
        }
    });

    it('reads nonsense as one line and more than four as four, and never runs out of bands', () => {
        const { camera, world } = makeWorld('Low');
        for (const lines of [NaN, undefined, null, 0, -3]) {
            world.resetSession();
            world.onClear({ lines });
            expect(liveBands(world), String(lines)).toHaveLength(1);
        }
        world.resetSession();
        world.onClear({});
        expect(liveBands(world)).toHaveLength(1);
        world.resetSession();
        world.onClear({ lines: 9 });
        expect(liveBands(world)).toHaveLength(4);
        expect(world.getState().holding).toBe(true);
        // Clear after clear, faster than the bands run out: the oldest are overwritten.
        for (let i = 0; i < 12; i++) {
            world.onClear({ lines: 3 });
            frame(world, camera, DT);
            expect(liveBands(world).length).toBeLessThanOrEqual(BAND_SLOTS);
            expect(world.bandRows).toHaveLength(BAND_SLOTS);
        }
        // However many clears, the opening, the light and the tearing stay in range.
        expect(world.U.open.value).toBeLessThanOrEqual(1);
        expect(world.U.tear.value).toBeLessThanOrEqual(1);
        expect(world.U.warm.value).toBeLessThanOrEqual(1);
        expect(Number.isFinite(world.U.glow.value)).toBe(true);
        // The counters are per run: 1 + 12 since the last resetSession.
        expect(world.getState().clears).toBe(13);
    });

    // SUSPECTED BUG (waves-world.js, onClear): `lines` is clamped with Math.max(1, Math.min(4, c.lines || 1)),
    // which lets anything truthy that is not a number through as NaN. No band is written, and NaN is added
    // into state.openKick, state.glow, state.tear and state.flash, where it stays: U.open, U.glow and U.tear
    // are NaN on every frame from then on (the wave's shape reads U.open), until resetSession(). The
    // director only ever sends 1..4, so nothing in the game reaches this; a caller that passes a string does.
    it('reads a line count that is not a number as one line, and keeps its uniforms finite', () => {
        const { camera, world } = makeWorld('Low');
        world.onClear({ lines: 'x' });
        frame(world, camera, DT);
        const finite = [world.U.open.value, world.U.glow.value, world.U.tear.value].every(Number.isFinite);
        expect([liveBands(world).length, finite]).toEqual([1, true]);
    });

    it('turns a wheel of spray off the walls for a T-spin, and tears the lip all the way', () => {
        const plain = makeWorld('Low');
        const spun = makeWorld('Low');
        const wheel = vi.spyOn(spun.world.spray, 'swirl');
        const none = vi.spyOn(plain.world.spray, 'swirl');
        plain.world.onClear({ lines: 2 });
        spun.world.onClear({ lines: 2, tspin: true });
        expect(none).not.toHaveBeenCalled();
        expect(wheel).toHaveBeenCalledOnce();
        const [when, , options] = wheel.mock.calls[0];
        expect(when).toBe(spun.world.clock);
        expect(options.n).toBeGreaterThan(0);
        // Ahead of the eye, in the tube.
        expect(options.d).toBeGreaterThan(0);
        expect(thrown(spun.world)).toBeGreaterThan(thrown(plain.world));
        // Its bands are screws of light: the plain clear's are rings.
        expect(liveBands(spun.world).every((band) => band[3] !== 0)).toBe(true);
        expect(liveBands(plain.world).every((band) => band[3] === 0)).toBe(true);
        frame(plain.world, plain.camera, DT);
        frame(spun.world, spun.camera, DT);
        expect(spun.world.U.tear.value).toBeGreaterThan(plain.world.U.tear.value);
    });
});

describe('waves world: four lines hold the wave', () => {
    it('shapes the hold as a dip in the clock\'s speed: down to its floor and back to one', () => {
        expect(HOLD_SCALE).toBeGreaterThan(0);
        expect(HOLD_SCALE).toBeLessThan(1);
        expect(HOLD_SECONDS).toBeGreaterThan(0);
        // Outside a hold the clock runs as it always does.
        for (const age of [-1, -0.001, HOLD_SECONDS, HOLD_SECONDS + 5, NaN, undefined]) expect(holdScale(age)).toBe(1);
        let slowest = 1;
        let previous = holdScale(0);
        let sum = 0;
        const steps = 2000;
        for (let i = 0; i <= steps; i++) {
            const scale = holdScale((HOLD_SECONDS * i) / steps);
            expect(scale).toBeGreaterThanOrEqual(HOLD_SCALE - 1e-12);
            expect(scale).toBeLessThanOrEqual(1);
            // No jolt on the way in or on the way out.
            expect(Math.abs(scale - previous)).toBeLessThan(0.05);
            previous = scale;
            slowest = Math.min(slowest, scale);
            sum += scale / (steps + 1);
        }
        expect(slowest).toBeCloseTo(HOLD_SCALE, 6);
        // It ends where it left off: at full speed.
        expect(previous).toBeCloseTo(1, 2);
        // A real hold: on the whole the clock loses time.
        expect(sum).toBeLessThan(0.9);
    });

    it('slows the world\'s clock under the frame\'s time for the hold, then runs on without catching up', () => {
        const { camera, world } = makeWorld('Low');
        run(world, camera, 1);
        expect(world.clock).toBeCloseTo(world.time, 9);
        const t0 = world.time;
        const c0 = world.clock;
        world.onClear({ rows: [19, 18, 17, 16], lines: 4 });
        expect(world.getState().holding).toBe(true);
        // Frame by frame the clock takes the share of the frame the hold allows.
        let age = 0;
        let slowest = 1;
        let frames = 0;
        while (age < HOLD_SECONDS) {
            const before = world.clock;
            expect(world.getState().holding).toBe(true);
            frame(world, camera, DT);
            const step = world.clock - before;
            expect(step).toBeCloseTo(DT * holdScale(age), 12);
            expect(step).toBeLessThanOrEqual(DT + 1e-12);
            expect(world.U.time.value).toBe(world.clock);
            slowest = Math.min(slowest, step / DT);
            age += DT;
            frames += 1;
        }
        expect(frames).toBeGreaterThan(10);
        expect(world.getState().holding).toBe(false);
        // Almost to a stop at its deepest...
        expect(slowest).toBeLessThan((1 + HOLD_SCALE) / 2);
        expect(slowest).toBeGreaterThanOrEqual(HOLD_SCALE - 1e-9);
        // ...and the time it lost is lost: the frame's time has run on, the clock is behind it.
        const lost = (world.time - t0) - (world.clock - c0);
        expect(lost).toBeGreaterThan(0.1);
        expect(world.time - t0).toBeCloseTo(frames * DT, 9);
        // From here it runs at full speed again, and stays as far behind as it was.
        const before = world.clock;
        run(world, camera, 2);
        expect(world.clock - before).toBeCloseTo(2, 9);
        expect((world.time - t0) - (world.clock - c0)).toBeCloseTo(lost, 9);
        expect(world.getState()).toMatchObject({ holding: false, time: world.time, clock: world.clock });
    });

    it('stamps what happens inside a hold with the held clock, so it holds with everything else', () => {
        const { camera, world } = makeWorld('Low');
        world.onClear({ lines: 4 });
        run(world, camera, HOLD_SECONDS / 2);
        expect(world.clock).toBeLessThan(world.time);
        world.onLock({ u: 0.4, rows: [19], color: '#87ffd6' });
        expect(rings(world)[rings(world).length - 1][2]).toBe(world.clock);
        expect(ribbons(world)[0][0][2]).toBe(world.clock);
        // The spray the lock throws leaves on the same clock the shader flies it by.
        const start = world.spray.geometry.getAttribute('aStart');
        let latest = -Infinity;
        for (let i = 0; i < world.spray.count; i++) latest = Math.max(latest, start.getW(i));
        expect(latest).toBeLessThan(world.clock + 1);
        expect(latest).toBeLessThan(world.time);
    });

    it('holds for a perfect clear whatever it cleared, sends the whole pod and turns the evening to gold', () => {
        const plain = makeWorld('High');
        const perfect = makeWorld('High');
        plain.world.onClear({ rows: [19], lines: 1 });
        perfect.world.onClear({ rows: [19], lines: 1, perfect: true });
        expect(plain.world.getState()).toMatchObject({ holding: false, leaps: 0 });
        expect(perfect.world.getState()).toMatchObject({ holding: true, leaps: perfect.world.pod.count });
        expect(thrown(perfect.world)).toBeGreaterThan(thrown(plain.world));
        frame(plain.world, plain.camera, DT);
        frame(perfect.world, perfect.camera, DT);
        const gold = perfect.world.U.warm.value;
        expect(gold).toBeGreaterThan(plain.world.U.warm.value);
        expect(gold).toBeLessThanOrEqual(1);
        // The pod goes over the water one after another, the first across the sun.
        const starts = perfect.world.pod.arcs.map((arc) => arc.t0);
        expect(perfect.world.pod.arcs.every((arc) => arc.active)).toBe(true);
        expect(starts.every((t, i) => t > perfect.world.clock - DT && (i === 0 || t > starts[i - 1]))).toBe(true);
        let most = 0;
        run(perfect.world, perfect.camera, 8, () => { most = Math.max(most, perfect.world.getState().airborne); });
        expect(most).toBeGreaterThan(1);
        // A four-line clear that is not perfect warms it less than one that is.
        const quad = makeWorld('High');
        quad.world.onClear({ lines: 4 });
        frame(quad.world, quad.camera, DT);
        expect(quad.world.getState()).toMatchObject({ holding: true, leaps: 0 });
        expect(quad.world.U.warm.value).toBeGreaterThan(plain.world.U.warm.value);
        expect(quad.world.U.warm.value).toBeLessThan(gold);
    });

    it('does not hold the clock under reduced motion, and keeps the rest of the answer', () => {
        const { camera, world } = makeWorld('Low');
        world.setReducedMotion(true);
        world.onClear({ lines: 4 });
        expect(liveBands(world)).toHaveLength(4);
        expect(thrown(world)).toBeGreaterThan(0);
        const t0 = world.time;
        const c0 = world.clock;
        // Every frame of what would have been the hold is a whole frame of the clock.
        const steps = [];
        let last = world.clock;
        run(world, camera, HOLD_SECONDS + 1, () => {
            steps.push(world.clock - last);
            last = world.clock;
        });
        expect(steps.slice(1).every((step) => Math.abs(step - DT) < 1e-12)).toBe(true);
        expect(world.clock - c0).toBeCloseTo(world.time - t0, 9);
        expect(world.getState().holding).toBe(false);
        expect(world.U.glow.value).toBeGreaterThan(0);
        // Anything but true is not reduced: the next four lines hold again.
        world.setReducedMotion('yes');
        expect(world.reducedMotion).toBe(false);
        world.onClear({ lines: 4 });
        const before = world.clock;
        run(world, camera, HOLD_SECONDS);
        expect(world.clock - before).toBeLessThan(HOLD_SECONDS - 0.1);
    });
});

describe('waves world: chains', () => {
    it('rates a chain\'s hold on the barrel between shut and wide open, wider for a longer chain', () => {
        expect(openForCombo(0)).toBe(0);
        expect(openForCombo(1)).toBe(0); // a single clear is not a chain
        expect(openForCombo(-3)).toBe(0);
        let previous = 0;
        for (let combo = 2; combo <= 20; combo++) {
            const open = openForCombo(combo);
            expect(open).toBeGreaterThan(previous);
            expect(open).toBeLessThanOrEqual(1);
            previous = open;
        }
        expect(previous).toBeGreaterThan(0.9);
    });

    it('eases the barrel open toward what the chain holds, and lets it fall shut when the chain breaks', () => {
        const { camera, world } = makeWorld('Low');
        // A single clear is not a chain.
        world.onCombo(1);
        run(world, camera, 5);
        expect(world.getState()).toMatchObject({ combo: 1, open: 0 });
        let previous = 0;
        for (const combo of [2, 4, 7, 12]) {
            world.onCombo(combo);
            expect(world.combo).toBe(combo);
            // Eased, never snapped: a frame later it has only begun to move.
            frame(world, camera, DT);
            expect(world.U.open.value).toBeLessThan(previous + (openForCombo(combo) - previous) * 0.5);
            const opening = [];
            run(world, camera, 12, () => opening.push(world.U.open.value));
            expect(opening.every((open, i) => i === 0 || open >= opening[i - 1] - 1e-12), `combo ${combo}`).toBe(true);
            expect(world.U.open.value).toBeCloseTo(openForCombo(combo), 3);
            expect(world.U.open.value).toBeGreaterThan(previous);
            expect(world.getState().landing).toBeCloseTo(landingDistance(openForCombo(combo)), 2);
            previous = world.U.open.value;
        }
        // The chain lights the water and leans the evening toward gold, within their ranges.
        expect(world.U.glow.value).toBeGreaterThan(0);
        expect(world.U.warm.value).toBeGreaterThan(0);
        expect(world.U.warm.value).toBeLessThanOrEqual(1);
        expect(world.U.tear.value).toBeGreaterThan(0);
        expect(world.getPostState().bloomBoost).toBeGreaterThan(0);
        expect(world.getPostState().warm).toBe(world.U.warm.value);
        // It breaks: everything it held lets go, not at once.
        world.onCombo(0);
        expect(world.combo).toBe(0);
        frame(world, camera, DT);
        expect(world.U.open.value).toBeGreaterThan(previous * 0.5);
        const closing = [];
        run(world, camera, 40, () => closing.push(world.U.open.value));
        expect(closing.every((open, i) => i === 0 || open <= closing[i - 1] + 1e-12)).toBe(true);
        expect(world.U.open.value).toBeLessThan(1e-3);
        expect(world.U.glow.value).toBeLessThan(1e-3);
        expect(world.U.warm.value).toBeLessThan(1e-3);
        expect(world.getState().landing).toBeCloseTo(landingDistance(0), 2);
    });

    it('reads nonsense as no chain', () => {
        const { world } = makeWorld('Minimal');
        for (const junk of [NaN, undefined, null, -4, 'x', {}]) {
            world.onCombo(junk);
            expect(world.combo, String(junk)).toBe(0);
        }
        world.onCombo('3');
        expect(world.combo).toBe(3);
        world.onCombo(2.9);
        expect(world.combo).toBe(2);
        expect(world.getState().combo).toBe(2);
    });

    it('calls the dolphins as the chain grows, and not again until they have had their moment', () => {
        const { camera, world } = makeWorld('High');
        const one = chainFor(1);
        const two = chainFor(2);
        expect(two).toBeGreaterThan(one);
        // Short of a chain that calls them: nobody.
        if (one > 1) {
            world.onCombo(one - 1);
            expect(world.getState().leaps).toBe(0);
        }
        world.onCombo(one);
        expect(world.getState().leaps).toBe(1);
        const [first] = world.pod.arcs;
        expect(first.active).toBe(true);
        expect(first.t0).toBeGreaterThan(world.clock); // it breaks the surface in a moment, not this frame
        // The chain grows at once: the pod has just been called, so it is not called again...
        world.onCombo(two);
        expect(world.getState()).toMatchObject({ leaps: 1, combo: two });
        // ...and holding the chain, or letting it slip, calls nobody either.
        run(world, camera, 30);
        world.onCombo(two);
        world.onCombo(one);
        expect(world.getState().leaps).toBe(1);
        // Later, a longer chain calls as many as its length is worth.
        world.onCombo(two);
        expect(world.getState().leaps).toBe(1 + Math.min(leapersFor(two), world.pod.count));
        run(world, camera, 30);
        const most = chainFor(leapersFor(1000));
        world.onCombo(most);
        expect(world.getState().leaps).toBe(1 + leapersFor(two) + Math.min(leapersFor(most), world.pod.count));
        // A broken chain calls nobody.
        run(world, camera, 30);
        world.onCombo(0);
        expect(world.getState().leaps).toBe(1 + leapersFor(two) + Math.min(leapersFor(most), world.pod.count));
    });

    it('never calls more dolphins than its tier has', () => {
        const { world } = makeWorld('Minimal');
        const most = leapersFor(1000);
        world.onCombo(chainFor(most));
        expect(world.getState().leaps).toBe(Math.min(most, world.pod.count));
        expect(world.getState().leaps).toBeLessThanOrEqual(QUALITY.Minimal.dolphins);
        // Asked for outright: none for none, the whole pod at most.
        const fresh = makeWorld('Minimal');
        fresh.world.sendPod(0, false);
        expect(fresh.world.getState().leaps).toBe(0);
        fresh.world.sendPod(100, false);
        expect(fresh.world.getState().leaps).toBe(fresh.world.pod.count);
    });

    it('sends each dolphin over the water and back into it: a crown and a ring where it breaks the surface', () => {
        const { camera, world } = makeWorld('High');
        const splash = vi.spyOn(world, 'onSplash');
        const ring = vi.spyOn(world, 'addRing');
        world.onCombo(chainFor(2));
        const sent = world.getState().leaps;
        expect(sent).toBe(2);
        const flights = world.pod.arcs.filter((arc) => arc.active).map((arc) => ({ ...arc }));
        expect(flights).toHaveLength(2);
        let most = 0;
        const sprayBefore = thrown(world);
        run(world, camera, Math.max(...flights.map((arc) => arc.t0 + arc.flight)) - world.clock + 2, () => {
            most = Math.max(most, world.getState().airborne);
        });
        expect(most).toBe(2);
        expect(world.getState().airborne).toBe(0);
        // Twice each: leaving the face, and going back in.
        expect(splash).toHaveBeenCalledTimes(4);
        expect(ring).toHaveBeenCalledTimes(4);
        expect(thrown(world)).toBeGreaterThan(sprayBefore);
        for (const arc of flights) {
            const leaves = arc.z;
            const lands = arc.z + arc.vz * arc.flight;
            const here = (z) => Math.abs(z - leaves) < 1e-9 || Math.abs(z - lands) < 1e-9;
            const calls = splash.mock.calls.filter(([, , z]) => here(z));
            expect(calls).toHaveLength(2);
            const [[x0, y0], [x1, y1]] = calls;
            expect([x0, y0]).toEqual([arc.x, arc.y]);
            expect(y1).toBe(0);
            expect(x1).toBeLessThan(x0); // out of the wave, into the sea in front of it
        }
        // Each ring is laid on the water at the splash's own distance, on the world's clock.
        for (const [u, z, strength] of ring.mock.calls) {
            expect(Number.isFinite(u)).toBe(true);
            expect(z).toBeLessThan(0);
            expect(strength).toBeGreaterThan(0);
        }
    });

    it('throws the first dolphin of a long chain across the sun', () => {
        const { world } = makeWorld('High');
        world.onCombo(chainFor(leapersFor(1000)));
        const [hero, second] = world.pod.arcs;
        const sun = world.sunDir;
        const offLine = (arc) => {
            const t = arc.vy / GRAVITY; // the top of the arc
            const rise = arc.vy * t - 0.5 * GRAVITY * t * t;
            const top = new THREE.Vector3(arc.x + arc.vx * t, arc.y + rise, arc.z + arc.vz * t);
            const rel = top.sub(new THREE.Vector3(EYE.x, EYE.y, EYE.z));
            return rel.clone().sub(sun.clone().multiplyScalar(rel.dot(sun))).length();
        };
        // The top of its arc is on the line from the rider's eye to the sun.
        expect(offLine(hero)).toBeLessThan(0.3);
        expect(second.active).toBe(true);
        expect(second.t0).toBeGreaterThan(hero.t0);
        // It leaves the water ahead of the eye and beyond where the lip comes down.
        expect(-hero.z).toBeGreaterThan(landingDistance(world.U.open.value));
        expect(hero.x).toBeGreaterThan(axisOffset(-hero.z));
    });
});

describe('waves world: a new level', () => {
    it('runs a set wave down the tube, from ahead of the eye to behind it, once', () => {
        const { camera, world } = makeWorld('Low');
        const bulge = world.U.bulge.value;
        expect(bulge.y).toBe(0);
        world.levelUp(3);
        expect(world.getState().level).toBe(3);
        const heights = [];
        const places = [];
        run(world, camera, 30, () => {
            heights.push(bulge.y);
            if (bulge.y > 0) places.push(bulge.x);
        });
        // It rises, passes and is gone: one swell, not a ripple.
        const up = heights.filter((y) => y > 0).length;
        expect(up * DT).toBeGreaterThan(0.5);
        expect(up * DT).toBeLessThan(20);
        const peak = heights.indexOf(Math.max(...heights));
        expect(heights.slice(0, peak + 1).every((y, i) => i === 0 || y >= heights[i - 1])).toBe(true);
        expect(heights.slice(peak).every((y, i, tail) => i === 0 || y <= tail[i - 1])).toBe(true);
        expect(Math.min(...heights)).toBe(0);
        expect(heights[heights.length - 1]).toBe(0);
        expect(bulge.y).toBe(0);
        // Small against the tube it runs through.
        expect(Math.max(...heights)).toBeLessThan(0.5);
        // Toward the eye and on past it (the eye is at z = 0, ahead is negative).
        expect(places.every((z, i) => i === 0 || z > places[i - 1])).toBe(true);
        expect(places[0]).toBeLessThan(-WAVE.landAhead);
        expect(places[places.length - 1]).toBeGreaterThan(0);
        expect(bulge.z).toBeGreaterThan(0); // a width, never a division by nothing
        // The lip tears as it passes.
        const again = makeWorld('Low');
        again.world.levelUp(2);
        frame(again.world, again.camera, DT);
        expect(again.world.U.tear.value).toBeGreaterThan(0);
    });

    it('rests on a level silently when told to, and reads nonsense as level one', () => {
        const { camera, world } = makeWorld('Low');
        world.levelUp(7, { silent: true });
        expect(world.getState().level).toBe(7);
        run(world, camera, 2, () => expect(world.U.bulge.value.y).toBe(0));
        expect(world.U.tear.value).toBe(0);
        for (const level of [NaN, 0, -2, undefined, 'x']) {
            world.levelUp(level, { silent: true });
            expect(world.getState().level, String(level)).toBe(1);
        }
        world.levelUp('4');
        expect(world.getState().level).toBe(4);
    });

    it('holds the set wave with the clock when four lines hold it', () => {
        const free = makeWorld('Low');
        const held = makeWorld('Low');
        free.world.levelUp(2);
        held.world.levelUp(2);
        held.world.onClear({ lines: 4 });
        run(free.world, free.camera, HOLD_SECONDS);
        run(held.world, held.camera, HOLD_SECONDS);
        // The held one has not come as far down the tube.
        expect(held.world.U.bulge.value.x).toBeLessThan(free.world.U.bulge.value.x);
    });
});

describe('waves world: time', () => {
    it('runs its clock with the frame\'s time, and stands still on a frame of no time', () => {
        const { camera, world } = makeWorld('Low');
        run(world, camera, 2.5);
        expect(world.time).toBeCloseTo(12.5, 9);
        expect(world.clock).toBeCloseTo(12.5, 9);
        expect(world.U.time.value).toBe(world.clock);
        // The clock follows the deltas it is given, not the time it is told.
        world.onLock({ u: 0.3, hardDrop: true });
        world.onClear({ lines: 2 });
        frame(world, camera, DT);
        const before = picture(world);
        for (let i = 0; i < 5; i++) frame(world, camera, 0);
        expect(picture(world)).toEqual(before);
        // A negative step is no step.
        world.update({ time: world.time, delta: -3 }, camera);
        expect(world.clock).toBe(before.state.clock);
        // Gameplay still lands on a frozen frame.
        world.onLock({ u: 0.6 });
        frame(world, camera, 0);
        expect(world.getState().locks).toBe(2);
        expect(world.getState().rings).toBe(before.state.rings + 1);
    });

    it('empties everything for a new run and leaves the clock where it is', () => {
        const { camera, world } = makeWorld('High');
        run(world, camera, 1);
        world.onLock({ u: 0.3, hardDrop: true, color: '#ffa6e3' });
        world.onLock({ u: 0.7, color: '#6b8dff' });
        world.onClear({ lines: 3, tspin: true });
        world.onCombo(9);
        world.levelUp(4);
        run(world, camera, 1.5);
        world.onClear({ lines: 4, perfect: true });
        run(world, camera, HOLD_SECONDS * 0.6);
        const busy = world.getState();
        expect(busy.rings + busy.ribbons).toBeGreaterThan(2);
        expect(busy).toMatchObject({ combo: 9, holding: true });
        expect(busy.open).toBeGreaterThan(0);
        expect(thrown(world)).toBeGreaterThan(0);
        expect(liveBands(world).length).toBeGreaterThan(0);
        expect(world.pod.arcs.some((arc) => arc.active)).toBe(true);
        const { time, clock } = world;
        expect(clock).toBeLessThan(time); // the hold has already cost it

        world.resetSession();
        // The tables, the air and the chain are empty at once...
        expect(world.getState()).toMatchObject({
            combo: 0, rings: 0, ribbons: 0, drips: 0, airborne: 0, holding: false, time, clock,
        });
        expect(liveBands(world)).toHaveLength(0);
        expect(thrown(world)).toBe(0);
        expect(world.pod.arcs.some((arc) => arc.active)).toBe(false);
        expect(world.getPostState()).toMatchObject({ flash: 0, bloomBoost: 0 });
        // ...and the frame after, the water has been told: the barrel at rest, no light, no set wave.
        frame(world, camera, 0);
        expect(world.getState()).toMatchObject({
            open: 0, warm: 0, glow: 0, landing: landingDistance(0), time, clock,
        });
        expect(world.U.tear.value).toBe(0);
        expect(world.U.bulge.value.y).toBe(0);
        expect(world.U.counts.value.toArray().slice(0, 2)).toEqual([0, 0]);
        expect(world.getPostState()).toMatchObject({ flash: 0, bloomBoost: 0, warm: 0 });
        // Nothing that was in flight comes back.
        const leaps = vi.spyOn(world, 'onSplash');
        const rain = vi.spyOn(world.spray, 'throwLip');
        run(world, camera, 20);
        expect(leaps).not.toHaveBeenCalled();
        expect(rain).not.toHaveBeenCalled();
        expect(world.getState()).toMatchObject({
            rings: 0, ribbons: 0, airborne: 0, holding: false,
        });
        expect(thrown(world)).toBe(0);
        // The clock runs at full speed again.
        expect(world.clock - clock).toBeCloseTo(20, 9);
        // The next run's first chain calls the dolphins at once: the old run's cooldown is forgotten.
        world.onCombo(chainFor(1));
        expect(world.pod.arcs.some((arc) => arc.active)).toBe(true);
    });

    it('puts the world at a time with nothing in flight when it seeks', () => {
        const { camera, world } = makeWorld('High');
        world.onLock({ u: 0.3, hardDrop: true });
        world.onClear({ lines: 4 });
        world.onCombo(9);
        world.levelUp(5);
        run(world, camera, 2);
        expect(world.clock).toBeLessThan(world.time);
        world.seek(42);
        expect(world.getState()).toMatchObject({
            time: 42, clock: 42, combo: 0, rings: 0, ribbons: 0, drips: 0, airborne: 0, holding: false,
        });
        expect(liveBands(world)).toHaveLength(0);
        expect(thrown(world)).toBe(0);
        frame(world, camera, 0);
        expect(world.getState()).toMatchObject({
            time: 42, clock: 42, open: 0, warm: 0, glow: 0,
        });
        expect(world.U.time.value).toBe(42);
        expect(world.U.bulge.value.y).toBe(0);
        // The lens is put where it belongs, not eased there from where it was.
        const view = viewFor(world.aspect, world.hasBoard);
        expect(world.state.yaw).toBe(view.yaw);
        expect(world.state.pitch).toBe(view.pitch);
        // A seek before the start of time is a seek to it.
        world.seek(-5);
        expect(world.time).toBe(0);
        expect(world.clock).toBe(0);
    });

    it('plays the same script to the same picture on two worlds, and to another with another seed', () => {
        const a = makeWorld('Medium');
        const first = play(a.world, a.camera);
        // The script did what it says.
        expect(first.state).toMatchObject({
            locks: 2, clears: 2, combo: 5, level: 2,
        });
        expect(first.state.time).toBeCloseTo(9, 9);
        expect(first.state.clock).toBeLessThan(first.state.time - 0.1); // the four lines held it
        expect(first.bands.filter((band) => band[1] > 0).length).toBeGreaterThan(0);
        expect(first.state.leaps).toBeGreaterThan(0);
        expect(first.rings.length).toBeGreaterThan(0);
        expect(first.ribbons).toHaveLength(2);
        expect(first.spray.every(Number.isFinite)).toBe(true);
        expect(first.pod.every(Number.isFinite)).toBe(true);
        const b = makeWorld('Medium');
        expect(play(b.world, b.camera)).toEqual(first);
        // Another seed throws other drops and sends other leaps; the board's part is the same.
        const c = makeWorld('Medium', { seed: 99 });
        const other = play(c.world, c.camera);
        expect(other.spray).not.toEqual(first.spray);
        expect(other.pod).not.toEqual(first.pod);
        expect(other.ribbons).toEqual(first.ribbons);
        expect(other.state.clock).toBe(first.state.clock);
    });

    it('replays a frame on the same world: seek, then the same script, whatever came before', () => {
        const { camera, world } = makeWorld('Medium');
        const first = play(world, camera);
        // Everything it has been through since.
        world.onCombo(12);
        world.onClear({ lines: 4, perfect: true });
        world.onLock({ u: 0.5, hardDrop: true, color: '#f4ffb5' });
        world.levelUp(5);
        run(world, camera, 5);
        world.setLayout(null);
        frame(world, camera, DT);
        world.setLayout(fallbackLayout(1600, 900));
        const again = play(world, camera);
        // What the water, the air and the lens are given is the same, number for number.
        expect(again.rings).toEqual(first.rings);
        expect(again.ribbons).toEqual(first.ribbons);
        expect(again.uniforms).toEqual(first.uniforms);
        expect(again.spray).toEqual(first.spray);
        expect(again.pod).toEqual(first.pod);
        expect(again.post).toEqual(first.post);
        // The same bands are on their way (in other slots of their table: see the test below).
        expect(bySlotless(again.bands)).toEqual(bySlotless(first.bands));
        // And the same state, but for the counters a seek does not rewind (see the test below).
        const visible = ({
            locks, clears, leaps, ...rest
        }) => rest;
        expect(visible(again.state)).toEqual(visible(first.state));
    });

    // SUSPECTED BUG (waves-world.js, seek / resetSession): neither rewinds the counters `locks`,
    // `clears` and `leaps` (nor `level`), so getState() after seek(t) + the same calls depends on
    // everything the world did before the seek. The playground effect replays on one world and
    // spreads getState() into its diagnostics, so a capture's `locks` grows with every seek.
    it('reports the same state for a replayed frame as for the first', () => {
        const { camera, world } = makeWorld('Low');
        const first = play(world, camera).state;
        expect(play(world, camera).state).toEqual(first);
    });

    // SUSPECTED BUG (waves-world.js, resetSession): the band table's write cursor is not rewound
    // (`bandCursor` stays where the last run left it), so a replayed clear writes the same bands
    // into other slots. The water sums the slots, so the picture differs at most by the order of
    // a float sum, but the table rows are not the rows of the first run.
    it('writes a replayed clear\'s bands into the slots it wrote them into the first time', () => {
        const { camera, world } = makeWorld('Low');
        const first = play(world, camera).bands; // (the test above checks that some are on their way)
        expect(play(world, camera).bands).toEqual(first);
    });
});

describe('waves world: the lens and what the post is told', () => {
    it('rides at the rider\'s eye inside the tube, looking down the line', () => {
        for (const [width, height] of [[1600, 900], [2560, 1080], [430, 932]]) {
            const { camera, world } = makeWorld('Minimal', { width, height });
            const aspect = width / height;
            expect(camera.fov).toBeCloseTo(fovForAspect(aspect), 9);
            expect(camera.near).toBe(REST_RIG.near);
            expect(camera.far).toBe(REST_RIG.far);
            expect(world.aspect).toBeCloseTo(aspect, 12);
            const forward = new THREE.Vector3();
            const strays = [];
            run(world, camera, 40, (i) => {
                if (i % 7) return;
                const { x, y, z } = camera.position;
                // A slow sway, never a wander: at the rig's eye, inside the tube's own section.
                const when = `at ${world.time.toFixed(2)} s`;
                if (!(Math.hypot(x - EYE.x, y - EYE.y, z - EYE.z) < 0.3)) strays.push(`${when}: off the rig`);
                if (!(inTube(camera.position) < 1)) strays.push(`${when}: outside the tube`);
                camera.getWorldDirection(forward);
                if (!(forward.z < -0.5)) strays.push(`${when}: looking away from the line (${forward.z})`);
                if (!(Math.abs(camera.up.x) < 0.05 && camera.up.y > 0.99)) strays.push(`${when}: rolled over`);
            });
            expect(strays, `${width}x${height}`).toEqual([]);
            // The middle of the screen is water somewhere ahead.
            const hit = world.castScreen(0.5, 0.5, {});
            expect(HIT_KINDS).toContain(hit.kind);
            expect(hit.z).toBeLessThan(0);
        }
    });

    it('casts a screen point onto the wave: right of the lens the face, down the trough or the face\'s foot', () => {
        const { world } = makeWorld('Minimal');
        const right = world.castScreen(0.95, 0.5, {});
        expect(right.kind).toBe('wall');
        expect(right.x).toBeGreaterThan(EYE.x);
        const down = world.castScreen(0.5, 0.98, {});
        expect(down.y).toBeLessThan(EYE.y);
        expect(['floor', 'wall']).toContain(down.kind);
        // It writes into what it is given, and into its own scratch object when given nothing.
        const out = {};
        expect(world.castScreen(0.3, 0.3, out)).toBe(out);
        expect(world.castScreen(0.3, 0.3)).toEqual(out);
        expect(world.castScreen(0.3, 0.3)).toBe(world.castScreen(0.6, 0.6));
        // The barrel's opening is the world's own: a wide open barrel lets rays out that the lip stopped.
        const through = (open) => {
            world.U.open.value = open;
            let n = 0;
            for (let x = 0.02; x < 0.5; x += 0.02) {
                for (let y = 0.3; y < 0.9; y += 0.05) if (world.castScreen(x, y, {}).kind !== 'wall') n += 1;
            }
            return n;
        };
        expect(through(1)).toBeGreaterThanOrEqual(through(0));
        world.U.open.value = 0;
    });

    it('leans the view with the pointer', () => {
        const { camera, world } = makeWorld('Minimal');
        const forward = new THREE.Vector3();
        const at = (pointerX, pointerY) => {
            world.updateCamera(camera, {
                time: 10, delta: 0, pointerX, pointerY,
            });
            camera.getWorldDirection(forward);
            return { position: camera.position.clone(), forward: forward.clone() };
        };
        const rest = at(0, 0);
        expect(at(1, 0).position.x).toBeGreaterThan(rest.position.x);
        expect(at(-1, 0).position.x).toBeLessThan(rest.position.x);
        expect(at(1, 0).forward.x).toBeGreaterThan(rest.forward.x);
        expect(at(0, 1).forward.y).not.toBeCloseTo(rest.forward.y, 6);
        expect(at(0, 1).forward.y).toBeLessThan(at(0, -1).forward.y);
        // Never out of the tube, even pushed as far as it goes.
        const corners = [[1, 1], [-1, -1], [1, -1], [-1, 1]];
        for (const [px, py] of corners) expect(inTube(at(px, py).position)).toBeLessThan(1);
        const back = at(0, 0);
        expect(back.position.distanceTo(rest.position)).toBeCloseTo(0, 12);
        expect(back.forward.distanceTo(rest.forward)).toBeCloseTo(0, 12);
    });

    it('keeps the lens still under reduced motion, and keeps the feedback', () => {
        const { camera, world } = makeWorld('Low');
        world.setReducedMotion(true);
        const forward = new THREE.Vector3();
        world.updateCamera(camera, { time: 0, delta: 0 });
        camera.getWorldDirection(forward);
        const still = forward.clone();
        world.onLock({ u: 0.3, hardDrop: true, color: '#ffa6e3' });
        world.onClear({ lines: 4 });
        world.onCombo(8);
        run(world, camera, 3, (i) => {
            world.updateCamera(camera, {
                time: world.time, delta: 0, pointerX: 1, pointerY: -1,
            });
            if (i % 20) return;
            expect(camera.position.x).toBe(EYE.x);
            expect(camera.position.y).toBe(EYE.y);
            expect(camera.position.z).toBe(EYE.z);
            expect(Math.abs(camera.up.x)).toBe(0);
            expect(camera.up.y).toBe(1);
            camera.getWorldDirection(forward);
            expect(forward.distanceTo(still)).toBeCloseTo(0, 9);
        });
        // The water still answers.
        expect(world.getState()).toMatchObject({ locks: 1, clears: 1, combo: 8 });
        expect(world.getState().rings + world.getState().ribbons).toBeGreaterThan(0);
        expect(world.U.open.value).toBeGreaterThan(0);
        expect(thrown(world)).toBeGreaterThan(0);
    });

    it('turns the lens to the new composition when the board comes and goes, eased', () => {
        const { camera, world } = makeWorld('Minimal');
        const withBoard = viewFor(16 / 9, true);
        const without = viewFor(16 / 9, false);
        expect(world.state.yaw).toBe(withBoard.yaw);
        world.setLayout(null);
        frame(world, camera, DT);
        // Not there in a frame...
        expect(Math.abs(world.state.yaw - withBoard.yaw)).toBeLessThan(Math.abs(without.yaw - withBoard.yaw) * 0.5);
        run(world, camera, 10);
        // ...there in a while.
        expect(world.state.yaw).toBeCloseTo(without.yaw, 2);
        expect(world.state.pitch).toBeCloseTo(without.pitch, 2);
        // A frame of no time turns nothing.
        world.setLayout(fallbackLayout(1600, 900));
        const { yaw } = world.state;
        frame(world, camera, 0);
        expect(world.state.yaw).toBe(yaw);
    });

    it('follows the frame\'s shape, and ignores a degenerate one', () => {
        const { camera, world } = makeWorld('Minimal');
        world.setViewport(430, 932, 430 / 932);
        expect(world.viewport).toEqual({ w: 430, h: 932 });
        expect(world.aspect).toBeCloseTo(430 / 932, 12);
        expect(camera.aspect).toBeCloseTo(430 / 932, 12);
        expect(camera.fov).toBeCloseTo(fovForAspect(430 / 932), 9);
        world.setViewport(0, 0, NaN);
        world.setViewport(-5, 100, -2);
        expect(world.aspect).toBeCloseTo(430 / 932, 12);
        expect(world.viewport.w).toBeGreaterThanOrEqual(1);
        expect(world.viewport.h).toBeGreaterThanOrEqual(1);
        // The layout call may carry the aspect too; nonsense leaves it be.
        world.setLayout(null, 16 / 9);
        expect(world.aspect).toBeCloseTo(16 / 9, 12);
        world.setLayout(null, NaN);
        world.setLayout(null, 0);
        expect(world.aspect).toBeCloseTo(16 / 9, 12);
    });

    it('hands the post finite numbers in range, whatever the board does', () => {
        const { camera, world } = makeWorld('Low');
        expect(world.getPostState()).toMatchObject({ flash: 0, bloomBoost: 0, warm: 0 });
        const keys = ['flash', 'bloomBoost', 'warm', 'sunX', 'sunY', 'shafts'];
        expect(Object.keys(world.getPostState()).sort()).toEqual([...keys].sort());
        world.onLock({ hardDrop: true, u: 0.4 });
        world.onClear({ lines: 4, perfect: true });
        world.onCombo(12);
        world.levelUp(3);
        let brightest = 0;
        const wrong = [];
        run(world, camera, 6, () => {
            const post = world.getPostState();
            for (const key of keys) if (!Number.isFinite(post[key])) wrong.push(`${key} at ${world.time}`);
            if (!(post.flash >= 0 && post.bloomBoost >= 0 && post.shafts >= 0)) wrong.push(`negative at ${world.time}`);
            if (!(post.warm >= 0 && post.warm <= 1)) wrong.push(`warm ${post.warm} at ${world.time}`);
            brightest = Math.max(brightest, post.bloomBoost);
        });
        expect(wrong).toEqual([]);
        expect(brightest).toBeGreaterThan(0);
        // A chain makes the shafts of light stand stronger in the spray.
        const rest = makeWorld('Low');
        expect(world.getPostState().shafts).toBeGreaterThan(rest.world.getPostState().shafts);
        expect(rest.world.getPostState().shafts).toBeGreaterThan(0);
    });

    it('tells the post where the sun stands: left of the card on a wide screen, no shafts from behind the lens', () => {
        const { camera, world } = makeWorld('Low');
        const { sun } = world.getState();
        const post = world.getPostState();
        expect(post.sunX).toBe(sun.x);
        expect(post.sunY).toBe(sun.y);
        expect(sun.visible).toBe(1);
        // The eye of the barrel, with the low sun in it, is pushed clear of the card to the left.
        const [card] = world.layout.cards;
        expect(sun.x).toBeGreaterThan(0);
        expect(sun.x).toBeLessThan(card.x0);
        expect(sun.y).toBeGreaterThan(0);
        expect(sun.y).toBeLessThan(1);
        // It is where the sun's direction projects through this lens.
        const projected = world.sunDir.clone().multiplyScalar(1000).add(camera.position).project(camera);
        expect(sun.x).toBeCloseTo(projected.x * 0.5 + 0.5, 9);
        expect(sun.y).toBeCloseTo(0.5 - projected.y * 0.5, 9);
        expect(post.shafts).toBeGreaterThan(0);

        // Turn the lens to look back up the tube: the sun is behind it, and nothing is marched toward it.
        camera.lookAt(camera.position.x, camera.position.y, camera.position.z + 10);
        camera.updateMatrixWorld();
        camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
        world.onClear({ lines: 3 });
        world.update({ time: world.time, delta: 0 }, camera);
        expect(world.getState().sun.visible).toBe(0);
        expect(world.getPostState().shafts).toBe(0);
        expect(Number.isFinite(world.getPostState().sunX + world.getPostState().sunY)).toBe(true);
        // Back on the rig, they return.
        frame(world, camera, 0);
        expect(world.getPostState().shafts).toBeGreaterThan(0);
        // With no camera to project through, the last answer stands.
        const last = { ...world.sunScreen };
        world.update({ time: world.time, delta: 0 }, null);
        expect(world.sunScreen).toEqual(last);
    });

    it('keeps the sky\'s dome round the lens', () => {
        const { camera, world } = makeWorld('Minimal');
        run(world, camera, 1);
        expect(world.parts.sky.mesh.position.toArray()).toEqual(camera.position.toArray());
        world.updateCamera(camera, {
            time: world.time, delta: 0, pointerX: 1, pointerY: 0,
        });
        world.update({ time: world.time, delta: 0 }, camera);
        expect(world.parts.sky.mesh.position.toArray()).toEqual(camera.position.toArray());
        // Far enough out to be behind the whole wave, inside the lens's far plane.
        const radius = world.parts.sky.mesh.scale.x;
        expect(radius).toBeGreaterThan(WAVE.aheadReach);
        expect(radius).toBeLessThan(REST_RIG.far);
    });
});
