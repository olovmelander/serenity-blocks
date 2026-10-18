/**
 * Grainfields — Lapporten, the Lapland gate on the horizon: its silhouette (the cross-section at the
 * gate), the fells' height field in the gate's own frame, what the eye sees of them, and the mesh.
 *
 * The silhouette is authored at Lapporten's own size and drawn larger than life (SIZE), so the
 * tests hold its shape as relations (a U far below both lips, the left fell's lip over the right
 * shoulder, the right ridge's saddle and summit) and what the frame needs of it from the eye (the
 * U left of the card, the fells topping out a little over ten degrees up).
 */
import { describe, expect, it } from 'vitest';
import {
    DECK, DEG, EYE, PLACES, bearingOf, pointAt,
} from '../../src/themes/grainfields/grainfields-core.js';
import {
    GATE, GATE_SUMMITS, SIZE, createGateGeometry, gateCentre, gateFrame, gateHeight, gatePoint, gateProfile, gateSample,
} from '../../src/themes/grainfields/grainfields-lapporten.js';
import { tierFor } from '../../src/themes/grainfields/grainfields-quality.js';

/** The highest value of f on [a, b] (step metres), and where. */
function peak(f, a, b, step = 5) {
    let best = { h: -Infinity, at: a };
    for (let c = a; c <= b; c += step) {
        const h = f(c);
        if (h > best.h) best = { h, at: c };
    }
    return best;
}

/** The lowest value of f on [a, b], and where. */
function trough(f, a, b, step = 5) {
    let best = { h: Infinity, at: a };
    for (let c = a; c <= b; c += step) {
        const h = f(c);
        if (h < best.h) best = { h, at: c };
    }
    return best;
}

/** The fells' skyline from the eye: per bearing (degrees), the highest elevation (degrees) of the fells. */
function skyline(from = -60, to = 40, step = 0.5) {
    const out = [];
    const point = [0, 0];
    for (let bearing = from; bearing <= to + 1e-9; bearing += step) {
        let el = -Infinity;
        for (let d = 3000; d <= 40000; d += 100) {
            pointAt(bearing, d, point);
            el = Math.max(el, Math.atan2(gateHeight(point[0], point[1]) - EYE.y, d) / DEG);
        }
        out.push({ bearing, el });
    }
    return out;
}

describe('Grainfields Lapporten: the silhouette', () => {
    const leftLip = peak(gateProfile, -GATE.left.wall - 300, -GATE.left.wall + 1);
    const shoulder = gateProfile(GATE_SUMMITS.shoulder);

    it('cuts a U between the fells: a flat floor far below both lips, and walls that rise steeply', () => {
        expect(gateProfile(0)).toBe(GATE.floor);
        // The floor is the lowest ground between the lips, and nearly level across its half-width.
        const between = trough(gateProfile, -GATE.left.wall, GATE.right.wall, 1);
        expect(between.at).toBe(0);
        for (let c = -GATE.floorHalf; c < GATE.floorHalf; c += 5) {
            expect(Math.abs(gateProfile(c + 5) - gateProfile(c)) / 5, `floor at ${c}`).toBeLessThan(0.2);
        }
        expect(gateProfile(GATE.floorHalf) - GATE.floor).toBeLessThan(60);
        expect(gateProfile(-GATE.floorHalf) - GATE.floor).toBeLessThan(60);
        // Both lips stand far over it.
        expect(leftLip.h - GATE.floor).toBeGreaterThan(800);
        expect(shoulder - GATE.floor).toBeGreaterThan(800);
        // Both walls climb steeply out of the floor: on average steeper than 40°, under the lip steeper than 55°.
        const walls = [
            ['left', (s) => gateProfile(-s), GATE.left.wall],
            ['right', (s) => gateProfile(s), GATE.right.wall],
        ];
        for (const [side, f, top] of walls) {
            expect((f(top) - f(GATE.floorHalf)) / (top - GATE.floorHalf), `${side} wall's mean slope`).toBeGreaterThan(0.84);
            let steepest = 0;
            for (let s = GATE.floorHalf; s < top; s += 5) steepest = Math.max(steepest, (f(s + 5) - f(s)) / 5);
            expect(steepest, `${side} wall's steepest`).toBeGreaterThan(1.43);
            // It only ever climbs.
            for (let s = GATE.floorHalf; s < top; s += 5) expect(f(s + 5), `${side} wall at ${s}`).toBeGreaterThan(f(s));
        }
    });

    it('stands the left fell\'s lip over the right shoulder; the right ridge falls to a saddle and rises again to a summit beyond it', () => {
        expect(leftLip.h).toBeGreaterThan(shoulder + 50);
        // The shoulder is a point over its wall.
        expect(shoulder).toBeGreaterThan(gateProfile(GATE.right.wall));
        expect(shoulder).toBeGreaterThan(gateProfile(GATE_SUMMITS.shoulder + 400));
        const saddle = trough(gateProfile, GATE_SUMMITS.shoulder, GATE_SUMMITS.right);
        expect(saddle.h).toBeLessThan(shoulder - 50);
        const summit = gateProfile(GATE_SUMMITS.right);
        expect(summit).toBeGreaterThan(shoulder);
        expect(summit).toBeGreaterThan(saddle.h + 200);
        // The left plateau is nearly level behind its lip; the long back and the far fall reach the plain.
        expect(Math.abs(gateProfile(GATE_SUMMITS.left) - leftLip.h)).toBeLessThan(100);
        expect(gateProfile(-GATE.left.back)).toBe(0);
        expect(gateProfile(GATE.right.fall)).toBe(0);
        expect(gateProfile(GATE.span[0])).toBe(0);
        expect(gateProfile(GATE.span[1])).toBe(0);
        for (let c = GATE.span[0]; c <= GATE.span[1]; c += 50) {
            const h = gateProfile(c);
            expect(Number.isFinite(h) && h >= 0, `c ${c}`).toBe(true);
        }
    });

    it('stands the same profile on the gate\'s line in the world, drawn larger than life by SIZE', () => {
        expect(SIZE.across).toBeGreaterThan(1);
        expect(SIZE.up).toBeGreaterThan(1);
        expect(gateFrame(PLACES.gate.x, PLACES.gate.z)).toEqual({ c: 0, a: 0 });
        // The trough runs toward the eye: the eye stands on its axis, the gate's distance away.
        const eye = gateFrame(EYE.x, EYE.z);
        expect(Math.abs(eye.c)).toBeLessThan(1e-6);
        expect(eye.a).toBeCloseTo(bearingOf(PLACES.gate.x, PLACES.gate.z).distance, 6);
        for (let c = -6000; c <= 12000; c += 250) {
            const [x, z] = gatePoint(c * SIZE.across, 0);
            const frame = gateFrame(x, z);
            expect(frame.c).toBeCloseTo(c * SIZE.across, 6);
            expect(frame.a).toBeCloseTo(0, 6);
            // Within the skin's roughness and the cirques' edges.
            expect(Math.abs(gateHeight(x, z) - gateProfile(c) * SIZE.up), `c ${c}`).toBeLessThan(60);
        }
        // In front of the gate the faces fall away toward the plain; behind it they settle.
        const [fx, fz] = gatePoint(GATE_SUMMITS.left * SIZE.across, GATE.front * SIZE.across);
        expect(gateHeight(fx, fz)).toBeLessThan(gateProfile(GATE_SUMMITS.left) * SIZE.up * 0.1);
        const sample = gateSample(PLACES.gate.x, PLACES.gate.z);
        for (const key of ['h', 'relief', 'face', 'cirque']) expect(Number.isFinite(sample[key]), key).toBe(true);
        expect(gateHeight(PLACES.gate.x, PLACES.gate.z)).toBe(sample.h);
    });

    // BUG (grainfields-lapporten.js, gateCentre): it is documented as "the gate's U ... as a world
    // point (the middle of the floor)" but returns y = GATE.floor (640 m, the silhouette's own,
    // unscaled metres): the world's floor stands at GATE.floor × SIZE.up ≈ 960 m (gateHeight at the
    // gate: 970 m), so the point lies 330 m inside the rock. Unused today; fix:
    // `out[1] = GATE.floor * SIZE.up;` (or gateHeight(G.x, G.z)).
    it('names the middle of the U\'s floor as a world point', () => {
        const [x, y, z] = gateCentre();
        expect(x).toBe(PLACES.gate.x);
        expect(z).toBe(PLACES.gate.z);
        expect(Math.abs(y - gateHeight(PLACES.gate.x, PLACES.gate.z))).toBeLessThan(40);
    });
});

describe('Grainfields Lapporten: from the eye', () => {
    const line = skyline();
    const at = (bearing) => line.find((p) => Math.abs(p.bearing - bearing) < 1e-6).el;

    it('opens the U left of the card: its middle at about −21°, its right wall below −10°', () => {
        const gate = bearingOf(PLACES.gate.x, PLACES.gate.z).bearing;
        expect(gate).toBeCloseTo(-21, 0);
        // The U's floor: the lowest of the skyline between the lips.
        const u = line.filter((p) => p.bearing > -32 && p.bearing < -8).reduce((a, p) => (p.el < a.el ? p : a));
        // The floor is flat: the middle of the stretch within 0.5° of its lowest.
        const floor = line.filter((p) => p.bearing > -32 && p.bearing < -8 && p.el < u.el + 0.5);
        const middle = (floor[0].bearing + floor[floor.length - 1].bearing) / 2;
        expect(middle).toBeGreaterThan(-23.5);
        expect(middle).toBeLessThan(-18.5);
        expect(Math.abs(middle - gate)).toBeLessThan(2.5);
        // The walls: where the skyline climbs half way from the floor to the lips on either side.
        const rightTop = Math.max(...line.filter((p) => p.bearing > middle && p.bearing < 0).map((p) => p.el));
        const leftTop = Math.max(...line.filter((p) => p.bearing < middle && p.bearing > -45).map((p) => p.el));
        const rightWall = line.find((p) => p.bearing > middle && p.el > (u.el + rightTop) / 2).bearing;
        const leftWall = [...line].reverse().find((p) => p.bearing < middle && p.el > (u.el + leftTop) / 2).bearing;
        expect(rightWall).toBeLessThan(-10);
        expect(leftWall).toBeGreaterThan(-32);
        expect(rightWall - leftWall).toBeGreaterThan(5);
        // Sky through the gate: the floor far under the tops.
        expect(rightTop - u.el).toBeGreaterThan(3);
        expect(leftTop - u.el).toBeGreaterThan(3);
    });

    it('tops the fells out at 10–13° of elevation, the left fell the higher, the right ridge rising again beyond its saddle', () => {
        const top = line.reduce((a, p) => (p.el > a.el ? p : a));
        expect(top.el).toBeGreaterThan(10);
        expect(top.el).toBeLessThan(13);
        expect(top.bearing).toBeLessThan(-21); // on the left fell
        // Right of the gate: the shoulder, a saddle, then the ridge's summit.
        const right = line.filter((p) => p.bearing > -16);
        const shoulder = right.filter((p) => p.bearing < -8).reduce((a, p) => (p.el > a.el ? p : a));
        const summit = right.filter((p) => p.bearing > shoulder.bearing + 6).reduce((a, p) => (p.el > a.el ? p : a));
        const saddle = right.filter((p) => p.bearing > shoulder.bearing && p.bearing < summit.bearing)
            .reduce((a, p) => (p.el < a.el ? p : a));
        expect(saddle.el).toBeLessThan(shoulder.el - 0.5);
        expect(saddle.el).toBeLessThan(summit.el - 0.5);
        expect(shoulder.el).toBeLessThan(top.el);
        // The fells fall away on the far right of the widest frame.
        expect(at(40)).toBeLessThan(summit.el - 4);
    });

    it('stands under the storm deck', () => {
        let highest = 0;
        for (let c = GATE.span[0]; c <= GATE.span[1]; c += 25) {
            for (let a = -2000; a <= 2000; a += 250) {
                const [x, z] = gatePoint(c * SIZE.across, a * SIZE.across);
                highest = Math.max(highest, gateHeight(x, z));
            }
        }
        expect(highest).toBeGreaterThan(2000);
        expect(highest).toBeLessThan(DECK.base);
    });
});

describe('Grainfields Lapporten: the mesh', () => {
    it.each([
        ['the leanest tier', tierFor('Minimal').fells.cols, tierFor('Minimal').fells.rows],
        ['the default', undefined, undefined],
    ])('builds a finite mesh with up-facing normals (%s)', (_, cols, rows) => {
        const geometry = createGateGeometry(cols, rows);
        const nCols = cols ?? 420;
        const nRows = rows ?? 150;
        const { position, normal, aShape: shape } = geometry.attributes;
        expect(position.count).toBe(nCols * nRows);
        expect(normal.count).toBe(position.count);
        expect(shape.count).toBe(position.count);
        const index = geometry.index.array;
        expect(index.length).toBe((nCols - 1) * (nRows - 1) * 6);
        expect(index.reduce((m, v) => Math.max(m, v), 0)).toBeLessThan(position.count);
        const bad = [];
        let highest = -Infinity;
        for (let i = 0; i < position.count; i++) {
            const p = [position.getX(i), position.getY(i), position.getZ(i)];
            const n = [normal.getX(i), normal.getY(i), normal.getZ(i)];
            const s = [shape.getX(i), shape.getY(i), shape.getZ(i)];
            if (![...p, ...n, ...s].every(Number.isFinite)) bad.push(`vertex ${i}: not finite`);
            else if (!(n[1] > 0)) bad.push(`vertex ${i}: normal ${n.map((v) => v.toFixed(3))}`);
            else if (Math.abs(Math.hypot(...n) - 1) > 1e-3) bad.push(`vertex ${i}: |n| ${Math.hypot(...n)}`);
            else if (p[1] < -60 - 1e-3) bad.push(`vertex ${i}: below the plain`);
            else if (s[1] < 0 || s[1] > 1 || s[2] < 0) bad.push(`vertex ${i}: shape ${s}`);
            highest = Math.max(highest, p[1]);
            if (bad.length > 5) break;
        }
        expect(bad).toEqual([]);
        expect(highest).toBeLessThan(DECK.base);
        // Every triangle is wound to face up.
        let down = 0;
        for (let k = 0; k < index.length; k += 3) {
            const [a, b, c] = [index[k], index[k + 1], index[k + 2]];
            const ux = position.getX(b) - position.getX(a);
            const uz = position.getZ(b) - position.getZ(a);
            const vx = position.getX(c) - position.getX(a);
            const vz = position.getZ(c) - position.getZ(a);
            // The normal's y of (b − a) × (c − a).
            if (uz * vx - ux * vz <= 0) down += 1;
        }
        expect(down).toBe(0);
        expect(Number.isFinite(geometry.boundingSphere.radius)).toBe(true);
        expect(geometry.boundingSphere.radius).toBeGreaterThan(1000);
        geometry.dispose();
    });
});
