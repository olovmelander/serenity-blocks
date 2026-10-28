// The map stops drawing when nobody can see it (perf audit 2026-10-28). The navigator and the charm
// guide are opaque pages over the whole map ("No backdrop blur: the map renders on underneath"),
// yet the map drew full frames under them; and a hidden window's background behaviour ('pause',
// 'reduce', main.js handleVisibilityChange) never reached it, so a minimised desktop window kept
// drawing the map at the full rate. Under a sheet the map keeps updating and skips the draw; it
// draws the current frame again the moment the sheet goes.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { OdysseyBoardController } from '../../src/rendering/odyssey/OdysseyBoardController.js';
import { coverOdysseyMapWith, isSheetShown } from '../../src/ui/odyssey/odyssey-map-cover.js';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const read = (file) => readFileSync(path.resolve(here, '../../src', file), 'utf8');

const VSYNC_MS = 1000 / 60;
let now = 0;
let frames = [];

function runVsyncs(seconds) {
    const count = Math.round((seconds * 1000) / VSYNC_MS);
    for (let i = 0; i < count; i++) {
        now += VSYNC_MS;
        const due = frames;
        frames = [];
        for (const callback of due) callback(now);
    }
}

function stubWindow(extra = {}) {
    vi.stubGlobal('window', {
        settings: { targetFrameRate: 0 }, // uncapped: every refresh is a frame
        serenityBlocks: { settingsManager: { get: () => ({ targetFrameRate: 0 }) } },
        location: { search: '' },
        matchMedia: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
        innerWidth: 1600,
        innerHeight: 900,
        ...extra,
    });
}

/** A live board whose frames are counted (as menu-odyssey-frame-pacing.test.js builds one). */
function liveBoard() {
    const board = new OdysseyBoardController({});
    board.isActive = true;
    board.clock = {
        last: null,
        getDelta() {
            const d = this.last === null ? 0 : (now - this.last) / 1000;
            this.last = now;
            return d;
        },
    };
    board.renderFrame = vi.fn();
    board._drawPosedFrame = vi.fn();
    return board;
}

const drawn = (board) => board.renderFrame.mock.calls.filter((call) => call[2]?.draw !== false).length;
const undrawn = (board) => board.renderFrame.mock.calls.filter((call) => call[2]?.draw === false).length;

beforeEach(() => {
    now = 1000;
    frames = [];
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.stubGlobal('requestAnimationFrame', (callback) => frames.push(callback));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() });
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('a map covered by an opaque sheet', () => {
    it('goes on updating without drawing, and draws its current frame the moment the sheet goes', () => {
        stubWindow();
        const board = liveBoard();
        const sheet = { name: 'navigator' };
        board.animate();
        runVsyncs(0.5);
        expect(undrawn(board)).toBe(0);

        board.setCovered(sheet, true, () => true);
        const drawnBefore = drawn(board);
        runVsyncs(1);
        expect(drawn(board)).toBe(drawnBefore); // no draw under the sheet...
        expect(undrawn(board)).toBeGreaterThan(55); // ...but every frame still updated
        expect(board._drawPosedFrame).not.toHaveBeenCalled();

        board.setCovered(sheet, false);
        expect(board._drawPosedFrame).toHaveBeenCalledTimes(1); // before the next refresh
        runVsyncs(0.5);
        expect(drawn(board)).toBeGreaterThan(drawnBefore + 25);
    });

    it('a sheet taken away by another path lifts its own cover', () => {
        stubWindow();
        const board = liveBoard();
        let shown = true;
        const sheet = {};
        board.animate();
        board.setCovered(sheet, true, () => shown);
        runVsyncs(0.25);
        const drawnBefore = drawn(board);
        shown = false; // hidden without its uncover (an entry's transition hiding the navigator)
        runVsyncs(0.25);
        expect(drawn(board)).toBeGreaterThan(drawnBefore + 10);
    });

    it('draws again only when the last of two sheets goes', () => {
        stubWindow();
        const board = liveBoard();
        const navigator = {};
        const charms = {};
        board.setCovered(navigator, true);
        board.setCovered(charms, true);
        board.setCovered(navigator, false);
        expect(board._drawPosedFrame).not.toHaveBeenCalled();
        expect(board._isCovered()).toBe(true);
        board.setCovered(charms, false);
        expect(board._drawPosedFrame).toHaveBeenCalledTimes(1);
        expect(board._isCovered()).toBe(false);
        board.setCovered(charms, false); // twice: nothing more
        expect(board._drawPosedFrame).toHaveBeenCalledTimes(1);
    });

    it('a paused or parked board draws nothing when uncovered', () => {
        stubWindow();
        const board = liveBoard();
        const sheet = {};
        board.setCovered(sheet, true);
        board.isRenderingPaused = true;
        board.setCovered(sheet, false);
        expect(board._drawPosedFrame).not.toHaveBeenCalled();
    });

    it('renderFrame({ draw: false }) runs the frame\'s updates and leaves the GPU alone', () => {
        stubWindow();
        const board = new OdysseyBoardController({});
        board.scene = { fog: null };
        board.camera = {};
        board.renderer = { setClearColor: vi.fn(), render: vi.fn(), info: { memory: {}, render: {} } };
        board.postProcessingStack = { update: vi.fn(), render: vi.fn() };
        board.environmentManager = new Proxy({}, {
            get: (target, key) => {
                if (key === 'getBlendState') return () => null;
                if (typeof key === 'symbol') return undefined;
                target[key] ??= vi.fn();
                return target[key];
            },
        });
        board._tickAdaptiveQuality = vi.fn();
        board.renderFrame(1 / 60, 16, { draw: false });
        expect(board.postProcessingStack.update).toHaveBeenCalledTimes(1);
        expect(board.environmentManager.update).toHaveBeenCalledTimes(1);
        expect(board.postProcessingStack.render).not.toHaveBeenCalled();
        expect(board._tickAdaptiveQuality).not.toHaveBeenCalled(); // no draw to judge quality by
        board.renderFrame(1 / 60, 16);
        expect(board.postProcessingStack.render).toHaveBeenCalledTimes(1);
        expect(board._tickAdaptiveQuality).toHaveBeenCalledTimes(1);
    });

    it('a forced frame (the portal snapshot\'s renderOnce) still draws under a sheet', () => {
        stubWindow();
        const board = liveBoard();
        board.renderer = {};
        board.scene = {};
        board.camera = {};
        board.setCovered({}, true);
        board.renderOnce(0);
        expect(board.renderFrame).toHaveBeenCalledWith(0);
    });
});

describe('a hidden window, as the background behaviour asks', () => {
    it('\'pause\' stops the map, \'reduce\' draws it at ~10 fps, and shown again it draws every frame', () => {
        stubWindow();
        const board = liveBoard();
        window.isRenderingPaused = true;
        board.animate();
        runVsyncs(1);
        expect(board.renderFrame).not.toHaveBeenCalled();
        expect(frames).toHaveLength(1); // still ticking, to draw the moment it is shown

        window.isRenderingPaused = false;
        window.isRenderingReduced = true;
        window.reducedFrameInterval = 100;
        runVsyncs(2);
        const reduced = board.renderFrame.mock.calls.length;
        expect(reduced).toBeGreaterThanOrEqual(17);
        expect(reduced).toBeLessThanOrEqual(21);

        window.isRenderingReduced = false;
        runVsyncs(1);
        expect(board.renderFrame.mock.calls.length - reduced).toBeGreaterThan(55);
    });
});

describe('covering the map with a sheet', () => {
    function sheetWithEntrance() {
        let finish;
        let cancel;
        const finished = new Promise((resolve, reject) => { finish = resolve; cancel = reject; });
        const sheet = {
            isConnected: true,
            style: { display: 'flex' },
            getAnimations: () => [{ finished }],
        };
        return { sheet, finish: () => finish(), cancel: () => cancel(new Error('cancelled')) };
    }

    const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });

    it('waits for the sheet to finish fading in, then covers the board it found', async () => {
        const { sheet, finish } = sheetWithEntrance();
        const board = { setCovered: vi.fn() };
        const mode = { boardController: board };
        const uncover = coverOdysseyMapWith(mode, sheet);
        await flush();
        expect(board.setCovered).not.toHaveBeenCalled(); // still see-through
        finish();
        await flush();
        expect(board.setCovered).toHaveBeenCalledTimes(1);
        const [key, covered, stillCovered] = board.setCovered.mock.calls[0];
        expect(key).toBe(sheet);
        expect(covered).toBe(true);
        expect(stillCovered()).toBe(true);
        sheet.style.display = 'none';
        expect(stillCovered()).toBe(false);

        mode.boardController = { setCovered: vi.fn() }; // a newer board must not be uncovered
        uncover();
        expect(board.setCovered).toHaveBeenLastCalledWith(sheet, false);
        uncover();
        expect(board.setCovered).toHaveBeenCalledTimes(2);
    });

    it('never covers for a sheet closed while it faded in, an entrance cancelled, or no way to tell', async () => {
        const board = { setCovered: vi.fn() };
        const early = sheetWithEntrance();
        const uncover = coverOdysseyMapWith({ boardController: board }, early.sheet);
        uncover();
        early.finish();
        const cancelled = sheetWithEntrance();
        coverOdysseyMapWith({ boardController: board }, cancelled.sheet);
        cancelled.cancel();
        coverOdysseyMapWith({ boardController: board }, { isConnected: true, style: {} });
        await flush();
        expect(board.setCovered).not.toHaveBeenCalled();
    });

    it('covers at once when the sheet has no entrance (Reduce motion)', async () => {
        const board = { setCovered: vi.fn() };
        const sheet = { isConnected: true, style: {}, getAnimations: () => [] };
        coverOdysseyMapWith({ boardController: board }, sheet);
        await flush();
        expect(board.setCovered).toHaveBeenCalledWith(sheet, true, expect.any(Function));
    });

    it('reads a sheet as shown while it is on the page and not display:none', () => {
        expect(isSheetShown({ isConnected: true, style: { display: 'flex' } })).toBe(true);
        expect(isSheetShown({ isConnected: false, style: {} })).toBe(false);
        expect(isSheetShown({ isConnected: true, style: { display: 'none' } })).toBe(false);
        expect(isSheetShown(null)).toBe(false);
    });

    it('the navigator and the charm guide cover the map, and uncover it before they go', () => {
        const mode = read('core/game-modes/OdysseyMode.js');
        const between = (src, from, to) => src.slice(src.indexOf(from), src.indexOf(to));
        const show = between(mode, '    _showLevelSelectUI() {', '    _hideLevelSelectUI() {');
        expect(show).toMatch(/showOdysseyNavigator\(root, this\);[\s\S]*coverOdysseyMapWith\(this, root\)/);
        const hide = between(mode, '    _hideLevelSelectUI() {', '    _createLevelSelectUI() {');
        expect(hide.indexOf('this._uncoverNavigator?.()')).toBeGreaterThan(-1);
        expect(hide.indexOf('this._uncoverNavigator?.()')).toBeLessThan(hide.indexOf('hideOdysseyNavigator('));

        const guide = read('ui/odyssey/odyssey-charm-guide.js');
        const open = guide.slice(guide.indexOf('    const open = () => {'));
        expect(open.indexOf('coverOdysseyMapWith(mode, modal)'))
            .toBeGreaterThan(open.indexOf('doc.body.appendChild(modal)'));
        const close = between(guide, '    const close = () => {', '    const open = () => {');
        expect(close.indexOf('uncover?.()')).toBeGreaterThan(-1);
        expect(close.indexOf('uncover?.()')).toBeLessThan(close.indexOf('closing.dispose()'));
    });
});
