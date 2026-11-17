/**
 * What the portal passage is made of (src/rendering/transitions/portal-gate-matter.js and the
 * gate that draws it): a character for each chapter, the destination's colours, a layout of its
 * own for every orb and visit, the world's light on the way back out, and the same small cost.
 */
import { describe, expect, it } from 'vitest';
import {
    PORTAL_GATE_COUNTS, createPortalGate, drawPortalGate, parseColor, passageTint, seededRandom,
} from '../../src/rendering/transitions/portal-gate.js';
import {
    DEFAULT_PASSAGE_KIND, PASSAGE_KINDS, bakeMatterSprite, bakeNebulaRing, bakeWallRing, resolvePassageKind,
} from '../../src/rendering/transitions/portal-gate-matter.js';
import { RETURN_WORLD_BLOOM, returnWorldBloom } from '../../src/rendering/transitions/JourneyReturnTransition.js';
import { createPortalGateWorkerCore } from '../../src/rendering/transitions/portal-gate-worker-core.js';
import { ODYSSEY_CHAPTER_LOOKS } from '../../src/core/odyssey/data/chapter-looks.js';

/** A 2D context that records what is drawn (the gate's whole API, with lines for the rims). */
function recordingContext() {
    const calls = [];
    const ctx = {
        calls,
        globalAlpha: 1,
        globalCompositeOperation: 'source-over',
        fillStyle: '#000',
        strokeStyle: '#000',
        lineWidth: 1,
        lineCap: 'butt',
        createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
        createRadialGradient: () => ({ addColorStop: () => {} }),
    };
    ['beginPath', 'arc', 'stroke', 'fill', 'rect', 'clip', 'save', 'restore', 'setTransform', 'clearRect',
        'putImageData', 'getImageData', 'fillRect', 'moveTo', 'lineTo'].forEach((name) => {
        ctx[name] = (...args) => calls.push({
            name, args, alpha: ctx.globalAlpha, op: ctx.globalCompositeOperation,
        });
    });
    ctx.drawImage = (image, ...args) => calls.push({
        name: 'drawImage', image, args, alpha: ctx.globalAlpha, op: ctx.globalCompositeOperation,
    });
    return ctx;
}

const recordingDocument = () => ({
    createElement: () => {
        const ctx = recordingContext();
        return {
            width: 0, height: 0, style: {}, ctx, getContext: () => ctx,
        };
    },
});

const GOLD = {
    primary: '#b58140', accent: '#d69b4f', highlight: '#febb61', shadow: '#523b2e',
};
const frame = (extra = {}) => ({
    width: 1600, height: 900, dpr: 1, travel: 1.3, time: 0.5, center: { x: 800, y: 450 }, region: { kind: 'all' }, ...extra,
});
const KINDS = Object.keys(PASSAGE_KINDS);

describe('the passage\'s kinds', () => {
    it('has one for each chapter of the journey and falls back to space\'s', () => {
        expect(KINDS).toHaveLength(8);
        expect(ODYSSEY_CHAPTER_LOOKS.map((look) => look.passage).sort()).toEqual([...KINDS].sort());
        expect(resolvePassageKind('petals')).toBe(PASSAGE_KINDS.petals);
        expect(resolvePassageKind('nonsense')).toBe(PASSAGE_KINDS[DEFAULT_PASSAGE_KIND]);
        expect(resolvePassageKind(undefined)).toBe(PASSAGE_KINDS.stars);
        // No two chapters share a wall or a rim.
        expect(new Set(KINDS.map((kind) => PASSAGE_KINDS[kind].wall)).size).toBe(8);
        expect(new Set(KINDS.map((kind) => PASSAGE_KINDS[kind].rim)).size).toBe(8);
    });

    it('bakes each wall once, the same every time: empty at the light ahead and the corners, drawn between', () => {
        const size = 48;
        const seen = new Set();
        for (const kind of KINDS) {
            const data = bakeWallRing(PASSAGE_KINDS[kind].wall, size);
            const alpha = (x, y) => data[(y * size + x) * 4 + 3];
            expect(alpha(24, 24), kind).toBe(0);
            expect(alpha(0, 0), kind).toBe(0);
            let ring = 0;
            for (let x = 0; x < size; x++) ring += alpha(x, 12);
            expect(ring, kind).toBeGreaterThan(0);
            expect(bakeWallRing(PASSAGE_KINDS[kind].wall, size)).toEqual(data);
            // Finite everywhere (a NaN alpha would be a hole in the wall).
            expect(data.every((value) => Number.isFinite(value))).toBe(true);
            seen.add(data.join(','));
        }
        expect(seen.size).toBe(8);
        // Space keeps the ring the gate was first drawn with.
        expect(bakeWallRing('dust', size)).toEqual(bakeNebulaRing(size));
        expect(bakeWallRing('unknown', size)).toEqual(bakeNebulaRing(size));
    });

    it('bakes the matter sprites as white light that fades out at their edges', () => {
        for (const name of ['bubble', 'petal', 'leaf', 'shard', 'fish', 'shaft']) {
            const sprite = bakeMatterSprite(name);
            expect(sprite.data).toHaveLength(sprite.width * sprite.height * 4);
            const alpha = (x, y) => sprite.data[(y * sprite.width + x) * 4 + 3];
            // Corners empty, something inside.
            expect(alpha(0, 0), name).toBe(0);
            expect(alpha(sprite.width - 1, sprite.height - 1), name).toBe(0);
            let total = 0;
            for (let i = 3; i < sprite.data.length; i += 4) total += sprite.data[i];
            expect(total, name).toBeGreaterThan(sprite.width * sprite.height * 2);
        }
        expect(bakeMatterSprite('no-such-sprite')).toBeNull();
    });
});

describe('one passage', () => {
    it('is laid out from its seed: the same seed the same passage, another seed another', () => {
        const look = (seed) => ({ kind: 'petals', seed, key: 0.5 });
        const a = createPortalGate({ palette: GOLD, look: look(11), documentRef: null });
        const again = createPortalGate({ palette: GOLD, look: look(11), documentRef: null });
        const b = createPortalGate({ palette: GOLD, look: look(12), documentRef: null });
        const layout = (gate) => JSON.stringify([gate.layers, gate.streaks, gate.matter, gate.swirl, gate.bend, gate.rimMarks]);
        expect(layout(again)).toBe(layout(a));
        expect(layout(b)).not.toBe(layout(a));
        expect(a.kindName).toBe('petals');
        expect(createPortalGate({ documentRef: null }).kindName).toBe('stars');
        // The generator itself: deterministic, in 0..1.
        const random = seededRandom(42);
        const values = Array.from({ length: 200 }, random);
        expect(values.every((value) => value >= 0 && value < 1)).toBe(true);
        expect(Array.from({ length: 200 }, seededRandom(42))).toEqual(values);
    });

    it('varies where it swirls, how it curves and how much it carries, within bounds', () => {
        const swirls = new Set();
        for (let seed = 1; seed <= 40; seed++) {
            const gate = createPortalGate({ palette: GOLD, look: { kind: 'snow', seed }, documentRef: null });
            swirls.add(Math.sign(gate.swirl));
            expect(Math.abs(gate.swirl)).toBeGreaterThanOrEqual(0.65);
            expect(Math.abs(gate.swirl)).toBeLessThanOrEqual(1.4);
            // The curve never carries the walls far off the light ahead.
            expect(gate.bend.amount).toBeLessThanOrEqual(0.07);
            expect(gate.matter.length).toBeGreaterThan(20);
        }
        expect(swirls.size).toBe(2);
    });

    it('costs what the gate cost: no more pieces than it had streaks, plus a handful', () => {
        for (const preset of Object.keys(PORTAL_GATE_COUNTS)) {
            const counts = PORTAL_GATE_COUNTS[preset];
            for (const kind of KINDS) {
                const gate = createPortalGate({
                    qualityPreset: preset, palette: GOLD, look: { kind, seed: 5 }, documentRef: null,
                });
                expect(gate.layers).toHaveLength(counts.layers);
                const flying = gate.streakCount + gate.matter.length;
                expect(flying, `${preset} ${kind}`).toBeLessThanOrEqual(counts.streaks * 1.75);
                expect(gate.shafts.length + (gate.school?.fish.length || 0)).toBeLessThanOrEqual(24);
            }
        }
    });

    it('draws every kind additively, with finite numbers, and puts the context back', () => {
        for (const kind of KINDS) {
            const gate = createPortalGate({
                palette: GOLD,
                look: {
                    kind, seed: 9, key: 0.6, world: '#ffecaa',
                },
                documentRef: recordingDocument(),
            });
            expect(gate.sprites, kind).not.toBeNull();
            for (const extra of [
                {},
                { direction: -1, rush: 1 },
                {
                    region: {
                        kind: 'disc', x: 700, y: 400, r: 300,
                    },
                    dim: 0.6,
                    rim: 1,
                    gather: {
                        x: 700, y: 400, r: 60, t: 0.5,
                    },
                },
                {
                    region: {
                        kind: 'hole', x: 800, y: 450, r: 220,
                    },
                    rim: 1,
                    worldBloom: 0.8,
                    direction: -1,
                },
            ]) {
                const ctx = recordingContext();
                expect(drawPortalGate(ctx, gate, frame(extra)), kind).toBe(true);
                const images = ctx.calls.filter((call) => call.name === 'drawImage');
                expect(images.length, kind).toBeGreaterThan(10);
                expect(images.every((call) => call.op === 'lighter'), kind).toBe(true);
                expect(images.every((call) => call.image), kind).toBe(true);
                const numbers = ctx.calls.flatMap((call) => call.args.filter((arg) => typeof arg === 'number'));
                expect(numbers.every((value) => Number.isFinite(value)), kind).toBe(true);
                expect(ctx.calls.every((call) => call.alpha >= 0 && call.alpha <= 1), kind).toBe(true);
                expect(ctx.globalAlpha).toBe(1);
                expect(ctx.globalCompositeOperation).toBe('source-over');
                expect(ctx.calls.filter((call) => call.name === 'save').length)
                    .toBe(ctx.calls.filter((call) => call.name === 'restore').length);
            }
        }
    });

    it('draws a rim without line strokes where the context has none (it skips the ornament\'s ticks)', () => {
        const gate = createPortalGate({ palette: GOLD, look: { kind: 'snow', seed: 3 }, documentRef: recordingDocument() });
        const ctx = recordingContext();
        delete ctx.moveTo;
        delete ctx.lineTo;
        expect(drawPortalGate(ctx, gate, frame({
            region: {
                kind: 'disc', x: 800, y: 450, r: 300,
            },
            rim: 1,
        }))).toBe(true);
        expect(ctx.calls.some((call) => call.name === 'stroke')).toBe(true);
    });
});

describe('the destination\'s colours', () => {
    const saturation = (color) => {
        const [r, g, b] = parseColor(color).map((value) => value / 255);
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const l = (max + min) / 2;
        return max === min ? 0 : (max - min) / (l > 0.5 ? 2 - max - min : max + min);
    };

    it('keeps a grey world\'s passage muted instead of pushing its faint cast to a vivid hue', () => {
        // The storm-cloud grey that made a blue passage into a golden prairie.
        expect(saturation(passageTint('#9aa7bf', 0.36))).toBeLessThan(0.45);
        expect(saturation(passageTint('#808080', 0.36))).toBe(0);
        expect(passageTint('#7f8080', 0.3)).toBe('rgb(77, 77, 77)');
        // A rich colour stays rich, at the asked lightness.
        const gold = parseColor(passageTint('#b58140', 0.36));
        expect(saturation(passageTint('#b58140', 0.36))).toBeGreaterThan(0.6);
        expect(gold[0]).toBeGreaterThan(gold[2] * 2);
        expect(Math.max(...gold)).toBeLessThan(190);
    });

    it('lifts the whole passage for a bright world and deepens it for a night', () => {
        const lightness = (color) => {
            const [r, g, b] = parseColor(color);
            return (Math.max(r, g, b) + Math.min(r, g, b)) / 510;
        };
        const day = createPortalGate({ palette: GOLD, look: { kind: 'cloud', key: 0.8, seed: 1 }, documentRef: null });
        const night = createPortalGate({ palette: GOLD, look: { kind: 'cloud', key: 0.08, seed: 1 }, documentRef: null });
        expect(lightness(day.heart)).toBeGreaterThan(lightness(night.heart));
        expect(lightness(day.far)).toBeGreaterThan(lightness(night.far));
        expect(Number(day.vignette.match(/, ([\d.]+)\)$/)[1])).toBeLessThan(Number(night.vignette.match(/, ([\d.]+)\)$/)[1]));
    });
});

describe('surfacing: the world\'s light through the gate', () => {
    it('swells over the first fifth of the reveal and is gone before the gate is wide', () => {
        expect(returnWorldBloom(0)).toBe(0);
        expect(returnWorldBloom(RETURN_WORLD_BLOOM.peakAt)).toBeCloseTo(1);
        expect(returnWorldBloom(RETURN_WORLD_BLOOM.until)).toBe(0);
        expect(returnWorldBloom(1)).toBe(0);
        // A swell, not a flash: no step between two frames of a 780 ms reveal at 60 Hz.
        for (let q = 0.02; q <= 1; q += 0.02) {
            expect(Math.abs(returnWorldBloom(q) - returnWorldBloom(q - 0.02))).toBeLessThan(0.2);
        }
    });

    it('is drawn only by a gate that knows its world, scaled by Reduce flashing, never onto a shut gate', () => {
        const withWorld = createPortalGate({
            palette: GOLD, look: { kind: 'bubbles', seed: 2, world: '#80deff' }, documentRef: recordingDocument(),
        });
        const without = createPortalGate({ palette: GOLD, look: { kind: 'bubbles', seed: 2 }, documentRef: recordingDocument() });
        expect(withWorld.sprites.glowWorld).toBeTruthy();
        expect(without.sprites.glowWorld).toBeUndefined();
        const hole = {
            region: {
                kind: 'hole', x: 800, y: 450, r: 200,
            },
            intensity: 0,
        };
        const glow = (gate, extra) => {
            const ctx = recordingContext();
            drawPortalGate(ctx, gate, frame({ ...hole, ...extra }));
            return ctx.calls.filter((call) => call.name === 'drawImage' && call.image === withWorld.sprites.glowWorld)
                .map((call) => call.alpha);
        };
        expect(glow(withWorld, { worldBloom: 1, flash: 1 })).toEqual([0.42]);
        expect(glow(withWorld, { worldBloom: 1, flash: 0.1 })[0]).toBeCloseTo(0.042);
        expect(glow(withWorld, { worldBloom: 0 })).toEqual([]);
        expect(glow(withWorld, { worldBloom: 1, region: { kind: 'all' } })).toEqual([]);
        expect(glow(without, { worldBloom: 1 })).toEqual([]);
    });
});

describe('the gate\'s worker', () => {
    it('takes the look with the palette, and warms the chapter the player is in', () => {
        const canvases = [];
        const core = createPortalGateWorkerCore({
            now: () => 0,
            requestFrame: () => {},
            makeCanvas: () => {
                const ctx = recordingContext();
                const canvas = { width: 1, height: 1, getContext: () => ctx };
                canvases.push(canvas);
                return canvas;
            },
        });
        core.handle({ type: 'warm', qualityPreset: 'Low', look: { kind: 'embers' } });
        expect(canvases.length).toBeGreaterThan(4);
        const ctx = recordingContext();
        core.handle({
            type: 'start',
            id: 1,
            canvas: { width: 1, height: 1, getContext: () => ctx },
            qualityPreset: 'Low',
            palette: GOLD,
            look: {
                kind: 'facets', seed: 77, key: 0.4, world: '#e8c4ff',
            },
            width: 800,
            height: 450,
            dpr: 1,
        });
        const run = core.runs.get(1);
        expect(run.gate.kindName).toBe('facets');
        expect(run.gate.sprites.glowWorld).toBeTruthy();
        core.handle({ type: 'frame', id: 1, frame: frame({ width: 800, height: 450, center: { x: 400, y: 225 } }) });
        expect(ctx.calls.filter((call) => call.name === 'drawImage').length).toBeGreaterThan(10);
        core.handle({ type: 'stop', id: 1 });
    });
});
