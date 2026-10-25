/**
 * Sunbraid — the crust and the sky rays (docs/SUNBRAID_CRUST_AND_RAYS_2026-10.md): the salt crust's
 * borders are found among the nine nearest centres (exact where a ridge is drawn), the rays' shape
 * closes and lights the right way, and their flight stays in its ranges. The look itself is judged
 * in captures.
 */
import { describe, expect, it } from 'vitest';
import { FLOOR_CRUST } from '../../src/themes/sunbraid/sunbraid-land.js';
import { TOWER_RELIEF } from '../../src/themes/sunbraid/sunbraid-spires.js';
import {
    MAX_GLIDERS, STROKE, GLIDER_LOOPS, gliderAt,
} from '../../src/themes/sunbraid/sunbraid-glide.js';
import {
    RAY, RAY_LOOK, RAY_STROKE, buildGliderGeometry, createGliders, rayEdges,
} from '../../src/themes/sunbraid/sunbraid-gliders.js';
import { groundHeight } from '../../src/themes/sunbraid/sunbraid-plan.js';
import { createUniforms } from '../../src/themes/sunbraid/sunbraid-tsl.js';
import { mulberry32 } from '../../src/themes/sunbraid/sunbraid-core.js';

// ── The crust's border search (a CPU mirror of sbHash22 and sbCellEdge's arithmetic) ──

const fract = (x) => x - Math.floor(x);
function hash22(x, y) {
    let a = fract(x * 0.1031);
    let b = fract(y * 0.103);
    let c = fract(x * 0.0973);
    const d = a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33);
    a += d;
    b += d;
    c += d;
    return [fract((a + b) * c), fract((a + c) * b)];
}

/** Distance to the nearest border, the borders sought among the centres within `reach` cells. */
function borderDistance(px, py, jitter, reach) {
    const ix = Math.floor(px);
    const iy = Math.floor(py);
    const site = (i, j) => {
        const h = hash22(ix + i, iy + j);
        return [i + 0.5 + (h[0] - 0.5) * jitter - (px - ix), j + 0.5 + (h[1] - 0.5) * jitter - (py - iy)];
    };
    const sites = [];
    for (let j = -reach; j <= reach; j++) for (let i = -reach; i <= reach; i++) sites.push(site(i, j));
    let near = null;
    let nearD = Infinity;
    for (const r of sites) {
        const d = r[0] * r[0] + r[1] * r[1];
        if (d < nearD) { nearD = d; near = r; }
    }
    let edge = Infinity;
    for (const r of sites) {
        const dx = r[0] - near[0];
        const dy = r[1] - near[1];
        const span = Math.hypot(dx, dy);
        if (span < 1e-4) continue;
        edge = Math.min(edge, ((near[0] + r[0]) * 0.5 * dx + (near[1] + r[1]) * 0.5 * dy) / span);
    }
    return edge;
}

describe('Sunbraid crust', () => {
    it('finds the nearest border among the nine nearest centres wherever a ridge is drawn', () => {
        const random = mulberry32(0x5a17);
        let checked = 0;
        let wrong = 0;
        for (let k = 0; k < 40000; k++) {
            const x = random() * 400 - 200;
            const y = random() * 400 - 200;
            const wide = borderDistance(x, y, FLOOR_CRUST.jitter, 3);
            // Within a ridge plus a wide pixel of filtering either side.
            if (wide > FLOOR_CRUST.ridge + 0.1) continue;
            checked += 1;
            if (Math.abs(borderDistance(x, y, FLOOR_CRUST.jitter, 1) - wide) > 1e-6) wrong += 1;
        }
        expect(checked).toBeGreaterThan(5000);
        expect(wrong).toBe(0);
    });

    it('keeps the ridges, their knots, the wander and the filter in sensible ranges', () => {
        expect(FLOOR_CRUST.ridge).toBeGreaterThan(0.02);
        // A knot rounds a junction without swallowing the ridges it joins.
        expect(FLOOR_CRUST.knot * Math.LN2).toBeLessThan(FLOOR_CRUST.ridge * 0.5);
        expect(FLOOR_CRUST.lift[0]).toBeGreaterThan(0);
        expect(FLOOR_CRUST.lift[0]).toBeLessThan(1);
        expect(FLOOR_CRUST.wander[0]).toBeLessThan(0.25);
        expect(FLOOR_CRUST.filter).toBeGreaterThanOrEqual(1);
        expect(FLOOR_CRUST.bounce).toBeGreaterThan(0);
        expect(FLOOR_CRUST.bounce).toBeLessThan(1);
        expect(TOWER_RELIEF.step).toBeGreaterThan(0);
        expect(TOWER_RELIEF.scale).toBeGreaterThan(TOWER_RELIEF.height);
    });
});

// ── The sky rays ──

describe('Sunbraid sky rays: the shape', () => {
    it('is a crescent: its edges never cross, and meet at the swept-back tips', () => {
        for (let i = 0; i <= 200; i++) {
            const s = (i / 200) * 2 - 1;
            const [lead, trail] = rayEdges(s);
            expect(trail - lead).toBeGreaterThanOrEqual(-1e-9);
            expect(rayEdges(-s)).toEqual([lead, trail]);
        }
        const [lead, trail] = rayEdges(1);
        expect(lead).toBeCloseTo(RAY.tip, 9);
        expect(trail).toBeCloseTo(RAY.tip, 9);
        // The tips sweep back of the shoulders.
        expect(RAY.tip).toBeGreaterThan(rayEdges(0.5)[0]);
    });

    it('closes: the back and the belly meet all round the outline, and face out', () => {
        const geometry = buildGliderGeometry(20, 8);
        const pos = geometry.getAttribute('position');
        const shape = geometry.getAttribute('aShape');
        const normal = geometry.getAttribute('normal');
        const cols = 21;
        const perSide = cols * 9;
        for (const j of [0, 8]) {
            for (let i = 0; i < cols; i++) {
                const back = j * cols + i;
                const belly = perSide + back;
                expect(pos.getY(back)).toBeCloseTo(pos.getY(belly), 9);
                expect(pos.getZ(back)).toBeCloseTo(pos.getZ(belly), 9);
            }
        }
        const centre = 4 * cols + 10;
        expect(shape.getZ(centre)).toBe(1);
        expect(normal.getY(centre)).toBeGreaterThan(0.9);
        expect(shape.getZ(perSide + centre)).toBe(-1);
        expect(normal.getY(perSide + centre)).toBeLessThan(-0.9);
        for (let i = 0; i < normal.count; i++) {
            expect(Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i))).toBeCloseTo(1, 5);
        }
        // The tail trails back from the body.
        let tail = 0;
        for (let i = 0; i < shape.count; i++) {
            if (shape.getW(i) === 1) {
                tail += 1;
                expect(pos.getZ(i)).toBeGreaterThan(RAY.rear - 0.03);
            }
        }
        expect(tail).toBeGreaterThan(10);
        geometry.dispose();
    });

    it('keeps its stroke and light in sensible ranges', () => {
        expect(RAY_STROKE.lift).toBeLessThan(0.3);
        expect(RAY_STROKE.gull).toBeLessThan(RAY_STROKE.lift);
        expect(RAY_LOOK.tipOpacity).toBeGreaterThan(0.5);
        expect(RAY_LOOK.tipOpacity).toBeLessThanOrEqual(1);
        // A sun's glow through a wing is tighter than the three suns' braid (else they sum to white).
        expect(RAY_LOOK.glow).toBeGreaterThan(100);
        expect(RAY_LOOK.lining).toBeLessThan(RAY_LOOK.glow);
    });
});

describe('Sunbraid sky rays: the flight', () => {
    it('is a pure function of the clock, with every value in its range', () => {
        for (let k = 0; k < MAX_GLIDERS; k++) {
            for (let t = 0; t < 400; t += 1.7) {
                const a = gliderAt(k, t);
                expect(gliderAt(k, t)).toEqual(a);
                expect(a.flap).toBeGreaterThanOrEqual(0);
                expect(a.flap).toBeLessThanOrEqual(1);
                expect(a.beat).toBeGreaterThanOrEqual(0);
                expect(a.beat).toBeLessThan(1);
                expect(Math.abs(a.bank)).toBeLessThanOrEqual(STROKE.bankMax + 1e-9);
                expect(Math.abs(a.pitch)).toBeLessThanOrEqual(STROKE.pitch + 1e-9);
            }
        }
    });

    it('beats its wings while it climbs and glides while it sinks', () => {
        let climbing = 0;
        let beatingClimbs = 0;
        let sinking = 0;
        let glidingSinks = 0;
        for (let k = 0; k < MAX_GLIDERS; k++) {
            for (let t = 0; t < 600; t += 0.9) {
                const rise = gliderAt(k, t + 0.05).y - gliderAt(k, t - 0.05).y;
                const { flap, pitch } = gliderAt(k, t);
                // The nose lifts as it climbs.
                if (Math.abs(pitch) > STROKE.pitch * 0.2) expect(Math.sign(pitch)).toBe(Math.sign(rise));
                if (pitch > STROKE.pitch * STROKE.climb) { climbing += 1; if (flap > 0.99) beatingClimbs += 1; }
                if (pitch < STROKE.pitch * STROKE.calm) { sinking += 1; if (flap < 0.01) glidingSinks += 1; }
            }
        }
        expect(climbing).toBeGreaterThan(100);
        expect(beatingClimbs).toBe(climbing);
        expect(sinking).toBeGreaterThan(100);
        expect(glidingSinks).toBe(sinking);
    });

    it('beats slower the bigger it is, and banks hard enough in its turns to show its wings', () => {
        const periodOf = (span) => STROKE.period + STROKE.perSpan * span;
        const spans = GLIDER_LOOPS.map((L) => L.span);
        expect(periodOf(Math.max(...spans))).toBeGreaterThan(periodOf(Math.min(...spans)));
        let deepest = 0;
        for (let t = 0; t < 400; t += 0.5) deepest = Math.max(deepest, Math.abs(gliderAt(0, t).bank));
        expect(deepest).toBeGreaterThan(20 * (Math.PI / 180));
    });
});

describe('Sunbraid sky rays: the frame', () => {
    function stubWorld(overrides = {}) {
        const u = createUniforms();
        u.eye.value.set(0, 80, 0);
        return {
            u, glideTime: 30, _camera: { fov: 40 }, viewportHeight: 1000, reducedMotion: false, ...overrides,
        };
    }

    it('writes each ray where its flight puts it, turned by a unit quaternion, with its pixel size', () => {
        const rays = createGliders(createUniforms(), { noise: null }, 6);
        const world = stubWorld();
        rays.update(0, 1 / 60, world);
        const rows = rays.geometry.getAttribute('aRayAt').data.array;
        const fov = 40 * (Math.PI / 180);
        for (let k = 0; k < 6; k++) {
            const at = gliderAt(k, world.glideTime);
            const o = k * 12;
            const y = groundHeight(at.x, at.z) + at.y;
            expect(rows[o]).toBeCloseTo(at.x, 3);
            expect(rows[o + 1]).toBeCloseTo(y, 3);
            expect(rows[o + 2]).toBeCloseTo(at.z, 3);
            expect(rows[o + 3]).toBe(at.span);
            expect(Math.hypot(rows[o + 4], rows[o + 5], rows[o + 6], rows[o + 7])).toBeCloseTo(1, 5);
            const range = Math.hypot(at.x, y - 80, at.z);
            expect(rows[o + 10]).toBeCloseTo((range * 2 * Math.tan(fov / 2)) / 1000 / at.span, 6);
            // Its shadow disc.
            expect(world.u.gliderRows[k].w).toBeCloseTo(at.span * 0.3, 6);
        }
        expect(world.u.gliderRows[6].y).toBeLessThan(-1e4);
        expect(world.u.gliderCount.value).toBe(6);
        rays.dispose();
    });

    it('holds its wings still with reduced motion (it still flies its loop)', () => {
        const rays = createGliders(createUniforms(), { noise: null }, 3);
        const world = stubWorld({ reducedMotion: true });
        rays.update(0, 1 / 60, world);
        const rows = rays.geometry.getAttribute('aRayAt').data.array;
        for (let k = 0; k < 3; k++) {
            expect(rows[k * 12 + 8]).toBe(0.25);
            expect(rows[k * 12 + 9]).toBe(0);
            expect(rows[k * 12 + 11]).toBe(0);
            expect(rows[k * 12]).toBeCloseTo(gliderAt(k, world.glideTime).x, 3);
        }
        rays.dispose();
    });
});
