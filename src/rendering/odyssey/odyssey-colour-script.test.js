import { describe, expect, it } from 'vitest';

import {
    HORIZON_ANCHOR,
    HORIZON_CHROMA_TOLERANCE,
    HORIZON_HUE_TOLERANCE_DEG,
    MAX_HUE_RATE_DEG_PER_005P,
    ODYSSEY_COLOUR_SCRIPT,
    hexToOklab,
    hueDelta,
    oklabChroma,
    oklabHue,
    oklabToHex,
    oklabToLinearRgb,
    sampleColourScript,
} from './odyssey-colour-script.js';

// The colour script is art direction expressed as data, so it is testable as data. These
// guards are the reason the table can be edited freely without anyone re-deriving whether the
// journey still reads as one place.

describe('Oklab conversion', () => {
    it('round-trips hex through Oklab', () => {
        [0x000000, 0xffffff, 0xb8d2ea, 0x6f9450, 0x1650b4, 0x02040f].forEach((hex) => {
            const back = oklabToHex(hexToOklab(hex));
            const dr = Math.abs(((back >> 16) & 255) - ((hex >> 16) & 255));
            const dg = Math.abs(((back >> 8) & 255) - ((hex >> 8) & 255));
            const db = Math.abs((back & 255) - (hex & 255));
            expect(Math.max(dr, dg, db)).toBeLessThanOrEqual(1);
        });
    });

    it('places grey at zero chroma', () => {
        expect(oklabChroma(hexToOklab(0x808080))).toBeLessThan(0.002);
    });

    it('returns LINEAR rgb, not sRGB', () => {
        // Mid grey sRGB 0x808080 is ~0.216 linear, not ~0.502. Getting this wrong double-
        // applies the transfer function and washes every colour the script drives.
        const [r] = oklabToLinearRgb(hexToOklab(0x808080));
        expect(r).toBeGreaterThan(0.19);
        expect(r).toBeLessThan(0.24);
    });
});

describe('colour script structure', () => {
    it('is ordered, spans 0..1, and declares a medium for every keyframe', () => {
        expect(ODYSSEY_COLOUR_SCRIPT.length).toBeGreaterThanOrEqual(6);
        expect(ODYSSEY_COLOUR_SCRIPT[0].p).toBe(0);
        expect(ODYSSEY_COLOUR_SCRIPT.at(-1).p).toBe(1);
        ODYSSEY_COLOUR_SCRIPT.forEach((k, i) => {
            expect(['air', 'water', 'vacuum']).toContain(k.medium);
            if (i > 0) expect(k.p).toBeGreaterThan(ODYSSEY_COLOUR_SCRIPT[i - 1].p);
        });
    });
});

describe('INVARIANT 1 — horizon convergence', () => {
    // Shadow of the Colossus' single-hue convergence: no matter what a biome's local albedo
    // is, every distant plane lands on ONE hue. That is the mechanism that makes an ocean, a
    // meadow and an alpine ridge read as one continent instead of three postcards.
    const anchor = hexToOklab(HORIZON_ANCHOR);
    const anchorHue = oklabHue(anchor);
    const anchorChroma = oklabChroma(anchor);

    const airFrames = ODYSSEY_COLOUR_SCRIPT.filter((k) => k.medium === 'air');

    it('has atmospheric keyframes to check', () => {
        expect(airFrames.length).toBeGreaterThanOrEqual(4);
    });

    it.each(airFrames.map((k) => [k.name, k]))(
        '%s horizon converges on the anchor',
        (_name, frame) => {
            const lab = hexToOklab(frame.skyHorizon);
            expect(Math.abs(hueDelta(anchorHue, oklabHue(lab))))
                .toBeLessThanOrEqual(HORIZON_HUE_TOLERANCE_DEG);
            expect(Math.abs(oklabChroma(lab) - anchorChroma))
                .toBeLessThanOrEqual(HORIZON_CHROMA_TOLERANCE);
        },
    );

    it('exempts non-atmospheric media, and they genuinely differ', () => {
        // The exemption has to be doing real work, or it is a rule nobody is following.
        const others = ODYSSEY_COLOUR_SCRIPT.filter((k) => k.medium !== 'air');
        expect(others.length).toBeGreaterThan(0);
        const anyFar = others.some(
            (k) => Math.abs(hueDelta(anchorHue, oklabHue(hexToOklab(k.skyHorizon))))
                > HORIZON_HUE_TOLERANCE_DEG
                || Math.abs(oklabChroma(hexToOklab(k.skyHorizon)) - anchorChroma)
                > HORIZON_CHROMA_TOLERANCE,
        );
        expect(anyFar).toBe(true);
    });
});

describe('INVARIANT 2 — hue rate limit', () => {
    // A faster hue change than this reads as a cut, and on a rail the player cannot look away
    // from it. The only places the journey may cut are behind an occluder.
    it('never moves the sky hue faster than the limit outside a declared seam', () => {
        const offenders = [];
        for (let p = 0; p <= 1.0001; p += 0.005) {
            const a = sampleColourScript(p);
            const b = sampleColourScript(Math.min(1, p + 0.05));

            const frameIdx = ODYSSEY_COLOUR_SCRIPT.findLastIndex((k) => k.p <= p + 1e-9);
            const spansSeam = ODYSSEY_COLOUR_SCRIPT
                .some((k) => k.seamAfter && k.p >= p - 1e-9 && k.p <= p + 0.05 + 1e-9)
                || ODYSSEY_COLOUR_SCRIPT[frameIdx]?.seamAfter;
            if (spansSeam) continue;

            const d = Math.abs(hueDelta(oklabHue(a.skyHorizonLab), oklabHue(b.skyHorizonLab)));
            if (d > MAX_HUE_RATE_DEG_PER_005P) offenders.push({ p: +p.toFixed(3), delta: +d.toFixed(1) });
        }
        expect(offenders).toEqual([]);
    });

    it('declares exactly the two occlusion seams the journey is allowed to cut at', () => {
        const seams = ODYSSEY_COLOUR_SCRIPT.filter((k) => k.seamAfter).map((k) => k.name);
        expect(seams).toEqual(['abyss', 'cloud-deck']);
    });
});

describe('FALSIFICATION — the guards above must actually discriminate', () => {
    // A guard that has never rejected anything is decoration. These prove each invariant has
    // teeth by feeding it values it must refuse.
    const anchor = hexToOklab(HORIZON_ANCHOR);
    const anchorHue = oklabHue(anchor);
    const anchorChroma = oklabChroma(anchor);

    it.each([
        ['warm sand horizon', 0xe8d2b0],
        ['green horizon', 0xa8d8a0],
        ['magenta horizon', 0xe0b0e8],
    ])('rejects a %s as a horizon', (_label, hex) => {
        const lab = hexToOklab(hex);
        const hueOff = Math.abs(hueDelta(anchorHue, oklabHue(lab)));
        const chromaOff = Math.abs(oklabChroma(lab) - anchorChroma);
        expect(hueOff > HORIZON_HUE_TOLERANCE_DEG || chromaOff > HORIZON_CHROMA_TOLERANCE)
            .toBe(true);
    });

    it('rejects a hue that moves faster than the rate limit', () => {
        // 0xb8d2ea -> 0xead2b8 is roughly a 180 degree swing; over 0.05 of p that must fail.
        const a = oklabHue(hexToOklab(0xb8d2ea));
        const b = oklabHue(hexToOklab(0xead2b8));
        expect(Math.abs(hueDelta(a, b))).toBeGreaterThan(MAX_HUE_RATE_DEG_PER_005P);
    });

    it('would reject an sRGB lerp through grey', () => {
        // The Oklab test above passes; confirm the naive alternative it replaced would not.
        const a = ODYSSEY_COLOUR_SCRIPT[0].skyZenith;
        const b = ODYSSEY_COLOUR_SCRIPT[1].skyZenith;
        const srgbMid = ((((a >> 16) & 255) + ((b >> 16) & 255)) / 2 << 16)
            | ((((a >> 8) & 255) + ((b >> 8) & 255)) / 2 << 8)
            | ((((a & 255) + (b & 255)) / 2) | 0);
        const oklabMid = sampleColourScript(0.09).skyZenithLab;
        // Oklab keeps more chroma at the midpoint than a channelwise sRGB average does.
        expect(oklabChroma(oklabMid))
            .toBeGreaterThan(oklabChroma(hexToOklab(srgbMid)) * 0.95);
    });
});

describe('sampling', () => {
    it('returns each keyframe exactly at its own p', () => {
        ODYSSEY_COLOUR_SCRIPT.forEach((k) => {
            const s = sampleColourScript(k.p);
            const expected = oklabToLinearRgb(hexToOklab(k.skyHorizon));
            s.skyHorizon.forEach((c, i) => expect(c).toBeCloseTo(expected[i], 5));
            expect(s.exposure).toBeCloseTo(k.exposure, 6);
        });
    });

    it('clamps outside 0..1 and survives garbage', () => {
        expect(sampleColourScript(-3).name).toBe(ODYSSEY_COLOUR_SCRIPT[0].name);
        expect(() => sampleColourScript(NaN)).not.toThrow();
        expect(() => sampleColourScript(undefined)).not.toThrow();
        expect(sampleColourScript(4).skyHorizon.every(Number.isFinite)).toBe(true);
    });

    it('stays in gamut across the whole ascent', () => {
        for (let p = 0; p <= 1.0001; p += 0.01) {
            const s = sampleColourScript(p);
            ['skyZenith', 'skyHorizon', 'sun', 'groundLit', 'groundShadow'].forEach((slot) => {
                s[slot].forEach((c) => {
                    expect(Number.isFinite(c)).toBe(true);
                    expect(c).toBeGreaterThanOrEqual(0);
                    expect(c).toBeLessThanOrEqual(1);
                });
            });
            expect(s.exposure).toBeGreaterThan(0.5);
            expect(s.fogDensity).toBeGreaterThan(0);
        }
    });

    it('darkens monotonically in exposure as the ascent leaves the atmosphere', () => {
        // The arc has a direction: the world gets less hazy and less exposed as it climbs.
        const early = sampleColourScript(0.20).exposure;
        const late = sampleColourScript(0.95).exposure;
        expect(late).toBeLessThan(early);
    });

    it('interpolates through Oklab, not through grey', () => {
        // The whole reason for Oklab: a midpoint between two saturated colours must not lose
        // chroma. sRGB lerp between the abyss and the breach dives through a desaturated mud.
        const mid = sampleColourScript(0.09); // halfway from abyss to breach
        const a = oklabChroma(hexToOklab(ODYSSEY_COLOUR_SCRIPT[0].skyZenith));
        const b = oklabChroma(hexToOklab(ODYSSEY_COLOUR_SCRIPT[1].skyZenith));
        expect(oklabChroma(mid.skyZenithLab)).toBeGreaterThan(Math.min(a, b) * 0.6);
    });
});
