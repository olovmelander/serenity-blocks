import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';

vi.mock('../../src/themes/base-theme.js', () => ({ setGlobalRenderScale: vi.fn() }));
vi.mock('../../src/ui/serenity-hub/SerenityHub.js', () => ({ SerenityHub: class {} }));

import { SerenityMode } from '../../src/core/game-modes/SerenityMode.js';
import { SessionsTab } from '../../src/ui/serenity-hub/SessionsTab.js';
import { looseNode } from './helpers/loose-dom.js';

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
    const manager = { startSession: vi.fn(), stopSession: vi.fn() };
    const flow = looseNode();
    flow.hidden = true;
    const tab = Object.assign(Object.create(SessionsTab.prototype), {
        hub: mode.serenityHub,
        sessionManager: manager,
        container: looseNode(),
        flow,
        active: false,
        destroyed: false,
        voiceGuidance: true,
        pendingTimers: new Map(),
        countdownGeneration: 0,
        sessionGeneration: 0,
        pendingSessionId: 'BASE',
    });
    mode.serenityHub.hide = vi.fn();
    mode.serenityHub.sessionsTab = tab;
    mode.serenityHub.sessionManager = manager;
    return { tab, manager, flow };
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
        const { tab, manager, flow } = attachSessionsTab();
        const countdown = tab.startCountdown();
        await vi.advanceTimersByTimeAsync(10);
        expect(flow.hidden).toBe(false);
        expect(flow.dataset.step).toBe('countdown');
        await mode.onStop();
        await countdown;
        await vi.advanceTimersByTimeAsync(5000);
        expect(manager.startSession).not.toHaveBeenCalled();
        expect(tab.pendingSessionId).toBeNull();
        expect(flow.hidden).toBe(true);
        expect(mode.serenityHub.show).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('begins breathing with the mode only when the player asked for that', async () => {
        indicator.isExternallyControlled = false;
        indicator.isActive = false;
        mode.isActive = true;
        mode._ensureMusicPlaying = vi.fn();
        mode._setupKeyboardControls = vi.fn();
        mode._setupCursorAutoHide = vi.fn();
        mode._setupInteractiveEffects = vi.fn();
        mode.serenityHub.setMode = vi.fn();
        window.serenityBlocks = { serenityHub: mode.serenityHub };
        await mode.onStart();
        expect(indicator.start).not.toHaveBeenCalled();
        settingsManager.get.mockReturnValue({ breathingTechnique: 'coherence', breathingText: false, breathingGuideAutoStart: true });
        await mode.onStart();
        expect(indicator.setTechnique).toHaveBeenLastCalledWith('coherence');
        expect(indicator.setShowText).toHaveBeenLastCalledWith(false);
        expect(indicator.start).toHaveBeenCalledOnce();
        expect(mode.breathingIndicatorActive).toBe(true);
    });

    it('keeps its flag and the saved preference in step when the guide ends itself', () => {
        mode.breathingIndicatorActive = true;
        mode.onBreathingGuideChange(false);
        expect(mode.breathingIndicatorActive).toBe(false);
        expect(settingsManager.update).toHaveBeenLastCalledWith({ breathingGuideEnabled: false });
        settingsManager.update.mockClear();
        mode.onBreathingGuideChange(false);
        expect(settingsManager.update).not.toHaveBeenCalled();
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
