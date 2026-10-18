import {
    describe, expect, it, vi,
} from 'vitest';
import { startOdysseyNewJourney, wireOdysseyNewJourney } from '../../src/ui/odyssey/odyssey-new-journey.js';

function createControls() {
    const button = () => {
        const listeners = {};
        return {
            hidden: false,
            disabled: false,
            attributes: {},
            listeners,
            focus: vi.fn(),
            setAttribute(name, value) { this.attributes[name] = value; },
            addEventListener(type, listener) { listeners[type] = listener; },
            click() { listeners.click?.(); },
        };
    };
    const nodes = {
        '#odyssey-new-journey-btn': button(),
        '#odyssey-new-journey-confirm': { hidden: true },
        '#odyssey-new-journey-confirm-btn': button(),
        '#odyssey-new-journey-cancel-btn': button(),
    };
    return { nodes, root: { querySelector: (selector) => nodes[selector] || null } };
}

describe('Odyssey new journey', () => {
    it('opens the consequence on the first press and erases only on the second', async () => {
        const { nodes, root } = createControls();
        let release;
        const onConfirm = vi.fn(() => new Promise((resolve) => { release = resolve; }));
        const controls = wireOdysseyNewJourney(root, onConfirm);
        expect(controls).not.toBeNull();
        const open = nodes['#odyssey-new-journey-btn'];
        const panel = nodes['#odyssey-new-journey-confirm'];
        const confirm = nodes['#odyssey-new-journey-confirm-btn'];
        const cancel = nodes['#odyssey-new-journey-cancel-btn'];

        open.click();
        expect(panel.hidden).toBe(false);
        expect(open.hidden).toBe(true);
        expect(open.attributes['aria-expanded']).toBe('true');
        expect(cancel.focus).toHaveBeenCalledOnce();
        expect(onConfirm).not.toHaveBeenCalled();

        cancel.click();
        expect(panel.hidden).toBe(true);
        expect(open.hidden).toBe(false);
        expect(open.focus).toHaveBeenCalledOnce();

        open.click();
        confirm.click();
        confirm.click();
        expect(onConfirm).toHaveBeenCalledOnce();
        expect(confirm.disabled).toBe(true);
        release(true);
        await new Promise((resolve) => { setTimeout(resolve, 0); });
        expect(confirm.disabled).toBe(false);
        expect(panel.hidden).toBe(true);
        expect(open.hidden).toBe(false);
    });

    it('returns null without the markup and never throws', () => {
        expect(wireOdysseyNewJourney({ querySelector: () => null }, vi.fn())).toBeNull();
        expect(wireOdysseyNewJourney(null, vi.fn())).toBeNull();
    });

    it('resets the save, refreshes the map and header, and welcomes the journey again', async () => {
        const mode = {
            isInBoardView: true,
            isEnteringLevel: false,
            selectedLevelId: 41,
            odysseyState: { reset: vi.fn(), save: vi.fn() },
            boardController: { updateProgress: vi.fn() },
            _buildOdysseyProgressData: vi.fn(() => ({ furthestLevel: 1, levelProgress: {} })),
            _updateHeaderProgress: vi.fn(),
            _updateLevelSelectUI: vi.fn(),
            closeOdysseyNavigator: vi.fn(),
            _focusBoardLevelForLaunch: vi.fn().mockResolvedValue(true),
            _offerFirstArrival: vi.fn(),
        };
        expect(await startOdysseyNewJourney(mode)).toBe(true);
        expect(mode.odysseyState.reset).toHaveBeenCalledOnce();
        expect(mode.odysseyState.save).toHaveBeenCalledOnce();
        expect(mode.boardController.updateProgress).toHaveBeenCalledWith({ furthestLevel: 1, levelProgress: {} });
        expect(mode._updateHeaderProgress).toHaveBeenCalledOnce();
        expect(mode._updateLevelSelectUI).toHaveBeenCalledWith(1);
        expect(mode.closeOdysseyNavigator).toHaveBeenCalledWith({ restoreBoardPreview: false });
        expect(mode._focusBoardLevelForLaunch).toHaveBeenCalledWith(1, { updatePreview: true, settle: true });
        expect(mode.selectedLevelId).toBe(1);
        expect(mode._offerFirstArrival).toHaveBeenCalledOnce();

        const busy = { ...mode, isEnteringLevel: true, odysseyState: { reset: vi.fn(), save: vi.fn() } };
        expect(await startOdysseyNewJourney(busy)).toBe(false);
        expect(busy.odysseyState.reset).not.toHaveBeenCalled();
    });
});
