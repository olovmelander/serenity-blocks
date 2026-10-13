/**
 * Thermal Bloom — the ground's gameplay marks, on the CPU: where a lock's fan lies (clear of the
 * card, inside the frame, sized in screen cells), where a clear seals (a Stair tier that is seen,
 * its record row the shader's), the succession front's radius, the eye widening away from the card
 * and a replayed capture laying its stone once. Relations only, never tuning numbers.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { ThermalBloomWorld, frontRadiusAt } from '../../src/themes/thermal-bloom/thermal-bloom-world.js';
import { fallbackLayout } from '../../src/themes/thermal-bloom/thermal-bloom-composition.js';
import {
    BLOOM_CODE, EVENT_ROWS, IRIS_RADIUS, RECORD_RING0, TAU, projectToScreen,
} from '../../src/themes/thermal-bloom/thermal-bloom-tsl.js';

function makeWorld(width, height, quality = 'Minimal') {
    const world = new ThermalBloomWorld({ scene: new THREE.Scene(), quality, capture: true }).build();
    world.setViewport(width, height, width / height);
    world.setLayout(fallbackLayout(width, height), width / height);
    world.seek(10);
    return world;
}

/** A bloom's outline on screen (fractions): its foot and its far end's corners. */
function fanOnScreen(world, b) {
    const a = (b.heading / BLOOM_CODE.headings) * TAU;
    const dir = [Math.sin(a), Math.cos(a)];
    const perp = [-dir[1], dir[0]];
    const h = b.side === 1 ? world.parts.terraces.heightAt(b.x, b.z) : 0;
    return [[0, 0], [1, 0.5], [1, -0.5]].map(([f, w]) => projectToScreen(world.plan.rig, world.aspect, [
        b.x + dir[0] * b.length * f + perp[0] * b.span * w, h, b.z + dir[1] * b.length * f + perp[1] * b.span * w,
    ]));
}

// Each case builds whole worlds (bakes and node graphs): give them room on a loaded machine.
const SLOW = { timeout: 30000 };

describe('Thermal Bloom ground: the Spill', () => {
    it('heads every fan away from the card, inside the frame, at least half a cell clear of it', SLOW, () => {
        for (const [w, h] of [[1920, 1080], [390, 844]]) {
            const world = makeWorld(w, h);
            const card = world.layout.cards[0];
            const cellX = (world.layout.boards[0].y1 - world.layout.boards[0].y0) / 20 / world.aspect;
            [[0.15, 12], [0.2, 15], [0.85, 8], [0.3, 18], [0.7, 4]].forEach(([u, row]) => {
                world.onLock({
                    player: 0, rows: [row, row - 1], u, color: '#F5D020', shape: 'T',
                });
                const b = world.blooms[world.blooms.length - 1];
                expect(b.heading).toBeGreaterThanOrEqual(0);
                expect(b.heading).toBeLessThan(BLOOM_CODE.headings);
                expect(b.span).toBeLessThan(100);
                expect(b.length).toBeLessThan(100);
                const pts = fanOnScreen(world, b);
                pts.forEach((p) => {
                    expect(p).not.toBeNull();
                    expect(p[0]).toBeGreaterThan(0);
                    expect(p[0]).toBeLessThan(1);
                    const beside = p[1] > card.y0 && p[1] < card.y1;
                    if (beside) expect(p[0] < card.x0 - cellX * 0.4 || p[0] > card.x1 + cellX * 0.4).toBe(true);
                });
            });
            world.dispose();
        }
    });

    it('writes the heading, side, span and length into the bloom row\'s code', SLOW, () => {
        const world = makeWorld(1920, 1080);
        world.onLock({
            player: 0, rows: [12, 11], u: 0.15, color: '#BD3B1A', shape: 'L',
        });
        world.writeBlooms(world.time);
        const b = world.blooms[0];
        const code = world.u.tables.events[EVENT_ROWS.blooms + 1].w;
        expect(Math.floor(code / BLOOM_CODE.heading)).toBe(b.heading);
        const rest = code % BLOOM_CODE.heading;
        expect(Math.floor(rest / BLOOM_CODE.side)).toBe(b.side);
        expect(rest % BLOOM_CODE.span).toBe(b.length);
        expect(code).toBeLessThan(2 ** 24); // exact in a float32 uniform
        world.dispose();
    });
});

describe('Thermal Bloom ground: the Seal', () => {
    it('lights Stair tiers that stand in frame, one further a cascade wave, the record row the tier\'s', SLOW, () => {
        const world = makeWorld(1920, 1080, 'High');
        const { tiers } = world.parts.terraces;
        [8, 12, 16, 18, 19].forEach((row) => {
            const last = world.lowestStairLip(world.aimRow(0, 1, row).sx);
            const seen = new Set();
            for (let wave = 0; wave < 3; wave++) {
                const site = world.sealSite(0, 1, row, wave);
                expect(site.side).toBe(1);
                expect(site.index).toBeGreaterThanOrEqual(1);
                expect(site.index).toBeLessThanOrEqual(Math.min(tiers, last));
                expect(site.record).toBe(site.index - 1);
                seen.add(site.index);
            }
            expect(seen.size).toBe(3);
        });
        world.dispose();
    });

    it('lays the Iris\'s stripe in its row\'s zone, tagged with its terrace line', SLOW, () => {
        const world = makeWorld(1920, 1080);
        world.writeRecordZones(0);
        const a = world.sealSite(0, 0, 3, 0);
        const b = world.sealSite(0, 0, 17, 0);
        expect(a.record).toBeGreaterThanOrEqual(RECORD_RING0);
        expect(b.record).toBeGreaterThan(a.record);
        [a, b].forEach((s) => {
            expect(s.tag % 16).toBe(8);
            expect(s.tag).toBeGreaterThanOrEqual(24);
            expect(s.tag).toBeLessThanOrEqual(248);
        });
        world.dispose();
    });

    it('lays a replayed capture\'s stripe once: a seek starts the stone afresh', SLOW, () => {
        const world = makeWorld(1920, 1080);
        const laid = () => world.recordData.filter((v, i) => i % 4 === 3 && v > 0).length;
        const clear = () => world.onClear({
            player: 0, lines: 2, rows: [17, 16], rowCodes: new Array(20).fill(3),
        });
        clear();
        const once = laid();
        expect(once).toBeGreaterThan(0);
        world.seek(10);
        clear();
        expect(laid()).toBe(once);
        world.dispose();
    });
});

describe('Thermal Bloom ground: the year and the eye', () => {
    it('sweeps the succession front outward, gone past everything as the sweep ends', SLOW, () => {
        let prev = 0;
        for (let s = 0; s < 1; s += 0.05) {
            const r = frontRadiusAt(s);
            expect(r).toBeGreaterThan(prev);
            prev = r;
        }
        expect(frontRadiusAt(0)).toBeLessThan(IRIS_RADIUS * 1.2);
        expect(frontRadiusAt(0.5)).toBeLessThan(IRIS_RADIUS * 3);
        expect(frontRadiusAt(1)).toBeGreaterThan(1e5);
    });

    it('widens the eye away from the card: its water never comes within 0.02 of the card', SLOW, () => {
        for (const [w, h] of [[1920, 1080], [1600, 900], [1440, 1080], [2560, 1080]]) {
            const world = makeWorld(w, h);
            const cap = world.eyeHeatCap();
            const card = world.layout.cards[0];
            const [ex, , ez] = world.plan.eye;
            const anchor = projectToScreen(world.plan.rig, world.aspect, [ex, 0, ez]);
            expect(anchor).not.toBeNull();
            const k = 1 + Math.min(cap, 0.5);
            // Where the composition already tucks the rest pool's edge under the card (4:3), the
            // widening leaves that edge where it is: only frames clear at rest are held to it.
            const rim = IRIS_RADIUS * 1.06;
            const clearAtRest = Array.from({ length: 64 }, (_, i) => projectToScreen(world.plan.rig, world.aspect, [
                ex + Math.cos((i / 64) * TAU) * rim, 0, ez + Math.sin((i / 64) * TAU) * rim,
            ])).every((p) => !p || p[1] < card.y0 || p[1] > card.y1 || p[0] < card.x0 - 0.02 || p[0] > card.x1 + 0.02);
            for (let i = 0; i < 64; i++) {
                const a = (i / 64) * TAU;
                const R = IRIS_RADIUS * 1.06;
                const dx = ex + Math.cos(a) * R - world.heatAnchor[0];
                const dz = ez + Math.sin(a) * R - world.heatAnchor[1];
                const p = projectToScreen(world.plan.rig, world.aspect, [
                    world.heatAnchor[0] + dx * k, 0, world.heatAnchor[1] + dz * k,
                ]);
                if (!clearAtRest || !p || p[1] < card.y0 || p[1] > card.y1) continue;
                expect(p[0] < card.x0 - 0.019 || p[0] > card.x1 + 0.019).toBe(true);
            }
            world.dispose();
        }
    });
});
