/* eslint-disable import/first */
// What an orb entry or return paints for the first time is painted while the portal gate still
// covers it (the gate draws in a worker and keeps moving), not on the frames the gate opens on:
// the return re-showed a rebuilt map overlay and the resumed map's first frames on the reveal's
// first frame, and the entry painted the well, queue and stats for the first time as they faded
// up (they waited the whole hold at visibility:hidden).

import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';

vi.mock('../../src/rendering/phaser/board-juice.js', () => ({ BoardJuice: class BoardJuice {} }));
import { OdysseyMode } from '../../src/core/game-modes/OdysseyMode.js';
import { showKeptBoardInfoOverlay } from '../../src/ui/odyssey/BoardInfoOverlay.js';
import {
    COVER_PAINT_OPACITY,
    paintGameplaySurfacesUnderCover,
    releaseGameplaySurfacesFromCover,
    waitForAnimationFrames,
} from '../../src/ui/odyssey/odyssey-cover-paint.js';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const read = (file) => readFileSync(path.resolve(here, '../../src', file), 'utf8');

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

function element(id, { className = '' } = {}) {
    const props = new Map();
    const style = {
        setProperty: vi.fn((name, value) => { props.set(name, value); }),
        getPropertyValue: (name) => props.get(name) ?? '',
    };
    return {
        id,
        style,
        classList: { contains: (name) => className.split(' ').includes(name) },
    };
}

function gameplayDocument() {
    const game = element('single-player-container');
    const phaser = element('phaser-game-container');
    const stats = element('stats', { className: 'single-player-stats-bar' });
    const byId = { 'single-player-container': game, 'phaser-game-container': phaser };
    return {
        game,
        phaser,
        stats,
        doc: {
            getElementById: (id) => byId[id] || null,
            querySelector: (selector) => (selector === '.single-player-stats-bar' ? stats : null),
        },
    };
}

describe('waitForAnimationFrames', () => {
    it('resolves after the asked number of frames', async () => {
        const queue = [];
        const win = {
            requestAnimationFrame: (fn) => { queue.push(fn); return queue.length; },
            setTimeout: () => 1,
            clearTimeout: vi.fn(),
        };
        let resolved = false;
        const done = waitForAnimationFrames(2, { win }).then(() => { resolved = true; });
        queue.shift()();
        await Promise.resolve();
        expect(resolved).toBe(false);
        queue.shift()();
        await done;
        expect(resolved).toBe(true);
        expect(win.clearTimeout).toHaveBeenCalled();
    });

    it('never waits longer than its bound (an unseen window runs no frames)', async () => {
        vi.useFakeTimers();
        const win = {
            requestAnimationFrame: () => 1, // frames never come
            setTimeout: (fn, ms) => setTimeout(fn, ms),
            clearTimeout: (t) => clearTimeout(t),
        };
        let resolved = false;
        waitForAnimationFrames(2, { win, timeoutMs: 120 }).then(() => { resolved = true; });
        await vi.advanceTimersByTimeAsync(119);
        expect(resolved).toBe(false);
        await vi.advanceTimersByTimeAsync(2);
        expect(resolved).toBe(true);
    });

    it('resolves at once with no frame clock', async () => {
        await expect(waitForAnimationFrames(2, { win: {} })).resolves.toBeUndefined();
    });
});

describe('painting the gameplay surfaces under the entry cover', () => {
    it('lays them out and paints them at an opacity that reads as nothing, on their own layers', () => {
        const { doc, game, phaser, stats } = gameplayDocument();
        game.style.transform = 'scale(1.02)'; // set by _prepareGameplayReveal for the hold
        const painted = paintGameplaySurfacesUnderCover(doc);

        expect(painted).toEqual([game, phaser, stats]);
        for (const el of painted) {
            expect(el.style.visibility).toBe('visible');
            expect(el.style.opacity).toBe(String(COVER_PAINT_OPACITY));
        }
        expect(COVER_PAINT_OPACITY).toBeGreaterThan(0);
        expect(COVER_PAINT_OPACITY).toBeLessThan(0.005);
        expect(game.style.willChange).toBe('opacity, transform');
        expect(game.style.transform).toBe('scale(1.02)');
        expect(phaser.style.willChange).toBe('opacity');
        expect(stats.style.setProperty).toHaveBeenCalledWith('display', 'flex', 'important');

        releaseGameplaySurfacesFromCover(doc);
        for (const el of painted) expect(el.style.willChange).toBe('');
    });

    it('tolerates a page without the surfaces', () => {
        expect(paintGameplaySurfacesUnderCover({ getElementById: () => null, querySelector: () => null })).toEqual([]);
        expect(() => releaseGameplaySurfacesFromCover(undefined)).not.toThrow();
    });

    it('starts the reveal from the painted opacity, and drops the layer hints after it', async () => {
        vi.useFakeTimers();
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const { doc, game, phaser, stats } = gameplayDocument();
        vi.stubGlobal('document', doc);
        const mode = {
            deps: { settingsManager: { get: () => ({ reducedMotion: false }) } },
            closeOdysseyNavigator: vi.fn(),
            setOdysseyNavigatorButtonVisible: vi.fn(),
            _showGameplayPlayableReveal: OdysseyMode.prototype._showGameplayPlayableReveal,
            _finishGameplayUiReveal: OdysseyMode.prototype._finishGameplayUiReveal,
        };
        paintGameplaySurfacesUnderCover(doc);
        const revealState = OdysseyMode.prototype._beginGameplayReveal.call(mode, { fastReveal: true });

        expect(game.style.opacity).toBe(String(COVER_PAINT_OPACITY));
        expect(phaser.style.opacity).toBe(String(COVER_PAINT_OPACITY));
        expect(stats.style.opacity).toBe(String(COVER_PAINT_OPACITY));

        await vi.advanceTimersByTimeAsync(5000);
        await expect(revealState.playablePromise).resolves.toBe(true);
        await expect(revealState.uiPromise).resolves.toBe(true);
        expect(game.style.opacity).toBe('1');
        expect(game.style.willChange).toBe('');
        expect(phaser.style.willChange).toBe('');
        expect(stats.style.willChange).toBe('');
    });
});

describe('the map overlay is kept while an orb plays', () => {
    function overlayDocument() {
        const autoContinue = { checked: true };
        const overlay = {
            id: 'odyssey-board-overlay',
            style: { display: '' },
            remove: vi.fn(),
            querySelector: (selector) => (selector === '#odyssey-auto-continue' ? autoContinue : null),
        };
        return {
            overlay,
            autoContinue,
            doc: { getElementById: (id) => (id === 'odyssey-board-overlay' ? overlay : null) },
        };
    }

    it('parks it out of layout instead of removing it', () => {
        const { doc, overlay } = overlayDocument();
        vi.stubGlobal('document', doc);
        const mode = { chapterArrivalCueTimer: setTimeout(() => {}, 10_000) };
        OdysseyMode.prototype._parkInfoOverlay.call(mode);
        expect(overlay.style.display).toBe('none');
        expect(overlay.remove).not.toHaveBeenCalled();
        expect(mode.chapterArrivalCueTimer).toBeNull();
    });

    it('shows it again with today\'s figures and flow preference', () => {
        const { doc, overlay, autoContinue } = overlayDocument();
        vi.stubGlobal('document', doc);
        overlay.style.display = 'none';
        const mode = {
            deps: { settingsManager: { get: () => ({ odysseyAutoContinue: false }) } },
            _updateHeaderProgress: vi.fn(),
        };
        expect(OdysseyMode.prototype._unparkInfoOverlay.call(mode)).toBe(true);
        expect(overlay.style.display).toBe('');
        expect(autoContinue.checked).toBe(false);
        expect(mode._updateHeaderProgress).toHaveBeenCalledTimes(1);

        // Not parked (a quick return before the park): left alone.
        expect(OdysseyMode.prototype._unparkInfoOverlay.call(mode)).toBe(false);
        expect(mode._updateHeaderProgress).toHaveBeenCalledTimes(1);
    });

    it('comes back as a new overlay would, whatever the launch left on it', () => {
        // The launch faded the overlay and its panel, locked the overlay and pressed Play; a
        // scenic journey's return never runs the reset the plain return does.
        const panelClasses = new Set(['odyssey-level-panel']);
        const panel = {
            style: { transition: 'opacity 120ms ease-out', opacity: '0', transform: 'translateY(16px) scale(0.98)' },
            classList: { add: (name) => panelClasses.add(name) },
        };
        const playClasses = new Set(['level-play-btn', 'clicked']);
        const play = { classList: { remove: (name) => playClasses.delete(name) } };
        const overlay = {
            style: {
                display: 'none', transition: 'opacity 140ms ease-out', opacity: '0', visibility: 'hidden', pointerEvents: 'none',
            },
            querySelector: (selector) => ({ '#odyssey-level-panel': panel, '#level-panel-play-btn': play }[selector] ?? null),
        };
        showKeptBoardInfoOverlay(overlay);
        expect(overlay.style).toEqual({
            display: '', transition: '', opacity: '', visibility: '', pointerEvents: '',
        });
        expect(panel.style).toEqual({ transition: '', opacity: '', transform: '' });
        // Hidden like a new panel, until the next preview renders and shows it.
        expect([...panelClasses]).toEqual(['odyssey-level-panel', 'hidden']);
        expect([...playClasses]).toEqual(['level-play-btn']);
    });

    it('the park keeps the overlay; only leaving Odyssey disposes it', () => {
        vi.stubGlobal('document', { getElementById: () => null });
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const mode = {
            boardController: { pauseRendering: vi.fn() },
            _parkInfoOverlay: vi.fn(),
            _disposeInfoOverlay: vi.fn(),
            _logBoardMemory: vi.fn(),
        };
        OdysseyMode.prototype._parkOdysseyBoard.call(mode);
        expect(mode._parkInfoOverlay).toHaveBeenCalledTimes(1);
        expect(mode._disposeInfoOverlay).not.toHaveBeenCalled();
        expect(mode._boardParked).toBe(true);
    });
});

describe('the paint happens under the cover, before it opens', () => {
    it('entry: after readiness, inside the hold, and only while the entry is current', () => {
        const src = read('core/game-modes/OdysseyMode.js');
        const ready = src.indexOf('const ready = await this._waitForEntryRevealReadiness(');
        const paint = src.indexOf('paintGameplaySurfacesUnderCover();', ready);
        const frames = src.indexOf('await waitForAnimationFrames(2);', paint);
        const reveal = src.indexOf('onRevealStart: async () => {', ready);
        expect(ready).toBeGreaterThan(-1);
        expect(paint).toBeGreaterThan(ready);
        expect(frames).toBeGreaterThan(paint);
        expect(reveal).toBeGreaterThan(frames);
        expect(src.slice(ready, paint)).toMatch(/ready === true && isCurrentEntry\(\)/);
    });

    it('return: once the map is shown and ready, before the blackout callback resolves', () => {
        const src = read('ui/odyssey/odyssey-world-return.js');
        const shown = src.indexOf('const shown = await mode._showBoardView(');
        const worldReady = src.indexOf('options.onWorldReady?.()', shown);
        const frames = src.indexOf('await waitForAnimationFrames(2);', worldReady);
        const resolved = src.indexOf('arrivalAnchor: mode._resolveJourneyReturnArrivalAnchor', frames);
        expect(shown).toBeGreaterThan(-1);
        expect(worldReady).toBeGreaterThan(shown);
        expect(frames).toBeGreaterThan(worldReady);
        expect(resolved).toBeGreaterThan(frames);
    });
});
