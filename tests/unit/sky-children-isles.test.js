/**
 * Sky Children — the isles' geometry (sky-children-isles.js), pinned as relations: every piece
 * grows finite and in one piece of stone kinds; the crown weight never interpolates an id; the
 * spillway's notch is where the Mother Fall's outlet stands; the terraces hold the pool slots the
 * gameplay needs, each brimming below the pool above it; the aqueduct's piers stand on the Twin's
 * crown; and the far isles are built at FAR_UNIT.
 */
import { describe, expect, it } from 'vitest';
import {
    FAR_UNIT, MAT, buildAqueduct, buildCascade, buildFarIsles, buildMassif, buildOutcrops, buildSatellites, isleAnchors,
    isleShapes, massifCrownAt, massifGround, outletAt,
} from '../../src/themes/sky-children/sky-children-isles.js';
import { PLAN } from '../../src/themes/sky-children/sky-children-plan.js';

const finite = (g) => Array.from(g.attributes.position.array).every(Number.isFinite);
const SHAPES = isleShapes(PLAN);

describe('Sky Children isles: the massifs', () => {
    it('grow finite, with a crown weight beside whole-piece stone kinds (no id swept from iron to crown)', () => {
        for (const [name, p] of Object.entries(SHAPES)) {
            const g = buildMassif(p, {
                radial: 40, rings: 30, seed: 3, outletTh: Math.PI / 2 - 0.62, spur: name === 'twin' ? [Math.PI, 0.45, 0.35] : null,
            });
            expect(finite(g), name).toBe(true);
            const mats = new Set(Array.from(g.attributes.aMat.array));
            // Before ensureAttrs folds the crown into the iron kind, a massif names only those two.
            mats.forEach((m) => expect([MAT.iron, MAT.crown], name).toContain(m));
            g.dispose();
        }
    });

    it('cut the spillway: the outlet at the Mother Fall\'s bearing stands in the notch\'s floor', () => {
        const p = SHAPES.spring;
        const terraces = buildCascade(p, { count: 8, radial: 12 });
        const mother = outletAt(terraces.outlets, p.notch.th);
        const aside = outletAt(terraces.outlets, -0.6);
        // (The outlets stand every 0.1 rad round the front: the nearest is within the notch's floor.)
        expect(mother.y).toBeCloseTo(p.lip + 0.6 - p.notch.depth, 1);
        expect(aside.y).toBeGreaterThan(mother.y + p.notch.depth * 0.9);
        // The crown sinks into the notch at the rim there, and not at the opposite shoulder.
        const opts = { seed: 33, asym: 0.2 };
        const at = (th) => massifGround(p, Math.sin(th) * p.radius * 0.97, Math.cos(th) * p.radius * 0.97, opts);
        const crown = (th) => massifCrownAt(p, Math.sin(th) * p.radius * 0.97, Math.cos(th) * p.radius * 0.97, opts).y;
        expect(crown(p.notch.th) - at(p.notch.th)).toBeGreaterThan(p.notch.depth * 0.5);
        expect(crown(-p.notch.th) - at(-p.notch.th)).toBeLessThan(0.01);
        terraces.geometry.dispose();
    });
});

describe('Sky Children isles: the rimstone terraces', () => {
    it('hold enough pool slots, every pool brimming below the one above it', () => {
        for (const [name, count, least] of [['spring', 12, 26], ['twin', 8, 16]]) {
            const p = SHAPES[name];
            const t = buildCascade(p, { count, radial: 16 });
            expect(finite(t.geometry), name).toBe(true);
            expect(t.pools.length, name).toBeGreaterThanOrEqual(least);
            for (let i = 1; i < t.levels.length; i++) expect(t.levels[i], `${name} ${i}`).toBeLessThan(t.levels[i - 1]);
            t.pools.forEach((q) => {
                expect(q.radius, name).toBeGreaterThan(1);
                expect(q.y, name).toBeCloseTo(t.levels[q.level] - 0.05, 9);
            });
            t.geometry.dispose();
        }
    });
});

describe('Sky Children isles: the set pieces', () => {
    it('stands the aqueduct\'s piers on the Twin\'s crown, and ends its channel past the last pier', () => {
        const { aqueduct: aq, spanLip } = isleAnchors(PLAN);
        const built = buildAqueduct(aq.spans, aq.span, aq.lower, aq.upper, aq.depth, aq.groundAt);
        expect(finite(built.geometry)).toBe(true);
        // Every pier but the outer one stands over the crown (the outer one runs on down the cliff).
        const tw = SHAPES.twin;
        for (let i = 0; i < aq.spans; i++) {
            const { on } = massifCrownAt(tw, aq.x - i * aq.span, aq.z, { seed: 71, asym: 0.2, spur: [Math.PI, 0.45, 0.35] });
            expect(on, `pier ${i}`).toBe(true);
        }
        expect(spanLip.x).toBeLessThan(aq.x - (aq.spans - 1) * aq.span);
        expect(spanLip.y).toBeGreaterThan(aq.y + aq.lower + aq.upper);
        built.geometry.dispose();
    });

    it('grows satellites, outcrops and far isles finite', () => {
        const sat = buildSatellites(SHAPES.spring, [[-1, -70, 0, 9], [0.3, -200, 0.8, 5]], { seed: 5 });
        const out = buildOutcrops(SHAPES.spring, 6, { seed: 7 });
        expect(finite(sat)).toBe(true);
        expect(finite(out)).toBe(true);
        const far = buildFarIsles(1);
        expect(far).toHaveLength(5);
        far.forEach((g, i) => {
            expect(finite(g), `variant ${i}`).toBe(true);
            g.computeBoundingBox();
            // Built at FAR_UNIT metres of radius (scaled at placement).
            expect(g.boundingBox.max.x, `variant ${i}`).toBeLessThan(FAR_UNIT * 2);
            g.dispose();
        });
        sat.dispose();
        out.dispose();
    });
});
