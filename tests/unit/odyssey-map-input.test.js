import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import {
    canNavigateOdysseyMap, createOdysseyMapPadControls, installOdysseyMapInput, moveOdysseyMapSelection,
    playOdysseyMapSelection, stepOdysseyMapSelection,
} from '../../src/ui/odyssey/odyssey-map-input.js';

const CHAPTER_STARTS = [1, 6, 11, 19, 27, 35, 49, 57];
const journey = (selectedLevelId, currentLevel = 4) => ({
    selectedLevelId, currentLevel, totalLevels: 60, chapterStarts: CHAPTER_STARTS,
});

function createMode(overrides = {}) {
    return {
        isActive: true,
        isInBoardView: true,
        isEnteringLevel: false,
        levelCompleting: false,
        selectedLevelId: null,
        odysseyState: { currentLevel: 4, isLevelUnlocked: (id) => id <= 4 },
        levelRegistry: {
            getTotalLevels: () => 60,
            getAllChapters: () => CHAPTER_STARTS.map((start) => ({ levelRange: [start, start] })),
        },
        boardController: { selectLevel: vi.fn() },
        launchOdysseyLevel: vi.fn().mockResolvedValue(true),
        _isOdysseyNavigatorOpen: () => false,
        deps: {},
        ...overrides,
    };
}

describe('Odyssey map travel by keys and pad', () => {
    beforeEach(() => {
        vi.stubGlobal('document', {
            hidden: false,
            hasFocus: () => true,
            getElementById: () => null,
            querySelector: () => null,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        });
    });
    afterEach(() => vi.unstubAllGlobals());

    it('steps orb by orb and chapter by chapter from the selection, or from the orb that waits', () => {
        expect(stepOdysseyMapSelection(journey(null), 'next')).toBe(5);
        expect(stepOdysseyMapSelection(journey(7), 'previous')).toBe(6);
        expect(stepOdysseyMapSelection(journey(1), 'previous')).toBe(1);
        expect(stepOdysseyMapSelection(journey(60), 'next')).toBe(60);
        expect(stepOdysseyMapSelection(journey(7), 'next-chapter')).toBe(11);
        expect(stepOdysseyMapSelection(journey(58), 'next-chapter')).toBe(60);
        expect(stepOdysseyMapSelection(journey(7), 'previous-chapter')).toBe(6);
        expect(stepOdysseyMapSelection(journey(6), 'previous-chapter')).toBe(1);
        expect(stepOdysseyMapSelection(journey(40), 'first')).toBe(1);
        expect(stepOdysseyMapSelection(journey(40), 'current')).toBe(4);
        expect(stepOdysseyMapSelection(journey(9), 'sideways')).toBe(9);
    });

    it('answers only while the map itself is on screen', () => {
        expect(canNavigateOdysseyMap(createMode())).toBe(true);
        expect(canNavigateOdysseyMap(createMode({ isInBoardView: false }))).toBe(false);
        expect(canNavigateOdysseyMap(createMode({ isEnteringLevel: true }))).toBe(false);
        expect(canNavigateOdysseyMap(createMode({ _chapterFlowActive: true, _journeyFlowOperation: {} }))).toBe(false);
        expect(canNavigateOdysseyMap(createMode({ _isOdysseyNavigatorOpen: () => true }))).toBe(false);
        expect(canNavigateOdysseyMap(createMode({ _firstArrival: {} }))).toBe(false);
        expect(canNavigateOdysseyMap(createMode(), {
            getElementById: (id) => (id === 'odyssey-flow-overlay' ? {} : null),
        })).toBe(false);
        expect(canNavigateOdysseyMap(null)).toBe(false);
    });

    it('travels the board to the stepped orb and plays only an open selection', () => {
        const mode = createMode();
        expect(moveOdysseyMapSelection(mode, 'next')).toBe(5);
        expect(mode.boardController.selectLevel).toHaveBeenCalledWith(5);
        mode.selectedLevelId = 5;
        expect(playOdysseyMapSelection(mode)).toBe(false);
        expect(mode.launchOdysseyLevel).not.toHaveBeenCalled();
        mode.selectedLevelId = 3;
        expect(playOdysseyMapSelection(mode)).toBe(true);
        expect(mode.launchOdysseyLevel).toHaveBeenCalledWith(3, { source: 'map-input' });
        mode.isEnteringLevel = true;
        expect(moveOdysseyMapSelection(mode, 'next')).toBeNull();
    });

    it('steps on from the orb the map is headed to, before its focus has settled', () => {
        // Audit 2026-10-18: the mode hears of a selection only when its ~0.8 s focus ends, so
        // held or quick keys stepped again from the same orb and moved one orb in all.
        const board = { selectedLevelId: null };
        board.selectLevel = vi.fn((id) => { board.selectedLevelId = id; });
        const mode = createMode({ selectedLevelId: 2, boardController: board });
        expect(moveOdysseyMapSelection(mode, 'next')).toBe(3);
        expect(moveOdysseyMapSelection(mode, 'next')).toBe(4);
        expect(moveOdysseyMapSelection(mode, 'previous')).toBe(3);
        expect(mode.selectedLevelId).toBe(2); // the focus has not landed yet
        expect(playOdysseyMapSelection(mode)).toBe(true);
        expect(mode.launchOdysseyLevel).toHaveBeenCalledWith(3, { source: 'map-input' });
    });

    it('owns arrows, Home, End and Enter on the document while leaving focused controls theirs', () => {
        const mode = createMode({ selectedLevelId: 2 });
        const dispose = installOdysseyMapInput(mode);
        const onKeyDown = document.addEventListener.mock.calls[0][1];
        const press = (key, init = {}) => {
            const event = { key, preventDefault: vi.fn(), ...init };
            onKeyDown(event);
            return event;
        };
        expect(press('ArrowRight').preventDefault).toHaveBeenCalled();
        expect(mode.boardController.selectLevel).toHaveBeenLastCalledWith(3);
        expect(press('ArrowUp').preventDefault).toHaveBeenCalled();
        expect(mode.boardController.selectLevel).toHaveBeenLastCalledWith(6);
        expect(press('End').preventDefault).toHaveBeenCalled();
        expect(mode.boardController.selectLevel).toHaveBeenLastCalledWith(4);
        expect(press('Enter').preventDefault).toHaveBeenCalled();
        expect(mode.launchOdysseyLevel).toHaveBeenCalledWith(2, { source: 'map-input' });
        const onButton = press('Enter', { target: { closest: (selector) => (selector.includes('button') ? {} : null) } });
        expect(onButton.preventDefault).not.toHaveBeenCalled();
        expect(press('ArrowLeft', { target: { closest: (selector) => (selector.includes('input') ? {} : null) } })
            .preventDefault).not.toHaveBeenCalled();
        expect(press('x').preventDefault).not.toHaveBeenCalled();
        dispose();
        expect(document.removeEventListener).toHaveBeenCalledWith('keydown', onKeyDown, true);
    });

    it('steps on a fresh D-pad press, repeats while held, and plays on a fresh A', () => {
        let time = 0;
        const controller = {
            isAxisNegative: (gamepad, axis) => gamepad.axes[axis] < -0.25,
            isAxisPositive: (gamepad, axis) => gamepad.axes[axis] > 0.25,
        };
        const onMove = vi.fn();
        const onPlay = vi.fn();
        const controls = createOdysseyMapPadControls(controller, {
            isActive: () => true, onMove, onPlay, now: () => time,
        });
        const pad = (pressed = [], axes = [0, 0]) => ({
            buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i) })), axes,
        });
        controls.process(pad([15]), 0);
        expect(onMove).toHaveBeenCalledExactlyOnceWith('next');
        time = 300;
        controls.process(pad([15]), 0);
        expect(onMove).toHaveBeenCalledOnce();
        time = 430;
        controls.process(pad([15]), 0);
        expect(onMove).toHaveBeenCalledTimes(2);
        time = 500;
        controls.process(pad([15]), 0);
        expect(onMove).toHaveBeenCalledTimes(2);
        time = 620;
        controls.process(pad([15]), 0);
        expect(onMove).toHaveBeenCalledTimes(3);
        controls.process(pad([], [0, 0.9]), 0);
        expect(onMove).toHaveBeenLastCalledWith('previous-chapter');
        controls.process(pad([]), 0);
        controls.process(pad([0]), 0);
        expect(onPlay).toHaveBeenCalledOnce();
        controls.process(pad([0]), 0);
        expect(onPlay).toHaveBeenCalledOnce();
        expect(controls.process(pad([0]), 1)).toBe(false);
    });

    it('opens the charm guide on a fresh Y, never on one held from before', () => {
        const controller = { isAxisNegative: () => false, isAxisPositive: () => false };
        const onCharms = vi.fn();
        const controls = createOdysseyMapPadControls(controller, {
            isActive: () => true, onMove: vi.fn(), onPlay: vi.fn(), onCharms, now: () => 0,
        });
        const pad = (pressed = []) => ({
            buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i) })), axes: [0, 0],
        });
        controls.process(pad([3]), 0);
        expect(onCharms).not.toHaveBeenCalled();
        controls.process(pad([]), 0);
        controls.process(pad([3]), 0);
        controls.process(pad([3]), 0);
        expect(onCharms).toHaveBeenCalledOnce();
        controls.process(pad([]), 0);
        controls.process(pad([3]), 0);
        expect(onCharms).toHaveBeenCalledTimes(2);
    });

    it('opens the charm guide from the header chip, and closes it with the map input', () => {
        const charmGuide = { open: vi.fn(() => true), close: vi.fn(() => true) };
        let padCallbacks = null;
        const gamepadController = {
            setOdysseyMapControls: (callbacks) => {
                padCallbacks = callbacks;
                return { dispose: vi.fn() };
            },
        };
        const dispose = installOdysseyMapInput(createMode({ deps: { gamepadController } }), { charmGuide });
        const onClick = document.addEventListener.mock.calls.find(([type]) => type === 'click')[1];
        const click = (onChip) => {
            const event = {
                preventDefault: vi.fn(),
                target: { closest: (selector) => (onChip && selector.includes('header-charms') ? {} : null) },
            };
            onClick(event);
            return event;
        };
        expect(click(false).preventDefault).not.toHaveBeenCalled();
        expect(charmGuide.open).not.toHaveBeenCalled();
        expect(click(true).preventDefault).toHaveBeenCalled();
        expect(charmGuide.open).toHaveBeenCalledOnce();
        padCallbacks.onCharms();
        expect(charmGuide.open).toHaveBeenCalledTimes(2);
        dispose();
        expect(charmGuide.close).toHaveBeenCalledOnce();
        expect(document.removeEventListener).toHaveBeenCalledWith('click', onClick);
        click(true);
        expect(charmGuide.open).toHaveBeenCalledTimes(2);
    });
});
