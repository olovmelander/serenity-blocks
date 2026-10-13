/**
 * Pyrestorm — the renderer-free core: maths, the view rig, the land's height functions (the CPU
 * twin of the baked meshes, also used to place events), the volcano, the eruption column, the
 * rivers' authored courses and the piece codes.
 *
 * The look is still being tuned, so nothing here pins a height, an angle or a colour: the tests
 * hold the properties the scene is built on (continuous, finite, ordered, upright, downwind),
 * reading every number from the module's own constants.
 */
import { describe, expect, it } from 'vitest';
import {
    ANVIL, COLUMN, CRATER, EYE, FISSURE, PIECE_CODE, PIECE_COLORS, PIECE_ORDER, RIG, RIVERS, SATELLITE, SHAPES,
    SHAPE_KEYS, TAU, TIMING, VOLCANO, approach, cellsFromMatrix, clamp, clamp01, clampInt, columnPoint, columnWidth,
    fbm, fireTint, hash2, hexToLinear, landHeight, lerp, mulberry32, pieceCode, plainHeight, ridged, rigFor,
    satelliteHeight, segmentDistance, smooth, vnoise, volcanoHeight, wrapAngle,
} from '../../src/themes/pyrestorm/pyrestorm-core.js';
import { PYRESTORM_TETROMINOS } from '../../src/themes/pyrestorm/pyrestorm-tetrominos.js';

/** The aspects a screen can have: a tall phone to an ultrawide monitor. */
const ASPECT_MIN = 0.46;
const ASPECT_MAX = 21 / 9;

/** A point at a bearing (radians, atan2(z, x)) and a distance from the volcano's axis. */
const aroundVolcano = (bearing, r) => [VOLCANO.x + Math.cos(bearing) * r, VOLCANO.z + Math.sin(bearing) * r];
const heightAround = (bearing, r) => landHeight(...aroundVolcano(bearing, r));
const median = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
};
/** The horizontal bearing the camera looks along for a rig's yaw (the world's pose: rotation.y = −yaw). */
const lookBearing = (yawDeg) => {
    const th = -yawDeg * (Math.PI / 180);
    return Math.atan2(-Math.cos(th), -Math.sin(th));
};

describe('Pyrestorm maths', () => {
    it('clamps, steps and eases as the shaders do', () => {
        expect(clamp(5, 0, 1)).toBe(1);
        expect(clamp(-5, 0, 1)).toBe(0);
        expect(clamp(Number.NaN, 2, 3)).toBe(2);
        expect(clamp01(1.5)).toBe(1);
        expect(clampInt(2.6, 0, 10)).toBe(3);
        expect(lerp(2, 4, 0.25)).toBe(2.5);
        expect(smooth(0, 1, -1)).toBe(0);
        expect(smooth(0, 1, 2)).toBe(1);
        expect(smooth(0, 1, 0.5)).toBeCloseTo(0.5, 12);
        // Reversed edges fall instead of rising.
        expect(smooth(1, 0, 0.9)).toBeLessThan(0.1);
        // Equal edges are a step, never a division by zero.
        expect(smooth(3, 3, 2.9)).toBe(0);
        expect(smooth(3, 3, 3)).toBe(1);
    });

    it('approaches a target at a rate independent of how the time is sliced', () => {
        expect(approach(2, 0)).toBe(0);
        expect(approach(2, 1e6)).toBeCloseTo(1, 12);
        const once = approach(1.5, 0.2);
        const twice = 1 - (1 - approach(1.5, 0.1)) ** 2;
        expect(twice).toBeCloseTo(once, 12);
    });

    it('draws the same deterministic sequence for a seed, in [0, 1)', () => {
        const seqA = Array.from({ length: 200 }, mulberry32(42));
        expect(Array.from({ length: 200 }, mulberry32(42))).toEqual(seqA);
        expect(Array.from({ length: 200 }, mulberry32(43))).not.toEqual(seqA);
        seqA.forEach((v) => {
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThan(1);
        });
    });

    it('wraps an angle into (−π, π] without changing where it points', () => {
        for (let a = -40; a <= 40; a += 0.37) {
            const w = wrapAngle(a);
            expect(w).toBeGreaterThan(-Math.PI);
            expect(w).toBeLessThanOrEqual(Math.PI);
            expect(Math.cos(w)).toBeCloseTo(Math.cos(a), 9);
            expect(Math.sin(w)).toBeCloseTo(Math.sin(a), 9);
        }
        expect(wrapAngle(Math.PI)).toBeCloseTo(Math.PI, 12);
        expect(wrapAngle(-Math.PI)).toBeCloseTo(Math.PI, 12);
        expect(wrapAngle(TAU)).toBeCloseTo(0, 12);
    });

    it('reads sRGB hex as linear light and anything else as the fire\'s own colour', () => {
        expect(hexToLinear('#FFFFFF')).toEqual([1, 1, 1]);
        expect(hexToLinear('#000000')).toEqual([0, 0, 0]);
        expect(hexToLinear('808080')[0]).toBeCloseTo(0.2158605, 6);
        const out = [9, 9, 9];
        expect(hexToLinear('#ff0000', out)).toBe(out);
        expect(out).toEqual([1, 0, 0]);
        // Whatever is not a hex colour falls back to one warm colour, never to NaN or black.
        const fallback = hexToLinear('nonsense');
        for (const bad of [null, undefined, '#12345', '#GGGGGG', 42, '']) {
            expect(hexToLinear(bad), String(bad)).toEqual(fallback);
        }
        fallback.forEach((v) => expect(Number.isFinite(v)).toBe(true));
        expect(fallback[0]).toBeGreaterThan(fallback[1]);
        expect(fallback[1]).toBeGreaterThan(fallback[2]);
    });

    it('keeps its noise in range and deterministic', () => {
        for (let i = 0; i < 4000; i++) {
            const x = ((i * 0.731) % 97) - 40;
            const z = ((i * 1.37) % 113) - 50;
            const h = hash2(i, i * 7, 3);
            expect(h >= 0 && h < 1, `hash2 ${i}`).toBe(true);
            const v = vnoise(x, z, 3);
            expect(v >= -1 && v <= 1, `vnoise ${x}, ${z}`).toBe(true);
            const f = fbm(x, z, 4, 3);
            expect(f >= -1 && f <= 1, `fbm ${x}, ${z}`).toBe(true);
            const r = ridged(x, z, 4, 3);
            expect(r >= 0 && r <= 1, `ridged ${x}, ${z}`).toBe(true);
        }
        expect(fbm(1.3, -7.1, 4, 9)).toBe(fbm(1.3, -7.1, 4, 9));
        expect(vnoise(1.3, -7.1, 9)).not.toBe(vnoise(1.3, -7.1, 10));
        // Value noise is continuous: a millimetre apart, nearly the same.
        expect(Math.abs(vnoise(3.2, 4.7) - vnoise(3.2001, 4.7))).toBeLessThan(1e-3);
    });

    it('measures the distance to a segment, and where along it the nearest point lies', () => {
        const out = { d: 0, t: 0 };
        expect(segmentDistance(5, 3, 0, 0, 10, 0, out)).toBe(out);
        expect(out.d).toBeCloseTo(3, 12);
        expect(out.t).toBeCloseTo(0.5, 12);
        segmentDistance(-4, 3, 0, 0, 10, 0, out);
        expect(out).toMatchObject({ t: 0 });
        expect(out.d).toBeCloseTo(5, 12);
        // A segment of no length is a point.
        segmentDistance(3, 4, 0, 0, 0, 0, out);
        expect(out.d).toBeCloseTo(5, 12);
    });
});

describe('Pyrestorm view', () => {
    it('chooses the lens continuously across every aspect: no width snaps the camera', () => {
        const step = 0.002;
        let previous = { ...rigFor(ASPECT_MIN) };
        const jumps = { fov: 0, yaw: 0, pitch: 0 };
        for (let a = ASPECT_MIN + step; a <= ASPECT_MAX + 1e-9; a += step) {
            const rig = { ...rigFor(a) };
            for (const key of ['fov', 'yaw', 'pitch']) {
                expect(Number.isFinite(rig[key]), `${key} at ${a.toFixed(3)}`).toBe(true);
                jumps[key] = Math.max(jumps[key], Math.abs(rig[key] - previous[key]));
            }
            expect(rig.fov, `fov at ${a.toFixed(3)}`).toBeGreaterThan(1);
            expect(rig.fov, `fov at ${a.toFixed(3)}`).toBeLessThan(179);
            previous = rig;
        }
        // Neighbouring aspects (a fifth of a percent apart) are a fraction of a degree apart (the
        // portrait-to-square turn round the card's corner is the quickest stretch, still no snap).
        expect(jumps.fov).toBeLessThan(0.25);
        expect(jumps.yaw).toBeLessThan(0.5);
        expect(jumps.pitch).toBeLessThan(0.5);
    });

    it('ends on its three poses: portrait at a tall phone, landscape at 16:9, the wide pose at ultrawide', () => {
        expect(rigFor(ASPECT_MIN)).toMatchObject(RIG.portrait);
        for (const key of ['fov', 'yaw', 'pitch']) {
            expect(rigFor(16 / 9)[key], key).toBeCloseTo(RIG.landscape[key], 2);
            expect(rigFor(3)[key], key).toBeCloseTo(RIG.wide[key], 9);
        }
        // Nonsense is read as the landscape a desktop has.
        for (const nonsense of [Number.NaN, 0, -1, undefined, Infinity]) {
            expect(rigFor(nonsense), String(nonsense)).toEqual(rigFor(16 / 9));
        }
        const out = { fov: 0, yaw: 0, pitch: 0 };
        expect(rigFor(1.5, out)).toBe(out);
    });

    it('narrows the lens as the screen widens, and turns a portrait screen down toward the volcano', () => {
        let previous = rigFor(ASPECT_MIN).fov;
        for (let a = ASPECT_MIN; a <= 3; a += 0.01) {
            const { fov } = rigFor(a);
            expect(fov, `fov at ${a.toFixed(2)}`).toBeLessThanOrEqual(previous + 1e-12);
            previous = fov;
        }
        expect(RIG.wide.fov).toBeLessThan(RIG.landscape.fov);
        expect(RIG.portrait.fov).toBeGreaterThan(RIG.landscape.fov);
        // Portrait looks DOWN (so the summit and its fountain stand in the strip above the card)...
        expect(RIG.portrait.pitch).toBeLessThan(RIG.landscape.pitch);
        // ...and turns toward the volcano.
        const toVolcano = Math.atan2(VOLCANO.z - EYE.z, VOLCANO.x - EYE.x);
        const off = (yaw) => Math.abs(wrapAngle(lookBearing(yaw) - toVolcano));
        expect(off(RIG.portrait.yaw)).toBeLessThan(off(RIG.landscape.yaw));
    });

    it('draws from a near plane in front of the eye to past the anvil\'s far edge', () => {
        expect(RIG.near).toBeGreaterThan(0);
        expect(RIG.far).toBeGreaterThan(RIG.near);
        const farthest = Math.hypot(ANVIL.x - EYE.x, ANVIL.z - EYE.z) + Math.hypot(ANVIL.along, ANVIL.across);
        expect(RIG.far).toBeGreaterThan(farthest);
    });
});

describe('Pyrestorm land', () => {
    it('is finite everywhere over the country, out to the ranges on the horizon', () => {
        const bad = [];
        for (let x = -40000; x <= 40000; x += 500) {
            for (let z = -60000; z <= 8000; z += 500) {
                const h = landHeight(x, z);
                if (!Number.isFinite(h)) bad.push(`${x}, ${z}: ${h}`);
            }
        }
        expect(bad.slice(0, 5)).toEqual([]);
    });

    it('raises the volcano and its satellite only inside their own footprints', () => {
        for (let a = 0; a < TAU; a += 0.3) {
            expect(volcanoHeight(...aroundVolcano(a, VOLCANO.radius * 1.01))).toBe(0);
            const r = SATELLITE.radius * 1.01;
            expect(satelliteHeight(SATELLITE.x + Math.cos(a) * r, SATELLITE.z + Math.sin(a) * r)).toBe(0);
        }
        expect(satelliteHeight(SATELLITE.x + SATELLITE.radius * 0.5, SATELLITE.z)).toBeGreaterThan(0);
        // The land is the plain plus both cones.
        for (const [x, z] of [[0, 0], [VOLCANO.x, VOLCANO.z], [SATELLITE.x, SATELLITE.z], [3000, -5000]]) {
            expect(landHeight(x, z)).toBeCloseTo(plainHeight(x, z) + volcanoHeight(x, z) + satelliteHeight(x, z), 9);
        }
    });

    it('stands the eye a little above the ridge under it, the land falling away toward the volcano', () => {
        const ground = landHeight(EYE.x, EYE.z);
        expect(EYE.y).toBeGreaterThan(ground + 1);
        expect(EYE.y - ground).toBeLessThan(30);
        // The ridge's brow: the slope in front of the eye falls to the valley the river follows.
        let previous = ground;
        for (const z of [-300, -600, -1000]) {
            const h = landHeight(EYE.x, EYE.z + z);
            expect(h, `${z} m ahead`).toBeLessThan(previous);
            previous = h;
        }
        expect(EYE.y - landHeight(EYE.x, -2650)).toBeGreaterThan(200);
    });

    it('makes the summit the highest land within the volcano\'s radius, on its crater', () => {
        let best = { h: -Infinity, r: 0 };
        for (let r = 0; r < VOLCANO.radius; r += 60) {
            for (let a = 0; a < TAU; a += 0.04) {
                const h = heightAround(a, r);
                if (h > best.h) best = { h, r };
            }
        }
        // The top of the mountain is at its crater, not out on a flank.
        expect(best.r).toBeLessThanOrEqual(VOLCANO.crater * 1.25);
        // Nothing else within the theme's middle distance stands as high (the horizon's ranges are
        // further out).
        for (let x = -16000; x <= 16000; x += 500) {
            for (let z = -17000; z <= 2000; z += 500) {
                if (Math.hypot(x, z) > 17000 || Math.hypot(x - VOLCANO.x, z - VOLCANO.z) < VOLCANO.radius) continue;
                expect(landHeight(x, z), `${x}, ${z}`).toBeLessThan(best.h);
            }
        }
    });

    it('hollows a crater at the summit: its floor lies below its rim', () => {
        const rim = [];
        for (let a = 0; a < TAU; a += 0.02) rim.push(heightAround(a, VOLCANO.crater));
        const rimCrest = median(rim);
        const floor = [];
        for (let r = 0; r <= VOLCANO.crater * 0.3; r += VOLCANO.crater * 0.1) {
            for (let a = 0; a < TAU; a += 0.1) floor.push(heightAround(a, r));
        }
        // Every point of the crater's floor is below the rim's typical crest.
        expect(Math.max(...floor)).toBeLessThan(rimCrest);
    });

    it('breaches the crater on the eye\'s side: the breach runs lower than the rim on its bearing', () => {
        // The breach faces the eye, so the lava that leaves it is seen.
        const toEye = [EYE.x - VOLCANO.x, EYE.z - VOLCANO.z];
        expect(Math.cos(VOLCANO.breach) * toEye[0] + Math.sin(VOLCANO.breach) * toEye[1]).toBeGreaterThan(0);
        for (const r of [VOLCANO.crater, VOLCANO.crater * 1.5, VOLCANO.crater * 2.5, VOLCANO.breachReach * 0.6]) {
            const breach = heightAround(VOLCANO.breach, r);
            const ring = [];
            for (let a = 0; a < TAU; a += 0.05) {
                if (Math.abs(wrapAngle(a - VOLCANO.breach)) > 0.8) ring.push(heightAround(a, r));
            }
            expect(breach, `at ${r.toFixed(0)} m`).toBeLessThan(median(ring));
            expect(breach, `at ${r.toFixed(0)} m`).toBeLessThan(Math.min(...ring));
        }
        // At the rim the notch is deep: well over half its authored depth below the rim's crest.
        const rim = [];
        for (let a = 0; a < TAU; a += 0.02) rim.push(heightAround(a, VOLCANO.crater));
        expect(median(rim) - heightAround(VOLCANO.breach, VOLCANO.crater)).toBeGreaterThan(VOLCANO.breachDepth * 0.5);
    });

    it('runs every authored river downhill from its source to its mouth', () => {
        for (const river of RIVERS) {
            const source = landHeight(...river.points[0]);
            const mouth = landHeight(...river.points[river.points.length - 1]);
            expect(source, river.id).toBeGreaterThan(mouth);
            expect(river.width[1], `${river.id} widens`).toBeGreaterThanOrEqual(river.width[0]);
            expect(river.heat).toBeGreaterThan(0);
            expect(river.heat).toBeLessThanOrEqual(1);
        }
        expect(RIVERS.map((river) => river.id)).toContain('main');
        // The fissure lies out on the plain, beyond the volcano's foot.
        for (const end of [FISSURE.a, FISSURE.b]) {
            expect(Math.hypot(end[0] - VOLCANO.x, end[1] - VOLCANO.z)).toBeGreaterThan(VOLCANO.radius * 0.8);
        }
    });
});

describe('Pyrestorm eruption column', () => {
    const drift2 = COLUMN.drift[0] ** 2 + COLUMN.drift[1] ** 2;
    /** How far the column has leaned downwind at s, as a share of the drift at its top. */
    const leanAt = (s) => {
        const p = columnPoint(s, [0, 0, 0]);
        const base = columnPoint(0, [0, 0, 0]);
        return ((p[0] - base[0]) * COLUMN.drift[0] + (p[2] - base[2]) * COLUMN.drift[1]) / drift2;
    };

    it('rises from the crater\'s mouth, climbing at every step', () => {
        const base = columnPoint(0);
        expect(base[0]).toBeCloseTo(CRATER.x, 6);
        expect(base[2]).toBeCloseTo(CRATER.z, 6);
        expect(base[1]).toBeGreaterThan(CRATER.y);
        let previous = base[1];
        for (let s = 0.01; s <= 1.0001; s += 0.01) {
            const y = columnPoint(s)[1];
            expect(y, `s = ${s.toFixed(2)}`).toBeGreaterThan(previous);
            previous = y;
        }
        // Clamped at both ends.
        expect(columnPoint(-1)).toEqual(columnPoint(0));
        expect(columnPoint(2)).toEqual(columnPoint(1));
        const out = [0, 0, 0];
        expect(columnPoint(0.5, out)).toBe(out);
    });

    it('leans downwind, upright low down and bent high up', () => {
        let previous = leanAt(0);
        for (let s = 0.02; s <= 1.0001; s += 0.02) {
            const lean = leanAt(s);
            expect(lean, `s = ${s.toFixed(2)}`).toBeGreaterThanOrEqual(previous - 1e-9);
            // Bent, not straight: the lean lags the height.
            if (s < 0.999) expect(lean, `s = ${s.toFixed(2)}`).toBeLessThan(s);
            previous = lean;
        }
        expect(leanAt(0.25)).toBeLessThan(0.15);
        expect(leanAt(1)).toBeGreaterThan(0.9);
    });

    it('widens as it climbs, and flattens into the anvil at its upwind end', () => {
        let previous = columnWidth(0);
        expect(previous).toBeCloseTo(COLUMN.baseWidth, 9);
        for (let s = 0.05; s <= 1.0001; s += 0.05) {
            expect(columnWidth(s)).toBeGreaterThan(previous);
            previous = columnWidth(s);
        }
        expect(columnWidth(1)).toBeCloseTo(COLUMN.topWidth, 9);
        // The top lies in the anvil's layer...
        const top = columnPoint(1);
        expect(top[1]).toBeGreaterThan(ANVIL.base);
        expect(top[1]).toBeLessThan(ANVIL.base + ANVIL.thick);
        // ...inside its footprint, upwind of its centre (the anvil spreads downwind from the head).
        const along = (top[0] - ANVIL.x) * Math.cos(ANVIL.heading) + (top[2] - ANVIL.z) * Math.sin(ANVIL.heading);
        const across = -(top[0] - ANVIL.x) * Math.sin(ANVIL.heading) + (top[2] - ANVIL.z) * Math.cos(ANVIL.heading);
        expect(along).toBeLessThan(0);
        expect(Math.abs(along)).toBeLessThan(ANVIL.along);
        expect(Math.abs(across)).toBeLessThan(ANVIL.across);
        // The anvil streams the way the wind blows the column.
        const downwind = Math.cos(ANVIL.heading) * COLUMN.drift[0] + Math.sin(ANVIL.heading) * COLUMN.drift[1];
        expect(downwind).toBeGreaterThan(0);
    });
});

describe('Pyrestorm pieces', () => {
    it('codes the seven pieces and the garbage in one order, with the board\'s own colours', () => {
        expect(PIECE_ORDER).toHaveLength(8);
        PIECE_ORDER.forEach((key, code) => expect(PIECE_CODE[key], key).toBe(code));
        // PIECE_COLORS is the tetrominos table, in code order.
        expect(PIECE_COLORS.map((c) => c.toUpperCase()))
            .toEqual(PIECE_ORDER.map((key) => PYRESTORM_TETROMINOS.colors[key].toUpperCase()));
        expect(new Set(PIECE_COLORS.map((c) => c.toUpperCase())).size).toBe(PIECE_COLORS.length);
        PIECE_COLORS.forEach((c) => expect(c).toMatch(/^#[0-9a-f]{6}$/i));
    });

    it('reads a piece key however it is spelt, and anything else as garbage', () => {
        for (const key of SHAPE_KEYS) {
            expect(pieceCode(key)).toBe(PIECE_CODE[key]);
            expect(pieceCode(` ${key.toLowerCase()} `)).toBe(PIECE_CODE[key]);
        }
        expect(pieceCode('garbage')).toBe(PIECE_CODE.GARBAGE);
        for (const bad of ['X', '', null, undefined, 3, 'toString', '__proto__']) {
            expect(pieceCode(bad), String(bad)).toBe(PIECE_CODE.GARBAGE);
        }
    });

    it('turns every piece matrix into four cells centred on its box, y up', () => {
        expect([...SHAPE_KEYS].sort()).toEqual(['I', 'J', 'L', 'O', 'S', 'T', 'Z']);
        for (const key of SHAPE_KEYS) {
            const cells = cellsFromMatrix(SHAPES[key]);
            expect(cells, key).toHaveLength(8);
            const xs = [cells[0], cells[2], cells[4], cells[6]];
            const ys = [cells[1], cells[3], cells[5], cells[7]];
            expect(Math.min(...xs) + Math.max(...xs), key).toBeCloseTo(0, 12);
            expect(Math.min(...ys) + Math.max(...ys), key).toBeCloseTo(0, 12);
            // Four different cells, a unit apart on the grid.
            expect(new Set(xs.map((x, i) => `${x},${ys[i]}`)).size, key).toBe(4);
        }
        // y is up: the T's three-wide row is its lower row in the matrix.
        const t = cellsFromMatrix(SHAPES.T);
        const lowY = Math.min(t[1], t[3], t[5], t[7]);
        expect([t[1], t[3], t[5], t[7]].filter((y) => y === lowY)).toHaveLength(3);
        // Padding rows and columns do not move the centre.
        const padded = [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]];
        expect(cellsFromMatrix(padded)).toEqual(cellsFromMatrix(SHAPES.I));
        for (const bad of [null, 'T', [], [[0, 0], [0, 0]], [null, 'x']]) {
            expect(cellsFromMatrix(bad), JSON.stringify(bad)).toBeNull();
        }
    });

    it('tints the fire by a piece\'s colour without letting it stop being fire', () => {
        const plain = fireTint([1, 1, 1], [0, 0, 0], 0);
        for (const hex of PIECE_COLORS) {
            const tint = fireTint(hexToLinear(hex));
            tint.forEach((v) => expect(Number.isFinite(v) && v >= 0, hex).toBe(true));
            // Incandescence keeps its temperature: red stays the strongest channel.
            expect(tint[0], hex).toBeGreaterThanOrEqual(Math.max(tint[1], tint[2]));
        }
        // ...but takes some of the piece's hue: a blue piece throws bluer fire than a red one.
        const blue = fireTint([0, 0, 1]);
        const red = fireTint([1, 0, 0]);
        expect(blue[2]).toBeGreaterThan(red[2]);
        expect(blue[2]).toBeGreaterThan(plain[2]);
        // The share is a straight mix: none is the plain fire, all of it the piece's normalised hue.
        expect(fireTint([0.2, 0.1, 0.05], [0, 0, 0], 0)).toEqual(plain);
        const full = fireTint([0.2, 0.1, 0.05], [0, 0, 0], 1);
        expect(full[0]).toBeCloseTo(1, 12);
        expect(full[1]).toBeCloseTo(0.5, 12);
        expect(full[2]).toBeCloseTo(0.25, 12);
        // Black does not divide by zero.
        fireTint([0, 0, 0]).forEach((v) => expect(Number.isFinite(v)).toBe(true));
        const out = [0, 0, 0];
        expect(fireTint([1, 0.5, 0], out)).toBe(out);
    });
});

describe('Pyrestorm timings', () => {
    it('are finite, positive and ordered as the beats they time', () => {
        for (const [key, value] of Object.entries(TIMING)) {
            expect(Number.isFinite(value) && value > 0, key).toBe(true);
        }
        // Each watch rests a share at both ends and is on its way between.
        expect(TIMING.watchRest).toBeLessThan(0.5);
        // A level's turn of the wheel lands well inside one watch of the clock.
        expect(TIMING.levelTurn).toBeLessThan(TIMING.watch);
        // A stroke's leader is a flicker; its channel outlasts it.
        expect(TIMING.leader).toBeLessThan(TIMING.stroke);
        // A chain charges the storm faster than the storm drains.
        expect(TIMING.chargeRise).toBeGreaterThan(TIMING.chargeFall);
        // The four bolts of four lines all strike while the blast's shock front is still crossing
        // the sky.
        expect(TIMING.boltStagger * 3).toBeLessThan(TIMING.shock);
    });
});
