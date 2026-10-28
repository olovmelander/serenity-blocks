// Leaving Odyssey frees the map's GPU memory while the board's renderer can still do it. three
// r186 destroys no texture when a renderer is disposed (its Textures map is only dropped), and the
// board renders on a shared device the next mode keeps using, so a texture nobody disposed kept its
// GPU copy until garbage collection: the One World's plates (~35 MB at High), and the cosmic sky
// chapters 6 and 7 each copied (2 MiB apiece) and nobody freed.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { OdysseyBoardController } from '../../src/rendering/odyssey/OdysseyBoardController.js';
import {
    bakeCosmicBackdropTextureSliced,
} from '../../src/rendering/odyssey/chapter-environments/odyssey-cosmic-backdrop.js';
import {
    releaseOdysseyTextures,
} from '../../src/rendering/odyssey/chapter-environments/shared/odyssey-resident-textures.js';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const readSource = (file) => readFileSync(path.resolve(here, '../../src', file), 'utf8');

beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

/** A controller with just enough attached for dispose() to run (as odyssey-board-dispose-lifecycle does). */
function createBoard(order) {
    vi.stubGlobal('window', { innerHeight: 720, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    vi.stubGlobal('document', {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        body: {},
        documentElement: {},
        elementFromPoint: () => null,
    });
    const board = new OdysseyBoardController({
        clientWidth: 1280,
        clientHeight: 720,
        getBoundingClientRect: () => ({
            left: 0, top: 0, right: 1280, bottom: 720,
        }),
    });
    board.renderer = {
        domElement: { parentNode: { removeChild: vi.fn() } },
        dispose: vi.fn(() => order.push('renderer')),
    };
    board.scene = { traverse: vi.fn(), remove: vi.fn((obj) => order.push(`remove:${obj.name}`)) };
    board.environmentManager = { dispose: vi.fn(), suppressedChapters: new Set() };
    return board;
}

describe('the board frees the One World as it disposes', () => {
    it('runs the world\'s own teardown before the renderer goes', () => {
        const order = [];
        const board = createBoard(order);
        const world = { group: { name: 'odyssey-act2-world' }, dispose: vi.fn(() => order.push('world')) };
        board.oneWorld = world;
        board.dispose();
        expect(world.dispose).toHaveBeenCalledTimes(1);
        expect(order).toEqual(['remove:odyssey-act2-world', 'world', 'renderer']);
        expect(board.oneWorld).toBeNull();
    });

    it('a world whose teardown throws does not stop the board\'s', () => {
        const order = [];
        const board = createBoard(order);
        board.oneWorld = { group: { name: 'w' }, dispose: () => { throw new Error('half built'); } };
        expect(() => board.dispose()).not.toThrow();
        expect(order).toContain('renderer');
    });

    it('a board that built no world disposes as before', () => {
        const order = [];
        const board = createBoard(order);
        board.oneWorld = null;
        board.dispose();
        expect(order).toEqual(['renderer']);
    });
});

describe('chapters 6 and 7 share one sky', () => {
    it('once baked, every dome that shows the sky is handed the same texture, which the board frees', async () => {
        const options = { width: 32, height: 16, seed: 41.5 };
        const first = bakeCosmicBackdropTextureSliced(options, { sliceMs: 1 });
        expect(first.cached).toBe(false);
        await first.ready;

        const chapter7 = bakeCosmicBackdropTextureSliced(options);
        expect(chapter7.cached).toBe(true);
        expect(chapter7.texture).toBe(first.texture); // one GPU copy, not two
        expect(chapter7.data).toBe(first.texture.image.data);

        // Kept for the process like the other Odyssey bakes: the board frees its GPU copy.
        const disposed = vi.fn();
        first.texture.addEventListener('dispose', disposed);
        releaseOdysseyTextures();
        expect(disposed).toHaveBeenCalledTimes(1);
        // ...and the next board's domes use it again (its bytes stay on the texture).
        const nextBoard = bakeCosmicBackdropTextureSliced(options);
        expect(nextBoard.texture).toBe(first.texture);
        expect(Array.from(nextBoard.data)).toEqual(Array.from(first.data));
    });

    it('another sky keeps its own texture', async () => {
        const a = bakeCosmicBackdropTextureSliced({ width: 32, height: 16, seed: 7.25 }, { sliceMs: 1 });
        await a.ready;
        const b = bakeCosmicBackdropTextureSliced({ width: 32, height: 16, seed: 9.75 }, { sliceMs: 1 });
        expect(b.texture).not.toBe(a.texture);
        await b.ready;
    });

    it('a sky disposed before it landed is not kept: the next dome bakes it again', async () => {
        const options = { width: 32, height: 16, seed: 13.5 };
        const abandoned = bakeCosmicBackdropTextureSliced(options, { sliceMs: 0.01 });
        abandoned.texture.dispose();
        expect(await abandoned.ready).toBeNull();
        const again = bakeCosmicBackdropTextureSliced(options, { sliceMs: 1 });
        expect(again.texture).not.toBe(abandoned.texture);
        expect(await again.ready).toBe(again.texture);
    });
});

describe('a parked board gives its post targets back to the orb', () => {
    /** A board as the resize-while-parked suite builds one: a container, a renderer, a post stack. */
    function parkableBoard(container = { clientWidth: 1600, clientHeight: 900 }) {
        vi.stubGlobal('window', { innerHeight: 900, addEventListener: vi.fn(), removeEventListener: vi.fn() });
        vi.stubGlobal('document', {
            addEventListener: vi.fn(), removeEventListener: vi.fn(), body: {}, documentElement: {},
        });
        const board = new OdysseyBoardController(container);
        const size = { x: container.clientWidth, y: container.clientHeight };
        board.renderer = {
            domElement: { addEventListener: vi.fn(), removeEventListener: vi.fn(), style: {} },
            dispose: vi.fn(),
            getSize: vi.fn((target) => Object.assign(target, size)),
            setPixelRatio: vi.fn(),
            setSize: vi.fn(),
        };
        board.camera = { aspect: 16 / 9, updateProjectionMatrix: vi.fn() };
        board.scene = { traverse: vi.fn() };
        board.postProcessingStack = { dispose: vi.fn(), resize: vi.fn() };
        board._applyChapterMusic = vi.fn();
        board.animate = vi.fn();
        return board;
    }

    it('shrinks the post targets only once the board is paused, and the resume sizes them back first', () => {
        const board = parkableBoard();
        board.isRenderingPaused = false;
        board.releaseParkedTargets(); // drawing: left alone
        expect(board.postProcessingStack.resize).not.toHaveBeenCalled();

        board.isRenderingPaused = true;
        board.releaseParkedTargets();
        expect(board.postProcessingStack.resize).toHaveBeenLastCalledWith(16, 16);

        // Same canvas size, nothing pending: before, the resume took no resize at all.
        board.resumeRendering();
        expect(board.postProcessingStack.resize).toHaveBeenLastCalledWith(1600, 900);
        expect(board.postProcessingStack.resize.mock.invocationCallOrder.at(-1))
            .toBeLessThan(board.animate.mock.invocationCallOrder[0]);

        // Restored once: the next resume of an unreleased board takes no resize.
        board.postProcessingStack.resize.mockClear();
        board.isRenderingPaused = true;
        board.resumeRendering();
        expect(board.postProcessingStack.resize).not.toHaveBeenCalled();
    });

    it('a board that resumes still hidden keeps owing the resize', () => {
        const container = { clientWidth: 1600, clientHeight: 900 };
        const board = parkableBoard(container);
        board.isRenderingPaused = true;
        board.releaseParkedTargets();
        container.clientWidth = 0;
        container.clientHeight = 0;
        board.resumeRendering();
        expect(board.postProcessingStack.resize).toHaveBeenCalledTimes(1); // only the release
        container.clientWidth = 1280;
        container.clientHeight = 720;
        board.onResize(); // the next resize the page takes restores it
        expect(board.postProcessingStack.resize).toHaveBeenLastCalledWith(1280, 720);
    });

    it('the mode releases them as it parks the board', () => {
        const src = readSource('core/game-modes/OdysseyMode.js');
        const park = src.indexOf('    _parkOdysseyBoard() {');
        const pause = src.indexOf('this.boardController.pauseRendering?.();', park);
        const release = src.indexOf('this.boardController.releaseParkedTargets?.();', park);
        expect(park).toBeGreaterThan(-1);
        expect(release).toBeGreaterThan(pause);
        expect(release - park).toBeLessThan(600);
    });
});
