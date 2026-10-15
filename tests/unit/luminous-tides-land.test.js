/**
 * Luminous Tides — the land behind the beach: the palms (where they stand, how they lean, how a
 * tier builds them) and the jungle's strips. What one screenshot cannot check: that every palm is
 * rooted on sand the frame shows, that the front rank leans out to sea and the back rank rises
 * behind the jungle's edge, that each triangle faces the way its normals say (the light flips by
 * face), and that the crowns are laid out along the strip as the eye sees it.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import {
    PALMS, buildPalmArrays, clumpAt, palmDetail, planPalms,
} from '../../src/themes/luminous-tides/luminous-tides-palms.js';
import { LAND, landLine, stripGeometry } from '../../src/themes/luminous-tides/luminous-tides-land.js';
import { LuminousTidesWorld } from '../../src/themes/luminous-tides/luminous-tides-world.js';
import { QUALITY_NAMES, tierFor } from '../../src/themes/luminous-tides/luminous-tides-quality.js';
import { fallbackLayout } from '../../src/themes/luminous-tides/luminous-tides-composition.js';
import {
    SHORE, runup, SURF, sandHeight, toShore,
} from '../../src/themes/luminous-tides/luminous-tides-core.js';

const plan = (quality = 'High') => planPalms({ density: tierFor(quality).palms, lineAt: landLine });
const shoreOf = (p) => toShore(p[0], p[2], { a: 0, s: 0 });

describe('luminous tides land: the palms', () => {
    it('plants the same palms every time, fewer and plainer on the leaner tiers', () => {
        expect(plan('High')).toEqual(plan('High'));
        const counts = QUALITY_NAMES.map((q) => plan(q).length);
        counts.forEach((n) => expect(n).toBeGreaterThan(20));
        expect(plan('Minimal').length).toBeLessThan(plan('High').length);
        const lean = palmDetail(tierFor('Minimal').palms);
        const full = palmDetail(tierFor('High').palms);
        ['fronds', 'segments', 'sides', 'rings'].forEach((key) => expect(lean[key]).toBeLessThanOrEqual(full[key]));
        expect(full.fronds).toBeGreaterThanOrEqual(14);
    });

    it('stands the front rank on dry back-beach sand in front of the jungle, leaning out to sea', () => {
        const front = plan().filter((p) => p.front);
        expect(front.length).toBeGreaterThan(15);
        const swashTop = -runup(SURF.height * (1 + SURF.setDepth)) - 1;
        front.forEach((p) => {
            const line = landLine(p.a);
            expect(p.s).toBeGreaterThanOrEqual(line + PALMS.out[0] - 1e-6);
            expect(p.s).toBeLessThanOrEqual(line + PALMS.out[1] + 1e-6);
            // Above the highest swash, behind the berm.
            expect(p.s).toBeLessThan(swashTop);
            expect(p.s).toBeLessThan(SHORE.berm);
            // Rooted: the foot is sunk in the sand under it.
            expect(p.foot[1]).toBeLessThan(sandHeight(p.s));
            // Leaning seaward: the crown stands further out than the foot.
            expect(shoreOf(p.top).s).toBeGreaterThan(shoreOf(p.foot).s);
        });
    });

    it('raises the back rank out of the jungle, taller than its canopy', () => {
        const back = plan().filter((p) => !p.front);
        expect(back.length).toBeGreaterThan(4);
        back.forEach((p) => {
            expect(p.s).toBeLessThan(landLine(p.a));
            expect(p.top[1] - p.foot[1]).toBeGreaterThan(13);
        });
    });

    it('grows them in clumps with open beach between', () => {
        const front = plan().filter((p) => p.front).map((p) => p.a).sort((x, y) => x - y);
        const gaps = front.slice(1).map((a, i) => a - front[i]);
        expect(Math.max(...gaps)).toBeGreaterThan(PALMS.gap * 3);
        expect(Math.min(...gaps)).toBeLessThan(PALMS.gap);
        const samples = Array.from({ length: 400 }, (_, i) => clumpAt(PALMS.from + i));
        expect(Math.min(...samples)).toBe(0);
        expect(Math.max(...samples)).toBeGreaterThan(0.9);
    });

    it('roots every palm whose crown the frame shows on sand the frame shows', () => {
        const W = 1600;
        const H = 900;
        const scene = new THREE.Scene();
        const world = new LuminousTidesWorld({ scene, quality: 'High' }).build();
        const camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 30000);
        world.bindCamera(camera);
        world.setLayout(fallbackLayout(W, H), W / H);
        world.setViewport(W, H, W / H);
        world.seek(10);
        world.updateCamera(camera, {
            time: 10, delta: 0, pointerX: 0, pointerY: 0,
        });
        const screen = (p) => {
            const v = new THREE.Vector3(p[0], p[1], p[2]).project(camera);
            return { x: v.x * 0.5 + 0.5, y: 0.5 - v.y * 0.5, z: v.z };
        };
        const shown = world.parts.land.palms.filter((p) => {
            const top = screen(p.top);
            return top.z < 1 && top.x >= 0 && top.x <= 1 && top.y <= 1;
        });
        expect(shown.length).toBeGreaterThan(20);
        shown.forEach((p) => {
            const foot = screen(p.foot);
            expect(foot.x).toBeGreaterThanOrEqual(0);
            expect(foot.x).toBeLessThanOrEqual(1);
            expect(foot.y).toBeLessThanOrEqual(1);
        });
        world.dispose();
    });

    it('draws them far ones first', () => {
        const far = (p) => Math.hypot(p.foot[0], p.foot[2]);
        const order = plan().map(far);
        order.slice(1).forEach((d, i) => expect(d).toBeLessThanOrEqual(order[i] + 1e-9));
    });

    it('turns every triangle the way its normals face (the light flips by face)', () => {
        const palms = plan('Low');
        const arrays = buildPalmArrays(palms, palmDetail(tierFor('Low').palms));
        const P = arrays.position;
        const N = arrays.normal;
        const I = arrays.index;
        const at = (i, k) => P[i * 3 + k];
        let checked = 0;
        for (let t = 0; t < I.length; t += 3) {
            const [a, b, c] = [I[t], I[t + 1], I[t + 2]];
            const ab = [0, 1, 2].map((k) => at(b, k) - at(a, k));
            const ac = [0, 1, 2].map((k) => at(c, k) - at(a, k));
            const face = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
            const area = Math.hypot(...face);
            if (area < 1e-6) continue;
            const n = [0, 1, 2].map((k) => N[a * 3 + k] + N[b * 3 + k] + N[c * 3 + k]);
            expect(face[0] * n[0] + face[1] * n[1] + face[2] * n[2]).toBeGreaterThan(0);
            checked += 1;
        }
        expect(checked).toBeGreaterThan(I.length / 3 / 2);
        for (let i = 0; i < N.length; i += 3) expect(Math.hypot(N[i], N[i + 1], N[i + 2])).toBeCloseTo(1, 4);
        const tags = arrays.palm;
        for (let i = 0; i < tags.length; i += 4) {
            expect(Math.abs(tags[i])).toBeLessThanOrEqual(1);
            expect(tags[i + 1]).toBeGreaterThanOrEqual(0);
            expect(tags[i + 1]).toBeLessThanOrEqual(1);
            expect([0, 1]).toContain(tags[i + 2]);
        }
    });
});

describe('luminous tides land: the strips', () => {
    it('stands the jungle on the sand behind the palms and lays its crowns out as the eye sees them', () => {
        const geometry = stripGeometry(LAND.from, LAND.to, landLine, () => 19);
        const pos = geometry.getAttribute('position').array;
        const land = geometry.getAttribute('aLand').array;
        const span = geometry.getAttribute('aSpan').array;
        const columns = span.length / 2;
        for (let i = 0; i < columns; i += 1) {
            const a = land[i * 8];
            // The foot of each column is under the sand at the jungle's edge.
            expect(pos[i * 6 + 1]).toBeLessThan(sandHeight(landLine(a)));
            if (i > 0) expect(span[i * 2]).toBeGreaterThan(span[(i - 1) * 2]);
        }
        // Abreast of the eye a metre of the strip is nearly a metre across the picture; far down
        // the bay it is a sliver.
        const stepAt = (a) => {
            const i = Math.round((a - LAND.from) / LAND.step);
            return (span[(i + 1) * 2] - span[i * 2]) / LAND.step;
        };
        expect(stepAt(0)).toBeGreaterThan(0.9);
        expect(stepAt(300)).toBeLessThan(0.15);
        geometry.dispose();
    });
});
