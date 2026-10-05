import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { HALE_SESSIONS, SessionsTab } from '../../src/ui/serenity-hub/SessionsTab.js';
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
        expect(base.seconds).toBe(180 + 240 + 60 + 15 + 280 + 90 + 15 + 240 + 120 + 15 + 300);
        expect(base.stages).toHaveLength(11);
        expect(base.stages[1]).toEqual({
            type: 'active', round: 1, seconds: 240, breaths: 30,
        });
        expect(base.poster).toBe('./assets/breathing/ocean-breath.webp');
        expect(tab.getSessionDetails('REST').maxHold).toBe('30 sec');
        expect(tab.getSessionDetails('ELIXIR').poster).toBe('./assets/breathing/wim-hof.webp');
        expect(tab.getSessionDetails('NOPE')).toBeNull();
    });

    it('never shows NaN when a session definition is incomplete', () => {
        manager.SESSIONS.BASE = { totalRounds: 3, phases: [{ type: 'grounding' }, { type: 'retention', duration: 45 }] };
        expect(tab.getSessionDetails('BASE')).toMatchObject({ duration: '1 min', maxHold: '45 sec', breaths: 0 });
        manager.SESSIONS.BASE = undefined;
        expect(tab.getSessionDetails('BASE')).toMatchObject({ duration: '1 min', maxHold: 'no holds', rounds: 3 });
    });

    it('names all four sessions and a way to begin each', () => {
        expect(Object.keys(HALE_SESSIONS)).toEqual(['BASE', 'ELIXIR', 'REST', 'FLOW']);
        Object.entries(HALE_SESSIONS).forEach(([id, info]) => {
            expect(container.innerHTML).toContain(`data-session="${id}"`);
            expect(container.innerHTML).toContain(`Begin ${info.name}`);
        });
    });
});

describe('Hale session flow', () => {
    it('opens preparation as its own surface: the Hub steps aside but nothing starts yet', () => {
        container.fire('click', { target: targetMatching({ '.hale-card__begin': { dataset: { session: 'FLOW' } } }) });
        expect(tab.flowOpen).toBe(true);
        expect(tab.step).toBe('prepare');
        expect(tab.flow.dataset.session).toBe('FLOW');
        expect(flow('.hale-flow__name').textContent).toBe('Hale Flow');
        expect(flow('.hale-flow__facts').textContent).toBe('25 min · Moderate · Box breathing');
        expect(flow('.hale-flow__rounds').innerHTML).toContain('<b>Round 2</b> 15 breaths · hold 0:40 · recover');
        expect(flow('.hale-flow__rounds').innerHTML).toContain('<b>Arrive</b> 2:00 of slow breathing');
        expect(flow('.hale-flow__track').innerHTML.match(/<i /g)).toHaveLength(11);
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
        expect(manager.audioManager.playVoice).toHaveBeenCalledWith('intentions/base_calm.wav');
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
        expect(container.querySelector('.hale__practice').textContent).toBe('1 session completed · 26 min of practice · last: Hale Base');
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
        container.fire('click', { target: targetMatching({ '.hale__end': true }) });
        expect(manager.stopSession).toHaveBeenCalledOnce();
        expect(live.hidden).toBe(true);
    });
});
