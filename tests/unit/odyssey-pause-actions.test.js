/* eslint-disable import/first */
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';

// BoardJuice's renderer alias is outside the Vitest resolver; this path never constructs it.
vi.mock('../../src/rendering/phaser/board-juice.js', () => ({ BoardJuice: class BoardJuice {} }));
import { applySettingsContext } from '../../src/ui/settings.js';
import { handleOdysseyPauseAction } from '../../src/ui/odyssey/odyssey-pause-actions.js';
import { EVENTS } from '../../src/events/event-bus.js';
import { OdysseyMode } from '../../src/core/game-modes/OdysseyMode.js';

function createSheet() {
    const node = (text = '') => ({ textContent: text, hidden: false });
    const buttons = [
        { hidden: true, dataset: { odysseyAction: 'retry' } },
        { hidden: true, dataset: { odysseyAction: 'map' } },
        { hidden: true, dataset: { odysseyAction: 'chapters' } },
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

function stubApp(mode, { onMainMenu = false } = {}) {
    const contains = (name) => onMainMenu && name === 'start-modal-open';
    vi.stubGlobal('document', { body: { classList: { contains } } });
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
            isActive: true,
            getModeId: () => 'odyssey',
            isInBoardView: false,
            currentLevelConfig: { id: 7, name: 'Mossy Hollow' },
        });
        expect(applySettingsContext(sheet)).toBe('pause');
        expect(sheet.setAttribute).toHaveBeenCalledWith('data-context', 'pause');
        expect(buttons.map((button) => button.hidden)).toEqual([false, false, true]);
        expect(byId['.settings-pause__title'].textContent).toBe('Paused');
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
            expect(buttons.map((button) => button.hidden)).toEqual([true, true, true]);
            expect(byId['#settings-pause-note'].textContent).toMatch(/waits where you left it\.$/);
            expect(byId['#settings-pause-note'].textContent).not.toMatch(/^Orb /);
        }
    });

    it('keeps Main menu and the Hub on Odyssey\'s map, with Chapters, though no orb runs', () => {
        const { sheet, buttons, byId } = createSheet();
        stubApp({
            isRunning: false,
            isActive: true,
            getModeId: () => 'odyssey',
            isOnOdysseyMap: () => true,
        });
        expect(applySettingsContext(sheet)).toBe('journey');
        expect(sheet.setAttribute).toHaveBeenCalledWith('data-context', 'journey');
        expect(buttons.map((button) => button.hidden)).toEqual([true, true, false]);
        expect(byId['.settings-pause__title'].textContent).toBe('Odyssey');
        expect(byId['#settings-pause-note'].textContent)
            .toBe('Your journey is saved. The map waits where you left it.');
        expect(byId['#settings-resume-btn > span'].textContent).toBe('Back to the map');
    });

    it('keeps the journey strip over an arrival or results, without Chapters', () => {
        const { sheet, buttons, byId } = createSheet();
        stubApp({
            isRunning: false,
            isActive: true,
            getModeId: () => 'odyssey',
            isOnOdysseyMap: () => false,
        });
        expect(applySettingsContext(sheet)).toBe('journey');
        expect(buttons.map((button) => button.hidden)).toEqual([true, true, true]);
        expect(byId['#settings-pause-note'].textContent).toBe('Your journey is saved.');
        expect(byId['#settings-resume-btn > span'].textContent).toBe('Back to Odyssey');
    });

    it('stays plain Settings on the main menu and in other modes between games', () => {
        for (const [mode, options] of [
            [{
                isRunning: false, isActive: true, getModeId: () => 'odyssey', isOnOdysseyMap: () => true,
            }, { onMainMenu: true }],
            [{ isRunning: false, isActive: true, getModeId: () => 'single' }, {}],
            [{ isRunning: false, isActive: false, getModeId: () => 'odyssey' }, {}],
            [null, {}],
        ]) {
            const { sheet, buttons } = createSheet();
            stubApp(mode, options);
            expect(applySettingsContext(sheet)).toBe('menu');
            expect(sheet.setAttribute).toHaveBeenCalledWith('data-context', 'menu');
            expect(buttons.every((button) => button.hidden)).toBe(true);
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
            // A return already under way (audit 2026-10-23: a second Back to map restarted it).
            { _boardReturnOperation: {} },
        ]) {
            result = handle(overrides, { action: 'map' });
            expect(result.taken, JSON.stringify(overrides)).toBe(false);
            expect(result.mode.returnToBoard).not.toHaveBeenCalled();
        }
        expect(handle({}, { action: 'dance' }).taken).toBe(false);
        expect(handle({}, undefined).taken).toBe(false);
        expect(EVENTS.ODYSSEY_PAUSE_ACTION).toBe('odysseyPauseAction');
    });

    it('opens the chapter list for Chapters only on the settled map', () => {
        const handle = (overrides) => {
            const mode = {
                isActive: true,
                isOnOdysseyMap: () => true,
                openOdysseyNavigator: vi.fn(),
                ...overrides,
            };
            return { mode, taken: handleOdysseyPauseAction(mode, { action: 'chapters' }) };
        };
        let result = handle({});
        expect(result.taken).toBe(true);
        expect(result.mode.openOdysseyNavigator).toHaveBeenCalledOnce();

        for (const overrides of [{ isOnOdysseyMap: () => false }, { isActive: false }]) {
            result = handle(overrides);
            expect(result.taken, JSON.stringify(Object.keys(overrides))).toBe(false);
            expect(result.mode.openOdysseyNavigator).not.toHaveBeenCalled();
        }
    });
});

describe('OdysseyMode.isOnOdysseyMap', () => {
    const onMap = (overrides) => {
        const mode = Object.create(OdysseyMode.prototype);
        Object.assign(mode, {
            isActive: true,
            isInBoardView: true,
            isEnteringLevel: false,
            _chapterFlowActive: false,
            _journeyFlowOperation: null,
            _scenicJourneyOperation: null,
            ...overrides,
        });
        return mode.isOnOdysseyMap();
    };

    it('is the settled map: active, in the board view, nothing launching or over it', () => {
        expect(onMap({})).toBe(true);
        expect(onMap({ isActive: false })).toBe(false);
        expect(onMap({ isInBoardView: false })).toBe(false);
        expect(onMap({ isEnteringLevel: true })).toBe(false);
        // A chapter's arrival (the first one included) sits over the map.
        expect(onMap({ _chapterFlowActive: true })).toBe(false);
        const scenic = { cancelled: false, mapRequested: false };
        expect(onMap({ _journeyFlowOperation: scenic, _scenicJourneyOperation: scenic })).toBe(false);
    });
});
