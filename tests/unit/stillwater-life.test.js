/**
 * Stillwater — the life the two live between the moments play gives them (stillwater-life.js).
 *
 * The life is driven here by a stand-in for their bodies: each walks or drifts toward where its
 * scene sends it at a walking pace, sits, stands, kneels and rises when asked (after the time such
 * an act takes). What is pinned is how the life behaves (a scene begins only in a calm, play ends
 * it, every scene comes to an end, the same night is told the same way, they never grow apart),
 * not the scenes' own timings, which are tuned freely.
 */
import { describe, expect, it } from 'vitest';
import {
    DUET_WAIT, FOND_FROM, KIN, PLACES, SCENES, SCENE_BUSY, SCENE_CALM, SCENE_NAMES, SHY_BELOW, StillwaterLife,
    arcAt, boatAt, skipAt, skipPath,
} from '../../src/themes/stillwater/stillwater-life.js';
import { SPIRIT, TROLL } from '../../src/themes/stillwater/stillwater-core.js';

const DT = 1 / 30;

/** Their bodies, as far as the life can tell: where each is and what each is doing. */
function standIn() {
    return {
        troll: [TROLL.home[0], TROLL.home[2]],
        trollMode: 'seated',
        trollSpeed: 0,
        trollAct: 0,
        spirit: [...PLACES.kneel],
        spiritMode: 'kneeling',
        spiritAct: 0,
    };
}

/** One frame of the stand-in bodies doing what the life asks of them (or resting, when it asks nothing). */
function carryOut(body, life, dt) {
    const t = life.troll;
    const at = t.at || [TROLL.home[0], TROLL.home[2]];
    const dx = at[0] - body.troll[0];
    const dz = at[1] - body.troll[1];
    const d = Math.hypot(dx, dz);
    const sit = t.sit === null ? !t.scene : t.sit;
    if (body.trollMode === 'seated' && (!sit || d > 0.2)) {
        body.trollAct += dt;
        if (body.trollAct > 1.7) {
            body.trollMode = 'standing';
            body.trollAct = 0;
        }
    } else if (body.trollMode === 'standing' && t.crouch) {
        body.trollAct += dt;
        if (body.trollAct > 1.3) {
            body.trollMode = 'crouched';
            body.trollAct = 0;
        }
    } else if (body.trollMode === 'crouched' && !t.crouch) body.trollMode = 'standing';
    body.trollSpeed = 0;
    if (body.trollMode === 'standing' && d > 0.05) {
        const step = Math.min(d, (t.pace || 0.5) * dt);
        body.troll[0] += (dx / d) * step;
        body.troll[1] += (dz / d) * step;
        body.trollSpeed = step / dt;
    }
    const s = life.spirit;
    const sAt = s.at || PLACES.kneel;
    const kneel = s.kneel === null ? !s.scene : s.kneel;
    if (body.spiritMode === 'kneeling' && !kneel) {
        body.spiritAct += dt;
        if (body.spiritAct > 1.8) {
            body.spiritMode = 'standing';
            body.spiritAct = 0;
        }
    } else if (body.spiritMode === 'standing' && kneel) {
        body.spiritAct += dt;
        if (body.spiritAct > 2.2) {
            body.spiritMode = 'kneeling';
            body.spiritAct = 0;
        }
    }
    if (body.spiritMode === 'standing') {
        const ex = sAt[0] - body.spirit[0];
        const ez = sAt[2] - body.spirit[2];
        const e = Math.hypot(ex, ez);
        if (e > 0.01) {
            const step = Math.min(e, (s.pace || 0.5) * dt);
            body.spirit[0] += (ex / e) * step;
            body.spirit[2] += (ez / e) * step;
        }
    }
}

/** The context the story would hand the life, from the stand-in bodies and how play goes. */
function context(body, play = {}) {
    return {
        calm: play.calm ?? 30,
        busy: play.busy ?? 0,
        engaged: Boolean(play.engaged),
        meet: Boolean(play.meet),
        troll: body.troll,
        trollMode: body.trollMode,
        trollSpeed: body.trollSpeed,
        spirit: body.spirit,
        spiritMode: body.spiritMode,
        lantern: [body.troll[0] - 0.6, 2.2, body.troll[1] + 0.4],
        spiritHeart: [body.spirit[0], body.spirit[1] + 1.2, body.spirit[2]],
    };
}

/** Live `seconds` of a night; `play(time)` says how play goes at a moment; `each(life, time)` after every frame. */
function live(life, body, seconds, { play = () => ({}), each = null } = {}) {
    const start = life.time;
    const frames = Math.round(seconds / DT);
    for (let i = 1; i <= frames; i++) {
        const time = start + i * DT;
        life.update(time, DT, context(body, play(time)));
        carryOut(body, life, DT);
        if (each) each(life, time);
    }
}

describe('stillwater life: when scenes come', () => {
    it('begins nothing while play has them, while play runs quick, or before a calm', () => {
        for (const play of [{ engaged: true }, { busy: SCENE_BUSY + 0.1 }, { calm: SCENE_CALM - 0.1 }]) {
            const life = new StillwaterLife();
            life.reset(0, 0.9);
            live(life, standIn(), 120, { play: () => play });
            expect(life.log, JSON.stringify(play)).toEqual([]);
        }
    });

    it('fills a calm night with things to do: many scenes, of both of them, and no scene twice running', () => {
        const life = new StillwaterLife();
        life.reset(0, 0.2);
        live(life, standIn(), 300);
        const names = life.log.map((l) => l.name);
        expect(names.length).toBeGreaterThan(12);
        expect(new Set(names).size).toBeGreaterThan(8);
        expect(names.some((n) => SCENES[n].who === 'troll')).toBe(true);
        expect(names.some((n) => SCENES[n].who === 'spirit')).toBe(true);
        for (const who of ['troll', 'spirit']) {
            const own = life.log.filter((l) => SCENES[l.name].who === who).map((l) => l.name);
            for (let i = 1; i < own.length; i++) expect(own[i], `${who} at ${i}`).not.toBe(own[i - 1]);
        }
    });

    it('brings scenes of the two of them, and only those their nearness allows', () => {
        for (const kin of [0.1, 0.45, 0.9]) {
            const life = new StillwaterLife();
            life.reset(0, kin);
            let lowest = kin;
            live(life, standIn(), 400, { each: (l) => { lowest = Math.min(lowest, l.kin); } });
            const duets = life.log.filter((l) => SCENES[l.name].who === 'both' && !SCENES[l.name].reflex);
            expect(duets.length, `kin ${kin}`).toBeGreaterThan(0);
            for (const d of duets) {
                expect(SCENES[d.name].kin[0], `${d.name} at kin ${kin}`).toBeLessThanOrEqual(life.kin);
            }
            expect(lowest).toBeGreaterThanOrEqual(kin);
        }
    });

    it('lets whoever is free wait for the other when a scene of theirs is due', () => {
        const life = new StillwaterLife();
        life.reset(0, 0.9);
        let waited = false;
        live(life, standIn(), 200, {
            each: (l, time) => {
                if (!l.waiting) return;
                // While one waits, the free one begins nothing of their own, and not for long.
                waited = true;
                expect(time).toBeLessThanOrEqual(l.waiting.until + DT);
                expect(l.waiting.until - time).toBeLessThanOrEqual(DUET_WAIT + 1e-6);
            },
        });
        expect(waited).toBe(true);
    });
});

describe('stillwater life: a scene under way', () => {
    it('ends every scene, each in its own time, and sends both back to rest', () => {
        for (const name of [...SCENE_NAMES.troll, ...SCENE_NAMES.spirit, ...SCENE_NAMES.both, 'shy', 'fond']) {
            const life = new StillwaterLife();
            life.reset(0, 0.9);
            // (Nothing else of theirs comes between: the next of theirs is far off.)
            life.next = { troll: 1e9, spirit: 1e9, both: 1e9 };
            life.cue(name, 1);
            const body = standIn();
            live(life, body, 240);
            const run = life.log.find((l) => l.name === name);
            expect(run, name).toBeTruthy();
            expect(run.how, name).toBe('done');
            // (And nothing of theirs began after it: the next was put off.)
            expect(life.log.at(-1), name).toBe(run);
            expect(life.sceneOf('troll'), name).toBeNull();
            expect(life.sceneOf('spirit'), name).toBeNull();
        }
    });

    it('ends a scene where it stands when play calls them, and keeps nothing of it', () => {
        const life = new StillwaterLife();
        life.reset(0, 0.9);
        life.next = { troll: 1e9, spirit: 1e9, both: 1e9 };
        life.cue('wood', 1);
        const body = standIn();
        live(life, body, 12);
        expect(life.sceneOf('troll')).toBe('wood');
        live(life, body, 1, { play: () => ({ engaged: true }) });
        expect(life.sceneOf('troll')).toBeNull();
        expect(life.log.at(-1)).toMatchObject({ name: 'wood', how: 'play' });
        expect(life.troll.scene).toBeNull();
        expect(life.troll.at).toBeNull();
    });

    it('sends him out of the picture into the wood and brings him home again', () => {
        const life = new StillwaterLife();
        life.reset(0, 0.2);
        life.next = { troll: 1e9, spirit: 1e9, both: 1e9 };
        life.cue('wood', 1);
        const body = standIn();
        let furthest = 0;
        live(life, body, 90, { each: () => { furthest = Math.max(furthest, body.troll[0]); } });
        // (The frame's right edge at his depth is about x = 11.9 on a wide frame.)
        expect(furthest).toBeGreaterThan(13);
        expect(Math.hypot(body.troll[0] - TROLL.home[0], body.troll[1] - TROLL.home[2])).toBeLessThan(0.4);
    });

    it('keeps her on her feet through a scene that stood her up, until it says she may kneel', () => {
        const life = new StillwaterLife();
        life.reset(0, 0.9);
        life.next = { troll: 1e9, spirit: 1e9, both: 1e9 };
        life.cue('bow', 1);
        const body = standIn();
        live(life, body, 14, {
            each: (l) => {
                const curtsying = l.sceneOf('spirit') === 'bow' && body.spiritMode === 'standing';
                if (curtsying) expect(l.spirit.kneel).not.toBe(true);
            },
        });
    });

    it('sets a skipping stone across the water toward her and lets the world know where and when', () => {
        const life = new StillwaterLife();
        life.reset(0, 0.9);
        life.next = { troll: 1e9, spirit: 1e9, both: 1e9 };
        life.cue('skip', 1);
        const seen = [];
        live(life, standIn(), 40, { each: (l) => { const e = l.drain(); if (e) seen.push(...e); } });
        const skip = seen.find((e) => e.type === 'skip');
        expect(skip).toBeTruthy();
        // Each skip further toward her than the last, each gap no longer than the one before (the first aside).
        const toward = skip.path.map((b) => Math.hypot(b.x - skip.from[0], b.z - skip.from[1]));
        for (let i = 1; i < toward.length; i++) expect(toward[i]).toBeGreaterThan(toward[i - 1]);
        const gaps = toward.map((d, i) => d - (toward[i - 1] ?? 0));
        for (let i = 2; i < gaps.length; i++) expect(gaps[i]).toBeLessThanOrEqual(gaps[i - 1] + 1e-9);
        expect(skip.path.at(-1).x).toBeLessThan(skip.from[0]);
    });
});

describe('stillwater life: how near they grow', () => {
    it('grows nearer with a calm, never past one, and never further for anything', () => {
        const life = new StillwaterLife();
        life.reset(0, 0.95);
        let last = life.kin;
        live(life, standIn(), 600, {
            each: (l) => {
                expect(l.kin).toBeGreaterThanOrEqual(last);
                expect(l.kin).toBeLessThanOrEqual(1);
                last = l.kin;
            },
        });
        life.grow(-1);
        expect(life.kin).toBe(last);
        const fresh = new StillwaterLife();
        fresh.reset(0);
        expect(fresh.kin).toBe(KIN.start);
    });

    it('is shy of a meeting of eyes at first and fond of it later', () => {
        for (const [kin, reflex] of [[SHY_BELOW - 0.1, 'shy'], [FOND_FROM + 0.1, 'fond']]) {
            const life = new StillwaterLife();
            life.reset(0, kin);
            life.next = { troll: 1e9, spirit: 1e9, both: 1e9 };
            live(life, standIn(), 4, { play: (t) => ({ meet: t > 2 }) });
            expect(life.log.map((l) => l.name).concat([life.sceneOf('troll')])).toContain(reflex);
        }
    });
});

describe('stillwater life: a replay', () => {
    it('tells the same night for the same play at the same times, scene for scene', () => {
        const night = () => {
            const life = new StillwaterLife();
            life.reset(0, 0.5);
            const frames = [];
            live(life, standIn(), 240, {
                play: (t) => ({ engaged: t > 100 && t < 110, busy: t > 150 && t < 160 ? 0.8 : 0, calm: t % 40 }),
                each: (l) => frames.push(JSON.stringify([l.troll, l.spirit, l.kin])),
            });
            return { frames, log: life.log };
        };
        const a = night();
        const b = night();
        expect(b.log).toEqual(a.log);
        expect(b.frames.filter((f, i) => f !== a.frames[i]).length).toBe(0);
    });
});

describe('stillwater life: lights across the water', () => {
    it('carries a light from one of them to the other over a bow, from its start to its end', () => {
        const from = [-6, 1.2, -10];
        const to = [8, 2.4, -11];
        expect(arcAt(from, to, 0)).toEqual(from);
        const end = arcAt(from, to, 1);
        end.forEach((v, i) => expect(v).toBeCloseTo(to[i], 9));
        expect(arcAt(from, to, 0.5)[1]).toBeGreaterThan(Math.max(from[1], to[1]));
    });

    it('floats a little boat of light on the water from his edge to hers', () => {
        const from = [7, 0, -10.3];
        const to = [-5.4, 0, -9.8];
        const start = boatAt(from, to, 0, 15);
        const end = boatAt(from, to, 15, 15);
        expect(start[0]).toBeCloseTo(from[0], 9);
        expect(end[0]).toBeCloseTo(to[0], 9);
        for (let t = 0; t <= 15; t += 0.5) expect(boatAt(from, to, t, 15)[1]).toBeLessThan(0.12);
    });

    it('skips the stone in hops that touch the water and are gone once it has sunk', () => {
        const from = [7.05, -10.3];
        const path = skipPath(from, [SPIRIT.home[0], SPIRIT.home[2]]);
        path.forEach((b) => {
            const p = skipAt(path, from, b.t);
            expect(p[1]).toBeCloseTo(0, 9);
        });
        expect(skipAt(path, from, path.at(-1).t + 1)).toBeNull();
    });
});
