import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionsTab } from '../../src/ui/serenity-hub/SessionsTab.js';

function node(children = {}) {
    const attributes = new Map();
    return {
        style: {}, dataset: {}, textContent: '', innerHTML: '', className: '',
        classList: { add: vi.fn(), remove: vi.fn(), toggle: vi.fn(), contains: () => false },
        querySelector: (selector) => children[selector] || null,
        querySelectorAll: () => [],
        setAttribute: (key, value) => attributes.set(key, value),
        getAttribute: (key) => attributes.get(key),
        removeAttribute: (key) => attributes.delete(key),
        addEventListener: vi.fn(), focus: vi.fn(), contains: vi.fn(() => true),
    };
}

const instances = [];
afterEach(() => {
    instances.splice(0).forEach((tab) => tab.destroy());
    vi.restoreAllMocks();
    vi.useRealTimers();
});

function harness() {
    const labels = ['session-name', 'session-round', 'phase-timer', 'phase-label',
        'progress-fill', 'breath-counter', 'breath-current', 'breath-total',
        'phase-fill', 'guidance-main', 'guidance-sub', 'session-percent', 'phase-progress-bar'];
    const hudNodes = Object.fromEntries(labels.map((label) => [`.${label}`, node()]));
    const hud = node(hudNodes);
    const overlay = node({ '.session-hud': hud });
    const completionNodes = Object.fromEntries(['completion-art', 'completion-session-name',
        'completion-duration', 'completion-rounds', 'completion-intention', 'completion-close-btn']
        .map((label) => [`.${label}`, node()]));
    const completion = node(completionNodes);
    const startButton = node();
    startButton.dataset.session = 'BASE';
    const container = node({
        '.active-session-overlay': overlay,
        '.session-completion-overlay': completion,
        '.completion-close-btn': completionNodes['.completion-close-btn'],
    });
    container.querySelectorAll = (selector) => (selector === '.start-session-btn' ? [startButton] : []);
    const hubScroll = node();
    const hub = {
        panel: { querySelector: (selector) => (selector === '.hub-tab-content' ? hubScroll : container) },
        hide: vi.fn(), show: vi.fn(), switchTab: vi.fn(),
    };
    const manager = {
        startSession: vi.fn(), stopSession: vi.fn(),
        SESSIONS: { BASE: { totalRounds: 3, phases: [
            { type: 'grounding', duration: 180 },
            { type: 'active', pattern: [4, 0, 4, 0], breaths: 30 },
            { type: 'retention', duration: 120 },
            { type: 'recovery', duration: 15 },
            { type: 'integration', duration: 300 },
        ] } },
    };
    const tab = new SessionsTab(hub, manager);
    instances.push(tab);
    return { tab, hub, hubScroll, manager, container, hudNodes, completion, completionNodes, startButton };
}

describe('guided breathwork presentation contracts', () => {
    it('shows duration and pause length from the practice the manager actually runs', () => {
        const { tab, container } = harness();
        // 180 + (8 × 30) + 120 + 15 + 300 = 855 seconds, rounded up for the catalogue.
        expect(tab.getSessionDetails('BASE')).toMatchObject({ duration: '15 min', rounds: 3, maxHold: '2 min' });
        expect(container.innerHTML).toContain('15 min');
        expect(tab.getSessionDetails('UNKNOWN')).toBeNull();
    });

    it('clearly names all four start actions and keeps intentions optional', () => {
        const { container } = harness();
        ['Hale Base', 'Hale Elixir', 'Hale Rest', 'Hale Flow'].forEach((name) => {
            expect(container.innerHTML).toContain(`Start ${name}`);
        });
        expect(container.innerHTML).toContain('Intentions are optional');
        expect(container.innerHTML).toContain('class="prep-begin-btn"');
        expect(container.innerHTML).not.toContain('class="prep-begin-btn" disabled');
        expect(container.innerHTML).not.toContain('prep-skip-btn');
        // Starting is available before optional choices, including the stacked phone layout.
        expect(container.innerHTML.indexOf('class="prep-begin-btn"'))
            .toBeLessThan(container.innerHTML.indexOf('class="prep-choices"'));
    });

    it('starts the prepared Hale journey without requiring an intention first', async () => {
        vi.useFakeTimers();
        const { tab, container, manager } = harness();
        const countdown = node();
        const number = node();
        const query = container.querySelector;
        container.querySelector = (selector) => ({
            '.session-countdown-overlay': countdown,
            '.countdown-number': number,
        }[selector] || query(selector));
        tab.pendingSessionId = 'BASE';
        tab.selectedIntention = null;
        const sequence = tab.startCountdown();
        expect(tab.selectedIntention).toMatchObject({ id: 'none' });
        await vi.advanceTimersByTimeAsync(5000);
        await sequence;
        expect(manager.startSession).toHaveBeenCalledWith('BASE', expect.any(Function), expect.any(Function));
        expect(countdown.style.display).toBe('none');
    });

    it('acquires the guided session before hiding the Hub to retain gameplay pause', () => {
        const { tab, hub, manager } = harness();
        manager.startSession.mockImplementation(() => { manager.activeSession = { name: 'Hale Base' }; });
        hub.hide.mockImplementation(() => { expect(manager.activeSession).toBeTruthy(); });
        tab.startSession('BASE');
        expect(manager.startSession.mock.invocationCallOrder[0]).toBeLessThan(hub.hide.mock.invocationCallOrder[0]);
    });

    it('opens the selected practice when the click originates on a nested arrow', () => {
        const { tab, startButton } = harness();
        const handler = startButton.addEventListener.mock.calls.find(([name]) => name === 'click')[1];
        const open = vi.spyOn(tab, 'showPrepScreen').mockImplementation(() => {});
        handler({ currentTarget: startButton, target: { dataset: {} } });
        expect(open).toHaveBeenCalledWith('BASE');
    });

    it('separates phase time from overall journey progress', () => {
        const { tab, hudNodes } = harness();
        tab.setActive(true);
        tab.updateHUD({
            sessionId: 'BASE', phase: 'retention', phaseLabel: 'Hold',
            phaseIndex: 3, totalPhases: 5, round: 1, totalRounds: 3,
            phaseProgress: 0.75, sessionProgress: 0.4, remainingTime: 30,
            prompt: 'Find stillness', subPrompt: '',
        });
        expect(hudNodes['.progress-fill'].style.strokeDashoffset).toBe(String(283 * 0.25));
        expect(hudNodes['.phase-fill'].style.transform).toBe('scaleX(0.4)');
        expect(hudNodes['.session-percent'].textContent).toBe('40%');
        expect(hudNodes['.phase-progress-bar'].getAttribute('aria-valuenow')).toBe('40');
        expect(hudNodes['.phase-timer'].textContent).toBe('0:30');
    });

    it('returns to a visible completion result after a natural finish', () => {
        const { tab, hub, hubScroll, manager, completion, completionNodes } = harness();
        hubScroll.scrollTop = 306;
        completion.scrollTop = 73;
        tab.selectedIntention = { id: 'calm', label: 'Find Calm' };
        tab.startSession('BASE');
        const complete = manager.startSession.mock.calls[0][2];
        complete({ sessionName: 'Hale Base', totalDuration: 855, rounds: 3, completed: true });
        expect(completion.style.display).toBe('flex');
        expect(completionNodes['.completion-duration'].textContent).toBe('14:15');
        expect(completionNodes['.completion-intention'].textContent).toBe('You arrived with: Find Calm');
        expect(hub.switchTab).toHaveBeenCalledWith('sessions');
        expect(hub.show).toHaveBeenCalledOnce();
        expect(completionNodes['.completion-close-btn'].focus).toHaveBeenCalledWith({ preventScroll: true });
        expect(hubScroll.scrollTop).toBe(0);
        expect(completion.scrollTop).toBe(0);
    });

    it.each(['.prep-close-btn', '.countdown-cancel-btn'])(
        'keeps %s focus from moving the dialog outside the Hub viewport',
        (selector) => {
            const { tab, hubScroll } = harness();
            const control = node();
            const overlay = node({ [selector]: control });
            hubScroll.scrollTop = 306;
            overlay.scrollTop = 92;
            tab.focusDialog(overlay, selector);
            expect(hubScroll.scrollTop).toBe(0);
            expect(overlay.scrollTop).toBe(0);
            expect(control.focus).toHaveBeenCalledWith({ preventScroll: true });
        },
    );

    it('does not show a result for manual cancellation or a callback after destruction', () => {
        const { tab, hub, manager, completion } = harness();
        tab.startSession('BASE');
        const complete = manager.startSession.mock.calls[0][2];
        tab.stopSession();
        complete({ sessionName: 'Hale Base', totalDuration: 855, rounds: 3, completed: true });
        expect(hub.show).not.toHaveBeenCalled();
        expect(completion.style.display).not.toBe('flex');
        tab.destroy();
        complete({ sessionName: 'Hale Base', totalDuration: 855, rounds: 3, completed: true });
        expect(hub.show).not.toHaveBeenCalled();
    });

    it('clears active and pending session surfaces without late results or focus after a mode change', async () => {
        vi.useFakeTimers();
        const { tab, hub, container, manager, completion, completionNodes } = harness();
        const prep = node();
        const countdown = node();
        const query = container.querySelector;
        container.querySelector = (selector) => ({
            '.session-prep-overlay': prep,
            '.session-countdown-overlay': countdown,
        }[selector] || query(selector));
        tab.startSession('BASE');
        const complete = manager.startSession.mock.calls[0][2];
        const returnFocus = node();
        tab.pendingSessionId = 'BASE';
        tab.selectedIntention = { id: 'calm', label: 'Find Calm' };
        tab.completedSession = { sessionId: 'BASE' };
        tab.focusReturn = returnFocus;
        [prep, countdown, completion].forEach((overlay) => { overlay.style.display = 'flex'; });
        const delayedFocus = vi.fn();
        tab.scheduleUI(delayedFocus, 10);
        const pendingWait = tab.waitForCountdown(1000);

        tab.cancelForModeChange();

        await expect(pendingWait).resolves.toBe(false);
        await vi.runAllTimersAsync();
        complete({ sessionName: 'Hale Base', totalDuration: 855, rounds: 3, completed: true });
        ['.session-prep-overlay', '.session-countdown-overlay', '.active-session-overlay',
            '.session-completion-overlay'].forEach((selector) => {
            expect(container.querySelector(selector).style.display).toBe('none');
        });
        expect(manager.stopSession).toHaveBeenCalledOnce();
        expect(tab.pendingTimers.size).toBe(0);
        expect(tab.pendingSessionId).toBeNull();
        expect(tab.selectedIntention).toBeNull();
        expect(tab.completedSession).toBeNull();
        expect(tab.focusReturn).toBeNull();
        expect(delayedFocus).not.toHaveBeenCalled();
        expect(returnFocus.focus).not.toHaveBeenCalled();
        expect(completionNodes['.completion-close-btn'].focus).not.toHaveBeenCalled();
        expect(hub.show).not.toHaveBeenCalled();
    });

    it('settles an in-flight countdown during a mode change without starting the previous practice', async () => {
        vi.useFakeTimers();
        const { tab, container, manager } = harness();
        const countdown = node();
        const number = node();
        const query = container.querySelector;
        container.querySelector = (selector) => ({
            '.session-countdown-overlay': countdown,
            '.countdown-number': number,
        }[selector] || query(selector));
        tab.pendingSessionId = 'BASE';
        const sequence = tab.startCountdown();
        tab.cancelForModeChange();
        await sequence;
        await vi.runAllTimersAsync();
        expect(manager.startSession).not.toHaveBeenCalled();
        expect(manager.stopSession).toHaveBeenCalledOnce();
        expect(countdown.style.display).toBe('none');
        expect(tab.pendingTimers.size).toBe(0);
    });

    it.each([' ', 'Enter'])('keeps native %j activation from also reaching the global guide shortcut', (key) => {
        const { container } = harness();
        const handler = container.addEventListener.mock.calls.find(([type]) => type === 'keydown')[1];
        const control = node();
        const event = {
            key, target: { closest: vi.fn(() => control) },
            stopPropagation: vi.fn(), preventDefault: vi.fn(),
        };
        handler(event);
        expect(event.target.closest).toHaveBeenCalledWith('button, input');
        expect(container.contains).toHaveBeenCalledWith(control);
        expect(event.stopPropagation).toHaveBeenCalledOnce();
        // Space/Enter still click the focused session/intention/begin control natively.
        expect(event.preventDefault).not.toHaveBeenCalled();
    });

    it('leaves unrelated shortcuts and controls outside the Sessions surface untouched', () => {
        const { tab, container } = harness();
        const stop = vi.fn();
        container.contains.mockReturnValue(false);
        tab.handleOverlayKey({ key: ' ', target: { closest: () => node() }, stopPropagation: stop });
        tab.handleOverlayKey({ key: 'Enter', target: { closest: () => null }, stopPropagation: stop });
        tab.handleOverlayKey({ key: 't', target: { closest: () => node() }, stopPropagation: stop });
        expect(stop).not.toHaveBeenCalled();
    });

    it('owns Escape during the countdown and returns to preparation', () => {
        const { tab, container, manager } = harness();
        const countdown = node();
        countdown.style.display = 'flex';
        countdown.classList.contains = (name) => name === 'session-countdown-overlay';
        const query = container.querySelector;
        container.querySelector = (selector) => (selector === '.session-countdown-overlay' ? countdown : query(selector));
        tab.pendingSessionId = 'BASE';
        const prepare = vi.spyOn(tab, 'showPrepScreen').mockImplementation(() => {});
        const event = { key: 'Escape', preventDefault: vi.fn(), stopPropagation: vi.fn() };
        tab.handleOverlayKey(event);
        expect(prepare).toHaveBeenCalledWith('BASE');
        expect(event.preventDefault).toHaveBeenCalledOnce();
        expect(event.stopPropagation).toHaveBeenCalledOnce();
        expect(manager.startSession).not.toHaveBeenCalled();
    });

    it('handles missing and invalid timing without displaying NaN', () => {
        const { tab } = harness();
        expect(tab.formatTime(undefined)).toBe('0:00');
        expect(tab.formatTime(-5)).toBe('0:00');
        expect(tab.formatTime(65)).toBe('1:05');
    });
});
