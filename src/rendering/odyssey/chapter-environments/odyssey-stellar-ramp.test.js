import { describe, expect, it } from 'vitest';
import { STELLAR_CLASSES, pickStellarClass } from './odyssey-stellar-ramp.js';
import { createCosmicExpanseEnvironment } from './cosmic-expanse.js';

/** The chapter's own hash, so the test draws the same sequence the field does. */
function makeRng(seed) {
    let s = seed >>> 0;
    return () => {
        s = Math.imul(s ^ (s >>> 15), 2246822519);
        s = (s + 0x6d2b79f5) >>> 0;
        return ((s ^ (s >>> 13)) >>> 0) / 4294967296;
    };
}

describe('ch6 stellar ramp (Space overhaul Wave 5)', () => {
    it('is a monotonic temperature ladder', () => {
        for (let i = 1; i < STELLAR_CLASSES.length; i += 1) {
            expect(STELLAR_CLASSES[i].kelvin).toBeGreaterThan(STELLAR_CLASSES[i - 1].kelvin);
        }
    });

    it('keeps every class on the blackbody locus — normalised, never invented', () => {
        // Each entry is a real blackbody colour scaled so its brightest channel is 1.0.
        // If someone hand-tunes one to taste, its max channel drifts off 1 and this fires.
        STELLAR_CLASSES.forEach((cls) => {
            expect(Math.max(...cls.color)).toBeCloseTo(1.0, 6);
            cls.color.forEach((c) => expect(c).toBeGreaterThan(0));
        });
        // ...and the locus runs the right way: cool classes are red-dominant, hot ones
        // blue-dominant, crossing over near the sun's 5800 K.
        const m = STELLAR_CLASSES[0];
        const b = STELLAR_CLASSES[STELLAR_CLASSES.length - 1];
        expect(m.color[0]).toBeGreaterThan(m.color[2]);
        expect(b.color[2]).toBeGreaterThan(b.color[0]);
    });

    it('pushes the hot end past 1.0 and holds the cool end under it', () => {
        // The emissive push is what gives the field hierarchy — hot pinpoints clip into
        // bloom, cool ones stay quiet. A flat table of 1.0s would render the mush the
        // ramp was written to replace.
        const hot = STELLAR_CLASSES.filter((c) => c.kelvin >= 7000);
        const cool = STELLAR_CLASSES.filter((c) => c.kelvin < 5800);
        expect(hot.every((c) => c.emissive > 1.0)).toBe(true);
        expect(cool.every((c) => c.emissive < 1.0)).toBe(true);
    });

    it('makes red giants BIG and SOFT — the size/core split that tells them apart', () => {
        // This is the law that separates a rare M giant from a near blue-white. Size
        // alone would just make a bigger pinpoint; the core gain is what makes it soft.
        const byId = Object.fromEntries(STELLAR_CLASSES.map((c) => [c.id, c]));
        expect(byId.M.sizeGain).toBe(Math.max(...STELLAR_CLASSES.map((c) => c.sizeGain)));
        expect(byId.M.coreGain).toBe(Math.min(...STELLAR_CLASSES.map((c) => c.coreGain)));
        expect(byId.B.coreGain).toBe(Math.max(...STELLAR_CLASSES.map((c) => c.coreGain)));
    });

    it('draws in proportion to the weights, and always returns a real class', () => {
        const rng = makeRng(4242);
        const counts = Object.fromEntries(STELLAR_CLASSES.map((c) => [c.id, 0]));
        const N = 40000;
        for (let i = 0; i < N; i += 1) {
            const cls = pickStellarClass(rng);
            expect(STELLAR_CLASSES).toContain(cls);
            counts[cls.id] += 1;
        }
        const total = STELLAR_CLASSES.reduce((s, c) => s + c.weight, 0);
        STELLAR_CLASSES.forEach((cls) => {
            expect(counts[cls.id] / N).toBeCloseTo(cls.weight / total, 1);
        });
    });

    it('paints a sky, not a volume — white and blue-white dominate', () => {
        // A real volume is overwhelmingly M dwarfs. This field paints what a viewer sees,
        // so the weights must stay sky-shaped; swapping in a mass function would make the
        // near tier a field of dim amber dots.
        const share = (pred) => STELLAR_CLASSES.filter(pred).reduce((s, c) => s + c.weight, 0)
            / STELLAR_CLASSES.reduce((s, c) => s + c.weight, 0);
        expect(share((c) => c.kelvin >= 7000)).toBeGreaterThan(0.55);
        expect(share((c) => c.kelvin <= 4500)).toBeLessThan(0.25);
    });
});

describe('ch6 star field wiring (Space overhaul Wave 5)', () => {
    it('carries the core gain in the colour alpha, not a fifth vertex buffer', () => {
        // The geometry already binds position/normal/uv + 4 instanced attributes and 8 is
        // the vertex-buffer ceiling, so coreGain travels in aColor.w. Widening this back
        // to vec3 plus a separate aCore would overflow on some backends.
        const group = createCosmicExpanseEnvironment({ particleCount: 200 });
        const stars = group.userData.starsNear;
        const aColor = stars.geometry.getAttribute('aColor');
        expect(aColor.itemSize).toBe(4);

        // fround, because the authored doubles are stored into a Float32Array: 1.1 comes
        // back as 1.100000023841858 and a naive equality would fail on a correct field.
        const gains = new Set(STELLAR_CLASSES.map((c) => Math.fround(c.coreGain)));
        const seen = new Set();
        for (let i = 0; i < aColor.count; i += 1) seen.add(aColor.array[i * 4 + 3]);
        seen.forEach((g) => expect(gains).toContain(g));
        // The field must actually SPREAD across the ladder, not collapse onto one class.
        expect(seen.size).toBeGreaterThan(2);
    });

    it('is seeded — two builds of the same tier are byte-identical', () => {
        // Under bare Math.random the whole field re-rolled on every reload, which made
        // every capture A/B of this chapter incomparable (the lesson the asteroid garland
        // paid for in e9ccc0f6). This is the assertion that keeps it fixed.
        const a = createCosmicExpanseEnvironment({ particleCount: 200 });
        const b = createCosmicExpanseEnvironment({ particleCount: 200 });
        const grab = (g, key) => Array.from(g.userData[key].geometry.getAttribute('aBase').array);
        expect(grab(a, 'starsNear')).toEqual(grab(b, 'starsNear'));
        expect(grab(a, 'starsFar')).toEqual(grab(b, 'starsFar'));
        // ...and the two TIERS must differ, or one seed is feeding both.
        expect(grab(a, 'starsNear')).not.toEqual(grab(a, 'starsFar'));
    });
});
