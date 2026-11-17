import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { readFileSync } from 'node:fs';
import {
    JOURNEY_ENDING_UI, presentOdysseyJourneyEnding, readOdysseyJourneyEndingSeconds,
} from '../../src/ui/odyssey/odyssey-journey-ending.js';
import { JOURNEY_ENDING } from '../../src/rendering/odyssey/chapter-environments/shared/odyssey-journey-ending.js';
import {
    canNavigateOdysseyMap, createOdysseyMapPadControls, moveOdysseyMapSelection, playOdysseyMapSelection,
} from '../../src/ui/odyssey/odyssey-map-input.js';

function eventTarget(properties = {}) {
    const listeners = new Map();
    return {
        ...properties,
        addEventListener(type, listener) {
            if (!listeners.has(type)) listeners.set(type, new Set());
            listeners.get(type).add(listener);
        },
        removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
        dispatch(type, detail = {}) {
            const event = {
                type, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn(), ...detail,
            };
            [...(listeners.get(type) || [])].forEach((listener) => listener(event));
            return event;
        },
        count() { return [...listeners.values()].reduce((sum, set) => sum + set.size, 0); },
    };
}

function createMode(world = { ending: { seconds: 7 }, endingNow: { seconds: 0 } }) {
    return {
        isActive: true,
        isInBoardView: true,
        isEnteringLevel: false,
        _boardPresentationGeneration: 3,
        _setBoardOverlaySuppressed: vi.fn(),
        _updateLevelPreview: vi.fn(),
        boardController: {
            environmentManager: { environments: new Map([[8, { group: { userData: world } }]]) },
        },
    };
}

describe("the journey's ending on the map", () => {
    let overlay;
    beforeEach(() => {
        vi.useFakeTimers();
        overlay = { style: {} };
        vi.stubGlobal('window', eventTarget());
        vi.stubGlobal('document', { getElementById: (id) => (id === 'odyssey-board-overlay' ? overlay : null) });
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it("keeps the map's UI out of the way and starts the world's clock at the open gate", () => {
        const world = { ending: { seconds: 7 }, endingNow: { seconds: 0 } };
        const mode = createMode(world);
        presentOdysseyJourneyEnding(mode, 60);
        expect(mode._setBoardOverlaySuppressed).toHaveBeenLastCalledWith(true);
        // The clock had run under the shut gate: it begins again in front of the player.
        expect(world.ending.seconds).toBe(0);
        expect(mode._updateLevelPreview).not.toHaveBeenCalled();
        expect(window.count()).toBe(4);
    });

    it('brings the UI back when the ending rests, eased in, on the last orb', () => {
        const world = { ending: { seconds: 0 }, endingNow: { seconds: 0 } };
        const mode = createMode(world);
        presentOdysseyJourneyEnding(mode, 60);
        world.endingNow.seconds = JOURNEY_ENDING_UI.returnAt - 1;
        vi.advanceTimersByTime(JOURNEY_ENDING_UI.pollMs * 3);
        expect(mode._setBoardOverlaySuppressed).toHaveBeenCalledTimes(1);
        world.endingNow.seconds = JOURNEY_ENDING_UI.returnAt;
        vi.advanceTimersByTime(JOURNEY_ENDING_UI.pollMs);
        expect(mode._setBoardOverlaySuppressed).toHaveBeenLastCalledWith(false);
        expect(mode._updateLevelPreview).toHaveBeenCalledWith(60);
        expect(overlay.style.transition).toContain('opacity');
        vi.advanceTimersByTime(JOURNEY_ENDING_UI.fadeMs + 200);
        expect(overlay.style.transition).toBe('');
        expect(window.count()).toBe(0);
        expect(mode._journeyEnding).toBeNull();
        // The UI returns before the world's clock holds, so it is never waited on for ever.
        expect(JOURNEY_ENDING_UI.returnAt).toBeLessThan(JOURNEY_ENDING.rest);
    });

    it.each(['pointerdown', 'keydown', 'wheel', 'touchstart'])('gives the map back at once on %s', (type) => {
        const mode = createMode();
        presentOdysseyJourneyEnding(mode, 60);
        window.dispatch(type);
        expect(mode._setBoardOverlaySuppressed).toHaveBeenLastCalledWith(false);
        expect(mode._updateLevelPreview).toHaveBeenCalledTimes(1);
        // Once: a second press, or the timer, does nothing more.
        window.dispatch(type);
        vi.advanceTimersByTime(JOURNEY_ENDING_UI.giveUpMs);
        expect(mode._updateLevelPreview).toHaveBeenCalledTimes(1);
    });

    it('takes the press that wakes the UI when it would have launched the unseen orb', () => {
        const mode = createMode();
        presentOdysseyJourneyEnding(mode, 60);
        const enter = window.dispatch('keydown', { key: 'Enter' });
        expect(enter.preventDefault).toHaveBeenCalled();
        expect(enter.stopImmediatePropagation).toHaveBeenCalled();
        expect(mode._setBoardOverlaySuppressed).toHaveBeenLastCalledWith(false);
        // Any other key ends it and is left to the map (an arrow still travels).
        const other = createMode();
        presentOdysseyJourneyEnding(other, 60);
        const arrow = window.dispatch('keydown', { key: 'ArrowLeft' });
        expect(arrow.preventDefault).not.toHaveBeenCalled();
        expect(other._setBoardOverlaySuppressed).toHaveBeenLastCalledWith(false);
    });

    it("wakes the UI on the pad's A press too, instead of launching the unseen orb", () => {
        const mode = createMode();
        Object.assign(mode, {
            selectedLevelId: 60,
            odysseyState: { isLevelUnlocked: () => true, currentLevel: 60 },
            levelRegistry: { getTotalLevels: () => 60, getAllChapters: () => [] },
            launchOdysseyLevel: vi.fn().mockResolvedValue(),
        });
        mode.boardController.selectLevel = vi.fn();
        presentOdysseyJourneyEnding(mode, 60);
        // The map's own pad controls, as OdysseyMode installs them (odyssey-map-input.js).
        const controller = { isAxisNegative: () => false, isAxisPositive: () => false };
        const pad = createOdysseyMapPadControls(controller, {
            isActive: () => canNavigateOdysseyMap(mode, null),
            onMove: (move) => moveOdysseyMapSelection(mode, move),
            onPlay: () => playOdysseyMapSelection(mode),
        });
        const press = (buttons) => pad.process({ buttons: Array.from({ length: 16 }, (_, i) => ({ pressed: buttons.includes(i) })) }, 0);
        // A still held from the finale sheet's choice is not a press of the map's.
        press([0]);
        expect(mode._setBoardOverlaySuppressed).toHaveBeenLastCalledWith(true);
        // A fresh press wakes the card and plays nothing.
        press([]);
        press([0]);
        expect(mode._setBoardOverlaySuppressed).toHaveBeenLastCalledWith(false);
        expect(mode._updateLevelPreview).toHaveBeenCalledWith(60);
        expect(mode.launchOdysseyLevel).not.toHaveBeenCalled();
        expect(mode._journeyEnding).toBeNull();
        // With the card shown, the next press plays, as on the map.
        press([]);
        press([0]);
        expect(mode.launchOdysseyLevel).toHaveBeenCalledExactlyOnceWith(60, { source: 'map-input' });

        // A step on the D-pad during the ending brings the UI back and travels.
        const other = createMode();
        Object.assign(other, {
            selectedLevelId: 60,
            odysseyState: { isLevelUnlocked: () => true, currentLevel: 60 },
            levelRegistry: { getTotalLevels: () => 60, getAllChapters: () => [] },
        });
        other.boardController.selectLevel = vi.fn();
        presentOdysseyJourneyEnding(other, 60);
        expect(moveOdysseyMapSelection(other, 'previous')).toBe(59);
        expect(other._setBoardOverlaySuppressed).toHaveBeenLastCalledWith(false);
        expect(other.boardController.selectLevel).toHaveBeenCalledWith(59);
    });

    it('brings the UI back once the eye has left the end of the rail', () => {
        const world = { ending: { seconds: 0 }, endingNow: { seconds: 0 }, journeyEnd: 1 };
        const mode = createMode(world);
        presentOdysseyJourneyEnding(mode, 60);
        vi.advanceTimersByTime(JOURNEY_ENDING_UI.pollMs * 2);
        expect(mode._setBoardOverlaySuppressed).toHaveBeenCalledTimes(1);
        world.journeyEnd = 0.2;
        vi.advanceTimersByTime(JOURNEY_ENDING_UI.pollMs);
        expect(mode._setBoardOverlaySuppressed).toHaveBeenLastCalledWith(false);
    });

    it('never touches a map that has moved on (an orb launched, the mode left)', () => {
        const mode = createMode();
        presentOdysseyJourneyEnding(mode, 60);
        mode.isEnteringLevel = true;
        vi.advanceTimersByTime(JOURNEY_ENDING_UI.pollMs);
        expect(mode._setBoardOverlaySuppressed).toHaveBeenCalledTimes(1);
        expect(mode._updateLevelPreview).not.toHaveBeenCalled();
        expect(window.count()).toBe(0);

        const other = createMode();
        presentOdysseyJourneyEnding(other, 60);
        other._boardPresentationGeneration = 4;
        window.dispatch('keydown');
        expect(other._updateLevelPreview).not.toHaveBeenCalled();
    });

    it('gives up by itself, and a second ending ends the first', () => {
        const mode = createMode();
        const first = presentOdysseyJourneyEnding(mode, 60);
        presentOdysseyJourneyEnding(mode, 60);
        expect(window.count()).toBe(4);
        vi.advanceTimersByTime(JOURNEY_ENDING_UI.giveUpMs + 10);
        expect(mode._setBoardOverlaySuppressed).toHaveBeenLastCalledWith(false);
        first();
        expect(window.count()).toBe(0);
    });

    it("reads the world's clock, or 0 where the city is not built", () => {
        expect(readOdysseyJourneyEndingSeconds(createMode({ endingNow: { seconds: 12.5 } }))).toBe(12.5);
        expect(readOdysseyJourneyEndingSeconds({})).toBe(0);
        expect(readOdysseyJourneyEndingSeconds(null)).toBe(0);
    });

    it('is reached from the finished campaign through the map return, on the end of the rail', () => {
        const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
        const completion = read('src/core/game-modes/odyssey-completion.js');
        expect(completion).toContain("const journeyEnding = finalResults.campaignCompleted === true && choice === 'map';");
        expect(completion).toContain('...(journeyEnding ? { journeyEnding: true } : {}),');
        const worldReturn = read('src/ui/odyssey/odyssey-world-return.js');
        expect(worldReturn).toContain('returnOptions.journeyEnding ? { ...returnOptions, settlePath: true } : returnOptions');
        expect(worldReturn).toContain('presentOdysseyJourneyEnding(mode, completedLevelId)');
    });
});
