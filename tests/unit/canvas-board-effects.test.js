/**
 * An opponent's tile in online versus speaks the Phaser boards' language at tile size
 * (docs/MENU_UI_OVERHAUL_2026-10.md §5.8): light added in the event's tone, never a
 * flat wash; a cascade counted wave by wave; the clean canvas named by the move that
 * made it, once; words, never emoji.
 */
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { CanvasBoardEffects } from '../../src/ui/effects/canvas-board-effects.js';
import { TONE } from '../../src/rendering/phaser/fx/fx-kit.js';

const EMOJI = /\p{Extended_Pictographic}/u;

function makeElement(tag) {
    const el = {
        tag,
        children: [],
        style: { setProperty(name, value) { this[name] = value; } },
        className: '',
        textContent: '',
        parentElement: null,
        appendChild(child) { child.parentElement = el; el.children.push(child); return child; },
        remove() {
            const parent = el.parentElement;
            if (parent) parent.children.splice(parent.children.indexOf(el), 1);
            el.parentElement = null;
        },
        querySelectorAll(selector) {
            const cls = selector.replace(/^\./, '');
            const out = [];
            const walk = (node) => node.children.forEach((c) => {
                if (String(c.className).split(' ').includes(cls)) out.push(c);
                walk(c);
            });
            walk(el);
            return out;
        },
        set innerHTML(v) { if (v === '') el.children.splice(0); },
        get innerHTML() { return ''; },
    };
    const classes = new Set();
    el.classList = {
        add: (c) => classes.add(c),
        remove: (c) => classes.delete(c),
        contains: (c) => classes.has(c),
    };
    if (tag === 'canvas') el.getContext = () => makeCtx();
    return el;
}

function makeCtx() {
    const gradients = [];
    const ctx = {
        gradients,
        fills: [],
        strokes: 0,
        globalCompositeOperation: 'source-over',
        save: vi.fn(),
        restore: vi.fn(),
        clearRect: vi.fn(),
        beginPath: vi.fn(),
        arc: vi.fn(),
        fill: vi.fn(),
        stroke: vi.fn(() => { ctx.strokes += 1; }),
        fillRect: vi.fn((x, y, w, h) => {
            ctx.fills.push({
                style: ctx.fillStyle, op: ctx.globalCompositeOperation, x, y, w, h,
            });
        }),
    };
    const gradient = (kind) => () => {
        const g = { kind, stops: [], addColorStop(o, c) { g.stops.push([o, c]); } };
        gradients.push(g);
        return g;
    };
    ctx.createLinearGradient = vi.fn(gradient('linear'));
    ctx.createRadialGradient = vi.fn(gradient('radial'));
    return ctx;
}

const callouts = (fx) => fx.textLayer.querySelectorAll('.sb-tile-callout');
const calloutText = (el) => el.children.map((c) => c.textContent);

let now = 0;
let frames = [];

function makeFx(opts = {}) {
    const container = makeElement('div');
    const baseCanvas = makeElement('canvas');
    return new CanvasBoardEffects(container, {
        width: 200, height: 400, blockSize: 20, baseCanvas, ...opts,
    });
}

/** Runs the tile's loop for `ms` of frames. */
function run(fx, ms, step = 16) {
    for (let t = 0; t < ms; t += step) {
        now += step;
        const pending = frames;
        frames = [];
        pending.forEach((cb) => cb(now));
    }
}

beforeEach(() => {
    now = 1000;
    frames = [];
    vi.useFakeTimers();
    vi.stubGlobal('document', { createElement: (tag) => makeElement(tag) });
    vi.stubGlobal('getComputedStyle', () => ({ position: 'relative' }));
    vi.stubGlobal('requestAnimationFrame', (cb) => { frames.push(cb); return frames.length; });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    vi.stubGlobal('performance', { now: () => now });
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('opponent tile: a clear is light', () => {
    it('lights a run of rows as one slab with a blade, added, never a flat fill', () => {
        const fx = makeFx();
        fx.triggerLineClearFlash([20, 21, 22, 23], 4);
        const slabs = fx.lights.filter((l) => l.kind === 'slab');
        expect(slabs).toHaveLength(1);
        expect(fx.lights.filter((l) => l.kind === 'blade')).toHaveLength(1);
        expect(fx.lights.some((l) => l.kind === 'bloom' && l.color === TONE.GOLD)).toBe(true);

        run(fx, 64);
        expect(fx.ctx.fills.length).toBeGreaterThan(0);
        fx.ctx.fills.forEach((fill) => {
            expect(fill.op).toBe('lighter');
            expect(typeof fill.style).toBe('object');
        });
    });

    it('two separate runs are two slabs', () => {
        const fx = makeFx();
        fx.triggerLineClearFlash([18, 19, 22], 3);
        expect(fx.lights.filter((l) => l.kind === 'slab')).toHaveLength(2);
    });

    it('a ring is a soft band of light, not a stroked circle', () => {
        const fx = makeFx();
        fx.triggerCascadeWave(3);
        run(fx, 80);
        expect(fx.ctx.strokes).toBe(0);
        expect(fx.ctx.gradients.some((g) => g.kind === 'radial')).toBe(true);
    });

    it('a lock is quiet on the tile (the board shows it)', () => {
        const fx = makeFx();
        fx.triggerPieceLockPulse('#ffffff');
        expect(fx.lights).toHaveLength(0);
    });

    it('a hard drop pools light where it struck', () => {
        const fx = makeFx();
        fx.triggerLanding(60, 380, 60, '#9ee8ed');
        const bloom = fx.lights.find((l) => l.kind === 'bloom');
        expect(bloom).toMatchObject({ x: 90, y: 380 });
        expect(fx.lights.find((l) => l.kind === 'blade')).toMatchObject({ x: 90, y: 380 });
    });
});

describe('opponent tile: the move (Quadra\'s combo)', () => {
    it('counts each wave in the chain\'s tone, in words', () => {
        const fx = makeFx();
        fx.triggerCombo(2);
        const [first] = callouts(fx);
        expect(calloutText(first)).toEqual(['2', 'Combo']);
        expect(first.style['--tone']).toBe('#9ee8ed');
        fx.triggerCombo(4);
        const shown = callouts(fx);
        expect(shown).toHaveLength(1);
        expect(calloutText(shown[0])).toEqual(['4', 'Combo']);
        expect(shown[0].style['--tone']).toBe('#f3d28d');
    });

    it('a lock\'s own clear starts a new move: the old chain no longer tints it', () => {
        const fx = makeFx();
        fx.triggerLineClearFlash([23], 1, '#fff', 1);
        fx.triggerLineClearFlash([23], 2, '#fff', 2);
        fx.triggerLineClearFlash([23], 1, '#fff', 3);
        expect(fx.chainCount).toBe(3);
        expect(fx.moveLines).toBe(4);
        fx.triggerLineClearFlash([23], 1, '#fff', 1);
        expect(fx.chainCount).toBe(0);
        expect(fx.moveLines).toBe(1);
    });

    it('names a cascade\'s clean canvas by its waves and lines', () => {
        const fx = makeFx();
        [[1, 2], [2, 1], [3, 1], [4, 2]].forEach(([wave, lines]) => {
            fx.triggerLineClearFlash([23], lines, '#fff', wave);
        });
        fx.triggerPerfectClear(0);
        const [card] = callouts(fx);
        expect(calloutText(card)).toEqual(['Combo ×4 · 6 lines', 'Clean canvas']);
        expect(fx.lights.some((l) => l.kind === 'rise' && l.color === TONE.GOLD)).toBe(true);
    });

    it('a single clear\'s clean canvas is a perfect clear', () => {
        const fx = makeFx();
        fx.triggerLineClearFlash([22, 23], 2, '#fff', 1);
        fx.triggerPerfectClear(2);
        expect(calloutText(callouts(fx)[0])).toEqual(['Perfect clear', 'Clean canvas']);
    });

    it('lands as the emptying wave\'s rows go, and only once per move', () => {
        const fx = makeFx();
        fx.triggerLineClearFlash([23], 1, '#fff', 1);
        fx.triggerPerfectClear(0, '#fff', 200);
        expect(callouts(fx)).toHaveLength(0);
        // The host hears it again from physics: already said.
        fx.triggerPerfectClear(1);
        vi.advanceTimersByTime(200);
        expect(callouts(fx)).toHaveLength(1);
        expect(fx.lights.filter((l) => l.kind === 'rise')).toHaveLength(1);
    });

    it('a reset cancels a clean canvas still on its way', () => {
        const fx = makeFx();
        fx.triggerPerfectClear(0, '#fff', 200);
        fx.clearAll();
        vi.advanceTimersByTime(400);
        expect(callouts(fx)).toHaveLength(0);
        expect(fx.lights).toHaveLength(0);
    });

    it('never puts an emoji on the tile', () => {
        const fx = makeFx();
        fx.triggerCombo(12);
        fx.triggerLineClearFlash([23], 1, '#fff', 12);
        fx.triggerPerfectClear(9);
        const words = callouts(fx).flatMap(calloutText).concat(
            fx.textLayer.children.flatMap((c) => calloutText(c)),
        );
        expect(words.length).toBeGreaterThan(0);
        words.forEach((word) => expect(EMOJI.test(word)).toBe(false));
    });
});

describe('opponent tile: out', () => {
    it('drains the board to grey under the card, with no red wash', () => {
        const fx = makeFx();
        fx.setDeadState(true);
        expect(fx.baseCanvas.style.filter).toContain('grayscale(100%)');
        expect(fx.lights).toHaveLength(0);
        fx.setDeadState(false);
        expect(fx.baseCanvas.style.filter).toBe('none');
        expect(fx.baseCanvas.style.opacity).toBe('1');
    });
});

describe('opponent tile: the match won', () => {
    it('rises in gold and the winner\'s colour, then opens shells of motes over the well', () => {
        const fx = makeFx();
        fx.triggerVictory('#22d3ee');
        expect(fx.lights.map((l) => l.kind)).toEqual(['rise', 'bloom']);
        expect(fx.particles).toHaveLength(0);

        vi.advanceTimersByTime(1300);
        expect(fx.lights.filter((l) => l.kind === 'ring')).toHaveLength(5);
        expect(fx.particles.length).toBeGreaterThan(0);
        run(fx, 64);
        expect(fx.ctx.fills.length).toBeGreaterThan(0);
        fx.ctx.fills.forEach((fill) => expect(fill.op).toBe('lighter'));
        expect(fx.ctx.strokes).toBe(0);
    });

    it('keeps the light alone with reduced motion', () => {
        vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) });
        const fx = makeFx();
        fx.triggerVictory('#22d3ee');
        vi.advanceTimersByTime(2000);
        expect(fx.lights.map((l) => l.kind)).toEqual(['rise', 'bloom']);
        expect(fx.particles).toHaveLength(0);
    });

    it('a reset cancels shells still on their way', () => {
        const fx = makeFx();
        fx.triggerVictory();
        fx.clearAll();
        vi.advanceTimersByTime(2000);
        expect(fx.lights).toHaveLength(0);
        expect(fx.particles).toHaveLength(0);
    });
});
