import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import { OpponentWatchManager } from '../../src/ui/opponent-watch-manager.js';

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

function counters() {
    return { selectors: 0, styles: 0, texts: 0, clears: 0, creates: 0, classes: 0, reads: 0 };
}

function node(counts) {
    const values = {};
    const classes = new Set();
    const children = [];
    return {
        children,
        isConnected: true,
        style: new Proxy({
            setProperty(key, value) { counts.styles++; values[key] = value; },
        }, {
            get(target, key) { return key === 'setProperty' ? target[key] : values[key]; },
            set(target, key, value) { counts.styles++; values[key] = value; return true; },
        }),
        classList: {
            contains(key) { return classes.has(key); },
            add(key) { counts.classes++; classes.add(key); },
            remove(key) { counts.classes++; classes.delete(key); },
            toggle(key, enabled) {
                counts.classes++;
                if (enabled) classes.add(key); else classes.delete(key);
            },
        },
        get textContent() { return values.text; },
        set textContent(value) { counts.texts++; values.text = value; },
        get innerHTML() { return ''; },
        set innerHTML(value) { counts.clears++; children.length = 0; },
        appendChild(child) { children.push(child); return child; },
    };
}

function makeBoard(counts) {
    const element = node(counts);
    const nodes = {
        '.opponent-frags': node(counts),
        'canvas.opponent-grid': node(counts),
        '.opponent-next-piece.highlight': node(counts),
        '.opponent-garbage-meter': node(counts),
        '.opponent-garbage-fill': node(counts),
        '.opponent-garbage-segments': node(counts),
        '.opponent-grid-frame': node(counts),
    };
    const ctx = {};
    nodes['canvas.opponent-grid'].getContext = () => ctx;
    element.querySelector = (selector) => { counts.selectors++; return nodes[selector] || null; };
    element.querySelectorAll = () => [];
    element.contains = (child) => Object.values(nodes).includes(child);
    return {
        nodes,
        playerKey: 'P2',
        element,
        canvas: nodes['canvas.opponent-grid'],
        ctx,
        frame: nodes['.opponent-grid-frame'],
        garbageMeter: nodes['.opponent-garbage-meter'],
        garbageFill: nodes['.opponent-garbage-fill'],
        garbageSegments: nodes['.opponent-garbage-segments'],
    };
}

function makeWatcher(board = null) {
    return Object.assign(Object.create(OpponentWatchManager.prototype), {
        allPlayers: [{ id: 'P2' }],
        watchedPlayers: [],
        playerBoards: new Map(board ? [['P2', board]] : []),
        _boardEffects: new Map(),
        _renderSigs: new Map(),
        _lastNextPieces: new Map(),
        autoWatchEnabled: false,
        _maybeTriggerSettledBoardPulse: vi.fn(),
        setOpponentDeadState: vi.fn(),
        _showOpponentWaitingOverlay: vi.fn(),
        _clearOpponentWaitingOverlay: vi.fn(),
        _showOpponentDeathAnimation: vi.fn(),
        _ensureOpponentDeathOverlay: vi.fn(),
        _clearOpponentDeathState: vi.fn(),
        _showDisconnectOverlay: vi.fn(),
        _hideDisconnectOverlay: vi.fn(),
        _updateSelectionList: vi.fn(),
        _renderMiniBoard: vi.fn(),
        _renderNextQueue: vi.fn(),
        _highlightSpotlightBoard: vi.fn(),
    });
}

function installDocument(counts) {
    vi.stubGlobal('document', {
        createElement() { counts.creates++; return node(counts); },
        getElementById() { return null; },
    });
}

function queue(entries) {
    return {
        entries,
        getTotalLines() { return this.entries.filter((entry) => entry.type === 'line').length; },
    };
}

function snapshot(overrides = {}) {
    return { id: 'P2', isAlive: true, frags: 0, color: '#22d3ee', ...overrides };
}

describe('opponent HUD changed-value presentation', () => {
    it('performs no selectors or DOM writes for unchanged snapshots after first presentation', () => {
        const counts = counters();
        installDocument(counts);
        const board = makeBoard(counts);
        const watcher = makeWatcher(board);
        const entries = [{ type: 'line', color: '#f00' }, { type: 'line', color: '#0f0' }];
        const state = snapshot({ garbageQueue: queue(entries) });
        watcher.updateFromState([state]);
        Object.assign(counts, counters());

        for (let i = 0; i < 60; i++) watcher.updateFromState([state]);

        expect(counts).toEqual(counters());
        expect(board.garbageSegments.children.map((child) => child.style.background)).toEqual(['#f00', '#0f0']);
    });

    it('updates changed frags and player colours without rebuilding unchanged garbage', () => {
        const counts = counters();
        installDocument(counts);
        const board = makeBoard(counts);
        const watcher = makeWatcher(board);
        watcher.updateFromState([snapshot()]);
        Object.assign(counts, counters());

        watcher.updateFromState([snapshot({ frags: 2, color: '#fb7185' })]);

        expect(board.nodes['.opponent-frags'].textContent).toBe('⚔️ 2');
        expect(board.canvas.style.borderLeftColor).toBe('#fb7185');
        expect(board.nodes['.opponent-next-piece.highlight'].style.borderColor).toBe('#fb7185');
        expect(counts.texts).toBe(1);
        expect(counts.styles).toBe(6);
        expect(counts.clears).toBe(0);
        expect(counts.selectors).toBe(0);
        expect(counts.classes).toBe(0);
    });

    it('shares rendered garbage for equivalent newly allocated queues', () => {
        const counts = counters();
        installDocument(counts);
        const board = makeBoard(counts);
        const watcher = makeWatcher(board);
        const entries = [{ type: 'line', color: '#f00' }, { type: 'blind', color: '#fff' }];
        watcher.updateFromState([snapshot({ garbageQueue: queue(entries) })]);
        Object.assign(counts, counters());

        watcher.updateFromState([snapshot({ garbageQueue: queue(entries.map((entry) => ({ ...entry }))) })]);

        expect(counts).toEqual(counters());
    });

    it('rebuilds when line colour changes in place without changing queue identity or total', () => {
        const counts = counters();
        installDocument(counts);
        const board = makeBoard(counts);
        const watcher = makeWatcher(board);
        const garbageQueue = queue([{ type: 'line', color: '#f00' }]);
        const state = snapshot({ garbageQueue });
        watcher.updateFromState([state]);
        Object.assign(counts, counters());

        garbageQueue.entries[0].color = '#00f';
        watcher.updateFromState([state]);

        expect(counts.clears).toBe(1);
        expect(board.garbageSegments.children[0].style.background).toBe('#00f');
        expect(board.garbageFill.style.height).toBe('5%');
        expect(counts.classes).toBe(0);
    });

    it('rebuilds for equal-total line/blind type swaps and line order changes', () => {
        const counts = counters();
        installDocument(counts);
        const board = makeBoard(counts);
        const watcher = makeWatcher(board);
        const garbageQueue = queue([
            { type: 'line', color: '#f00' },
            { type: 'blind', color: '#0f0' },
            { type: 'line', color: '#00f' },
        ]);
        const state = snapshot({ garbageQueue });
        watcher.updateFromState([state]);
        Object.assign(counts, counters());

        garbageQueue.entries[0].type = 'blind';
        garbageQueue.entries[1].type = 'line';
        watcher.updateFromState([state]);
        expect(board.garbageSegments.children.map((child) => child.style.background)).toEqual(['#0f0', '#00f']);
        garbageQueue.entries.reverse();
        watcher.updateFromState([state]);
        expect(board.garbageSegments.children.map((child) => child.style.background)).toEqual(['#00f', '#0f0']);
        expect(counts.clears).toBe(2);
        expect(board.garbageFill.style.height).toBe('10%');
    });

    it('preserves overflow segment scaling, pending/warning thresholds and raw-amount fallback', () => {
        const counts = counters();
        installDocument(counts);
        const board = makeBoard(counts);
        const watcher = makeWatcher(board);
        const garbageQueue = queue(Array.from({ length: 24 }, () => ({ type: 'line' })));
        watcher.updateFromState([snapshot({ garbageQueue })]);

        expect(board.garbageFill.style.height).toBe('100%');
        expect(board.garbageSegments.children).toHaveLength(1);
        expect(board.garbageSegments.children[0].style.height).toBe('100%');
        expect(board.garbageSegments.children[0].style.background).toBe('#808080');
        expect(board.garbageMeter.classList.contains('warning')).toBe(true);

        watcher.updateFromState([snapshot({ garbagePending: 7 })]);
        expect(board.garbageFill.style.height).toBe('35%');
        expect(board.garbageSegments.children).toHaveLength(0);
        expect(board.garbageMeter.classList.contains('pending')).toBe(true);
        expect(board.garbageMeter.classList.contains('warning')).toBe(false);
        watcher.updateFromState([snapshot()]);
        expect(board.garbageMeter.classList.contains('pending')).toBe(false);
    });

    it('recaches replaced HUD nodes and repaints equivalent values on the new surfaces', () => {
        const counts = counters();
        installDocument(counts);
        const board = makeBoard(counts);
        const watcher = makeWatcher(board);
        const state = snapshot({ garbageQueue: queue([{ type: 'line', color: '#f00' }]) });
        watcher.updateFromState([state]);
        const oldCanvas = board.canvas;
        for (const selector of Object.keys(board.nodes)) board.nodes[selector] = node(counts);
        const newCtx = {};
        board.nodes['canvas.opponent-grid'].getContext = () => newCtx;
        watcher._renderSigs.set('P2', 'unchanged');

        watcher.updateFromState([state]);

        expect(board.canvas).not.toBe(oldCanvas);
        expect(board.ctx).toBe(newCtx);
        expect(watcher._renderSigs.has('P2')).toBe(false);
        expect(board.nodes['.opponent-frags'].textContent).toBe('⚔️ 0');
        expect(board.canvas.style.borderBottomColor).toBe('#22d3ee');
        expect(board.garbageFill).toBe(board.nodes['.opponent-garbage-fill']);
        expect(board.garbageFill.style.height).toBe('5%');
        expect(board.garbageSegments.children[0].style.background).toBe('#f00');
    });

    it('recaches a replacement card and its next-piece contexts', () => {
        const counts = counters();
        installDocument(counts);
        const board = makeBoard(counts);
        const watcher = makeWatcher(board);
        watcher.updateFromState([snapshot({ nextPieces: ['T', 'I'] })]);
        const fresh = makeBoard(counts);
        const nextContext = {};
        fresh.element.querySelectorAll = () => [{ getContext: () => nextContext }];
        board.element = fresh.element;
        watcher._lastNextPieces.set('P2', 'T,I');
        watcher._renderNextQueue.mockClear();

        watcher.updateFromState([snapshot({ nextPieces: ['T', 'I'] })]);

        expect(board.canvas).toBe(fresh.canvas);
        expect(board.garbageFill).toBe(fresh.garbageFill);
        expect(board.nextCtxs).toEqual([nextContext]);
        expect(watcher._renderNextQueue).toHaveBeenCalledWith([nextContext], ['T', 'I']);
    });

    it('rebinds next-piece canvases replaced inside an otherwise unchanged card', () => {
        const counts = counters();
        installDocument(counts);
        const board = makeBoard(counts);
        const watcher = makeWatcher(board);
        const oldCanvas = node(counts);
        board.nodes.nextCanvas = oldCanvas;
        board.nextCtxs = [{ canvas: oldCanvas }];
        const state = snapshot({ nextPieces: ['T', 'I'] });
        watcher.updateFromState([state]);
        const freshCanvas = node(counts);
        const freshContext = { canvas: freshCanvas };
        freshCanvas.getContext = () => freshContext;
        board.nodes.nextCanvas = freshCanvas;
        board.element.querySelectorAll = () => [freshCanvas];
        watcher._renderNextQueue.mockClear();

        watcher.updateFromState([state]);

        expect(board.nextCtxs).toEqual([freshContext]);
        expect(watcher._renderNextQueue).toHaveBeenCalledWith([freshContext], ['T', 'I']);
    });

    it('recovers children restored in a later update after temporary removal', () => {
        const counts = counters();
        installDocument(counts);
        const board = makeBoard(counts);
        const watcher = makeWatcher(board);
        const state = snapshot({ garbagePending: 3 });
        watcher.updateFromState([state]);
        delete board.nodes['.opponent-frags'];
        delete board.nodes['.opponent-garbage-fill'];
        watcher.updateFromState([state]);
        expect(board._hud.complete).toBe(false);
        expect(board.garbageFill).toBe(null);
        board.nodes['.opponent-frags'] = node(counts);
        board.nodes['.opponent-garbage-fill'] = node(counts);
        watcher.updateFromState([state]);
        expect(board.nodes['.opponent-frags'].textContent).toBe('⚔️ 0');
        expect(board.garbageFill.style.height).toBe('15%');
        expect(board._hud.complete).toBe(true);
    });

    it('retains waiting, death/revival and disconnect transitions while avoiding repeated class writes', () => {
        const counts = counters();
        installDocument(counts);
        const board = makeBoard(counts);
        const watcher = makeWatcher(board);
        watcher.updateFromState([snapshot({ isAlive: false })]);
        expect(board.element.classList.contains('dead')).toBe(true);
        expect(watcher._showOpponentDeathAnimation).toHaveBeenCalledTimes(1);
        watcher.updateFromState([snapshot({ isAlive: false, awaitingSpawn: true })]);
        expect(board.element.classList.contains('dead')).toBe(false);
        expect(board.element.classList.contains('waiting')).toBe(true);
        expect(watcher._clearOpponentDeathState).toHaveBeenCalledTimes(1);
        watcher.updateFromState([snapshot({ isDisconnected: true })]);
        expect(board.element.classList.contains('waiting')).toBe(false);
        expect(watcher._clearOpponentWaitingOverlay).toHaveBeenCalledTimes(1);
        expect(watcher._showDisconnectOverlay).toHaveBeenCalledTimes(1);
        Object.assign(counts, counters());
        watcher.updateFromState([snapshot({ isDisconnected: true })]);
        expect(counts.classes).toBe(0);
        expect(watcher._showDisconnectOverlay).toHaveBeenCalledTimes(1);
        watcher.updateFromState([snapshot()]);
        expect(watcher._hideDisconnectOverlay).toHaveBeenCalledTimes(2);
    });

    it('uses the full rendered garbage signature for the spotlight too', () => {
        const counts = counters();
        installDocument(counts);
        const board = makeBoard(counts);
        const watcher = makeWatcher();
        watcher._spotlightGarbage = board;
        const garbageQueue = queue([{ type: 'line', color: '#f00' }]);
        watcher._updateSpotlightGarbage(snapshot({ garbageQueue }));
        garbageQueue.entries[0].color = '#0f0';
        watcher._updateSpotlightGarbage(snapshot({ garbageQueue }));
        expect(board.garbageSegments.children[0].style.background).toBe('#0f0');
        expect(counts.clears).toBe(2);
    });
});

function spotlightFixture({ width = 440, height = 650, viewport = 720 } = {}) {
    const counts = counters();
    const observers = [];
    const visibilityObservers = [];
    vi.stubGlobal('ResizeObserver', class {
        constructor(callback) { this.callback = callback; this.targets = []; this.disconnect = vi.fn(); observers.push(this); }
        observe(target) { this.targets.push(target); }
    });
    vi.stubGlobal('MutationObserver', class {
        constructor(callback) {
            this.callback = callback;
            this.observe = vi.fn();
            this.disconnect = vi.fn();
            visibilityObservers.push(this);
        }
    });
    const stage = node(counts);
    const panel = node(counts);
    const card = node(counts);
    const canvas = node(counts);
    const layout = { width, height, viewport, card };
    Object.defineProperty(stage, 'clientHeight', { get() { counts.reads++; return layout.height; } });
    Object.defineProperty(panel, 'clientWidth', { get() { counts.reads++; return layout.width; } });
    stage.contains = (child) => child === canvas;
    panel.contains = (child) => child === canvas;
    canvas.closest = (selector) => {
        counts.selectors++;
        return selector === '.spectator-spotlight-stage' ? stage : panel;
    };
    canvas.getContext = () => ({});
    vi.stubGlobal('document', {
        getElementById() { counts.selectors++; return layout.card; },
        createElement() { return node(counts); },
    });
    vi.stubGlobal('window', {
        get innerHeight() { return layout.viewport; },
        removeEventListener: vi.fn(),
    });
    const watcher = makeWatcher();
    watcher.setSpotlight(canvas);
    return { watcher, counts, observers, visibilityObservers, layout, stage, panel, card, canvas };
}

describe('spectator spotlight layout ownership', () => {
    it('does not query or measure stable spotlight layout across animation frames', () => {
        const { watcher, counts, canvas } = spotlightFixture();
        const player = snapshot({ grid: Array.from({ length: 24 }, () => Array(10).fill(0)) });
        watcher.allPlayers = [player];
        watcher._opponentDirtyCheck = true;
        watcher._renderSpotlight();
        watcher._renderMiniBoard.mockClear();
        Object.assign(counts, counters());

        for (let i = 0; i < 120; i++) watcher._renderSpotlight();

        expect(canvas.style.width).toBe('325px');
        expect(canvas.style.height).toBe('650px');
        expect(counts).toEqual(counters());
        expect(watcher._renderMiniBoard).not.toHaveBeenCalled();
    });

    it('remeasures after observed stage/panel and window resizes, preserving board aspect', () => {
        const { watcher, layout, observers, canvas, stage, panel } = spotlightFixture();
        expect(observers[0].targets).toEqual([stage, panel]);
        layout.height = 500;
        observers[0].callback();
        watcher._resizeSpotlight();
        expect(canvas.style.width).toBe('250px');
        expect(canvas.style.height).toBe('500px');
        layout.width = 180;
        watcher._handleResize();
        watcher._resizeSpotlight();
        expect(canvas.style.width).toBe('180px');
        expect(canvas.style.height).toBe('360px');
    });

    it('avoids repeated hidden measurements and updates immediately when the stage becomes visible', () => {
        const { watcher, layout, observers, canvas, counts } = spotlightFixture();
        layout.height = 0;
        observers[0].callback();
        watcher._resizeSpotlight();
        Object.assign(counts, counters());
        for (let i = 0; i < 60; i++) watcher._resizeSpotlight();
        expect(counts).toEqual(counters());
        layout.height = 420;
        observers[0].callback();
        watcher._resizeSpotlight();
        expect(canvas.style.height).toBe('420px');
        expect(canvas.style.width).toBe('210px');
    });

    it('invalidates mode visibility/class changes before the next frame and retires visibility observers', () => {
        const { watcher, layout, visibilityObservers, canvas, panel } = spotlightFixture();
        const observer = visibilityObservers[0];
        expect(observer.observe).toHaveBeenCalledWith(panel, {
            attributes: true, attributeFilter: ['class', 'style', 'hidden'],
        });
        layout.height = 480;
        observer.callback();
        watcher._resizeSpotlight();
        expect(canvas.style.height).toBe('480px');
        watcher.setSpotlight(canvas);
        expect(observer.disconnect).toHaveBeenCalledTimes(1);
        observer.callback();
        expect(watcher._spotlightLayout.dirty).toBe(false);
        const active = visibilityObservers[1];
        watcher.destroy();
        expect(active.disconnect).toHaveBeenCalledTimes(1);
        expect(watcher._spotlightVisibilityObserver).toBe(null);
    });

    it('reserves garbage-column width when binding changes without a panel resize', () => {
        const { watcher, canvas, counts } = spotlightFixture({ width: 300, height: 1000, viewport: 1000 });
        expect(canvas.style.width).toBe('300px');
        const meter = node(counts);
        watcher._spotlightGarbage = { garbageMeter: meter };
        watcher._resizeSpotlight();
        expect(canvas.style.width).toBe('274px');
        expect(meter.style.height).toBe('548px');
        watcher._spotlightGarbage = null;
        watcher._resizeSpotlight();
        expect(canvas.style.width).toBe('300px');
    });

    it('sizes immediately after switching players and the header callback changes layout', () => {
        const { watcher, canvas, layout } = spotlightFixture();
        watcher.allPlayers = [snapshot()];
        watcher.onSpotlightChange = vi.fn(() => { layout.height = 400; });
        watcher.setSpotlightPlayer('P2');
        expect(watcher.onSpotlightChange).toHaveBeenCalledWith(watcher.allPlayers[0]);
        expect(canvas.style.width).toBe('200px');
        expect(canvas.style.height).toBe('400px');
    });

    it('rewires a replaced card once and retires the old layout observer', () => {
        const { watcher, layout, observers, card, counts } = spotlightFixture();
        card.isConnected = false;
        layout.card = node(counts);
        watcher._resizeSpotlight();
        expect(observers[0].disconnect).toHaveBeenCalledTimes(1);
        expect(layout.card.style.width).toBe('365px');
        Object.assign(counts, counters());
        watcher._resizeSpotlight();
        expect(counts).toEqual(counters());
    });

    it('retires old observers on canvas re-registration and ignores their late callbacks', () => {
        const { watcher, canvas, observers } = spotlightFixture();
        const oldObserver = observers[0];
        watcher.setSpotlight(canvas);
        expect(oldObserver.disconnect).toHaveBeenCalledTimes(1);
        expect(watcher._spotlightLayout.dirty).toBe(false);
        oldObserver.callback();
        expect(watcher._spotlightLayout.dirty).toBe(false);
        observers[1].callback();
        expect(watcher._spotlightLayout.dirty).toBe(true);
    });

    it('disconnects the spotlight observer and clears references on disposal', () => {
        const { watcher, observers } = spotlightFixture();
        watcher.destroy();
        expect(observers[0].disconnect).toHaveBeenCalledTimes(1);
        expect(watcher._spotlightResizeObserver).toBe(null);
        expect(watcher._spotlightLayout).toBe(null);
        expect(watcher.spotlightCanvas).toBe(null);
        observers[0].callback();
        expect(watcher._spotlightLayout).toBe(null);
    });
});
