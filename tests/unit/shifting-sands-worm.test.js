import { describe, expect, it } from 'vitest';
import {
    IDLE_OFFSET,
    IDLE_PERIOD,
    RESUMMON_FADE,
    SETTLE,
    SIGN_LEAD,
    SLOT_IDLE,
    SLOT_SUMMONED,
    WormDirector,
    breachLive,
    breachPoint,
    makeBreach,
    surfaceAngle,
} from '../../src/themes/shifting-sands/shifting-sands-worm.js';

const DEG = Math.PI / 180;
const flatGround = () => 10;
/** A rolling erg: a tilted plane under a swell, so the two feet stand at different heights. */
const rollingGround = (x, z) => 0.12 * x + 22 * Math.sin(z / 90) + 9 * Math.cos(x / 55);
const SHAPE = Object.freeze({
    az: -27, dist: 1350, heading: -118, a: 120, b: 235, k: 50, R: 30, length: 620, speed: 80,
});
const SENTINEL = Object.freeze({
    x: Math.sin(30.5 * DEG) * 2350, z: -Math.cos(30.5 * DEG) * 2350, r: 390, solid: 165, h: 430,
});
/** The solo layout at 16:9: the board over the centre, the HUD to its right (degrees). */
const BOARD_BANDS = Object.freeze([[-10.3, 10.3], [14.9, 22.5]]);

const azOf = (p) => Math.atan2(p.x, -p.z) / DEG;

describe('shifting sands breach path', () => {
    it('meets level sand exactly at ±φ0 and peaks at b − k', () => {
        const br = makeBreach(SHAPE, 0, flatGround);
        const p = { x: 0, y: 0, z: 0 };
        expect(br.phiUp).toBeCloseTo(-br.phi0, 4);
        expect(br.phiDown).toBeCloseTo(br.phi0, 4);
        expect(breachPoint(br, -br.phi0, p).y).toBeCloseTo(br.oy, 6);
        expect(breachPoint(br, br.phi0, p).y).toBeCloseTo(br.oy, 6);
        expect(breachPoint(br, 0, p).y).toBeCloseTo(br.oy + br.b - br.k, 6);
        expect(surfaceAngle(br.b, br.k)).toBeCloseTo(br.phi0, 9);
    });

    it('seats the arch on the sand and lasts until the tail is under', () => {
        const br = makeBreach(SHAPE, 5, flatGround);
        expect(br.seated).toBe(true);
        expect(br.oy).toBeCloseTo(10, 6);
        expect(br.omega).toBeGreaterThan(0);
        expect(br.duration).toBeCloseTo((2 * br.phi0 + br.span) / br.omega, 3);
        expect(br.duration).toBeCloseTo(br.tDown + br.tOut, 9);
        expect(br.duration).toBeGreaterThan(8);
        expect(br.duration).toBeLessThan(25);
    });

    it('solves both feet against uneven sand', () => {
        const br = makeBreach(SHAPE, 0, rollingGround);
        const p = { x: 0, y: 0, z: 0 };
        expect(br.seated).toBe(true);
        for (const [foot, phi] of [[br.up, br.phiUp], [br.down, br.phiDown]]) {
            // The foot is on the sand, and it is where the centre line of the body crosses it.
            expect(foot.y).toBeCloseTo(rollingGround(foot.x, foot.z), 6);
            breachPoint(br, phi, p);
            expect(p.x).toBeCloseTo(foot.x, 6);
            expect(Math.abs(p.y - foot.y)).toBeLessThan(0.1);
            expect(Math.hypot(foot.gx, foot.gz)).toBeLessThanOrEqual(0.7 + 1e-9);
        }
        // The feet stand at different heights, so the arch is no longer symmetric about its apex.
        expect(Math.abs(br.up.y - br.down.y)).toBeGreaterThan(1);
        expect(Math.abs(br.phiUp + br.phiDown)).toBeGreaterThan(1e-3);
        // Above the sand everywhere between the feet.
        for (let i = 1; i < 20; i++) {
            breachPoint(br, br.phiUp + ((br.phiDown - br.phiUp) * i) / 20, p);
            expect(p.y).toBeGreaterThan(rollingGround(p.x, p.z));
        }
    });

    it('keeps the body short enough that the buried head never laps the arch', () => {
        const br = makeBreach({ ...SHAPE, length: 5000 }, 0, flatGround);
        expect(br.span).toBeLessThan(2 * Math.PI - (br.phiDown - br.phiUp) - 0.4);
        expect(br.length).toBeLessThan(5000);
    });
});

describe('shifting sands worm director', () => {
    it('is closed-form in time (the same t always resolves the same worm)', () => {
        const d = new WormDirector(flatGround);
        const t = d.idleBreach(0).t0 + 4;
        const a = d.update(t).slots[SLOT_IDLE];
        const phiA = a.phiHead;
        const breachA = a.breach; // the state object is reused; keep the breach record
        expect(breachA).not.toBeNull();
        d.update(t + 30);
        d.update(t + 200); // another cycle, another site
        const b = d.update(t).slots[SLOT_IDLE];
        expect(b.breach.t0).toBe(breachA.t0);
        expect(b.breach.ox).toBe(breachA.ox);
        expect(b.breach.dx).toBe(breachA.dx);
        expect(b.phiHead).toBeCloseTo(phiA, 9);
    });

    it('runs the idle cycle: calm, worm sign, the breach, the settle, calm', () => {
        const d = new WormDirector(flatGround);
        const br = d.idleBreach(0);
        const idle = (t) => d.update(t).slots[SLOT_IDLE];
        expect(idle(1).breach).toBeNull();
        expect(br.t0).toBeGreaterThanOrEqual(IDLE_OFFSET + SIGN_LEAD.idle);
        // The sign travels in; nothing is above the sand yet.
        const sign = idle(br.t0 - SIGN_LEAD.idle * 0.5);
        expect(sign.sign.strength).toBeGreaterThan(0.5);
        expect(sign.show).toBe(0);
        // The breach: the body is shown and the sand heaves where it comes up.
        const up = idle(br.t0 + 2);
        expect(up.show).toBe(1);
        expect(up.fx).toBe(true);
        expect(up.wells[0].rim).toBeGreaterThan(1);
        // After the tail is under, the body is gone but the sand is still moving.
        const settle = idle(br.t0 + br.duration + 2);
        expect(settle.show).toBe(0);
        expect(settle.breach).toBe(br);
        expect(settle.fx).toBe(true);
        expect(settle.wells[1].crater).toBeGreaterThan(1);
        expect(settle.sign.strength).toBeGreaterThan(0);
        // Quiet again before the next cycle.
        expect(br.t0 + br.duration + SETTLE).toBeLessThan(IDLE_OFFSET + IDLE_PERIOD);
        expect(idle(IDLE_OFFSET + IDLE_PERIOD - 0.25).breach).toBeNull();
    });

    it('never switches anything off in a frame: every mark on the sand eases in and out', () => {
        const d = new WormDirector(rollingGround);
        const dt = 1 / 120;
        const marks = new Float64Array(9);
        const prev = new Float64Array(9);
        const read = (t) => {
            const st = d.update(t).slots[SLOT_IDLE];
            marks[0] = st.sign.strength * 9; // the sign mound is 9 units tall at full strength
            for (let i = 0; i < 2; i++) {
                marks[1 + i * 4] = st.wells[i].rim;
                marks[2 + i * 4] = st.wells[i].bulge;
                marks[3 + i * 4] = st.wells[i].crater;
                marks[4 + i * 4] = st.wells[i].scar * 10;
            }
            return st;
        };
        for (const cycle of [0, 1, 2, 3]) {
            const br = d.idleBreach(cycle);
            const start = br.t0 - br.leadTime;
            const end = br.t0 + br.duration + SETTLE;
            const p = { x: 0, y: 0, z: 0 };
            let st = read(start + dt);
            // It begins from nothing...
            expect(Math.max(...marks)).toBeLessThan(0.3);
            let steepest = 0; // the largest change of any height on the sand in one frame
            let clockError = 0; // the path clock's worst departure from a steady tick
            let dead = 0; // frames inside its life in which the breach was not live
            let shownAbove = 0; // times the body appeared or vanished with any of it above the sand
            let flips = 0;
            for (let t = start + 2 * dt; t < end; t += dt) {
                prev.set(marks);
                const before = { show: st.show, phiHead: st.phiHead };
                st = read(t);
                if (!st.breach) dead += 1;
                for (let i = 0; i < marks.length; i++) steepest = Math.max(steepest, Math.abs(marks[i] - prev[i]));
                clockError = Math.max(clockError, Math.abs(st.phiHead - before.phiHead - br.omega * dt));
                if (st.show !== before.show) {
                    flips += 1;
                    for (const phi of [st.phiHead, st.phiHead - br.span]) {
                        breachPoint(br, phi, p);
                        if (p.y >= rollingGround(p.x, p.z)) shownAbove += 1;
                    }
                    if (st.phiHead >= br.phiUp + 2 * Math.PI) shownAbove += 1;
                }
            }
            expect(dead).toBe(0);
            // ...no height on the sand moves faster than half a unit per frame at 120 Hz...
            expect(steepest).toBeGreaterThan(0.01);
            expect(steepest).toBeLessThan(0.5);
            // ...the path clock never jumps (every grain reads its age off it)...
            expect(clockError).toBeLessThan(1e-9);
            // ...the body appears once and vanishes once, each time wholly under the sand...
            expect(flips).toBe(2);
            expect(shownAbove).toBe(0);
            // ...and it ends at nothing.
            expect(Math.max(...marks)).toBeLessThan(0.3);
            expect(d.update(end + dt).slots[SLOT_IDLE].breach).toBeNull();
        }
    });

    it('answers a summons once, after the sign races in', () => {
        const d = new WormDirector(flatGround);
        const t0 = 2;
        expect(d.summon(t0)).toBe(true);
        expect(d.summon(t0 + 0.5)).toBe(false); // already coming
        const coming = d.update(t0 + SIGN_LEAD.summoned * 0.5).slots[SLOT_SUMMONED];
        expect(coming.show).toBe(0);
        expect(coming.sign.strength).toBeGreaterThan(0);
        const s = d.update(t0 + SIGN_LEAD.summoned + 1);
        expect(s.slots[SLOT_SUMMONED].breach).toBe(d.summoned);
        expect(s.slots[SLOT_SUMMONED].show).toBe(1);
        expect(d.summoned.summoned).toBe(true);
        expect(s.rumble).toBeGreaterThan(0);
        // It is the bigger worm, and it comes close.
        expect(d.summoned.R).toBeGreaterThan(32);
        expect(d.summoned.dist).toBeLessThan(1300);
    });

    it('never cuts the idle worm short: a summons rises beside it, somewhere else', () => {
        const d = new WormDirector(flatGround);
        const idle = d.idleBreach(0);
        const t = idle.t0 + 3; // the idle worm is in the air
        expect(d.update(t).slots[SLOT_IDLE].show).toBe(1);
        expect(d.summon(t)).toBe(true);
        for (const dt of [0, 0.5, SIGN_LEAD.summoned + 1, 6]) {
            const s = d.update(t + dt);
            expect(s.slots[SLOT_IDLE].breach).toBe(idle);
        }
        const both = d.update(t + SIGN_LEAD.summoned + 2);
        expect(both.slots[SLOT_IDLE].show).toBe(1);
        expect(both.slots[SLOT_SUMMONED].show).toBe(1);
        const apart = Math.hypot(d.summoned.ox - idle.ox, d.summoned.oz - idle.oz);
        expect(apart).toBeGreaterThan(260);
    });

    it('keeps an idle cycle quiet when the summons lands before its sign', () => {
        const d = new WormDirector(flatGround);
        const next = d.idleBreach(1);
        const signStart = next.t0 - next.leadTime;
        d.summon(signStart - 2);
        const during = next.t0 + 3;
        expect(d.update(during).slots[SLOT_IDLE].breach).toBeNull();
        // ...and it stays quiet: nothing may appear half-way through.
        const sm = d.summoned;
        const later = sm.t0 + sm.duration + 2;
        if (later < next.t0 + next.duration) {
            d.summon(later);
            expect(d.update(later + 0.1).slots[SLOT_IDLE].breach).toBeNull();
        }
    });

    it('fades the last summoned worm\'s dust under a new summons instead of cutting it', () => {
        const d = new WormDirector(flatGround);
        expect(d.summon(3)).toBe(true);
        const first = d.summoned;
        // Still above the sand: the call is refused.
        expect(d.summon(first.t0 + first.duration - 1)).toBe(false);
        // Its dust is settling: the new worm is accepted and the old dust fades out first.
        const again = first.t0 + first.duration + 3;
        expect(breachLive(first, again)).toBe(true);
        expect(d.summon(again)).toBe(true);
        const second = d.summoned;
        expect(second).not.toBe(first);
        const fading = d.update(again + RESUMMON_FADE * 0.5).slots[SLOT_SUMMONED];
        expect(fading.breach).toBe(first);
        expect(fading.fade).toBeGreaterThan(0);
        expect(fading.fade).toBeLessThan(1);
        const handed = d.update(again + RESUMMON_FADE + 0.02).slots[SLOT_SUMMONED];
        expect(handed.breach).toBe(second);
        expect(handed.sign.strength).toBeLessThan(0.05); // the slot changes hands at zero
    });

    it('forgets the summons on reset', () => {
        const d = new WormDirector(flatGround);
        d.summon(3);
        d.reset();
        expect(d.summoned).toBeNull();
        expect(d.update(3 + SIGN_LEAD.summoned + 1).slots[SLOT_SUMMONED].breach).toBeNull();
    });
});

describe('shifting sands breach sites', () => {
    const drawn = (d, n = 60) => Array.from({ length: n }, (_, cycle) => d.idleBreach(cycle));

    it('draws its sites all over the visible erg', () => {
        const d = new WormDirector(flatGround);
        const sites = drawn(d);
        const edge = d.view.halfAz;
        for (const br of sites) {
            expect(d.faults(br)).toBe(0);
            for (const foot of [br.up, br.down]) {
                expect(Math.abs(azOf(foot))).toBeLessThan(edge);
                expect(Math.hypot(foot.x, foot.z)).toBeGreaterThan(550);
            }
        }
        const az = sites.map((br) => br.az);
        const dist = sites.map((br) => br.dist);
        // Left, right and centre; near and far.
        expect(Math.min(...az)).toBeLessThan(-20);
        expect(Math.max(...az)).toBeGreaterThan(20);
        expect(az.some((a) => Math.abs(a) < 8)).toBe(true);
        expect(Math.min(...dist)).toBeLessThan(1000);
        expect(Math.max(...dist)).toBeGreaterThan(2200);
        // Travelling both ways across the view, as hoops and as long leaps.
        const cross = sites.map((br) => br.dx * Math.cos(br.az * DEG) + br.dz * Math.sin(br.az * DEG));
        expect(cross.some((c) => c > 0.3)).toBe(true);
        expect(cross.some((c) => c < -0.3)).toBe(true);
        const slender = sites.map((br) => br.a / br.b);
        expect(Math.min(...slender)).toBeLessThan(0.6);
        expect(Math.max(...slender)).toBeGreaterThan(0.85);
        // No two cycles share a site or a start time within the cycle.
        expect(new Set(sites.map((br) => br.ox.toFixed(1))).size).toBe(sites.length);
        const late = sites.map((br, c) => br.t0 - IDLE_OFFSET - c * IDLE_PERIOD - SIGN_LEAD.idle);
        expect(Math.max(...late) - Math.min(...late)).toBeGreaterThan(4);
    });

    it('draws another sequence for another salt', () => {
        const a = new WormDirector(flatGround).idleBreach(0);
        const b = new WormDirector(flatGround, { salt: 12345 }).idleBreach(0);
        expect(a.ox).not.toBe(b.ox);
    });

    it('keeps clear of the boards, the HUD and the rock, on both sides of the board', () => {
        const d = new WormDirector(flatGround, { obstacles: [SENTINEL] });
        d.setView({ halfAz: 39.7, bands: BOARD_BANDS.map((b) => [...b]) });
        const sites = drawn(d);
        const clean = sites.filter((br) => d.faults(br) === 0);
        expect(clean.length).toBeGreaterThan(sites.length * 0.9);
        for (const br of clean) {
            for (const foot of [br.up, br.down]) {
                const az = azOf(foot);
                for (const [from, to] of BOARD_BANDS) expect(az > from && az < to).toBe(false);
                expect(Math.hypot(foot.x - SENTINEL.x, foot.z - SENTINEL.z)).toBeGreaterThan(SENTINEL.r);
            }
        }
        expect(clean.some((br) => br.az < -10.3)).toBe(true);
        expect(clean.some((br) => br.az > 22.5)).toBe(true);
    });

    it('re-draws a breach that has not begun when the view changes, never one under way', () => {
        const d = new WormDirector(flatGround);
        const before = d.idleBreach(0, 0);
        d.setView({ halfAz: 39.7, bands: [[-39.7, 0]] }); // the whole left half is covered
        const after = d.idleBreach(0, 0);
        expect(after).not.toBe(before);
        expect(after.az).toBeGreaterThan(0);
        d.setView({ halfAz: 39.7, bands: [[0, 39.7]] });
        expect(d.idleBreach(0, after.t0 + 1)).toBe(after); // already above the sand: it stays
    });

    it('keeps both feet in sight of the camera', () => {
        // Beyond z = −1500 the erg drops away behind an edge: nothing down there can be seen.
        const shelf = (x, z) => (z < -1500 ? -200 : 0);
        const d = new WormDirector(shelf, { eye: { x: 0, y: 36, z: 0 } });
        expect(d.sees(0, 15, -1000)).toBe(true);
        expect(d.sees(0, -185, -2000)).toBe(false);
        for (const br of drawn(d, 40)) {
            expect(br.up.z).toBeGreaterThan(-1500);
            expect(br.down.z).toBeGreaterThan(-1500);
        }
    });
});
