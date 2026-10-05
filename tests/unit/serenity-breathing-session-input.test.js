import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';

vi.mock('../../src/themes/base-theme.js', () => ({ setGlobalRenderScale: vi.fn() }));
vi.mock('../../src/ui/serenity-hub/SerenityHub.js', () => ({ SerenityHub: class {} }));

import { SerenityMode } from '../../src/core/game-modes/SerenityMode.js';
import { SessionsTab } from '../../src/ui/serenity-hub/SessionsTab.js';

let mode;
let indicator;
let settingsManager;

beforeEach(() => {
    vi.useFakeTimers();
    indicator = {
        isActive: true,
        isExternallyControlled: true,
        currentTechnique: 'energizing',
        techniques: { energizing: {}, coherence: {} },
        setTechnique: vi.fn(),
        setShowText: vi.fn(),
        start: vi.fn(() => { indicator.isActive = true; }),
        stop: vi.fn(() => { indicator.isActive = false; }),
    };
    settingsManager = {
        get: vi.fn(() => ({ breathingTechnique: 'coherence', breathingText: true })),
        update: vi.fn(),
    };
    vi.stubGlobal('window', { breathingIndicator: indicator });
    vi.stubGlobal('document', {
        getElementById: vi.fn(() => null),
        body: { classList: { remove: vi.fn() } },
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    mode = new SerenityMode({ settingsManager });
    mode.isRunning = true;
    mode.serenityHub = { switchTab: vi.fn(), show: vi.fn(), updateIconState: vi.fn() };
    mode._showNotification = vi.fn();
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

function attachSessionsTab() {
    const element = () => ({
        style: {},
        dataset: {},
        classList: { add: vi.fn(), remove: vi.fn() },
        querySelector: vi.fn(() => null),
    });
    const overlay = element();
    const preparation = element();
    preparation.style.display = 'flex';
    const countdownOverlay = element();
    const countdownNumber = element();
    const nodes = {
        '.active-session-overlay': overlay,
        '.session-prep-overlay': preparation,
        '.session-countdown-overlay': countdownOverlay,
        '.countdown-number': countdownNumber,
    };
    const manager = { startSession: vi.fn(), stopSession: vi.fn() };
    mode.serenityHub.panel = element();
    const tab = Object.assign(Object.create(SessionsTab.prototype), {
        hub: mode.serenityHub,
        sessionManager: manager,
        container: { querySelector: (selector) => nodes[selector] || null },
        SESSION_INFO: { BASE: { name: 'Hale Base' } },
        active: false,
        destroyed: false,
        pendingTimers: new Map(),
        countdownGeneration: 0,
        sessionGeneration: 0,
        pendingSessionId: 'BASE',
    });
    mode.serenityHub.hide = vi.fn();
    mode.serenityHub.sessionsTab = tab;
    mode.serenityHub.sessionManager = manager;
    return { tab, manager, preparation, countdownOverlay };
}

function expectSessionUntouched() {
    expect(indicator.setTechnique).not.toHaveBeenCalled();
    expect(indicator.setShowText).not.toHaveBeenCalled();
    expect(indicator.start).not.toHaveBeenCalled();
    expect(indicator.stop).not.toHaveBeenCalled();
    expect(settingsManager.update).not.toHaveBeenCalled();
}

describe('Serenity controls during a guided breathing session', () => {
    it.each([false, true])('routes Space to session controls despite mode active flag %s', (activeFlag) => {
        mode.breathingIndicatorActive = activeFlag;
        const event = { key: ' ', preventDefault: vi.fn() };
        mode._onKeyPress(event);
        expect(mode.serenityHub.switchTab).toHaveBeenCalledWith('sessions');
        expect(mode.serenityHub.show).toHaveBeenCalledOnce();
        expect(event.preventDefault).toHaveBeenCalledOnce();
        expectSessionUntouched();
    });

    it('keeps the journey pattern when a technique shortcut or direct show runs', () => {
        mode.breathingIndicatorActive = true;
        mode._onKeyPress({ key: 't', preventDefault: vi.fn() });
        mode._showBreathingIndicator();
        expectSessionUntouched();
    });

    it.each([false, true])('ignores standalone settings changes with guide enabled %s', (enabled) => {
        mode.breathingIndicatorActive = !enabled;
        mode.onSettingsChange({ breathingGuideEnabled: enabled });
        expectSessionUntouched();
    });

    it('leaves a guided rhythm running across settings pause and resume', () => {
        // The mode flag remains true when a journey takes over an existing guide.
        mode.breathingIndicatorActive = true;
        mode.onPause();
        expect(mode.breathingIndicatorWasActive).toBe(false);
        mode.onResume();
        expectSessionUntouched();
        expect(indicator.isActive).toBe(true);
    });

    it('does not restart a journey that took control while settings were open', () => {
        mode.breathingIndicatorWasActive = true;
        mode.isPaused = true;
        mode.onResume();
        expectSessionUntouched();
    });

    it('still lets mode cleanup stop the session visual', () => {
        mode._hideBreathingIndicator();
        expect(indicator.stop).toHaveBeenCalledOnce();
        expect(mode.breathingIndicatorActive).toBe(false);
        expect(mode.serenityHub.updateIconState).toHaveBeenCalledWith({ breathingActive: false });
    });
});

describe('standalone breathing after guided sessions', () => {
    it('continues stopping and restarting a standalone guide for settings', () => {
        indicator.isExternallyControlled = false;
        mode.breathingIndicatorActive = true;
        mode.onPause();
        expect(mode.breathingIndicatorWasActive).toBe(true);
        expect(indicator.stop).toHaveBeenCalledOnce();
        expect(indicator.isActive).toBe(false);
        mode.onResume();
        expect(indicator.start).toHaveBeenCalledOnce();
        expect(indicator.isActive).toBe(true);
    });

    it('stops a visible guide when the mode flag is stale and false', () => {
        indicator.isExternallyControlled = false;
        mode.breathingIndicatorActive = false;
        mode._toggleBreathingIndicator();
        expect(indicator.stop).toHaveBeenCalledOnce();
        expect(indicator.start).not.toHaveBeenCalled();
        expect(settingsManager.update).toHaveBeenCalledWith({ breathingGuideEnabled: false });
    });

    it('starts a stopped guide when the mode flag is stale and true', () => {
        indicator.isExternallyControlled = false;
        indicator.isActive = false;
        mode.breathingIndicatorActive = true;
        mode._toggleBreathingIndicator();
        expect(indicator.start).toHaveBeenCalledOnce();
        expect(indicator.stop).not.toHaveBeenCalled();
        expect(indicator.setTechnique).toHaveBeenCalledWith('coherence');
        expect(mode.breathingIndicatorActive).toBe(true);
        expect(settingsManager.update).toHaveBeenCalledWith({ breathingGuideEnabled: true });
    });
});

describe('Serenity mode exit cancels guided journeys', () => {
    it('invalidates the completed callback when the global Hub survives mode exit', async () => {
        const { tab, manager } = attachSessionsTab();
        tab.startSession('BASE');
        const finish = manager.startSession.mock.calls[0][2];
        const completion = vi.spyOn(tab, 'showCompletionMessage');
        await mode.onStop();
        finish({ sessionName: 'Hale Base', totalDuration: 60, rounds: 3 });
        expect(manager.stopSession).toHaveBeenCalledOnce();
        expect(completion).not.toHaveBeenCalled();
        expect(mode.serenityHub.show).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(300);
    });

    it('settles pending countdown waits and prevents late session startup', async () => {
        const { tab, manager, preparation, countdownOverlay } = attachSessionsTab();
        const countdown = tab.startCountdown();
        await vi.advanceTimersByTimeAsync(10);
        expect(countdownOverlay.style.display).toBe('flex');
        await mode.onStop();
        await countdown;
        await vi.advanceTimersByTimeAsync(5000);
        expect(manager.startSession).not.toHaveBeenCalled();
        expect(tab.pendingSessionId).toBeNull();
        expect(preparation.style.display).toBe('none');
        expect(countdownOverlay.style.display).toBe('none');
        expect(vi.getTimerCount()).toBe(0);
    });

    it('stops a manager when the Sessions tab has not been created', async () => {
        mode.serenityHub.sessionManager = { stopSession: vi.fn() };
        await mode.onStop();
        expect(mode.serenityHub.sessionManager.stopSession).toHaveBeenCalledOnce();
    });

    it('does not tear down a journey for an ordinary mode pause', () => {
        const { tab, manager } = attachSessionsTab();
        const cancel = vi.spyOn(tab, 'cancelPendingUI');
        mode.onPause();
        expect(manager.stopSession).not.toHaveBeenCalled();
        expect(cancel).not.toHaveBeenCalled();
    });
});
