/**
 * Grainfields: the knoll the ruin stands on.
 *
 * The land's fan lays its rows ~60 m apart a kilometre and a half out, which cut the knoll's crown
 * down by metres (2 m at High, 12 m at Ultra, 20 m at Low) and left the ruin standing in the air.
 * The knoll is drawn by its own fine mesh in the land's material; under it the fan draws only the
 * vale's floor, a little sunk.
 */
import { describe, expect, it } from 'vitest';
import { PLACES } from '../../src/themes/grainfields/grainfields-core.js';
import {
    RUIN_TREES, groundHeight, knollHeight, ruinToWorld,
} from '../../src/themes/grainfields/grainfields-plan.js';
import {
    FAN, KNOLL, createKnollGeometry, fanSteps, knollSink,
} from '../../src/themes/grainfields/grainfields-land.js';
import { QUALITY } from '../../src/themes/grainfields/grainfields-quality.js';

const F = PLACES.fort;
/** The ruin stands inside this reach of the knoll's centre (its asset test holds it there). */
const CROWN_REACH = 46;
/** Its walls run this far under the crown. */
const FOUNDATIONS = 4;
const BASE = groundHeight(F.x, F.z);

function drain(steps) {
    for (;;) {
        const next = steps.next();
        if (next.done) return next.value;
    }
}

/** Barycentric weights of (x, z) in the xz triangle a, b, c (arrays of [x, y, z]), or null outside. */
function weights(a, b, c, x, z) {
    const v0x = b[0] - a[0];
    const v0z = b[2] - a[2];
    const v1x = c[0] - a[0];
    const v1z = c[2] - a[2];
    const v2x = x - a[0];
    const v2z = z - a[2];
    const den = v0x * v1z - v1x * v0z;
    if (Math.abs(den) < 1e-12) return null;
    const u = (v2x * v1z - v1x * v2z) / den;
    const w = (v0x * v2z - v2x * v0z) / den;
    const tol = 1e-7;
    return u >= -tol && w >= -tol && u + w <= 1 + tol ? [1 - u - w, u, w] : null;
}

const corner = (positions, i) => [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];

/** The height of an indexed triangle mesh over (x, z) (the first triangle that covers it). */
function meshHeight(positions, index, x, z) {
    for (let t = 0; t < index.length; t += 3) {
        const a = corner(positions, index[t]);
        const b = corner(positions, index[t + 1]);
        const c = corner(positions, index[t + 2]);
        const k = weights(a, b, c, x, z);
        if (k) return k[0] * a[1] + k[1] * b[1] + k[2] * c[1];
    }
    return null;
}

/** The fan's drawn height over (x, z): the cell it falls in (or a neighbour), split as createFanGeometry splits it. */
function fanHeight(positions, cols, rows, x, z) {
    const half = FAN.halfAngle * (Math.PI / 180);
    const angle = Math.atan2(x, -z);
    const col = Math.floor(((angle + half) / (2 * half)) * (cols - 1));
    const lnNear = Math.log(FAN.near);
    const row = Math.floor(((Math.log(Math.hypot(x, z)) - lnNear) / (Math.log(FAN.far) - lnNear)) * (rows - 1));
    for (let r = row - 1; r <= row + 1; r++) {
        for (let c = col - 1; c <= col + 1; c++) {
            if (r < 0 || c < 0 || r >= rows - 1 || c >= cols - 1) continue;
            const a = r * cols + c;
            for (const [i, j, k] of [[a, a + 1, a + cols], [a + 1, a + cols + 1, a + cols]]) {
                const p = corner(positions, i);
                const q = corner(positions, j);
                const s = corner(positions, k);
                const w = weights(p, q, s, x, z);
                if (w) return w[0] * p[1] + w[1] * q[1] + w[2] * s[1];
            }
        }
    }
    return null;
}

/** Points round the knoll's centre: rings every `step` metres out to `reach`, 36 bearings each. */
function ring(reach, step = 4) {
    const out = [];
    for (let r = 0; r <= reach; r += step) {
        for (let a = 0; a < 36; a++) {
            const t = (a / 36) * Math.PI * 2;
            out.push([F.x + Math.cos(t) * r, F.z + Math.sin(t) * r, r]);
        }
    }
    return out;
}

const knoll = createKnollGeometry();
const knollPositions = knoll.attributes.position.array;
const knollIndex = knoll.index.array;

describe('Grainfields knoll', () => {
    it('lays its own mesh on the land\'s true height, facing up, out past where the fan sinks', () => {
        const cover = knoll.attributes.aCover.array;
        let reach = 0;
        for (let i = 0; i < knoll.attributes.position.count; i++) {
            const [x, y, z] = corner(knollPositions, i);
            reach = Math.max(reach, Math.hypot(x - F.x, z - F.z));
            // No forest stands on the knoll: its posts are the ground itself.
            expect(cover[i * 4]).toBe(0);
            expect(y).toBeCloseTo(groundHeight(x, z), 3);
        }
        expect(reach).toBeGreaterThanOrEqual(KNOLL.fade[1]);
        for (let t = 0; t < knollIndex.length; t += 3) {
            const a = corner(knollPositions, knollIndex[t]);
            const b = corner(knollPositions, knollIndex[t + 1]);
            const c = corner(knollPositions, knollIndex[t + 2]);
            // Counter-clockwise seen from above: the cross product of two edges points up.
            const up = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
            expect(up).toBeGreaterThan(0);
        }
    });

    it('draws the crown true where the ruin stands, and the ruin\'s foundations reach under it everywhere', () => {
        let worst = 0;
        for (const [x, z] of ring(CROWN_REACH, 2)) {
            const drawn = meshHeight(knollPositions, knollIndex, x, z);
            expect(drawn).not.toBeNull();
            worst = Math.max(worst, Math.abs(drawn - groundHeight(x, z)));
            // Never so low that a wall's foot shows, never burying a wall's face by more than a course.
            expect(drawn - BASE).toBeGreaterThan(-FOUNDATIONS + 0.5);
            expect(drawn - BASE).toBeLessThan(0.5);
        }
        expect(worst).toBeLessThan(0.2);
    });

    it('sinks the fan under it at every tier, so its own fine mesh is the one drawn over the crown and shoulders', () => {
        // Under the knoll the fan draws the vale's floor, a little under it.
        expect(knollSink(F.x, F.z)).toBeCloseTo(knollHeight(F.x, F.z) + KNOLL.sink, 9);
        expect(knollSink(F.x + KNOLL.fade[1] + 1, F.z)).toBe(0);
        expect(knollSink(0, 0)).toBe(0);
        for (const [name, tier] of Object.entries(QUALITY)) {
            const { cols, rows } = tier.fan;
            const { positions } = drain(fanSteps(cols, rows));
            for (const [x, z, r] of ring(110, 5)) {
                const fan = fanHeight(positions, cols, rows, x, z);
                const own = meshHeight(knollPositions, knollIndex, x, z);
                expect(fan, `${name} at ${r} m`).not.toBeNull();
                expect(own - fan, `${name} at ${r} m`).toBeGreaterThan(0.05);
            }
        }
    });

    it('stands the trees by the ruin on its crown and shoulders', () => {
        expect(RUIN_TREES.length).toBe(3);
        for (const [lx, lz] of RUIN_TREES) {
            const [x, z] = ruinToWorld(lx, lz);
            const r = Math.hypot(x - F.x, z - F.z);
            // The same distance from the centre as in the ruin's own frame.
            expect(r).toBeCloseTo(Math.hypot(lx, lz), 6);
            expect(r).toBeLessThan(55);
            expect(groundHeight(x, z)).toBeGreaterThan(BASE - 3);
        }
    });
});
