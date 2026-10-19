/**
 * Ocean — the sea's large visitors (src/themes/ocean/ocean-visits.js): the schedule they come on,
 * the routes they swim and the poses along them. All three-free, checked on the CPU.
 */
import { describe, expect, it } from 'vitest';
import {
    ACTS, ACT_NAMES, CAST, FIRST_VISIT, KINDS, SLOT_BASE, SLOT_TOTAL, VISITS_AT_ONCE, laneVisit, makeVisit, planVisits,
    poseOnRoute, reachAt,
} from '../../src/themes/ocean/ocean-visits.js';
import {
    EYE, LANES, PASS_SECONDS, SURFACE, seabedHeight,
} from '../../src/themes/ocean/ocean-core.js';
import { HOURS } from '../../src/themes/ocean/ocean-hours.js';
import { planKelp } from '../../src/themes/ocean/ocean-plan.js';

const HOUR = 3600;

/** Every member's pose of a visit at a time, or [] when none is in the water. */
function posesAt(visit, t, squeeze = 1) {
    const out = [];
    visit.members.forEach((member) => {
        const pose = poseOnRoute(visit, member, t - visit.start, squeeze, {});
        if (pose.k >= 0 && pose.k <= 1) out.push(pose);
    });
    return out;
}

/** The clearest water any hour has (green, the channel the eye reads shapes by). */
const CLEAREST = Math.min(...HOURS.map((h) => h.ext[1]));

describe('Ocean visits: the cast', () => {
    it('numbers the kinds as the creature pack does, and gives each its own run of slots', () => {
        expect(KINDS).toHaveLength(9);
        expect(SLOT_BASE[KINDS[0]]).toBe(0);
        let next = 0;
        KINDS.forEach((kind) => {
            expect(SLOT_BASE[kind]).toBe(next);
            next += CAST[kind].slots;
        });
        expect(SLOT_TOTAL).toBe(next);
    });

    it('has room for every member of every act, besides what the board may call at once', () => {
        const called = { humpback: 2, manta: 3, turtle: 1 };
        ACT_NAMES.forEach((name) => {
            const act = ACTS[name];
            let most = 0;
            for (let seed = 1; seed <= 40; seed++) most = Math.max(most, makeVisit(name, 0, seed, 1).members.length);
            expect(most + (called[act.kind] || 0), name).toBeLessThanOrEqual(CAST[act.kind].slots);
        });
    });
});

describe('Ocean visits: the schedule', () => {
    it('is the same for the same seed whichever way the clock is read, and another for another seed', () => {
        const a = planVisits(7);
        const b = planVisits(7);
        // Read one forward, the other from the far end back.
        for (let t = 0; t < 900; t += 13) a.at(t);
        b.at(900);
        expect(a.until(900).map((v) => [v.act, v.start])).toEqual(b.until(900).map((v) => [v.act, v.start]));
        const c = planVisits(8);
        expect(c.until(900).map((v) => v.act)).not.toEqual(a.until(900).map((v) => v.act));
    });

    it('sends the first visitor soon after the session starts, and nobody before', () => {
        for (let seed = 1; seed <= 30; seed++) {
            const plan = planVisits(seed);
            const [first] = plan.until(60);
            expect(first.start).toBeGreaterThanOrEqual(FIRST_VISIT[0]);
            expect(first.start).toBeLessThanOrEqual(FIRST_VISIT[1]);
            expect(plan.at(first.start - 0.1)).toEqual([]);
        }
    });

    it('comes at irregular times: short and long gaps, overlaps and long empty stretches', () => {
        const gaps = [];
        let overlaps = 0;
        let longQuiet = 0;
        for (let seed = 1; seed <= 12; seed++) {
            const visits = planVisits(seed).until(HOUR);
            for (let i = 1; i < visits.length; i++) {
                gaps.push(visits[i].start - visits[i - 1].start);
                if (visits[i].start < visits[i - 1].end) overlaps += 1;
                if (visits[i].start - visits[i - 1].end > 40) longQuiet += 1;
            }
        }
        const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
        const sd = Math.sqrt(gaps.reduce((a, b) => a + (b - mean) ** 2, 0) / gaps.length);
        expect(mean).toBeGreaterThan(30);
        expect(mean).toBeLessThan(70);
        // Not a metronome: the gaps spread widely.
        expect(sd / mean).toBeGreaterThan(0.3);
        expect(Math.min(...gaps)).toBeLessThan(25);
        expect(Math.max(...gaps)).toBeGreaterThan(90);
        expect(overlaps).toBeGreaterThan(gaps.length * 0.08);
        expect(longQuiet).toBeGreaterThan(gaps.length * 0.05);
    });

    it('keeps the water busy part of the time, not all of it, and never more than two at once', () => {
        for (let seed = 1; seed <= 6; seed++) {
            const plan = planVisits(seed);
            let busy = 0;
            const n = HOUR / 2;
            for (let t = 0; t < HOUR; t += 2) {
                const live = plan.at(t);
                expect(live.length).toBeLessThanOrEqual(VISITS_AT_ONCE);
                if (live.length) busy += 1;
            }
            expect(busy / n).toBeGreaterThan(0.45);
            expect(busy / n).toBeLessThan(0.9);
        }
    });

    it('never sends the same kind twice running, and keeps the rare ones rare', () => {
        const count = {};
        for (let seed = 1; seed <= 20; seed++) {
            const visits = planVisits(seed).until(HOUR);
            for (let i = 1; i < visits.length; i++) expect(visits[i].kind).not.toBe(visits[i - 1].kind);
            visits.forEach((v) => { count[v.act] = (count[v.act] || 0) + 1; });
        }
        // Every act turns up within twenty hours.
        ACT_NAMES.forEach((name) => expect(count[name] || 0, name).toBeGreaterThan(0));
        expect(count.blueWhale).toBeLessThan(count.humpback);
        expect(count.sunfish).toBeLessThan(count.manta);
    });
});

describe('Ocean visits: routes and poses', () => {
    it('reaches far enough to begin and end every crossing out of the frame', () => {
        [-60, -30, -10].forEach((z) => {
            expect(reachAt(z, 13)).toBeGreaterThan(Math.tan((41 * Math.PI) / 180) * (EYE.z - z) + 6.5);
        });
    });

    it('comes in out of sight and leaves out of sight: off the frame or lost in the blue', () => {
        const half = (41 * Math.PI) / 180;
        for (let seed = 1; seed <= 6; seed++) {
            planVisits(seed).until(HOUR / 2).forEach((visit) => {
                [0.002, 0.998].forEach((k) => {
                    const t = visit.start + k * visit.seconds;
                    visit.members.forEach((member) => {
                        const pose = poseOnRoute(visit, member, t - visit.start + member.lag * visit.seconds, 1, {});
                        const dz = EYE.z - pose.z;
                        const dist = Math.hypot(pose.x, pose.y - EYE.y, dz);
                        const angle = Math.atan2(Math.abs(pose.x), Math.max(dz, 0.01));
                        const offFrame = angle - Math.asin(Math.min(1, (pose.scale * 0.55) / dist)) > half;
                        const lost = Math.exp(-CLEAREST * 0.84 * dist) < 0.06;
                        expect(offFrame || lost || pose.presence < 0.02, `${visit.act} at k=${k}`).toBe(true);
                    });
                });
            });
        }
    });

    it('keeps every animal in the water: over the sand, under the surface', () => {
        for (let seed = 1; seed <= 6; seed++) {
            const plan = planVisits(seed);
            for (let t = 0; t < HOUR / 2; t += 1.5) {
                plan.at(t).forEach((visit) => {
                    posesAt(visit, t).forEach((pose) => {
                        const cast = CAST[visit.kind];
                        const size = Math.max(0.45, pose.scale / cast.metres);
                        const keep = cast.clear * size * 0.6;
                        expect(pose.y + cast.top * size * 0.6, `${visit.act} under the surface`).toBeLessThan(SURFACE);
                        expect(pose.y - keep, `${visit.act} over the sand`).toBeGreaterThan(seabedHeight(pose.x, pose.z));
                    });
                });
            }
        }
    });

    it('heads the way it swims, its up square to its heading, and never flips over between frames', () => {
        for (let seed = 1; seed <= 4; seed++) {
            // (A somersault turns right over on purpose, quickly: the test after this one has it.)
            planVisits(seed).until(HOUR / 3).filter((visit) => !visit.route.loop).forEach((visit) => {
                visit.members.forEach((member) => {
                    let last = null;
                    for (let tau = 0; tau < visit.seconds; tau += 0.25) {
                        const pose = poseOnRoute(visit, member, tau, 1, {});
                        if (!(pose.k >= 0.01 && pose.k <= 0.99)) continue;
                        expect(Math.hypot(pose.fx, pose.fy, pose.fz)).toBeCloseTo(1, 5);
                        expect(Math.hypot(pose.ux, pose.uy, pose.uz)).toBeCloseTo(1, 5);
                        expect(Math.abs(pose.fx * pose.ux + pose.fy * pose.uy + pose.fz * pose.uz)).toBeLessThan(1e-6);
                        if (last) {
                            const moved = [pose.x - last.x, pose.y - last.y, pose.z - last.z];
                            const wove = member.weave + 0.2;
                            if (Math.hypot(...moved) > wove) {
                                expect(moved[0] * pose.fx + moved[1] * pose.fy + moved[2] * pose.fz).toBeGreaterThan(0);
                            }
                            expect(pose.ux * last.ux + pose.uy * last.uy + pose.uz * last.uz, visit.act).toBeGreaterThan(0.9);
                        }
                        last = pose;
                    }
                });
            });
        }
    });

    it('turns a manta right over in its somersault, smoothly', () => {
        const visit = makeVisit('mantaLoop', 0, 3, 1);
        let lowest = 1;
        let last = null;
        for (let tau = 0; tau < visit.seconds; tau += 0.1) {
            const pose = poseOnRoute(visit, visit.members[0], tau, 1, {});
            lowest = Math.min(lowest, pose.uy);
            if (last) expect(pose.ux * last.ux + pose.uy * last.uy + pose.uz * last.uz).toBeGreaterThan(0.95);
            last = pose;
        }
        // Upside down at the top of the loop.
        expect(lowest).toBeLessThan(-0.5);
    });

    it('gives a stroke a steady rate and lets it swell and fall into glides', () => {
        const visit = makeVisit('humpback', 0, 5, -1);
        const member = visit.members[0];
        const a = poseOnRoute(visit, member, 10, 1, {});
        const b = poseOnRoute(visit, member, 10.5, 1, {});
        const c = poseOnRoute(visit, member, 20, 1, {});
        const d = poseOnRoute(visit, member, 20.5, 1, {});
        // (The phase is a closed form of the clock: the same step in phase for the same step in time.)
        expect(b.phase - a.phase).toBeCloseTo(d.phase - c.phase, 9);
        const beats = [];
        for (let tau = 0; tau < visit.seconds; tau += 0.5) beats.push(poseOnRoute(visit, member, tau, 1, {}).beat);
        expect(Math.max(...beats) - Math.min(...beats)).toBeGreaterThan(0.3);
        expect(Math.min(...beats)).toBeGreaterThan(0);
    });

    it('swims a called animal along its lane, out of sight at both ends', () => {
        const member = {
            lag: 0, off: [0, 0, 0], weave: 0, weaveRate: 0, weavePhase: 0, scale: 1, phase: 0, variant: 0, roll: 0,
        };
        Object.entries({ turtle: 'turtle', manta: 'manta', whale: 'humpback' }).forEach(([lane, kind]) => {
            const visit = laneVisit(kind, LANES[lane], 0, PASS_SECONDS[lane], LANES[lane].side, [member]);
            const start = poseOnRoute(visit, member, 0, 1, {});
            const end = poseOnRoute(visit, member, visit.seconds, 1, {});
            expect(Math.sign(start.x)).toBe(LANES[lane].side);
            expect(Math.sign(end.x)).toBe(-LANES[lane].side);
        });
    });
});

describe('Ocean visits: in sight', () => {
    // From the rest eye at 16:9 with the board in the middle, the kelp on both shoulders and the
    // reef leave little open water: a lane that ran behind them (the old far whale's, at 52 m)
    // was never seen. Every act must spend a good while where the eye can see it.
    const pitchUp = (13 * Math.PI) / 180;
    const wide = Math.tan((41 * Math.PI) / 180);
    const tall = wide / (16 / 9);
    const stands = planKelp(26);
    const seenFromReef = (x, y, z) => {
        const dy = y - EYE.y;
        const dz = z - EYE.z;
        const along = dy * Math.sin(pitchUp) - dz * Math.cos(pitchUp);
        if (along < 0.5) return false;
        const sx = 0.5 + (0.5 * (x / along)) / wide;
        const sy = 0.5 - (0.5 * ((dy * Math.cos(pitchUp) + dz * Math.sin(pitchUp)) / along)) / tall;
        // (Not hugging the frame's edge: the surface glare at the top, the frame's sides.)
        if (sx < 0.02 || sx > 0.98 || sy < 0.06 || sy > 0.94) return false;
        // The card and its HUD.
        if (sx > 0.39 && sx < 0.61) return false;
        if (sx > 0.645 && sx < 0.76 && sy > 0.25 && sy < 0.75) return false;
        // The kelp: a stand is a column, wider toward its canopy.
        for (const k of stands) {
            const t = Math.max(0, Math.min(1, (x * k.x + dz * (k.z - EYE.z)) / (x * x + dz * dz)));
            const off = Math.hypot(x * t - k.x, dz * t - (k.z - EYE.z));
            const f = (EYE.y + dy * t - k.y) / k.height;
            if (f > 0 && f < 1 && t < 0.999 && off < 1.2 + 1.6 * f) return false;
        }
        // The reef under the line of sight.
        for (let i = 1; i < 16; i++) {
            const t = i / 16;
            if (EYE.y + dy * t < seabedHeight(x * t, EYE.z + dz * t) + 0.3) return false;
        }
        return true;
    };

    it.each(ACT_NAMES)('%s is in plain sight beside the board for a good while of its pass', (name) => {
        let seconds = 0;
        let barely = 0;
        const runs = 6;
        for (let seed = 1; seed <= runs / 2; seed++) {
            for (const side of [-1, 1]) {
                const visit = makeVisit(name, 0, seed, side);
                const { metres } = CAST[visit.kind];
                let seen = 0;
                for (let tau = 0; tau <= visit.seconds; tau += 1) {
                    const p = poseOnRoute(visit, visit.members[0], tau, 1, {});
                    if (!(p.k >= 0 && p.k <= 1)) continue;
                    let points = 0;
                    for (let i = 0; i < 5; i++) {
                        const s = (i / 4 - 0.5) * metres * 0.9;
                        if (seenFromReef(p.x + p.fx * s, p.y + p.fy * s, p.z + p.fz * s)) points += 1;
                    }
                    if (points >= 2) seen += 1;
                }
                seconds += seen;
                if (seen < 3) barely += 1;
            }
        }
        expect(seconds / runs, name).toBeGreaterThan(6);
        expect(barely, name).toBeLessThanOrEqual(1);
    });
});
