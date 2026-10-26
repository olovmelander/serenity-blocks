/**
 * Rainbow Terraces — the gliders' flight in closed form (rainbow-terraces-flock.js, three-free).
 *
 * The flock is a function of the flight clock and the event times: sampling is deterministic and
 * keeps no hidden state. At rest the gliders soar between the thermals of their own flock, each
 * thermal circled one way, leaning into the turn. A glider painting a stroke flies the bow's own
 * circle at PAINT_DISTANCE (so its screen position lies on the bow, just inside the primary); the
 * T-spin helix and the level-up launch play in their windows; the long-wing keeps its station
 * while a back-to-back holds. Every glider joins its event from where it was and flies home after
 * it: nothing jumps, and its lean never snaps. An aloft share below one parks the rest out of
 * sight, the last of them fading rather than vanishing.
 */
import { describe, expect, it } from 'vitest';
import {
    FLIGHT, GliderFlock, PAINT_DISTANCE, WING,
} from '../../src/themes/rainbow-terraces/rainbow-terraces-flock.js';
import { frameFor, nominalLayout } from '../../src/themes/rainbow-terraces/rainbow-terraces-frame.js';
import { placePlan } from '../../src/themes/rainbow-terraces/rainbow-terraces-plan.js';

const DEG = Math.PI / 180;
const CAPACITY = 20;
const DT = 1 / 60;
const frame = frameFor(16 / 9, nominalLayout(16 / 9), {});
const placement = placePlan(frame, {});
const LINKS = Array.from({ length: 12 }, (_, i) => [0.1 + i * 0.07, 0.9 - i * 0.05, 0.4]);

function bowAt(dial, extra = {}) {
    return {
        A: frame.A,
        basis: frame.basis,
        R1: frame.R1,
        R2: frame.R2,
        strokes: [...frame.strokes1, ...frame.strokes2],
        dial,
        links: LINKS,
        ...extra,
    };
}

function flock(seed = 33) {
    const f = new GliderFlock(CAPACITY, seed);
    f.setThermals(placement.thermals);
    return f;
}

/** Horizontal distance between two points. */
const across = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
/** A deep copy of the poses (the flock reuses its pose objects). */
const snapshot = (poses) => poses.map((p) => JSON.parse(JSON.stringify(p)));
const angleBetween = (a, b) => {
    const la = Math.hypot(...a);
    const lb = Math.hypot(...b);
    const c = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (la * lb);
    return Math.acos(Math.max(-1, Math.min(1, c)));
};

/**
 * Fly a flock frame by frame from t0 to t1 (each frame's bow from `bowFor(t)`), and report the
 * largest step any visible glider takes in one frame as seen from the eye (radians) and the
 * largest change of lean (radians), with where they happened.
 */
function fly(f, t0, t1, bowFor, aloft = 1) {
    let prev = null;
    const worst = { angle: 0, bank: 0, at: null };
    for (let t = t0; t <= t1; t += DT) {
        const now = snapshot(f.sample(t, bowFor(t), aloft));
        for (let i = 0; prev && i < now.length; i++) {
            const p = now[i];
            const q = prev[i];
            if (p.scale > 0 && q.scale > 0) {
                const step = angleBetween(p.pos, q.pos);
                if (step > worst.angle) { worst.angle = step; worst.at = { t, i, mode: p.mode }; }
                worst.bank = Math.max(worst.bank, Math.abs(p.bank - q.bank));
            }
        }
        prev = now;
    }
    return worst;
}

/** The world's bookkeeping of a stroke's painting (start, end, end progress), driven by a dial. */
function painter(targetAt) {
    const paintFrom = new Float64Array(12).fill(-1e4);
    const paintTo = new Float64Array(12).fill(-1e4);
    const paintEnd = new Float64Array(12).fill(1);
    const laid = new Float64Array(12);
    let dial = 0;
    let last = null;
    return (t) => {
        if (last !== null) {
            const target = targetAt(t);
            const dt = t - last;
            if (dial < target) dial = Math.min(target, dial + Math.max(1, (target - dial) / 0.8) * dt);
            else if (dial > target) dial = Math.max(target, dial - dt / 0.6);
        }
        last = t;
        for (let i = 0; i < 12; i++) {
            const progress = Math.max(0, Math.min(1, dial - i));
            const was = laid[i];
            if (!(paintFrom[i] > paintTo[i]) && was <= 0 && progress > 0) paintFrom[i] = t;
            if (paintFrom[i] > paintTo[i] && (progress >= 1 || progress < was)) {
                paintTo[i] = Math.max(t, paintFrom[i]);
                paintEnd[i] = progress >= 1 ? 1 : was;
            }
            laid[i] = progress;
        }
        return bowAt(dial, { paintFrom, paintTo, paintEnd });
    };
}

describe('rainbow terraces flock', () => {
    it('samples a pure function of the flight clock: twins agree, and asking out of order changes nothing', () => {
        const a = flock();
        const b = flock();
        const times = [0, 3.7, 12.5, 60, 333.3];
        const first = times.map((t) => snapshot(a.sample(t, bowAt(4.5), 1)));
        expect(times.map((t) => snapshot(b.sample(t, bowAt(4.5), 1)))).toEqual(first);
        expect([...times].reverse().map((t) => snapshot(a.sample(t, bowAt(4.5), 1))).reverse()).toEqual(first);
        // It moves with the clock.
        expect(first[1]).not.toEqual(first[2]);
        // A different seed is a different flock.
        expect(snapshot(flock(7).sample(12.5, bowAt(4.5), 1))).not.toEqual(first[2]);
        // The same pose objects come back every time (nothing allocated per frame for the poses).
        expect(a.sample(1, bowAt(0), 1)).toBe(a.poses);
        expect(a.poses).toHaveLength(CAPACITY);
    });

    it('soars at rest over its own flock\'s thermals, white and trail-less, each thermal circled one way', () => {
        const f = flock();
        const { thermals } = placement;
        // Landscape: a flock of three thermals over the Spring Isle and one of two over the Far Gate.
        expect(thermals.map((t) => t.group)).toEqual([0, 0, 0, 1, 1]);
        const span = (g) => {
            const own = thermals.filter((t) => t.group === g);
            return Math.max(...own.flatMap((a) => own.map((b) => across(a.pos, b.pos))));
        };
        let glides = 0;
        const homes = f.traits.map((tr) => tr.group);
        for (let t = 0; t < 600; t += 7.3) {
            const poses = f.sample(t, bowAt(0), 1);
            for (let i = 0; i < poses.length; i++) {
                const p = poses[i];
                expect(p.mode, `glider ${i}`).toBe(0);
                expect(p.scale, `glider ${i}`).toBeGreaterThan(0);
                expect(p.trail, `glider ${i}`).toBe(0);
                expect(p.colour, `glider ${i}`).toEqual([1, 1, 1]);
                const own = thermals.filter((th) => th.group === homes[i]);
                const near = Math.min(...own.map((th) => across(p.pos, th.pos)));
                // On a circle round one (it wanders on the wind), or on the glide between two.
                expect(near, `glider ${i} at ${t}`).toBeLessThanOrEqual(30 * 1.3 + 16 + span(homes[i]) / 2 + 1e-6);
                f.restAt(i, t, [0, 0, 0], f.restInfo);
                if (f.restInfo.glide >= 0) glides += 1;
            }
        }
        // Gliders do move between the thermals of their flock.
        expect(glides).toBeGreaterThan(10);
        // A leg's thermal is always one of the glider's own flock.
        for (let i = 0; i < CAPACITY; i++) {
            for (let n = 0; n < 200; n++) expect(thermals[f.legThermal(i, n)].group).toBe(homes[i]);
        }
        // Everyone in a thermal circles the same way.
        expect(f.thermals.every((th) => th.dir === 1 || th.dir === -1)).toBe(true);
    });

    it('leans into its turn while it circles (the lift tilted toward the circle\'s centre)', () => {
        const f = flock();
        let checked = 0;
        for (let t = 5; t < 200; t += 3.1) {
            const poses = f.sample(t, bowAt(0), 1);
            for (let i = 0; i < poses.length; i++) {
                const p = poses[i];
                f.restAt(i, t, [0, 0, 0], f.restInfo);
                if (f.restInfo.glide >= 0) continue;
                // The thermal of its leg, and that thermal's wandering core now.
                const leg = Math.floor((t + f.traits[i].legOff) / f.traits[i].leg);
                const core = f.core(f.legThermal(i, leg), t, [0, 0, 0]);
                const v = p.vel;
                const len = Math.hypot(-v[2], v[0]) || 1;
                const side = [-v[2] / len, 0, v[0] / len];
                // The vertex stage's up vector after the bank: up·cos(b) − side·sin(b).
                const up = [-side[0] * Math.sin(p.bank), Math.cos(p.bank), -side[2] * Math.sin(p.bank)];
                const inward = [core[0] - p.pos[0], 0, core[2] - p.pos[2]];
                const toward = up[0] * inward[0] + up[2] * inward[2];
                if (Math.abs(p.bank) > 0.2) {
                    expect(toward, `glider ${i} at ${t}`).toBeGreaterThan(0);
                    checked += 1;
                }
            }
        }
        expect(checked).toBeGreaterThan(40);
    });

    it('flies a painting glider on the bow\'s circle at PAINT_DISTANCE, just inside the primary, in its colour', () => {
        const f = flock();
        for (const dial of [0.5, 2.5, 6.25, 7.5, 11.4]) {
            const poses = f.sample(9, bowAt(dial), 1);
            const painting = poses.filter((p) => p.mode === 1);
            // One glider for the stroke being painted (a whole number of strokes: none in flight).
            expect(painting, `dial ${dial}`).toHaveLength(1);
            const p = painting[0];
            const stroke = Math.floor(dial);
            const R = stroke < 7 ? frame.R1 : frame.R2;
            expect(Math.hypot(...p.pos), `dial ${dial}`).toBeCloseTo(PAINT_DISTANCE, 6);
            expect(angleBetween(p.pos, frame.A) / DEG, `dial ${dial}`).toBeCloseTo((R - 0.6 * DEG) / DEG, 6);
            expect(p.colour, `dial ${dial}`).toEqual(LINKS[stroke]);
            expect(p.trail, `dial ${dial}`).toBe(1);
            // Gliding the stroke, wings spread.
            expect(Math.abs(p.wings[0] - WING.dihedral), `dial ${dial}`).toBeLessThan(0.15);
        }
        expect(f.sample(9, bowAt(3), 1).filter((p) => p.mode === 1)).toHaveLength(0);
    });

    it('moves the brush along its stroke from phi0 toward phi1 as the dial rises', () => {
        const f = flock();
        const s = frame.strokes1[1];
        const at = (dial) => f.sample(5, bowAt(dial), 1).find((p) => p.mode === 1).pos.slice();
        const first = at(1.1);
        const mid = at(1.5);
        const last = at(1.9);
        const start = angleBetween(first, frame.A);
        expect(angleBetween(mid, frame.A)).toBeCloseTo(start, 9);
        // Further round the circle each step, in the stroke's own direction.
        const phiOf = (pos) => Math.atan2(
            pos[0] * frame.basis.right[0] + pos[1] * frame.basis.right[1] + pos[2] * frame.basis.right[2],
            pos[0] * frame.basis.down[0] + pos[1] * frame.basis.down[1] + pos[2] * frame.basis.down[2],
        );
        const dir = Math.sign(s.phi1 - s.phi0);
        expect(Math.sign(phiOf(mid) - phiOf(first))).toBe(dir);
        expect(Math.sign(phiOf(last) - phiOf(mid))).toBe(dir);
    });

    it('dives a painter in from its flock with folded wings and flies it home after: no jump, no snapped lean', () => {
        const f = flock();
        // A chain of three from t = 20, broken at 26.
        const bowFor = painter((t) => (t >= 20 && t < 26 ? 3 : 0));
        const worst = fly(f, 18, 40, bowFor);
        // No glider crosses more than ~2° of the view in a frame (the old painter jumped to the bow).
        expect(worst.angle / DEG, JSON.stringify(worst.at)).toBeLessThan(2);
        expect(worst.bank).toBeLessThan(0.35);
        // Where the first painter was the frame before it was called, and just after: in its flock.
        const g = (f2) => f2.poses.findIndex((p) => p.mode === 1);
        const f2 = flock();
        const bow2 = painter((t) => (t < 20 ? 0 : 1));
        for (let t = 19; t < 20.02; t += DT) f2.sample(t, bow2(t), 1);
        const who = g(f2);
        expect(who).toBeGreaterThanOrEqual(0);
        const p = f2.poses[who];
        const thermal = f2.thermals.reduce((a, b) => (across(p.pos, a.pos) < across(p.pos, b.pos) ? a : b));
        expect(across(p.pos, thermal.pos)).toBeLessThan(120);
        // It dives with its wings folded up in a V.
        let tucked = 0;
        for (let t = 20.02; t < 20.5; t += DT) {
            const q = f2.sample(t, bow2(t), 1)[who];
            tucked = Math.max(tucked, q.wings[0]);
        }
        expect(tucked).toBeGreaterThan(WING.dihedral + 0.4);
        // Long after the chain broke, everyone is home: at rest, white, trail-less.
        const home = f.sample(40, bowFor(40), 1);
        expect(home.every((q) => q.mode === 0 && q.trail === 0)).toBe(true);
    });

    it('raises the T-spin\'s double helix in its window, joined from the flock and flown home after', () => {
        const f = flock();
        const from = [-80, -10, -120];
        f.helix(from, 50);
        expect(f.sample(49.9, bowAt(0), 1).filter((p) => p.mode === 2)).toHaveLength(0);
        // Once they have joined it: two gliders round one axis, opposite each other, rising.
        const during = f.sample(51.7, bowAt(0), 1).filter((p) => p.mode === 2);
        expect(during).toHaveLength(2);
        const [a, b] = during;
        expect(Math.hypot(a.pos[0] - from[0], a.pos[2] - from[2])).toBeCloseTo(4, 6);
        expect(Math.hypot(a.pos[0] - b.pos[0], a.pos[2] - b.pos[2])).toBeCloseTo(8, 6);
        const risen = a.pos[1];
        expect(risen).toBeGreaterThan(from[1]);
        const higher = f.sample(52.0, bowAt(0), 1).find((p) => p.mode === 2);
        expect(higher.pos[1]).toBeGreaterThan(risen);
        // Beating their wings as they rise.
        expect(Math.abs(higher.wings[0] - WING.dihedral)).toBeGreaterThan(0);
        expect(f.sample(50 + FLIGHT.helixSeconds + 0.05, bowAt(0), 1).filter((p) => p.mode === 2)).toHaveLength(0);
        const g = flock();
        g.helix(from, 50);
        const worst = fly(g, 49, 60, () => bowAt(0));
        // The helix itself rises fast (its own design); the join and the way home never jump.
        expect(worst.angle / DEG, JSON.stringify(worst.at)).toBeLessThan(2);
        expect(worst.bank).toBeLessThan(0.35);
    });

    it('sails the level-up flight out from the isle in its window, gathered from the nearest flock', () => {
        const f = flock();
        const from = placement.spring.pos.slice();
        from[1] += 60;
        f.launch(from, 30);
        expect(f.sample(29.9, bowAt(0), 1).filter((p) => p.mode === 3)).toHaveLength(0);
        expect(f.sample(30.5, bowAt(0), 1).filter((p) => p.mode === 3).length).toBeGreaterThan(0);
        const mid = f.sample(32.5, bowAt(0), 1).filter((p) => p.mode === 3);
        expect(mid).toHaveLength(Math.min(12, CAPACITY));
        // Out over the gulf: further from where they left as the flight goes on.
        const spread = (set) => Math.max(...set.map((p) => Math.hypot(p.pos[0] - from[0], p.pos[2] - from[2])));
        const midSpread = spread(mid);
        const later = f.sample(35, bowAt(0), 1).filter((p) => p.mode === 3);
        expect(spread(later)).toBeGreaterThan(midSpread);
        expect(f.sample(36.6, bowAt(0), 1).filter((p) => p.mode === 3)).toHaveLength(0);
        // The isle's flock goes first.
        const near = f.launchOrderFor(CAPACITY).slice(0, 4).map((i) => f.traits[i].group);
        expect(new Set(near).size).toBe(1);
        const g = flock();
        g.launch(from, 30);
        const worst = fly(g, 29, 46, () => bowAt(0));
        expect(worst.angle / DEG, JSON.stringify(worst.at)).toBeLessThan(2);
        expect(worst.bank).toBeLessThan(0.35);
    });

    it('fades out the gliders the hour keeps home (the last climbing away), parking the rest out of sight', () => {
        const f = flock();
        for (const aloft of [1, 0.75, 0.5, 0.2, 0]) {
            const poses = f.sample(15, bowAt(0), aloft);
            const share = Math.max(2, CAPACITY * aloft);
            let last = 1;
            poses.forEach((p, i) => {
                // Presence never rises along the line: the whole ones, then the fading one.
                expect(p.presence, `aloft ${aloft} glider ${i}`).toBeLessThanOrEqual(last);
                last = p.presence;
                if (i <= share - 0.5) {
                    expect(p.presence, `aloft ${aloft} glider ${i}`).toBe(1);
                    expect(p.scale, `aloft ${aloft} glider ${i}`).toBeGreaterThan(0);
                } else if (i >= share + 0.5) {
                    expect(p.scale, `aloft ${aloft} glider ${i}`).toBe(0);
                    expect(p.pos[1], `aloft ${aloft} glider ${i}`).toBeLessThan(-1e4);
                }
            });
        }
        // As the share falls, the glider at its edge shrinks smoothly (never pops).
        const sizes = [];
        for (let a = 0.6; a >= 0.5; a -= 0.005) sizes.push(f.sample(15, bowAt(0), a)[11].scale);
        for (let k = 1; k < sizes.length; k++) expect(Math.abs(sizes[k] - sizes[k - 1])).toBeLessThan(0.15);
        // No thermals yet: every glider is parked.
        const homeless = new GliderFlock(CAPACITY, 33);
        expect(homeless.sample(15, null, 1).every((p) => p.scale === 0)).toBe(true);
    });

    it('keeps the long-wing on the bow\'s leg while a back-to-back holds, and flies it home after', () => {
        const f = flock();
        expect(f.sample(10, bowAt(0), 1).filter((p) => p.mode === 4)).toHaveLength(0);
        f.setLongWing(true, 5);
        expect(f.longWing).toBe(true);
        const wing = f.sample(10, bowAt(0), 1).filter((p) => p.mode === 4);
        expect(wing).toHaveLength(1);
        expect(angleBetween(wing[0].pos, frame.A) / DEG).toBeCloseTo((frame.R1 - 1.2 * DEG) / DEG, 6);
        expect(wing[0].scale).toBeGreaterThan(1);
        f.setLongWing(false, 12);
        expect(f.longWing).toBe(false);
        expect(f.sample(12.5, bowAt(0), 1).filter((p) => p.mode === 4)).toHaveLength(0);
        const g = flock();
        g.setLongWing(true, 5);
        const worst = fly(g, 4, 11.9, () => bowAt(0));
        g.setLongWing(false, 12);
        const after = fly(g, 11.9, 20, () => bowAt(0));
        expect(Math.max(worst.angle, after.angle) / DEG).toBeLessThan(2);
        expect(Math.max(worst.bank, after.bank)).toBeLessThan(0.35);
        // A seek forgets it.
        g.resetEvents();
        expect(g.longWing).toBe(false);
    });

    it('beats its wings now and then at rest and glides between, never past the beat\'s swing', () => {
        const f = flock();
        let still = 0;
        let beating = 0;
        for (let t = 0; t < 120; t += 0.07) {
            const p = f.sample(t, bowAt(0), 1)[3];
            const off = Math.abs(p.wings[0] - WING.dihedral);
            expect(off).toBeLessThanOrEqual(WING.shoulderBeat + 0.1);
            if (off < 0.1) still += 1; else if (off > 0.3) beating += 1;
        }
        // Mostly gliding, with bursts of beats.
        expect(still).toBeGreaterThan(beating);
        expect(beating).toBeGreaterThan(5);
    });

    it('costs well under a millisecond a frame on the CPU', () => {
        const f = flock();
        const bowFor = painter((t) => (t < 2 ? 0 : 4));
        f.helix([-80, -10, -120], 3);
        const start = performance.now();
        let n = 0;
        for (let t = 0; t < 8; t += DT) { f.sample(t, bowFor(t), 1); n += 1; }
        expect((performance.now() - start) / n).toBeLessThan(1.5);
    });
});
