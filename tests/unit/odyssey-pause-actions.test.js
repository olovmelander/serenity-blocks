import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import { applySettingsContext } from '../../src/ui/settings.js';
import { handleOdysseyPauseAction } from '../../src/ui/odyssey/odyssey-pause-actions.js';
import { EVENTS } from '../../src/events/event-bus.js';

function createSheet() {
    const node = (text = '') => ({ textContent: text, hidden: false });
    const buttons = [
        { hidden: true, dataset: { odysseyAction: 'retry' } },
        { hidden: true, dataset: { odysseyAction: 'map' } },
    ];
    const byId = {
        '.settings-pause__title': node(),
        '#settings-pause-note': node(),
        '#settings-resume-btn > span': node(),
    };
    return {
        buttons,
        byId,
        sheet: {
            setAttribute: vi.fn(),
            querySelector: (selector) => byId[selector] || null,
            querySelectorAll: (selector) => (selector === '.settings-pause__odyssey' ? buttons : []),
        },
    };
}

function stubApp(mode) {
    vi.stubGlobal('document', { body: { classList: { contains: () => false } } });
    vi.stubGlobal('window', { serenityBlocks: { gameModeManager: { getCurrentMode: () => mode } } });
}

describe('Odyssey pause sheet actions', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('offers Retry orb and Back to map only while an Odyssey orb is in progress, and names the orb', () => {
        const { sheet, buttons, byId } = createSheet();
        stubApp({
            isRunning: true,
            getModeId: () => 'odyssey',
            isInBoardView: false,
            currentLevelConfig: { id: 7, name: 'Mossy Hollow' },
        });
        expect(applySettingsContext(sheet)).toBe('pause');
        expect(sheet.setAttribute).toHaveBeenCalledWith('data-context', 'pause');
        expect(buttons.map((button) => button.hidden)).toEqual([false, false]);
        expect(byId['#settings-pause-note'].textContent).toBe('Orb 7 · Mossy Hollow waits where you left it.');
        expect(byId['#settings-resume-btn > span'].textContent).toBe('Resume');
    });

    it('hides them in other modes and when Odyssey is on its map', () => {
        for (const mode of [
            { isRunning: true, getModeId: () => 'infinity' },
            {
                isRunning: true,
                getModeId: () => 'odyssey',
                isInBoardView: true,
                currentLevelConfig: { id: 7, name: 'X' },
            },
        ]) {
            const { sheet, buttons, byId } = createSheet();
            stubApp(mode);
            expect(applySettingsContext(sheet)).toBe('pause');
            expect(buttons.map((button) => button.hidden)).toEqual([true, true]);
            expect(byId['#settings-pause-note'].textContent).toMatch(/waits where you left it\.$/);
            expect(byId['#settings-pause-note'].textContent).not.toMatch(/^Orb /);
        }
    });

    it('routes Retry orb to the in-place restart and Back to map to the world return, only mid-orb', () => {
        const handle = (overrides, payload) => {
            const mode = {
                isActive: true,
                isInBoardView: false,
                isEnteringLevel: false,
                levelCompleting: false,
                currentLevelConfig: { id: 7 },
                _activeLevelSession: {},
                _restartLevelInPlace: vi.fn().mockResolvedValue(undefined),
                returnToBoard: vi.fn().mockResolvedValue(true),
                ...overrides,
            };
            const taken = handleOdysseyPauseAction(mode, payload);
            return { mode, taken };
        };
        let result = handle({}, { action: 'retry' });
        expect(result.taken).toBe(true);
        expect(result.mode._restartLevelInPlace).toHaveBeenCalledOnce();
        expect(result.mode.returnToBoard).not.toHaveBeenCalled();

        result = handle({}, { action: 'map' });
        expect(result.taken).toBe(true);
        expect(result.mode.returnToBoard).toHaveBeenCalledOnce();
        expect(result.mode._restartLevelInPlace).not.toHaveBeenCalled();

        for (const overrides of [
            { isInBoardView: true }, { isEnteringLevel: true }, { levelCompleting: true },
            { currentLevelConfig: null }, { _activeLevelSession: null }, { isActive: false },
        ]) {
            result = handle(overrides, { action: 'map' });
            expect(result.taken, JSON.stringify(overrides)).toBe(false);
            expect(result.mode.returnToBoard).not.toHaveBeenCalled();
        }
        expect(handle({}, { action: 'dance' }).taken).toBe(false);
        expect(handle({}, undefined).taken).toBe(false);
        expect(EVENTS.ODYSSEY_PAUSE_ACTION).toBe('odysseyPauseAction');
    });
});
