import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    LocalVersusHud,
    competitionRanks,
    formatClock,
    keyboardScheme,
    versusCoachRows,
    versusControls,
    versusGoal,
    versusMetaStats,
    versusMetric,
    versusMode,
} from '../../src/ui/local-versus-hud.js';

const SETTINGS = {
    keyBindings: {
        moveLeft: 'ArrowLeft', moveRight: 'ArrowRight', rotateRight: 'ArrowUp', rotateLeft: 'z', softDrop: 'ArrowDown', hardDrop: 'Space',
    },
    player2KeyBindings: {
        moveLeft: 'a', moveRight: 'd', rotateRight: 'w', rotateLeft: 'q', softDrop: 's', hardDrop: 'Shift',
    },
    player3GamepadBindings: {
        moveLeft: 14, moveRight: 15, rotateRight: 0, rotateLeft: 3, softDrop: 13, hardDrop: 1,
    },
};

describe('local versus: what each match counts', () => {
    it('leads with the number that decides the match', () => {
        expect(versusMetric({ endCondition: 'frags', endConditionValue: 7 })).toEqual({ key: 'frags', unit: 'Frags', target: 7 });
        expect(versusMetric({ endCondition: 'points', endConditionValue: 10 })).toMatchObject({ key: 'score', target: 10000 });
        expect(versusMetric({ endCondition: 'lines', endConditionValue: 40 })).toMatchObject({ key: 'lines', target: 40 });
        // "The highest score when time runs out wins" — the setup sheet's rule.
        expect(versusMetric({ endCondition: 'time', endConditionValue: 3 })).toMatchObject({ key: 'score', target: null });
        expect(versusMetric({ endCondition: 'never' })).toMatchObject({ key: 'score', target: null });
        expect(versusMetric({ isInfinityLMS: true })).toMatchObject({ key: 'toRoof', target: null });
    });

    it('words the goal for players and for teams', () => {
        expect(versusGoal({ endCondition: 'frags', endConditionValue: 7 })).toBe('First to 7 frags');
        expect(versusGoal({ endCondition: 'frags', endConditionValue: 1 })).toBe('First to 1 frag');
        // A team's frag goal counts the rounds it wins.
        expect(versusGoal({ endCondition: 'frags', endConditionValue: 7, isTeamMode: true })).toBe('First team to 7 rounds');
        expect(versusGoal({ endCondition: 'time', endConditionValue: 3 })).toBe('Highest score in 3 min');
        expect(versusGoal({ endCondition: 'points', endConditionValue: 10 })).toBe(`First to ${(10000).toLocaleString()} points`);
        expect(versusGoal({ isInfinityLMS: true })).toBe('Last one standing');
        expect(versusMode({ isInfinityLMS: true })).toBe('Infinity');
        expect(versusMode({ attackStyle: 'hot_potato' })).toBe('Hot potato');
        expect(versusMode({ isTeamMode: true })).toBe('Teams');
        expect(versusMode({})).toBe('Free-for-all');
    });

    it('ranks like a sports table: ties share a place', () => {
        expect(competitionRanks([3, 5, 5, 1])).toEqual([3, 1, 1, 4]);
        expect(competitionRanks([0, 0])).toEqual([1, 1]);
    });

    it('keeps the stats line to the numbers the plate does not show', () => {
        const entry = {
            level: 3, lines: 12, score: 4200, frags: 2,
        };
        expect(versusMetaStats(entry, 'frags').map(([label]) => label)).toEqual(['Level', 'Lines', 'Score']);
        expect(versusMetaStats(entry, 'score').map(([label]) => label)).toEqual(['Level', 'Lines', 'Frags']);
        expect(versusMetaStats(entry, 'toRoof').map(([label]) => label)).toEqual(['Level', 'Lines']);
        expect(versusMetaStats(entry, 'frags')[2][1]).toBe((4200).toLocaleString());
        expect(formatClock(170000)).toBe('2:50');
        expect(formatClock(-5)).toBe('0:00');
    });
});

describe('local versus: who plays how', () => {
    it('names each seat\'s controls from the bindings', () => {
        expect(keyboardScheme(SETTINGS.keyBindings)).toBe('Arrow keys');
        expect(keyboardScheme(SETTINGS.player2KeyBindings)).toBe('WASD');
        expect(keyboardScheme({ moveLeft: 'j', moveRight: 'l', softDrop: 'k' })).toBe('Keys J L');
        expect(versusControls(0, { kind: 'human' }, SETTINGS)).toBe('Arrow keys');
        expect(versusControls(1, { kind: 'human' }, SETTINGS)).toBe('WASD');
        expect(versusControls(2, { kind: 'human' }, SETTINGS)).toBe('Controller 3');
        expect(versusControls(3, { kind: 'bot', difficulty: 8 }, SETTINGS)).toBe('Bot · Master');
    });

    it('prints keycaps for keyboards and buttons for controllers', () => {
        expect(versusCoachRows(0, SETTINGS)).toEqual([
            ['Move', ['←', '→']], ['Turn', ['↑', 'Z']], ['Drop', ['↓', 'Space']],
        ]);
        expect(versusCoachRows(2, SETTINGS)).toEqual([
            ['Move', ['D-pad']], ['Turn', ['A', 'Y']], ['Drop', ['↓', 'B']],
        ]);
    });
});

// A minimal DOM: each plate answers for the parts the HUD updates.
function fakeElement() {
    const classes = new Set();
    return {
        innerHTML: '',
        textContent: '',
        hidden: false,
        dataset: {},
        style: { setProperty: vi.fn(function setProperty(name, value) { this[name] = value; }) },
        classList: {
            toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)),
            add: (name) => classes.add(name),
            remove: (name) => classes.delete(name),
            contains: (name) => classes.has(name),
        },
        setAttribute: vi.fn(),
        closest: () => null,
    };
}

function fakeDom(players) {
    const nodes = {};
    for (let n = 1; n <= players; n++) {
        const parts = {
            '.lv-plate__value': fakeElement(),
            '.lv-plate__rank': fakeElement(),
            '.lv-plate__goal-fill': fakeElement(),
        };
        const plate = fakeElement();
        plate.parts = parts;
        plate.querySelector = (selector) => parts[selector] || null;
        nodes[`p${n}-plate`] = plate;
        nodes[`p${n}-meta`] = fakeElement();
    }
    nodes['lv-match-bar'] = fakeElement();
    return {
        nodes,
        doc: {
            getElementById: (id) => nodes[id] || null,
            querySelectorAll: () => [],
            createElement: () => fakeElement(),
        },
    };
}

const entry = (values) => ({
    frags: 0, score: 0, lines: 0, level: 1, isAlive: true, ...values,
});

describe('local versus HUD', () => {
    afterEach(() => vi.restoreAllMocks());

    it('shows ranks only once someone leads, and the goal bar fills toward the target', () => {
        const { nodes, doc } = fakeDom(3);
        const hud = new LocalVersusHud({
            config: { endCondition: 'frags', endConditionValue: 4, numPlayers: 3 },
            numPlayers: 3,
            colorFor: () => ({ primary: '#3B82F6' }),
            doc,
        });
        hud.mount();
        hud.update([entry(), entry(), entry()]);
        expect(nodes['p1-plate'].parts['.lv-plate__rank'].hidden).toBe(true);

        hud.update([entry({ frags: 2 }), entry({ frags: 1 }), entry({ frags: 2, isAlive: false })]);
        const rank = (n) => nodes[`p${n}-plate`].parts['.lv-plate__rank'];
        expect([rank(1).textContent, rank(2).textContent, rank(3).textContent]).toEqual(['1st', '3rd', '1st']);
        expect(nodes['p1-plate'].parts['.lv-plate__value'].textContent).toBe('2');
        expect(nodes['p1-plate'].parts['.lv-plate__goal-fill'].style['--lv-goal']).toBe('0.5');
        expect(nodes['p3-plate'].classList.contains('is-out')).toBe(true);
        expect(nodes['p1-meta'].innerHTML).toContain('Level');
        expect(nodes['p1-meta'].innerHTML).not.toContain('Frags');
    });

    it('races teams by the team rule, and the clock turns to the last round', () => {
        const { nodes, doc } = fakeDom(2);
        const hud = new LocalVersusHud({
            config: {
                endCondition: 'frags', endConditionValue: 5, isTeamMode: true, playerTeams: [0, 1],
            },
            numPlayers: 2,
            colorFor: (i) => ({ primary: i ? '#EF4444' : '#3B82F6' }),
            doc,
        });
        hud.mount();
        hud.update([entry({ frags: 4, team: 0 }), entry({ frags: 0, team: 1 })], { teamTotals: { 0: 1, 1: 2 } });
        // The bar shows rounds won, not the players' frags; each teammate's bar fills by the team.
        expect(nodes['lv-match-bar'].innerHTML).toMatch(/Team A<\/span><span class="lv-match-bar__team-total">1</);
        expect(nodes['lv-match-bar'].innerHTML).toMatch(/Team B<\/span><span class="lv-match-bar__team-total">2</);
        expect(nodes['p1-plate'].parts['.lv-plate__goal-fill'].style['--lv-goal']).toBe('0.2');
        // Ranks are the bar's job in team play.
        expect(nodes['p1-plate'].parts['.lv-plate__rank'].hidden).toBe(true);

        const timed = new LocalVersusHud({
            config: { endCondition: 'time', endConditionValue: 3 }, numPlayers: 2, colorFor: () => ({}), doc,
        });
        timed.update([entry(), entry()], { clockMs: 61000 });
        expect(nodes['lv-match-bar'].innerHTML).toContain('>1:01<');
        timed.update([entry(), entry()], { clockMs: -200 });
        expect(nodes['lv-match-bar'].innerHTML).toContain('Last round');
    });
});
