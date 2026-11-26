// @ts-check
import {
    beforeAll, describe, expect, it, vi,
} from 'vitest';
import {
    comparePins, currentPins, fingerprintOrb, gameplayConfig, readPins, resolvedRules, serializePins,
    APP_ID_FILE, GENERATIONS_FILE, PIN_FILE, PRESENTATION_ONLY, REPIN_COMMAND, RESOLVED_RULE_FIELDS,
} from '../../scripts/odyssey-time-board-freeze.mjs';
import { GravityBotController } from '../../src/core/ai/gravity-bot-controller.js';
import { LEVEL_CONFIGS } from '../../src/core/odyssey/data/levels.js';
import { hasOdysseyTimeBoard } from '../../src/core/odyssey/odyssey-time-board.js';
import { odysseyTimeBoardName } from '../../src/core/steam/steam-catalogue.js';

/** @typedef {import('../../scripts/odyssey-time-board-freeze.mjs').OrbPins} OrbPins */

/** Fresh copies of a few orbs, so a test can change one without touching the campaign. */
const orbs = (/** @type {number[]} */ ...ids) => structuredClone(LEVEL_CONFIGS.filter((level) => ids.includes(level.id)));
const orb = (/** @type {Array<Record<string, any>>} */ levels, /** @type {number} */ id) => /** @type {Record<string, any>} */ (
    levels.find((level) => level.id === id));

describe('the rules freeze for orb time boards', () => {
    // THE GATE. When this fails, the message for each orb says what to do; nothing else is needed.
    it(`finds every timed orb as it was pinned in ${PIN_FILE}`, async () => {
        const problems = comparePins(await currentPins(), readPins());
        expect(problems.map((problem) => problem.message).join('\n\n')).toBe('');
    }, 120_000);

    it('pins the 58 timed orbs, the eight rivals with their play', () => {
        const pinned = readPins();
        const timed = LEVEL_CONFIGS.filter(hasOdysseyTimeBoard);
        expect(Object.keys(pinned).map(Number)).toEqual(timed.map((level) => level.id));
        expect(Object.keys(pinned)).toHaveLength(58);
        const rivals = timed.filter((level) => level.mechanics.versus).map((level) => level.id);
        expect(rivals).toEqual([5, 10, 18, 26, 34, 48, 56, 60]);
        for (const [id, pin] of Object.entries(pinned)) {
            expect(Object.keys(pin)).toEqual(rivals.includes(Number(id))
                ? ['board', 'level', 'rules', 'rival', 'play'] : ['board', 'level', 'rules']);
        }
    });
});

describe('what the freeze notices', () => {
    /** @type {OrbPins} */
    let pinned;
    beforeAll(async () => { pinned = await currentPins({ levels: orbs(25, 26, 27) }); });

    it('names only the orb whose rival setting changed, and says what to do about it', async () => {
        const levels = orbs(25, 26, 27);
        orb(levels, 26).mechanics.versus.botOverrides.maxApm += 20;
        const problems = comparePins(await currentPins({ levels }), pinned, { boardsArePublic: true });

        expect(problems.map((problem) => [problem.orb, problem.kind])).toEqual([[26, 'changed']]);
        // Its definition, what the rival is built from, and how the rival then plays.
        expect(problems[0].parts).toEqual(['level', 'rival', 'play']);
        expect(problems[0].message).toBe(
            'Orb 26 changed (its definition; what its rival is built from; how its rival plays) and still races on '
            + 'OdysseyLevelTime_v7_26. If the change can alter its clear time, give orb 26 a new board generation in '
            + `${GENERATIONS_FILE} (ODYSSEY_TIME_BOARD_GENERATIONS), add that board on the Steam partner site, `
            + `then re-pin with \`${REPIN_COMMAND}\`. If it cannot, re-pin only.`,
        );
        expect(GENERATIONS_FILE).toBe('src/core/steam/steam-catalogue.js');
        expect(REPIN_COMMAND).toBe('node scripts/odyssey-time-board-freeze.mjs');
    });

    it('passes again once that orb has a new board generation and is re-pinned', async () => {
        const levels = orbs(25, 26, 27);
        orb(levels, 26).mechanics.versus.botOverrides.maxApm += 20;
        const boardName = (/** @type {number} */ id) => odysseyTimeBoardName(id, { 26: 2 });
        const bumped = await currentPins({ levels, boardName });

        // With the generation bumped and the pin not yet renewed, the gate asks for the new board.
        const waiting = comparePins(bumped, pinned, { boardsArePublic: true });
        expect(waiting.map((problem) => [problem.orb, problem.kind])).toEqual([[26, 'board']]);
        expect(waiting[0].message).toBe(
            'Orb 26 races on a new board, OdysseyLevelTime_v7_26_g2 (pinned: OdysseyLevelTime_v7_26). Add '
            + 'OdysseyLevelTime_v7_26_g2 on the Steam partner site if it is not there yet, then re-pin with '
            + `\`${REPIN_COMMAND}\`.`,
        );

        // Re-pinned, through the pin file's own text: nothing is left, and the neighbours never moved.
        /** @type {OrbPins} */
        const repinned = JSON.parse(serializePins(bumped)).orbs;
        expect(comparePins(bumped, repinned, { boardsArePublic: true })).toEqual([]);
        expect(repinned[26].board).toBe('OdysseyLevelTime_v7_26_g2');
        expect(repinned[25]).toEqual(pinned[25]);
        expect(repinned[27]).toEqual(pinned[27]);
    });

    it('asks only for a re-pin while the game has no Steam App ID, when no board is public yet', async () => {
        const levels = orbs(25);
        orb(levels, 25).victory.primary.target += 1;
        const [problem] = comparePins(await currentPins({ levels }), { 25: pinned[25] }, { boardsArePublic: false });
        expect(problem.message).toBe(
            'Orb 25 changed (its definition) and still races on OdysseyLevelTime_v7_25. The game has no Steam App ID '
            + `yet (${APP_ID_FILE}), so no board is public and no times can be mixed: re-pin with \`${REPIN_COMMAND}\` `
            + 'and leave the board generations alone. Once the App ID is set, a change that can alter a clear time '
            + 'needs a new board for that orb.',
        );
    });

    it('notices a goal, a speed, a star rule, a layout and a field it has never seen', async () => {
        /** @type {Array<[string, (level: Record<string, any>) => void, string[]]>} */
        const changes = [
            ['goal', (level) => { level.victory.primary.target += 1; }, ['level']],
            ['speed', (level) => { level.mechanics.speed.fixedDropInterval -= 10; }, ['level', 'rules']],
            ['star rule', (level) => { level.stars.three.time = (level.stars.three.time || 60) - 1; }, ['level']],
            ['starting rows', (level) => { level.mechanics.board.startingRows = (level.mechanics.board.startingRows || 0) + 1; }, ['level', 'rules']],
            ['modifier', (level) => { level.modifiers.active = [...level.modifiers.active, 'mirror']; }, ['level']],
            ['new field', (level) => { level.mechanics.somethingNew = { on: true }; }, ['level']],
        ];
        for (const [what, change, expected] of changes) {
            const levels = orbs(25);
            change(orb(levels, 25));
            const problems = comparePins(await currentPins({ levels }), { 25: pinned[25] });
            expect(problems.map((problem) => problem.orb), what).toEqual([25]);
            expect(problems[0].parts, what).toEqual(expect.arrayContaining(expected));
        }
    });

    it('does not move for words and looks', async () => {
        const levels = orbs(25, 26, 27);
        for (const level of levels) {
            level.name = 'Renamed';
            level.theme = { primary: 'another-theme', overlays: ['new-overlay'], transitionIn: 'warp' };
            level.pathPosition += 0.01;
            level.emotionalBeat = 'calm';
            level.metadata.description = 'New words.';
            level.metadata.tip = 'A new tip.';
            level.metadata.subtitle = 'A new subtitle';
            level.victory.primary.description = 'A new goal line';
            level.victory.bonuses.forEach((/** @type {Record<string, any>} */ bonus) => { bonus.description = 'New bonus words'; });
            if (level.mechanics.versus) level.mechanics.versus.botName = 'Renamed';
        }
        expect(comparePins(await currentPins({ levels }), pinned)).toEqual([]);
    });

    it('reports an orb with a board and no pin, and a pin whose orb has no board', () => {
        expect(comparePins({ 25: pinned[25] }, {})).toEqual([{
            orb: 25,
            kind: 'unpinned',
            parts: [],
            message: `Orb 25 has a time board (OdysseyLevelTime_v7_25) and no pin. Re-pin with \`${REPIN_COMMAND}\`.`,
        }]);
        expect(comparePins({}, { 25: pinned[25] })).toEqual([{
            orb: 25,
            kind: 'stale',
            parts: [],
            message: 'Orb 25 is pinned on OdysseyLevelTime_v7_25 and has no time board any more. '
                + `Re-pin with \`${REPIN_COMMAND}\`.`,
        }]);
    });

    it('notices a rival that plays differently although nothing it is built from changed', async () => {
        // A change to the bot's code, not its data: every piece is taken up a little later.
        const setSpawnTiming = GravityBotController.prototype.setSpawnTiming;
        const slower = vi.spyOn(GravityBotController.prototype, 'setSpawnTiming').mockImplementation(function later(now) {
            setSpawnTiming.call(this, now);
            this.readyAtMs += 120;
        });
        try {
            const problems = comparePins(await currentPins({ levels: orbs(25, 26, 27) }), pinned);
            expect(problems.map((problem) => [problem.orb, problem.parts])).toEqual([[26, ['play']]]);
            expect(problems[0].message).toContain('Orb 26 changed (how its rival plays)');
        } finally {
            slower.mockRestore();
        }
    });

    it('gives the same fingerprint for the same orb every time, the played rival included', async () => {
        const [rival] = orbs(26);
        const first = await fingerprintOrb(rival);
        expect(await fingerprintOrb(structuredClone(rival))).toEqual(first);
        expect(Object.values(first).every((part) => /^[0-9a-f]{16}$/.test(part))).toBe(true);
        expect(first).toEqual({
            level: pinned[26].level, rules: pinned[26].rules, rival: pinned[26].rival, play: pinned[26].play,
        });
    });
});

describe('what the fingerprint reads', () => {
    it('leaves out only keys that exist, so a renamed one cannot hide a rule', () => {
        for (const path of PRESENTATION_ONLY) {
            const keys = path.split('.');
            const reach = (/** @type {any} */ node, /** @type {string[]} */ rest) => {
                if (!rest.length) return node !== undefined;
                if (node === null || typeof node !== 'object') return false;
                return rest[0] === '*'
                    ? Array.isArray(node) && node.some((item) => reach(item, rest.slice(1)))
                    : reach(node[rest[0]], rest.slice(1));
            };
            expect(LEVEL_CONFIGS.some((level) => reach(level, keys)), `${path} is on no orb`).toBe(true);
            expect(LEVEL_CONFIGS.some((level) => reach(gameplayConfig(level), keys)), `${path} was left in`).toBe(false);
        }
        // Everything else stays, the opening layout and the rival's settings among it.
        const kept = gameplayConfig(orbs(60)[0]);
        expect(kept.mechanics.versus).toEqual({ ...LEVEL_CONFIGS[59].mechanics.versus, botName: undefined });
        expect(Object.keys(kept)).toEqual(Object.keys(LEVEL_CONFIGS[59])
            .filter((key) => !['name', 'theme', 'pathPosition', 'emotionalBeat'].includes(key)));
    });

    it('reads rule fields the engine really sets', () => {
        const resolved = LEVEL_CONFIGS.map((level) => resolvedRules(level));
        for (const field of RESOLVED_RULE_FIELDS) {
            expect(resolved.some((rules) => rules.state[field] !== undefined), `${field} is set on no orb`).toBe(true);
        }
        // Two orbs that differ in speed resolve to different rules.
        const [slow] = orbs(25);
        const [fast] = orbs(25);
        fast.mechanics.speed.fixedDropInterval -= 10;
        expect(resolvedRules(fast).state.dropInterval).toBe(resolvedRules(slow).state.dropInterval - 10);
    });
});
