import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';

const asyncPipelines = vi.hoisted(() => ({
    ready: true,
    sessions: [],
}));
vi.mock('../../src/rendering/async-render-pipelines.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        isAsyncRenderPipelinesReady: () => asyncPipelines.ready,
        preloadAsyncRenderPipelines: vi.fn(async () => { asyncPipelines.ready = true; return {}; }),
        beginAsyncRenderPipelines: vi.fn((owner, options) => {
            const session = { owner, options, end: vi.fn() };
            asyncPipelines.sessions.push(session);
            return session;
        }),
    };
});

const { OdysseyBoardController } = await import('../../src/rendering/odyssey/OdysseyBoardController.js');

/**
 * 2026-10-19: a player who scrolls on from the reveal reaches chapters 5-8 before their warm, and
 * each first draw created its pipeline synchronously (frames of 365-683 ms at Extreme). After the
 * reveal the live map creates pipelines through the async session the loading surfaces use.
 */
describe('Odyssey board live async pipelines', () => {
    beforeEach(() => {
        asyncPipelines.ready = true;
        asyncPipelines.sessions.length = 0;
        vi.stubGlobal('window', {
            addEventListener: vi.fn(), removeEventListener: vi.fn(), location: { search: '' },
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    function createBoard() {
        const board = new OdysseyBoardController({ clientWidth: 1280, clientHeight: 720 });
        board.isWebGPU = true;
        board.renderer = { tag: 'board-renderer' };
        return board;
    }

    it('owns the board renderer once, from the reveal on', () => {
        const board = createBoard();
        board._beginLiveAsyncPipelines();
        board._beginLiveAsyncPipelines();
        expect(asyncPipelines.sessions).toHaveLength(1);
        expect(asyncPipelines.sessions[0].owner.renderer).toBe(board.renderer);
        expect(asyncPipelines.sessions[0].options).toMatchObject({ label: 'odyssey-board-live', buildBudgetMs: 4, exemptCanvasDraws: true });
    });

    it('waits for the backend preload when it has not resolved yet', async () => {
        asyncPipelines.ready = false;
        const board = createBoard();
        board._beginLiveAsyncPipelines();
        expect(asyncPipelines.sessions).toHaveLength(0);
        await Promise.resolve();
        await Promise.resolve();
        expect(asyncPipelines.sessions).toHaveLength(1);
    });

    it('stays off on WebGL2 and with ?odysseyAsyncPipelines=0', () => {
        const webgl = createBoard();
        webgl.isWebGPU = false;
        webgl._beginLiveAsyncPipelines();
        window.location.search = '?odysseyAsyncPipelines=0';
        createBoard()._beginLiveAsyncPipelines();
        expect(asyncPipelines.sessions).toHaveLength(0);
    });

    it('ends the session when the board is disposed', () => {
        const board = createBoard();
        board._beginLiveAsyncPipelines();
        const [session] = asyncPipelines.sessions;
        try { board.dispose(); } catch { /* a bare board has nothing else to free */ }
        expect(session.end).toHaveBeenCalledOnce();
        expect(board._liveAsyncPipelines).toBe(null);
    });
});
