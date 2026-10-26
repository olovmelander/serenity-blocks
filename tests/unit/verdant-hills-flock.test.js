/**
 * Verdant Hills — the flock's mind (src/themes/verdant-hills/verdant-hills-flock.js): where every
 * ewe and lamb goes and what it does, and what the game does to them. Three-free: a small meadow
 * of its own (a gentle slope with a pond in it) stands in for the downs, so the behaviour is
 * tested on its own; the last block runs the real layout on the real pasture.
 */
import { describe, expect, it } from 'vitest';
import { FLOCK, VerdantHillsFlock } from '../../src/themes/verdant-hills/verdant-hills-flock.js';
import {
    VERDANT_HILLS_FLOCK_HOMES, createVerdantHillsPasture, layoutVerdantHillsSheep,
} from '../../src/themes/verdant-hills/verdant-hills-layout.js';

const WIND = { x: 0.5, z: -0.866 };
const POND = { x: 14, z: 0, r: 5 };

/** A meadow: a gentle slope, grass out to sixty metres from the middle, a pond in it. */
const MEADOW = Object.freeze({
    ground: (x, z) => 0.03 * x - 0.02 * z,
    allowed: (x, z) => Math.hypot(x, z) < 60 && Math.hypot(x - POND.x, z - POND.z) > POND.r,
    seen: () => true,
});

/** A group of `ewes` ewes and `lambs` lambs (the first ewes' twins and singles) about (x, z). */
function herd(group, x, z, ewes, lambs, heading = 0) {
    const out = [];
    for (let e = 0; e < ewes; e += 1) {
        const a = (e / ewes) * Math.PI * 2;
        const ewe = {
            x: x + Math.cos(a) * 4, z: z + Math.sin(a) * 4, yaw: heading, scale: 1.15, group, lamb: false, mother: -1,
        };
        out.push(ewe);
    }
    return out.concat(Array.from({ length: lambs }, (_, l) => ({
        x: x + Math.cos(l) * 1.5,
        z: z + Math.sin(l) * 1.5,
        yaw: heading,
        scale: 1.12,
        group,
        lamb: true,
        mother: l % ewes,
    })));
}

/** Entries in the layout's order: each ewe, then her lambs (mother indices into the list). */
function ordered(groups) {
    const out = [];
    groups.forEach((members) => {
        const ewes = members.filter((s) => !s.lamb);
        ewes.forEach((ewe, e) => {
            const index = out.length;
            out.push({ ...ewe });
            members.filter((s) => s.lamb && s.mother === e).forEach((lamb) => out.push({ ...lamb, mother: index }));
        });
    });
    return out;
}

const make = (groups = [herd(0, -20, 10, 5, 4)], seed = 11) => new VerdantHillsFlock({
    entries: ordered(groups), land: MEADOW, seed, wind: WIND,
});

const CALM = Object.freeze({
    fronts: [], festival: 0, settled: false, motion: 1, level: 0, fever: 0, mood: 0,
});

/** Step a flock `seconds` at 60 Hz; `each(time)` may hand back an environment for the step. */
function run(flock, seconds, each = () => CALM) {
    const dt = 1 / 60;
    const steps = Math.round(seconds * 60);
    for (let i = 0; i < steps; i += 1) flock.step(dt, each(flock.time) || CALM);
}

/** A front of wind sweeping down the wind from behind the flock to well past it, `strength` strong. */
function front(start, strength) {
    return (time) => {
        const t = time - start;
        if (t < 0 || t > 3) return CALM;
        return { ...CALM, fronts: [{ along: -60 + t * 60, width: 20, strength }] };
    };
}

const centre = (members) => ({
    x: members.reduce((sum, s) => sum + s.x, 0) / members.length,
    z: members.reduce((sum, s) => sum + s.z, 0) / members.length,
});

describe('Verdant Hills flock: one flock from one seed', () => {
    it('replays the same flock from the same seed, and starts over where it began', () => {
        const a = make();
        const b = make();
        const start = a.sheep.map((s) => [s.x, s.z, s.heading]);
        run(a, 40, front(10, 0.8));
        run(b, 40, front(10, 0.8));
        a.sheep.forEach((s, i) => {
            expect(s.x).toBe(b.sheep[i].x);
            expect(s.z).toBe(b.sheep[i].z);
            expect(s.act).toBe(b.sheep[i].act);
            expect(s.posture.world).toEqual(b.sheep[i].posture.world);
        });
        a.reset();
        a.sheep.forEach((s, i) => expect([s.x, s.z, s.heading]).toEqual(start[i]));
        expect(a.time).toBe(0);
        // Another seed lives another day.
        const c = make(undefined, 12);
        run(c, 40, front(10, 0.8));
        a.reset();
        run(a, 40, front(10, 0.8));
        expect(c.sheep.some((s, i) => Math.abs(s.x - a.sheep[i].x) > 1e-6)).toBe(true);
    });

    it('starts the day in the middle of things: grazing, looking about, a lamb lying down', () => {
        const flock = make([herd(0, -20, 10, 8, 6)]);
        const census = flock.census();
        expect(census.graze).toBeGreaterThan(2);
        expect((census.heel || 0) + (census.lie || 0)).toBe(6);
        flock.sheep.forEach((s) => expect(s.posture.world.every((q) => q.every(Number.isFinite))).toBe(true));
    });
});

describe('Verdant Hills flock: grazing', () => {
    it('grazes heads down most of the time, a stride at a time, and never walks into the water', () => {
        const flock = make();
        let heads = 0;
        let samples = 0;
        let fastest = 0;
        run(flock, 300, (time) => {
            if (Math.round(time * 60) % 30 === 0) {
                flock.sheep.forEach((s) => {
                    expect(MEADOW.allowed(s.x, s.z), `${s.index} at ${s.x.toFixed(1)},${s.z.toFixed(1)}`).toBe(true);
                    if (!s.lamb) {
                        samples += 1;
                        if (s.act === 'Graze') heads += 1;
                        if (s.mode === 'graze') fastest = Math.max(fastest, s.speed);
                    }
                });
            }
            return CALM;
        });
        expect(heads / samples).toBeGreaterThan(0.45);
        // Cropping on: a slow step, never a trot.
        expect(fastest).toBeLessThan(FLOCK.walk);
        // The lambs keep to their mothers.
        flock.sheep.filter((s) => s.lamb && s.mode === 'heel').forEach((s) => {
            const m = flock.sheep[s.mother];
            expect(Math.hypot(m.x - s.x, m.z - s.z)).toBeLessThan(8);
        });
    });

    it('keeps the group together while its ground drifts over the pasture', () => {
        const flock = make();
        const ewes = flock.sheep.filter((s) => !s.lamb);
        run(flock, 240);
        const c = centre(ewes);
        ewes.forEach((s) => expect(Math.hypot(s.x - c.x, s.z - c.z)).toBeLessThan(20));
        // Nobody stands inside anybody else (side by side, two fleeces touch half a metre apart).
        for (let i = 0; i < ewes.length; i += 1) {
            for (let j = i + 1; j < ewes.length; j += 1) {
                expect(Math.hypot(ewes[i].x - ewes[j].x, ewes[i].z - ewes[j].z)).toBeGreaterThan(0.5);
            }
        }
    });

    it('lets a lamb suckle: it goes under its mother, and she stands for it with her head round to it', () => {
        const flock = make([herd(0, -20, 10, 3, 3)], 5);
        let suckled = 0;
        let nursed = 0;
        run(flock, 600, () => {
            flock.sheep.forEach((s) => {
                if (s.act === 'Suckle') {
                    suckled += 1;
                    const m = flock.sheep[s.mother];
                    expect(Math.hypot(m.x - s.x, m.z - s.z)).toBeLessThan(1.4);
                }
                if (s.act === 'Nurse') nursed += 1;
            });
            return CALM;
        });
        expect(suckled).toBeGreaterThan(60 * 10);
        expect(nursed).toBeGreaterThan(60 * 10);
    });
});

describe('Verdant Hills flock: moving on', () => {
    it('sends a ewe ahead to fresh grass and strings the rest out behind her in single file', () => {
        const flock = make([herd(0, -25, 0, 6, 3)], 3);
        const g = flock.groups[0];
        expect(flock.moveOn(g, 0)).toBe(true);
        const leader = flock.sheep[g.leader];
        let filed = 0;
        run(flock, 40, () => {
            if (g.mode === 'move' && flock.time > 24) {
                // Once the file has formed, every ewe walks within a hand of the line the leader walked.
                g.ewes.filter((s) => s !== leader && s.mode === 'follow' && s.speed > 0.4).forEach((s) => {
                    let near = Infinity;
                    for (let k = 0; k < g.trailLength; k += 1) {
                        near = Math.min(near, Math.hypot(g.trail[k * 2] - s.x, g.trail[k * 2 + 1] - s.z));
                    }
                    expect(near).toBeLessThan(0.6);
                    filed += 1;
                });
            }
            return CALM;
        });
        expect(filed).toBeGreaterThan(100);
        for (let k = 0; k < 150 * 60 && g.mode === 'move'; k += 1) flock.step(1 / 60, CALM);
        // Arrived, they graze there.
        expect(g.mode).toBe('graze');
        expect(Math.hypot(g.cx - g.targetX, g.cz - g.targetZ)).toBeLessThan(0.3);
        run(flock, 30);
        expect(Math.hypot(centre(g.ewes).x - g.targetX, centre(g.ewes).z - g.targetZ)).toBeLessThan(10);
    });

    it('moves a group or two on to fresh grass at a new level', () => {
        const flock = make([herd(0, -25, 10, 4, 2), herd(1, 20, -30, 4, 2)]);
        run(flock, 5);
        flock.onLevel();
        expect(flock.groups.filter((g) => g.mode === 'move').length).toBeGreaterThan(0);
    });
});

describe('Verdant Hills flock: what the game does to them', () => {
    it('lifts heads and sets the lambs frisking as a front of wind crosses them', () => {
        const flock = make([herd(0, -20, 10, 6, 5)], 9);
        run(flock, 5);
        let up = 0;
        let frisks = 0;
        run(flock, 4, (time) => {
            const env = front(5, 0.64)(time);
            flock.sheep.forEach((s) => {
                if (!s.lamb && (s.mode === 'look' || s.mode === 'walk')) up += 1;
                if (s.lamb && (s.act === 'Pronk' || s.act === 'Twist')) frisks += 1;
            });
            return env;
        });
        expect(up / (4 * 60)).toBeGreaterThan(3);
        expect(frisks).toBeGreaterThan(0);
    });

    it('reaches the nearer group first: the front goes down the wind', () => {
        // Group 0 is up the wind of group 1.
        const flock = make([herd(0, -10, 20, 4, 0), herd(1, 15, -25, 4, 0)]);
        const along = flock.groups.map((g) => g.cx * WIND.x + g.cz * WIND.z);
        expect(along[0]).toBeLessThan(along[1]);
        const first = [null, null];
        run(flock, 6, (time) => {
            const env = front(1, 0.64)(time);
            flock.groups.forEach((g, i) => {
                if (first[i] === null && g.ewes.some((s) => s.mode === 'look' || s.mode === 'walk')) first[i] = time;
            });
            return env;
        });
        expect(first[0]).not.toBeNull();
        expect(first[1]).not.toBeNull();
        expect(first[0]).toBeLessThan(first[1]);
    });

    it('sends the flock galloping off down the wind at four lines, then has it stand and stare back', () => {
        const flock = make([herd(0, -25, 15, 6, 4)], 4);
        run(flock, 3);
        const g = flock.groups[0];
        const before = centre(g.ewes);
        let fastest = 0;
        run(flock, 9, (time) => {
            g.ewes.forEach((s) => {
                fastest = Math.max(fastest, s.speed);
            });
            return front(3.5, 0.98)(time);
        });
        expect(fastest).toBeGreaterThan(3.3);
        const after = centre(g.ewes);
        const run1 = (after.x - before.x) * WIND.x + (after.z - before.z) * WIND.z;
        expect(run1).toBeGreaterThan(10);
        // Pulled up (within a few seconds), they stand facing the way the fright came (up the wind).
        for (let k = 0; k < 15 * 60 && g.ewes.some((s) => s.mode === 'flee'); k += 1) flock.step(1 / 60, CALM);
        // (Wheeling round takes a moment.)
        run(flock, 2.5);
        const staring = g.ewes.filter((s) => s.mode === 'stare');
        expect(staring.length).toBeGreaterThan(g.ewes.length / 2);
        staring.forEach((s) => {
            const toAlarm = Math.atan2(g.alarmX - s.x, g.alarmZ - s.z);
            const off = Math.abs(Math.atan2(Math.sin(toAlarm - s.heading), Math.cos(toAlarm - s.heading)));
            expect(off).toBeLessThan(1.0);
        });
        // And they go back to grazing.
        run(flock, 40);
        expect(g.ewes.filter((s) => s.mode === 'graze' || s.mode === 'look').length).toBeGreaterThan(g.ewes.length / 2);
        expect(g.mode).toBe('graze');
    });

    it('never bolts under Reduce motion: the gale only lifts their heads', () => {
        const flock = make([herd(0, -25, 15, 6, 4)], 4);
        run(flock, 3);
        let fastest = 0;
        run(flock, 10, (time) => {
            flock.sheep.forEach((s) => {
                if (!s.lamb) fastest = Math.max(fastest, s.speed);
            });
            return { ...front(3.5, 0.98)(time), motion: 0.35 };
        });
        expect(fastest).toBeLessThan(FLOCK.trot);
        expect(flock.sheep.every((s) => s.mode !== 'flee' && s.mode !== 'race')).toBe(true);
    });

    it('sets the lambs racing at the kite festival, and brings them home to their mothers', () => {
        const flock = make([herd(0, -20, 10, 4, 4)], 2);
        run(flock, 3);
        let raced = 0;
        let farthest = 0;
        run(flock, 40, (time) => {
            flock.sheep.filter((s) => s.lamb).forEach((s) => {
                if (s.mode === 'race') {
                    raced += 1;
                    const m = flock.sheep[s.mother];
                    farthest = Math.max(farthest, Math.hypot(m.x - s.x, m.z - s.z));
                }
            });
            return { ...CALM, festival: time > 4 && time < 6 ? 1 : 0 };
        });
        expect(raced).toBeGreaterThan(60);
        expect(farthest).toBeGreaterThan(12);
        run(flock, 30);
        expect(flock.sheep.filter((s) => s.lamb).every((s) => s.mode !== 'race')).toBe(true);
    });

    it('lies them all down when the run ends, and gets them up when a new one starts', () => {
        const flock = make([herd(0, -20, 10, 5, 3)], 6);
        run(flock, 3);
        run(flock, 40, () => ({ ...CALM, settled: true }));
        expect(flock.sheep.filter((s) => s.mode === 'lie').length).toBe(flock.sheep.length);
        expect(flock.sheep.filter((s) => s.act === 'Lie').length).toBe(flock.sheep.length);
        run(flock, 30);
        expect(flock.sheep.filter((s) => s.mode === 'lie').length).toBeLessThan(2);
    });

    it('rests half the groups in the honey afternoon and turns their backs to the wind before the showers', () => {
        const flock = make([herd(0, -20, 10, 5, 0), herd(1, 20, -25, 5, 0)], 8);
        run(flock, 60, () => ({ ...CALM, mood: 1 }));
        expect(flock.sheep.filter((s) => s.mode === 'lie').length).toBeGreaterThan(2);
        const showers = make([herd(0, -20, 10, 5, 0)], 8);
        run(showers, 60, () => ({ ...CALM, mood: 3 }));
        const downwind = Math.atan2(WIND.x, WIND.z);
        const grazing = showers.sheep.filter((s) => s.mode === 'graze' && s.speed < 0.05);
        expect(grazing.length).toBeGreaterThan(0);
        // Most of them (one may be turning to its place).
        const turned = grazing.filter((s) => Math.abs(Math.atan2(
            Math.sin(s.heading - downwind),
            Math.cos(s.heading - downwind),
        )) < 0.7);
        expect(turned.length / grazing.length).toBeGreaterThan(0.7);
    });
});

describe('Verdant Hills flock: on the downs', () => {
    it('grazes the real layout on the real pasture, in sight, without a stray step off the grass', () => {
        const entries = layoutVerdantHillsSheep();
        const land = createVerdantHillsPasture();
        const flock = new VerdantHillsFlock({
            entries, land, seed: 7, wind: WIND,
        });
        expect(flock.groups).toHaveLength(VERDANT_HILLS_FLOCK_HOMES.length);
        run(flock, 90, front(30, 0.98));
        flock.sheep.forEach((s) => {
            expect(land.allowed(s.x, s.z), `${s.index}`).toBe(true);
            expect(Number.isFinite(s.y)).toBe(true);
            expect(Math.abs(s.y - land.ground(s.x, s.z))).toBeLessThan(1e-9);
        });
        // The groups keep to their own ground, apart.
        flock.groups.forEach((g, i) => {
            expect(Math.hypot(g.cx - g.home.x, g.cz - g.home.z), `group ${i}`).toBeLessThan(70);
            flock.groups.forEach((o, j) => {
                if (j > i) expect(Math.hypot(g.cx - o.cx, g.cz - o.cz)).toBeGreaterThan(20);
            });
        });
    }, 30000);
});
