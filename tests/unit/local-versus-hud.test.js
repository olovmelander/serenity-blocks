import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import {
    LocalVersusHud,
    competitionRanks,
    formatClock,
    versusGoal,
    versusMetaStats,
    versusMetric,
    versusMode,
} from '../../src/ui/local-versus-hud.js';
import {
    keyboardScheme, seatSetupControls, versusCoachRows, versusControls,
} from '../../src/ui/local-seat-controls.js';

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
        // A survivor team's frag goal counts the rounds it wins...
        expect(versusGoal({
            endCondition: 'frags', endConditionValue: 7, isTeamMode: true, gameType: 'survivor',
        })).toBe('First team to 7 rounds');
        // ...in free-for-all (the default) its players' kills.
        expect(versusGoal({ endCondition: 'frags', endConditionValue: 7, isTeamMode: true })).toBe('First team to 7 frags');
        expect(versusGoal({ endCondition: 'frags', endConditionValue: 7, gameType: 'survivor' })).toBe('First to 7 frags');
        expect(versusGoal({ endCondition: 'time', endConditionValue: 3 })).toBe('Highest score in 3 min');
        expect(versusGoal({ endCondition: 'points', endConditionValue: 10 })).toBe(`First to ${(10000).toLocaleString()} points`);
        expect(versusGoal({ isInfinityLMS: true })).toBe('Last one standing');
        expect(versusMode({ isInfinityLMS: true })).toBe('Infinity');
        expect(versusMode({ attackStyle: 'hot_potato' })).toBe('Hot potato');
        expect(versusMode({ isTeamMode: true })).toBe('Teams');
        expect(versusMode({})).toBe('Free-for-all');
        expect(versusMode({ gameType: 'survivor' })).toBe('Survivor');
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
        // Free-for-all: players die and play on, so kills and deaths lead the line.
        const ffa = { ...entry, deaths: 3 };
        expect(versusMetaStats(ffa, 'frags', { respawns: true })).toEqual([['Deaths', '3'], ['Lines', '12'], ['Score', (4200).toLocaleString()]]);
        expect(versusMetaStats(ffa, 'score', { respawns: true }).map(([label]) => label)).toEqual(['Frags', 'Deaths', 'Lines']);
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
        // Without settings the defaults speak (arrows, WASD).
        expect(versusControls(0, { kind: 'human' }, {})).toBe('Arrow keys');
        // The setup sheet names the controller that also drives the seat.
        expect(seatSetupControls(1, SETTINGS)).toBe('WASD · Controller 2');
        expect(seatSetupControls(3, SETTINGS)).toBe('Controller 4');
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
    const element = {
        innerHTML: '',
        textContent: '',
        hidden: false,
        dataset: {},
        children: [],
        parentElement: null,
        style: { setProperty: vi.fn(function setProperty(name, value) { this[name] = value; }) },
        classList: {
            toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)),
            add: (name) => classes.add(name),
            remove: (name) => classes.delete(name),
            contains: (name) => classes.has(name),
        },
        setAttribute: vi.fn(),
        appendChild: vi.fn((child) => {
            element.children.push(child);
            child.parentElement = element;
        }),
        remove: vi.fn(),
        closest: () => null,
    };
    return element;
}

function fakeDom(players) {
    const nodes = {};
    for (let n = 1; n <= players; n++) {
        const parts = {
            '.lv-plate__value': fakeElement(),
            '.lv-plate__rank': fakeElement(),
            '.lv-plate__goal-fill': fakeElement(),
        };
        const card = fakeElement();
        const plate = fakeElement();
        plate.parts = parts;
        plate.querySelector = (selector) => parts[selector] || null;
        plate.closest = (selector) => (selector === '.player-card' ? card : null);
        nodes[`player-${n}-card`] = card;
        nodes[`p${n}-plate`] = plate;
        nodes[`p${n}-meta`] = fakeElement();
        const well = fakeElement();
        const meter = fakeElement();
        const fill = fakeElement();
        meter.parentElement = well;
        meter.querySelector = (selector) => (selector === '.garbage-fill' ? fill : null);
        meter.fill = fill;
        nodes[`p${n}-garbage-bar`] = meter;
        const section = fakeElement();
        nodes[`p${n}-phaser-container`] = { closest: () => section };
        nodes[`p${n}-section`] = section;
    }
    nodes['lv-match-bar'] = fakeElement();
    const stage = fakeElement();
    const append = stage.appendChild;
    // Like the real DOM, an appended element with an id can be found by it.
    stage.appendChild = (child) => {
        append(child);
        if (child.id) nodes[child.id] = child;
    };
    nodes['multiplayer-container'] = stage;
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
            config: {
                endCondition: 'frags', endConditionValue: 4, numPlayers: 3, gameType: 'survivor',
            },
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
                endCondition: 'frags', endConditionValue: 5, isTeamMode: true, playerTeams: [0, 1], gameType: 'survivor',
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
            config: { endCondition: 'time', endConditionValue: 3, gameType: 'survivor' }, numPlayers: 2, colorFor: () => ({}), doc,
        });
        timed.update([entry(), entry()], { clockMs: 61000 });
        expect(nodes['lv-match-bar'].innerHTML).toContain('>1:01<');
        expect(nodes['lv-match-bar'].innerHTML).toContain('Round 1');
        timed.update([entry(), entry()], { clockMs: -200 });
        expect(nodes['lv-match-bar'].innerHTML).toContain('Last round');

        // Free-for-all is one long match: no rounds to count or wait for.
        const ffa = new LocalVersusHud({
            config: { endCondition: 'time', endConditionValue: 3 }, numPlayers: 2, colorFor: () => ({}), doc,
        });
        ffa.update([entry(), entry()], { clockMs: 61000 });
        expect(nodes['lv-match-bar'].innerHTML).not.toContain('Round');
        ffa.update([entry(), entry()], { clockMs: -200 });
        expect(nodes['lv-match-bar'].innerHTML).toContain('>0:00<');
        expect(nodes['lv-match-bar'].innerHTML).not.toContain('Last round');
    });

    it('pops a frag, turns a well coral near the top, and names who knocked a player out', () => {
        vi.useFakeTimers();
        const { nodes, doc } = fakeDom(2);
        const hud = new LocalVersusHud({
            config: {
                endCondition: 'frags',
                endConditionValue: 5,
                gameType: 'survivor',
                playerSlots: [{ name: 'Ada' }, { name: 'Bot 2', kind: 'bot' }],
            },
            numPlayers: 2,
            colorFor: (i) => ({ primary: i ? '#EF4444' : '#3B82F6' }),
            doc,
        });
        hud.mount();
        hud.update([entry(), entry({ stack: 16 })]);
        expect(nodes['player-2-card'].classList.contains('lv-danger')).toBe(true);
        expect(nodes['player-1-card'].classList.contains('lv-danger')).toBe(false);

        hud.update([entry({ frags: 1 }), entry({ stack: 16 })]);
        expect(nodes['p1-plate'].children.map((c) => c.textContent)).toContain('+1');
        vi.advanceTimersByTime(20);
        expect(nodes['p1-plate'].classList.contains('is-bumped')).toBe(true);

        // The coral holds until the stack is clearly lower (no flicker at the line).
        hud.update([entry({ frags: 1 }), entry({ stack: 14 })]);
        expect(nodes['player-2-card'].classList.contains('lv-danger')).toBe(true);
        hud.update([entry({ frags: 1 }), entry({ stack: 12 })]);
        expect(nodes['player-2-card'].classList.contains('lv-danger')).toBe(false);

        // Incoming garbage fills the channel; a heavy attack makes it glow.
        hud.update([entry({ frags: 1, incoming: 5 }), entry({ incoming: 10 })]);
        expect(nodes['p1-garbage-bar'].fill.style.height).toBe('25%');
        expect(nodes['p1-garbage-bar'].classList.contains('is-heavy')).toBe(false);
        expect(nodes['p2-garbage-bar'].classList.contains('is-heavy')).toBe(true);

        hud.showKnockout(1, 0);
        expect(nodes['p2-section'].children[0].innerHTML).toContain('By Ada');
        expect(nodes['p2-section'].children[0].innerHTML).toContain('Back next round');
        hud.showKnockout(0, 0);
        expect(nodes['p1-section'].children[0].innerHTML).toContain('Topped out');
        vi.useRealTimers();
    });

    it('does not promise a next round in Infinity\'s Last Standing, which is one round', () => {
        const { nodes, doc } = fakeDom(2);
        const hud = new LocalVersusHud({
            config: { isInfinityLMS: true, playerSlots: [{ name: 'Ada' }, { name: 'Bot 2', kind: 'bot' }] },
            numPlayers: 2,
            colorFor: () => ({ primary: '#3B82F6' }),
            doc,
        });
        hud.showKnockout(1, 0);
        const card = nodes['p2-section'].children[0].innerHTML;
        expect(card).toContain('By Ada');
        expect(card).toContain('Out for this match');
        expect(card).not.toContain('next round');
    });

    it('tells a free-for-all player how to play again, and a bot comes back on its own', () => {
        vi.useFakeTimers();
        const { nodes, doc } = fakeDom(2);
        const hud = new LocalVersusHud({
            config: {
                endCondition: 'frags', endConditionValue: 5, playerSlots: [{ name: 'Ada' }, { name: 'Bot 2', kind: 'bot' }],
            },
            numPlayers: 2,
            colorFor: () => ({ primary: '#3B82F6' }),
            doc,
        });
        hud.showKnockout(0, 1);
        const card = nodes['p1-section'].children[0];
        expect(card.innerHTML).toContain('By Bot 2');
        expect(card.innerHTML).toContain('<span class="lv-ko__note is-respawn">Press any key to play again</span>');
        expect(card.innerHTML).not.toContain('next round');
        hud.showKnockout(1, null);
        const botCard = nodes['p2-section'].children[0];
        expect(botCard.innerHTML).toContain('Topped out');
        expect(botCard.innerHTML).toContain('Back in a moment');
        expect(botCard.innerHTML).not.toContain('is-respawn');

        // One player plays again: only their card goes.
        hud.clearKnockout(0);
        expect(card.remove).toHaveBeenCalled();
        expect(botCard.remove).not.toHaveBeenCalled();
        vi.useRealTimers();
    });

    it('crowns each winner\'s well with a Victory crest in their colour, then clears it', () => {
        vi.useFakeTimers();
        const { nodes, doc } = fakeDom(3);
        doc.querySelectorAll = () => [nodes['p1-plate'], nodes['p3-plate']];
        const hud = new LocalVersusHud({
            config: { playerSlots: [{ name: 'Ada' }, { name: 'Bot 2', kind: 'bot' }, { name: '<b>Cy</b>' }] },
            numPlayers: 3,
            colorFor: (i) => ({ primary: ['#3B82F6', '#EF4444', '#10B981'][i] }),
            doc,
        });
        hud.showVictory([0, 2]);
        const crest = nodes['p1-section'].children.find((c) => c.className === 'lv-victory');
        expect(crest.innerHTML).toContain('Victory');
        expect(crest.innerHTML).toContain('Ada');
        expect(crest.style.setProperty).toHaveBeenCalledWith('--win-color', '#3B82F6');
        // Names are escaped: a player can type anything into a name.
        const third = nodes['p3-section'].children.find((c) => c.className === 'lv-victory');
        expect(third.innerHTML).toContain('&lt;b&gt;Cy&lt;/b&gt;');
        expect(nodes['p2-section'].children).toHaveLength(0);
        expect(nodes['p1-plate'].classList.contains('is-victor')).toBe(true);
        // The light rises first, then the crest.
        expect(crest.classList.contains('is-shown')).toBe(false);
        vi.advanceTimersByTime(400);
        expect(crest.classList.contains('is-shown')).toBe(true);

        hud.clearVictory();
        expect(crest.remove).toHaveBeenCalled();
        expect(third.remove).toHaveBeenCalled();
        expect(nodes['p1-plate'].classList.contains('is-victor')).toBe(false);
        hud.destroy();
        vi.useRealTimers();
    });

    it('shows each human\'s controls under their board, in the stats line\'s place, never on the board', () => {
        vi.useFakeTimers();
        const { nodes, doc } = fakeDom(2);
        const hud = new LocalVersusHud({
            config: { playerSlots: [{ kind: 'human' }, { kind: 'bot', difficulty: 8 }] },
            numPlayers: 2,
            colorFor: () => ({ primary: '#3B82F6' }),
            settings: SETTINGS,
            doc,
        });
        hud.showCoach();
        const card = nodes['player-1-card'];
        const coach = card.children.find((c) => c.className === 'lv-coach');
        expect(coach.innerHTML).toContain('<kbd>Space</kbd>');
        expect(card.classList.contains('lv-coaching')).toBe(true);
        expect(nodes['p1-section'].children).toHaveLength(0);
        // The bot's board gets none.
        expect(nodes['player-2-card'].children).toHaveLength(0);
        expect(nodes['player-2-card'].classList.contains('lv-coaching')).toBe(false);

        // The stats come back as it leaves.
        vi.advanceTimersByTime(6000);
        expect(card.classList.contains('lv-coaching')).toBe(false);
        hud.destroy();
        vi.useRealTimers();
    });

    it('tells the round and lands an attack in the target\'s channel', () => {
        vi.useFakeTimers();
        const { nodes, doc } = fakeDom(2);
        const hud = new LocalVersusHud({
            config: { playerSlots: [{ name: 'Ada' }, { name: 'Bot 2' }] },
            numPlayers: 2,
            colorFor: () => ({ primary: '#3B82F6' }),
            doc,
        });
        hud.announceRound(2, { winnerIndex: 0 });
        const banner = nodes['multiplayer-container'].children[0];
        expect(banner.innerHTML).toContain('Round 2');
        expect(banner.innerHTML).toContain('Ada takes it');
        hud.announceRound(3, { winnerIndex: 1, selfKill: true });
        expect(banner.innerHTML).toContain('Topped out, no frag');

        // No animation available: the hit lands at once (the reduced-motion path).
        hud.showAttack(0, [1], 4);
        const label = nodes['p2-garbage-bar'].parentElement.children.find((c) => c.className === 'lv-hit');
        expect(label.textContent).toBe('+4');
        vi.advanceTimersByTime(20);
        expect(nodes['p2-garbage-bar'].classList.contains('is-hit')).toBe(true);
        hud.destroy();
        vi.useRealTimers();
    });
});

// Audit 2026-11-18 A18-PERF-4: a layout read after a DOM write forces a synchronous style and
// layout pass. An attack on three boards must read every rect before it draws the first streak.
function attackDom(targets) {
    const log = [];
    const rect = (left, top, width, height) => ({
        left, top, width, height, right: left + width, bottom: top + height,
    });
    const nodes = {
        'multiplayer-container': { appendChild: (child) => log.push(`append ${child.label}`) },
    };
    const section = {
        animate: () => {},
        getBoundingClientRect: () => {
            log.push('read origin');
            return rect(40, 60, 280, 560);
        },
    };
    nodes['p1-phaser-container'] = { closest: (selector) => (selector === '.player-board-section' ? section : null) };
    targets.forEach((target, i) => {
        const n = target + 1;
        const classes = new Set();
        nodes[`p${n}-garbage-bar`] = {
            parentElement: { appendChild: (label) => log.push(`hit p${n} ${label.textContent}`) },
            classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) },
            getBoundingClientRect: () => {
                log.push(`read p${n}`);
                return rect(400 + 380 * i, 90 + 7 * i, 18, 520 - 150 * i);
            },
        };
    });
    const created = [];
    const createElement = () => {
        const label = `node${created.length + 1}`;
        const animations = [];
        const part = (name) => ({
            animate: (keyframes, options) => {
                log.push(`animate ${label} ${name}`);
                animations.push({ part: name, keyframes, options });
            },
        });
        const parts = { '.lv-attack__orb': part('orb'), '.lv-attack__trail': part('trail') };
        let cssText = '';
        let html = '';
        const el = {
            label,
            className: '',
            textContent: '',
            animations,
            style: {
                get cssText() { return cssText; },
                set cssText(value) {
                    log.push(`style ${label}`);
                    cssText = value;
                },
                setProperty: () => {},
            },
            get innerHTML() { return html; },
            set innerHTML(value) {
                log.push(`html ${label}`);
                html = value;
            },
            querySelector: (selector) => parts[selector] || null,
            remove: () => log.push(`remove ${label}`),
        };
        created.push(el);
        return el;
    };
    return {
        log,
        streaks: () => created.filter((el) => el.className === 'lv-attack'),
        doc: { getElementById: (id) => nodes[id] || null, querySelectorAll: () => [], createElement },
    };
}

describe('local versus HUD: an attack on several boards', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    const hudFor = (doc) => new LocalVersusHud({
        config: { numPlayers: 4 },
        numPlayers: 4,
        colorFor: () => ({ primary: '#ff7a59' }),
        doc,
    });
    const isRead = (step) => step.startsWith('read ');

    it('reads every board\'s position before it draws the first streak (no forced layout per target)', () => {
        vi.useFakeTimers();
        const { log, doc } = attackDom([1, 2, 3]);
        hudFor(doc).showAttack(0, [1, 2, 3], 4);
        const firstWrite = log.findIndex((step) => !isRead(step));
        expect(firstWrite).toBeGreaterThan(0);
        expect(log.slice(firstWrite).filter(isRead)).toEqual([]);
        expect(log.filter(isRead)).toEqual(['read origin', 'read p2', 'read p3', 'read p4']);
    });

    it('draws the same streaks, and each target is hit in turn as its streak lands', () => {
        vi.useFakeTimers();
        const { log, doc, streaks } = attackDom([1, 2, 3]);
        hudFor(doc).showAttack(0, [1, 2, 3], 4);
        const drawn = streaks().map((s) => ({ css: s.style.cssText, html: s.innerHTML, animations: s.animations }));
        // The streaks as the interleaved version drew them, value for value.
        const orb = (dx, dy) => ({
            part: 'orb',
            keyframes: [{ transform: 'translate(-50%, -50%) scale(0.6)' },
                { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(1.15)` }],
            options: { duration: 440, easing: 'cubic-bezier(0.55, 0, 0.8, 0.4)', fill: 'forwards' },
        });
        const trail = (angle) => ({
            part: 'trail',
            keyframes: [{ transform: `rotate(${angle}) scaleX(0)`, opacity: 0.9 },
                { transform: `rotate(${angle}) scaleX(1)`, opacity: 0.6, offset: 0.85 },
                { transform: `rotate(${angle}) scaleX(1)`, opacity: 0 }],
            options: { duration: 600, easing: 'ease-in', fill: 'forwards' },
        });
        const html = '<span class="lv-attack__trail"></span><span class="lv-attack__orb"></span>';
        const css = (len) => `left:180px;top:295.2px;--attack-color:#ff7a59;--attack-len:${len}px`;
        expect(drawn).toEqual([
            { css: css('342.5843545756286'), html, animations: [orb(229, 254.8), trail('0.8387rad')] },
            { css: css('619.1770667587746'), html, animations: [orb(609, 111.80000000000001), trail('0.1816rad')] },
            { css: css('989.3469765456405'), html, animations: [orb(989, -26.19999999999999), trail('-0.0265rad')] },
        ]);

        log.length = 0;
        vi.advanceTimersByTime(440);
        expect(log).toEqual([
            'remove node1', 'hit p2 +4',
            'remove node2', 'hit p3 +4',
            'remove node3', 'hit p4 +4',
        ]);
    });

    it('with reduced motion, lands every hit at once and reads no layout', () => {
        vi.useFakeTimers();
        vi.stubGlobal('window', { settingsManager: { get: () => ({ reducedMotion: true }) } });
        const { log, doc, streaks } = attackDom([1, 2, 3]);
        hudFor(doc).showAttack(0, [1, 2, 3], 4);
        expect(streaks()).toEqual([]);
        expect(log).toEqual(['hit p2 +4', 'hit p3 +4', 'hit p4 +4']);
    });
});
