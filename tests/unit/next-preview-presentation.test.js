import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';

const shared = vi.hoisted(() => ({ draws: [], events: new Map(), configs: {}, managers: [], operations: [] }));
vi.mock('../../src/rendering/canvas/canvas-drawing-utils.js', async (importOriginal) => ({
    trimShape: (await importOriginal()).trimShape,
    drawPieceSolid: vi.fn((ctx, shape, x, y, size, style) => {
        shared.operations.push('draw');
        shared.draws.push({ ctx, shape, x, y, size, style });
    }),
}));
vi.mock('../../src/events/event-bus.js', () => ({
    EVENTS: { THEME_CHANGED: 'theme', VIEWPORT_RESIZED: 'resize' },
    eventBus: { on: (type, callback) => {
        shared.events.set(type, callback);
        return () => shared.events.delete(type);
    } },
}));
vi.mock('../../src/rendering/tetromino-style-manager.js', () => ({
    TetrominoStyleManager: class {
        constructor(theme, settings, onChange) {
            this.onChange = onChange;
            this.destroy = vi.fn();
            shared.managers.push(this);
        }

        init() { this.onChange?.(); }

        refresh() { this.onChange?.(); }

        getStyleForPiece(key) {
            return shared.configs[key] || {
                color: `color-${key}`, renderMode: 'solid', effects: shared.effects, rendererOverrides: shared.overrides,
            };
        }
    },
}));

let counts;
let elements;
let handlers;
let frames;
let observers;
class Element {
    constructor(tag = 'div') {
        this.tagName = tag;
        this.children = [];
        this.parentNode = null;
        this.style = {};
        this.events = new Map();
        this.names = new Set();
        this.size = { width: 72, height: 72 };
        this.classList = {
            add: (...names) => names.forEach((name) => this.names.add(name)),
            remove: (...names) => names.forEach((name) => this.names.delete(name)),
            contains: (name) => this.names.has(name),
            toggle: (name, active) => {
                if (active) this.names.add(name);
                else this.names.delete(name);
            },
        };
    }

    set className(value) { this.names = new Set(value.split(' ').filter(Boolean)); }

    get className() { return [...this.names].join(' '); }

    set innerHTML(value) {
        counts.clear += 1;
        this.children.forEach((child) => { child.parentNode = null; });
        this.children = [];
    }

    appendChild(child) {
        counts.append += 1;
        if (child.tagName === 'fragment') {
            child.children.forEach((item) => { item.parentNode = this; this.children.push(item); });
            child.children = [];
        } else {
            child.parentNode = this;
            this.children.push(child);
        }
        return child;
    }

    get clientWidth() { counts.reads += 1; shared.operations.push('read'); return this.size.width; }

    get clientHeight() { counts.reads += 1; shared.operations.push('read'); return this.size.height; }

    addEventListener(type, handler) { this.events.set(type, handler); }
}
class Canvas extends Element {
    constructor() {
        super('canvas');
        this.width = 300;
        this.height = 150;
        this.context = {
            save: vi.fn(), restore: vi.fn(), setTransform: vi.fn(),
            clearRect: vi.fn(() => shared.operations.push('clear')),
        };
    }

    closest() { return this.parentNode; }

    getContext() { return this.context; }
}

beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    counts = { created: 0, canvases: 0, reads: 0, clear: 0, append: 0 };
    elements = new Map();
    handlers = new Map();
    frames = new Map();
    observers = [];
    shared.draws = [];
    shared.events.clear();
    shared.configs = {};
    shared.managers = [];
    shared.operations = [];
    shared.effects = {};
    shared.overrides = {};
    vi.stubGlobal('HTMLCanvasElement', Canvas);
    vi.stubGlobal('window', {
        themeManager: {}, settingsManager: {}, devicePixelRatio: 1,
        addEventListener: (type, callback) => handlers.set(type, callback),
        removeEventListener: (type) => handlers.delete(type),
    });
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback) => {
        const id = frames.size + 1;
        frames.set(id, callback);
        return id;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn((id) => frames.delete(id)));
    vi.stubGlobal('ResizeObserver', class {
        constructor(callback) {
            this.callback = callback;
            this.targets = new Set();
            this.disconnect = vi.fn(() => this.targets.clear());
            this.unobserve = vi.fn((target) => this.targets.delete(target));
            observers.push(this);
        }

        observe(target) { this.targets.add(target); }
    });
    vi.stubGlobal('document', {
        getElementById: (id) => elements.get(id),
        createDocumentFragment: () => new Element('fragment'),
        createElement: (tag) => {
            counts.created += 1;
            if (tag === 'canvas') { counts.canvases += 1; return new Canvas(); }
            return new Element(tag);
        },
    });
});
afterEach(() => {
    handlers.get('beforeunload')?.();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});
function queue(id = 'next-queue-container') {
    const container = new Element();
    elements.set(id, container);
    return container;
}
function flushFrames() {
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach((callback) => callback());
}

describe('retained next queue presentation', () => {
    it('keeps three ordered canvases and avoids equivalent refresh work', async () => {
        const { updateNextQueue } = await import('../../src/ui/next-queue-ui.js');
        const container = queue();
        for (let i = 0; i < 60; i++) updateNextQueue(['T', 'I', 'O']);
        expect(counts.canvases).toBe(3);
        expect(counts.created).toBe(6);
        expect(counts.clear).toBe(1);
        expect(counts.reads).toBe(6);
        expect(shared.draws).toHaveLength(3);
        expect(container.children[0].classList.contains('highlight')).toBe(true);
        expect(container.children.slice(1).every((slot) => !slot.classList.contains('highlight'))).toBe(true);
        const canvases = container.children.map((slot) => slot.children[0]);
        updateNextQueue(['T', 'Z', 'O']);
        expect(shared.draws).toHaveLength(4);
        expect(container.children.map((slot) => slot.children[0])).toEqual(canvases);
        expect(shared.draws[1].shape).toEqual([[1, 1, 1, 1]]);
        expect(shared.draws[1].size).toBe(10);
    });

    it('measures all slots before touching any canvas', async () => {
        const { updateNextQueue } = await import('../../src/ui/next-queue-ui.js');
        queue();
        updateNextQueue(['T', 'I', 'O']);
        expect(shared.operations.slice(0, 6)).toEqual(Array(6).fill('read'));
        expect(shared.operations.slice(6)).not.toContain('read');
    });

    it('owns each container model across theme and settings changes', async () => {
        const { updateNextQueue } = await import('../../src/ui/next-queue-ui.js');
        queue();
        queue('online-next-queue-container');
        updateNextQueue(['T', 'I', 'O']);
        updateNextQueue(['L', 'S', 'J'], 'online-next-queue-container');
        shared.draws = [];
        shared.events.get('theme')();
        expect(shared.draws.map((draw) => draw.style.color)).toEqual([
            'color-T', 'color-I', 'color-O', 'color-L', 'color-S', 'color-J',
        ]);
        shared.draws = [];
        handlers.get('settingsChanged')({ detail: { themeBasedTetrominos: false } });
        expect(shared.draws).toHaveLength(6);
        expect(counts.canvases).toBe(6);
    });

    it('redraws the actual resized owner and updates DPR without recreating slots', async () => {
        const { updateNextQueue } = await import('../../src/ui/next-queue-ui.js');
        const first = queue();
        const online = queue('online-next-queue-container');
        updateNextQueue(['T', 'I', 'O']);
        updateNextQueue(['L', 'S', 'J'], 'online-next-queue-container');
        const canvas = online.children[0].children[0];
        online.children[0].size = { width: 120, height: 90 };
        observers[0].callback([{ target: online.children[0] }]);
        flushFrames();
        expect(shared.draws).toHaveLength(7);
        expect(canvas.width).toBe(120);
        expect(canvas.height).toBe(90);
        expect(first.children[0].children[0].width).toBe(72);
        window.devicePixelRatio = 2;
        shared.events.get('resize')();
        flushFrames();
        expect(shared.draws).toHaveLength(13);
        expect(canvas.width).toBe(240);
        expect(canvas.height).toBe(180);
        expect(canvas.context.setTransform).toHaveBeenLastCalledWith(2, 0, 0, 2, 0, 0);
        expect(counts.canvases).toBe(6);
    });

    it('clears a newly empty slot once and restores the next piece', async () => {
        const { updateNextQueue } = await import('../../src/ui/next-queue-ui.js');
        const container = queue();
        updateNextQueue(['T', 'I', 'O']);
        const slot = container.children[2];
        const canvas = slot.children[0];
        updateNextQueue(['T', 'I']);
        updateNextQueue(['T', 'I']);
        expect(canvas.context.clearRect).toHaveBeenCalledTimes(2);
        expect(slot.classList.contains('empty')).toBe(true);
        updateNextQueue(['T', 'I', 'Z']);
        expect(slot.classList.contains('empty')).toBe(false);
        expect(shared.draws).toHaveLength(4);
    });

    it('retires detached owners and reconstructs externally replaced slots', async () => {
        const { updateNextQueue } = await import('../../src/ui/next-queue-ui.js');
        const container = queue();
        updateNextQueue(['T', 'I', 'O']);
        container.innerHTML = '';
        updateNextQueue(['T', 'I', 'O']);
        expect(counts.canvases).toBe(6);
        expect(observers[0].unobserve).toHaveBeenCalledTimes(3);
        elements.delete('next-queue-container');
        shared.events.get('theme')();
        expect(observers[0].unobserve).toHaveBeenCalledTimes(6);
        expect(shared.draws).toHaveLength(6);
    });

    it('retries initial style dependencies using both container models and owns teardown', async () => {
        window.themeManager = null;
        const { updateNextQueue } = await import('../../src/ui/next-queue-ui.js');
        queue();
        queue('online-next-queue-container');
        updateNextQueue(['T', 'I', 'O']);
        updateNextQueue(['L', 'S', 'J'], 'online-next-queue-container');
        expect(vi.getTimerCount()).toBe(1);
        window.themeManager = {};
        await vi.advanceTimersByTimeAsync(100);
        expect(shared.draws).toHaveLength(12);
        expect(shared.draws.slice(6).map((draw) => draw.style.color)).toEqual([
            'color-T', 'color-I', 'color-O', 'color-L', 'color-S', 'color-J',
        ]);
        shared.events.get('resize')();
        handlers.get('beforeunload')();
        expect(frames.size).toBe(0);
        expect(observers[0].disconnect).toHaveBeenCalledOnce();
        expect(shared.managers[0].destroy).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('still measures on each call when ResizeObserver is unavailable', async () => {
        vi.stubGlobal('ResizeObserver', undefined);
        const { updateNextQueue } = await import('../../src/ui/next-queue-ui.js');
        const container = queue();
        updateNextQueue(['T', 'I', 'O']);
        container.children[0].size.width = 90;
        updateNextQueue(['T', 'I', 'O']);
        expect(shared.draws).toHaveLength(4);
        expect(container.children[0].children[0].width).toBe(90);
    });

    it('repairs restored or externally redrawn canvas presentation with the retained queue model', async () => {
        const { updateNextQueue, drawPiece } = await import('../../src/ui/next-queue-ui.js');
        const container = queue();
        updateNextQueue(['T', 'I', 'O']);
        const canvas = container.children[1].children[0];
        canvas.events.get('contextrestored')();
        expect(shared.draws).toHaveLength(4);
        expect(shared.draws.at(-1).style.color).toBe('color-I');
        drawPiece(canvas, 'Z');
        updateNextQueue(['T', 'I', 'O']);
        expect(shared.draws).toHaveLength(6);
        expect(shared.draws.at(-1).style.color).toBe('color-I');
        canvas.width = 1;
        updateNextQueue(['T', 'I', 'O']);
        expect(canvas.width).toBe(72);
        expect(shared.draws).toHaveLength(7);
        drawPiece(canvas, 'Z');
        updateNextQueue(['T']);
        expect(canvas.context.clearRect).toHaveBeenLastCalledWith(0, 0, 72, 72);
        expect(container.children[1].classList.contains('empty')).toBe(true);
    });
});

describe('existing multiplayer preview canvases', () => {
    it('batches measurements and skips identical drawings while accepting real size and style changes', async () => {
        const { drawNextPieces } = await import('../../src/rendering/draw.js');
        const canvases = Array.from({ length: 3 }, () => {
            const slot = new Element();
            const canvas = new Canvas();
            slot.appendChild(canvas);
            return canvas;
        });
        drawNextPieces(canvases, ['T', 'I', 'O']);
        expect(shared.operations.slice(0, 6)).toEqual(Array(6).fill('read'));
        expect(shared.operations.slice(6)).not.toContain('read');
        drawNextPieces(canvases, ['T', 'I', 'O']);
        expect(shared.draws).toHaveLength(3);
        canvases[1].size.width = 100;
        drawNextPieces(canvases, ['T', 'I', 'O']);
        expect(shared.draws).toHaveLength(4);
        shared.configs.T = { color: '#fff', renderMode: 'solid', effects: shared.effects, rendererOverrides: shared.overrides };
        drawNextPieces(canvases, ['T', 'I', 'O']);
        expect(shared.draws).toHaveLength(5);
        shared.managers[0].refresh();
        drawNextPieces(canvases, ['T', 'I', 'O']);
        expect(shared.draws).toHaveLength(8);
        window.devicePixelRatio = 2;
        drawNextPieces(canvases, ['T', 'I', 'O']);
        expect(shared.draws).toHaveLength(11);
        expect(canvases[1].width).toBe(200);
    });

    it('fits and centres the piece itself in a wide tile, not its blank rotation rows', async () => {
        const { drawNextPieces } = await import('../../src/rendering/draw.js');
        const canvases = [new Canvas(), new Canvas()];
        canvases.forEach((canvas) => {
            new Element().appendChild(canvas);
            canvas.size = { width: 100, height: 60 };
        });
        drawNextPieces(canvases, ['I', 'T']);
        const [i, t] = shared.draws;
        // I: one row of four, 78.4 / 4 wide (padding 0.18 × 60); centred both ways.
        expect(i.shape).toEqual([[1, 1, 1, 1]]);
        expect(i.size).toBe(19);
        expect([i.x, i.y]).toEqual([12, 21]);
        // T: two rows of three; 33.6 / 2 high (padding 0.22 × 60); centred both ways.
        expect(t.shape).toEqual([[1, 1, 1], [0, 1, 0]]);
        expect(t.size).toBe(16);
        expect([t.x, t.y]).toEqual([26, 14]);
    });

    it('preserves time-varying glow pulses and only clears unchanged empty slots once', async () => {
        const { drawNextPieces } = await import('../../src/rendering/draw.js');
        const canvas = new Canvas();
        const slot = new Element();
        slot.appendChild(canvas);
        shared.configs.T = {
            color: '#fff', renderMode: 'glow', effects: { pulse: true }, rendererOverrides: { canvas: { outline: false } },
        };
        drawNextPieces([canvas], ['T']);
        drawNextPieces([canvas], ['T']);
        expect(shared.draws).toHaveLength(2);
        drawNextPieces([canvas], []);
        drawNextPieces([canvas], []);
        expect(canvas.context.clearRect).toHaveBeenCalledTimes(3);
        expect(slot.classList.contains('empty')).toBe(true);
    });

    it('restores the last displayed piece and its original secondary-slot padding after context restoration', async () => {
        const { drawNextPieces } = await import('../../src/rendering/draw.js');
        const canvases = [new Canvas(), new Canvas()];
        canvases.forEach((canvas) => new Element().appendChild(canvas));
        drawNextPieces(canvases, ['T', 'I']);
        const original = shared.draws[1];
        canvases[1].events.get('contextrestored')();
        expect(shared.draws).toHaveLength(3);
        expect(shared.draws[2].style.color).toBe('color-I');
        expect(shared.draws[2].size).toBe(original.size);
        expect(shared.draws[2].x).toBe(original.x);
        expect(shared.draws[2].y).toBe(original.y);
    });

    it('invalidates in-place outline, canvas override, glow and gradient stop edits', async () => {
        const { drawNextPieces } = await import('../../src/rendering/draw.js');
        const canvas = new Canvas();
        new Element().appendChild(canvas);
        const config = {
            color: '#abc', renderMode: 'solid', effects: { outline: true, outlineWidth: 1, outlineColor: '#fff' },
            rendererOverrides: { canvas: {} },
        };
        shared.configs.T = config;
        drawNextPieces([canvas], ['T']);
        config.effects.outlineColor = '#ff0';
        drawNextPieces([canvas], ['T']);
        config.rendererOverrides.canvas.outlineWidth = 2;
        drawNextPieces([canvas], ['T']);
        config.renderMode = 'glow';
        config.effects.glowRadius = 3;
        drawNextPieces([canvas], ['T']);
        config.effects.glowRadius = 5;
        drawNextPieces([canvas], ['T']);
        config.renderMode = 'gradient';
        config.effects.gradientStops = [{ offset: 0, color: '#fff', opacity: 0.5 }];
        drawNextPieces([canvas], ['T']);
        config.effects.gradientStops[0].opacity = 0.8;
        drawNextPieces([canvas], ['T']);
        expect(shared.draws).toHaveLength(7);
        drawNextPieces([canvas], ['T']);
        expect(shared.draws).toHaveLength(7);
    });
});
