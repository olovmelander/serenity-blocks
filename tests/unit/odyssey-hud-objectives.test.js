import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { OdysseyHUD } from '../../src/ui/odyssey/OdysseyHUD.js';
import { GameplayHybridEngine } from '../../src/core/odyssey/GameplayHybridEngine.js';
import { OdysseyBotMatch } from '../../src/core/odyssey/OdysseyBotMatch.js';
import { LEVEL_CONFIGS } from '../../src/core/odyssey/data/levels.js';

function classes() {
    const values = new Set();
    return {
        add: (...names) => names.forEach((name) => values.add(name)),
        contains: (name) => values.has(name),
        toggle: (name, value) => (value ? values.add(name) : values.delete(name)),
        remove: (...names) => names.forEach((name) => values.delete(name)),
    };
}

function hudFixture() {
    const hud = Object.create(OdysseyHUD.prototype);
    hud.metrics = {
        lines: 0, score: 0, frags: 0, bonuses: 0, deaths: 0,
    };
    hud.completedBonuses = new Set();
    hud.elapsedTime = 0;
    hud.levelConfig = {
        victory: { primary: { type: 'lines', target: 20 } },
        stars: { one: { lines: 20 }, two: { lines: 25 }, three: { lines: 30, bonuses: 1 } },
    };
    hud.progressValue = { textContent: '' };
    hud.progressBar = { style: {}, classList: classes() };
    hud.progressTrack = {};
    hud.timeDisplay = { textContent: '', classList: classes() };
    hud.starRows = Array.from({ length: 3 }, () => ({ classList: classes() }));
    hud.starsDisplay = { querySelectorAll: () => hud.starRows };
    hud.bonusItem = { classList: classes() };
    hud.bonusesDisplay = { querySelector: () => hud.bonusItem };
    return hud;
}

function node() {
    const styles = new Map();
    const element = {
        children: [],
        parentElement: null,
        dataset: {},
        classList: classes(),
        style: {
            getPropertyValue: (name) => styles.get(name) || '',
            setProperty: vi.fn((name, value) => styles.set(name, value)),
        },
        appendChild: vi.fn((child) => {
            child.parentElement?.removeChild(child);
            element.children.push(child);
            child.parentElement = element;
            return child;
        }),
        removeChild: vi.fn((child) => {
            element.children.splice(element.children.indexOf(child), 1);
            child.parentElement = null;
            return child;
        }),
        remove: vi.fn(() => element.parentElement?.removeChild(element)),
    };
    return element;
}

/** The external well remains alive when an attempt's HUD is hidden or replaced. */
function duelHudFixture({ stage = node(), well = node() } = {}) {
    const hud = hudFixture();
    hud.container = node();
    hud.objectiveDisplay = {};
    hud.guide = {};
    hud.guideText = {};
    hud.pauseHint = {};
    hud.isPaused = false;
    hud.isVisible = false;
    hud.opponentBoard = { update: vi.fn(), setPaused: vi.fn(), dispose: vi.fn() };
    ['playerFragsDisplay', 'botFragsDisplay', 'duelRoundDisplay', 'playerGarbageDisplay', 'botGarbageDisplay']
        .forEach((key) => { hud[key] = node(); });
    hud.duelScoreboard = { querySelector: () => ({}) };
    hud.duelPanel = node();
    hud.duelPanel.querySelector = () => ({});
    hud.botGarbageTrack = node();
    hud.duelPanel.appendChild(hud.botGarbageTrack);
    stage.querySelector = () => well;
    vi.stubGlobal('document', {
        querySelector: () => stage,
        createElement: () => node(),
    });
    hud.setDuel({ botName: 'Challenger', difficulty: 2 });
    return { hud, stage, well };
}

beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('Odyssey orb-level objective presentation', () => {
    it('shows higher line targets instead of silently dropping them from star requirements', () => {
        const hud = hudFixture();
        expect(hud._formatStarCondition({ lines: 25, time: 150 }, 1)).toBe('25 lines + Under 2:30');
        expect(hud._formatStarCondition({ frags: 7, maxDeaths: 0 }, 2)).toBe('Win 7 frags + No top-outs');
        expect(hud._formatStarCondition({ maxDeaths: 1 }, 2)).toBe('At most 1 top-out');
    });

    it('requires an actual bonus and retracts its star preview when the bonus is lost', () => {
        const hud = hudFixture();
        hud.updateMetrics({ lines: 30, bonusResults: [false] });
        expect(hud.starRows.map((row) => row.classList.contains('earned'))).toEqual([true, true, false]);
        hud.updateMetrics({ bonusResults: [true] });
        expect(hud.starRows[2].classList.contains('earned')).toBe(true);
        hud.updateMetrics({ bonusResults: [false] });
        expect(hud.starRows[2].classList.contains('earned')).toBe(false);
        expect(hud.metrics.bonuses).toBe(0);
    });

    it('honors maximum knockouts for duel stars, and reports frag progress accessibly', () => {
        const hud = hudFixture();
        hud.levelConfig.victory.primary = { type: 'frags', target: 7 };
        hud.levelConfig.stars = { one: { frags: 7 }, two: { frags: 7, maxDeaths: 3 }, three: { frags: 7, maxDeaths: 0 } };
        hud.updateMetrics({ frags: 7, deaths: 4 });
        expect(hud.progressValue.textContent).toBe('7 / 7');
        expect(hud.progressTrack.ariaValueNow).toBe('7');
        expect(hud.starRows.map((row) => row.classList.contains('earned'))).toEqual([true, false, false]);
    });

    it('advances survival progress and timed star previews when time updates without a line clear', () => {
        const hud = hudFixture();
        hud.levelConfig.victory.primary = { type: 'time', target: 60 };
        hud.levelConfig.stars = { one: { lines: 20 }, two: { lines: 20, time: 60 }, three: { lines: 20, time: 30 } };
        hud.updateMetrics({ lines: 20 });
        hud.updateTime(61000);
        expect(hud.progressValue.textContent).toBe('61 / 60');
        expect(hud.progressBar.style.width).toBe('100%');
        expect(hud.starRows.map((row) => row.classList.contains('earned'))).toEqual([true, false, false]);
    });

    it('uses the exact timed-star cutoff and supports combo and quad progress', () => {
        const hud = hudFixture();
        hud.elapsedTime = 60001;
        expect(hud._meetsCondition({ time: 60 })).toBe(false);
        hud.levelConfig.victory.primary = { type: 'combo', target: 4 };
        hud.updateMetrics({ combo: 3 });
        expect(hud.progressValue.textContent).toBe('3 / 4');
        hud.levelConfig.victory.primary = { type: 'tetrises', target: 3 };
        hud.updateMetrics({ tetrises: 2 });
        expect(hud.progressValue.textContent).toBe('2 / 3');
    });

    it('counts an unattributed self-knockout in duel star previews without inventing a bot frag', () => {
        const hud = hudFixture();
        hud.duel = { botName: 'Challenger', targetFrags: 7 };
        hud.duelScoreboard = {};
        ['playerFragsDisplay', 'botFragsDisplay', 'duelRoundDisplay', 'playerGarbageDisplay', 'botGarbageDisplay']
            .forEach((key) => { hud[key] = { textContent: '', classList: classes() }; });
        hud.setPaused = vi.fn();
        hud.updateDuel({ playerFrags: 7, botFrags: 0, deaths: 1 });
        expect(hud.metrics.deaths).toBe(1);
        expect(hud.botFragsDisplay.textContent).toBe('0');
        expect(hud._meetsCondition({ frags: 7, maxDeaths: 0 })).toBe(false);
    });
});

describe('Odyssey duel garbage meter ownership', () => {
    it('publishes real pending queues on both wells and clears them at the next round', async () => {
        const { hud } = duelHudFixture();
        const levelConfig = LEVEL_CONFIGS.find((level) => level.mechanics.versus);
        const hybridEngine = new GameplayHybridEngine();
        hybridEngine.configure(levelConfig);
        const session = { levelConfig, hybridEngine, gameState: hybridEngine.createGameState() };
        const match = new OdysseyBotMatch(session, { seed: 1234, isActive: () => true });
        session.duel = match;
        const publish = () => {
            const { playerPendingGarbage, botPendingGarbage, round } = match.getSnapshot();
            hud.updateDuel({ playerPendingGarbage, botPendingGarbage, round });
        };
        try {
            match.multiplayer.garbageQueues[0].enqueue(
                Array.from({ length: 7 }, () => ({ type: 'line', holeMask: 32 })),
            );
            match.multiplayer.garbageQueues[1].enqueue(
                Array.from({ length: 8 }, () => ({ type: 'line', holeMask: 32 })),
            );
            publish();
            expect(hud.playerGarbageTrack.style.getPropertyValue('--garbage-fill')).toBe('0.35');
            expect(hud.botGarbageTrack.style.getPropertyValue('--garbage-fill')).toBe('0.4');
            expect(hud.playerGarbageTrack.dataset.heavy).toBe('false');
            expect(hud.botGarbageTrack.dataset.heavy).toBe('true');
            expect(hud.playerGarbageDisplay.textContent).toBe('Incoming: 7 lines');
            expect(hud.botGarbageDisplay.textContent).toBe('Incoming: 8 lines');

            match.multiplayer.garbageQueues[0].enqueue(
                Array.from({ length: 20 }, () => ({ type: 'line', holeMask: 32 })),
            );
            publish();
            expect(hud.playerGarbageTrack.style.getPropertyValue('--garbage-fill')).toBe('1');
            expect(hud.playerGarbageDisplay.textContent).toBe('Incoming: 27 lines');
            expect(hud.playerGarbageTrack.dataset.heavy).toBe('true');

            match.markTopOut(1);
            match.update(100, 16, {});
            await match.transition;
            for (let frame = 0; frame < 18; frame++) match.update(1000 + frame * 50, 50, {});
            expect(match.round).toBe(2);
            publish();
            [hud.playerGarbageTrack, hud.botGarbageTrack].forEach((meter) => {
                expect(meter.style.getPropertyValue('--garbage-fill')).toBe('0');
                expect(meter.dataset.active).toBe('false');
                expect(meter.dataset.heavy).toBe('false');
            });
            expect(hud.playerGarbageDisplay.textContent).toBe('Incoming: 0 lines');
            expect(hud.botGarbageDisplay.textContent).toBe('Incoming: 0 lines');
        } finally { match.stop(); }
    });

    it('keeps both queues independent as attacks arrive and are consumed', () => {
        const { hud } = duelHudFixture();
        hud.updateDuel({ playerPendingGarbage: 2, botPendingGarbage: 30 });
        expect(hud.playerGarbageTrack.style.getPropertyValue('--garbage-fill')).toBe('0.1');
        expect(hud.botGarbageTrack.style.getPropertyValue('--garbage-fill')).toBe('1');
        expect(hud.playerGarbageTrack.dataset.active).toBe('true');
        expect(hud.botGarbageTrack.dataset.heavy).toBe('true');
        hud.updateDuel({ playerPendingGarbage: 8, botPendingGarbage: 0 });
        expect(hud.playerGarbageTrack.style.getPropertyValue('--garbage-fill')).toBe('0.4');
        expect(hud.playerGarbageTrack.dataset.heavy).toBe('true');
        expect(hud.botGarbageTrack.style.getPropertyValue('--garbage-fill')).toBe('0');
        expect(hud.botGarbageTrack.dataset.active).toBe('false');
        expect(hud.botGarbageTrack.dataset.heavy).toBe('false');
        expect(hud.botGarbageDisplay.classList.contains('has-garbage')).toBe(false);
        expect(hud.playerGarbageDisplay.classList.contains('has-garbage')).toBe(true);
    });

    it('shows one owned human meter in the external well and hides it with the HUD', () => {
        const { hud, well } = duelHudFixture();
        const meter = hud.playerGarbageTrack;
        expect(meter.hidden).toBe(true);
        expect(meter.parentElement).toBeNull();
        hud.show();
        hud.show();
        expect(meter.parentElement).toBe(well);
        expect(well.children).toEqual([meter]);
        expect(meter.hidden).toBe(false);
        expect(meter.ariaHidden).toBe('true');
        hud.hide();
        expect(meter.hidden).toBe(true);
        expect(hud.opponentBoard.setPaused).toHaveBeenLastCalledWith(true);
        hud.show();
        expect(meter.hidden).toBe(false);
        expect(well.children).toEqual([meter]);
        expect(hud.opponentBoard.setPaused).toHaveBeenLastCalledWith(false);
        hud.destroy();
    });

    it('removes the retired meter without touching the shared well or a replacement attempt', () => {
        const first = duelHudFixture();
        const unrelated = node();
        first.well.appendChild(unrelated);
        first.hud.show();
        const retiredMeter = first.hud.playerGarbageTrack;
        const observer = first.hud.opponentBoard;
        first.hud.destroy();
        expect(retiredMeter.parentElement).toBeNull();
        expect(first.hud.playerGarbageTrack).toBeNull();
        expect(observer.dispose).toHaveBeenCalledOnce();
        expect(first.well.children).toEqual([unrelated]);

        const replacement = duelHudFixture({ stage: first.stage, well: first.well });
        replacement.hud.show();
        const activeMeter = replacement.hud.playerGarbageTrack;
        first.hud.destroy();
        expect(first.well.children).toEqual([unrelated, activeMeter]);
        expect(activeMeter.parentElement).toBe(first.well);
        expect(activeMeter.hidden).toBe(false);
        replacement.hud.destroy();
        expect(first.well.children).toEqual([unrelated]);
    });
});
