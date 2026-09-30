import { describe, expect, it } from 'vitest';

import {
    ARC_MODE,
    ARC_SLOT,
    BURST_MODE,
    PARHELION_CLOCK_RATES,
    PARHELION_LUMEN_RETURN,
    PARHELION_OPTICS_CAPS,
    PARHELION_OPTICS_IDLE,
    PARHELION_OPTICS_TIERS,
    PARHELION_TIMING,
    ParhelionOpticsState,
    envelopeValue,
    hushIntegral,
    hushWeight,
    resolveOpticsTierCaps,
    screenYToPillarV,
} from '../../src/themes/parhelion/sim/parhelion-optics-state.js';
import { CUE } from '../../src/themes/parhelion/sim/parhelion-reaction-director.js';
import {
    DEFAULT_LAYOUT,
    MEASURED_VIEWPORTS,
    PILLAR,
    projectWorld,
    rowToPhi,
    stationPhi,
    writePillarPlaces,
} from '../../src/playground/effects/parhelion-composition.js';

/**
 * Parhelion optics state (§7.2–§7.7, §8, §12 optics bullets). Every beat is scheduled as
 * numbers with absolute births, so these tests drive the state with explicit `now` values and
 * read the flat `out` object the shaders consume: nothing here needs three or a GPU.
 */

const FRAME = 1 / 60;
const HALF_PI = Math.PI / 2;

function makeCue(overrides = {}) {
    return {
        kind: CUE.LOCK,
        player: 0,
        primary: true,
        sx: -1,
        sy: -1,
        rowV: 0.8,
        lockU: 0.3,
        lockV: 0.8,
        lines: 0,
        combo: 0,
        cascade: 1,
        depth: 0,
        strength: 1,
        reducedMotion: false,
        lockCount: 1,
        b2b: false,
        echoOf: CUE.NONE,
        ...overrides,
    };
}

function soloLayout(vp = DEFAULT_LAYOUT) {
    return {
        card: vp.card,
        board: vp.board,
        queue: vp.next,
        hud: vp.hud,
        aspect: vp.aspect,
    };
}

function createState(tier = 'High', layout = soloLayout()) {
    const state = new ParhelionOpticsState(tier);
    state.setLayout(layout);
    return state;
}

/** Plain copy of `out` (dirty flags excluded: they record upload timing, not the frame). */
function snapshot(out) {
    const copy = {};
    for (const key of Object.keys(out)) {
        if (key.endsWith('Dirty')) continue;
        const value = out[key];
        if (ArrayBuffer.isView(value)) copy[key] = Array.from(value);
        else if (value && typeof value === 'object') copy[key] = { ...value };
        else copy[key] = value;
    }
    return copy;
}

/** Steps `update()` over [from, to] at a fixed dt, applying scheduled cues at their exact times. */
function play(state, from, to, schedule = [], dt = FRAME) {
    const steps = Math.round((to - from) / dt);
    let next = 0;
    let out = null;
    for (let i = 0; i <= steps; i++) {
        const t = from + i * dt;
        while (next < schedule.length && schedule[next].t <= t + 1e-9) {
            const entry = schedule[next];
            if (entry.count) state.applyCount(entry.count, entry.t);
            else state.applyCue(entry.cue, entry.t);
            next += 1;
        }
        out = state.update(t, i === 0 ? 0 : dt);
    }
    return out;
}

function liveBursts(state, player, now) {
    let count = 0;
    for (let i = 0; i < state.caps.burstSlots; i++) {
        if (state.burstOwner[i] === player && now < state.burstEnd[i]) count += 1;
    }
    return count;
}

function burstBirthsOf(state, player, now) {
    const births = [];
    for (let i = 0; i < state.caps.burstSlots; i++) {
        if (state.burstOwner[i] === player && now < state.burstEnd[i]) births.push(state.burstBirth[i]);
    }
    return births.sort((a, b) => a - b);
}

function smoothstep(e0, e1, x) {
    const u = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
    return u * u * (3 - 2 * u);
}

describe('Parhelion optics helpers (§7.2)', () => {
    it('evaluates the envelope: silent before a (future) birth, eased attack, hold, exponential tail', () => {
        expect(envelopeValue(0.99, 1, 0.2, 0.3, 0.5, 2)).toBe(0);
        expect(envelopeValue(1, 1, 0.2, 0.3, 0.5, 2)).toBe(0);
        expect(envelopeValue(1.1, 1, 0.2, 0.3, 0.5, 2)).toBeCloseTo(1, 12);
        expect(envelopeValue(1.2, 1, 0.2, 0.3, 0.5, 2)).toBe(2);
        expect(envelopeValue(1.49, 1, 0.2, 0.3, 0.5, 2)).toBe(2);
        expect(envelopeValue(2.0, 1, 0.2, 0.3, 0.5, 2)).toBeCloseTo(2 * Math.exp(-1), 12);
        expect(envelopeValue(5, 1, 0, 0, 0.5, -0.4)).toBeCloseTo(-0.4 * Math.exp(-8), 12);
    });

    it('integrates the Clear Sky hush in closed form (matches a fine Riemann sum, continuous)', () => {
        const h = 1e-5;
        let sum = 0;
        let x = 0;
        for (const probe of [0.05, 0.15, 0.2, 0.35, 0.5, 0.8, 0.95, 1.5]) {
            while (x < probe - h / 2) {
                sum += hushWeight(x + h / 2) * h;
                x += h;
            }
            expect(hushIntegral(probe), `x ${probe}`).toBeCloseTo(sum, 6);
        }
        expect(hushWeight(0.25)).toBe(1);
        expect(hushWeight(PARHELION_TIMING.reveal + PARHELION_TIMING.hushOut + 0.01)).toBe(0);
        expect(hushIntegral(10)).toBeCloseTo(0.075 + 0.2 + 0.3, 12);
    });

    it('inverts the rest-camera projection for pillar knots at every lane', () => {
        const places = writePillarPlaces(16 / 9, new Float32Array(PILLAR.COUNT * 4));
        const scr = { x: 0, y: 0, depth: 0 };
        for (let lane = 0; lane < PILLAR.COUNT; lane++) {
            const x = places[lane * 4];
            const z = places[lane * 4 + 1];
            for (const v of [0, 0.1, 0.35, 0.7, 1]) {
                projectWorld({ x, y: v * PILLAR.HEIGHT, z }, 16 / 9, scr);
                expect(screenYToPillarV(scr.y, z)).toBeCloseTo(v, 5);
            }
        }
    });

    it('resolves tier caps by name or partial override, with §7.7 pools', () => {
        expect(resolveOpticsTierCaps('minimal')).toBe(PARHELION_OPTICS_TIERS.Minimal);
        expect(resolveOpticsTierCaps('nonsense')).toBe(PARHELION_OPTICS_TIERS.High);
        expect(resolveOpticsTierCaps({ name: 'Low', perSlot: 12 })).toMatchObject({
            name: 'Low', burstSlots: 6, perSlot: 12, pillars: 6, crown: false, lowitz: false,
        });
        const pools = Object.values(PARHELION_OPTICS_TIERS).map((t) => `${t.burstSlots}x${t.perSlot}/${t.pillars}`);
        expect(pools).toEqual(['4x16/4', '6x16/6', '8x16/6', '8x24/6', '8x32/6', '10x32/6']);
        const minimal = new ParhelionOpticsState('Minimal');
        expect(minimal.out.burstA.length).toBe(16);
        expect(minimal.out.pillarCount).toBe(4);
        const extreme = new ParhelionOpticsState('Extreme');
        expect(extreme.out.burstD.length).toBe(40);
        expect(extreme.out.arcs.length).toBe(PARHELION_OPTICS_CAPS.arcSlots * 4);
        expect(extreme.out.pillars.length).toBe(24);
    });
});

describe('Parhelion optics determinism (§7.2, §8)', () => {
    const vp = MEASURED_VIEWPORTS[3];
    const schedule = [
        { t: 0.5, cue: makeCue({ kind: CUE.LOCK, lockCount: 1 }) },
        {
            t: 0.9,
            cue: makeCue({
                kind: CUE.STONEFALL, lockCount: 2, lockU: 0.8, strength: 0.8,
            }),
        },
        {
            t: 1.2,
            cue: makeCue({
                kind: CUE.CLEAR, lines: 3, rowV: 0.95, lockU: 0.7,
            }),
        },
        {
            t: 1.6,
            cue: makeCue({
                kind: CUE.QUAD, lines: 4, rowV: 1, b2b: true,
            }),
        },
        {
            t: 1.78,
            cue: makeCue({
                kind: CUE.ECHO, echoOf: CUE.QUAD, lines: 4, rowV: 1, strength: 0.5,
            }),
        },
        {
            t: 2.1,
            cue: makeCue({
                kind: CUE.TSPIN, lines: 2, lockU: 0.2, lockV: 0.6,
            }),
        },
        { t: 2.4, count: 12 },
        {
            t: 2.9,
            cue: makeCue({
                kind: CUE.APEX, lines: 2, combo: 10, player: 2, primary: false,
            }),
        },
        { t: 3.3, cue: makeCue({ kind: CUE.PERFECT, lines: 4 }) },
    ];
    const END = 6;

    function history(state) {
        state.setLayout(soloLayout(vp));
        state.setResonance(0.5);
        state.setLevel(4, 0.25);
    }

    it('gives the same out for the same cue history and the same t', () => {
        const a = createState();
        const b = createState();
        history(a);
        history(b);
        let from = 0;
        for (const probe of [1.0, 1.7, 2.5, 3.5, END]) {
            const start = from;
            const pending = schedule.filter((e) => start === 0 || e.t > start + 1e-9);
            const outA = snapshot(play(a, start, probe, pending));
            const outB = snapshot(play(b, start, probe, pending));
            expect(outA).toEqual(outB);
            from = probe;
        }
        expect(a.out.arcCount).toBe(b.out.arcCount);
    });

    it('reaches the same frame by seek(t) as by frame-stepping (captures are frame-exact)', () => {
        const stepped = createState();
        history(stepped);
        const probe = 3.3 + 0.25; // inside the Clear Sky hush: the clock is nearly frozen
        const steps = Math.round(probe / FRAME);
        const target = steps * FRAME;
        const outA = snapshot(play(stepped, 0, target, schedule));

        const seeked = createState();
        history(seeked);
        for (const entry of schedule) {
            if (entry.t > target) break;
            if (entry.count) seeked.applyCount(entry.count, entry.t);
            else seeked.applyCue(entry.cue, entry.t);
        }
        seeked.seek(target);
        const outB = snapshot(seeked.update(target, 0));

        const { clocks: clocksA, ...restA } = outA;
        const { clocks: clocksB, ...restB } = outB;
        expect(restA).toEqual(restB);
        for (const key of Object.keys(clocksA)) {
            expect(clocksB[key], key).toBeCloseTo(clocksA[key], 9);
        }
        expect(clocksA.dustClockRate).toBeCloseTo(PARHELION_CLOCK_RATES.hush, 9);
    });

    it('keeps the out object and every array identical across frames (no per-frame allocation)', () => {
        const state = createState();
        const out = state.update(0, 0);
        const refs = {};
        for (const key of Object.keys(out)) {
            if (out[key] && typeof out[key] === 'object') refs[key] = out[key];
        }
        expect(Object.keys(refs).length).toBeGreaterThanOrEqual(14);
        let t = 0;
        for (let frame = 0; frame < 600; frame++) {
            t += FRAME;
            if (frame % 37 === 0) {
                const kinds = [CUE.LOCK, CUE.CLEAR, CUE.QUAD, CUE.TSPIN, CUE.APEX, CUE.PERFECT, CUE.ECHO];
                state.applyCue(makeCue({ kind: kinds[frame % kinds.length], lines: 2, echoOf: CUE.QUAD }), t);
            }
            expect(state.update(t, FRAME)).toBe(out);
        }
        for (const key of Object.keys(refs)) expect(out[key], key).toBe(refs[key]);
    });

    it('flags burst uploads for exactly one frame after a write', () => {
        const state = createState();
        state.update(0, 0);
        expect(state.update(FRAME, FRAME).burstDirty).toBe(false);
        state.applyCue(makeCue({ kind: CUE.CLEAR, lines: 1 }), 0.05);
        expect(state.update(0.05, FRAME).burstDirty).toBe(true);
        expect(state.update(0.07, FRAME).burstDirty).toBe(false);
    });
});

describe('Parhelion QUAD "The Halo Closes" (§7.4)', () => {
    it('keeps the meet channels at rest until +0.85 s, then fires UTA, sun pillar, ring flash and prism', () => {
        const rest = createState();
        const quad = createState();
        const t0 = 10;
        quad.applyCue(makeCue({ kind: CUE.QUAD, lines: 4, rowV: 0.95 }), t0);
        const meet = t0 + PARHELION_TIMING.quadMeet;
        expect(PARHELION_TIMING.quadMeet).toBe(0.85);
        const peak = {
            uta: 0, pillar: 0, flash: 0, prism: 0,
        };
        for (let t = t0; t <= t0 + 2; t += 0.01) {
            const a = rest.update(t, 0.01);
            const b = quad.update(t, 0.01);
            const uta = b.k0[3] - a.k0[3];
            const pillar = b.k1[1] - a.k1[1];
            if (t <= meet) {
                expect(uta, `uta t+${(t - t0).toFixed(2)}`).toBe(0);
                expect(pillar).toBe(0);
                expect(b.ringFlash).toBe(0);
                expect(b.prism).toBe(0);
                expect(b.shake.yawDeg).toBe(0);
                expect(b.bloomKick).toBe(0);
            } else {
                peak.uta = Math.max(peak.uta, uta);
                peak.pillar = Math.max(peak.pillar, pillar);
                peak.flash = Math.max(peak.flash, b.ringFlash);
                peak.prism = Math.max(peak.prism, b.prism);
            }
        }
        expect(peak.uta).toBeGreaterThan(0.9);
        expect(peak.pillar).toBeGreaterThan(0.9);
        expect(peak.flash).toBeGreaterThan(0.9);
        expect(peak.prism).toBeGreaterThan(0.9);
    });

    it('climbs the bead pair from the cleared rows (below the horizon) to the apex at the meet', () => {
        const state = createState();
        const t0 = 4;
        state.applyCue(makeCue({ kind: CUE.QUAD, lines: 4, rowV: 1 }), t0);
        const phi0 = rowToPhi(1, DEFAULT_LAYOUT.board);
        let out = state.update(t0 + 0.02, FRAME);
        expect(out.arcCount).toBeGreaterThanOrEqual(1);
        expect(out.arcs[3]).toBe(ARC_MODE.PAIR);
        expect(out.arcs[0]).toBeCloseTo(phi0, 3);
        expect(out.arcs[0]).toBeLessThan(-0.5);
        out = state.update(t0 + 0.3, FRAME);
        expect(out.arcs[0]).toBeLessThan(0); // still glitter low on the ring
        out = state.update(t0 + PARHELION_TIMING.quadMeet, FRAME);
        expect(out.arcs[0]).toBeCloseTo(HALF_PI, 5);
        expect(out.arcs[1]).toBeCloseTo(1.0, 5);
        // Four pillars stand from the meet, staggered 0/80/160/240 ms, life 1.8 s.
        for (let lane = 0; lane < 4; lane++) {
            expect(out.pillars[lane * 4]).toBeCloseTo(t0 + 0.85 + lane * 0.08, 4);
            expect(out.pillars[lane * 4 + 1]).toBeCloseTo(1, 6);
            expect(out.pillars[lane * 4 + 3]).toBeCloseTo(1.8, 6);
        }
        expect(out.pillars[4 * 4 + 1]).toBe(0);
        // Shake 0.12° for 150 ms from the meet.
        const shaken = state.update(t0 + 0.85 + 0.01, FRAME);
        expect(Math.abs(shaken.shake.yawDeg)).toBeGreaterThan(0);
        expect(Math.abs(shaken.shake.yawDeg)).toBeLessThanOrEqual(0.12);
        expect(state.update(t0 + 0.85 + 0.16, FRAME).shake.yawDeg).toBe(0);
    });

    it('escalates the arc peak through the ladder: Wakes < Rise < Run < Turn < Closes', () => {
        const cues = [
            makeCue({ kind: CUE.CLEAR, lines: 1 }),
            makeCue({ kind: CUE.CLEAR, lines: 2 }),
            makeCue({ kind: CUE.CLEAR, lines: 3 }),
            makeCue({ kind: CUE.TSPIN, lines: 1 }),
            makeCue({ kind: CUE.QUAD, lines: 4 }),
        ];
        const peaks = cues.map((cue) => {
            const state = createState();
            state.applyCue(cue, 1);
            let peak = 0;
            for (let t = 1; t < 3; t += 0.01) {
                const out = state.update(t, 0.01);
                for (let i = 0; i < out.arcCount; i++) peak = Math.max(peak, out.arcs[i * 4 + 1]);
            }
            return peak * 3; // ph_arcGlow's ×3 → the §7.5 HDR peaks
        });
        expect(peaks[0]).toBeCloseTo(1.5, 6);
        expect(peaks[1]).toBeCloseTo(1.95, 6);
        expect(peaks[2]).toBeCloseTo(2.4, 6);
        expect(peaks[3]).toBeCloseTo(2.7, 6);
        expect(peaks[4]).toBeCloseTo(3.0, 6);
    });
});

describe('Parhelion Clear Sky (§7.4 PERFECT, §8 clocks)', () => {
    it('eases the dust clock to 0.04 in the hush, then back to 1 over 600 ms from the reveal', () => {
        const state = createState();
        const t0 = 20;
        state.seek(t0);
        state.update(t0, 0);
        state.applyCue(makeCue({ kind: CUE.PERFECT, lines: 4 }), t0);
        const clock = [];
        const rate = [];
        for (let i = 1; i <= 150; i++) {
            const out = state.update(t0 + i * FRAME, FRAME);
            clock[i] = out.clocks.dustClock;
            rate[i] = out.clocks.dustClockRate;
            if (i > 1) expect(clock[i], `frame ${i}`).toBeGreaterThan(clock[i - 1]); // never backwards
        }
        // Frames 12 and 18 are +0.2 s and +0.3 s: inside the hold.
        expect(rate[12]).toBeCloseTo(PARHELION_CLOCK_RATES.hush, 9);
        expect(rate[18]).toBeCloseTo(0.04, 9);
        expect(clock[18] - clock[12]).toBeCloseTo(0.04 * 0.1, 9);
        expect(rate[39]).toBeGreaterThan(0.1); // +0.65 s: easing back
        expect(rate[39]).toBeLessThan(0.95);
        expect(rate[60]).toBe(1); // +1.0 s: back to 1
        expect(clock[150] - clock[90]).toBeCloseTo(1, 9);
        // The freeze never jumps: the clock lags wall time by exactly the integrated dip.
        expect(clock[150]).toBeCloseTo(t0 + 150 * FRAME - 0.96 * hushIntegral(10), 9);
    });

    it('never runs the dust clock backwards across a clamped hitch inside the hush', () => {
        const state = createState();
        state.update(5, 0);
        state.applyCue(makeCue({ kind: CUE.PERFECT, lines: 4 }), 5);
        const before = state.update(5.1, FRAME).clocks.dustClock;
        const after = state.update(5.6, 0.5).clocks.dustClock; // dt is clamped to 0.1
        expect(after).toBeGreaterThanOrEqual(before);
    });

    it('dims the display and silences the reveal until +0.35 s', () => {
        const rest = createState();
        const state = createState();
        const t0 = 3;
        state.applyCue(makeCue({ kind: CUE.PERFECT, lines: 4 }), t0);
        for (let t = t0; t < t0 + PARHELION_TIMING.reveal - 1e-6; t += 0.01) {
            const a = rest.update(t, 0.01);
            const b = state.update(t, 0.01);
            for (let i = 0; i < 3; i++) expect(b.k0[i] - a.k0[i]).toBe(0);
            expect(b.k1[1] - a.k1[1]).toBe(0);
            expect(b.shower).toBe(0);
        }
        rest.update(t0 + 0.25, 0.01);
        expect(state.update(t0 + 0.25, 0.01).displayDim).toBeCloseTo(0.55, 6);
        const reveal = state.update(t0 + 0.6, 0.01);
        expect(reveal.displayDim).toBeGreaterThan(0.95);
        expect(reveal.k0[1]).toBeGreaterThan(1.8);
        expect(reveal.crossArm).toBeGreaterThan(0.7);
        expect(reveal.shower).toBeGreaterThan(0.3);
        expect(reveal.rim).toBeGreaterThan(1.5);
        expect(reveal.rim).toBeLessThanOrEqual(1.9);
    });

    it('returns the arcs in rarity order: Lowitz first … the ring and the hounds last', () => {
        const rest = createState();
        const state = createState();
        const t0 = 7;
        state.applyCue(makeCue({ kind: CUE.PERFECT, lines: 4 }), t0);
        const channels = {
            lowitz: (o) => o.k1[2],
            crown: (o) => o.k1[0],
            uta: (o) => o.k0[3],
            parhelic: (o) => o.k0[2],
            crossArm: (o) => o.crossArm,
            sunPillar: (o) => o.k1[1],
            ring: (o) => o.k0[0],
            dogs: (o) => o.k0[1],
        };
        const peak = {};
        const halfGone = {};
        const samples = [];
        for (let t = t0; t <= t0 + 8; t += 0.01) {
            const a = snapshot(rest.update(t, 0.01));
            const b = snapshot(state.update(t, 0.01));
            samples.push({ t: t - t0, a, b });
        }
        for (const [name, read] of Object.entries(channels)) {
            peak[name] = 0;
            for (const { a, b } of samples) peak[name] = Math.max(peak[name], read(b) - read(a));
            halfGone[name] = 0;
            for (const { t, a, b } of samples) {
                if (read(b) - read(a) >= 0.5 * peak[name]) halfGone[name] = t;
            }
            expect(peak[name], name).toBeGreaterThan(0.5);
        }
        const order = ['lowitz', 'crown', 'uta', 'parhelic', 'ring'];
        for (let i = 1; i < order.length; i++) {
            expect(halfGone[order[i]], `${order[i - 1]} before ${order[i]}`).toBeGreaterThan(halfGone[order[i - 1]]);
        }
        for (const name of ['lowitz', 'crown', 'uta', 'parhelic', 'crossArm', 'sunPillar']) {
            expect(halfGone.ring, `ring after ${name}`).toBeGreaterThan(halfGone[name]);
            expect(halfGone.dogs, `dogs after ${name}`).toBeGreaterThan(halfGone[name]);
        }
        // Each stage holds until its scheduled start (§7.4 Lumen return times).
        const lumen = PARHELION_LUMEN_RETURN;
        expect(halfGone.lowitz).toBeCloseTo(lumen.lowitz.start + lumen.lowitz.tau * Math.LN2, 1);
        expect(halfGone.ring).toBeCloseTo(lumen.ring.start + lumen.ring.tau * Math.LN2, 1);
        // Pillars 0–3 are gone by +2.6 s; the ring is mostly settled by +4.2 s and gone by +6 s.
        const out = state.update(t0 + 8, 0.01);
        for (let lane = 0; lane < 4; lane++) {
            expect(out.pillars[lane * 4] + out.pillars[lane * 4 + 3]).toBeCloseTo(t0 + lumen.pillarsEnd, 4);
        }
        const ringAt = (x) => {
            const s = samples.find((entry) => entry.t >= x);
            return s.b.k0[0] - s.a.k0[0];
        };
        expect(ringAt(4.2)).toBeLessThan(0.3 * peak.ring);
        expect(ringAt(6)).toBeLessThan(0.1 * peak.ring);
    });
});

describe('Parhelion pools and per-player caps (§7.7)', () => {
    it('keeps at most 3 live burst slots per player and replaces that player\'s oldest', () => {
        const state = createState('High');
        const t0 = 5;
        state.applyCue(makeCue({ kind: CUE.CLEAR, lines: 1, player: 1 }), t0 - 0.05);
        for (let i = 0; i < 4; i++) {
            state.applyCue(makeCue({ kind: CUE.CLEAR, lines: 2, player: 0 }), t0 + i * 0.1);
            expect(liveBursts(state, 0, t0 + i * 0.1)).toBeLessThanOrEqual(3);
        }
        const now = t0 + 0.3;
        expect(liveBursts(state, 0, now)).toBe(3);
        expect(burstBirthsOf(state, 0, now)[0]).toBeCloseTo(t0 + 0.2, 9);
        // The other player's slots were never taken.
        expect(liveBursts(state, 1, now)).toBe(2);
    });

    it('stays bounded under a four-player storm, replacing the globally oldest when full', () => {
        const state = createState('Minimal', {
            boards: [null, {
                x0: 0.05, y0: 0.1, x1: 0.2, y1: 0.9,
            }, {
                x0: 0.3, y0: 0.1, x1: 0.45, y1: 0.9,
            },
            {
                x0: 0.55, y0: 0.1, x1: 0.7, y1: 0.9,
            }, {
                x0: 0.8, y0: 0.1, x1: 0.95, y1: 0.9,
            }],
            aspect: 16 / 9,
        });
        let t = 0;
        for (let i = 0; i < 200; i++) {
            t += 0.013;
            const player = 1 + (i % 4);
            state.applyCue(makeCue({
                kind: CUE.QUAD, lines: 4, player, primary: player === 1,
            }), t);
            let total = 0;
            for (let p = 1; p <= 4; p++) {
                const live = liveBursts(state, p, t);
                expect(live).toBeLessThanOrEqual(3);
                total += live;
            }
            expect(total).toBeLessThanOrEqual(state.caps.burstSlots);
        }
        expect(state.out.burstA.length).toBe(16);
    });

    it('caps bead/orbit arcs at 2 per player in slots 0–3 and keeps the other player\'s bead', () => {
        const state = createState();
        state.applyCue(makeCue({ kind: CUE.CLEAR, lines: 1, player: 1 }), 1.0);
        for (let i = 0; i < 4; i++) state.applyCue(makeCue({ kind: CUE.CLEAR, lines: 1, player: 0 }), 1.1 + i * 0.05);
        const t = 1.3;
        let own = 0;
        let other = 0;
        for (let i = 0; i < PARHELION_OPTICS_CAPS.beadSlots; i++) {
            if (t < state.arcEnd[i] && state.arcAmp[i] !== 0) {
                if (state.arcPlayer[i] === 0) own += 1;
                if (state.arcPlayer[i] === 1) other += 1;
            }
        }
        expect(own).toBe(2);
        expect(other).toBe(1);
        const out = state.update(t, FRAME);
        expect(out.arcCount).toBeLessThanOrEqual(PARHELION_OPTICS_CAPS.beadSlots);
    });

    it('lights stations clockwise in the ping-pong slots, and Full Circle sweeps the ring once', () => {
        const state = createState();
        state.applyCue(makeCue({ kind: CUE.LOCK, lockCount: 1 }), 1);
        let out = state.update(1.1, FRAME);
        expect(out.arcs[ARC_SLOT.STATION_A * 4]).toBeCloseTo(stationPhi(0), 6);
        expect(out.arcs[ARC_SLOT.STATION_A * 4 + 1]).toBeCloseTo(0.18, 6);
        state.applyCue(makeCue({ kind: CUE.LOCK, lockCount: 2 }), 1.12);
        out = state.update(1.2, FRAME);
        expect(out.arcs[ARC_SLOT.STATION_B * 4]).toBeCloseTo(stationPhi(1), 6);
        expect(out.arcs[ARC_SLOT.STATION_B * 4 + 3]).toBe(ARC_MODE.WHITE);

        state.applyCount(12, 2);
        const wave = ARC_SLOT.WAVE * 4;
        out = state.update(2.01, FRAME);
        expect(out.arcs[wave]).toBeCloseTo(HALF_PI, 3);
        out = state.update(2.7, FRAME);
        expect(out.arcs[wave]).toBeCloseTo(HALF_PI - Math.PI, 6); // half way round (π/2 → π/2 − 2π)
        expect(out.ringFlash).toBeGreaterThan(0);
        expect(out.arcCount).toBe(ARC_SLOT.WAVE + 1);
    });

    it('sends the B2B echo to arc slot 7 and the spare pillars 4/5 at half strength', () => {
        const state = createState();
        state.applyCue(makeCue({
            kind: CUE.ECHO, echoOf: CUE.QUAD, lines: 4, strength: 0.5,
        }), 2);
        const out = state.update(2 + 0.4, FRAME);
        expect(out.arcCount).toBe(ARC_SLOT.ECHO + 1);
        expect(out.arcs[ARC_SLOT.ECHO * 4 + 1]).toBeCloseTo(0.5, 6);
        expect(out.pillars[4 * 4 + 1]).toBeCloseTo(0.5, 6);
        expect(out.pillars[5 * 4 + 1]).toBeCloseTo(0.5, 6);
        expect(out.pillars[1]).toBe(0);
        let motes = 0;
        for (let i = 0; i < state.caps.burstSlots; i++) motes += out.burstB[i * 4];
        expect(motes).toBeLessThanOrEqual(8);

        const minimal = createState('Minimal');
        minimal.applyCue(makeCue({
            kind: CUE.ECHO, echoOf: CUE.QUAD, lines: 4, strength: 0.5,
        }), 2);
        expect(Array.from(minimal.update(2.4, FRAME).pillars.subarray(16))).toEqual([-1e4, 0, 1.05, 1, -1e4, 0, 1.05, 1]
            .map(Math.fround));
    });
});

describe('Parhelion reduced motion (§7.6)', () => {
    it('turns the QUAD into static brightens: no shake, fewer and shorter motes, no bead climb', () => {
        const normal = createState();
        const rm = createState();
        rm.configure({ reducedMotion: true, intensity: 1 });
        const t0 = 1;
        normal.applyCue(makeCue({ kind: CUE.QUAD, lines: 4 }), t0);
        rm.applyCue(makeCue({
            kind: CUE.QUAD, lines: 4, reducedMotion: true, strength: 0.45,
        }), t0);

        const motes = (state) => {
            const counts = [];
            for (let i = 0; i < state.caps.burstSlots; i++) {
                if (state.burstOwner[i] >= 0) counts.push([state.out.burstB[i * 4], state.out.burstB[i * 4 + 1]]);
            }
            return counts;
        };
        expect(motes(normal).map(([n]) => n)).toEqual([20, 20]);
        expect(motes(rm).map(([n]) => n)).toEqual([7, 7]); // ×0.35
        expect(motes(normal)[0][1]).toBeCloseTo(0.9, 6);
        expect(motes(rm)[0][1]).toBeCloseTo(0.9 * 0.6, 6); // life ×0.6

        let normalShake = 0;
        let rmShakeMax = 0;
        let rmPeak = 0;
        let rmBright = 0;
        for (let t = t0; t < t0 + 2; t += 0.005) {
            const a = normal.update(t, 0.005);
            const b = rm.update(t, 0.005);
            normalShake = Math.max(normalShake, Math.abs(a.shake.yawDeg));
            rmShakeMax = Math.max(rmShakeMax, Math.abs(b.shake.yawDeg), Math.abs(b.shake.pitchDeg));
            if (b.arcs[1] > 1e-4) expect(b.arcs[0]).toBeCloseTo(HALF_PI, 6); // static at the target angle
            rmPeak = Math.max(rmPeak, b.arcs[1]);
            if (b.arcs[1] > 0.1 * 0.45) rmBright += 0.005;
        }
        expect(normalShake).toBeGreaterThan(0);
        expect(rmShakeMax).toBe(0);
        expect(rmPeak).toBeCloseTo(0.45, 6);
        expect(rmBright).toBeGreaterThan(0.6); // the ≈600 ms static brighten
        expect(rmBright).toBeLessThan(0.9);
        for (let lane = 0; lane < 4; lane++) {
            expect(rm.out.pillars[lane * 4 + 2]).toBeCloseTo(1.05, 6); // pillars without the bead climb
            expect(normal.out.pillars[lane * 4 + 2]).toBeLessThan(1);
        }
        const out = rm.update(t0 + 3, FRAME);
        expect(out.breathScale).toBe(0.3);
        expect(out.clocks.dustClockRate).toBe(PARHELION_CLOCK_RATES.dustReducedMotion);
    });

    it('lights stations at 0.12 with no motes, skips the Clear Sky freeze, and flattens the T-spin orbit', () => {
        const state = createState();
        state.configure({ reducedMotion: true });
        state.applyCue(makeCue({
            kind: CUE.LOCK, lockCount: 5, reducedMotion: true, strength: 0.45,
        }), 1);
        let out = state.update(1.1, FRAME);
        expect(out.arcs[ARC_SLOT.STATION_A * 4 + 1]).toBeCloseTo(0.12, 6);
        expect(Array.from(state.burstOwner).every((p) => p === -1)).toBe(true);

        state.applyCue(makeCue({
            kind: CUE.PERFECT, lines: 4, reducedMotion: true, strength: 0.45,
        }), 2);
        for (let t = 2; t < 3.5; t += 0.01) {
            out = state.update(t, 0.01);
            expect(out.displayDim).toBe(1);
            expect(out.clocks.dustClockRate).toBe(0.5);
            expect(out.shake.yawDeg).toBe(0);
        }

        state.applyCue(makeCue({
            kind: CUE.TSPIN, lines: 2, reducedMotion: true, strength: 0.45,
        }), 4);
        out = state.update(4.2, FRAME);
        const wave = ARC_SLOT.WAVE * 4;
        expect(out.arcs[wave + 2]).toBe(6); // whole-ring width
        expect(out.arcs[wave]).toBeCloseTo(HALF_PI, 6);
        expect(out.spoke[1]).toBe(0);
        expect(state.update(5.0, FRAME).arcs[wave + 1]).toBeLessThan(0.01);
    });
});

describe('Parhelion resonance, level and ambient life (§7.4, §8)', () => {
    it('warms, crowns and lines the display as the resonance climbs', () => {
        const state = createState();
        const idle = PARHELION_OPTICS_IDLE;
        let out = state.update(0, 0);
        expect(out.k1[0]).toBe(0);
        expect(out.dogTint).toBe(0);
        state.setResonance(1);
        out = state.update(0, 0);
        expect(out.dogTint).toBe(1);
        expect(out.k1[0]).toBeCloseTo(0.9, 6);
        expect(out.k0[2]).toBeCloseTo(idle.k0[2] + 0.78, 6);
        expect(out.k1[2]).toBeCloseTo(0.7, 6);
        expect(out.density).toBeCloseTo(idle.density + 0.15, 6);
        const low = createState('Low');
        low.setResonance(1);
        const lowOut = low.update(0, 0);
        expect(lowOut.k1[0]).toBe(0); // no crown at Low …
        expect(lowOut.k1[2]).toBe(0); // … and no Lowitz
        expect(lowOut.prism).toBe(0);
    });

    it('eases the Lower Sun warmth over 3 s, caps it, and eases back on resetSession', () => {
        const state = createState();
        const warmthAt = (t) => state.update(t, FRAME).warmth / (1 + 0.08 * Math.sin((2 * Math.PI * t) / 90));
        expect(warmthAt(0)).toBeCloseTo(0.1, 9);
        state.setLevel(5, 10);
        expect(warmthAt(11.5)).toBeCloseTo(0.1 + 0.22 * smoothstep(0, 3, 1.5), 9);
        expect(warmthAt(13)).toBeCloseTo(0.1 + 4 * 0.055, 9);
        state.setLevel(30, 13);
        expect(warmthAt(20)).toBeCloseTo(0.6, 9);
        state.resetSession();
        expect(warmthAt(20)).toBeCloseTo(0.6, 9);
        expect(warmthAt(23)).toBeCloseTo(0.1, 9);
    });

    it('breathes on a 10 s period, ±15%, and clocks run at their §7.2 rates', () => {
        const state = createState();
        expect(state.update(2.5, 0).breath).toBeCloseTo(1.15, 9);
        expect(state.update(7.5, 0).breath).toBeCloseTo(0.85, 9);
        state.seek(100);
        const out = state.update(100, 0);
        expect(out.clocks.dustClock).toBeCloseTo(100, 9);
        // Noise units/s (B2b screenshot tuning): veil 0.025, spindrift 0.18 (≈ 6 m/s).
        expect(out.clocks.veilPhase).toBeCloseTo(2.5, 9);
        expect(out.clocks.driftPhase).toBeCloseTo(18, 9);
    });

    it('clears every reaction at intensity 0 while the clocks and warmth carry on', () => {
        const state = createState();
        state.applyCue(makeCue({ kind: CUE.QUAD, lines: 4 }), 1);
        state.configure({ intensity: 0 });
        state.applyCue(makeCue({ kind: CUE.QUAD, lines: 4 }), 1.1);
        const out = state.update(1.9, FRAME);
        expect(out.arcCount).toBe(0);
        expect(out.ringFlash).toBe(0);
        expect(out.k0[3]).toBeCloseTo(PARHELION_OPTICS_IDLE.k0[3], 6);
        expect(Array.from(state.burstOwner).every((p) => p === -1)).toBe(true);
        expect(out.clocks.dustClock).toBeGreaterThan(0);
    });
});

describe('Parhelion keeps the board sanctuary (§7.3: nothing reactive spawns inside a live board)', () => {
    const scr = { x: 0, y: 0, depth: 0 };
    const origin = { x: 0, y: 0, z: 0 };

    function inside(rect, p) {
        return p.x > rect.x0 && p.x < rect.x1 && p.y > rect.y0 && p.y < rect.y1;
    }

    /** Projects every burst slot written since `serial` back to the screen and checks it. */
    function checkOrigins(state, aspect, rects, stats, label) {
        const { burstA, burstB } = state.out;
        for (let i = 0; i < state.caps.burstSlots; i++) {
            if (state.burstOwner[i] < 0 || burstB[i * 4] <= 0) continue;
            origin.x = burstA[i * 4];
            origin.y = burstA[i * 4 + 1];
            origin.z = burstA[i * 4 + 2];
            projectWorld(origin, aspect, scr);
            expect(scr.depth).toBeGreaterThan(50);
            for (const rect of rects) expect(inside(rect, scr), `${label} slot ${i} (${scr.x}, ${scr.y})`).toBe(false);
            expect(scr.x).toBeGreaterThan(0);
            expect(scr.x).toBeLessThan(1);
            stats.checked += 1;
        }
    }

    function allCues() {
        const cues = [];
        for (const lockU of [0, 0.49, 0.5, 1]) {
            for (const rowV of [0, 0.5, 1]) {
                const at = { lockU, rowV, lockV: rowV };
                cues.push(makeCue({ ...at, kind: CUE.LOCK, lockCount: 1 + cues.length }));
                cues.push(makeCue({
                    ...at, kind: CUE.LOCK, player: 3, primary: false,
                }));
                cues.push(makeCue({ ...at, kind: CUE.STONEFALL, lockCount: 1 + cues.length }));
                cues.push(makeCue({ ...at, kind: CUE.CLEAR, lines: 1 }));
                cues.push(makeCue({
                    ...at, kind: CUE.CLEAR, lines: 3, depth: 2,
                }));
                cues.push(makeCue({ ...at, kind: CUE.QUAD, lines: 4 }));
                cues.push(makeCue({ ...at, kind: CUE.TSPIN, lines: 2 }));
                cues.push(makeCue({
                    ...at, kind: CUE.APEX, lines: 1, combo: 10,
                }));
                cues.push(makeCue({ ...at, kind: CUE.PERFECT, lines: 4 }));
                cues.push(makeCue({
                    ...at, kind: CUE.ECHO, echoOf: CUE.TSPIN, strength: 0.5,
                }));
            }
        }
        // Serenity-style clicks that land on the card, on its corner, and on the ring.
        cues.push(makeCue({
            kind: CUE.CLEAR, lines: 2, sx: 0.5, sy: 0.5,
        }));
        cues.push(makeCue({
            kind: CUE.QUAD, lines: 4, sx: 0.45, sy: 0.3,
        }));
        cues.push(makeCue({
            kind: CUE.CLEAR, lines: 1, sx: 0.232, sy: 0.5,
        }));
        return cues;
    }

    it('places every burst origin outside the card and the board at all six measured viewports', () => {
        const stats = { checked: 0 };
        for (const vp of MEASURED_VIEWPORTS) {
            const state = createState('Extreme', soloLayout(vp));
            let t = 1;
            for (const cue of allCues()) {
                state.applyCue(cue, t);
                checkOrigins(state, vp.aspect, [vp.card, vp.board], stats, `${vp.width}x${vp.height}`);
                t += 0.05;
            }
        }
        expect(stats.checked).toBeGreaterThan(2000);
    });

    it('places every burst origin outside all four boards of a local-MP layout', () => {
        const boards = [null,
            {
                x0: 0.04, y0: 0.12, x1: 0.22, y1: 0.9,
            },
            {
                x0: 0.28, y0: 0.12, x1: 0.46, y1: 0.9,
            },
            {
                x0: 0.54, y0: 0.12, x1: 0.72, y1: 0.9,
            },
            {
                x0: 0.78, y0: 0.12, x1: 0.96, y1: 0.9,
            }];
        const aspect = 16 / 9;
        const state = createState('High', { boards, aspect, mode: 'local-multiplayer' });
        const rects = boards.slice(1);
        const stats = { checked: 0 };
        let t = 1;
        for (const cue of allCues()) {
            for (let player = 1; player <= 4; player++) {
                state.applyCue({ ...cue, player, primary: player === 1 }, t);
                checkOrigins(state, aspect, rects, stats, `p${player}`);
                t += 0.02;
            }
        }
        expect(stats.checked).toBeGreaterThan(1000);
    });

    it('honours a Serenity click where no board rect exists, and blinks the ring when the click is on it', () => {
        const state = createState('High', { mode: 'serenity', aspect: 16 / 9 });
        expect(state.exclusionCount).toBe(0);
        state.applyCue(makeCue({
            kind: CUE.CLEAR, lines: 1, sx: 0.5, sy: 0.6,
        }), 1);
        const slot = Array.from(state.burstOwner).findIndex((p) => p === 0);
        const { burstA, burstB, burstD } = state.out;
        projectWorld({ x: burstA[slot * 4], y: burstA[slot * 4 + 1], z: burstA[slot * 4 + 2] }, 16 / 9, scr);
        expect(scr.x).toBeCloseTo(0.5, 5);
        expect(scr.y).toBeCloseTo(0.6, 5);
        expect(burstB[slot * 4]).toBe(10); // 6 + 4·lines
        expect(burstD[slot * 4]).toBe(BURST_MODE.RADIAL);
        expect(state.update(1.05, FRAME).arcCount).toBe(0); // not on the ring: no blink

        state.applyCue(makeCue({
            kind: CUE.CLEAR, lines: 2, sx: 0.232, sy: 0.5,
        }), 2);
        const out = state.update(2.1, FRAME);
        expect(out.arcCount).toBe(ARC_SLOT.STATION_A + 1);
        expect(Math.abs(out.arcs[ARC_SLOT.STATION_A * 4])).toBeGreaterThan(Math.PI - 0.1);
        expect(out.arcs[ARC_SLOT.STATION_A * 4 + 1]).toBeCloseTo(0.5, 6);
    });
});
