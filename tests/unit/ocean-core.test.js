import { describe, expect, it } from 'vitest';
import {
    AMBIENT_EVERY, AMBIENT_FIRST, CALLS, EYE, LANES, NEVER, PASS_SECONDS, STAIN_FADE, STAIN_KINDLE, SURFACE, SURGE_SPEED,
    WINDOW_INDEX, ambientPass, approach, channelAxis, fovForAspect, footprintFloor, mantasForCombo, passAt, pieceColor,
    powerForCombo, refractToAir, ringRadius, scareEnvelope, schoolLoop, seabedHeight, seabedNormal, squeezeFor,
    stainLight, surgeFront, surgePassTime,
} from '../../src/themes/ocean/ocean-core.js';

const len = (v) => Math.hypot(v[0], v[1], v[2]);

describe('Ocean core: the rig', () => {
    it('holds its horizontal lens: a tall frame gets a taller lens, within the rig\'s limits', () => {
        expect(fovForAspect(16 / 9)).toBeLessThan(fovForAspect(4 / 3));
        expect(fovForAspect(390 / 844)).toBe(EYE.maxFov);
        expect(fovForAspect(32 / 9)).toBeGreaterThanOrEqual(EYE.minFov);
        expect(fovForAspect(Number.NaN)).toBe(fovForAspect(16 / 9));
    });

    it('draws the stage in on a narrow frame and leaves a wide one as built', () => {
        expect(squeezeFor(16 / 9)).toBe(1);
        expect(squeezeFor(390 / 844)).toBeLessThan(0.7);
        expect(squeezeFor(0.1)).toBeGreaterThanOrEqual(0.34);
        expect(approach(2, 0)).toBe(0);
        expect(approach(2, 10)).toBeCloseTo(1, 6);
    });
});

describe('Ocean core: the light through the surface', () => {
    it('sends a ray straight up straight on, and every ray out as a unit vector', () => {
        const up = refractToAir([0, 1, 0]);
        expect(up[1]).toBeCloseTo(1, 6);
        for (let e = 10; e <= 90; e += 10) {
            const a = (e * Math.PI) / 180;
            const out = refractToAir([0, Math.sin(a), -Math.cos(a)]);
            expect(len(out)).toBeCloseTo(1, 6);
            expect(out[1]).toBeGreaterThanOrEqual(0);
        }
    });

    it('bends a ray away from the vertical, and lays one past the window\'s edge on the horizon', () => {
        const a = (60 * Math.PI) / 180;
        const out = refractToAir([0, Math.sin(a), -Math.cos(a)]);
        expect(Math.asin(out[1])).toBeLessThan(a);
        const edge = Math.asin(Math.sqrt(1 - 1 / (WINDOW_INDEX * WINDOW_INDEX)));
        const past = refractToAir([0, Math.sin(edge * 0.8), -Math.cos(edge * 0.8)]);
        expect(past[1]).toBe(0);
        expect(past[2]).toBeCloseTo(-1, 6);
    });
});

describe('Ocean core: the seabed', () => {
    it('is finite everywhere the sheet reaches, under the surface', () => {
        for (let x = -54; x <= 54; x += 3) {
            for (let z = -118; z <= 15; z += 3) {
                const h = seabedHeight(x, z);
                expect(Number.isFinite(h)).toBe(true);
                expect(h).toBeLessThan(SURFACE - 3 + 1e-9);
            }
        }
    });

    it('lies low in the channel and rises onto both shoulders', () => {
        for (let z = -30; z <= 0; z += 5) {
            const middle = seabedHeight(channelAxis(z), z);
            expect(seabedHeight(channelAxis(z) - 16, z)).toBeGreaterThan(middle + 2);
            expect(seabedHeight(channelAxis(z) + 16, z)).toBeGreaterThan(middle + 2);
        }
    });

    it('has a unit normal that faces up, and seats a footprint on its lowest ground', () => {
        const n = seabedNormal(8, -6);
        expect(len(n)).toBeCloseTo(1, 6);
        expect(n[1]).toBeGreaterThan(0);
        expect(footprintFloor(8, -6, 1.5)).toBeLessThanOrEqual(seabedHeight(8, -6));
    });
});

describe('Ocean core: what the board starts', () => {
    it('widens a ring as it ages, slower and slower', () => {
        expect(ringRadius(0)).toBe(0);
        const a = ringRadius(0.5);
        const b = ringRadius(1);
        const c = ringRadius(1.5);
        expect(b).toBeGreaterThan(a);
        expect(c - b).toBeLessThan(b - a);
        expect(ringRadius(1, 2) - 0.25).toBeCloseTo((ringRadius(1, 1) - 0.25) * 2, 6);
    });

    it('kindles a held colour, holds it, flares it as it is let go and puts it out', () => {
        expect(stainLight(10, NEVER, 9)).toBe(0);
        const held = stainLight(10, NEVER, 10 + STAIN_KINDLE + 5);
        expect(held).toBeCloseTo(1, 2);
        const flare = stainLight(10, 20, 20.05);
        expect(flare).toBeGreaterThan(held * 1.5);
        expect(stainLight(10, 20, 20 + STAIN_FADE)).toBe(0);
    });

    it('sends a current across the frame at its speed, and reaches every x when its front does', () => {
        [-1, 1].forEach((dir) => {
            expect(surgeFront(0, dir)).toBeCloseTo(-dir * 30, 6);
            const x = 7;
            const at = surgePassTime(4, dir, x);
            expect(surgeFront(at - 4, dir)).toBeCloseTo(x, 6);
            expect(surgePassTime(4, dir, x + dir)).toBeCloseTo(at + 1 / SURGE_SPEED, 6);
        });
    });

    it('startles a fish at once, holds it a breath and lets it drift back', () => {
        expect(scareEnvelope(0)).toBe(0);
        expect(scareEnvelope(0.3)).toBeGreaterThan(0.95);
        expect(scareEnvelope(3)).toBeLessThan(0.1);
    });

    it('charges with the chain, never past full', () => {
        let last = -1;
        for (let n = 0; n < 30; n++) {
            const p = powerForCombo(n);
            expect(p).toBeGreaterThan(last);
            expect(p).toBeLessThan(1);
            last = p;
        }
        expect(powerForCombo(-3)).toBe(0);
    });

    it('calls the large animals in order, one more with each step of the chain', () => {
        expect(CALLS.turtle).toBeLessThan(CALLS.mantas);
        expect(CALLS.mantas).toBeLessThan(CALLS.whaleFar);
        expect(CALLS.whaleFar).toBeLessThan(CALLS.whale);
        expect(mantasForCombo(CALLS.mantas - 1)).toBe(0);
        expect(mantasForCombo(CALLS.mantas)).toBe(1);
        expect(mantasForCombo(40)).toBe(3);
    });
});

describe('Ocean core: the large animals\' passes', () => {
    it('comes in from one side of the frame and goes out at the other, out of sight at both ends', () => {
        Object.entries(LANES).forEach(([, lane]) => {
            const a = passAt(0, lane);
            const b = passAt(1, lane);
            expect(Math.sign(a.x)).toBe(lane.side);
            expect(Math.sign(b.x)).toBe(-lane.side);
            // Out of the widest frame: further sideways than the lens sees at that distance.
            const reach = Math.tan((52 * Math.PI) / 180);
            [a, b].forEach((p) => expect(Math.abs(p.x)).toBeGreaterThan(reach * (EYE.z - p.z)));
        });
    });

    it('heads the way it is going', () => {
        Object.values(LANES).forEach((lane) => {
            for (let k = 0.1; k < 0.95; k += 0.2) {
                const p = passAt(k, lane);
                const q = passAt(k + 0.001, lane);
                const fwd = [Math.sin(p.yaw), -Math.cos(p.yaw)];
                const moved = [q.x - p.x, q.z - p.z];
                expect(fwd[0] * moved[0] + fwd[1] * moved[1]).toBeGreaterThan(0);
            }
        });
    });

    it('sends one of the sea\'s own passes at a time, in turn, from the first one on', () => {
        expect(ambientPass(AMBIENT_FIRST - 1).kind).toBe('none');
        const kinds = new Set();
        for (let t = AMBIENT_FIRST; t < AMBIENT_FIRST + AMBIENT_EVERY * 6; t += 1) {
            const p = ambientPass(t);
            if (p.k >= 0) {
                expect(p.k).toBeLessThanOrEqual(1);
                kinds.add(p.kind);
                expect(PASS_SECONDS[p.kind]).toBeLessThanOrEqual(AMBIENT_EVERY);
            }
        }
        expect([...kinds].sort()).toEqual(['manta', 'turtle', 'whaleFar']);
    });

    it('keeps the school\'s loop in the water, over the sand', () => {
        for (let p = 0; p < Math.PI * 2; p += 0.1) {
            const at = schoolLoop(p);
            expect(at[1]).toBeGreaterThan(seabedHeight(at[0], at[2]) + 1.5);
            expect(at[1]).toBeLessThan(SURFACE - 2);
        }
    });
});

describe('Ocean core: colour', () => {
    it('turns a piece colour into light with its brightest channel near 1, and anything else into the fallback', () => {
        const rose = pieceColor('#FF6B81');
        expect(Math.max(...rose)).toBeCloseTo(1, 6);
        expect(rose[0]).toBeGreaterThan(rose[2]);
        expect(pieceColor('not a colour')).toEqual(pieceColor(null));
        expect(pieceColor([0, 0, 0]).every(Number.isFinite)).toBe(true);
    });
});
