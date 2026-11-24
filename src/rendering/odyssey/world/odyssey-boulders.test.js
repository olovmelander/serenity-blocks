import { describe, expect, it } from 'vitest';

import {
    ODYSSEY_BOULDERS, ODYSSEY_TARN_ROCKS, boulderMatrix, buildBoulderGeometry, buildBoulderSites,
} from './odyssey-boulders.js';
import {
    ODYSSEY_TARN, odysseyTarnDistance, odysseyTarnRn, odysseyWorldHeight,
} from './odyssey-world-height.js';
import { scatterZonedForest } from './odyssey-forest-scatter.js';
import { getOdysseyPathPointAt, getOdysseyWorldRailPointAt } from '../path-utils.js';
import { ODYSSEY_DEER } from '../composition/odyssey-deer-herd.js';
import { ODYSSEY_POND } from '../composition/odyssey-pond-life-motion.js';

/**
 * BOULDERS AND OUTCROPS (Act II leftovers): rocks for scale, sited on the rail camera. These pin
 * the siting rules, the seating on the drawn ground, and the cost.
 */
describe('the boulders and outcrops', () => {
    const rail = Array.from({ length: 48 }, (_, i) => getOdysseyWorldRailPointAt(i / 47));
    const forest = scatterZonedForest(odysseyWorldHeight, { rail, visibilityCull: true });
    const rocks = buildBoulderSites(odysseyWorldHeight, { trees: forest.placements });

    it('is a modest set: nearly every anchor keeps a rock, under 90 in all', () => {
        expect(rocks.length).toBeGreaterThan(ODYSSEY_BOULDERS.anchors.length);
        expect(rocks.length).toBeLessThan(90);
        const kept = ODYSSEY_BOULDERS.anchors.filter((_, ai) => rocks.some((r) => r.anchor === ai));
        expect(kept.length).toBeGreaterThanOrEqual(ODYSSEY_BOULDERS.anchors.length - 2);
    });

    it('keeps out of the tarn and its open meadow, the rail\'s track and the deer\'s glade', () => {
        const track = Array.from({ length: 1200 }, (_, i) => getOdysseyPathPointAt(0.12 + ((0.6 * i) / 1199)));
        const spots = ODYSSEY_DEER.members.flatMap((m) => m.spots);
        // (The tarn's own stones, ODYSSEY_TARN_ROCKS, stand on its islet and in its shallows on
        // purpose, under the rail's track where it crosses the water 70-150 u up: they are seen
        // from the orbs' close-ups, not the rail's forward view. The next test holds them.)
        rocks.filter((r) => r.kind !== 'tarn').forEach((r) => {
            const at = `${r.kind} rock at (${r.x.toFixed(0)}, ${r.z.toFixed(0)})`;
            expect(odysseyTarnRn(r.x, r.z), at).toBeGreaterThan(ODYSSEY_TARN.clearing);
            const railD = Math.min(...track.map((p) => Math.hypot(p.x - r.x, p.z - r.z)));
            expect(railD, at).toBeGreaterThan(25);
            spots.forEach(([x, z]) => expect(Math.hypot(x - r.x, z - r.z), at).toBeGreaterThan(25));
        });
    });

    it('sets the stones of the tarn by its water: on the islet, at the point, in the shallows, clear of its life', () => {
        const tarnRocks = rocks.filter((r) => r.kind === 'tarn');
        expect(tarnRocks.length).toBe(ODYSSEY_TARN_ROCKS.length);
        const swans = ODYSSEY_POND.swans.route;
        const heron = Object.values(ODYSSEY_POND.heron.sites).flat();
        tarnRocks.forEach((r) => {
            const at = `tarn rock at (${r.x.toFixed(0)}, ${r.z.toFixed(0)})`;
            // By the water: within a few units of its shore, on either side.
            expect(Math.abs(odysseyTarnDistance(r.x, r.z)), at).toBeLessThan(8);
            // Out of the swans' way and the heron's shallows.
            swans.forEach(([x, z]) => expect(Math.hypot(x - r.x, z - r.z), at).toBeGreaterThan(6));
            heron.forEach(([x, z]) => expect(Math.hypot(x - r.x, z - r.z), at).toBeGreaterThan(6));
            // Seated: it stands out of the water by at least a third of its height.
            const top = r.y + (ODYSSEY_BOULDERS.shapes[r.shape].flat * r.sy);
            expect(top - Math.max(odysseyWorldHeight(r.x, r.z), ODYSSEY_TARN.waterY), at).toBeGreaterThan(r.sy * 0.33);
        });
    });

    it('stands clear of every tree trunk', () => {
        // One assertion a rock, on its nearest tree: an expect for every rock and tree was what took
        // this test past its five seconds on a slow runner.
        rocks.forEach((r) => {
            const radius = Math.max(r.sx, r.sz);
            let nearest = Infinity;
            forest.placements.forEach((t) => {
                // (The islet's bent pine grows among its own rocks: that is the picture.)
                if (t.framing && t.id === 'bent-pine' && r.kind === 'tarn') return;
                nearest = Math.min(nearest, Math.hypot(t.x - r.x, t.z - r.z));
            });
            expect(nearest, `${r.kind} rock at (${r.x.toFixed(0)}, ${r.z.toFixed(0)})`)
                .toBeGreaterThan(radius + ODYSSEY_BOULDERS.treeClear - 1e-6);
        });
    });

    it('is seated: the underside is buried under the lowest ground of its footprint, the top stands clear', () => {
        rocks.forEach((r) => {
            const { flat } = ODYSSEY_BOULDERS.shapes[r.shape];
            const bottom = r.y - (0.42 * flat * r.sy);
            const top = r.y + (flat * r.sy);
            const at = `rock at (${r.x.toFixed(0)}, ${r.z.toFixed(0)})`;
            expect(bottom, at).toBeLessThan(r.ground);
            expect(r.ground, at).toBeLessThanOrEqual(odysseyWorldHeight(r.x, r.z) + 1e-6);
            const tall = flat * r.sy * 1.42;
            expect(top - odysseyWorldHeight(r.x, r.z), at).toBeGreaterThan((tall * ODYSSEY_BOULDERS.standsOut) - 1e-6);
        });
    });

    it('is cheap: each tier\'s shapes within budget, the whole set under 25k triangles at the near tier', () => {
        const near = ODYSSEY_BOULDERS.shapes.map((_, s) => buildBoulderGeometry(s, ODYSSEY_BOULDERS.lod.near));
        const far = ODYSSEY_BOULDERS.shapes.map((_, s) => buildBoulderGeometry(s, ODYSSEY_BOULDERS.lod.far));
        const tris = (g) => g.attributes.position.count / 3;
        near.forEach((g) => expect(tris(g)).toBeLessThanOrEqual(320));
        far.forEach((g) => expect(tris(g)).toBeLessThanOrEqual(80));
        const total = rocks.reduce((sum, r) => sum + tris(near[r.shape]), 0);
        expect(total).toBeLessThan(25000);
    });

    it('builds closed, lit rocks: unit normals that face out', () => {
        ODYSSEY_BOULDERS.shapes.forEach((_, s) => {
            const g = buildBoulderGeometry(s, ODYSSEY_BOULDERS.lod.near);
            const p = g.attributes.position;
            const n = g.attributes.normal;
            let outward = 0;
            for (let i = 0; i < p.count; i += 1) {
                const len = Math.hypot(n.getX(i), n.getY(i), n.getZ(i));
                expect(len).toBeCloseTo(1, 4);
                if ((p.getX(i) * n.getX(i)) + (p.getY(i) * n.getY(i)) + (p.getZ(i) * n.getZ(i)) > 0) outward += 1;
            }
            expect(outward / p.count).toBeGreaterThan(0.97);
        });
    });

    it('composes a finite matrix for every rock', () => {
        rocks.forEach((r) => {
            expect(boulderMatrix(r).elements.every(Number.isFinite)).toBe(true);
        });
    });
});
