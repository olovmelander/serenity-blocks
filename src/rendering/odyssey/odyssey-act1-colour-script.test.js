import { describe, expect, it } from 'vitest';

import {
    MAX_HUE_RATE_DEG_PER_005P,
    ODYSSEY_ACT1_COLOUR_SCRIPT,
    ODYSSEY_COLOUR_SCRIPT,
    classifyTemperature,
    hexToOklab,
    hueDelta,
    oklabHue,
    oklabToHex,
    sampleAct1ColourScript,
    sampleColourScript,
} from './odyssey-colour-script.js';

// Earth Core's script lives in its own array on its own domain: the Act II array clamps to
// 0..1 and a shipped test pins that it spans exactly that, so there was never room below
// zero for the "extend downward" design the plan first proposed. These guards are the same
// shape as Act II's — one discipline, two acts — plus the temperature rule the Act I
// research produced, which Wave 1's capture proved is the easiest thing in this act to get
// wrong.

describe('ACT I script structure', () => {
    it('is ordered, spans 0..1 on its own parameter, and declares a medium per keyframe', () => {
        const ts = ODYSSEY_ACT1_COLOUR_SCRIPT.map((k) => k.t);
        expect(ts[0]).toBe(0);
        expect(ts[ts.length - 1]).toBe(1);
        expect([...ts].sort((a, b) => a - b)).toEqual(ts);
        ODYSSEY_ACT1_COLOUR_SCRIPT.forEach((k) => {
            expect(k.medium, `${k.name} declares a medium`).toBeTruthy();
            expect(k.name).toBeTruthy();
        });
    });

    it('never claims to be air — a cavern has no horizon to converge on', () => {
        // Act II's INVARIANT 1 exempts non-air media by design. An Act I keyframe calling
        // itself 'air' would silently opt into a convergence rule written for a sky that does
        // not exist underground.
        ODYSSEY_ACT1_COLOUR_SCRIPT.forEach((k) => {
            expect(k.medium, `${k.name} must not be air`).not.toBe('air');
        });
    });

    it('hands over to Act II at a DECLARED occlusion seam, not by adjacency', () => {
        // The two arrays are not contiguous, so continuity is asserted rather than assumed.
        // The steam quench makes the handoff invisible; these declarations make it deliberate.
        const last = ODYSSEY_ACT1_COLOUR_SCRIPT[ODYSSEY_ACT1_COLOUR_SCRIPT.length - 1];
        expect(last.name).toBe('crack');
        expect(last.warmCoolCollision, 'the crack is the declared fire/water collision').toBe(true);
        const cathedral = ODYSSEY_ACT1_COLOUR_SCRIPT.find((k) => k.name === 'cathedral');
        expect(cathedral.seamAfter, 'the swing INTO the crack is the occluded one').toBe(true);
        expect(ODYSSEY_COLOUR_SCRIPT[0].name, 'Act II still opens on the abyss').toBe('abyss');
    });
});

describe('ACT I INVARIANT 2 — hue rate limit', () => {
    it('never moves the vault hue faster than the limit outside the declared seam', () => {
        // BOTH atmospheric slots, not just the zenith Act II watches. Mutation-verified: with
        // zenith alone, removing `cathedral.seamAfter` still PASSED — the crown barely moves
        // (5.96 deg per step) while the low band swings ember-to-vapour (23.1 deg per step).
        // A guard that cannot fail when its exemption is deleted is not a guard.
        for (let i = 0; i < ODYSSEY_ACT1_COLOUR_SCRIPT.length - 1; i += 1) {
            const a = ODYSSEY_ACT1_COLOUR_SCRIPT[i];
            const b = ODYSSEY_ACT1_COLOUR_SCRIPT[i + 1];
            if (a.seamAfter) continue;
            const span = Math.max(b.t - a.t, 1e-6);
            ['skyZenith', 'skyHorizon'].forEach((slot) => {
                const drift = Math.abs(hueDelta(
                    oklabHue(hexToOklab(a[slot])),
                    oklabHue(hexToOklab(b[slot])),
                ));
                const perStep = drift / (span / 0.05);
                expect(perStep, `${a.name} -> ${b.name} (${slot})`)
                    .toBeLessThanOrEqual(MAX_HUE_RATE_DEG_PER_005P);
            });
        }
    });
});

describe('ACT I INVARIANT 3 — warm/cool exclusivity', () => {
    it('lets no keyframe hold both temperatures except the declared collision', () => {
        ODYSSEY_ACT1_COLOUR_SCRIPT.forEach((k) => {
            const { warm, cool } = classifyTemperature(k);
            if (k.warmCoolCollision) {
                // The exemption has to be EARNED: a keyframe that claims a collision must
                // actually collide, or the flag becomes a way to silence the rule.
                expect(warm.length, `${k.name} claims a collision so it needs warm`).toBeGreaterThan(0);
                expect(cool.length, `${k.name} claims a collision so it needs cool`).toBeGreaterThan(0);
                return;
            }
            expect(
                warm.length === 0 || cool.length === 0,
                `${k.name} mixes warm [${warm}] with cool [${cool}] outside a declared collision`,
            ).toBe(true);
        });
    });

    it('permits exactly one collision in the act — fire meets water once', () => {
        expect(ODYSSEY_ACT1_COLOUR_SCRIPT.filter((k) => k.warmCoolCollision)).toHaveLength(1);
    });
});

describe('ACT I FALSIFICATION — the new guards must actually discriminate', () => {
    it('rejects a cyan seed smuggled into the cathedral', () => {
        // Wave 1's failure, as a unit test: an unstarved cool accent in a magma keyframe is
        // exactly what turned the molten cathedral into a cool cave with warm decorations.
        const cathedral = ODYSSEY_ACT1_COLOUR_SCRIPT.find((k) => k.name === 'cathedral');
        const poisoned = { ...cathedral, skyZenith: 0x40a0a0 };
        const { warm, cool } = classifyTemperature(poisoned);
        expect(cool.length).toBeGreaterThan(0);
        expect(warm.length).toBeGreaterThan(0);
        expect(warm.length === 0 || cool.length === 0).toBe(false);
    });

    it('rejects a collision claim that does not collide', () => {
        const fake = {
            skyZenith: 0x0a0810,
            skyHorizon: 0x2a1208,
            sun: 0xff6a28,
            groundLit: 0x3a1c10,
            groundShadow: 0x0d0b12,
            warmCoolCollision: true,
        };
        expect(classifyTemperature(fake).cool.length, 'all-warm may not claim the exemption').toBe(0);
    });

    it('pins the rescope: Act I is sampled on its OWN parameter', () => {
        // If someone merges these keyframes back into the Act II array at negative p, the
        // shared sampler clamps and the birth frame becomes unreachable. This is that bug.
        expect(sampleColourScript(-0.1).name).toBe(ODYSSEY_COLOUR_SCRIPT[0].name);
        expect(sampleAct1ColourScript(0).name).toBe('birth');
        // `name` is the SEGMENT you are inside, `nextName` where it is heading — the same
        // contract Act II's sampler has. At t=1 you are at the end of cathedral->crack, so
        // the COLOUR is the crack's while the segment is still named for its start.
        expect(sampleAct1ColourScript(1).nextName).toBe('crack');
        const crack = ODYSSEY_ACT1_COLOUR_SCRIPT[ODYSSEY_ACT1_COLOUR_SCRIPT.length - 1];
        expect(oklabToHex(sampleAct1ColourScript(1).skyHorizonLab)).toBe(crack.skyHorizon);
    });
});

describe('ACT I sampling', () => {
    it('returns each keyframe exactly at its own t', () => {
        ODYSSEY_ACT1_COLOUR_SCRIPT.forEach((k) => {
            expect(oklabToHex(sampleAct1ColourScript(k.t).skyZenithLab), k.name).toBe(k.skyZenith);
        });
    });

    it('clamps outside 0..1 and survives garbage', () => {
        expect(sampleAct1ColourScript(-5).name).toBe('birth');
        expect(() => sampleAct1ColourScript(NaN)).not.toThrow();
        expect(sampleAct1ColourScript(undefined).skyHorizon.every(Number.isFinite)).toBe(true);
        expect(sampleAct1ColourScript(9).skyHorizon.every(Number.isFinite)).toBe(true);
    });

    it('stays in gamut across the whole rise to the crack', () => {
        for (let t = 0; t <= 1.0001; t += 0.02) {
            const s = sampleAct1ColourScript(t);
            [s.skyZenith, s.skyHorizon, s.sun, s.groundLit, s.groundShadow].forEach((c) => {
                c.forEach((ch) => {
                    expect(ch).toBeGreaterThanOrEqual(0);
                    expect(ch).toBeLessThanOrEqual(1);
                });
            });
        }
    });

    it('ends lighter than it began — the act is a rise toward the surface', () => {
        const lum = (rgb) => (0.2126 * rgb[0]) + (0.7152 * rgb[1]) + (0.0722 * rgb[2]);
        expect(lum(sampleAct1ColourScript(1).skyHorizon))
            .toBeGreaterThan(lum(sampleAct1ColourScript(0).skyHorizon));
    });
});
