import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { HALE_SESSIONS, SessionsTab } from '../../src/ui/serenity-hub/SessionsTab.js';
import { BreathCollectionService } from '../../src/ui/effects/breathing/breath-collection.js';
import { BreathworkSessionManager } from '../../src/ui/effects/breathwork-session-manager.js';
import { looseNode, looseWindow, targetMatching } from './helpers/loose-dom.js';

let container;
let hub;
let manager;
let tab;
let stored;

const flow = (selector) => tab.flow.querySelector(selector);
const clickFlow = (matches) => tab.flow.fire('click', { target: targetMatching(matches) });
const keyFlow = (key) => tab.flow.fire('keydown', { key, target: targetMatching({}) });

beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    stored = new Map();
    vi.stubGlobal('Audio', class {
        constructor() {
            this.pause = vi.fn();
            this.play = vi.fn().mockResolvedValue();
            this.load = vi.fn();
        }
    });
    vi.stubGlobal('window', looseWindow({
        localStorage: { getItem: (key) => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) },
    }));
    const body = looseNode('body');
    vi.stubGlobal('document', { body, createElement: (tag) => looseNode(tag), activeElement: null });
    container = looseNode();
    manager = new BreathworkSessionManager({});
    manager.startSession = vi.fn();
    manager.stopSession = vi.fn();
    manager.audioManager.setEnabled = vi.fn();
    manager.audioManager.playVoice = vi.fn();
    hub = {
        panel: { querySelector: () => container },
        hide: vi.fn(),
        show: vi.fn(),
        switchTab: vi.fn(),
        releaseGameplay: vi.fn(),
        breathingTab: { refresh: vi.fn() },
        // Every session found: these tests are about the sessions, not about finding them.
        serenityMode: { deps: { breathCollection: new BreathCollectionService({ developmentUnlockAll: true }) } },
    };
    tab = new SessionsTab(hub, manager);
});

afterEach(() => {
    tab.destroy();
    manager.destroy();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('Hale session facts', () => {
    it('reads length, holds and breaths from the practice the manager actually runs', () => {
        const base = tab.getSessionDetails('BASE');
        expect(base).toMatchObject({
            name: 'Hale Base', duration: '26 min', rounds: 3, maxHold: '2 min', breaths: 110,
        });
        expect(base.seconds).toBe(150 + 240 + 60 + 15 + 280 + 90 + 15 + 240 + 120 + 15 + 300);
        expect(base.stages).toHaveLength(11);
        expect(base.stages[1]).toEqual({
            type: 'active', round: 1, seconds: 240, breaths: 30, hold: null, world: 'electric-storm', paced: true,
        });
        // Each session is pictured by the world it opens with on the path.
        expect(base.poster).toBe('./assets/breathing/electric-storm.webp');
        expect(base.stages[2]).toMatchObject({ type: 'retention', hold: 'open', world: 'cosmic-breath' });
        expect(tab.getSessionDetails('REST').maxHold).toBe('no holds');
        // What the third fact on each card says: how each session's stillness works.
        expect(base.feature).toBe('Holds at your pace');
        expect(tab.getSessionDetails('REST').feature).toBe('Short holds, up to 7 sec');
        expect(tab.getSessionDetails('FLOW').feature).toBe('Short holds, up to 5 sec');
        expect(tab.getSessionDetails('FLOW').carrySeconds).toBe(108);
        expect(tab.getSessionDetails('FLOW').poster).toBe('./assets/breathing/triangle.webp');
        expect(tab.getSessionDetails('ELIXIR').poster).toBe('./assets/breathing/wim-hof.webp');
        expect(tab.getSessionDetails('NOPE')).toBeNull();
    });

    it('never shows NaN when a session definition is incomplete', () => {
        manager.SESSIONS.BASE = { totalRounds: 3, phases: [{ type: 'grounding' }, { type: 'retention', duration: 45 }] };
        expect(tab.getSessionDetails('BASE')).toMatchObject({ duration: '1 min', maxHold: '45 sec', breaths: 0 });
        manager.SESSIONS.BASE = undefined;
        expect(tab.getSessionDetails('BASE')).toMatchObject({ duration: '1 min', maxHold: 'no holds', rounds: 3 });
    });

    it('names every session, the short beginner ones first, and a way to begin each', () => {
        expect(Object.keys(HALE_SESSIONS)).toEqual([
            'FIRST', 'TIDE', 'ROOTS', 'UNWIND', 'SUNRISE', 'REST', 'FLOW', 'BASE', 'ELIXIR',
        ]);
        Object.entries(HALE_SESSIONS).forEach(([id, info]) => {
            expect(container.innerHTML).toContain(`data-session="${id}"`);
            expect(container.innerHTML).toContain(`Begin ${info.name}`);
        });
    });
});

describe('Hale beginner sessions in the catalogue', () => {
    it('describes them as short and free of breath holds', () => {
        ['FIRST', 'TIDE', 'ROOTS', 'UNWIND', 'SUNRISE'].forEach((id) => {
            const info = tab.getSessionDetails(id);
            expect(info.seconds, id).toBeGreaterThanOrEqual(200);
            expect(info.seconds, id).toBeLessThanOrEqual(300);
            expect(info.rounds, id).toBe(id === 'FIRST' ? 3 : 2);
            expect(info.feature, id).toBe('No breath holds');
            expect(info.openHolds, id).toBe(false);
            expect(container.innerHTML).toContain(`<p class="hale-card__promise">${info.promise}</p>`);
        });
        expect(tab.getSessionDetails('FIRST')).toMatchObject({
            duration: '5 min', breaths: 14, poster: './assets/breathing/coherence.webp',
        });
        expect(tab.getSessionDetails('TIDE')).toMatchObject({
            carrySeconds: 32, poster: './assets/breathing/ocean-breath.webp',
        });
        expect(tab.getSessionDetails('UNWIND').longestOutBreath).toBe(7);
        // Holds that are part of the rhythm itself are named as such.
        expect(tab.getSessionDetails('REST').feature).toBe('Short holds, up to 7 sec');
        expect(tab.getSessionDetails('FLOW').feature).toBe('Short holds, up to 5 sec');
    });

    it('ends a session without holds on its longest out-breath, not an empty hold', () => {
        tab.startSession('UNWIND');
        manager.startSession.mock.calls[0][2]({ sessionName: 'Hale Unwind', totalDuration: 254, rounds: 2 });
        const stats = flow('.hale-flow__stats').innerHTML;
        expect(stats).toContain('<dt>Longest out-breath</dt><dd>7 sec</dd>');
        expect(stats).not.toContain('no holds');
        tab.startSession('TIDE');
        manager.startSession.mock.calls[1][2]({ sessionName: 'Hale Tide', totalDuration: 261, rounds: 2 });
        expect(flow('.hale-flow__stats').innerHTML).toContain('<dt>On your own</dt><dd>0:32</dd>');
    });

    it('outlines rounds without a recovery breath they do not have', () => {
        tab.showPrepScreen('TIDE');
        const rounds = flow('.hale-flow__rounds').innerHTML;
        expect(rounds).toContain('<b>Arrive</b> 0:45 at your own pace</li>');
        expect(rounds).toContain('<b>Round 1</b> 10 breaths · 0:32 on your own</li>');
        expect(rounds).toContain('<b>Round 2</b> 8 breaths</li>');
        expect(rounds).not.toMatch(/reset|recover/);
    });

    it('offers each its own intentions, spoken from its own lines', () => {
        tab.showPrepScreen('SUNRISE');
        expect(flow('.hale-flow__intentions').innerHTML).toContain('Wake up gently');
        tab.selectIntention('wake', 'SUNRISE');
        expect(manager.audioManager.playVoice).toHaveBeenCalledWith('intentions/sunrise_wake');
    });
});

describe('Hale session flow', () => {
    it('opens preparation as its own surface: the Hub steps aside but nothing starts yet', () => {
        container.fire('click', { target: targetMatching({ '.hale-card__begin': { dataset: { session: 'FLOW' } } }) });
        expect(tab.flowOpen).toBe(true);
        expect(tab.step).toBe('prepare');
        expect(tab.flow.dataset.session).toBe('FLOW');
        expect(flow('.hale-flow__name').textContent).toBe('Hale Flow');
        expect(flow('.hale-flow__facts').textContent).toBe('16 min · Moderate · Box and triangle');
        expect(flow('.hale-flow__rounds').innerHTML).toContain('<b>Round 2</b> 12 breaths · 0:36 on your own</li>');
        expect(flow('.hale-flow__rounds').innerHTML).toContain('<b>Arrive</b> 1:30 at your own pace');
        expect(flow('.hale-flow__rounds').innerHTML).toContain("url('./assets/breathing/triangle.webp')");
        expect(flow('.hale-flow__caution').hidden).toBe(true);
        expect(flow('.hale-flow__track').innerHTML.match(/<i /g)).toHaveLength(8);
        expect(flow('.hale-flow__begin').disabled).toBe(false);
        expect(hub.hide).toHaveBeenCalledOnce();
        expect(manager.startSession).not.toHaveBeenCalled();
    });

    it('keeps the intention optional: choosing speaks it, choosing again clears it', () => {
        tab.showPrepScreen('BASE');
        const calm = Object.assign(looseNode('button'), { dataset: { intention: 'calm' } });
        tab.flow.lists['.hale-flow__intention'] = [calm];
        clickFlow({ '.hale-flow__intention': calm });
        expect(tab.selectedIntention.label).toBe('Find calm');
        expect(calm.getAttribute('aria-pressed')).toBe('true');
        expect(manager.audioManager.playVoice).toHaveBeenCalledWith('intentions/base_calm');
        expect(flow('.hale-flow__begin').getAttribute('aria-label')).toBe('Begin Hale Base with intention: Find calm');
        clickFlow({ '.hale-flow__intention': calm });
        expect(tab.selectedIntention).toBeNull();
        expect(calm.getAttribute('aria-pressed')).toBe('false');
        expect(manager.audioManager.playVoice).toHaveBeenCalledTimes(1);
    });

    it('counts down, then hands the session to the manager with the voice preference', async () => {
        tab.showPrepScreen('REST');
        tab.flow.querySelector('.hale-flow__voice').fire('change', { target: { checked: false } });
        clickFlow({ '.hale-flow__begin': true });
        expect(tab.step).toBe('countdown');
        expect(flow('.hale-flow__number').textContent).toBe('3');
        expect(flow('.hale-flow__intent').textContent).toBe('Nothing to achieve. Just be here.');
        await vi.advanceTimersByTimeAsync(2100);
        expect(flow('.hale-flow__number').textContent).toBe('1');
        expect(manager.startSession).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(2000);
        expect(manager.startSession).toHaveBeenCalledOnce();
        expect(manager.startSession.mock.calls[0][0]).toBe('REST');
        expect(manager.audioManager.setEnabled).toHaveBeenLastCalledWith(false);
        expect(tab.flowOpen).toBe(false);
        expect(hub.hide).toHaveBeenCalledTimes(2);
    });

    it('returns from the countdown to preparation, and from preparation to the catalogue', async () => {
        tab.showPrepScreen('BASE');
        const countdown = tab.startCountdown();
        await vi.advanceTimersByTimeAsync(500);
        const escape = keyFlow('Escape');
        await countdown;
        expect(escape.defaultPrevented).toBe(true);
        expect(tab.step).toBe('prepare');
        await vi.advanceTimersByTimeAsync(6000);
        expect(manager.startSession).not.toHaveBeenCalled();
        keyFlow('Escape');
        expect(tab.flowOpen).toBe(false);
        expect(tab.pendingSessionId).toBeNull();
        expect(hub.switchTab).toHaveBeenCalledWith('sessions');
        expect(hub.show).toHaveBeenCalledOnce();
    });

    it('shows a result after a natural finish, counts it, and resumes play when dismissed', () => {
        tab.showPrepScreen('BASE');
        tab.selectIntention('ground', 'BASE');
        tab.startSession('BASE');
        const finish = manager.startSession.mock.calls[0][2];
        // The guide has already stopped here; the session still holds the screen for its result.
        expect(tab.holdsScreen).toBe(true);
        tab.showStep(null);
        expect(tab.holdsScreen).toBe(true);
        finish({ sessionName: 'Hale Base', totalDuration: 1555, rounds: 3 });
        expect(tab.step).toBe('complete');
        expect(flow('.hale-flow__done-name').textContent).toBe('Hale Base');
        expect(flow('.hale-flow__stats').innerHTML).toContain('<dd>25:55</dd>');
        expect(flow('.hale-flow__stats').innerHTML).toContain('<dd>110</dd>');
        expect(flow('.hale-flow__closing').textContent).toContain('You arrived with: Ground myself.');
        expect(JSON.parse(stored.get('serenity.haleSessions'))).toMatchObject({ count: 1, seconds: 1555, last: { id: 'BASE' } });
        expect(hub.releaseGameplay).not.toHaveBeenCalled();
        clickFlow({ '.hale-flow__finish': true });
        expect(tab.flowOpen).toBe(false);
        expect(tab.holdsScreen).toBe(false);
        expect(hub.releaseGameplay).toHaveBeenCalledOnce();
        tab.setActive(true);
        const practice = container.querySelector('.hale__practice');
        expect(practice.hidden).toBe(false);
        expect(practice.innerHTML).toContain('1 session completed · 26 min of practice · last: Hale Base');
        expect(practice.innerHTML).toContain('<b>1</b><span>day</span>');
        expect(container.querySelector('[data-mine="BASE"]').textContent).toBe('You · 1 completed');
    });

    it('offers the same session again from its result', () => {
        tab.startSession('FLOW');
        manager.startSession.mock.calls[0][2]({ sessionName: 'Hale Flow', totalDuration: 900, rounds: 3 });
        clickFlow({ '.hale-flow__again': true });
        expect(tab.step).toBe('prepare');
        expect(tab.pendingSessionId).toBe('FLOW');
    });

    it('ends without a result when the player stops, and ignores the old session\'s late callbacks', () => {
        tab.startSession('BASE');
        const [, report, finish] = manager.startSession.mock.calls[0];
        manager.onEndRequested();
        expect(tab.holdsScreen).toBe(false);
        expect(manager.stopSession).toHaveBeenCalledOnce();
        expect(hub.releaseGameplay).toHaveBeenCalledOnce();
        expect(hub.breathingTab.refresh).toHaveBeenCalled();
        finish({ sessionName: 'Hale Base', totalDuration: 60, rounds: 3 });
        report({ sessionName: 'Hale Base', phase: 'active' });
        expect(tab.flowOpen).toBe(false);
        expect(tab.activeSessionData).toBeNull();
        expect(stored.size).toBe(0);
    });

    it('closes every surface on a mode change without reopening the Hub or resuming play', async () => {
        tab.showPrepScreen('ELIXIR');
        const countdown = tab.startCountdown();
        await vi.advanceTimersByTimeAsync(1200);
        hub.show.mockClear();
        tab.cancelForModeChange();
        await countdown;
        await vi.advanceTimersByTimeAsync(6000);
        expect(manager.startSession).not.toHaveBeenCalled();
        expect(manager.stopSession).toHaveBeenCalledOnce();
        expect(tab.flowOpen).toBe(false);
        expect(tab.pendingSessionId).toBeNull();
        expect(hub.show).not.toHaveBeenCalled();
        expect(hub.releaseGameplay).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('removes its surface and timers when destroyed mid-countdown', async () => {
        tab.showPrepScreen('BASE');
        const surface = tab.flow;
        const countdown = tab.startCountdown();
        tab.destroy();
        await countdown;
        await vi.advanceTimersByTimeAsync(6000);
        expect(surface.removed).toBe(true);
        expect(manager.startSession).not.toHaveBeenCalled();
        expect(manager.onEndRequested).toBeNull();
        expect(vi.getTimerCount()).toBe(0);
    });
});

describe('Hale catalogue while a session runs', () => {
    it('does no work while the Hub is closed and shows the latest stage when it opens', () => {
        manager.activeSession = {};
        tab.startSession('BASE');
        const report = manager.startSession.mock.calls[0][1];
        const live = container.querySelector('.hale__live');
        live.hidden = true;
        for (let i = 0; i < 50; i++) {
            report({
                sessionName: 'Hale Base', round: 2, totalRounds: 3, phase: 'retention',
            });
        }
        expect(live.hidden).toBe(true);
        expect(live.querySelector('.hale__live-name').textContent).toBe('');
        tab.setActive(true);
        expect(live.hidden).toBe(false);
        expect(live.querySelector('.hale__live-name').textContent).toBe('Hale Base · Round 2 of 3 · Hold');
        container.fire('click', { target: targetMatching({ '.hale__return': true }) });
        expect(hub.hide).toHaveBeenCalledTimes(2);
        // Ending twenty minutes of practice takes a second press.
        container.fire('click', { target: targetMatching({ '.hale__end': true }) });
        expect(manager.stopSession).not.toHaveBeenCalled();
        expect(container.querySelector('.hale__end').textContent).toBe('Press again to end');
        container.fire('click', { target: targetMatching({ '.hale__end': true }) });
        expect(manager.stopSession).toHaveBeenCalledOnce();
        expect(live.hidden).toBe(true);
    });

    it('forgets a single End press after a few seconds', async () => {
        manager.activeSession = {};
        tab.startSession('BASE');
        container.fire('click', { target: targetMatching({ '.hale__end': true }) });
        await vi.advanceTimersByTimeAsync(4100);
        expect(container.querySelector('.hale__end').textContent).toBe('End session');
        container.fire('click', { target: targetMatching({ '.hale__end': true }) });
        expect(manager.stopSession).not.toHaveBeenCalled();
    });

    it('holds the session while the Hub is open over it and lets it go on when the Hub closes', () => {
        manager.activeSession = {};
        manager.suspend = vi.fn();
        manager.unsuspend = vi.fn();
        tab.startSession('BASE');
        window.dispatchEvent({ type: 'serenityHubVisibilityChange', detail: { visible: true } });
        expect(manager.suspend).toHaveBeenCalledExactlyOnceWith('hub');
        window.dispatchEvent({ type: 'serenityHubVisibilityChange', detail: { visible: false } });
        expect(manager.unsuspend).toHaveBeenCalledExactlyOnceWith('hub');
        tab.stopSession();
        window.dispatchEvent({ type: 'serenityHubVisibilityChange', detail: { visible: true } });
        expect(manager.suspend).toHaveBeenCalledOnce();
    });
});

describe('Hale preparation choices', () => {
    it('asks once for the safety note before a session with strong holds, and remembers it', () => {
        tab.showPrepScreen('ELIXIR');
        expect(flow('.hale-flow__caution').hidden).toBe(false);
        expect(flow('.hale-flow__ack').hidden).toBe(false);
        expect(flow('.hale-flow__begin').disabled).toBe(true);
        clickFlow({ '.hale-flow__begin': true });
        expect(tab.step).toBe('prepare');
        const ack = flow('.hale-flow__ack-input');
        ack.checked = true;
        ack.fire('change', { target: { checked: true } });
        expect(flow('.hale-flow__begin').disabled).toBe(false);
        expect(JSON.parse(stored.get('serenity.halePrefs'))).toMatchObject({ safetyAcknowledged: true });
        tab.hidePrepScreen();
        tab.showPrepScreen('BASE');
        expect(flow('.hale-flow__ack').hidden).toBe(true);
        expect(flow('.hale-flow__begin').disabled).toBe(false);
        expect(flow('.hale-flow__switch--holds').hidden).toBe(false);
        tab.showPrepScreen('REST');
        expect(flow('.hale-flow__caution').hidden).toBe(true);
        expect(flow('.hale-flow__switch--holds').hidden).toBe(true);
    });

    it('hands the session your intention and choices, and keeps the choices for next time', () => {
        tab.showPrepScreen('BASE');
        flow('.hale-flow__sounds').fire('change', { target: { checked: false } });
        flow('.hale-flow__holds').fire('change', { target: { checked: false } });
        expect(flow('.hale-flow__rounds').innerHTML).toContain('<b>Round 1</b> 30 breaths · hold 1:00 · recover');
        tab.selectIntention('calm', 'BASE');
        tab.startSession('BASE');
        expect(manager.startSession.mock.calls[0][3]).toEqual({
            intention: {
                id: 'calm', icon: 'wave', label: 'Find calm', clip: 'intentions/base_calm',
            },
            openHolds: false,
            sounds: false,
            vibration: true,
        });
        expect(JSON.parse(stored.get('serenity.halePrefs'))).toMatchObject({ sounds: false, openHolds: false });
        tab.destroy();
        tab = new SessionsTab(hub, manager);
        expect(tab.prefs).toMatchObject({ sounds: false, openHolds: false, voice: true });
    });

    it('never hands a session another session\'s intention', () => {
        tab.showPrepScreen('BASE');
        tab.selectIntention('calm', 'BASE');
        tab.startSession('REST');
        expect(manager.startSession.mock.calls[0][3].intention).toBeNull();
        expect(tab.selectedIntention).toBeNull();
    });

    it('says "follow the light" when the voice is off', async () => {
        tab.showPrepScreen('FLOW');
        flow('.hale-flow__voice').fire('change', { target: { checked: false } });
        tab.startCountdown();
        await vi.advanceTimersByTimeAsync(3050);
        expect(flow('.hale-flow__number').textContent).toBe('Begin');
        expect(flow('.hale-flow__message').textContent).toBe('Follow the light');
    });
});

describe('Hale results and your practice', () => {
    const holds = (...seconds) => seconds.map((value, index) => ({
        round: index + 1, seconds: value, suggested: [60, 90, 120][index], mode: 'open',
    }));

    it('shows what you measured: your holds round by round, and a new best when you beat it', () => {
        tab.startSession('BASE');
        manager.startSession.mock.calls[0][2]({
            sessionName: 'Hale Base', totalDuration: 1500, rounds: 3, breaths: 110, holds: holds(64, 95, 118),
        });
        expect(flow('.hale-flow__stats').innerHTML).toContain('<dd>1:58</dd>');
        expect(flow('.hale-flow__stats').innerHTML).toContain('<dt>Longest hold</dt>');
        const chart = flow('.hale-flow__holds-chart');
        expect(chart.hidden).toBe(false);
        expect(chart.innerHTML.match(/<li /g)).toHaveLength(3);
        expect(chart.innerHTML).toContain('<b>1:35</b>');
        expect(chart.innerHTML).toContain('marks show the suggested length');
        // A first measured hold is a beginning, not a record.
        expect(flow('.hale-flow__record').hidden).toBe(true);
        expect(flow('.hale-flow__streak-line').textContent).toBe('Practised today · 1 session · 25 min of practice');
        clickFlow({ '.hale-flow__finish': true });

        tab.startSession('BASE');
        manager.startSession.mock.calls[1][2]({
            sessionName: 'Hale Base', totalDuration: 1520, rounds: 3, breaths: 110, holds: holds(70, 101, 131),
        });
        expect(flow('.hale-flow__record').hidden).toBe(false);
        expect(flow('.hale-flow__record').innerHTML).toContain('New best hold: 2:11');
        expect(flow('.hale-flow__record').innerHTML).toContain('was 1:58');
        expect(flow('.hale-flow__holds-chart').innerHTML).toContain('previous best 1:58');
        tab.showPrepScreen('BASE');
        expect(flow('.hale-flow__best').hidden).toBe(false);
        expect(flow('.hale-flow__best').textContent).toBe('Your best hold in Hale Base: 2:11');
    });

    it('keeps the practice of a session you ended, but does not call it completed', () => {
        manager.snapshot = vi.fn(() => ({
            sessionId: 'ELIXIR', totalDuration: 420, rounds: 1, breaths: 70, holds: holds(80), intention: null,
        }));
        tab.startSession('ELIXIR');
        manager.onEndRequested();
        const log = JSON.parse(stored.get('serenity.haleSessions'));
        expect(log).toMatchObject({ count: 0, seconds: 420, last: { id: 'ELIXIR' } });
        expect(log.entries).toHaveLength(1);
        expect(log.entries[0]).toMatchObject({ completed: false, breaths: 70 });
        manager.snapshot = vi.fn(() => ({
            sessionId: 'ELIXIR', totalDuration: 20, rounds: 0, breaths: 5, holds: [], intention: null,
        }));
        tab.startSession('ELIXIR');
        manager.onEndRequested();
        expect(JSON.parse(stored.get('serenity.haleSessions')).entries).toHaveLength(1);
    });

    it('names the stillness of each session in its result', () => {
        tab.startSession('FLOW');
        manager.startSession.mock.calls[0][2]({
            sessionName: 'Hale Flow', totalDuration: 1460, rounds: 3, breaths: 45, holds: [],
        });
        expect(flow('.hale-flow__stats').innerHTML).toContain('<dt>On your own</dt><dd>1:48</dd>');
        expect(flow('.hale-flow__holds-chart').hidden).toBe(true);
        clickFlow({ '.hale-flow__finish': true });
        tab.startSession('REST');
        manager.startSession.mock.calls[1][2]({
            sessionName: 'Hale Rest',
            totalDuration: 1100,
            rounds: 3,
            breaths: 37,
            holds: [],
        });
        // Rest drifts between its rounds: no pause to chart, the time on your own instead.
        expect(flow('.hale-flow__stats').innerHTML).toContain('<dt>On your own</dt><dd>1:08</dd>');
    });
});

describe('Hale sessions you have not found yet', () => {
    const chapterOne = { completedLevels: Object.fromEntries([1, 2, 3, 4, 5].map((id) => [id, { stars: 2 }])) };
    function withCollection(collection) {
        tab.destroy();
        hub.serenityMode.deps.breathCollection = collection;
        tab = new SessionsTab(hub, manager);
        return collection;
    }

    it('shows them in the catalogue with where each is found, and never begins one', () => {
        withCollection(new BreathCollectionService());
        const html = container.innerHTML;
        expect(html).toContain('<article class="hale-card" data-session="FIRST">');
        expect(html).toContain('Begin Hale First Breath');
        expect(html).toContain('<article class="hale-card is-locked" data-session="TIDE">');
        expect(html).toContain('Opens when you reach the Deep Ocean, or after 15 more minutes of breathing');
        expect(html).toContain('Opens when you complete the Odyssey, or after 120 more minutes of breathing');
        expect(html).not.toContain('Begin Hale Elixir');
        tab.showPrepScreen('TIDE');
        expect(tab.pendingSessionId).toBeNull();
        tab.startSession('TIDE');
        expect(manager.startSession).not.toHaveBeenCalled();
        tab.startSession('FIRST');
        expect(manager.startSession).toHaveBeenCalledOnce();
    });

    it('marks a session that has just opened as new until you open its preparation', () => {
        const collection = withCollection(new BreathCollectionService({ readOdysseyProgress: () => chapterOne }));
        expect(container.innerHTML).toContain('<article class="hale-card is-new" data-session="TIDE">');
        expect(container.innerHTML).toContain('<span class="hale-card__new">New</span>');
        tab.showPrepScreen('TIDE');
        expect(tab.pendingSessionId).toBe('TIDE');
        expect(collection.status('sessions', 'TIDE').isNew).toBe(false);
    });

    it('says on the result what the practice opened, and opens it in the catalogue', () => {
        let seconds = 0;
        withCollection(new BreathCollectionService({ readPracticeSeconds: () => seconds }));
        tab.startSession('FIRST');
        seconds = 15 * 60;
        manager.startSession.mock.calls[0][2]({ sessionName: 'Hale First Breath', totalDuration: 226, rounds: 3 });
        const line = flow('.hale-flow__opened');
        expect(line.hidden).toBe(false);
        expect(line.innerHTML).toBe('<span class="hale-flow__opened-label">New</span> Ocean Tide and Hale Tide are yours now, opened by your practice.');
        expect(container.innerHTML).toContain('<article class="hale-card is-new" data-session="TIDE">');
        expect(container.innerHTML).toContain('Begin Hale Tide');
        tab.startSession('FIRST');
        manager.startSession.mock.calls[1][2]({ sessionName: 'Hale First Breath', totalDuration: 226, rounds: 3 });
        expect(line.hidden).toBe(true);
    });
});
