import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { InfinityMinimap } from '../../src/ui/infinity/InfinityMinimap.js';

/** A 2D context that records what is drawn. */
function recordingContext() {
    const calls = [];
    const context = { calls };
    ['clearRect', 'fillRect', 'strokeRect', 'drawImage', 'putImageData'].forEach((method) => {
        context[method] = vi.fn((...args) => calls.push({ method, args, fillStyle: context.fillStyle }));
    });
    context.createLinearGradient = vi.fn(() => ({ addColorStop: vi.fn() }));
    context.createImageData = vi.fn((width, height) => ({
        width, height, data: new Uint8ClampedArray(width * height * 4),
    }));
    return context;
}

function element(tag) {
    const listeners = new Map();
    const classes = new Set();
    const el = {
        tagName: tag.toUpperCase(),
        style: {},
        children: [],
        parentElement: null,
        dispatched: [],
        classList: {
            add: (name) => classes.add(name),
            remove: (name) => classes.delete(name),
            contains: (name) => classes.has(name),
        },
        setAttribute: vi.fn(),
        append(...nodes) { nodes.forEach((node) => this.appendChild(node)); },
        appendChild(node) {
            this.children.push(node);
            node.parentElement = this;
            return node;
        },
        removeChild(node) {
            this.children = this.children.filter((child) => child !== node);
            node.parentElement = null;
        },
        addEventListener: (type, handler) => listeners.set(type, handler),
        removeEventListener: (type) => listeners.delete(type),
        dispatchEvent(event) { this.dispatched.push(event); },
        listeners,
    };
    if (tag === 'canvas') {
        el.width = 300;
        el.height = 150;
        el.clientWidth = 80;
        el.clientHeight = 400;
        el.context = recordingContext();
        el.getContext = () => el.context;
        el.getBoundingClientRect = () => ({ top: 100, height: 400 });
    }
    return el;
}

let now;
let windowListeners;
let created;
beforeEach(() => {
    now = 0;
    created = [];
    windowListeners = new Map();
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.stubGlobal('document', {
        createElement: (tag) => {
            const el = element(tag);
            created.push(el);
            return el;
        },
        getElementById: () => null,
    });
    vi.stubGlobal('window', {
        devicePixelRatio: 1,
        innerWidth: 1600,
        innerHeight: 900,
        addEventListener: (type, handler) => windowListeners.set(type, handler),
        removeEventListener: (type) => windowListeners.delete(type),
    });
    vi.stubGlobal('CustomEvent', class {
        constructor(type, options = {}) { this.type = type; this.detail = options.detail; }
    });
});
afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

/** A 200-row Infinity board with a build of `height` rows in column 3. */
function state(height = 30) {
    const board = Array.from({ length: 200 }, () => Array(10).fill(null));
    for (let y = 200 - height; y < 200; y++) board[y][3] = { type: 'T', color: '#ff00aa' };
    return { board, maxRows: 1000, boardVersion: 1 };
}

function mounted() {
    const host = element('div');
    const map = new InfinityMinimap({ container: host });
    map.show();
    return {
        map, host, canvas: map.canvas, ctx: map.canvas.context,
    };
}

/** Lays the canvas out at another height (the window changes, so it is measured again). */
function canvasHeight(map, height) {
    map.canvas.clientHeight = height;
    window.innerHeight += 1;
}

function update(map, gameState, cameraRow, visibleRows = 20) {
    now += 20;
    map.update(gameState, cameraRow, visibleRows);
}

describe('Infinity tower map', () => {
    it('draws the build one pixel per cell, framing the rows on screen, at its laid-out size', () => {
        const { map, canvas, ctx } = mounted();
        const gs = state(30);
        update(map, gs, 170);
        // The backing store follows the laid-out size.
        expect([canvas.width, canvas.height]).toEqual([80, 400]);
        // The build image: 10 columns × the rows shown, cells in their colour.
        const build = created.find((el) => el.tagName === 'CANVAS' && el !== canvas);
        const image = build.context.putImageData.mock.calls[0][0];
        expect([image.width, image.height]).toEqual([10, map._build.span]);
        const floorRow = (map._build.span - 1) * 10 * 4;
        expect(Array.from(image.data.slice(floorRow + 12, floorRow + 16))).toEqual([255, 0, 170, 255]);
        expect(image.data[floorRow + 3]).toBe(0);
        // Drawn beside the rail in whole-pixel square cells, on the floor, without smoothing:
        // 80 px wide, less a 6 px rail and a 5 px gap, fits ten 6 px cells (centred);
        // 400 px tall fits 66 rows of them, so the 30-row build has sky above it.
        const drawn = ctx.drawImage.mock.calls[0];
        expect(drawn).toEqual([build, 0, 0, 10, 66, 15, 4, 60, 396]);
        expect(ctx.imageSmoothingEnabled).toBe(false);
        // The rows on screen are framed.
        expect(ctx.strokeRect).toHaveBeenCalledTimes(1);
    });

    it('keeps cells square: a young tower as wide as the map, a tall one narrower', () => {
        const { map, ctx } = mounted();
        /** The last cell size drawn, after checking it is square. */
        const cell = () => {
            const [, , , cols, rows, , , width, height] = ctx.drawImage.mock.calls.at(-1);
            expect(width / cols).toBe(height / rows);
            return width / cols;
        };
        update(map, state(5), 180);
        expect([cell(), map._build.span]).toEqual([6, 66]);
        // 60 rows and their sky need 90 rows: 4 px cells, the tower 40 px wide.
        update(map, state(60), 180);
        expect([cell(), map._build.span]).toEqual([4, 100]);
        const [, , , , , x] = ctx.drawImage.mock.calls.at(-1);
        expect(x).toBe(11 + Math.floor((69 - 40) / 2));
        // Looking far above the summit zooms out to keep the camera's rows in view.
        update(map, state(60), 10);
        expect([cell(), map._build.span]).toEqual([2, 200]);
        // Smaller than a pixel, cells are blended rather than dropped.
        canvasHeight(map, 150);
        update(map, state(60), 10);
        expect(cell()).toBeCloseTo(150 / 190);
        expect(ctx.imageSmoothingEnabled).toBe(true);
    });

    it('marks the summit in gold, and an empty board has none', () => {
        const { map, ctx } = mounted();
        const gold = () => ctx.calls.filter((call) => call.method === 'fillRect'
            && call.fillStyle === 'rgba(255, 209, 128, 0.95)');
        update(map, state(0), 180);
        expect(map._build.topRow).toBe(200);
        expect(gold()).toHaveLength(0);
        update(map, state(30), 170);
        // A line over the summit's row (row 170 sits at 4 + 36 × 6 px).
        expect(gold().map((call) => call.args)).toEqual([[15, 4 + 36 * 6 - 1, 60, 1]]);
    });

    it('repaints the build only when the board changes; camera moves redraw the frame alone', () => {
        const { map, ctx } = mounted();
        const gs = state(30);
        update(map, gs, 170);
        const paint = vi.spyOn(map, '_paintBuild');
        update(map, gs, 165);
        expect(paint).not.toHaveBeenCalled();
        expect(ctx.strokeRect).toHaveBeenCalledTimes(2);
        gs.board[169][4] = { type: 'O', color: '#ffff00' };
        gs.boardVersion += 1;
        update(map, gs, 165);
        expect(paint).toHaveBeenCalledTimes(1);
        gs.board = gs.board.map((row) => [...row]);
        update(map, gs, 165);
        expect(paint).toHaveBeenCalledTimes(2);
    });

    it('skips frames where nothing it shows has changed', () => {
        const { map, ctx } = mounted();
        const gs = state(30);
        update(map, gs, 170);
        const calls = ctx.calls.length;
        for (let i = 0; i < 30; i++) update(map, gs, 170);
        expect(ctx.calls.length).toBe(calls);
        // Throttled to ~60 Hz: an update within 16 ms is ignored.
        map.update(gs, 160, 20);
        expect(ctx.calls.length).toBe(calls);
    });

    it('keeps the latest state while hidden and draws it on showing', () => {
        const { map, ctx } = mounted();
        map.hide();
        update(map, state(30), 170);
        expect(ctx.clearRect).not.toHaveBeenCalled();
        map.show();
        expect(ctx.clearRect).toHaveBeenCalledTimes(1);
    });

    it('maps a point on the map to the board row under it', () => {
        const { map } = mounted();
        update(map, state(30), 170);
        // Rows 134–199 in 6 px cells, from 4 px down; above them, the first row shown.
        expect(map._getRowFromY(0, 400)).toBe(134);
        expect(map._getRowFromY(4 + 36 * 6 + 5, 400)).toBe(170);
        expect(map._getRowFromY(400, 400)).toBe(199);
        // In CSS pixels when the backing store is denser.
        expect(map._getRowFromY((4 + 36 * 6 + 5) / 2, 200)).toBe(170);
    });

    it('drops the well floor while the camera is above the ground', () => {
        const { map, host } = mounted();
        host.toggleAttribute = vi.fn();
        host.removeAttribute = vi.fn();
        const gs = state(30);
        update(map, gs, 120);
        expect(host.toggleAttribute).toHaveBeenLastCalledWith('data-off-floor', true);
        update(map, gs, 180);
        expect(host.toggleAttribute).toHaveBeenLastCalledWith('data-off-floor', false);
        // Still on the ground: left alone.
        update(map, gs, 170, 30);
        expect(host.toggleAttribute).toHaveBeenCalledTimes(2);
        map.destroy();
        expect(host.removeAttribute).toHaveBeenCalledWith('data-off-floor');
    });

    it('turns a drag into exploration events and lets go of the window on release', () => {
        const { map, canvas } = mounted();
        update(map, state(100), 180);
        canvas.listeners.get('pointerdown')({ preventDefault: vi.fn(), clientY: 300 });
        const types = map.container.dispatched.map((event) => event.type);
        expect(types).toEqual(['minimap-exploration-start', 'minimap-jump']);
        expect(map.container.dispatched[1].detail.targetRow).toBe(map._getRowFromY(200, 400));
        windowListeners.get('pointermove')({ clientY: 140 });
        expect(map.container.dispatched.at(-1).detail.targetRow).toBe(map._getRowFromY(40, 400));
        windowListeners.get('pointerup')();
        expect(map.container.dispatched.at(-1).type).toBe('minimap-exploration-end');
        expect(windowListeners.size).toBe(0);
        map.onPause();
        expect(map.container.classList.contains('is-explorable')).toBe(true);
        map.onUnpause();
        expect(map.container.classList.contains('is-explorable')).toBe(false);
        map.destroy();
        expect(map.container.parentElement).toBe(null);
    });
});
