import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import {
    BOMB_SLOTS, CINDER_PALETTES, CLEAR_REACH, CLEAR_TRAVEL, DRIFT_DIR, FALL, FISSURE_Z, FOUNTAIN_SLOTS, GRAVITY,
    HEAT_EXTENT, HEAT_HOLD, HEAT_MAX, HEAT_SIZE, LAKE, PALETTE_KEYS, PLATE_CELLS, RING_REACH, SKYLIGHT, STREAM_SLOTS,
    TAU, WHITE_HEAT, approach, clamp01, clearPassTime, clearRadius, fissuresForCombo, flightTime, lerp, linRGB,
    mulberry32, pieceColor, powerForCombo, rigForAspect, ringRadius, smooth,
} from '../../src/themes/cinder-drift/cinder-drift-core.js';
import { HeatField } from '../../src/themes/cinder-drift/cinder-drift-heat.js';
import {
    COLUMN_STRIDE, ISLANDS, MOUTH, SHORE_REACH, SHORE_SIZE, buildPlan, farWallZ, fbm, leftWallX, packColumns,
    rightWallX, valueNoise,
} from '../../src/themes/cinder-drift/cinder-drift-layout.js';
import {
    NOISE_SIZE, PLATE_SIZE, bakeNoise, bakePlates, sampleField,
} from '../../src/themes/cinder-drift/cinder-drift-tsl.js';
import {
    BOARD_GRID, PLAYER_SLOTS, boardFor, boardPoint, cardUnion, fallbackLayout, layoutsDiffer,
} from '../../src/themes/cinder-drift/cinder-drift-composition.js';
import { QUALITY, QUALITY_NAMES, tierFor } from '../../src/themes/cinder-drift/cinder-drift-quality.js';
import { POST_LOOK } from '../../src/themes/cinder-drift/cinder-drift-post.js';
import { REST_RIG, fovForAspect } from '../../src/themes/cinder-drift/cinder-drift-world.js';
import { CINDER_DRIFT_TETROMINOS } from '../../src/themes/cinder-drift/cinder-drift-tetrominos.js';

const plan = buildPlan();
const packed = packColumns(plan);
/** The plan as the cheapest tier cuts it. */
const coarse = buildPlan({ detail: QUALITY.Minimal.detail });

/** The camera the composition is measured in: on the ledge, turned and tilted as its rig says. */
function restCamera(aspect) {
    const rig = rigForAspect(aspect);
    const camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, REST_RIG.near, REST_RIG.far);
    camera.position.set(0, REST_RIG.height, 0);
    camera.lookAt(-Math.sin(rig.yaw) * 10, REST_RIG.height + Math.tan(rig.pitch) * 10, -Math.cos(rig.yaw) * 10);
    camera.updateMatrixWorld();
    return camera;
}

/** Where a world point stands on screen (fractions, y down) and whether it is in front of the lens. */
function onScreen(camera, x, y, z) {
    const point = new THREE.Vector3(x, y, z).project(camera);
    return { x: point.x * 0.5 + 0.5, y: 0.5 - point.y * 0.5, ahead: point.z < 1 };
}

/** True when two float arrays hold the same numbers. */
function sameFloats(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
    return true;
}

/** A cheap assertion for loops over thousands of columns: it names the first one that fails. */
function check(ok, label) {
    if (!ok) throw new Error(label);
}

const mean = (values) => values.reduce((sum, v) => sum + v, 0) / values.length;
const sum3 = (rgb) => rgb[0] + rgb[1] + rgb[2];

describe('cinder drift core maths', () => {
    it('grows a lock ring fast, then settles it inside its reach', () => {
        expect(ringRadius(-1)).toBe(0);
        expect(ringRadius(0)).toBe(0);
        expect(ringRadius(0.4)).toBeGreaterThan(ringRadius(0.2));
        expect(ringRadius(0.2)).toBeGreaterThan(0);
        // Fast first: the second fifth of a second covers less than the first.
        expect(ringRadius(0.4) - ringRadius(0.2)).toBeLessThan(ringRadius(0.2));
        expect(ringRadius(60)).toBeLessThanOrEqual(RING_REACH);
        expect(ringRadius(60)).toBeGreaterThan(RING_REACH * 0.99);
        // A softer lock reaches a fraction of the way.
        expect(ringRadius(0.5, 0.5)).toBeCloseTo(ringRadius(0.5) * 0.5, 9);
        expect(ringRadius(60, 0.72)).toBeLessThanOrEqual(RING_REACH * 0.72);
    });

    it('runs a clear wave out through the chamber, accelerating, and knows when it passes a point', () => {
        expect(clearRadius(-1)).toBe(0);
        expect(clearRadius(0)).toBe(0);
        expect(clearRadius(CLEAR_TRAVEL)).toBeCloseTo(CLEAR_REACH, 9);
        expect(clearRadius(CLEAR_TRAVEL * 3)).toBeCloseTo(CLEAR_REACH, 9);
        // It accelerates: half the time covers less than half the way.
        expect(clearRadius(CLEAR_TRAVEL * 0.5)).toBeLessThan(CLEAR_REACH * 0.5);
        let previous = 0;
        for (let i = 1; i <= 20; i++) {
            const radius = clearRadius((CLEAR_TRAVEL * i) / 20);
            expect(radius).toBeGreaterThan(previous);
            previous = radius;
        }
        // The pass time is the wave's inverse: a fountain stands up exactly as the front arrives.
        for (const fraction of [0.02, 0.15, 0.6, 1]) {
            const dist = CLEAR_REACH * fraction;
            expect(clearRadius(clearPassTime(dist))).toBeCloseTo(dist, 6);
        }
        for (const fraction of [0.1, 0.5, 0.9]) {
            const age = CLEAR_TRAVEL * fraction;
            expect(clearPassTime(clearRadius(age))).toBeCloseTo(age, 9);
        }
        expect(clearPassTime(0)).toBe(0);
        expect(clearPassTime(-5)).toBe(0);
        expect(clearPassTime(CLEAR_REACH * 10)).toBe(CLEAR_TRAVEL);
        // The far wall lies inside its reach: the wave runs the length of the chamber.
        expect(CLEAR_REACH).toBeGreaterThan(Math.abs(farWallZ(0)));
    });

    it('raises the pressure with the combo, and never past full', () => {
        expect(powerForCombo(0)).toBe(0);
        expect(powerForCombo(-2)).toBe(0);
        expect(powerForCombo(NaN)).toBe(0);
        expect(powerForCombo(1)).toBeGreaterThan(0);
        for (let combo = 1; combo <= 40; combo++) {
            expect(powerForCombo(combo), `combo ${combo}`).toBeGreaterThanOrEqual(powerForCombo(combo - 1));
            expect(powerForCombo(combo), `combo ${combo}`).toBeLessThanOrEqual(1);
        }
        // The first steps of a chain are the ones that are felt.
        for (let combo = 1; combo <= 8; combo++) {
            expect(powerForCombo(combo), `combo ${combo}`).toBeGreaterThan(powerForCombo(combo - 1));
        }
        expect(powerForCombo(2) - powerForCombo(1)).toBeGreaterThan(powerForCombo(8) - powerForCombo(7));
        expect(powerForCombo(500)).toBeLessThanOrEqual(1);
    });

    it('cracks a fissure for every step of a chain past the first, as many as there are streams', () => {
        expect(fissuresForCombo(0)).toBe(0);
        expect(fissuresForCombo(-3)).toBe(0);
        // One clear is not a chain.
        expect(fissuresForCombo(1)).toBe(0);
        expect(fissuresForCombo(2)).toBe(1);
        for (let combo = 2; combo <= STREAM_SLOTS + 1; combo++) {
            expect(fissuresForCombo(combo), `combo ${combo}`).toBe(fissuresForCombo(combo - 1) + 1);
        }
        expect(fissuresForCombo(STREAM_SLOTS + 1)).toBe(STREAM_SLOTS);
        expect(fissuresForCombo(STREAM_SLOTS + 2)).toBe(STREAM_SLOTS);
        expect(fissuresForCombo(1000)).toBe(STREAM_SLOTS);
        // A fraction of a step counts as the nearest whole one.
        expect(fissuresForCombo(2.4)).toBe(fissuresForCombo(2));
        expect(fissuresForCombo(2.6)).toBe(fissuresForCombo(3));
    });

    it('times a throw so that it comes back down to the lake', () => {
        const height = (vy, y0, t) => y0 + vy * t - 0.5 * GRAVITY * t * t;
        for (const [vy, y0] of [[5, 0], [12, 0], [5, 3], [0, 8], [-4, 8], [9.5, 2.5]]) {
            const flight = flightTime(vy, y0);
            expect(flight, `${vy} from ${y0}`).toBeGreaterThan(0);
            expect(height(vy, y0, flight), `${vy} from ${y0}`).toBeCloseTo(0, 9);
            // Not before: it is still in the air half-way through.
            expect(height(vy, y0, flight * 0.5), `${vy} from ${y0}`).toBeGreaterThan(0);
        }
        // Up and down again takes twice the climb.
        expect(flightTime(5)).toBeCloseTo((2 * 5) / GRAVITY, 12);
        // Harder, or from higher, is longer in the air.
        expect(flightTime(7)).toBeGreaterThan(flightTime(5));
        expect(flightTime(5, 3)).toBeGreaterThan(flightTime(5));
        // Nothing thrown down from the surface flies at all, and nothing starts under it.
        expect(flightTime(-5)).toBe(0);
        expect(flightTime(0)).toBe(0);
        expect(flightTime(5, -3)).toBe(flightTime(5));
    });

    it('eases, clamps and blends the way the choreography expects', () => {
        // Frame-rate independent: two half steps close the same gap as one whole step.
        expect(approach(3, 0)).toBe(0);
        expect(approach(3, 0.1)).toBeGreaterThan(0);
        expect(approach(3, 100)).toBeLessThanOrEqual(1);
        const half = approach(2.4, 1 / 120);
        expect(1 - (1 - half) * (1 - half)).toBeCloseTo(approach(2.4, 1 / 60), 12);
        expect(clamp01(-0.2)).toBe(0);
        expect(clamp01(0.3)).toBe(0.3);
        expect(clamp01(7)).toBe(1);
        expect(lerp(2, 6, 0)).toBe(2);
        expect(lerp(2, 6, 1)).toBe(6);
        expect(lerp(2, 6, 0.25)).toBe(3);
        expect(smooth(1, 3, 0)).toBe(0);
        expect(smooth(1, 3, 1)).toBe(0);
        expect(smooth(1, 3, 2)).toBeCloseTo(0.5, 12);
        expect(smooth(1, 3, 3)).toBe(1);
        expect(smooth(1, 3, 9)).toBe(1);
        expect(smooth(1, 3, 1.5)).toBeLessThan(smooth(1, 3, 2.5));
    });

    it('converts sRGB hex to scene-linear and seeds a repeatable generator', () => {
        expect(linRGB(0x000000)).toEqual([0, 0, 0]);
        expect(linRGB(0xffffff).every((c) => Math.abs(c - 1) < 1e-9)).toBe(true);
        expect(linRGB(0x808080)[0]).toBeCloseTo(0.2158, 3);
        const a = mulberry32(7);
        const b = mulberry32(7);
        const other = mulberry32(8);
        let differs = false;
        for (let i = 0; i < 50; i++) {
            const v = a();
            expect(v).toBe(b());
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThan(1);
            if (other() !== v) differs = true;
        }
        expect(differs).toBe(true);
    });

    it('gives a lock the piece\'s colour drawn toward the fire: never over full, never cold', () => {
        const cold = [0x0000ff, 0x00ffff, 0x00ff00, 0x8090e0, 0x40a0ff];
        const neutral = [0xffffff, 0x808080, 0x333333, 0x000000];
        const warm = Object.values(CINDER_DRIFT_TETROMINOS.colors);
        for (const value of [...cold, ...neutral, ...warm, '#a8ffe8', 'ffd4a8']) {
            const rgb = pieceColor(value);
            expect(rgb, String(value)).toHaveLength(3);
            for (const channel of rgb) {
                expect(Number.isFinite(channel), String(value)).toBe(true);
                expect(channel, String(value)).toBeGreaterThan(0);
                expect(channel, String(value)).toBeLessThanOrEqual(1 + 1e-9);
            }
        }
        // The theme's own pieces are the colours of fire: red leads, blue trails it.
        for (const [shape, hex] of Object.entries(CINDER_DRIFT_TETROMINOS.colors)) {
            const rgb = pieceColor(hex);
            expect(rgb[0], shape).toBeCloseTo(Math.max(...rgb), 9);
            expect(rgb[0], shape).toBeCloseTo(1, 6);
            expect(rgb[2], shape).toBeLessThan(rgb[0]);
        }
        // A piece keeps its hue...
        const blue = pieceColor(0x0000ff);
        expect(blue[2]).toBeGreaterThan(blue[0]);
        expect(blue[2]).toBeGreaterThan(blue[1]);
        const gold = pieceColor('#ffcc00');
        expect(gold[0]).toBeGreaterThan(gold[1]);
        expect(gold[1]).toBeGreaterThan(gold[2]);
        // ...but none comes out cold: even pure blue carries more red than pure red carries blue,
        const red = pieceColor(0xff0000);
        for (const value of cold) {
            const rgb = pieceColor(value);
            const plain = linRGB(value);
            const peak = Math.max(...plain);
            expect(rgb[0], String(value)).toBeGreaterThan(red[2]);
            // and every cold piece is warmer (red over blue) than it went in.
            expect(rgb[0] - rgb[2], String(value)).toBeGreaterThan((plain[0] - plain[2]) / peak);
        }
        // And a colourless piece is thrown in as fire: warm white, red over green over blue.
        for (const value of [0xffffff, 0x808080]) {
            const rgb = pieceColor(value);
            expect(rgb[0], String(value)).toBeGreaterThan(rgb[1]);
            expect(rgb[1], String(value)).toBeGreaterThan(rgb[2]);
        }
        expect(pieceColor('a8ffe8')).toEqual(pieceColor('#A8FFE8'));
        expect(pieceColor(' #a8ffe8 ')).toEqual(pieceColor(0xa8ffe8));
        // Nonsense falls back to the given colour.
        expect(pieceColor('teal', 0x00ff00)).toEqual(pieceColor(0x00ff00));
        expect(pieceColor(null)).toEqual(pieceColor(undefined));
        expect(pieceColor(NaN, 0x123456)).toEqual(pieceColor(0x123456));
        expect(pieceColor({}, 0x123456)).toEqual(pieceColor(0x123456));
        // A lock with no colour at all is an ember.
        const ember = pieceColor(null);
        expect(ember[0]).toBeGreaterThan(ember[1]);
        expect(ember[1]).toBeGreaterThan(ember[2]);
    });

    it('defines every palette key for every level\'s palette, in scene-linear light', () => {
        expect(CINDER_PALETTES.length).toBeGreaterThan(1);
        expect(new Set(CINDER_PALETTES.map((p) => p.name)).size).toBe(CINDER_PALETTES.length);
        for (const palette of CINDER_PALETTES) {
            expect(typeof palette.name).toBe('string');
            for (const key of PALETTE_KEYS) {
                expect(palette[key], `${palette.name}.${key}`).toHaveLength(3);
                for (const channel of palette[key]) {
                    expect(Number.isFinite(channel), `${palette.name}.${key}`).toBe(true);
                    expect(channel, `${palette.name}.${key}`).toBeGreaterThanOrEqual(0);
                }
            }
            // Lava cools from its heart through its body to its skin...
            expect(sum3(palette.hot), palette.name).toBeGreaterThan(sum3(palette.mid));
            expect(sum3(palette.mid), palette.name).toBeGreaterThan(sum3(palette.deep));
            // ...it is fire in every palette, and the night that looks in is not.
            for (const key of ['hot', 'mid', 'deep', 'spark']) {
                expect(palette[key][0], `${palette.name}.${key}`).toBe(Math.max(...palette[key]));
            }
            expect(palette.cool[2], palette.name).toBeGreaterThan(palette.cool[0]);
            // The rock is dark: it is the lake that lights the chamber.
            expect(sum3(palette.rock), palette.name).toBeLessThan(sum3(palette.deep));
        }
        expect(WHITE_HEAT).toHaveLength(3);
        expect(Math.max(...WHITE_HEAT)).toBeLessThanOrEqual(1);
        expect(Math.min(...WHITE_HEAT)).toBeGreaterThan(0.5);
    });

    it('turns the camera toward the fall and tilts it up for an upright phone', () => {
        const wide = rigForAspect(16 / 9);
        const tall = rigForAspect(9 / 19.5);
        const square = rigForAspect(1);
        // Landscape leaves the centre to the board and looks straight down the chamber.
        expect(Math.abs(wide.yaw)).toBeLessThan(0.02);
        // An upright frame shows the chamber only above and below the card: turn left, look up.
        expect(tall.yaw).toBeGreaterThan(wide.yaw);
        expect(tall.pitch).toBeGreaterThan(wide.pitch);
        for (const rig of [wide, tall, square, rigForAspect(32 / 9), rigForAspect(0.2)]) {
            expect(rig.pitch).toBeGreaterThan(0); // always a little up, at the roof
            expect(rig.pitch).toBeLessThan(Math.PI / 6);
            expect(rig.yaw).toBeGreaterThanOrEqual(0);
            expect(rig.yaw).toBeLessThan(Math.PI / 6);
        }
        // A square frame sits between the two, and nothing jumps on the way.
        expect(square.yaw).toBeGreaterThan(wide.yaw);
        expect(square.yaw).toBeLessThan(tall.yaw);
        expect(square.pitch).toBeGreaterThan(wide.pitch);
        expect(square.pitch).toBeLessThan(tall.pitch);
        let previous = rigForAspect(0.3);
        for (let aspect = 0.35; aspect <= 3; aspect += 0.05) {
            const rig = rigForAspect(aspect);
            expect(rig.yaw, `aspect ${aspect}`).toBeLessThanOrEqual(previous.yaw + 1e-12);
            expect(rig.pitch, `aspect ${aspect}`).toBeLessThanOrEqual(previous.pitch + 1e-12);
            expect(previous.yaw - rig.yaw, `aspect ${aspect}`).toBeLessThan(tall.yaw * 0.25);
            previous = rig;
        }
        // Nonsense falls back to the landscape composition.
        expect(rigForAspect(NaN)).toEqual(wide);
        expect(rigForAspect(0)).toEqual(wide);
        expect(rigForAspect(-2)).toEqual(wide);
        expect(rigForAspect(undefined)).toEqual(wide);
    });

    it('lays the chamber out inside the square of lake it draws', () => {
        const inLake = (x, z) => x > LAKE.x0 && x < LAKE.x1 && z > LAKE.z0 && z < LAKE.z1;
        expect(inLake(0, 0)).toBe(true); // the ledge the camera stands on
        expect(inLake(0, FISSURE_Z)).toBe(true);
        expect(inLake(SKYLIGHT.foot[0], SKYLIGHT.foot[2])).toBe(true);
        expect(inLake(leftWallX(FALL.z), FALL.z)).toBe(true);
        expect(FISSURE_Z).toBeLessThan(0); // ahead of the camera
        expect(FALL.z).toBeLessThan(FISSURE_Z); // the fall stands beyond the fissure
        expect(FALL.lipY).toBeGreaterThan(REST_RIG.height);
        // The night comes in from above and lands lower down.
        expect(SKYLIGHT.top[1]).toBeGreaterThan(SKYLIGHT.foot[1]);
        expect(SKYLIGHT.radius).toBeGreaterThan(0);
        // The crust drifts along a unit direction, toward the viewer's right.
        expect(Math.hypot(...DRIFT_DIR)).toBeCloseTo(1, 2);
        expect(DRIFT_DIR[0]).toBeGreaterThan(0);
        // The lake's memory of heat is a square of crust, smaller than the lake: it tiles.
        expect(HEAT_EXTENT).toBeLessThan(LAKE.x1 - LAKE.x0);
        expect(HEAT_MAX).toBeGreaterThan(1);
    });
});

describe('cinder drift heat field', () => {
    const texel = HEAT_EXTENT / HEAT_SIZE;
    /** Plate-space coordinate of the centre of texel `i`. */
    const centre = (i) => (i + 0.5) * texel;
    const hottest = (field) => field.data.reduce((max, v) => Math.max(max, v), 0);

    it('starts cold, and melts a pool that is hottest at its heart', () => {
        const field = new HeatField();
        expect(field.data).toHaveLength(HEAT_SIZE * HEAT_SIZE);
        expect(field.size).toBe(HEAT_SIZE);
        expect(field.extent).toBe(HEAT_EXTENT);
        expect(field.hold).toBe(HEAT_HOLD);
        expect(field.total()).toBe(0);
        expect(field.sample(3, 4, 9)).toBe(0);
        const { version } = field;
        const radius = 2.5;
        const touched = field.stamp(centre(40), centre(70), radius, 1.2, 5);
        expect(touched).toBeGreaterThan(1);
        expect(touched).toBeLessThan(field.data.length);
        expect(field.version).toBe(version + 1);
        expect(field.ref).toBe(5);
        expect(field.total()).toBeGreaterThan(1.2);
        const at = (dx, dz = 0) => field.sample(centre(40) + dx, centre(70) + dz, 5);
        expect(at(0)).toBeCloseTo(1.2, 6);
        // It falls away on every side alike, and is gone a few radii out.
        let previous = at(0);
        for (const k of [0.5, 1, 1.5]) {
            const heat = at(radius * k);
            expect(heat, `${k} radii`).toBeGreaterThan(0);
            expect(heat, `${k} radii`).toBeLessThan(previous);
            expect(at(-radius * k), `${k} radii`).toBeCloseTo(heat, 6);
            expect(at(0, radius * k), `${k} radii`).toBeCloseTo(heat, 6);
            previous = heat;
        }
        expect(at(radius * 3)).toBe(0);
        expect(at(0, -radius * 3)).toBe(0);
        // Between two texels it reads their mean: the shader's bilinear fetch.
        const row = 70 * HEAT_SIZE;
        expect(at(texel * 0.5)).toBeCloseTo((field.data[row + 40] + field.data[row + 41]) / 2, 6);
        // A bigger pool touches more of the lake.
        const wide = new HeatField();
        expect(wide.stamp(centre(40), centre(70), radius * 2, 1.2, 5)).toBeGreaterThan(touched);
    });

    it('cools every pool together, to 1/e in its hold', () => {
        const field = new HeatField();
        field.stamp(centre(10), centre(10), 2, 1, 3);
        field.stamp(centre(60), centre(90), 3, 0.5, 3);
        const at = (time) => field.sample(centre(10), centre(10), time);
        expect(at(3)).toBeCloseTo(1, 6);
        expect(at(3 + HEAT_HOLD) / at(3)).toBeCloseTo(Math.exp(-1), 9);
        expect(at(3 + HEAT_HOLD * 0.25) / at(3)).toBeCloseTo(Math.exp(-0.25), 9);
        expect(field.total(3 + HEAT_HOLD) / field.total(3)).toBeCloseTo(Math.exp(-1), 9);
        expect(field.sample(centre(60), centre(90), 3 + HEAT_HOLD)).toBeCloseTo(0.5 * Math.exp(-1), 6);
        let previous = at(3);
        for (let time = 4; time < 3 + HEAT_HOLD * 6; time += HEAT_HOLD / 3) {
            expect(at(time)).toBeLessThan(previous);
            previous = at(time);
        }
        expect(previous).toBeLessThan(0.01);
        // It is never hotter than it was written: asking about the past returns the pool as it was made.
        expect(at(1)).toBe(at(3));
        expect(field.total(-4)).toBe(field.total(3));
        // Reading does not write.
        expect(field.ref).toBe(3);
        // A field can be given its own hold.
        const quick = new HeatField({ hold: 2 });
        quick.stamp(centre(10), centre(10), 2, 1, 0);
        expect(quick.sample(centre(10), centre(10), 2)).toBeCloseTo(Math.exp(-1), 6);
    });

    it('wraps at its edges, writing and reading', () => {
        const field = new HeatField();
        field.stamp(centre(0), centre(0), 2.5, 1, 0);
        const last = HEAT_SIZE - 1;
        // The pool spills over both edges onto the far side of the square.
        expect(field.data[0]).toBeCloseTo(1, 6);
        expect(field.data[last]).toBeGreaterThan(0);
        expect(field.data[last * HEAT_SIZE]).toBeGreaterThan(0);
        expect(field.data[last * HEAT_SIZE + last]).toBeGreaterThan(0);
        expect(field.data[last]).toBeCloseTo(field.data[1], 6);
        expect(field.data[last * HEAT_SIZE]).toBeCloseTo(field.data[HEAT_SIZE], 6);
        for (const [x, z] of [[centre(0), centre(0)], [1.3, -1.6], [-0.4, 0.2]]) {
            const heat = field.sample(x, z);
            expect(heat).toBeGreaterThan(0);
            expect(field.sample(x + HEAT_EXTENT, z - HEAT_EXTENT)).toBeCloseTo(heat, 6);
            expect(field.sample(x - 3 * HEAT_EXTENT, z + 2 * HEAT_EXTENT)).toBeCloseTo(heat, 6);
        }
        // A pool melted a whole field away lands on the same crust: the lake's memory tiles.
        const other = new HeatField();
        other.stamp(centre(0) + HEAT_EXTENT * 2, centre(0) - HEAT_EXTENT, 2.5, 1, 0);
        let worst = 0;
        for (let i = 0; i < field.data.length; i++) worst = Math.max(worst, Math.abs(field.data[i] - other.data[i]));
        expect(worst).toBeLessThan(1e-6);
    });

    it('never holds more than its fill', () => {
        const field = new HeatField();
        for (let i = 0; i < 12; i++) field.stamp(centre(20), centre(20), 3, 1, 1);
        expect(field.sample(centre(20), centre(20), 1)).toBeCloseTo(HEAT_MAX, 5);
        expect(hottest(field)).toBeLessThanOrEqual(Math.fround(HEAT_MAX));
        // One pool far too hot is clamped as well, and a later one cannot push past it.
        const hot = new HeatField();
        hot.stamp(centre(20), centre(20), 3, HEAT_MAX * 40, 1);
        expect(hottest(hot)).toBeLessThanOrEqual(Math.fround(HEAT_MAX));
        hot.stamp(centre(21), centre(20), 3, 1, 1);
        expect(hottest(hot)).toBeLessThanOrEqual(Math.fround(HEAT_MAX));
        // Clamped, it still cools like everything else.
        expect(hot.sample(centre(20), centre(20), 1 + HEAT_HOLD)).toBeCloseTo(HEAT_MAX * Math.exp(-1), 5);
    });

    it('cools the whole field to the present before it writes, and never jumps', () => {
        const field = new HeatField();
        const a = [centre(30), centre(30)];
        field.stamp(a[0], a[1], 2, 1.5, 2);
        const before = field.sample(a[0], a[1], 7);
        expect(before).toBeCloseTo(1.5 * Math.exp(-5 / HEAT_HOLD), 6);
        // A second pool, far away and later: the stored field moves to that moment first.
        field.stamp(centre(90), centre(90), 2, 1, 7);
        expect(field.ref).toBe(7);
        expect(field.sample(a[0], a[1], 7)).toBeCloseTo(before, 6);
        expect(field.sample(centre(90), centre(90), 7)).toBeCloseTo(1, 6);
        // The first pool goes on cooling from its own beginning, not from the rewrite.
        expect(field.sample(a[0], a[1], 2 + HEAT_HOLD)).toBeCloseTo(1.5 * Math.exp(-1), 6);

        // Re-basing alone changes nothing that can be read.
        const later = field.sample(a[0], a[1], 12);
        const total = field.total(12);
        field.rebase(12);
        expect(field.ref).toBe(12);
        expect(field.sample(a[0], a[1], 12)).toBeCloseTo(later, 6);
        expect(field.sample(a[0], a[1])).toBeCloseTo(later, 6); // read "now" by default
        expect(field.total()).toBeCloseTo(total, 4);
        expect(field.sample(a[0], a[1], 20)).toBeCloseTo(later * Math.exp(-8 / HEAT_HOLD), 6);
        // Time does not run backwards, and nonsense is not a time.
        const stored = Array.from(field.data);
        field.rebase(3);
        field.rebase(NaN);
        field.rebase(undefined);
        expect(field.ref).toBe(12);
        expect(Array.from(field.data)).toEqual(stored);
    });

    it('ignores a pool with no size or no heat', () => {
        const field = new HeatField();
        const { version } = field;
        for (const [radius, amount] of [[0, 1], [-2, 1], [2, 0], [2, -1], [NaN, 1], [2, NaN], [undefined, undefined]]) {
            expect(field.stamp(centre(5), centre(5), radius, amount, 4), `${radius}, ${amount}`).toBe(0);
        }
        expect(field.version).toBe(version);
        expect(field.ref).toBe(0);
        expect(field.total()).toBe(0);
        // A pool nowhere, or at no time, never poisons the field.
        field.stamp(NaN, centre(5), 2, 1, 4);
        field.stamp(centre(5), centre(5), 2, 1, NaN);
        expect(field.data.every((heat) => Number.isFinite(heat))).toBe(true);
        expect(Number.isFinite(field.ref)).toBe(true);
    });

    it('forgets everything on reset, and says so', () => {
        const field = new HeatField();
        field.stamp(centre(8), centre(8), 3, 2, 6);
        const { version } = field;
        field.reset(30);
        expect(field.data.every((heat) => heat === 0)).toBe(true);
        expect(field.ref).toBe(30);
        expect(field.version).toBe(version + 1);
        expect(field.sample(centre(8), centre(8), 31)).toBe(0);
        expect(field.total(31)).toBe(0);
        // Whoever mirrors the field uploads again after every write.
        field.stamp(centre(8), centre(8), 3, 2, 31);
        expect(field.version).toBe(version + 2);
        field.reset();
        expect(field.ref).toBe(0);
        expect(field.version).toBe(version + 3);
    });
});

describe('cinder drift baked fields', () => {
    const noise = bakeNoise();

    it('bakes four tileable noise channels stretched to the unit range, the same every time', () => {
        expect(noise).toHaveLength(NOISE_SIZE * NOISE_SIZE * 4);
        const lo = [Infinity, Infinity, Infinity, Infinity];
        const hi = [-Infinity, -Infinity, -Infinity, -Infinity];
        for (let i = 0; i < noise.length; i++) {
            lo[i % 4] = Math.min(lo[i % 4], noise[i]);
            hi[i % 4] = Math.max(hi[i % 4], noise[i]);
        }
        for (let c = 0; c < 4; c++) {
            expect(lo[c]).toBeCloseTo(0, 5);
            expect(hi[c]).toBeCloseTo(1, 5);
        }
        const again = bakeNoise();
        for (let i = 0; i < noise.length; i += 997) expect(again[i]).toBe(noise[i]);
        // The channels are decorrelated: no two are the same field.
        for (let c = 1; c < 4; c++) {
            let differ = 0;
            for (let i = 0; i < noise.length; i += 4 * 61) differ += Math.abs(noise[i] - noise[i + c]) > 0.05 ? 1 : 0;
            expect(differ, `channel ${c}`).toBeGreaterThan(10);
        }
    });

    it('reads a field bilinearly and wraps at its edges', () => {
        for (const [x, y] of [[0.3, 0.7], [0.999, 0.001], [0, 0]]) {
            const v = sampleField(noise, NOISE_SIZE, x, y, 1);
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThanOrEqual(1);
            expect(sampleField(noise, NOISE_SIZE, x + 1, y - 1, 1)).toBeCloseTo(v, 9);
        }
        // At a texel centre it returns the texel.
        const texelAt = (ix, iy, c) => noise[(iy * NOISE_SIZE + ix) * 4 + c];
        const centre = sampleField(noise, NOISE_SIZE, 10.5 / NOISE_SIZE, 20.5 / NOISE_SIZE, 2);
        expect(centre).toBeCloseTo(texelAt(10, 20, 2), 6);
        // The first channel is the default.
        expect(sampleField(noise, NOISE_SIZE, 0.25, 0.75)).toBe(sampleField(noise, NOISE_SIZE, 0.25, 0.75, 0));
    });

    it('bakes the crust\'s plates: cracks between them, one number per plate, a tile with no seam', () => {
        const plates = bakePlates();
        expect(plates).toHaveLength(PLATE_SIZE * PLATE_SIZE * 4);
        const at = (x, y, c) => plates[(y * PLATE_SIZE + x) * 4 + c];
        const ids = new Set();
        let cracks = 0;
        let hearts = 0;
        let outside = 0;
        for (let i = 0; i < plates.length; i += 4) {
            for (let c = 0; c < 4; c++) outside += plates[i + c] >= 0 && plates[i + c] <= 1 ? 0 : 1;
            ids.add(plates[i + 1]);
            if (plates[i] < 0.02) cracks += 1; // on a seam
            if (plates[i] > 0.5) hearts += 1; // deep inside a plate
        }
        expect(outside).toBe(0);
        // Every plate carries its own number, the same across the whole of it.
        expect(ids.size).toBe(PLATE_CELLS * PLATE_CELLS);
        // Most of the crust is plate, and the seams are thin.
        expect(cracks).toBeGreaterThan(0);
        expect(hearts).toBeGreaterThan(cracks);
        expect(cracks).toBeLessThan((PLATE_SIZE * PLATE_SIZE) / 10);
        // The edge distance runs through the wrap as smoothly as it does anywhere else.
        const step = (x0, x1) => {
            let total = 0;
            for (let y = 0; y < PLATE_SIZE; y++) total += Math.abs(at(x0, y, 0) - at(x1, y, 0));
            return total / PLATE_SIZE;
        };
        const inside = step(PLATE_SIZE / 2, PLATE_SIZE / 2 + 1);
        expect(step(PLATE_SIZE - 1, 0)).toBeLessThan(inside * 2);
        expect(step(PLATE_SIZE - 1, 0)).toBeLessThan(step(0, PLATE_SIZE / 2) / 2);
        // The same crust every time, and another for another seed.
        const again = bakePlates();
        for (let i = 0; i < plates.length; i += 1013) expect(again[i]).toBe(plates[i]);
        const other = bakePlates(1234, 64, 5);
        expect(other).toHaveLength(64 * 64 * 4);
        expect(new Set(Array.from(other).filter((v, i) => i % 4 === 1)).size).toBe(25);
    });

    it('builds the plan\'s own noise in the unit range, repeatably', () => {
        for (const [x, y] of [[0, 0], [3.7, -2.2], [-41.3, 180.9], [1e4, -1e4]]) {
            for (const seed of [0, 7, 0x51cd]) {
                const v = valueNoise(x, y, seed);
                expect(v).toBeGreaterThanOrEqual(0);
                expect(v).toBeLessThanOrEqual(1);
                expect(valueNoise(x, y, seed)).toBe(v);
                const f = fbm(x, y, seed);
                expect(f).toBeGreaterThanOrEqual(0);
                expect(f).toBeLessThanOrEqual(1);
                expect(fbm(x, y, seed)).toBe(f);
            }
        }
        // It is smooth: a short step moves it a little, and a seed moves the whole field.
        expect(Math.abs(valueNoise(3.7, -2.2) - valueNoise(3.71, -2.2))).toBeLessThan(0.05);
        expect(valueNoise(3.7, -2.2, 1)).not.toBe(valueNoise(3.7, -2.2, 2));
        // At a lattice point it is the lattice value on every side.
        expect(valueNoise(5, 9, 3)).toBeCloseTo(valueNoise(5 - 1e-9, 9 - 1e-9, 3), 6);
    });
});

describe('cinder drift chamber plan', () => {
    it('is deterministic for a seed and different for another', () => {
        const again = buildPlan();
        expect(again.seed).toBe(plan.seed);
        expect(again.detail).toBe(1);
        expect(again.columns).toHaveLength(plan.columns.length);
        expect(sameFloats(packColumns(again), packed)).toBe(true);
        expect(sameFloats(again.shore, plan.shore)).toBe(true);
        expect(again.counts).toEqual(plan.counts);
        expect(again.fall).toEqual(plan.fall);
        expect(again.fallLight).toEqual(plan.fallLight);
        expect(again.streams).toEqual(plan.streams);
        expect(again.fountains).toEqual(plan.fountains);
        // Named explicitly, the default seed is the same chamber.
        expect(sameFloats(packColumns(buildPlan({ seed: plan.seed, detail: 1 })), packed)).toBe(true);
        const other = buildPlan({ seed: 1234 });
        expect(other.seed).toBe(1234);
        expect(sameFloats(packColumns(other), packed)).toBe(false);
        expect(sameFloats(other.shore, plan.shore)).toBe(false);
        expect(other.fountains).not.toEqual(plan.fountains);
    });

    it('packs every column into its stride of finite floats, in the order the rock reads them', () => {
        expect(COLUMN_STRIDE).toBe(12); // three vec4 attributes
        expect(packed).toBeInstanceOf(Float32Array);
        expect(packed).toHaveLength(plan.columns.length * COLUMN_STRIDE);
        for (let i = 0; i < packed.length; i++) {
            check(Number.isFinite(packed[i]), `column ${Math.floor(i / COLUMN_STRIDE)}[${i % COLUMN_STRIDE}]`);
        }
        const order = [
            'x', 'z', 'y0', 'y1', 'radius', 'rot', 'seed', 'hang', 'lakeShadow', 'fallShadow', 'ao', 'open',
        ];
        expect(order).toHaveLength(COLUMN_STRIDE);
        for (let i = 0; i < plan.columns.length; i += 37) {
            const column = plan.columns[i];
            order.forEach((key, k) => {
                expect(packed[i * COLUMN_STRIDE + k], `column ${i}.${key}`).toBe(Math.fround(column[key]));
            });
        }
        // The last one too: nothing is cut off the end.
        const last = plan.columns.length - 1;
        expect(packed[last * COLUMN_STRIDE]).toBe(Math.fround(plan.columns[last].x));
        expect(packed[last * COLUMN_STRIDE + COLUMN_STRIDE - 1]).toBe(Math.fround(plan.columns[last].open));
        expect(packColumns({ columns: [] })).toHaveLength(0);
    });

    it('lists the columns nearest first, the way the solids draw', () => {
        expect(plan.columns.length).toBeGreaterThan(500);
        for (let i = 0; i < plan.columns.length; i++) {
            const column = plan.columns[i];
            // Measured along the lake from the ledge the camera stands on.
            check(Math.abs(column.dist - Math.hypot(column.x, column.z)) < 1e-9, `column ${i}: dist`);
            check(i === 0 || column.dist >= plan.columns[i - 1].dist, `column ${i}: out of order`);
        }
        // Wider the further off: a far column covers the pixels a near one does.
        const third = Math.floor(plan.columns.length / 3);
        const radius = (list) => mean(list.map((column) => column.radius));
        expect(radius(plan.columns.slice(-third))).toBeGreaterThan(radius(plan.columns.slice(0, third)));
        // And all of it inside the camera's far plane.
        expect(plan.columns[plan.columns.length - 1].dist).toBeLessThan(REST_RIG.far);
    });

    it('stands columns on rock and hangs organ pipes over the lava', () => {
        const standing = plan.columns.filter((column) => !column.hang);
        const hanging = plan.columns.filter((column) => column.hang);
        expect(plan.counts.standing).toBeGreaterThan(0);
        expect(plan.counts.hanging).toBeGreaterThan(0);
        expect(plan.counts.standing).toBe(standing.length);
        expect(plan.counts.hanging).toBe(hanging.length);
        expect(plan.counts.standing + plan.counts.hanging).toBe(plan.columns.length);
        const { lip } = plan.fall;
        // The cheapest tier's plan is cut from the same chamber: it obeys the same rules.
        for (const p of [plan, coarse]) {
            p.columns.forEach((column, index) => {
                const label = `detail ${p.detail}, column ${index}`;
                check(column.hang === 0 || column.hang === 1, `${label}: hang`);
                check(column.radius > 0, `${label}: radius`);
                check(column.rot >= 0 && column.rot < TAU, `${label}: rot`);
                check(column.seed >= 0 && column.seed < 1, `${label}: seed`);
                check(column.ao > 0 && column.ao <= 1, `${label}: ao`);
                check(Math.abs(column.open) <= Math.PI, `${label}: open`);
                // What hides it from the lake and from the fall: a height, or -1 for nothing.
                check(Number.isFinite(column.lakeShadow) && column.lakeShadow >= -1, `${label}: lakeShadow`);
                check(Number.isFinite(column.fallShadow) && column.fallShadow >= -1, `${label}: fallShadow`);
                const roof = p.ceilingAt(column.x, column.z);
                if (!column.hang) {
                    // Rooted under the lake, and standing on rock: never out on the open lava.
                    check(column.y0 < 0 && column.y1 > 0, `${label}: a standing column's ends`);
                    check(p.heightAt(column.x, column.z) > 0, `${label}: stands on open lava`);
                } else {
                    // Rooted in the roof, lit from below by nothing that needs a shadow.
                    check(column.y0 > roof, `${label}: a hanging column's root`);
                    check(column.lakeShadow === -1 && column.fallShadow === -1, `${label}: a pipe's shadows`);
                    if (Math.hypot(column.x - lip[0], column.z - lip[2]) >= MOUTH.radius) {
                        // An organ pipe: over open lava, down from the roof, clear of the lake.
                        check(p.heightAt(column.x, column.z) < 0, `${label}: a pipe over rock`);
                        check(p.depthAt(column.x, column.z) < 0, `${label}: a pipe inside rock`);
                        check(column.y1 < roof, `${label}: a pipe that does not hang`);
                        check(column.y1 > REST_RIG.height, `${label}: a pipe in the camera's face`);
                        // None hangs round the hole the night looks in through.
                        const hole = Math.hypot(column.x - SKYLIGHT.top[0], column.z - SKYLIGHT.top[2]);
                        check(hole > SKYLIGHT.radius, `${label}: a pipe in the skylight`);
                    }
                }
            });
        }
    });

    it('cuts the plan coarser for a lower tier: fewer, wider columns, the same chamber', () => {
        const fine = buildPlan({ detail: QUALITY.Extreme.detail });
        expect(coarse.detail).toBe(QUALITY.Minimal.detail);
        expect(coarse.detail).toBeGreaterThan(plan.detail);
        expect(fine.detail).toBeLessThan(plan.detail);
        expect(coarse.columns.length).toBeLessThan(plan.columns.length);
        expect(fine.columns.length).toBeGreaterThan(plan.columns.length);
        expect(coarse.counts.standing).toBeGreaterThan(0);
        expect(coarse.counts.hanging).toBeGreaterThan(0);
        expect(coarse.counts.standing).toBeLessThan(plan.counts.standing);
        expect(coarse.counts.hanging).toBeLessThan(plan.counts.hanging);
        const radius = (p) => mean(p.columns.map((column) => column.radius));
        expect(radius(coarse)).toBeGreaterThan(radius(plan));
        expect(radius(plan)).toBeGreaterThan(radius(fine));
        // What gameplay aims at does not move with the tier.
        for (const p of [coarse, fine]) {
            expect(p.seed).toBe(plan.seed);
            expect(p.fall).toEqual(plan.fall);
            expect(p.fallLight).toEqual(plan.fallLight);
            expect(p.streams).toEqual(plan.streams);
            expect(p.fountains).toEqual(plan.fountains);
            expect(sameFloats(p.shore, plan.shore)).toBe(true);
            for (const [x, z] of [[0, -20], [-30, -80], [46, -92], [70, -40]]) {
                expect(p.heightAt(x, z)).toBe(plan.heightAt(x, z));
                expect(p.depthAt(x, z)).toBe(plan.depthAt(x, z));
            }
            const all = packColumns(p);
            expect(all).toHaveLength(p.columns.length * COLUMN_STRIDE);
            expect(all.every((value) => Number.isFinite(value))).toBe(true);
            check(p.columns.every((column, i) => i === 0 || column.dist >= p.columns[i - 1].dist), 'out of order');
        }
    });

    it('closes the chamber with two cliffs and a far wall, under a roof', () => {
        for (let z = 0; z >= farWallZ(0) + 1; z -= 4) {
            expect(leftWallX(z), `z=${z}`).toBeLessThan(0);
            expect(rightWallX(z), `z=${z}`).toBeGreaterThan(0);
            expect(leftWallX(z), `z=${z}`).toBeGreaterThan(LAKE.x0);
            expect(rightWallX(z), `z=${z}`).toBeLessThan(LAKE.x1);
            // Between them, on the centre line, is the open chamber; behind them is rock.
            expect(plan.wallDepth(0, z), `z=${z}`).toBeLessThan(0);
            expect(plan.wallDepth(leftWallX(z) - 3, z), `z=${z}`).toBeGreaterThan(0);
            expect(plan.wallDepth(rightWallX(z) + 3, z), `z=${z}`).toBeGreaterThan(0);
            expect(plan.heightAt(leftWallX(z) - 3, z), `z=${z}`).toBeGreaterThan(0);
        }
        // It opens out from the ledge, and closes again in a throat at its far end.
        const width = (z) => rightWallX(z) - leftWallX(z);
        expect(width(FALL.z)).toBeGreaterThan(width(0) * 1.5);
        expect(width(farWallZ(0) + 2)).toBeLessThan(width(FALL.z));
        for (const x of [-40, -10, 0, 25, 50]) {
            expect(farWallZ(x)).toBeGreaterThan(LAKE.z0);
            expect(farWallZ(x)).toBeLessThan(FALL.z);
            expect(plan.wallDepth(x, farWallZ(x) - 3)).toBeGreaterThan(0);
        }
        // The roof is well over the camera's head everywhere it can look.
        for (let z = 0; z >= farWallZ(0); z -= 20) {
            for (const x of [leftWallX(z), 0, rightWallX(z)]) {
                expect(Number.isFinite(plan.ceilingAt(x, z))).toBe(true);
                expect(plan.ceilingAt(x, z), `(${x}, ${z})`).toBeGreaterThan(REST_RIG.height * 4);
                // No rock stands through it.
                expect(plan.heightAt(x, z), `(${x}, ${z})`).toBeLessThanOrEqual(plan.ceilingAt(x, z));
            }
        }
    });

    it('keeps the lake open where the board looks', () => {
        // Down the middle, from under the camera to well past the fissure: lava, no rock.
        for (let z = -2; z >= FISSURE_Z * 1.5; z -= 2) {
            expect(plan.depthAt(0, z), `z=${z}`).toBeLessThan(0);
            expect(plan.heightAt(0, z), `z=${z}`).toBe(-1);
        }
        // Nothing nearer than the fissure stands behind the card: the stacks that frame the
        // picture stay either side of it, in a wide frame and a squarer one.
        const near = plan.columns.filter((column) => !column.hang && column.z > FISSURE_Z);
        expect(near.length).toBeGreaterThan(0);
        for (const [width, height] of [[1600, 900], [1920, 1080], [2560, 1080], [1280, 1024], [1024, 768]]) {
            const frame = `${width}x${height}`;
            const camera = restCamera(width / height);
            const card = fallbackLayout(width, height).cards[0];
            let left = 0;
            let right = 0;
            for (const column of near) {
                for (const y of [0, column.y1]) {
                    const point = onScreen(camera, column.x, y, column.z);
                    if (!point.ahead) continue;
                    const behind = point.x > card.x0 && point.x < card.x1;
                    expect(behind, `${frame}: a column stands behind the card`).toBe(false);
                    if (point.x > 0 && point.x < card.x0) left += 1;
                    if (point.x < 1 && point.x > card.x1) right += 1;
                }
            }
            // They bracket the card: rock is in the frame on each side of it.
            expect(left, `${frame} left`).toBeGreaterThan(0);
            expect(right, `${frame} right`).toBeGreaterThan(0);
        }
    });

    it('raises islands of columns out of the lake, one of them under the skylight', () => {
        expect(plan.islands).toBe(ISLANDS);
        expect(ISLANDS.length).toBeGreaterThan(2);
        ISLANDS.forEach((island, index) => {
            const label = `island ${index}`;
            expect(island.r, label).toBeGreaterThan(0);
            expect(island.h, label).toBeGreaterThan(0);
            // Its heart is rock, standing out of the lava and clear of both cliffs.
            expect(plan.depthAt(island.x, island.z), label).toBeGreaterThan(0);
            expect(plan.heightAt(island.x, island.z), label).toBeGreaterThan(0);
            expect(plan.wallDepth(island.x, island.z), label).toBeLessThan(0);
            // And columns were cut from it.
            const mine = plan.columns.filter((column) => !column.hang
                && Math.hypot(column.x - island.x, column.z - island.z) < island.r);
            expect(mine.length, label).toBeGreaterThan(0);
            // Lava lies all the way round it.
            for (let k = 0; k < 8; k++) {
                const a = (k / 8) * TAU;
                const x = island.x + Math.cos(a) * island.r * 1.6;
                const z = island.z + Math.sin(a) * island.r * 1.6;
                if (plan.wallDepth(x, z) < -island.r) expect(plan.depthAt(x, z), `${label} at ${k}`).toBeLessThan(0);
            }
        });
        const lit = ISLANDS.filter((island) => island.x === SKYLIGHT.foot[0] && island.z === SKYLIGHT.foot[2]);
        expect(lit).toHaveLength(1);
    });

    it('pours the great fall out of the left cliff onto open lava', () => {
        const { lip, foot, width } = plan.fall;
        expect(width).toBe(FALL.width);
        expect(width).toBeGreaterThan(0);
        // The lip: in the rock of the left cliff, at the height the fall is given, under the roof.
        expect(lip[1]).toBe(FALL.lipY);
        expect(lip[2]).toBe(FALL.z);
        expect(lip[0]).toBeLessThan(0);
        expect(lip[0]).toBeLessThan(leftWallX(FALL.z));
        expect(plan.wallDepth(lip[0], lip[2])).toBeGreaterThan(0);
        expect(plan.ceilingAt(lip[0], lip[2])).toBeGreaterThan(FALL.lipY);
        // The foot: on the lake, thrown clear of the cliff's face, over lava and no rock.
        expect(foot[1]).toBe(0);
        expect(foot[0]).toBeGreaterThan(lip[0]);
        expect(foot[0] - leftWallX(FALL.z)).toBeCloseTo(FALL.reach, 9);
        expect(plan.depthAt(foot[0], foot[2])).toBeLessThan(0);
        expect(plan.heightAt(foot[0], foot[2])).toBeLessThan(0);
        // Its light, as the rock sees it: a point part of the way up the cascade, by its foot.
        const [lx, ly, lz] = plan.fallLight;
        expect(ly).toBeGreaterThan(0);
        expect(ly).toBeLessThan(FALL.lipY);
        expect(Math.hypot(lx - foot[0], lz - foot[2])).toBeLessThan(width);
        // And the fall is in the picture, left of the card, in the frames the game is played in.
        for (const [frameWidth, frameHeight] of [[1600, 900], [1920, 1080], [2560, 1080]]) {
            const camera = restCamera(frameWidth / frameHeight);
            const card = fallbackLayout(frameWidth, frameHeight).cards[0];
            for (const [x, y, z] of [lip, foot]) {
                const point = onScreen(camera, x, y, z);
                expect(point.ahead).toBe(true);
                expect(point.x).toBeGreaterThan(0);
                expect(point.x).toBeLessThan(card.x0);
                expect(point.y).toBeGreaterThan(0);
                expect(point.y).toBeLessThan(1);
            }
        }
    });

    it('cuts the fall a mouth: the cliff broken off at the lip, the roof arched over it', () => {
        const { lip } = plan.fall;
        expect(MOUTH.radius).toBeGreaterThan(FALL.width / 2); // the fall fits in its mouth
        expect(MOUTH.height).toBeGreaterThan(0);
        const away = (column) => Math.hypot(column.x - lip[0], column.z - lip[2]);
        const nearLip = plan.columns.filter((column) => away(column) < MOUTH.radius);
        // Every column of the cliff's face round the lip stops short of it.
        const cut = nearLip.filter((column) => !column.hang && plan.wallDepth(column.x, column.z) >= 0);
        expect(cut.length).toBeGreaterThan(2);
        for (const column of cut) expect(column.y1).toBeLessThan(FALL.lipY);
        // Each has a twin hanging from the roof at the same place, and an opening between the two
        // that the lip lies in.
        const arch = [];
        for (const column of cut) {
            const twin = nearLip.find((other) => other.hang && other.x === column.x && other.z === column.z);
            expect(twin, `the column at ${column.x}, ${column.z}`).toBeTruthy();
            expect(twin.y1).toBeGreaterThan(FALL.lipY);
            expect(twin.y1).toBeGreaterThan(column.y1);
            expect(twin.radius).toBe(column.radius);
            arch.push(twin);
        }
        // The arch is highest over the lip and comes down toward its rim.
        const inner = arch.filter((column) => away(column) < MOUTH.radius * 0.5);
        const outer = arch.filter((column) => away(column) >= MOUTH.radius * 0.5);
        expect(inner.length).toBeGreaterThan(0);
        expect(outer.length).toBeGreaterThan(0);
        expect(mean(inner.map((column) => column.y1))).toBeGreaterThan(mean(outer.map((column) => column.y1)));
        // The cheapest tier's plan still has a mouth.
        const coarseCut = coarse.columns.filter((column) => !column.hang && away(column) < MOUTH.radius
            && coarse.wallDepth(column.x, column.z) >= 0);
        expect(coarseCut.length).toBeGreaterThan(0);
        for (const column of coarseCut) expect(column.y1).toBeLessThan(FALL.lipY);
    });

    it('opens a fissure stream for every slot, alternating sides, nearest first on each', () => {
        expect(plan.streams).toHaveLength(STREAM_SLOTS);
        plan.streams.forEach((stream, index) => {
            const label = `stream ${index}`;
            const [lx, ly, lz] = stream.lip;
            const [fx, fy, fz] = stream.foot;
            expect(Math.abs(stream.side), label).toBe(1);
            if (index > 0) expect(stream.side, label).toBe(-plan.streams[index - 1].side);
            // It breaks out of the face of its own cliff, between the lake and the roof...
            expect(Math.sign(lx), label).toBe(stream.side);
            expect(plan.wallDepth(lx, lz), label).toBeGreaterThan(0);
            expect(ly, label).toBeGreaterThan(REST_RIG.height);
            expect(ly, label).toBeLessThan(plan.ceilingAt(lx, lz));
            // ...and lands on the lake, further into the chamber than it left, clear of the cliff.
            expect(fy, label).toBe(0);
            expect(Math.abs(fx), label).toBeLessThan(Math.abs(lx));
            expect(Math.sign(fx), label).toBe(stream.side);
            expect(plan.depthAt(fx, fz), label).toBeLessThan(0);
            expect(Math.abs(fz - lz), label).toBeLessThan(ly);
            expect(stream.width, label).toBeGreaterThan(0);
            expect(stream.width, label).toBeLessThan(FALL.width); // a stream, not a second fall
            // Beyond the fissure the board opens: a stream never pours across the card.
            expect(lz, label).toBeLessThan(FISSURE_Z);
        });
        for (const side of [-1, 1]) {
            const mine = plan.streams.filter((stream) => stream.side === side);
            expect(mine.length, `side ${side}`).toBe(STREAM_SLOTS / 2);
            for (let i = 1; i < mine.length; i++) {
                expect(mine[i].lip[2], `side ${side}`).toBeLessThan(mine[i - 1].lip[2]);
            }
        }
    });

    it('stands a fountain for every slot along the fissure, the right-hand ones further out', () => {
        expect(plan.fountains).toHaveLength(FOUNTAIN_SLOTS);
        expect(FOUNTAIN_SLOTS % 2).toBe(0);
        plan.fountains.forEach((fountain, index) => {
            const label = `fountain ${index}`;
            expect(Number.isFinite(fountain.x) && Number.isFinite(fountain.z), label).toBe(true);
            // Left, right, left, right: a clear of one line stands a pair.
            expect(Math.sign(fountain.x), label).toBe(index % 2 ? 1 : -1);
            // Out of the lake, not out of a cliff or an island.
            expect(plan.depthAt(fountain.x, fountain.z), label).toBeLessThan(0);
            expect(fountain.x, label).toBeGreaterThan(leftWallX(fountain.z));
            expect(fountain.x, label).toBeLessThan(rightWallX(fountain.z));
            // Along the fissure: ahead of the camera, nearer than the fall.
            expect(fountain.z, label).toBeLessThan(0);
            expect(fountain.z, label).toBeGreaterThan(FALL.z);
            expect(Math.abs(fountain.z - FISSURE_Z), label).toBeLessThan(Math.abs(FISSURE_Z) / 2);
            // From beside the card outward.
            if (index >= 2) {
                expect(Math.abs(fountain.x), label).toBeGreaterThan(Math.abs(plan.fountains[index - 2].x));
            }
        });
        for (let pair = 0; pair < FOUNTAIN_SLOTS / 2; pair++) {
            const left = plan.fountains[pair * 2];
            const right = plan.fountains[pair * 2 + 1];
            expect(right.x, `pair ${pair}`).toBeGreaterThan(-left.x);
        }
        // Why: on screen the left-hand ones stand left of the card, and the right-hand ones clear
        // the stats bar that stands to the card's right.
        for (const [width, height] of [[1600, 900], [1920, 1080]]) {
            const frame = `${width}x${height}`;
            const camera = restCamera(width / height);
            const layout = fallbackLayout(width, height);
            plan.fountains.forEach((fountain, index) => {
                const point = onScreen(camera, fountain.x, 0, fountain.z);
                expect(point.ahead, frame).toBe(true);
                if (index % 2) expect(point.x, `${frame} fountain ${index}`).toBeGreaterThan(layout.hud.x1);
                else expect(point.x, `${frame} fountain ${index}`).toBeLessThan(layout.cards[0].x0);
            });
            // The first pair, the one every clear stands, is well inside the frame.
            for (const fountain of plan.fountains.slice(0, 2)) {
                const point = onScreen(camera, fountain.x, 0, fountain.z);
                expect(point.x, frame).toBeGreaterThan(0.1);
                expect(point.x, frame).toBeLessThan(0.9);
            }
        }
    });

    it('measures how far every point of the lake is from rock', () => {
        expect(plan.shore).toBeInstanceOf(Float32Array);
        expect(plan.shore).toHaveLength(SHORE_SIZE * SHORE_SIZE);
        expect(SHORE_REACH).toBeGreaterThan(0);
        const at = (i, j) => plan.shore[j * SHORE_SIZE + i];
        const where = (i, j) => [
            LAKE.x0 + ((i + 0.5) / SHORE_SIZE) * (LAKE.x1 - LAKE.x0),
            LAKE.z0 + ((j + 0.5) / SHORE_SIZE) * (LAKE.z1 - LAKE.z0),
        ];
        let rock = 0;
        let open = 0;
        for (let j = 0; j < SHORE_SIZE; j++) {
            for (let i = 0; i < SHORE_SIZE; i++) {
                const value = at(i, j);
                if (!(value >= 0 && value <= 1)) throw new Error(`shore[${i}, ${j}] = ${value}`);
                if (value === 0) rock += 1;
                else open += 1;
            }
        }
        // Most of the square is the rock round the chamber; the chamber itself is open.
        expect(rock).toBeGreaterThan(0);
        expect(open).toBeGreaterThan(SHORE_SIZE);
        for (let j = 3; j < SHORE_SIZE; j += 7) {
            for (let i = 2; i < SHORE_SIZE; i += 5) {
                const [x, z] = where(i, j);
                const depth = plan.depthAt(x, z);
                // Nothing inside rock is lake, and no point is further from rock than it is.
                if (depth >= 0) expect(at(i, j), `(${x}, ${z})`).toBe(0);
                expect(at(i, j), `(${x}, ${z})`).toBeLessThanOrEqual(clamp01(-depth / SHORE_REACH) + 1e-6);
            }
        }
        // Out in the middle of the lake it is far from any shore; at the cliff's foot it is not.
        const texel = (x, z) => at(
            Math.floor(((x - LAKE.x0) / (LAKE.x1 - LAKE.x0)) * SHORE_SIZE),
            Math.floor(((z - LAKE.z0) / (LAKE.z1 - LAKE.z0)) * SHORE_SIZE),
        );
        expect(texel(0, FISSURE_Z)).toBeGreaterThan(0.25);
        expect(texel(0, FISSURE_Z)).toBeGreaterThan(texel(leftWallX(FISSURE_Z) + 4, FISSURE_Z));
        expect(texel(leftWallX(FISSURE_Z) - 6, FISSURE_Z)).toBe(0);
        const largest = ISLANDS.reduce((a, b) => (b.r > a.r ? b : a));
        expect(texel(largest.x, largest.z)).toBe(0);
    });
});

describe('cinder drift composition helpers', () => {
    it('seats the fallback board at the foot of its card in a wide frame and an upright one', () => {
        for (const [width, height] of [[1600, 900], [2560, 1080], [430, 932]]) {
            const layout = fallbackLayout(width, height);
            const card = layout.cards[0];
            const board = layout.boards[0];
            expect(layout.cardCount).toBe(0); // nothing is on screen: these are the stylesheet's sums
            expect(layout.cards).toHaveLength(1);
            expect(layout.boards).toHaveLength(PLAYER_SLOTS);
            expect(layout.boards.slice(1).every((b) => b === null)).toBe(true);
            expect((card.x0 + card.x1) / 2).toBeCloseTo(0.5, 9);
            expect((board.x0 + board.x1) / 2).toBeCloseTo(0.5, 9);
            expect(board.x0).toBeGreaterThan(card.x0);
            expect(board.x1).toBeLessThan(card.x1);
            expect(board.y0).toBeGreaterThan(card.y0);
            expect(board.y1).toBeLessThan(card.y1);
            // Ten columns by twenty rows of square cells.
            const cell = ((board.x1 - board.x0) * width) / BOARD_GRID.columns;
            expect(((board.y1 - board.y0) * height) / BOARD_GRID.rows).toBeCloseTo(cell, 6);
            // The playfield sits nearer the card's foot than its head.
            expect(card.y1 - board.y1).toBeLessThan(board.y0 - card.y0);
        }
    });

    it('maps columns and rows onto a board without allocating', () => {
        const board = {
            x0: 0.25, y0: 0.1, x1: 0.75, y1: 0.9,
        };
        const out = { x: 0, y: 0 };
        expect(boardPoint(board, 0.5, 9, out)).toBe(out);
        expect(out.x).toBeCloseTo(0.5, 9);
        // Rows are measured to their centre line, one board-height / rows apart.
        const row = (board.y1 - board.y0) / BOARD_GRID.rows;
        expect(out.y).toBeCloseTo(board.y0 + row * 9.5, 9);
        const next = boardPoint(board, 0.5, 10);
        expect(next.y - out.y).toBeCloseTo(row, 9);
        // The floor row is the last one; anything past the grid is clamped onto it.
        const floor = boardPoint(board, 0.5, BOARD_GRID.rows - 1);
        expect(boardPoint(board, -3, 400)).toEqual({ x: board.x0, y: floor.y });
        expect(boardPoint(board, 0, -7).y).toBeCloseTo(board.y0 + row * 0.5, 9);
    });

    it('joins every card on screen into one rect', () => {
        const a = {
            x0: 0.05, y0: 0.2, x1: 0.3, y1: 0.8,
        };
        const b = {
            x0: 0.35, y0: 0.1, x1: 0.6, y1: 0.7,
        };
        const c = {
            x0: 0.65, y0: 0.25, x1: 0.95, y1: 0.9,
        };
        const layout = {
            cardCount: 3, cards: [a, b, c], hud: null, boards: new Array(PLAYER_SLOTS).fill(null),
        };
        const union = cardUnion(layout);
        expect(union).toEqual({
            x0: 0.05, y0: 0.1, x1: 0.95, y1: 0.9,
        });
        // A copy: the first card is not widened in place.
        expect(union).not.toBe(a);
        expect(a.x1).toBe(0.3);
        expect(cardUnion({ cards: [] })).toBeNull();
        expect(cardUnion(null)).toBeNull();
        // A board for a player who has none is the first board on screen.
        layout.boards[2] = b;
        expect(boardFor(layout, 2)).toBe(b);
        expect(boardFor(layout, 0)).toBe(b);
        layout.boards[2] = null;
        expect(boardFor(layout, 0)).toBeNull();
    });

    it('tells two layout reads apart only when a rect has really moved', () => {
        const base = fallbackLayout(1600, 900);
        const copy = () => JSON.parse(JSON.stringify(base));
        expect(layoutsDiffer(base, copy())).toBe(false);
        expect(layoutsDiffer(null, null)).toBe(false);
        expect(layoutsDiffer(base, null)).toBe(true);
        expect(layoutsDiffer(null, base)).toBe(true);

        // Sub-pixel jitter is the same layout; a real move is not.
        const jitter = copy();
        jitter.cards[0].x0 += 0.001;
        jitter.boards[0].y1 -= 0.001;
        expect(layoutsDiffer(base, jitter)).toBe(false);
        expect(layoutsDiffer(base, jitter, 0.0005)).toBe(true);
        const moved = copy();
        moved.cards[0].x0 += 0.02;
        expect(layoutsDiffer(base, moved)).toBe(true);

        const boardMoved = copy();
        boardMoved.boards[0].y0 += 0.05;
        expect(layoutsDiffer(base, boardMoved)).toBe(true);
        const secondBoard = copy();
        secondBoard.boards[3] = { ...base.boards[0] };
        expect(layoutsDiffer(base, secondBoard)).toBe(true);
        const noHud = copy();
        noHud.hud = null;
        expect(layoutsDiffer(base, noHud)).toBe(true);
        const counted = copy();
        counted.cardCount = 1;
        expect(layoutsDiffer(base, counted)).toBe(true);
        const twoCards = copy();
        twoCards.cards.push({ ...base.cards[0] });
        expect(layoutsDiffer(base, twoCards)).toBe(true);
    });
});

describe('cinder drift tiers', () => {
    it('defines every quality tier for the world and the post', () => {
        expect(QUALITY_NAMES).toEqual(['Minimal', 'Low', 'Medium', 'High', 'Ultra', 'Extreme']);
        for (const name of QUALITY_NAMES) {
            expect(QUALITY[name]).toBeTruthy();
            expect(tierFor(name)).toBe(QUALITY[name]);
            expect(POST_LOOK[name]).toBeTruthy();
        }
        expect(tierFor('nope')).toBe(QUALITY.High);
        expect(tierFor(undefined)).toBe(QUALITY.High);
    });

    it('scales every budget monotonically with the tier', () => {
        for (let i = 1; i < QUALITY_NAMES.length; i++) {
            const name = QUALITY_NAMES[i];
            const a = QUALITY[QUALITY_NAMES[i - 1]];
            const b = QUALITY[name];
            for (const key of ['embers', 'smoke', 'spatter', 'bombs', 'fountain']) {
                expect(b[key], `${name}.${key}`).toBeGreaterThanOrEqual(a[key]);
            }
            // A finer plan the higher the tier (a smaller spacing scale).
            expect(b.detail, `${name}.detail`).toBeLessThanOrEqual(a.detail);
            // What a tier draws, every tier above it draws.
            for (const key of ['lakeFine', 'lakeGlint', 'shaft']) {
                expect(Number(b[key]), `${name}.${key}`).toBeGreaterThanOrEqual(Number(a[key]));
            }
            const lookA = POST_LOOK[QUALITY_NAMES[i - 1]];
            const lookB = POST_LOOK[name];
            for (const key of ['shafts', 'msaa', 'bloomResolution', 'bloomStrength']) {
                expect(lookB[key], `${name}.${key}`).toBeGreaterThanOrEqual(lookA[key]);
            }
            for (const key of ['bloom', 'fringe', 'haze']) {
                expect(Number(lookB[key]), `${name}.${key}`).toBeGreaterThanOrEqual(Number(lookA[key]));
            }
        }
        // The top tier is strictly more than the bottom one.
        const [lowest, highest] = [QUALITY[QUALITY_NAMES[0]], QUALITY[QUALITY_NAMES[QUALITY_NAMES.length - 1]]];
        expect(highest.spatter).toBeGreaterThan(lowest.spatter);
        expect(highest.embers).toBeGreaterThan(lowest.embers);
        expect(highest.detail).toBeLessThan(lowest.detail);
    });

    it('keeps the picture and every event on every tier, inside its pools', () => {
        for (const name of QUALITY_NAMES) {
            const tier = QUALITY[name];
            expect(tier.detail, name).toBeGreaterThan(0);
            // Drops for a lock's crown, bombs for a four-line clear, a fountain to stand.
            expect(tier.spatter, name).toBeGreaterThan(0);
            expect(tier.bombs, name).toBeGreaterThan(0);
            expect(tier.bombs, name).toBeLessThanOrEqual(BOMB_SLOTS);
            expect(tier.fountain, name).toBeGreaterThan(0);
            expect(tier.fountain, name).toBeLessThanOrEqual(tier.spatter);
            for (const key of ['embers', 'smoke']) {
                expect(Number.isInteger(tier[key]) && tier[key] >= 0, `${name}.${key}`).toBe(true);
            }
            // A post look never asks for shafts without the bloom they are dragged out of.
            const look = POST_LOOK[name];
            if (look.shafts > 0) expect(look.bloom, name).toBe(true);
        }
        // Only the cheapest tier goes without its air.
        expect(QUALITY.Minimal).toMatchObject({ embers: 0, smoke: 0, shaft: false });
        for (const name of QUALITY_NAMES.slice(1)) {
            expect(QUALITY[name].embers, name).toBeGreaterThan(0);
            expect(QUALITY[name].smoke, name).toBeGreaterThan(0);
            expect(QUALITY[name].shaft, name).toBe(true);
        }
    });
});
