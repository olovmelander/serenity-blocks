import { describe, expect, it } from 'vitest';
import {
    MOVEMENTS,
    RING_FORMS,
    RING_PATTERN,
    RING_PHASE_WRAP,
    SKY_REST,
    SPECTRUM_HOME,
    STEP_TRAVEL,
    hueOf,
    movementAt,
    neonColor,
    neonHue,
    ringStyle,
    skyTurnAt,
} from '../../src/themes/chromadelic-highway/chromadelic-highway-spectrum.js';

const luma = (c) => c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
const chroma = (c) => {
    const mx = Math.max(c.r, c.g, c.b);
    return (mx - Math.min(c.r, c.g, c.b)) / mx;
};
const hueGap = (a, b) => {
    const d = Math.abs(a - b) % 1;
    return Math.min(d, 1 - d);
};

/** Every ring of a session that drives through `places` places from home (one ring every 350 u). */
function* sessionRings(places, from = SPECTRUM_HOME) {
    const rings = Math.round((places * STEP_TRAVEL) / 350);
    for (let serial = 1; serial <= rings; serial++) {
        yield ringStyle(serial, from + (serial * 350) / STEP_TRAVEL);
    }
}

describe('chromadelic highway spectrum: colour law', () => {
    it('gives the named hues in the standard order (red, yellow, green, cyan, blue, magenta)', () => {
        const at = (h) => neonHue(h);
        const near = (c, [r, g, b]) => {
            expect(c.r).toBeCloseTo(r, 9);
            expect(c.g).toBeCloseTo(g, 9);
            expect(c.b).toBeCloseTo(b, 9);
        };
        near(at(0), [1, 0, 0]);
        near(at(1 / 6), [1, 1, 0]);
        near(at(1 / 3), [0, 1, 0]);
        near(at(0.5), [0, 1, 1]);
        near(at(2 / 3), [0, 0, 1]);
        near(at(5 / 6), [1, 0, 1]);
        for (let i = 0; i < 36; i++) expect(hueGap(hueOf(at(i / 36)), i / 36)).toBeLessThan(0.02);
    });

    it('keeps every hue a vivid emitter of similar presence (no grey, no blown-out blue)', () => {
        const lumas = [];
        for (let i = 0; i < 72; i++) {
            const c = neonColor(i / 72, 0.5);
            expect(chroma(c), `hue ${i * 5}°`).toBeGreaterThan(0.75);
            expect(Math.max(c.r, c.g, c.b), `hue ${i * 5}°`).toBeLessThan(2.6);
            lumas.push(luma(c));
        }
        // Yellow and blue differ 13× in raw luma; the law keeps them within ~4×.
        expect(Math.max(...lumas) / Math.min(...lumas)).toBeLessThan(4.5);
    });
});

describe('chromadelic highway spectrum: rings', () => {
    it('lets the rings take ANY colour: every 30° of the wheel is reached in one cycle', () => {
        const bins = new Set();
        for (const st of sessionRings(MOVEMENTS.length)) bins.add(Math.floor(st.hue * 12) % 12);
        expect([...bins].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    });

    it('runs the whole rainbow within the first movement (a prism run)', () => {
        expect(movementAt(SPECTRUM_HOME).movement.name).toBe('prism');
        const bins = new Set();
        for (let serial = 1; serial <= 14; serial++) bins.add(Math.floor(ringStyle(serial, SPECTRUM_HOME).hue * 6));
        expect(bins.size).toBe(6);
    });

    it('varies the forms: every pattern, round and polygon gates, and prism arcs appear', () => {
        const forms = new Set();
        const patterns = new Set();
        const shapes = new Set();
        let prisms = 0;
        for (const st of sessionRings(MOVEMENTS.length)) {
            forms.add(st.form);
            patterns.add(st.pattern);
            shapes.add(st.shape);
            prisms += st.prism;
        }
        expect(forms.size).toBeGreaterThanOrEqual(9);
        expect([...patterns].sort()).toEqual(Object.values(RING_PATTERN).sort());
        expect([...shapes].sort()).toEqual([0, 6, 8]);
        expect(prisms).toBeGreaterThan(0);
    });

    it('gives every movement more than one form and an accent on every fourth ring', () => {
        MOVEMENTS.forEach((mov, m) => {
            const forms = new Set();
            for (let serial = 0; serial < 40; serial++) {
                const st = ringStyle(serial, m + 0.5);
                expect(st.movement).toBe(m);
                forms.add(st.form);
                const list = serial % 4 === 3 ? mov.downbeat : mov.beat;
                expect(list, `${mov.name} ring ${serial}`).toContain(st.form);
            }
            expect(forms.size, mov.name).toBeGreaterThanOrEqual(2);
            [...mov.beat, ...mov.downbeat].forEach((f) => expect(RING_FORMS[f], f).toBeTruthy());
        });
    });

    it('is a pure function of (ring, place): a ring never changes style on its own', () => {
        const a = ringStyle(123, 2.37);
        const b = ringStyle(123, 2.37, {});
        expect(b.hue).toBe(a.hue);
        expect(b.form).toBe(a.form);
        expect(b.core).toEqual(a.core);
    });

    it('spins dashes and beads at multiples of 1/20 of the packet phase (seamless 40π wrap)', () => {
        expect(RING_PHASE_WRAP).toBeCloseTo(Math.PI * 40, 12);
        Object.entries(RING_FORMS).forEach(([name, f]) => {
            expect(Math.abs(f.spin * 20 - Math.round(f.spin * 20)), name).toBeLessThan(1e-9);
            // Whole dashes/beads per turn, so the pattern also closes on itself.
            expect(Number.isInteger(f.count), name).toBe(true);
        });
    });
});

describe('chromadelic highway spectrum: sky', () => {
    it('turns the nebula continuously, with no jump anywhere round the cycle', () => {
        let prev = skyTurnAt(0);
        let maxStep = 0;
        for (let p = 0.001; p <= MOVEMENTS.length + 1; p += 0.001) {
            const v = skyTurnAt(p);
            maxStep = Math.max(maxStep, Math.abs(v - prev));
            prev = v;
        }
        expect(maxStep).toBeLessThan(0.0015);
    });

    it("rests on each movement's tint in the middle of its step, and moves for most of it", () => {
        MOVEMENTS.forEach((mov, m) => expect(skyTurnAt(m + 0.5), mov.name).toBeCloseTo(mov.sky, 9));
        // Session start: the sky has come to rest on the first movement's tint.
        expect(skyTurnAt(SPECTRUM_HOME)).toBeCloseTo(MOVEMENTS[0].sky, 3);
        expect(SKY_REST).toBeLessThanOrEqual(0.15);
        // Neighbouring tints are a short turn apart (no big swing of the whole nebula).
        MOVEMENTS.forEach((mov, m) => {
            const next = MOVEMENTS[(m + 1) % MOVEMENTS.length];
            expect(Math.abs(next.sky - mov.sky), `${mov.name} → ${next.name}`).toBeLessThanOrEqual(0.14 + 1e-9);
        });
    });
});
