import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import MurmurationTheme from '../../src/themes/murmuration/murmuration-theme.js';

const state = {
    mutations: [], sizes: [], boards: [], roots: [],
};

function canvas(rect, visibility = 'visible') {
    return { rect, visibility, getBoundingClientRect() { return this.rect; } };
}

function root(id, contains = () => false) {
    return { id, matches: () => false, contains };
}

function observerMock(instances) {
    return class {
        constructor(callback) {
            this.callback = callback;
            this.observe = vi.fn();
            this.disconnect = vi.fn();
            instances.push(this);
        }
    };
}

function setupTheme() {
    const theme = new MurmurationTheme();
    theme.isActive = true;
    theme.postPipeline = { setBoardHalo: vi.fn(), dispose: vi.fn() };
    theme.fluidSim = { setBoardZone: vi.fn(), dispose: vi.fn() };
    theme._setupResize();
    return theme;
}

function currentHalo(theme) {
    const halo = theme.postPipeline.setBoardHalo.mock.calls.at(-1)[0];
    return {
        x: halo.center.x, y: halo.center.y, halfX: halo.halfSize.x, halfY: halo.halfSize.y,
    };
}

beforeEach(() => {
    state.mutations = [];
    state.sizes = [];
    state.boards = [];
    state.roots = [
        root('single-player-stage'), root('multiplayer-container'),
        root('online-multiplayer-container'), root('odyssey-container'),
    ];
    vi.stubGlobal('window', {
        innerWidth: 390,
        innerHeight: 844,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        cancelAnimationFrame: vi.fn(),
        getComputedStyle: (board) => ({ visibility: board.visibility }),
    });
    vi.stubGlobal('document', {
        getElementById: () => null,
        querySelectorAll: (selector) => (selector.includes(' canvas') ? state.boards : state.roots),
    });
    vi.stubGlobal('MutationObserver', observerMock(state.mutations));
    vi.stubGlobal('ResizeObserver', observerMock(state.sizes));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Murmuration board lifecycle framing', () => {
    it('refreshes the real phone halo when a canvas mounts after the theme starts', () => {
        const theme = setupTheme();
        expect(currentHalo(theme).x).toBe(0.5);
        expect(currentHalo(theme).y).toBe(0.5);
        expect(state.mutations[0].observe.mock.calls.map(([observed]) => observed)).toEqual(state.roots);
        expect(state.mutations[0].observe.mock.calls.every(([, options]) => (
            options.subtree && options.childList && options.attributes
            && options.attributeFilter.includes('class') && options.attributeFilter.includes('style')
        ))).toBe(true);

        const board = canvas({
            left: 39, right: 351, top: 100, bottom: 700, width: 312, height: 600,
        });
        state.boards = [board];
        state.mutations[0].callback([{ target: { matches: () => true } }]);
        const halo = currentHalo(theme);
        expect(halo.x).toBeCloseTo(0.5);
        expect(halo.y).toBeCloseTo(400 / 844);
        expect(halo.halfX).toBeCloseTo(0.4 * 1.04);
        expect(halo.halfY).toBeCloseTo((300 / 844) * 1.02);
        expect(state.sizes[0].observe).toHaveBeenCalledWith(board);
        expect(theme.fluidSim.setBoardZone.mock.calls.at(-1)[0].center.y).toBeGreaterThan(0);
        theme.stop();
    });

    it('tracks canvas layout and switches to the newly visible mode on a shell style change', () => {
        const single = canvas({
            left: 39, right: 351, top: 100, bottom: 700, width: 312, height: 600,
        });
        const online = canvas({
            left: 60, right: 330, top: 200, bottom: 740, width: 270, height: 540,
        }, 'hidden');
        state.boards = [single, online];
        const theme = setupTheme();
        single.rect = {
            left: 45, right: 345, top: 120, bottom: 720, width: 300, height: 600,
        };
        state.sizes[0].callback([{ target: single }]);
        expect(currentHalo(theme).y).toBeCloseTo(420 / 844);

        single.visibility = 'hidden';
        online.visibility = 'visible';
        state.roots[0].contains = (node) => node === single;
        state.mutations[0].callback([{ target: state.roots[0], attributeName: 'style' }]);
        expect(currentHalo(theme).y).toBeCloseTo(470 / 844);
        expect(currentHalo(theme).halfX).toBeCloseTo((135 / 390) * 1.04);
        expect(state.sizes[0].observe.mock.calls.map(([observed]) => observed)).toEqual([single, online]);

        state.boards = [];
        state.mutations[0].callback([{ target: { matches: () => true } }]);
        expect(currentHalo(theme).y).toBe(0.5);
        expect(theme._observedBoardCanvas).toBeNull();
        theme.stop();
    });

    it('ignores unrelated HUD changes and retires queued callbacks on stop or re-setup', () => {
        const board = canvas({
            left: 39, right: 351, top: 100, bottom: 700, width: 312, height: 600,
        });
        state.boards = [board];
        const theme = setupTheme();
        const oldMutation = state.mutations[0];
        const oldResize = state.sizes[0];
        const haloSetter = theme.postPipeline.setBoardHalo;
        const callsBefore = haloSetter.mock.calls.length;
        oldMutation.callback([{ target: root('score-hud') }]);
        expect(haloSetter).toHaveBeenCalledTimes(callsBefore);
        theme._setupBoardZoneObserver();
        expect(oldMutation.disconnect).toHaveBeenCalledOnce();
        const callsAfterSetup = haloSetter.mock.calls.length;
        oldMutation.callback([{ target: { matches: () => true } }]);
        oldResize.callback([{ target: board }]);
        expect(haloSetter).toHaveBeenCalledTimes(callsAfterSetup);

        const activeMutation = state.mutations[1];
        const activeResize = state.sizes[1];
        theme.stop();
        expect(activeMutation.disconnect).toHaveBeenCalledOnce();
        expect(activeResize.disconnect).toHaveBeenCalled();
        activeMutation.callback([{ target: { matches: () => true } }]);
        activeResize.callback([{ target: board }]);
        expect(haloSetter).toHaveBeenCalledTimes(callsAfterSetup);
        expect(theme._boardObserverSession).toBeNull();
    });

    it('restores fallback framing when a whole board mount is removed without ResizeObserver', () => {
        vi.stubGlobal('ResizeObserver', undefined);
        const board = canvas({
            left: 39, right: 351, top: 100, bottom: 700, width: 312, height: 600,
        });
        state.boards = [board];
        const theme = setupTheme();
        expect(currentHalo(theme).y).toBeCloseTo(400 / 844);
        state.boards = [];
        state.mutations[0].callback([{
            target: state.roots[0],
            removedNodes: [{ matches: () => true }],
        }]);
        expect(currentHalo(theme).y).toBe(0.5);
        theme.stop();
    });

    it('keeps initial and window-resize framing when observer APIs are unavailable', () => {
        vi.stubGlobal('MutationObserver', undefined);
        vi.stubGlobal('ResizeObserver', undefined);
        const board = canvas({
            left: 39, right: 351, top: 100, bottom: 700, width: 312, height: 600,
        });
        state.boards = [board];
        const theme = setupTheme();
        theme.renderer = { setSize: vi.fn() };
        theme.camera = { updateProjectionMatrix: vi.fn() };
        expect(currentHalo(theme).y).toBeCloseTo(400 / 844);
        board.rect = {
            left: 39, right: 351, top: 180, bottom: 780, width: 312, height: 600,
        };
        theme.boundResize();
        expect(currentHalo(theme).y).toBeCloseTo(480 / 844);
        expect(theme.renderer.setSize).toHaveBeenCalledWith(390, 844);
        theme.renderer = null;
        theme.stop();
    });
});
