import { describe, expect, it } from 'vitest';
import {
    createCueDraw, cueLines, cuePool, drawTake,
} from '../../src/ui/effects/breathing/cue-variety.js';
import { BREATH_WORLDS, worldCuePairs, worldPauseCues } from '../../src/ui/effects/breathing/breath-catalogue.js';
import { SESSION_CUES, sessionCueTakes } from '../../src/ui/effects/breathing/session-cues.js';

/** A repeatable stand-in for Math.random. */
const seeded = (seed = 11) => {
    let state = seed;
    return () => {
        state = (state * 16807) % 2147483647;
        return (state - 1) / 2147483646;
    };
};
const wordsIn = (text) => text.toLowerCase().replace(/[^a-z ]/g, ' ').split(' ').filter(Boolean);

describe('A cue as a pool of takes', () => {
    it('names a line for each take, in the order written, and knows which open a guided run', () => {
        const pool = cuePool('cues_first', 'in', { plain: ['Breathe in', 'Breathe in, softly'], more: ['Let the breath arrive'] });
        expect(pool.all).toEqual([
            { id: 'cues_first/in', words: 'Breathe in', plain: true },
            { id: 'cues_first/in_2', words: 'Breathe in, softly', plain: true },
            { id: 'cues_first/in_3', words: 'Let the breath arrive', plain: false },
        ]);
        expect(pool.plain.map((take) => take.id)).toEqual(['cues_first/in', 'cues_first/in_2']);
        expect(Object.isFrozen(pool.all)).toBe(true);
        expect(cueLines(pool)).toEqual(['cues_first/in', 'cues_first/in_2', 'cues_first/in_3']);
        expect(cueLines(undefined)).toEqual([]);
    });

    it('takes a plain list for a pause: no take opens a run', () => {
        const pool = cuePool('cues_flow', 'hold', ['Hold', 'And hold']);
        expect(pool.plain).toEqual([]);
        expect(pool.all.map((take) => take.id)).toEqual(['cues_flow/hold', 'cues_flow/hold_2']);
    });

    it('knows a quick pool, for a breath of a second', () => {
        expect(cuePool('g', 'out', { quick: true, plain: ['Let go'], more: ['Exhale'] }).quick).toBe(true);
        expect(cuePool('g', 'out', { plain: ['Breathe out'] }).quick).toBe(false);
        expect(cuePool('g', 'hold', ['Hold']).quick).toBe(false);
    });
});

describe('Drawing a take', () => {
    const TAKES = ['a', 'b', 'c', 'd', 'e'];

    it('never gives the same take twice running, and plays every take before one comes round again', () => {
        const draw = createCueDraw(seeded());
        const heard = Array.from({ length: 200 }, () => draw('in', TAKES));
        heard.forEach((id, index) => { if (index) expect(id, `draw ${index}`).not.toBe(heard[index - 1]); });
        // The first round is the whole pool; no take is ever more than two rounds away.
        expect(new Set(heard.slice(0, TAKES.length)).size).toBe(TAKES.length);
        TAKES.forEach((take) => {
            const at = heard.map((id, index) => (id === take ? index : -1)).filter((index) => index >= 0);
            at.forEach((index, n) => { if (n) expect(index - at[n - 1], take).toBeLessThan(TAKES.length * 2); });
        });
    });

    it('keeps slots apart, and one slot\'s plain takes and whole pool apart from repeats', () => {
        const draw = createCueDraw(() => 0);
        expect(draw('in', ['a', 'a_2'])).toBe('a');
        // The same slot now draws from its whole pool: not the take just heard.
        expect(draw('in', ['a', 'a_2', 'a_3'])).toBe('a_2');
        // Another slot starts fresh.
        expect(draw('out', ['a', 'a_2'])).toBe('a');
    });

    it('gives the take asked for, the only take there is, and nothing from nothing', () => {
        const draw = createCueDraw(seeded());
        expect(draw('world', TAKES, 'c')).toBe('c');
        expect(draw('world', TAKES)).not.toBe('c');
        expect(draw('world', TAKES, 'not a take')).toBeTruthy();
        expect(draw('one', ['only'])).toBe('only');
        expect(draw('one', ['only'])).toBe('only');
        expect(draw('none', [])).toBeNull();
    });

    it('brings a set round again with the take heard longest ago, so two takes take turns', () => {
        [3, 11, 29, 101].forEach((seed) => {
            const draw = createCueDraw(seeded(seed));
            const heard = Array.from({ length: 12 }, () => draw('in', ['a', 'b']));
            heard.forEach((id, index) => { if (index) expect(id, `seed ${seed}`).not.toBe(heard[index - 1]); });
            // Five takes: the take that opens a round is the one that opened the round before.
            const five = Array.from({ length: 15 }, () => draw('five', TAKES));
            expect(five[5], `seed ${seed}`).toBe(five[0]);
            expect(new Set(five.slice(5, 10)).size).toBe(5);
        });
    });

    it('keeps the plain words for opening a run: its other breaths take the other wordings', () => {
        const pool = cuePool('g', 'in', { plain: ['P1', 'P2'], more: ['M1', 'M2', 'M3', 'M4'] });
        [3, 11, 29, 101].forEach((seed) => {
            const draw = createCueDraw(seeded(seed));
            const runs = Array.from({ length: 8 }, () => [
                drawTake(draw, pool, () => true, { plain: true }),
                drawTake(draw, pool, () => true),
                drawTake(draw, pool, () => true),
            ]);
            runs.forEach(([opener, second, third], index) => {
                expect(opener.plain).toBe(true);
                expect(second.plain || third.plain).toBe(false);
                expect(second.id).not.toBe(third.id);
                // The two openers take turns from run to run.
                if (index) expect(opener.id, `seed ${seed} run ${index}`).not.toBe(runs[index - 1][0].id);
            });
            // Four other wordings: two runs hear all four before one returns.
            expect(new Set([runs[0][1], runs[0][2], runs[1][1], runs[1][2]].map((take) => take.id)).size).toBe(4);
        });
    });

    it('follows a pool that changes: a take that left is not drawn', () => {
        const draw = createCueDraw(seeded());
        draw('in', TAKES);
        const heard = Array.from({ length: 20 }, () => draw('in', ['a', 'b']));
        expect(new Set(heard)).toEqual(new Set(['a', 'b']));
    });

    it('draws only takes that fit the breath, the plain ones first when a run opens', () => {
        const pool = cuePool('g', 'in', { plain: ['One', 'Two'], more: ['Three', 'Four'] });
        const draw = createCueDraw(() => 0);
        expect(drawTake(draw, pool, () => true, { plain: true })).toMatchObject({ id: 'g/in', plain: true });
        // No plain take fits this breath: any take that does.
        const onlyThree = (id) => id === 'g/in_3';
        expect(drawTake(draw, pool, onlyThree, { plain: true })).toMatchObject({ id: 'g/in_3', words: 'Three' });
        expect(drawTake(draw, pool, () => false)).toBeNull();
        expect(drawTake(draw, null, () => true)).toBeNull();
        // A list of takes (a world's pause words) is drawn from as it is.
        expect(drawTake(draw, [{ id: 'w/hold', words: 'Hold the glow' }], () => true)).toEqual({ id: 'w/hold', words: 'Hold the glow' });
    });
});

describe('The words of the worlds and the sessions', () => {
    it('gives every world five couplets, its own first, each with the lines that speak it', () => {
        expect(worldCuePairs('coherence')[0]).toEqual({
            in: 'worlds/coherence_in', out: 'worlds/coherence_out', words: ['Let the petals open', 'Let them fold'],
        });
        const second = worldCuePairs('coherence')[1];
        expect(second).toMatchObject({ in: 'worlds/coherence_in_2', out: 'worlds/coherence_out_2' });
        BREATH_WORLDS.forEach((world) => {
            const couplets = worldCuePairs(world.id);
            expect(couplets.length, world.id).toBe(5);
            couplets.forEach((couplet) => {
                expect(couplet.words).toHaveLength(2);
                // A hint under "In" or "Out": a few words.
                couplet.words.forEach((words) => expect(wordsIn(words).length, words).toBeLessThanOrEqual(6));
            });
        });
    });

    it('gives a world words for a hold or a rest its rhythm has, and none for one it has not', () => {
        expect(worldPauseCues('box-breathing').hold[0]).toEqual({ id: 'worlds/box-breathing_hold', words: 'Across the top' });
        expect(worldPauseCues('box-breathing').rest[1].id).toBe('worlds/box-breathing_rest_2');
        expect(worldPauseCues('coherence')).toEqual({ hold: [], rest: [] });
        BREATH_WORLDS.forEach((world) => {
            const pause = worldPauseCues(world.id);
            const [, hold, , rest] = world.pattern;
            expect(pause.hold.length, `${world.id} hold`).toBe(hold >= 2 ? 3 : 0);
            expect(pause.rest.length, `${world.id} rest`).toBe(rest >= 2 ? 3 : 0);
        });
    });

    it('gives every session its own cues for the breath in and out, and for the pauses its rounds have', () => {
        expect(Object.keys(SESSION_CUES)).toEqual(['FIRST', 'TIDE', 'ROOTS', 'UNWIND', 'SUNRISE', 'REST', 'FLOW', 'BASE', 'ELIXIR']);
        expect(SESSION_CUES.FIRST.main.in.all[0]).toEqual({ id: 'cues_first/in', words: 'Breathe in', plain: true });
        expect(SESSION_CUES.BASE.round.out.all[2].id).toBe('cues_base/round_out_3');
        expect(SESSION_CUES.BASE.release.out.all.map((take) => take.id))
            .toEqual(['cues_base/release_out', 'cues_base/release_out_2', 'cues_base/release_out_3']);
        Object.entries(SESSION_CUES).forEach(([sessionId, sets]) => {
            Object.entries(sets).forEach(([name, set]) => {
                if (name === 'release') return;
                expect(set.in.plain.length, `${sessionId} ${name}`).toBeGreaterThan(0);
                expect(set.in.all.length, `${sessionId} ${name}`).toBeGreaterThanOrEqual(4);
            });
        });
    });

    it('never says the same words in two places: every take is its session\'s or its world\'s own', () => {
        const seen = new Map();
        const note = (words, where) => {
            const key = wordsIn(words).join(' ');
            expect(seen.get(key), `"${words}" in ${where} and ${seen.get(key)}`).toBeUndefined();
            seen.set(key, where);
        };
        BREATH_WORLDS.forEach((world) => {
            worldCuePairs(world.id).forEach((pair) => pair.words.forEach((words) => note(words, world.id)));
            Object.values(worldPauseCues(world.id)).flat().forEach((take) => note(take.words, world.id));
        });
        sessionCueTakes().forEach((take) => note(take.words, take.id));
    });

    it('gives the fire breath words for its one-second out-breath: quick ones, a word or two, no comma', () => {
        const fire = SESSION_CUES.ELIXIR.round.out;
        expect(fire.quick).toBe(true);
        expect(fire.plain.length).toBeGreaterThan(0);
        expect(fire.all.length).toBeGreaterThanOrEqual(4);
        expect(fire.all.some((take) => wordsIn(take.words).includes('out')), 'it says "out"').toBe(true);
        // Volcanic Fire answers each in-breath too.
        expect(worldCuePairs('wim-hof')[0])
            .toMatchObject({ out: 'worlds/wim-hof_out', words: ['Feed the fire', 'Release'] });
        const quick = Object.values(SESSION_CUES).flatMap((sets) => Object.values(sets))
            .flatMap((set) => Object.values(set))
            .filter((pool) => pool.quick)
            .flatMap((pool) => pool.all.map((take) => take.words));
        // A comma costs about 0.7 seconds; a breath of a second has room for three words at most.
        [...quick, ...worldCuePairs('wim-hof').map((pair) => pair.words[1])].forEach((words) => {
            expect(words, words).not.toContain(',');
            expect(wordsIn(words).length, words).toBeLessThanOrEqual(3);
        });
    });

    it('never says "out" on a breath in, nor "in" on a breath out', () => {
        const ins = [
            ...BREATH_WORLDS.flatMap((world) => worldCuePairs(world.id).map((pair) => pair.words[0])),
            ...sessionCueTakes().filter((take) => /(^|_)in(_\d+)?$/.test(take.id.split('/')[1])).map((take) => take.words),
        ];
        const outs = [
            ...BREATH_WORLDS.flatMap((world) => worldCuePairs(world.id).map((pair) => pair.words[1])),
            ...sessionCueTakes().filter((take) => /(^|_)out(_\d+)?$/.test(take.id.split('/')[1])).map((take) => take.words),
        ];
        expect(ins.length).toBeGreaterThan(100);
        ins.forEach((words) => expect(wordsIn(words), words).not.toEqual(expect.arrayContaining(['out'])));
        ins.forEach((words) => expect(wordsIn(words), words).not.toEqual(expect.arrayContaining(['down'])));
        outs.forEach((words) => expect(wordsIn(words), words).not.toEqual(expect.arrayContaining(['in'])));
    });
});
