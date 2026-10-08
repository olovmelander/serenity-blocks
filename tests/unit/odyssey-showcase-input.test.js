import { afterEach, describe, expect, it, vi } from 'vitest';
import { installOdysseyShowcaseInput } from '../../src/ui/odyssey/odyssey-showcase-input.js';
import { createOdysseyFlowDom } from '../helpers/odyssey-flow-dom.js';

afterEach(() => vi.unstubAllGlobals());

function fixture() {
    const { document, window } = createOdysseyFlowDom();
    vi.stubGlobal('document', document);
    vi.stubGlobal('window', window);
    const session = { gameState: { victoryLapActive: true, isPaused: false } };
    const pad = { reset: vi.fn(), dispose: vi.fn() };
    const hint = {};
    const mode = {
        _activeLevelSession: session,
        _isLevelSessionActive: (candidate) => mode._activeLevelSession === candidate,
        _finishVictoryLap: vi.fn(),
        odysseyHUD: { setFinishGamepadHint: vi.fn() },
        _goalCompleteOverlay: { querySelector: () => hint },
        deps: { gamepadController: { setOdysseyShowcaseControls: vi.fn(() => pad) } },
    };
    const dispose = installOdysseyShowcaseInput(mode);
    const callbacks = mode.deps.gamepadController.setOdysseyShowcaseControls.mock.calls[0][0];
    const key = (key, properties = {}) => document.dispatch('keydown', {
        key, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...properties,
    });
    return { document, window, mode, session, pad, hint, dispose, callbacks, key };
}

describe('attempt-owned showcase shortcuts', () => {
    it('finishes on fresh Enter, ignores repeats, and leaves Escape available for Pause', () => {
        const { mode, key } = fixture();
        key('Enter', { repeat: true });
        const escape = key('Escape');
        expect(escape.preventDefault).not.toHaveBeenCalled();
        expect(mode._finishVictoryLap).not.toHaveBeenCalled();
        const enter = key('Enter');
        expect(enter.preventDefault).toHaveBeenCalledOnce();
        expect(enter.stopPropagation).toHaveBeenCalledOnce();
        expect(mode._finishVictoryLap).toHaveBeenCalledOnce();
    });

    it('captures Enter before a remapped gameplay handler can consume it', () => {
        const { mode, dispose } = fixture();
        dispose();
        const register = vi.spyOn(document, 'addEventListener');
        installOdysseyShowcaseInput(mode);
        expect(register).toHaveBeenCalledWith('keydown', expect.any(Function), true);
    });

    it('cannot finish a paused or replaced attempt through either keyboard or controller', () => {
        const { mode, session, callbacks, key } = fixture();
        session.gameState.isPaused = true;
        key('Enter');
        expect(callbacks.isActive()).toBe(false);
        session.gameState.isPaused = false;
        mode._activeLevelSession = { gameState: { victoryLapActive: true } };
        key('Enter');
        expect(callbacks.isActive()).toBe(false);
        expect(mode._finishVictoryLap).not.toHaveBeenCalled();
    });

    it('keeps both visible hints accurate after a remap and hides unavailable shortcuts', () => {
        const { mode, hint, callbacks } = fixture();
        callbacks.onHintChange('RB');
        expect(mode.odysseyHUD.setFinishGamepadHint).toHaveBeenLastCalledWith('RB');
        expect(hint).toEqual({ textContent: 'RB', hidden: false });
        callbacks.onHintChange(null);
        expect(hint).toEqual({ textContent: '', hidden: true });
    });

    it('requires release after blur and detaches both input owners once on disposal', () => {
        const { document, window, pad, mode, dispose, callbacks, key } = fixture();
        window.dispatch('blur');
        expect(pad.reset).toHaveBeenCalledOnce();
        dispose();
        dispose();
        window.dispatch('blur');
        key('Enter');
        expect(document.listenerCount()).toBe(0);
        expect(window.listenerCount()).toBe(0);
        expect(pad.dispose).toHaveBeenCalledOnce();
        expect(pad.reset).toHaveBeenCalledOnce();
        expect(callbacks.isActive()).toBe(false);
        expect(mode._finishVictoryLap).not.toHaveBeenCalled();
    });
});
