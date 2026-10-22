/**
 * Painted Ages — the world's choreography, run without a renderer: the baked land (decoded once),
 * a scene, a camera, and the world driven in fixed steps (camera, then events, then the frame, as
 * the theme does).
 *
 * The look is still being tuned, so the thresholds of the weather (how long a chain must be for a
 * bow, how strong it is) are held as properties — monotone, bounded, ordered — not as numbers.
 */
import { readFileSync } from 'node:fs';
import {
    afterEach, beforeAll, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import {
    PAINTED_AGES_PARTS, PaintedAgesWorld, RECORD_SHOWN, RECORD_TOP, REST_RIG, fovForAspect,
} from '../../src/themes/painted-ages/painted-ages-world.js';
import {
    EYE, FIELDS, FIELD_ORDER, PIECE_CODE, PIECE_COLORS, RECORD_ROWS, TIMING, hexToLinear,
} from '../../src/themes/painted-ages/painted-ages-core.js';
import { HOURS } from '../../src/themes/painted-ages/painted-ages-hours.js';
import { RIBBONS, WAVES } from '../../src/themes/painted-ages/painted-ages-tsl.js';
import { decodeField, groundHeight } from '../../src/themes/painted-ages/painted-ages-field.js';
import { fallbackLayout, outsideKeepOut } from '../../src/themes/painted-ages/painted-ages-composition.js';
import { tierFor } from '../../src/themes/painted-ages/painted-ages-quality.js';
import { decodePng } from '../../scripts/painted-ages/png.mjs';

vi.setConfig({ testTimeout: 30_000 });

const BYTE = 1 / 255;
const START = 10;
const worlds = [];
let fields;
let prepared;

beforeAll(() => {
    fields = {};
    for (const name of FIELD_ORDER) {
        const file = new URL(`../../src/themes/painted-ages/assets/badlands-${name}.png`, import.meta.url);
        const { rgba } = decodePng(readFileSync(file));
        fields[name] = { ...decodeField(rgba, FIELDS[name]), size: FIELDS[name].size, source: 'asset' };
    }
    fields.source = 'asset';
    // One preparation (the fan mesh and the field textures) serves every world in this file: the
    // worlds only read it.
    prepared = PaintedAgesWorld.prepareSync('Low', fields);
});

afterEach(() => {
    worlds.splice(0).forEach((world) => world.dispose());
    vi.restoreAllMocks();
});

const sim = (time, delta, pointerX = 0, pointerY = 0) => ({
    time, delta, pointerX, pointerY,
});

/** Run the world from its current time to `to` in steps of dt, as the theme's frames do. */
function stepTo(world, camera, to, dt = 1 / 30) {
    const from = world.time;
    const steps = Math.max(1, Math.round((to - from) / dt));
    const h = (to - from) / steps;
    for (let i = 1; i <= steps; i += 1) {
        const s = sim(from + i * h, h);
        world.updateCamera(camera, s);
        world.update(s, camera);
    }
}

function makeWorld({ width = 1600, height = 900, start = START } = {}) {
    const scene = new THREE.Scene();
    const aspect = width / height;
    const camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, REST_RIG.near, REST_RIG.far);
    const world = new PaintedAgesWorld({
        scene, quality: 'Low', capture: true, prepared,
    }).build();
    worlds.push(world);
    world.bindCamera(camera);
    world.setViewport(width, height, aspect);
    world.seek(start);
    world.updateCamera(camera, sim(start, 0));
    world.update(sim(start, 0), camera);
    return {
        scene, camera, world, width, height,
    };
}

const ribbon = (world, i) => world.u.tables.ribbons.slice(i * 3, i * 3 + 3);
const wave = (world, i) => world.u.tables.waves.slice(i * 2, i * 2 + 2);
const rgbOf = (v) => [v.x, v.y, v.z];
const rowsOf = (...codes) => codes.flatMap((code) => new Array(10).fill(code));
const expectRgb = (actual, expected, tolerance = 1e-9, label = '') => {
    actual.forEach((v, i) => expect(Math.abs(v - expected[i]), `${label}[${i}]`).toBeLessThanOrEqual(tolerance));
};

/** Every value the materials read, flattened (the event tables included). */
function uniformValues(world) {
    const out = [];
    for (const [key, node] of Object.entries(world.u)) {
        if (key === 'tables' || !node || !('value' in node)) continue;
        const { value } = node;
        if (typeof value === 'number') out.push([key, value]);
        else if (value?.toArray) value.toArray().forEach((v, i) => out.push([`${key}.${i}`, v]));
    }
    world.u.tables.ribbons.forEach((row, r) => row.toArray().forEach((v, i) => out.push([`ribbons[${r}].${i}`, v])));
    world.u.tables.waves.forEach((row, r) => row.toArray().forEach((v, i) => out.push([`waves[${r}].${i}`, v])));
    return out;
}

describe('PaintedAgesWorld build', () => {
    it('builds every named part into one root in the scene, from the baked land', () => {
        const { world, scene } = makeWorld();
        expect(Object.keys(world.parts).sort()).toEqual([...PAINTED_AGES_PARTS].sort());
        expect(world.root.parent).toBe(scene);
        for (const name of PAINTED_AGES_PARTS) {
            const part = world.parts[name];
            for (const mesh of part.meshes || [part.mesh]) {
                expect(mesh.parent, name).toBe(world.root);
                expect(mesh.material.isNodeMaterial, name).toBe(true);
            }
        }
        expect(world.getState()).toMatchObject({
            source: 'asset', quality: 'Low', parts: expect.arrayContaining(PAINTED_AGES_PARTS),
        });
        const tier = tierFor('Low');
        expect(world.parts.land.mesh.geometry.attributes.position.count).toBe(tier.fanCols * tier.fanRows);
        expect(world.motes.count).toBe(tier.motes);
        // A capture can ask for some parts only.
        world.showOnlyParts(['sky', 'land']);
        expect(world.parts.sky.mesh.visible).toBe(true);
        expect(world.parts.land.mesh.visible).toBe(true);
        expect(world.parts.props.mesh.visible).toBe(false);
        // Building twice builds nothing more.
        const children = world.root.children.length;
        expect(world.build()).toBe(world);
        expect(world.root.children).toHaveLength(children);
    });

    it('stands the camera at the eye on the rig for its aspect; reduced motion holds it still', () => {
        const { world, camera } = makeWorld();
        world.updateCamera(camera, sim(20, 0));
        expect(camera.position.toArray()).toEqual([EYE.x, EYE.y, EYE.z]);
        expect(camera.fov).toBe(fovForAspect(16 / 9));
        const at = (t, px = 0) => {
            world.updateCamera(camera, sim(t, 0, px));
            return camera.quaternion.clone();
        };
        expect(at(20).angleTo(at(37))).toBeGreaterThan(1e-4); // the lens breathes
        expect(at(20).angleTo(at(20, 1))).toBeGreaterThan(1e-3); // the pointer leans it
        world.setReducedMotion(true);
        expect(at(20).angleTo(at(37))).toBeLessThan(1e-6); // float32 noise only
        expect(at(20).angleTo(at(20, 1))).toBeLessThan(1e-6);
        // It looks down across the valley.
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
        expect(forward.y).toBeLessThan(0);
        expect(forward.z).toBeLessThan(-0.8);
    });
});

describe('PaintedAgesWorld locks', () => {
    it.each([[1600, 900], [2560, 1080], [900, 1600]])(
        'lights a bed in the piece colour on land beside the card, beyond 80 m (%i × %i)',
        (width, height) => {
            const { world, camera } = makeWorld({ width, height });
            const layout = fallbackLayout(width, height);
            const misses = [];
            for (const u of [0, 0.15, 0.35, 0.5, 0.65, 0.85, 1]) {
                for (const row of [0, 9, 19]) {
                    world.tables.reset();
                    const color = PIECE_COLORS[(row + Math.round(u * 10)) % 7];
                    world.onLock({ u, rows: [row], color });
                    if (world.tables.ribbonCount !== 1) {
                        misses.push(`no ribbon at u ${u}, row ${row}`);
                        continue;
                    }
                    const [origin, look] = ribbon(world, 0);
                    expectRgb(rgbOf(look), hexToLinear(color), 1e-9, `colour at u ${u}`);
                    expect(look.w).toBeGreaterThan(0);
                    expect(origin.w).toBe(world.time);
                    const y = groundHeight(fields, origin.x, origin.y);
                    const p = new THREE.Vector3(origin.x, y, origin.y).project(camera);
                    const screen = { x: p.x * 0.5 + 0.5, y: 0.5 - p.y * 0.5 };
                    const label = `u ${u}, row ${row} → (${screen.x.toFixed(3)}, ${screen.y.toFixed(3)})`;
                    if (!outsideKeepOut(layout, screen, 0)) misses.push(`${label} is behind the card or HUD`);
                    const onScreen = screen.x >= 0 && screen.x <= 1 && screen.y >= 0 && screen.y <= 1 && p.z <= 1;
                    if (!onScreen) misses.push(`${label} is off screen`);
                    const distance = Math.hypot(origin.x - EYE.x, y - EYE.y, origin.y - EYE.z);
                    if (distance < 80) misses.push(`${label} is ${distance.toFixed(0)} m from the eye`);
                }
            }
            expect(misses).toEqual([]);
            expect(world.counts.locks).toBe(21);
            expect(world.motes.cursor).toBeGreaterThan(0); // pigment dust rose where it landed
        },
    );

    it('sends a hard drop out wider and faster, as a ring along the ground', () => {
        const { world } = makeWorld();
        world.onLock({ u: 0.2, rows: [12], color: PIECE_COLORS[0] });
        world.onLock({
            u: 0.2, rows: [12], color: PIECE_COLORS[0], hardDrop: true, distance: 14,
        });
        const [, softLook, soft] = ribbon(world, 0);
        const [, hardLook, hard] = ribbon(world, 1);
        expect(soft.w).toBe(0);
        expect(hard.w).toBe(1); // the ring's kind
        expect(hard.y).toBeGreaterThan(soft.y); // speed
        expect(hard.z).toBeGreaterThan(soft.z); // reach
        expect(hardLook.w).toBeGreaterThan(softLook.w); // power
        expect(world.counts).toMatchObject({ locks: 2, hardDrops: 1 });
    });
});

describe('PaintedAgesWorld clears', () => {
    it('lays the rows into the record and sends one band of light per line in the row\'s colour', () => {
        const { world, camera } = makeWorld();
        const { total } = world.record;
        const textureVersion = world.textures.record.version;
        world.onClear({ lines: 2, rowCodes: rowsOf(PIECE_CODE.T, PIECE_CODE.S), combo: 1 });
        expect(world.record.total).toBe(total + 2);
        expect(world.record.written(0)).toBe(true);
        expect(world.record.written(1)).toBe(true);
        // The newest bed is the last row; its raw pigment is that piece's.
        expectRgb(world.record.read(0, 11), hexToLinear(PIECE_COLORS[PIECE_CODE.S]), BYTE, 'newest');
        expectRgb(world.record.read(1, 11), hexToLinear(PIECE_COLORS[PIECE_CODE.T]), BYTE, 'below it');
        expect(world.tables.waveCount).toBe(2);
        expectRgb(rgbOf(wave(world, 0)[1]), hexToLinear(PIECE_COLORS[PIECE_CODE.T]), 1e-9, 'first band');
        expectRgb(rgbOf(wave(world, 1)[1]), hexToLinear(PIECE_COLORS[PIECE_CODE.S]), 1e-9, 'second band');
        expect(wave(world, 1)[0].z).toBeGreaterThan(wave(world, 0)[0].z); // staggered
        expect(world.counts).toMatchObject({ clears: 1, lines: 2 });
        // The next frame hands the record to the land.
        stepTo(world, camera, world.time + 1 / 30);
        expect(world.u.recordHead.value).toBe(world.record.head);
        expect(world.u.recordCount.value).toBe(Math.min(RECORD_SHOWN, world.record.total));
        expect(world.u.recordTop.value).toBe(RECORD_TOP);
        expect(world.textures.record.version).toBeGreaterThan(textureVersion);
        expect(world.u.settle.value).toBeGreaterThan(0.5);
        stepTo(world, camera, world.time + TIMING.settle + 0.1);
        expect(world.u.settle.value).toBe(0);
    });

    it('sets the flood running down the river on four lines', () => {
        const { world, camera } = makeWorld();
        world.onClear({ lines: 4, rowCodes: Array.from({ length: 40 }, (_, i) => i % 7), combo: 1 });
        expect(world.counts.quads).toBe(1);
        expect(world.floodAt).toBe(world.time);
        // The rainbow tide (six colours) joins the quad's own four row bands: it never deletes them.
        expect(world.tables.waveCount).toBe(10);
        expect(world.tables.waveCount).toBeLessThanOrEqual(WAVES);
        stepTo(world, camera, world.time + 1 / 30);
        expect(world.getPostState().flash).toBeGreaterThan(0.2);
        stepTo(world, camera, world.time + 1);
        const [front1, power] = world.u.flood.value.toArray();
        expect(power).toBeGreaterThan(0.5);
        world.u.floodColour.value.toArray().forEach((c) => expect(c).toBeGreaterThan(0));
        stepTo(world, camera, world.time + 1);
        expect(world.u.flood.value.x).toBeGreaterThan(front1); // the front runs on
        stepTo(world, camera, world.time + TIMING.floodDrain);
        expect(world.u.flood.value.y).toBe(0);
    });

    it('paints the sky on a perfect clear, then lets it go', () => {
        const { world, camera } = makeWorld();
        const { clears } = world.counts;
        world.onClear({ lines: 4, perfect: true });
        expect(world.counts.perfects).toBe(1);
        expect(world.counts.clears).toBe(clears);
        stepTo(world, camera, world.time + 2);
        expect(world.u.paint.value).toBeGreaterThan(0.99);
        expect(world.u.bow.value.x).toBeGreaterThan(0);
        expect(world.u.bow.value.y).toBe(1);
        stepTo(world, camera, world.time + TIMING.perfectHold + TIMING.perfectFade);
        expect(world.u.paint.value).toBe(0);
    });
});

describe('PaintedAgesWorld chains', () => {
    /** What releasing a chain of each peak does (the world needs no build to count). */
    function releases() {
        const world = new PaintedAgesWorld({ scene: new THREE.Scene(), quality: 'Low' });
        const out = [];
        for (let peak = 1; peak <= 12; peak++) {
            const before = world.counts.releases;
            for (let n = 1; n <= peak; n++) world.onCombo(n);
            world.onCombo(0);
            out.push({
                peak, bow: world.counts.releases > before, strength: world.bowStrength, second: world.bowSecond,
            });
            world.bowStrength = 0;
            world.bowSecond = 0;
        }
        world.dispose();
        return out;
    }

    it('keeps the bow for a long chain, stronger the longer it was, and doubled after a very long one', () => {
        const table = releases();
        const firstBow = table.find((r) => r.bow)?.peak;
        const firstDouble = table.find((r) => r.second)?.peak;
        expect(table[1].bow).toBe(false); // a chain of two is no shower
        expect(firstBow).toBeGreaterThanOrEqual(3);
        expect(firstBow).toBeLessThanOrEqual(5);
        expect(firstDouble).toBeGreaterThan(firstBow);
        expect(firstDouble).toBeLessThanOrEqual(8);
        table.forEach((r, i) => {
            expect(r.bow, `peak ${r.peak}`).toBe(r.peak >= firstBow);
            expect(r.second === 1, `peak ${r.peak}`).toBe(r.peak >= firstDouble);
            if (i > 0 && r.bow && table[i - 1].bow) expect(r.strength).toBeGreaterThanOrEqual(table[i - 1].strength);
            if (r.bow) {
                expect(r.strength).toBeGreaterThan(0);
                expect(r.strength).toBeLessThanOrEqual(1.1);
            }
        });
    });

    it('walks a shower in while the chain holds, and leaves a bow over the valley when it breaks', () => {
        const { world, camera } = makeWorld();
        const cover = world.u.cloudCover.value;
        for (let n = 1; n <= 8; n++) world.onCombo(n);
        stepTo(world, camera, world.time + 6);
        expect(world.showerPower).toBeGreaterThan(0.3);
        expect(world.u.wet.value).toBeGreaterThan(0.3);
        expect(world.u.showerFront.value).toBeLessThan(9000);
        expect(world.u.cloudCover.value).toBeGreaterThan(cover);
        expect(world.u.bow.value.x).toBe(0);
        world.onCombo(0);
        expect(world.counts.releases).toBe(1);
        stepTo(world, camera, world.time + 3);
        expect(world.u.bow.value.x).toBeGreaterThan(0.3);
        expect(world.u.bow.value.y).toBe(1); // eight is a long chain: the double bow
        const wet = world.u.wet.value;
        stepTo(world, camera, world.time + TIMING.bowLife);
        expect(world.u.bow.value.x).toBe(0);
        expect(world.showerPower).toBeLessThan(0.05);
        // The rock dries in the sun, slowly.
        expect(world.u.wet.value).toBeLessThan(wet);
        expect(world.u.wet.value).toBeGreaterThan(0);
    });

    it('lets the rock glint on a back-to-back run', () => {
        const { world, camera } = makeWorld();
        world.onB2B(3);
        stepTo(world, camera, world.time + 4);
        expect(world.u.sheen.value).toBeGreaterThan(0.5);
        expect(world.counts.b2bSteps).toBe(1);
        world.onB2B(0);
        stepTo(world, camera, world.time + 6);
        expect(world.u.sheen.value).toBeLessThan(0.01);
    });
});

describe('PaintedAgesWorld: the day and the run', () => {
    it('steps the wheel an hour forward on a level-up and lays a pale tuff bed', () => {
        const { world, camera } = makeWorld();
        const { total } = world.record;
        const waves = world.tables.waveCount;
        world.levelUp(2);
        expect(world.counts.levelUps).toBe(1);
        expect(world.record.total).toBe(total + 1);
        expect(world.record.read(0, 12)[1]).toBe(1); // a tuff
        expect(world.tables.waveCount).toBe(waves + 1);
        stepTo(world, camera, world.time + TIMING.levelTurn + 0.2);
        expect(world.light.place - world.time / TIMING.hour).toBeCloseTo(1, 9);
        expect(world.getState().hour.from).toBe(1);
        // A silent level-up (a rebuild restoring the run) neither counts nor lays a bed.
        world.levelUp(3, { silent: true });
        expect(world.counts.levelUps).toBe(1);
        expect(world.record.total).toBe(total + 1);
        stepTo(world, camera, world.time + 0.1);
        expect(world.light.place - world.time / TIMING.hour).toBeCloseTo(2, 9);
    });

    it('lets dusk fall at game over and lights the lanterns; the next lock brings the morning', () => {
        const { world, camera } = makeWorld();
        const { total } = world.record;
        world.onGameOver();
        expect(world.counts.gameOvers).toBe(1);
        expect(world.record.total).toBe(total + 1);
        expect(world.record.read(0, 12)[1]).toBe(1);
        stepTo(world, camera, world.time + TIMING.dusk + 0.2);
        expect(world.dusk).toBeCloseTo(1, 6);
        expect(world.u.dusk.value).toBeCloseTo(1, 6);
        expect(world.u.lamps.value).toBeGreaterThan(0.99);
        // The light leans toward the blue hour.
        expect(world.light.el).toBeLessThan(HOURS[0].el);
        world.onLock({ u: 0.3, rows: [10], color: PIECE_COLORS[2] });
        expect(world.counts.mornings).toBe(1);
        stepTo(world, camera, world.time + TIMING.dawn + 0.2);
        expect(world.dusk).toBe(0);
        expect(world.u.lamps.value).toBeLessThan(0.5);
    });

    it('keeps the light through a new run, and the next level-up steps forward from it', () => {
        const { world, camera } = makeWorld();
        world.levelUp(2);
        world.levelUp(3);
        for (let n = 1; n <= 3; n++) world.onCombo(n);
        world.onB2B(2);
        stepTo(world, camera, world.time + TIMING.levelTurn + 0.2);
        const { place } = world.light;
        expect(place - world.time / TIMING.hour).toBeCloseTo(2, 9);
        world.resetSession();
        expect(world).toMatchObject({
            level: 1, combo: 0, peak: 0, b2b: 0,
        });
        stepTo(world, camera, world.time + 1 / 30);
        expect(world.light.place).toBeCloseTo(place + 1 / 30 / TIMING.hour, 9);
        world.levelUp(2);
        stepTo(world, camera, world.time + TIMING.levelTurn + 0.2);
        expect(world.light.place - world.time / TIMING.hour).toBeCloseTo(3, 9);
    });

    it('holds a capture\'s hour and record height when asked', () => {
        const { world, camera } = makeWorld();
        world.setCaptureOverrides({ hour: 4, recordTop: 90 });
        stepTo(world, camera, world.time + 30);
        expect(world.getState().hour.name).toBe(HOURS[4].name);
        expect(world.light.place).toBe(4);
        expect(world.u.recordTop.value).toBe(90);
    });
});

describe('PaintedAgesWorld state', () => {
    /** A session with something of everything in it. */
    function play(world, camera) {
        const t = world.time;
        world.onLock({ u: 0.2, rows: [18], color: PIECE_COLORS[0] });
        world.onClear({ lines: 2, rowCodes: rowsOf(1, 4), combo: 1 });
        world.onCombo(1);
        stepTo(world, camera, t + 1);
        world.levelUp(2);
        world.levelUp(3);
        for (let n = 2; n <= 7; n++) {
            world.onLock({ u: n / 9, rows: [19], color: PIECE_COLORS[n % 7] });
            world.onClear({ lines: 1, rowCodes: rowsOf(n % 7), combo: n });
            stepTo(world, camera, world.time + 0.8);
        }
        world.onLock({ u: 0.7, rows: [19], color: PIECE_COLORS[3] });
        world.onCombo(0);
        world.onB2B(2);
        stepTo(world, camera, world.time + 2);
    }

    it('round-trips a session through export and import: record, wheel and weather', () => {
        const a = makeWorld();
        play(a.world, a.camera);
        const snapshot = structuredClone(a.world.exportSessionState());
        const b = makeWorld({ start: a.world.time });
        b.world.importSessionState(snapshot);
        expect(b.world.record.data).toEqual(a.world.record.data);
        expect(b.world.record.head).toBe(a.world.record.head);
        expect(b.world.record.total).toBe(a.world.record.total);
        expect(b.world.counts).toEqual(a.world.counts);
        for (const t of [a.world.time, a.world.time + 3, a.world.time + 250]) {
            expect(b.world.wheel.place(t), `t = ${t}`).toBeCloseTo(a.world.wheel.place(t), 12);
        }
        const scalars = [
            'level', 'combo', 'peak', 'b2b', 'wetLevel', 'showerPower', 'showerFront', 'bowAt', 'bowStrength',
            'bowSecond', 'floodAt', 'depositAt',
        ];
        for (const key of scalars) {
            expect(b.world[key], key).toBe(a.world[key]);
        }
        // The next frame draws the same land, the same light and the same weather.
        a.world.update(sim(a.world.time, 0), a.camera);
        b.world.update(sim(a.world.time, 0), b.camera);
        const drawn = [
            'sunDir', 'sun', 'horizon', 'wet', 'showerPower', 'bow', 'sheen', 'recordHead', 'recordCount', 'dusk',
            'paint', 'flood',
        ];
        for (const key of drawn) {
            const va = a.world.u[key].value;
            const vb = b.world.u[key].value;
            expect(typeof va === 'number' ? vb : vb.toArray(), key).toEqual(typeof va === 'number' ? va : va.toArray());
        }
        // A snapshot of another shape is refused.
        const before = b.world.record.data.slice();
        b.world.importSessionState({ record: { data: new Uint8Array(4) } });
        b.world.importSessionState(null);
        expect(b.world.record.data).toEqual(before);
    });

    // BUG (painted-ages-world.js): SNAPSHOT does not carry `lastLockAt`, so a world rebuilt in place
    // starts with lastLockAt = −1e6 and update() applies the idle drying (time − lastLockAt > idle)
    // at once: the wet rock of a just-released shower dries in seconds instead of TIMING.dry.
    it('carries on drying the rock at the same pace after an import (a rebuild in place)', () => {
        const a = makeWorld();
        play(a.world, a.camera);
        const b = makeWorld({ start: a.world.time });
        b.world.importSessionState(structuredClone(a.world.exportSessionState()));
        expect(a.world.wetLevel).toBeGreaterThan(0.1);
        const end = a.world.time + 4;
        stepTo(a.world, a.camera, end);
        stepTo(b.world, b.camera, end);
        expect(b.world.wetLevel).toBeCloseTo(a.world.wetLevel, 3);
    });

    it('seeks deterministically, rewinding the record and the session to that time', () => {
        const { world, camera } = makeWorld();
        play(world, camera);
        const end = world.time;
        const read = () => {
            world.updateCamera(camera, sim(world.time, 0));
            world.update(sim(world.time, 0), camera);
            return {
                state: world.getState(), record: world.record.data.slice(), uniforms: uniformValues(world),
            };
        };
        world.seek(end);
        const first = read();
        world.seek(end);
        expect(read()).toEqual(first);
        expect(first.state).toMatchObject({
            time: end, level: 1, combo: 0, ribbons: 0, waves: 0, dusk: 0,
        });
        expect(first.state.recordRows).toBe(world.record.journal.length);
        // Back to before the first clear: none of its rows remain.
        world.seek(START - 1);
        expect(world.record.total).toBe(0);
        expect(world.record.written(0)).toBe(false);
        expect(Object.values(world.shadowPass.passes).every((pass) => pass.painted === null)).toBe(true);
        world.seek(end);
        expect(read()).toEqual(first);
    });

    it('keeps every uniform finite over a long scripted session', () => {
        const { world, camera } = makeWorld({ start: 0 });
        const bad = [];
        let combo = 0;
        for (let frame = 1; frame <= 3600; frame++) {
            const t = frame / 15;
            if (frame % 22 === 0) {
                world.onLock({
                    u: (frame * 0.173) % 1,
                    rows: [19 - (frame % 20)],
                    color: PIECE_COLORS[frame % 8],
                    hardDrop: frame % 66 === 0,
                    distance: frame % 19,
                });
            }
            if (frame % 44 === 0) {
                const lines = 1 + (frame % 4);
                combo = frame % 440 < 330 ? combo + 1 : 0;
                world.onClear({
                    lines,
                    rowCodes: Array.from({ length: lines * 10 }, (_, i) => (i + frame) % 8),
                    combo: Math.max(1, combo),
                    tspin: frame % 352 === 0,
                });
                world.onCombo(combo);
                world.onB2B(lines === 4 ? Math.min(4, world.b2b + 1) : 0);
            }
            if (frame === 1800) world.onClear({ lines: 4, perfect: true });
            if (frame % 600 === 0) world.levelUp(world.level + 1);
            if (frame === 2700) world.onGameOver();
            if (frame === 2760) world.resetSession();
            world.updateCamera(camera, sim(t, 1 / 15, Math.sin(t), Math.cos(t * 0.7)));
            world.update(sim(t, 1 / 15), camera);
            if (frame % 30 === 0) {
                for (const [key, v] of uniformValues(world)) {
                    if (!Number.isFinite(v)) bad.push(`${key} at ${t.toFixed(2)} s: ${v}`);
                }
                const post = world.getPostState();
                const { sun } = post;
                const values = [
                    post.exposure, post.bloomBoost, post.flash, post.saturation, sun.x, sun.y, sun.strength,
                ];
                for (const v of values) {
                    if (!Number.isFinite(v)) bad.push(`post at ${t.toFixed(2)} s: ${JSON.stringify(post)}`);
                }
            }
            expect(world.tables.ribbonCount).toBeLessThanOrEqual(RIBBONS);
            expect(world.tables.waveCount).toBeLessThanOrEqual(WAVES);
        }
        expect(bad.slice(0, 10)).toEqual([]);
        expect(world.counts.locks).toBeGreaterThan(100);
        expect(world.counts.gameOvers).toBe(1);
        expect(world.record.total).toBeLessThanOrEqual(world.record.journal.length + world.record.baselineTotal);
        expect(world.record.head).toBeLessThan(RECORD_ROWS);
    });

    it('never holds more ribbons or waves than the tables have rows, and retires them when they are done', () => {
        const { world, camera } = makeWorld();
        for (let i = 0; i < RIBBONS * 3; i++) {
            world.onLock({ u: (i % 10) / 9, rows: [10 + (i % 8)], color: PIECE_COLORS[i % 7] });
        }
        expect(world.tables.ribbonCount).toBe(RIBBONS);
        expect(world.u.ribbonCount.value).toBe(RIBBONS);
        // The newest is kept when the table is full.
        const last = PIECE_COLORS[(RIBBONS * 3 - 1) % 7];
        const colours = Array.from({ length: RIBBONS }, (_, i) => rgbOf(ribbon(world, i)[1]));
        expect(colours.some((c) => c.every((v, k) => Math.abs(v - hexToLinear(last)[k]) < 1e-9))).toBe(true);
        for (let i = 0; i < WAVES * 2; i++) world.onClear({ lines: 1, rowCodes: rowsOf(i % 7), combo: 1 });
        expect(world.tables.waveCount).toBe(WAVES);
        expect(world.u.waveCount.value).toBe(WAVES);
        stepTo(world, camera, world.time + 10);
        expect(world.tables.ribbonCount).toBe(0);
        expect(world.tables.waveCount).toBe(0);
        expect(world.u.ribbonCount.value).toBe(0);
        expect(world.u.waveCount.value).toBe(0);
        expect(world.u.tables.ribbons.every((row) => row.toArray().every((v) => v === 0))).toBe(true);
        expect(world.u.tables.waves.every((row) => row.toArray().every((v) => v === 0))).toBe(true);
    });
});

describe('PaintedAgesWorld build-up (the heat of play)', () => {
    /** One step of a fast chain: a hard-dropped lock that clears, as the director sends it. */
    function chainStep(world, n, lines = 1 + (n % 3)) {
        world.onLock({
            u: (n % 9) / 8, rows: [19], color: PIECE_COLORS[n % 7], hardDrop: true, distance: 12,
        });
        const codes = rowsOf(...Array.from({ length: lines }, (_, k) => (n + k) % 7));
        world.onClear({
            lines, rowCodes: codes, combo: n, cascade: 1,
        });
        world.onCombo(n);
    }

    /** What the world wears: the knobs the heat of play turns (the light relative to the hour's). */
    const wears = (world) => {
        const post = world.getPostState();
        return {
            glow: world.u.strataGlow.value,
            paint: world.u.paint.value,
            river: world.u.flood.value.y,
            sheen: world.u.sheen.value,
            burn: world.u.glow.value.x / world.light.glow[0],
            air: world.u.haze.value.x / world.light.haze[0],
            iris: post.exposure / world.light.exposure,
            saturation: post.saturation,
            fever: world.heat.fever,
            nod: world.nod,
            zoom: world.zoom,
            wet: world.u.wet.value,
        };
    };

    it('builds through a long chain, then breathes back to calm and keeps the wet rock', () => {
        const { world, camera } = makeWorld();
        const rest = wears(world);
        chainStep(world, 1);
        stepTo(world, camera, world.time + 0.64);
        const first = wears(world);
        // The first clear barely moves the world: calm play looks as it always did.
        expect(first.glow).toBeLessThan(0.02);
        expect(first.paint).toBe(0);
        expect(first.fever).toBe(0);
        expect(first.burn).toBeLessThan(1.05);
        for (let n = 2; n <= 12; n++) {
            chainStep(world, n);
            stepTo(world, camera, world.time + 0.64);
        }
        const late = wears(world);
        // Twelve clears later it is in a fever, and everything the build-up turns is higher.
        expect(late.fever).toBeGreaterThan(0.4);
        expect(late.glow).toBeGreaterThan(first.glow + 0.2);
        expect(late.paint).toBeGreaterThan(0.1);
        expect(late.river).toBeGreaterThan(0.15);
        expect(late.sheen).toBeGreaterThan(first.sheen);
        expect(late.air).toBeLessThan(first.air - 0.1); // the storm's gloom takes the air
        expect(late.saturation).toBeGreaterThan(first.saturation);
        expect(late.iris).toBeLessThan(first.iris); // the iris closes as the land kindles
        expect(late.zoom).toBeGreaterThan(0.2); // the view leans in
        // The hands rest: the world breathes back; the rock stays wet and dries slowly.
        stepTo(world, camera, world.time + 12);
        const after = wears(world);
        expect(after.fever).toBe(0);
        expect(after.glow).toBeLessThan(0.01);
        expect(after.paint).toBeLessThan(0.01);
        expect(after.river).toBeLessThan(0.01);
        expect(after.zoom).toBeLessThan(0.05);
        expect(after.nod).toBeLessThan(0.05);
        expect(after.burn).toBeCloseTo(rest.burn, 2);
        expect(after.air).toBeCloseTo(rest.air, 2);
        expect(after.iris).toBeCloseTo(rest.iris, 2);
        expect(after.wet).toBeGreaterThan(0.3);
        // Reduced motion keeps the view still through the same chain.
        const calm = makeWorld();
        calm.world.setReducedMotion(true);
        for (let n = 1; n <= 12; n++) {
            chainStep(calm.world, n);
            stepTo(calm.world, calm.camera, calm.world.time + 0.64);
        }
        expect(calm.world.heat.fever).toBeGreaterThan(0.4);
        expect(calm.world.nod).toBe(0);
        expect(calm.world.zoom).toBe(0);
        expect(calm.camera.fov).toBe(fovForAspect(16 / 9));
    });

    it('never cuts the light when a weaker hit follows a strong one', () => {
        const { world, camera } = makeWorld();
        const trace = [];
        const run = (seconds) => {
            const end = world.time + seconds;
            while (world.time < end - 1e-9) {
                stepTo(world, camera, world.time + 1 / 30);
                const [front, river] = world.u.flood.value.toArray();
                const [bow, second] = world.u.bow.value.toArray();
                trace.push({
                    t: world.time, flash: world.getPostState().flash, front, river, bow, second,
                });
            }
        };
        const quad = () => world.onClear({ lines: 4, rowCodes: rowsOf(0, 1, 2, 3), combo: 1 });
        quad();
        run(0.3);
        // A single right after the quad.
        world.onLock({ u: 0.4, rows: [19], color: PIECE_COLORS[2] });
        world.onClear({ lines: 1, rowCodes: rowsOf(2), combo: 2 });
        run(1.5);
        // A second quad while the flood still runs, then the perfect clear's double bow.
        quad();
        run(1);
        world.onClear({ lines: 4, perfect: true });
        const crowned = world.time;
        run(3);
        // A chain of four breaks: its single bow joins the double one instead of replacing it.
        world.onCombo(3);
        world.onCombo(4);
        world.onCombo(0);
        expect(world.counts.releases).toBe(1);
        run(3);
        for (let i = 1; i < trace.length; i++) {
            const a = trace[i - 1];
            const b = trace[i];
            // The flash only ever falls at its own pace; a new hit can only add to it.
            const fallen = a.flash * Math.exp(-(b.t - a.t) / 0.32);
            expect(b.flash, `flash at ${b.t.toFixed(2)}`).toBeGreaterThanOrEqual(fallen - 1e-4);
            // The flood's front never snaps back up the river while there is water in it.
            if (a.river > 0.005) expect(b.front, `front at ${b.t.toFixed(2)}`).toBeGreaterThanOrEqual(a.front);
            if (a.t >= crowned) {
                expect(b.bow, `bow at ${b.t.toFixed(2)}`).toBeGreaterThanOrEqual(a.bow - 1e-9);
                expect(b.second).toBe(1);
            }
        }
        expect(trace[trace.length - 1].bow).toBeGreaterThan(0.9);
        // The quad's own row bands were never deleted by its tide: both quads' bands are there.
        expect(world.counts.quads).toBe(2);
    });

    it('builds each wave of a cascade on the last, and answers a back-to-back with mica', () => {
        const { world, camera } = makeWorld();
        for (let depth = 1; depth <= 4; depth++) {
            world.onClear({
                lines: 1, rowCodes: rowsOf(depth), combo: 1, cascade: depth,
            });
        }
        for (let i = 1; i < 4; i++) {
            const [a0, a1] = wave(world, i - 1);
            const [b0, b1] = wave(world, i);
            expect(b0.x).toBeLessThan(a0.x); // it rises from deeper
            expect(b0.y).toBeGreaterThan(a0.y); // faster
            expect(b0.w).toBeGreaterThan(a0.w); // brighter
            expect(b1.w).toBeGreaterThan(a1.w); // wider
        }
        // A back-to-back clear: brighter bands with a glint of mica, and the rock flares.
        const plain = makeWorld();
        plain.world.onClear({ lines: 4, rowCodes: rowsOf(0, 1, 2, 3), combo: 1 });
        world.tables.reset();
        world.onClear({
            lines: 4, rowCodes: rowsOf(0, 1, 2, 3), combo: 1, b2b: true,
        });
        expect(wave(world, 0)[0].w).toBeGreaterThan(wave(plain.world, 0)[0].w);
        stepTo(world, camera, world.time + 0.3);
        stepTo(plain.world, plain.camera, plain.world.time + 0.3);
        expect(world.u.sheen.value).toBeGreaterThan(plain.world.u.sheen.value + 0.3);
    });

    it('shows a T-spin that cleared nothing as a small dust devil', () => {
        const { world, camera } = makeWorld();
        const before = world.motes.cursor;
        world.onSpin({ u: 0.3, color: PIECE_COLORS[1] });
        expect(world.counts.tspins).toBe(1);
        expect(world.motes.cursor).not.toBe(before);
        stepTo(world, camera, world.time + 0.5);
        expect(world.heat.level).toBeGreaterThan(0);
    });

    it('keeps the rain to its share of the motes, so the pigment and the dust devil survive it', () => {
        const { world, camera } = makeWorld();
        const { motes } = world;
        world.onTSpin({ u: 0.2 });
        const kindAt = (i) => Math.round(motes.kind[i * 4]);
        const devils = () => Array.from({ length: motes.count }, (_, i) => i).filter((i) => kindAt(i) === 3);
        const spun = devils();
        expect(spun.length).toBeGreaterThan(0);
        for (let n = 1; n <= 9; n++) world.onCombo(n);
        stepTo(world, camera, world.time + 3);
        const rain = Array.from({ length: motes.count }, (_, i) => i).filter((i) => kindAt(i) === 2);
        expect(rain.length).toBeGreaterThan(0); // it rains at the eye
        expect(rain.every((i) => i >= motes.pigmentSlots)).toBe(true);
        expect(devils()).toEqual(spun);
    });

    it('gives up the faintest band when the table is full, never one still bright', () => {
        const { world } = makeWorld();
        const t = world.time;
        world.tables.addWave({
            g0: 0, climb: 60, time: t, power: 0.1, rgb: [1, 0, 0],
        });
        for (let i = 1; i < WAVES; i++) {
            world.tables.addWave({
                g0: i, climb: 60, time: t, power: 2, rgb: [0, 1, 0],
            });
        }
        world.tables.addWave({
            g0: 99, climb: 60, time: t, power: 2, rgb: [0, 0, 1],
        });
        expect(world.tables.waveCount).toBe(WAVES);
        const powers = Array.from({ length: WAVES }, (_, i) => wave(world, i)[0].w);
        expect(powers.every((p) => p === 2)).toBe(true); // the faint red band went
        expect(Array.from({ length: WAVES }, (_, i) => wave(world, i)[0].x)).toContain(99);
    });
});

describe('PaintedAgesWorld GPU work and teardown', () => {
    it('paints the land\'s shadow before the frame only when the sun has moved', () => {
        const { world, camera } = makeWorld();
        const renderer = {
            setRenderTarget: vi.fn(), getRenderTarget: vi.fn(() => null), render: vi.fn(),
        };
        world.prerender(renderer);
        expect(renderer.render).toHaveBeenCalledTimes(3); // every field the first time
        expect(renderer.setRenderTarget).toHaveBeenLastCalledWith(null); // the frame's target restored
        world.prerender(renderer);
        expect(renderer.render).toHaveBeenCalledTimes(3); // nothing moved
        stepTo(world, camera, world.time + 20, 0.5);
        world.prerender(renderer);
        expect(renderer.render).toHaveBeenCalledTimes(4); // then one stale field a frame
        world.prerender(renderer);
        world.prerender(renderer);
        expect(renderer.render).toHaveBeenCalledTimes(6);
        world.prerender(renderer);
        expect(renderer.render).toHaveBeenCalledTimes(6);
        // A renderer without targets is skipped, not thrown at.
        expect(() => world.prerender({})).not.toThrow();
    });

    it('disposes once, however often it is asked, and ignores what comes after', () => {
        const { world, scene, camera } = makeWorld();
        world.onLock({ u: 0.3, rows: [12], color: PIECE_COLORS[1] });
        const disposeLand = vi.spyOn(world.parts.land.mesh.geometry, 'dispose');
        world.dispose();
        expect(() => world.dispose()).not.toThrow();
        expect(disposeLand).toHaveBeenCalledOnce();
        expect(world.root.parent).toBeNull();
        expect(world.root.children).toHaveLength(0);
        expect(scene.children).not.toContain(world.root);
        const renderer = {
            setRenderTarget: vi.fn(), getRenderTarget: vi.fn(() => null), render: vi.fn(),
        };
        const counts = { ...world.counts };
        expect(() => {
            world.onLock({ u: 0.3, rows: [12], color: PIECE_COLORS[1] });
            world.onClear({ lines: 2, rowCodes: rowsOf(1, 2) });
            world.update(sim(world.time + 1, 0.1), camera);
            world.prerender(renderer);
        }).not.toThrow();
        expect(world.counts).toEqual(counts);
        expect(renderer.render).not.toHaveBeenCalled();
    });
});
