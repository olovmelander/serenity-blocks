import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { InfinityMinimap } from '../../src/ui/infinity/InfinityMinimap.js';
import { calculateTopRow } from '../../src/core/infinity-grid.js';

function recordingContext() {
    const operations = [];
    const methods = [
        'clearRect', 'fillRect', 'strokeRect', 'beginPath', 'moveTo', 'lineTo',
        'closePath', 'arc', 'fill', 'stroke', 'fillText', 'drawImage',
    ];
    const context = { operations };
    methods.forEach((method) => {
        context[method] = vi.fn((...args) => operations.push({
            method, args, strokeStyle: context.strokeStyle, shadowBlur: context.shadowBlur,
        }));
    });
    context.createLinearGradient = vi.fn((...args) => {
        const gradient = { args, stops: [], addColorStop(offset, color) { this.stops.push([offset, color]); } };
        operations.push({ method: 'createLinearGradient', args });
        return gradient;
    });
    return context;
}

function harness() {
    vi.spyOn(InfinityMinimap.prototype, '_initialize').mockImplementation(function initialize() {
        this.canvas = {
            width: 156, height: 358, style: {}, removeEventListener: vi.fn(),
        };
        this.ctx = recordingContext();
        this.container = {
            style: { display: 'block' },
            classList: { contains: () => false, remove: vi.fn() },
            removeEventListener: vi.fn(),
        };
    });
    const canvases = [];
    vi.stubGlobal('document', {
        createElement: vi.fn(() => {
            const canvas = { ctx: recordingContext(), getContext() { return this.ctx; } };
            canvases.push(canvas);
            return canvas;
        }),
        getElementById: () => null,
    });
    vi.stubGlobal('window', { removeEventListener: vi.fn() });
    const minimap = new InfinityMinimap();
    const state = { board: Array.from({ length: 1000 }, () => Array(10).fill(null)), maxRows: 1000, lockedPieces: [] };
    return { minimap, state, canvases };
}

let now;
beforeEach(() => {
    now = 20;
    vi.useFakeTimers();
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

function update(minimap, state, cameraRow = 980, visibleRows = 20) {
    now += 20;
    minimap.update(state, cameraRow, visibleRows);
}

describe('Infinity minimap static layers and live animation', () => {
    it('rasterizes static work once while keeping 60 scanline and viewport animation updates', () => {
        const { minimap, state, canvases } = harness();
        const texture = vi.spyOn(minimap, '_drawBackgroundTexture');
        const details = vi.spyOn(minimap, '_drawCRTTexture');
        const layouts = vi.spyOn(minimap, '_buildMilestones');
        const build = vi.spyOn(minimap, '_drawBuild');
        const scanline = vi.spyOn(minimap, '_drawScanlineEffect');
        const viewport = vi.spyOn(minimap, '_drawViewport');
        const colors = vi.spyOn(minimap, '_getBorderColor');
        for (let frame = 0; frame < 60; frame++) {
            vi.setSystemTime(frame * 20);
            update(minimap, state);
        }
        expect(texture).toHaveBeenCalledOnce();
        expect(details).toHaveBeenCalledOnce();
        expect(layouts).toHaveBeenCalledOnce();
        expect(build).toHaveBeenCalledTimes(60);
        expect(scanline).toHaveBeenCalledTimes(60);
        expect(viewport).toHaveBeenCalledTimes(60);
        expect(colors).toHaveBeenCalledOnce();
        expect(canvases).toHaveLength(2);
        expect(minimap.ctx.drawImage).toHaveBeenCalledTimes(120);
        expect(minimap.ctx.createLinearGradient).toHaveBeenCalledTimes(61);
        expect(canvases[0].ctx.arc).toHaveBeenCalledTimes(348);
        expect(minimap.ctx.fillText).toHaveBeenCalledTimes(480);
        const scans = minimap.ctx.operations.filter(({ method }) => method === 'createLinearGradient');
        expect(scans[0].args).not.toEqual(scans.at(-1).args);
        const borders = minimap.ctx.strokeRect.mock.calls;
        expect(borders).toHaveLength(120);
        const pulseStyles = minimap.ctx.operations.filter(
            ({ method, args }) => method === 'strokeRect' && args[0] === 0,
        );
        expect(new Set(pulseStyles.map(({ strokeStyle }) => strokeStyle)).size).toBeGreaterThan(1);
    });

    it('keeps original background, scanline, CRT/build, viewport, top-marker ordering', () => {
        const { minimap, state } = harness();
        const order = [];
        const orderedLayers = [
            '_getBackgroundLayer', '_drawScanlineEffect', '_getCRTLayer', '_drawMilestones',
            '_drawRowLabels', '_drawBuild', '_drawViewport', '_drawTopRowIndicator',
        ];
        orderedLayers.forEach((method) => {
            const implementation = minimap[method];
            vi.spyOn(minimap, method).mockImplementation(function record(...args) {
                order.push(method);
                return implementation.apply(this, args);
            });
        });
        update(minimap, state);
        expect(order).toEqual(orderedLayers);
        const methods = minimap.ctx.operations.map(({ method }) => method);
        expect(methods.indexOf('drawImage')).toBeLessThan(methods.indexOf('createLinearGradient'));
        expect(methods.lastIndexOf('drawImage')).toBeGreaterThan(methods.indexOf('createLinearGradient'));
    });

    it('updates moving/fractional and resized viewports without rerasterizing static content', () => {
        const { minimap, state } = harness();
        update(minimap, state);
        const details = minimap.crtLayer;
        update(minimap, state, 430.5, 30);
        expect(minimap.crtLayer).toBe(details);
        expect(minimap.ctx.createLinearGradient).toHaveBeenCalledTimes(3);
        expect(minimap.ctx.strokeRect).toHaveBeenLastCalledWith(0, (430.5 * 358) / 1000, 156, (30 * 358) / 1000);
    });

    it('invalidates build and border on in-place cell changes with unchanged locked-piece count', () => {
        const { minimap, state } = harness();
        update(minimap, state);
        const originalColor = minimap.container.style.borderColor;
        state.board[400][3] = { color: '#123456' };
        update(minimap, state);
        expect(minimap.buildFill.topY).toBe((400 * 358) / 1000);
        expect(minimap.container.style.borderColor).not.toBe(originalColor);
        expect(minimap.ctx.createLinearGradient).toHaveBeenCalledTimes(4);
        state.board[400][3] = null;
        state.board[800][2] = { color: '#fff' };
        update(minimap, state);
        expect(minimap.buildFill.topY).toBe((800 * 358) / 1000);
        expect(minimap.ctx.createLinearGradient).toHaveBeenCalledTimes(6);
        expect(state.lockedPieces).toHaveLength(0);
    });

    it('invalidates scale, board identity, row offset and canvas geometry', () => {
        const { minimap, state, canvases } = harness();
        state.board[400][3] = { color: '#fff' };
        update(minimap, state);
        const background = minimap.backgroundLayer;
        const details = minimap.crtLayer;
        state.board = state.board.map((row) => [...row]);
        update(minimap, state);
        expect(minimap.crtLayer).toBe(details);
        expect(minimap.backgroundLayer).toBe(background);
        state.maxRows = 800;
        state.board = state.board.slice(200);
        update(minimap, state);
        expect(minimap.labelLayout.maxRows).toBe(800);
        expect(minimap.buildFill.topY).toBe((200 * 358) / 800);
        expect(minimap.milestones).toEqual([200, 400, 600, 800]);
        state.board.unshift(Array(10).fill(null));
        update(minimap, state);
        expect(minimap.buildFill.topY).toBe((201 * 358) / 800);
        minimap.canvas.width = 200;
        minimap.canvas.height = 500;
        update(minimap, state);
        expect(minimap.backgroundLayer).not.toBe(background);
        expect(minimap.crtLayer).not.toBe(details);
        expect(canvases).toHaveLength(4);
        expect(minimap.backgroundLayer.canvas.width).toBe(200);
        expect(minimap.crtLayer.canvas.height).toBe(500);
    });

    it('skips hidden rasterization and catches up to the latest model on showing', () => {
        const { minimap, state } = harness();
        update(minimap, state);
        const clearCalls = minimap.ctx.clearRect.mock.calls.length;
        minimap.container.style.display = 'none';
        state.board[123][1] = { color: '#fff' };
        update(minimap, state, 115, 30);
        expect(minimap.ctx.clearRect).toHaveBeenCalledTimes(clearCalls);
        expect(minimap.cameraRow).toBe(115);
        minimap.show();
        expect(minimap.buildFill.topY).toBe((123 * 358) / 1000);
        expect(minimap.ctx.clearRect).toHaveBeenCalledTimes(clearCalls + 1);
    });

    it('preserves 16ms throttling and scans top row only once per admitted update', () => {
        const { minimap, state } = harness();
        const cellRead = vi.fn(() => ({ color: '#fff' }));
        Object.defineProperty(state.board[0], '0', { get: cellRead });
        update(minimap, state);
        expect(cellRead).toHaveBeenCalledOnce();
        now += 15;
        minimap.update(state, 1, 20);
        expect(cellRead).toHaveBeenCalledOnce();
        now += 1;
        minimap.update(state, 1, 20);
        expect(cellRead).toHaveBeenCalledTimes(2);
        expect(minimap.ctx.clearRect).toHaveBeenCalledTimes(2);
    });

    it('does not let a retired hide timer hide a newly shown minimap', () => {
        const { minimap, state } = harness();
        update(minimap, state);
        minimap.hide();
        minimap.show();
        vi.advanceTimersByTime(400);
        expect(minimap.container.style.display).toBe('block');
        minimap.destroy();
        expect(minimap.backgroundLayer).toBeNull();
        expect(minimap.crtLayer).toBeNull();
        expect(minimap.labelLayout).toBeNull();
        expect(minimap.buildFill).toBeNull();
        expect(minimap.hideTimeout).toBeNull();
    });
});

describe('Infinity top-row short circuit', () => {
    it('returns the first occupied row without reading later cells', () => {
        const laterCell = vi.fn(() => ({ color: '#fff' }));
        const lowerRow = [null];
        Object.defineProperty(lowerRow, '0', { get: laterCell });
        expect(calculateTopRow({ board: [[null], [{ color: '#fff' }], lowerRow] })).toBe(1);
        expect(laterCell).not.toHaveBeenCalled();
    });

    it('preserves missing, empty, boardGrid fallback and non-null cell conventions', () => {
        expect(calculateTopRow(null)).toBe(0);
        expect(calculateTopRow({})).toBe(0);
        expect(calculateTopRow({ board: [] })).toBe(-1);
        expect(calculateTopRow({ board: [[null], [null]] })).toBe(1);
        expect(calculateTopRow({ boardGrid: [[null], [0]] })).toBe(1);
        expect(calculateTopRow({ board: [[undefined], [null]] })).toBe(0);
    });
});
