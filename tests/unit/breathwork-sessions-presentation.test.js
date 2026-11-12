import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { SUKHA_SESSIONS, SessionsTab } from '../../src/ui/serenity-hub/SessionsTab.js';
import { BreathCollectionService } from '../../src/ui/effects/breathing/breath-collection.js';
import { BreathworkSessionManager } from '../../src/ui/effects/breathwork-session-manager.js';
import {
    BREATH_CAUTION, BREATH_SAFETY_ACK, BREATH_SAFETY_VERSION, isStrongSession,
} from '../../src/ui/effects/breathing/breath-safety.js';
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

describe('Sukha session facts', () => {
    it('reads length, holds and breaths from the practice the manager actually runs', () => {
        const base = tab.getSessionDetails('BASE');
        expect(base).toMatchObject({
            name: 'Sukha Homecoming', duration: '24 min', rounds: 3, hasHolds: true, breaths: 110,
        });
        // Every hold is planned at the same reminder: none is longer than the one before.
        expect(base.seconds).toBe(150 + 240 + 60 + 15 + 280 + 60 + 15 + 240 + 60 + 15 + 300);
        expect(base.stages).toHaveLength(11);
        expect(base.stages[1]).toEqual({
            type: 'active', round: 1, seconds: 240, breaths: 30, world: 'electric-storm', paced: true,
        });
        // Each session is pictured by the world it opens with on the path.
        expect(base.poster).toBe('./assets/breathing/electric-storm.webp');
        expect(base.stages[2]).toMatchObject({ type: 'retention', world: 'cosmic-breath' });
        // No fact names a hold's length: there is none to reach.
        expect(base).not.toHaveProperty('maxHold');
        expect(tab.getSessionDetails('REST').hasHolds).toBe(false);
        // What the third fact on each card says: how each session's stillness works.
        expect(base.feature).toBe('Holds at your pace');
        expect(tab.getSessionDetails('REST').feature).toBe('Short holds, up to 7 sec');
        expect(tab.getSessionDetails('FLOW').feature).toBe('Short holds, up to 5 sec');
        expect(tab.getSessionDetails('FLOW').carrySeconds).toBe(108);
        expect(tab.getSessionDetails('FLOW').poster).toBe('./assets/breathing/triangle.webp');
        expect(tab.getSessionDetails('ELIXIR').poster).toBe('./assets/breathing/volcanic-fire.webp');
        expect(tab.getSessionDetails('NOPE')).toBeNull();
    });

    it('never shows NaN when a session definition is incomplete', () => {
        manager.SESSIONS.BASE = { totalRounds: 3, phases: [{ type: 'grounding' }, { type: 'retention', duration: 45 }] };
        expect(tab.getSessionDetails('BASE'))
            .toMatchObject({ duration: '1 min', feature: 'Holds at your pace', breaths: 0 });
        manager.SESSIONS.BASE = undefined;
        expect(tab.getSessionDetails('BASE'))
            .toMatchObject({ duration: '1 min', feature: 'No breath holds', rounds: 3 });
    });

    it('names every session, the short beginner ones first, and a way to begin each', () => {
        expect(Object.keys(SUKHA_SESSIONS)).toEqual([
            'FIRST', 'TIDE', 'ROOTS', 'UNWIND', 'SUNRISE', 'REST', 'FLOW', 'BASE', 'ELIXIR',
        ]);
        Object.entries(SUKHA_SESSIONS).forEach(([id, info]) => {
            expect(container.innerHTML).toContain(`data-session="${id}"`);
            expect(container.innerHTML).toContain(`Begin ${info.name}`);
        });
    });
});

describe('Sukha beginner sessions in the catalogue', () => {
    it('describes them as short and free of breath holds', () => {
        ['FIRST', 'TIDE', 'ROOTS', 'UNWIND', 'SUNRISE'].forEach((id) => {
            const info = tab.getSessionDetails(id);
            expect(info.seconds, id).toBeGreaterThanOrEqual(200);
            expect(info.seconds, id).toBeLessThanOrEqual(300);
            expect(info.rounds, id).toBe(id === 'FIRST' ? 3 : 2);
            expect(info.feature, id).toBe('No breath holds');
            expect(info.hasHolds, id).toBe(false);
            expect(container.innerHTML).toContain(`<p class="sukha-card__promise">${info.promise}</p>`);
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
        manager.startSession.mock.calls[0][2]({ sessionName: 'Sukha Unwind', totalDuration: 254, rounds: 2 });
        const stats = flow('.sukha-flow__stats').innerHTML;
        expect(stats).toContain('<dt>Longest out-breath</dt><dd>7 sec</dd>');
        expect(stats).not.toContain('<dt>Holds</dt>');
        tab.startSession('TIDE');
        manager.startSession.mock.calls[1][2]({ sessionName: 'Sukha Tide', totalDuration: 261, rounds: 2 });
        expect(flow('.sukha-flow__stats').innerHTML).toContain('<dt>On your own</dt><dd>0:32</dd>');
    });

    it('outlines rounds without a recovery breath they do not have', () => {
        tab.showPrepScreen('TIDE');
        const rounds = flow('.sukha-flow__rounds').innerHTML;
        expect(rounds).toContain('<b>Arrive</b> 0:45 at your own pace</li>');
        expect(rounds).toContain('<b>Round 1</b> 10 breaths · 0:32 on your own</li>');
        expect(rounds).toContain('<b>Round 2</b> 8 breaths</li>');
        expect(rounds).not.toMatch(/reset|recover/);
    });

    it('offers each its own intentions, spoken from its own lines', () => {
        tab.showPrepScreen('SUNRISE');
        expect(flow('.sukha-flow__intentions').innerHTML).toContain('Wake up gently');
        tab.selectIntention('wake', 'SUNRISE');
        expect(manager.audioManager.playVoice).toHaveBeenCalledWith('intentions/sunrise_wake');
    });
});

describe('Sukha session flow', () => {
    it('opens preparation as its own surface: the Hub steps aside but nothing starts yet', () => {
        container.fire('click', { target: targetMatching({ '.sukha-card__begin': { dataset: { session: 'FLOW' } } }) });
        expect(tab.flowOpen).toBe(true);
        expect(tab.step).toBe('prepare');
        expect(tab.flow.dataset.session).toBe('FLOW');
        expect(flow('.sukha-flow__name').textContent).toBe('Sukha Mandala');
        expect(flow('.sukha-flow__facts').textContent).toBe('16 min · Moderate · Box and triangle');
        expect(flow('.sukha-flow__rounds').innerHTML).toContain('<b>Round 2</b> 12 breaths · 0:36 on your own</li>');
        expect(flow('.sukha-flow__rounds').innerHTML).toContain('<b>Arrive</b> 1:30 at your own pace');
        expect(flow('.sukha-flow__rounds').innerHTML).toContain("url('./assets/breathing/triangle.webp')");
        expect(flow('.sukha-flow__caution').hidden).toBe(true);
        expect(flow('.sukha-flow__track').innerHTML.match(/<i /g)).toHaveLength(8);
        expect(flow('.sukha-flow__begin').disabled).toBe(false);
        expect(hub.hide).toHaveBeenCalledOnce();
        expect(manager.startSession).not.toHaveBeenCalled();
    });

    it('keeps the intention optional: choosing speaks it, choosing again clears it', () => {
        tab.showPrepScreen('BASE');
        const calm = Object.assign(looseNode('button'), { dataset: { intention: 'calm' } });
        tab.flow.lists['.sukha-flow__intention'] = [calm];
        clickFlow({ '.sukha-flow__intention': calm });
        expect(tab.selectedIntention.label).toBe('Find calm');
        expect(calm.getAttribute('aria-pressed')).toBe('true');
        expect(manager.audioManager.playVoice).toHaveBeenCalledWith('intentions/base_calm');
        expect(flow('.sukha-flow__begin').getAttribute('aria-label')).toBe('Begin Sukha Homecoming with intention: Find calm');
        clickFlow({ '.sukha-flow__intention': calm });
        expect(tab.selectedIntention).toBeNull();
        expect(calm.getAttribute('aria-pressed')).toBe('false');
        expect(manager.audioManager.playVoice).toHaveBeenCalledTimes(1);
    });

    it('counts down, then hands the session to the manager with the voice preference', async () => {
        tab.showPrepScreen('REST');
        tab.flow.querySelector('.sukha-flow__voice').fire('change', { target: { checked: false } });
        clickFlow({ '.sukha-flow__begin': true });
        expect(tab.step).toBe('countdown');
        expect(flow('.sukha-flow__number').textContent).toBe('3');
        expect(flow('.sukha-flow__intent').textContent).toBe('Nothing to achieve. Just be here.');
        await vi.advanceTimersByTimeAsync(2100);
        expect(flow('.sukha-flow__number').textContent).toBe('1');
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
        finish({ sessionName: 'Sukha Homecoming', totalDuration: 1555, rounds: 3 });
        expect(tab.step).toBe('complete');
        expect(flow('.sukha-flow__done-name').textContent).toBe('Sukha Homecoming');
        expect(flow('.sukha-flow__stats').innerHTML).toContain('<dd>25:55</dd>');
        expect(flow('.sukha-flow__stats').innerHTML).toContain('<dd>110</dd>');
        expect(flow('.sukha-flow__closing').textContent).toContain('You arrived with: Ground myself.');
        expect(JSON.parse(stored.get('serenity.sukhaSessions'))).toMatchObject({ count: 1, seconds: 1555, last: { id: 'BASE' } });
        expect(hub.releaseGameplay).not.toHaveBeenCalled();
        clickFlow({ '.sukha-flow__finish': true });
        expect(tab.flowOpen).toBe(false);
        expect(tab.holdsScreen).toBe(false);
        expect(hub.releaseGameplay).toHaveBeenCalledOnce();
        tab.setActive(true);
        const practice = container.querySelector('.sukha__practice');
        expect(practice.hidden).toBe(false);
        expect(practice.innerHTML).toContain('1 session completed · 26 min of practice · last: Sukha Homecoming');
        expect(practice.innerHTML).toContain('<b>1</b><span>day</span>');
        expect(container.querySelector('[data-mine="BASE"]').textContent).toBe('You · 1 completed');
    });

    it('offers the same session again from its result', () => {
        tab.startSession('FLOW');
        manager.startSession.mock.calls[0][2]({ sessionName: 'Sukha Mandala', totalDuration: 900, rounds: 3 });
        expect(flow('.sukha-flow__again').hidden).toBe(false);
        expect(flow('.sukha-flow__again').disabled).toBe(false);
        clickFlow({ '.sukha-flow__again': true });
        expect(tab.step).toBe('prepare');
        expect(tab.pendingSessionId).toBe('FLOW');
    });

    it('offers Done alone after a strong session: no "Go again"', () => {
        ['BASE', 'ELIXIR', 'SUNRISE'].forEach((id, index) => {
            tab.startSession(id);
            const finish = manager.startSession.mock.calls[index][2];
            finish({ sessionName: SUKHA_SESSIONS[id].name, totalDuration: 900, rounds: 3 });
            expect(flow('.sukha-flow__again').hidden, id).toBe(true);
            // Out of the Tab order and the pad's reach too, not only out of sight.
            expect(flow('.sukha-flow__again').disabled, id).toBe(true);
            clickFlow({ '.sukha-flow__finish': true });
        });
        // A gentle session after it offers it again.
        tab.startSession('TIDE');
        manager.startSession.mock.calls[3][2]({ sessionName: 'Sukha Tide', totalDuration: 261, rounds: 2 });
        expect(flow('.sukha-flow__again').hidden).toBe(false);
        expect(flow('.sukha-flow__again').disabled).toBe(false);
    });

    it('ends without a result when the player stops, and ignores the old session\'s late callbacks', () => {
        tab.startSession('BASE');
        const [, report, finish] = manager.startSession.mock.calls[0];
        manager.onEndRequested();
        expect(tab.holdsScreen).toBe(false);
        expect(manager.stopSession).toHaveBeenCalledOnce();
        expect(hub.releaseGameplay).toHaveBeenCalledOnce();
        expect(hub.breathingTab.refresh).toHaveBeenCalled();
        finish({ sessionName: 'Sukha Homecoming', totalDuration: 60, rounds: 3 });
        report({ sessionName: 'Sukha Homecoming', phase: 'active' });
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

describe('Sukha catalogue while a session runs', () => {
    it('does no work while the Hub is closed and shows the latest stage when it opens', () => {
        manager.activeSession = {};
        tab.startSession('BASE');
        const report = manager.startSession.mock.calls[0][1];
        const live = container.querySelector('.sukha__live');
        live.hidden = true;
        for (let i = 0; i < 50; i++) {
            report({
                sessionName: 'Sukha Homecoming', round: 2, totalRounds: 3, phase: 'retention',
            });
        }
        expect(live.hidden).toBe(true);
        expect(live.querySelector('.sukha__live-name').textContent).toBe('');
        tab.setActive(true);
        expect(live.hidden).toBe(false);
        expect(live.querySelector('.sukha__live-name').textContent).toBe('Sukha Homecoming · Round 2 of 3 · Hold');
        container.fire('click', { target: targetMatching({ '.sukha__return': true }) });
        expect(hub.hide).toHaveBeenCalledTimes(2);
        // Ending twenty minutes of practice takes a second press.
        container.fire('click', { target: targetMatching({ '.sukha__end': true }) });
        expect(manager.stopSession).not.toHaveBeenCalled();
        expect(container.querySelector('.sukha__end').textContent).toBe('Press again to end');
        container.fire('click', { target: targetMatching({ '.sukha__end': true }) });
        expect(manager.stopSession).toHaveBeenCalledOnce();
        expect(live.hidden).toBe(true);
    });

    it('forgets a single End press after a few seconds', async () => {
        manager.activeSession = {};
        tab.startSession('BASE');
        container.fire('click', { target: targetMatching({ '.sukha__end': true }) });
        await vi.advanceTimersByTimeAsync(4100);
        expect(container.querySelector('.sukha__end').textContent).toBe('End session');
        container.fire('click', { target: targetMatching({ '.sukha__end': true }) });
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

describe('Sukha preparation choices', () => {
    it('asks once for the safety note before a session with strong holds, and remembers it', () => {
        tab.showPrepScreen('ELIXIR');
        expect(flow('.sukha-flow__caution').hidden).toBe(false);
        expect(flow('.sukha-flow__ack').hidden).toBe(false);
        expect(flow('.sukha-flow__begin').disabled).toBe(true);
        clickFlow({ '.sukha-flow__begin': true });
        expect(tab.step).toBe('prepare');
        const ack = flow('.sukha-flow__ack-input');
        ack.checked = true;
        ack.fire('change', { target: { checked: true } });
        expect(flow('.sukha-flow__begin').disabled).toBe(false);
        expect(JSON.parse(stored.get('serenity.sukhaPrefs'))).toMatchObject({ safetyAcknowledged: true });
        tab.hidePrepScreen();
        tab.showPrepScreen('BASE');
        expect(flow('.sukha-flow__ack').hidden).toBe(true);
        expect(flow('.sukha-flow__begin').disabled).toBe(false);
        tab.showPrepScreen('REST');
        expect(flow('.sukha-flow__caution').hidden).toBe(true);
    });

    it('draws the note as a lead line and a short list, with the tick that names what it asks', () => {
        const html = tab.flow.innerHTML;
        expect(html).toContain(`<span>${BREATH_CAUTION.lead}</span>`);
        expect(html.match(/<ul class="breath-note__points">/g)).toHaveLength(1);
        BREATH_CAUTION.points.forEach((point) => expect(html).toContain(`<li>${point}</li>`));
        expect(html).toContain(`<span>${BREATH_SAFETY_ACK}</span>`);
        expect(BREATH_SAFETY_ACK).toBe('I am 18 or over, I have read this, and none of it applies to me');
        expect(html).not.toContain('I understand');
    });

    it('has no switch for timed holds, and says beside the voice switch that the voice is AI-generated', () => {
        const html = tab.flow.innerHTML;
        expect(html).not.toContain('sukha-flow__holds');
        expect(html).not.toContain('Holds end when you choose');
        const disclosure = '<span>Voice guidance <small>The guide\'s voice is AI-generated.</small></span>';
        // It sits in the voice switch's own label, right after the switch.
        expect(html.split('sukha-flow__voice" checked>')[1].trim().startsWith(disclosure)).toBe(true);
    });

    it('never calls a session gentle that asks for the safety note', () => {
        Object.entries(manager.SESSIONS).forEach(([id, session]) => {
            const strong = isStrongSession(session.phases);
            expect(tab.getSessionDetails(id).strong, id).toBe(strong);
            // The label on the card and the one the manager carries are the same.
            expect(SUKHA_SESSIONS[id].intensity, id).toBe(session.intensity);
            if (strong) expect(session.intensity, id).not.toBe('Gentle');
        });
        expect(SUKHA_SESSIONS.BASE.intensity).toBe('Strong');
    });

    it('asks for the note before fast breathing too, and again when only the old note was read', () => {
        // A tick on the note before its words changed (2026-11-03) does not count for the new one.
        stored.set('serenity.sukhaPrefs', JSON.stringify({ safetyAcknowledged: true }));
        tab.destroy();
        tab = new SessionsTab(hub, manager);
        expect(tab.getSessionDetails('SUNRISE'))
            .toMatchObject({ hasHolds: false, strong: true, intensity: 'Moderate' });
        tab.showPrepScreen('SUNRISE');
        expect(flow('.sukha-flow__caution').hidden).toBe(false);
        expect(flow('.sukha-flow__ack').hidden).toBe(false);
        expect(flow('.sukha-flow__begin').disabled).toBe(true);
        const ack = flow('.sukha-flow__ack-input');
        ack.checked = true;
        ack.fire('change', { target: { checked: true } });
        expect(flow('.sukha-flow__begin').disabled).toBe(false);
        expect(stored.get('serenity.breathSafetyRead')).toBe(BREATH_SAFETY_VERSION);
        // Gentle sessions show the plain line, with the wellness words, and no note.
        for (const id of ['FIRST', 'TIDE', 'ROOTS', 'UNWIND', 'REST', 'FLOW']) {
            expect(tab.getSessionDetails(id).strong, id).toBe(false);
        }
        tab.showPrepScreen('FLOW');
        expect(flow('.sukha-flow__caution').hidden).toBe(true);
        expect(flow('.sukha-flow__safety').hidden).toBe(false);
    });

    it('keeps choices saved under the sessions\' old key, and saves them under the new one', () => {
        stored.set('serenity.halePrefs', JSON.stringify({ sounds: false, openHolds: false }));
        tab.destroy();
        tab = new SessionsTab(hub, manager);
        expect(tab.prefs).toMatchObject({ sounds: false, voice: true });
        tab.savePrefs({ vibration: false });
        expect(JSON.parse(stored.get('serenity.sukhaPrefs'))).toMatchObject({ sounds: false, vibration: false });
    });

    it('drops a saved choice of timed holds: a hold always ends when you breathe in', () => {
        stored.set('serenity.sukhaPrefs', JSON.stringify({ sounds: true, openHolds: false }));
        tab.destroy();
        tab = new SessionsTab(hub, manager);
        expect(tab.prefs).not.toHaveProperty('openHolds');
        tab.showPrepScreen('BASE');
        expect(flow('.sukha-flow__rounds').innerHTML)
            .toContain('<b>Round 1</b> 30 breaths · hold at your own pace · recover');
        tab.startSession('BASE');
        expect(manager.startSession.mock.calls[0][3]).not.toHaveProperty('openHolds');
        tab.savePrefs({ sounds: false });
        expect(JSON.parse(stored.get('serenity.sukhaPrefs'))).not.toHaveProperty('openHolds');
    });

    it('hands the session your intention and choices, and keeps the choices for next time', () => {
        tab.showPrepScreen('BASE');
        flow('.sukha-flow__sounds').fire('change', { target: { checked: false } });
        // The journey says a hold is at your own pace, and names no length for it anywhere.
        const rounds = flow('.sukha-flow__rounds').innerHTML;
        [1, 2, 3].forEach((round) => {
            const line = new RegExp(`<b>Round ${round}</b> \\d+ breaths · hold at your own pace · recover</li>`);
            expect(rounds).toMatch(line);
        });
        expect(flow('.sukha-flow__track').innerHTML.match(/title="Hold · at your own pace"/g)).toHaveLength(3);
        expect(flow('.sukha-flow__track').innerHTML).not.toMatch(/title="Hold · \d/);
        tab.selectIntention('calm', 'BASE');
        tab.startSession('BASE');
        expect(manager.startSession.mock.calls[0][3]).toEqual({
            intention: {
                id: 'calm', icon: 'wave', label: 'Find calm', clip: 'intentions/base_calm',
            },
            sounds: false,
            vibration: true,
        });
        expect(JSON.parse(stored.get('serenity.sukhaPrefs'))).toMatchObject({ sounds: false });
        tab.destroy();
        tab = new SessionsTab(hub, manager);
        expect(tab.prefs).toMatchObject({ sounds: false, voice: true });
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
        flow('.sukha-flow__voice').fire('change', { target: { checked: false } });
        tab.startCountdown();
        await vi.advanceTimersByTimeAsync(3050);
        expect(flow('.sukha-flow__number').textContent).toBe('Begin');
        expect(flow('.sukha-flow__message').textContent).toBe('Follow the light');
    });
});

describe('Sukha results and your practice', () => {
    const holds = (...seconds) => seconds.map((value, index) => ({
        round: index + 1, seconds: value, suggested: 60, mode: 'open',
    }));

    it('counts your holds and shows no hold time at all: no chart, no best, no time to beat', () => {
        tab.startSession('BASE');
        manager.startSession.mock.calls[0][2]({
            sessionName: 'Sukha Homecoming', totalDuration: 1500, rounds: 3, breaths: 110, holds: holds(64, 85, 38),
        });
        const stats = flow('.sukha-flow__stats').innerHTML;
        expect(stats).toContain('<dt>Holds at your pace</dt><dd>3</dd>');
        expect(stats).not.toContain('Longest');
        // No hold's seconds are on the result in any form.
        ['1:04', '1:25', '0:38', '64', '85'].forEach((time) => expect(stats, time).not.toContain(time));
        // The flow has no place for a chart, a record or a best at all.
        expect(tab.flow.innerHTML).not.toMatch(/sukha-flow__(holds-chart|bar|record|best)\b/);
        expect(tab.flow.innerHTML).not.toMatch(/suggested/i);
        expect(flow('.sukha-flow__streak-line').textContent).toBe('Practised today · 1 session · 25 min of practice');
        // The practice log still keeps each hold's seconds, as a note of the sitting.
        expect(JSON.parse(stored.get('serenity.sukhaSessions')).entries[0].holds).toEqual([
            { round: 1, seconds: 64, suggested: 60, mode: 'open' },
            { round: 2, seconds: 85, suggested: 60, mode: 'open' },
            { round: 3, seconds: 38, suggested: 60, mode: 'open' },
        ]);
        clickFlow({ '.sukha-flow__finish': true });

        tab.startSession('BASE');
        manager.startSession.mock.calls[1][2]({
            sessionName: 'Sukha Homecoming', totalDuration: 1520, rounds: 3, breaths: 110, holds: holds(70, 90, 90),
        });
        // Holding longer the next time changes nothing on the result.
        expect(flow('.sukha-flow__stats').innerHTML).toContain('<dt>Holds at your pace</dt><dd>3</dd>');
        clickFlow({ '.sukha-flow__finish': true });
        tab.setActive(true);
        expect(container.querySelector('[data-mine="BASE"]').textContent).toBe('You · 2 completed');
    });

    it('keeps the practice of a session you ended, but does not call it completed', () => {
        manager.snapshot = vi.fn(() => ({
            sessionId: 'ELIXIR', totalDuration: 420, rounds: 1, breaths: 70, holds: holds(80), intention: null,
        }));
        tab.startSession('ELIXIR');
        manager.onEndRequested();
        const log = JSON.parse(stored.get('serenity.sukhaSessions'));
        expect(log).toMatchObject({ count: 0, seconds: 420, last: { id: 'ELIXIR' } });
        expect(log.entries).toHaveLength(1);
        expect(log.entries[0]).toMatchObject({ completed: false, breaths: 70 });
        manager.snapshot = vi.fn(() => ({
            sessionId: 'ELIXIR', totalDuration: 20, rounds: 0, breaths: 5, holds: [], intention: null,
        }));
        tab.startSession('ELIXIR');
        manager.onEndRequested();
        expect(JSON.parse(stored.get('serenity.sukhaSessions')).entries).toHaveLength(1);
    });

    it('names the stillness of each session in its result', () => {
        tab.startSession('FLOW');
        manager.startSession.mock.calls[0][2]({
            sessionName: 'Sukha Mandala', totalDuration: 1460, rounds: 3, breaths: 45, holds: [],
        });
        expect(flow('.sukha-flow__stats').innerHTML).toContain('<dt>On your own</dt><dd>1:48</dd>');
        clickFlow({ '.sukha-flow__finish': true });
        tab.startSession('REST');
        manager.startSession.mock.calls[1][2]({
            sessionName: 'Sukha Nightfall',
            totalDuration: 1100,
            rounds: 3,
            breaths: 37,
            holds: [],
        });
        // Rest drifts between its rounds: no pause to chart, the time on your own instead.
        expect(flow('.sukha-flow__stats').innerHTML).toContain('<dt>On your own</dt><dd>1:08</dd>');
    });
});

describe('Sukha sessions you have not found yet', () => {
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
        expect(html).toContain('<article class="sukha-card" data-session="FIRST">');
        expect(html).toContain('Begin Sukha First Breath');
        expect(html).toContain('<article class="sukha-card is-locked" data-session="TIDE">');
        expect(html).toContain('Opens when you reach the Deep Ocean, or after 15 more minutes of breathing');
        expect(html).toContain('Opens when you complete the Odyssey, or after 120 more minutes of breathing');
        expect(html).not.toContain('Begin Sukha Phoenix');
        tab.showPrepScreen('TIDE');
        expect(tab.pendingSessionId).toBeNull();
        tab.startSession('TIDE');
        expect(manager.startSession).not.toHaveBeenCalled();
        tab.startSession('FIRST');
        expect(manager.startSession).toHaveBeenCalledOnce();
    });

    it('marks a session that has just opened as new until you open its preparation', () => {
        const collection = withCollection(new BreathCollectionService({ readOdysseyProgress: () => chapterOne }));
        expect(container.innerHTML).toContain('<article class="sukha-card is-new" data-session="TIDE">');
        expect(container.innerHTML).toContain('<span class="sukha-card__new">New</span>');
        tab.showPrepScreen('TIDE');
        expect(tab.pendingSessionId).toBe('TIDE');
        expect(collection.status('sessions', 'TIDE').isNew).toBe(false);
    });

    it('says on the result what the practice opened, and opens it in the catalogue', () => {
        let seconds = 0;
        withCollection(new BreathCollectionService({ readPracticeSeconds: () => seconds }));
        tab.startSession('FIRST');
        seconds = 15 * 60;
        manager.startSession.mock.calls[0][2]({ sessionName: 'Sukha First Breath', totalDuration: 226, rounds: 3 });
        const line = flow('.sukha-flow__opened');
        expect(line.hidden).toBe(false);
        expect(line.innerHTML).toBe('<span class="sukha-flow__opened-label">New</span> Ocean Tide and Sukha Tide are yours now, opened by your practice.');
        expect(container.innerHTML).toContain('<article class="sukha-card is-new" data-session="TIDE">');
        expect(container.innerHTML).toContain('Begin Sukha Tide');
        tab.startSession('FIRST');
        manager.startSession.mock.calls[1][2]({ sessionName: 'Sukha First Breath', totalDuration: 226, rounds: 3 });
        expect(line.hidden).toBe(true);
    });
});
