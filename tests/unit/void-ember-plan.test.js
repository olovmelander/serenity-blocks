/**
 * Void Ember — the numbers under the picture: the three-free maths (heat, wave, held light,
 * colour, anchors), the belt's plan and stones, the loops' store, the baked noise and the tiers.
 *
 * Constants are imported, never repeated: the assertions are relations that hold however the
 * look is tuned.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import * as core from '../../src/themes/void-ember/void-ember-core.js';
import {
    EMBER, ERUPT_LIFE, HEAT_CHAIN, HEAT_RAMP, LOCK_LOOPS, LOOP_HOLD, LOOP_LIFE, LOOP_RISE, LOOP_SLOTS, PALETTE_KEYS,
    REST_HEAT, TAU, VOID_PALETTES, WAVE_REACH, WAVE_TRAVEL, emberAnchors, emberColor, emberGlow, heatForCombo, linRGB,
    loopHeld, mulberry32, pieceColor, wavePassTime, waveRadius,
} from '../../src/themes/void-ember/void-ember-core.js';
import { fallbackLayout } from '../../src/themes/void-ember/void-ember-composition.js';
import { VOID_EMBER_TETROMINOS } from '../../src/themes/void-ember/void-ember-tetrominos.js';
import {
    ROCK_CLASSES, createRockGeometry, planRocks, rockPosition,
} from '../../src/themes/void-ember/void-ember-belt.js';
import {
    LOOP_STRANDS, createLoops, eruptLift, loopSparkShare,
} from '../../src/themes/void-ember/void-ember-loops.js';
import {
    FBM_SIZE, LATTICE_SIZE, bakeFbm, bakeLattice, createFbmTexture, createLatticeTexture, createVoidEmberUniforms,
    sampleLattice,
} from '../../src/themes/void-ember/void-ember-tsl.js';
import { QUALITY, QUALITY_NAMES, tierFor } from '../../src/themes/void-ember/void-ember-quality.js';
import { POST_LOOK } from '../../src/themes/void-ember/void-ember-post.js';
import { VOID_EMBER_PARTS, VoidEmberWorld } from '../../src/themes/void-ember/void-ember-world.js';
import { URL_PARAMETER_CATALOG } from '../../src/ui/url-parameters/catalog.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const f32 = Math.fround;
const PIECES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];
const TIERS = ['Minimal', 'Low', 'Medium', 'High', 'Ultra', 'Extreme'];
const steps = (from, to, count) => Array.from({ length: count + 1 }, (_, i) => from + ((to - from) * i) / count);
const mean = (values) => values.reduce((sum, v) => sum + v, 0) / values.length;

describe('void ember core: heat', () => {
    it('the heat ramp runs from a dying coal\'s red through gold to white, on distinct stops', () => {
        const top = HEAT_RAMP[HEAT_RAMP.length - 1][0];
        expect(HEAT_RAMP[0][0]).toBe(0);
        for (let i = 1; i < HEAT_RAMP.length; i++) {
            // Strictly rising: the shader's twin steps between neighbours, and a smoothstep with
            // equal edges is a hard WGSL error that kills every material that reads the ramp.
            expect(HEAT_RAMP[i][0]).toBeGreaterThan(HEAT_RAMP[i - 1][0]);
        }
        HEAT_RAMP.forEach(([, r, g, b]) => {
            expect(Math.max(r, g, b)).toBeLessThanOrEqual(1);
            expect(Math.min(r, g, b)).toBeGreaterThan(0);
        });
        // Each channel only ever rises with the heat.
        let last = emberColor(0);
        for (const heat of steps(0, top, 260)) {
            const c = emberColor(heat);
            for (let k = 0; k < 3; k++) expect(c[k]).toBeGreaterThanOrEqual(last[k] - 1e-12);
            last = c;
        }
        // Red first, then gold, then white: green and blue catch up with red as it heats.
        const [coal, gold, white] = [emberColor(0), emberColor(HEAT_CHAIN), emberColor(top)];
        expect(coal[1] / coal[0]).toBeLessThan(gold[1] / gold[0]);
        expect(gold[1] / gold[0]).toBeLessThan(white[1] / white[0]);
        expect(gold[2] / gold[0]).toBeLessThan(white[2] / white[0]);
        expect(white[2]).toBeGreaterThan(0.5);
        expect(coal[2]).toBeLessThan(0.05);
    });

    it('emberColor is the ramp at its stops, clamps outside it and fills the array it is given', () => {
        HEAT_RAMP.forEach(([heat, r, g, b]) => {
            const c = emberColor(heat);
            expect(c[0]).toBeCloseTo(r, 12);
            expect(c[1]).toBeCloseTo(g, 12);
            expect(c[2]).toBeCloseTo(b, 12);
        });
        const top = HEAT_RAMP[HEAT_RAMP.length - 1];
        expect(emberColor(-3)).toEqual(HEAT_RAMP[0].slice(1));
        expect(emberColor(99)).toEqual(top.slice(1));
        const out = [9, 9, 9];
        expect(emberColor(0.5, out)).toBe(out);
        expect(out.every((v) => v >= 0 && v <= 1)).toBe(true);
    });

    it('a hotter surface gives off more light, and a cold one still a little', () => {
        expect(emberGlow(0)).toBeGreaterThan(0);
        expect(emberGlow(-5)).toBe(emberGlow(0));
        let last = emberGlow(0);
        for (const heat of steps(0.01, 1.4, 140)) {
            expect(emberGlow(heat)).toBeGreaterThan(last);
            last = emberGlow(heat);
        }
        // Steep: white-hot outshines a banked coal many times over (that is what blooms).
        expect(emberGlow(1) / emberGlow(REST_HEAT)).toBeGreaterThan(3);
    });

    it('a chain blows the ember up step by step, always short of HEAT_CHAIN', () => {
        expect(heatForCombo(0)).toBe(REST_HEAT);
        expect(heatForCombo(-2)).toBe(REST_HEAT);
        expect(HEAT_CHAIN).toBeGreaterThan(REST_HEAT);
        let last = REST_HEAT;
        for (let combo = 1; combo <= 60; combo++) {
            const heat = heatForCombo(combo);
            expect(heat).toBeGreaterThanOrEqual(last);
            if (combo <= 20) expect(heat).toBeGreaterThan(last); // every early step can be seen
            expect(heat).toBeLessThanOrEqual(HEAT_CHAIN);
            last = heat;
        }
        expect(heatForCombo(20)).toBeLessThan(HEAT_CHAIN);
        // The first steps are the big ones.
        expect(heatForCombo(1) - heatForCombo(0)).toBeGreaterThan(heatForCombo(6) - heatForCombo(5));
        // The ramp reaches past what a chain can do: a four-line clear has somewhere to go.
        expect(HEAT_RAMP[HEAT_RAMP.length - 1][0]).toBeGreaterThan(HEAT_CHAIN);
    });
});

describe('void ember core: the wave and the held light', () => {
    it('a wave leaves the star\'s surface and runs out, and wavePassTime undoes waveRadius inside the reach', () => {
        expect(waveRadius(0)).toBe(1);
        expect(waveRadius(-1)).toBe(1);
        expect(wavePassTime(1)).toBe(0);
        expect(wavePassTime(0.3)).toBe(0);
        let last = 1;
        for (const age of steps(0.01, WAVE_TRAVEL, 100)) {
            expect(waveRadius(age)).toBeGreaterThan(last);
            last = waveRadius(age);
            expect(wavePassTime(waveRadius(age))).toBeCloseTo(age, 9);
        }
        expect(waveRadius(WAVE_TRAVEL)).toBeCloseTo(1 + WAVE_REACH, 9);
        for (const radii of steps(1, 1 + WAVE_REACH, 60)) {
            expect(waveRadius(wavePassTime(radii))).toBeCloseTo(radii, 9);
        }
        // Everything the belt holds is inside the reach, so every stone is passed.
        expect(1 + WAVE_REACH).toBeGreaterThan(EMBER.beltOuter);
        expect(wavePassTime(EMBER.beltInner)).toBeLessThan(wavePassTime(EMBER.beltOuter));
        // Past the reach it runs a little further, then stands: no radius grows without end.
        expect(waveRadius(WAVE_TRAVEL * 50)).toBe(waveRadius(WAVE_TRAVEL * 500));
        expect(Number.isFinite(waveRadius(1e9))).toBe(true);
    });

    it('a loop holds all its light when it is raised and none by LOOP_LIFE', () => {
        expect(loopHeld(0)).toBe(1);
        expect(loopHeld(-0.001)).toBe(0);
        expect(loopHeld(LOOP_LIFE)).toBe(0);
        expect(loopHeld(LOOP_LIFE + 1)).toBe(0);
        let last = 1;
        for (const age of steps(0, LOOP_LIFE, 700)) {
            const held = loopHeld(age);
            expect(held).toBeLessThanOrEqual(last);
            expect(held).toBeGreaterThanOrEqual(0);
            last = held;
        }
        expect(loopHeld(LOOP_HOLD)).toBeLessThanOrEqual(Math.exp(-1) + 1e-12);
        expect(loopHeld(LOOP_LIFE / 2)).toBeGreaterThan(0);
        // It is standing long before it starts to fade, and leaves faster than it lives.
        expect(LOOP_RISE).toBeLessThan(LOOP_HOLD);
        expect(ERUPT_LIFE).toBeLessThan(LOOP_LIFE);
    });

    it('the small helpers are what they say', () => {
        const a = mulberry32(7);
        const b = mulberry32(7);
        const c = mulberry32(8);
        const run = Array.from({ length: 500 }, () => a());
        expect(Array.from({ length: 500 }, () => b())).toEqual(run);
        expect(Array.from({ length: 500 }, () => c())).not.toEqual(run);
        expect(run.every((v) => v >= 0 && v < 1)).toBe(true);
        expect(mean(run)).toBeGreaterThan(0.4);
        expect(mean(run)).toBeLessThan(0.6);
        expect(mulberry32(0)()).toBe(mulberry32(1)()); // a zero seed is not a dead generator
        expect(core.approach(3, 0)).toBe(0);
        expect(core.approach(3, 1e9)).toBe(1);
        expect(core.approach(3, 0.1)).toBeLessThan(core.approach(3, 0.2));
        expect(core.clamp01(-2)).toBe(0);
        expect(core.clamp01(2)).toBe(1);
        expect(core.lerp(2, 6, 0.25)).toBe(3);
        expect(core.smooth(1, 3, 0)).toBe(0);
        expect(core.smooth(1, 3, 2)).toBe(0.5);
        expect(core.smooth(1, 3, 9)).toBe(1);
    });
});

describe('void ember core: colour', () => {
    it.each(PIECES)('the %s piece burns in its own colour: peak 1, its hue kept, a floor in every channel', (piece) => {
        const hex = VOID_EMBER_TETROMINOS.colors[piece];
        const rgb = pieceColor(hex);
        expect(Math.max(...rgb)).toBeCloseTo(1, 12);
        expect(Math.min(...rgb)).toBeGreaterThan(0);
        // The order of its channels is the piece's own.
        const lin = linRGB(Number.parseInt(hex.slice(1), 16));
        const order = (c) => [0, 1, 2].sort((i, j) => c[j] - c[i]).join('');
        expect(order(rgb)).toBe(order(lin));
        expect(rgb.every((v) => v <= 1 + 1e-12)).toBe(true);
    });

    it('every piece is a different flame, however the colour is written', () => {
        const flames = PIECES.map((piece) => pieceColor(VOID_EMBER_TETROMINOS.colors[piece])
            .map((v) => v.toFixed(3)).join());
        expect(new Set(flames).size).toBe(PIECES.length);
        const hex = VOID_EMBER_TETROMINOS.colors.Z;
        expect(pieceColor(hex.slice(1))).toEqual(pieceColor(hex));
        expect(pieceColor(hex.toUpperCase())).toEqual(pieceColor(hex));
        expect(pieceColor(Number.parseInt(hex.slice(1), 16))).toEqual(pieceColor(hex));
        // Nothing usable falls back to a flame, never to black or NaN.
        for (const junk of [null, undefined, '', 'teal', '#12', NaN, {}]) {
            const rgb = pieceColor(junk);
            expect(rgb.every((v) => Number.isFinite(v) && v > 0 && v <= 1)).toBe(true);
            expect(rgb).toEqual(pieceColor(null));
        }
        expect(pieceColor(null, 0x00ff00)[1]).toBeCloseTo(1, 12);
        expect(pieceColor('#000000').every((v) => Number.isFinite(v))).toBe(true);
    });

    it('neighbours on the line of palettes mix without passing through grey', () => {
        // The void drifts from one palette to the next: half-way there it must still have a colour.
        for (let i = 0; i + 1 < VOID_PALETTES.length; i++) {
            ['dustA', 'dustB'].forEach((key) => {
                const mid = VOID_PALETTES[i][key].map((v, c) => (v + VOID_PALETTES[i + 1][key][c]) / 2);
                const hi = Math.max(...mid);
                const label = `${VOID_PALETTES[i].name} → ${VOID_PALETTES[i + 1].name} ${key}`;
                expect((hi - Math.min(...mid)) / hi, label).toBeGreaterThan(0.6);
            });
        }
    });

    it('every level has a whole palette, and no two are the same dark', () => {
        expect(VOID_PALETTES.length).toBeGreaterThan(1);
        expect(new Set(VOID_PALETTES.map((palette) => palette.name)).size).toBe(VOID_PALETTES.length);
        VOID_PALETTES.forEach((palette) => {
            PALETTE_KEYS.forEach((key) => {
                expect(palette[key], `${palette.name}.${key}`).toHaveLength(3);
                const inRange = palette[key].every((v) => Number.isFinite(v) && v >= 0 && v <= 1);
                expect(inRange, `${palette.name}.${key}`).toBe(true);
            });
            // The void is the darkest thing in the picture: nothing else gives light here.
            expect(Math.max(...palette.void)).toBeLessThan(Math.max(...palette.dustA));
            expect(Math.max(...palette.void)).toBeLessThan(Math.max(...palette.rock));
        });
        expect(new Set(VOID_PALETTES.map((palette) => palette.void.join())).size).toBe(VOID_PALETTES.length);
    });

    it('the playground effect plays with the game\'s own piece colours', () => {
        const source = readFileSync(path.join(root, 'src/playground/effects/void-ember.effect.js'), 'utf8');
        const list = /const PIECE_COLORS = \[([^\]]*)\]/.exec(source);
        expect(list, 'PIECE_COLORS in void-ember.effect.js').toBeTruthy();
        const colours = list[1].match(/#[0-9a-f]{6}/gi).map((hex) => hex.toLowerCase());
        expect(colours).toEqual(PIECES.map((piece) => VOID_EMBER_TETROMINOS.colors[piece].toLowerCase()));
    });
});

describe('void ember core: where the ember hangs', () => {
    const ASPECTS = [
        ['an upright phone', 0.46], ['a square frame', 1], ['4:3', 4 / 3], ['16:9', 16 / 9], ['21:9', 21 / 9],
    ];
    /** How far a disc (centre in screen fractions, radius in screen heights) is from a rect; < 0 = they overlap. */
    const clearance = (x, y, radius, rect, aspect) => {
        const nx = Math.max(rect.x0, Math.min(rect.x1, x));
        const ny = Math.max(rect.y0, Math.min(rect.y1, y));
        return Math.hypot((x - nx) * aspect, y - ny) - radius;
    };

    it.each(ASPECTS)('keeps the star\'s whole disc inside the frame in %s', (_label, aspect) => {
        const a = emberAnchors(aspect);
        expect(a.radius).toBeGreaterThan(0);
        expect(a.y - a.radius).toBeGreaterThanOrEqual(0);
        expect(a.y + a.radius).toBeLessThanOrEqual(1);
        // Its centre is on screen, left of the middle: the board has the centre.
        expect(a.x).toBeGreaterThan(0);
        expect(a.x).toBeLessThan(0.5);
        // The cinder world is on the other side of the card, whole and small beside the star.
        expect(a.world.x).toBeGreaterThan(0.5);
        expect(a.world.radius).toBeLessThan(a.radius);
        expect(a.world.x + a.world.radius / aspect).toBeLessThanOrEqual(1);
        expect(a.world.y - a.world.radius).toBeGreaterThanOrEqual(0);
        expect(a.world.y + a.world.radius).toBeLessThanOrEqual(1);
        // The belt lies nearly edge-on, leaning a little.
        expect(a.beltTilt).toBeGreaterThan(0);
        expect(a.beltTilt).toBeLessThan(Math.PI / 4);
        expect(Math.abs(a.beltLean)).toBeLessThan(Math.PI / 4);
    });

    const WIDE = [['16:9', 16 / 9], ['21:9', 21 / 9]];

    it.each(WIDE)('in a wide frame (%s) the star\'s right limb stays left of the card', (_label, aspect) => {
        const a = emberAnchors(aspect);
        // The world's own stand-in for the board, and the same frame at a common height.
        for (const height of [1000, 900, 720, 1440]) {
            const card = fallbackLayout(aspect * height, height).cards[0];
            expect(a.x + a.radius / aspect, `${height}p`).toBeLessThan(card.x0);
            // Level with the card, so the belt sweeps behind it.
            expect(a.y, `${height}p`).toBeGreaterThan(card.y0);
            expect(a.y, `${height}p`).toBeLessThan(card.y1);
        }
    });

    it('on an upright phone the star rises into the sky above the card', () => {
        const a = emberAnchors(0.46);
        const card = fallbackLayout(0.46 * 1000, 1000).cards[0];
        expect(a.y).toBeLessThan(card.y0);
        expect(a.x - a.radius / 0.46).toBeGreaterThanOrEqual(0);
        expect(a.x + a.radius / 0.46).toBeLessThanOrEqual(1);
        // Smaller than in a wide frame: the sky above the card is a narrow strip.
        expect(a.radius).toBeLessThan(emberAnchors(16 / 9).radius);
    });

    const SMALL = [['a square frame', 1], ['4:3', 4 / 3]];

    it.each(SMALL)('%s is a small landscape: the star left of the card, level with it, and smaller', (_l, aspect) => {
        const a = emberAnchors(aspect);
        // The world's own stand-in for the board, and the same frame at other heights.
        for (const height of [1000, 900, 1440]) {
            const card = fallbackLayout(aspect * height, height).cards[0];
            expect(a.x + a.radius / aspect, `${height}p`).toBeLessThan(card.x0);
            expect(a.y, `${height}p`).toBeGreaterThan(card.y0);
            expect(a.y, `${height}p`).toBeLessThan(card.y1);
        }
        expect(a.x - a.radius / aspect).toBeGreaterThanOrEqual(0);
        expect(a.radius).toBeLessThan(emberAnchors(16 / 9).radius);
        expect(a.radius).toBeGreaterThan(emberAnchors(0.46).radius);
    });

    it.each(ASPECTS)('the cinder world stands clear of the HUD and the card in %s', (_l, aspect) => {
        const a = emberAnchors(aspect);
        const { hud, cards } = fallbackLayout(aspect * 1000, 1000);
        expect(clearance(a.world.x, a.world.y, a.world.radius, hud, aspect)).toBeGreaterThan(0);
        expect(clearance(a.world.x, a.world.y, a.world.radius, cards[0], aspect)).toBeGreaterThan(0);
    });

    it('moves smoothly from the phone\'s composition to the wide one, and survives nonsense', () => {
        let last = emberAnchors(0.3);
        for (const aspect of steps(0.3, 3, 540)) {
            const a = emberAnchors(aspect);
            const moved = [
                [a.x, last.x], [a.y, last.y], [a.radius, last.radius],
                [a.world.x, last.world.x], [a.world.y, last.world.y],
            ];
            for (const [now, was] of moved) {
                expect(Math.abs(now - was)).toBeLessThan(0.02); // no jump as a window is dragged
            }
            last = a;
        }
        const wide = emberAnchors(16 / 9);
        for (const junk of [NaN, 0, -1, undefined, Infinity]) expect(emberAnchors(junk)).toEqual(wide);
    });
});

describe('void ember belt', () => {
    const SEEDS = [1, 77, 0x5eed + 101, 0x5eed + 202, 0x5eed + 303];

    const CLASSES = ROCK_CLASSES.map((cls, index) => [cls.name, cls, index]);

    it.each(CLASSES)('plans the %s inside the belt, in their size range, on Kepler orbits', (_name, cls) => {
        const outer = Math.min(EMBER.beltOuter, cls.maxOrbit);
        expect(outer).toBeGreaterThan(EMBER.beltInner);
        for (const seed of SEEDS) {
            const count = 600;
            const plan = planRocks(seed, count, cls);
            expect(plan.count).toBe(count);
            expect(plan.orbit).toHaveLength(count * 4);
            expect(plan.body).toHaveLength(count * 4);
            expect(plan.seed).toHaveLength(count * 4);
            const pick = (array, k) => Array.from(array).filter((_, i) => i % 4 === k);
            const radii = pick(plan.orbit, 0);
            const phases = pick(plan.orbit, 1);
            const heights = pick(plan.orbit, 2);
            const speeds = pick(plan.orbit, 3);
            const sizes = pick(plan.body, 0);
            expect(Math.min(...radii)).toBeGreaterThanOrEqual(f32(EMBER.beltInner) - 1e-6);
            expect(Math.max(...radii)).toBeLessThanOrEqual(f32(outer) + 1e-6);
            expect(Math.min(...phases)).toBeGreaterThanOrEqual(0);
            expect(Math.max(...phases)).toBeLessThan(TAU + 1e-6);
            // A thin disc: no stone strays far out of the belt's plane.
            expect(Math.max(...heights.map((height, i) => Math.abs(height) / radii[i]))).toBeLessThan(0.25);
            expect(Math.min(...speeds)).toBeGreaterThan(0);
            expect(Math.min(...sizes)).toBeGreaterThanOrEqual(f32(cls.size[0]) - 1e-6);
            expect(Math.max(...sizes)).toBeLessThanOrEqual(f32(cls.size[1]) + 1e-6);
            expect([...plan.orbit, ...plan.body, ...plan.seed].every(Number.isFinite)).toBe(true);
            // The inner stones overtake the outer ones.
            const middle = [...radii].sort((a, b) => a - b)[count / 2];
            const inner = speeds.filter((_, i) => radii[i] < middle);
            const far = speeds.filter((_, i) => radii[i] >= middle);
            expect(mean(inner)).toBeGreaterThan(mean(far));
            const mr = mean(radii);
            const ms = mean(speeds);
            const covariance = mean(radii.map((r, i) => (r - mr) * (speeds[i] - ms)));
            expect(covariance).toBeLessThan(0);
            // Spread right round the star...
            for (let quarter = 0; quarter < 4; quarter++) {
                const here = phases.filter((phase) => Math.floor(phase / (TAU / 4)) === quarter);
                expect(here.length).toBeGreaterThan(count / 8);
            }
            // ...and right across the belt: its inner and outer halves both hold stones.
            const half = (EMBER.beltInner + outer) / 2;
            expect(radii.filter((r) => r < half).length).toBeGreaterThan(count / 8);
            expect(radii.filter((r) => r >= half).length).toBeGreaterThan(count / 8);
        }
        // The same seed plans the same belt; another seed another.
        expect(planRocks(5, 50, cls)).toEqual(planRocks(5, 50, cls));
        expect(planRocks(5, 50, cls).orbit).not.toEqual(planRocks(6, 50, cls).orbit);
    });

    it('rockPosition is the plan\'s own orbit: a circle in the belt\'s plane, turned by the clock', () => {
        const cls = ROCK_CLASSES[1];
        const plan = planRocks(42, 80, cls);
        const out = [0, 0, 0];
        for (let i = 0; i < plan.count; i++) {
            const [radius, phase, height, speed] = plan.orbit.subarray(i * 4, i * 4 + 4);
            expect(rockPosition(plan, i, 0, out)).toBe(out);
            expect(out[0]).toBeCloseTo(Math.cos(phase) * radius, 9);
            expect(out[1]).toBe(height);
            expect(out[2]).toBeCloseTo(Math.sin(phase) * radius, 9);
            for (const time of [1, 37.5, 900]) {
                const at = rockPosition(plan, i, time);
                expect(Math.hypot(at[0], at[2])).toBeCloseTo(radius, 9);
                expect(at[1]).toBe(height);
                // It has turned by speed × time, the same way for every stone.
                const turned = Math.atan2(at[2], at[0]) - Math.atan2(out[2], out[0]);
                expect(Math.cos(turned)).toBeCloseTo(Math.cos(speed * time), 9);
                expect(Math.sin(turned)).toBeCloseTo(Math.sin(speed * time), 9);
            }
        }
    });

    /** Per face: its normal · its centroid, and the normal's length. */
    function faces(geometry) {
        const p = geometry.getAttribute('position');
        const n = geometry.getAttribute('normal');
        const out = [];
        for (let f = 0; f < p.count; f += 3) {
            const at = (vertex, k) => p.array[(f + vertex) * 3 + k];
            const centroid = [0, 1, 2].map((k) => (at(0, k) + at(1, k) + at(2, k)) / 3);
            const normal = [n.getX(f), n.getY(f), n.getZ(f)];
            out.push({
                facing: centroid[0] * normal[0] + centroid[1] * normal[1] + centroid[2] * normal[2],
                length: Math.hypot(...normal),
                flat: [1, 2].every((v) => n.getX(f + v) === normal[0] && n.getY(f + v) === normal[1]
                    && n.getZ(f + v) === normal[2]),
            });
        }
        return out;
    }

    it.each(CLASSES)('chisels the %s as flat-faced stones whose normals point outward', (_name, cls, index) => {
        // The seed the world gives this class, and a handful of others.
        const shipped = (new VoidEmberWorld({ scene: new THREE.Scene() }).seed + 101 * (index + 1)) * 31 + 7;
        for (const seed of [shipped, 1, 2, 3, 1234567, 0xbeef]) {
            const geometry = createRockGeometry(seed, cls.detail);
            const position = geometry.getAttribute('position');
            expect(geometry.getIndex()).toBeNull(); // one normal per face needs unshared vertices
            expect(position.count % 3).toBe(0);
            expect(Array.from(position.array).every(Number.isFinite)).toBe(true);
            expect(Array.from(geometry.getAttribute('normal').array).every(Number.isFinite)).toBe(true);
            const list = faces(geometry);
            // A mesh wound inside out still draws, lit from behind: check the facing in numbers.
            expect(mean(list.map((face) => face.facing)), `seed ${seed}`).toBeGreaterThan(0.2);
            expect(list.filter((face) => face.facing <= 0), `seed ${seed}`).toEqual([]);
            // No collapsed face: a zero normal is a NaN in the shader, and bloom spreads a NaN.
            expect(list.every((face) => Math.abs(face.length - 1) < 1e-4), `seed ${seed}`).toBe(true);
            expect(list.every((face) => face.flat), `seed ${seed}`).toBe(true);
            // About a unit across, never a needle or a speck.
            geometry.computeBoundingBox();
            const size = geometry.boundingBox.getSize(new THREE.Vector3());
            expect(Math.max(size.x, size.y, size.z)).toBeLessThan(3.2);
            expect(Math.min(size.x, size.y, size.z)).toBeGreaterThan(0.3);
            expect(geometry.boundingSphere.radius).toBeGreaterThan(0.4);
        }
        // Not a ball: the cuts leave flats, so the same seed is the same stone and another is not.
        const a = createRockGeometry(9, cls.detail).getAttribute('position').array;
        expect(createRockGeometry(9, cls.detail).getAttribute('position').array).toEqual(a);
        expect(createRockGeometry(10, cls.detail).getAttribute('position').array).not.toEqual(a);
    });

    it('the bigger the class, the fewer and the finer-cut its stones', () => {
        for (let i = 1; i < ROCK_CLASSES.length; i++) {
            expect(ROCK_CLASSES[i].size[1]).toBeLessThan(ROCK_CLASSES[i - 1].size[1]);
            expect(ROCK_CLASSES[i].detail).toBeLessThanOrEqual(ROCK_CLASSES[i - 1].detail);
        }
        ROCK_CLASSES.forEach((cls) => {
            expect(cls.size[0]).toBeLessThan(cls.size[1]);
            expect(cls.maxOrbit).toBeGreaterThan(EMBER.beltInner);
        });
        TIERS.forEach((tier) => {
            const { rocks } = QUALITY[tier];
            expect(rocks).toHaveLength(ROCK_CLASSES.length);
            for (let i = 1; i < rocks.length; i++) expect(rocks[i]).toBeGreaterThan(rocks[i - 1]);
        });
    });
});

describe('void ember loops: the store', () => {
    function makeLoops() {
        const u = createVoidEmberUniforms({
            lattice: createLatticeTexture(bakeLattice()),
            fbm: createFbmTexture(bakeFbm(3141, 16), 16),
        });
        return createLoops(u);
    }
    const raise = (loops, slot, time, extra = {}) => loops.raise(slot, {
        site: [0, 0, 1],
        azimuth: 0.4,
        span: 0.15,
        height: 0.3,
        rgb: [1, 0.5, 0.25],
        time,
        strength: 0.8,
        seed: slot,
        ...extra,
    });
    const row = (loops, name, instance) => Array.from(
        loops.geometry.getAttribute(name).array.subarray(instance * 4, instance * 4 + 4),
    );

    it('starts empty: one instance per strand, all dormant', () => {
        const loops = makeLoops();
        expect(loops.count).toBe(LOOP_SLOTS);
        expect(loops.geometry.instanceCount).toBe(LOOP_SLOTS * LOOP_STRANDS);
        expect(loops.mesh.material.isNodeMaterial).toBe(true);
        expect(loops.litCount(0)).toBe(0);
        expect(loops.totalHeld(0)).toBe(0);
        for (let i = 0; i < LOOP_SLOTS; i++) {
            expect(loops.held(i, 0)).toBe(0);
            expect(loops.erupt(i, 0)).toBe(false); // nothing to tear off
        }
        expect(loops.held(-1, 0)).toBe(0);
        expect(loops.held(LOOP_SLOTS, 0)).toBe(0);
        expect(() => raise(loops, LOOP_SLOTS, 0)).not.toThrow();
        // A dormant strand has no width to draw (its strength is zero).
        for (let i = 0; i < LOOP_SLOTS * LOOP_STRANDS; i++) expect(row(loops, 'aTint', i)[3]).toBe(0);
    });

    it('a raised loop holds its strength, losing it as loopHeld says', () => {
        const loops = makeLoops();
        raise(loops, 3, 10, { strength: 0.8 });
        expect(loops.held(3, 10)).toBeCloseTo(0.8, 12);
        expect(loops.held(3, 9.99)).toBe(0); // not before it is born
        let last = 0.8;
        for (const age of steps(0.5, LOOP_LIFE, 100)) {
            const held = loops.held(3, 10 + age);
            expect(held).toBeCloseTo(0.8 * loopHeld(age), 12);
            expect(held).toBeLessThanOrEqual(last);
            last = held;
        }
        expect(loops.held(3, 10 + LOOP_LIFE)).toBe(0);
        expect(loops.slot(3)).toMatchObject({
            birth: 10, strength: 0.8, site: [0, 0, 1], rgb: [1, 0.5, 0.25], height: 0.3,
        });
        expect(loops.litCount(10)).toBe(1);
        expect(loops.litCount(10, 0, 3)).toBe(0);
        expect(loops.litCount(10, 3, 4)).toBe(1);
        expect(loops.totalHeld(10)).toBeCloseTo(0.8, 12);
        raise(loops, 7, 10, { strength: 0.5 });
        expect(loops.totalHeld(10)).toBeCloseTo(1.3, 12);
        expect(loops.totalHeld(10, 4)).toBeCloseTo(0.5, 12);
        // It keeps its own copy of what it was given.
        const site = [1, 0, 0];
        const rgb = [0.2, 0.4, 1];
        raise(loops, 8, 10, { site, rgb });
        site[0] = 9;
        rgb[2] = 9;
        expect(loops.slot(8)).toMatchObject({ site: [1, 0, 0], rgb: [0.2, 0.4, 1] });
    });

    it('writes every strand of the arcade: on the star, square to its site, in its colour', () => {
        const loops = makeLoops();
        const dirs = [[0, 0, 1], [0, 1, 0], [0, -1, 0], [0.6, 0, 0.8], [-0.36, 0.48, -0.8]];
        dirs.forEach((site, slot) => {
            raise(loops, slot, 20, {
                site, rgb: [0.2, 0.9, 0.4], strength: 0.9, azimuth: slot * 1.3,
            });
            for (let j = 0; j < LOOP_STRANDS; j++) {
                const i = slot * LOOP_STRANDS + j;
                const [sx, sy, sz] = row(loops, 'aSite', i);
                const [tx, ty, tz] = row(loops, 'aTan', i);
                const [span, height, birth, erupt] = row(loops, 'aShape', i);
                const [r, g, b, strength] = row(loops, 'aTint', i);
                // Its feet are on the star, close to where the comet struck.
                expect(Math.hypot(sx, sy, sz)).toBeCloseTo(1, 5);
                expect(sx * site[0] + sy * site[1] + sz * site[2]).toBeGreaterThan(0.99);
                // Its plane is square to the surface there (a pole is not a special case).
                expect(Math.hypot(tx, ty, tz)).toBeCloseTo(1, 5);
                expect(Math.abs(tx * sx + ty * sy + tz * sz)).toBeLessThan(0.08);
                expect(span).toBeGreaterThan(0);
                expect(height).toBeGreaterThan(0);
                // The strands rise one after another, never before the loop itself.
                expect(birth).toBeGreaterThanOrEqual(20);
                expect(birth).toBeLessThan(20 + LOOP_RISE);
                expect(erupt).toBeGreaterThan(20 + LOOP_LIFE); // not leaving
                expect(strength).toBeGreaterThan(0);
                expect(strength).toBeLessThanOrEqual(f32(0.9));
                expect(g).toBeGreaterThan(r);
                expect(g).toBeGreaterThan(b);
                expect([sx, sy, sz, tx, ty, tz, span, height, r, g, b].every(Number.isFinite)).toBe(true);
            }
        });
        // The first strand is the loop itself; the others are lesser.
        expect(row(loops, 'aTint', 0)[3]).toBeGreaterThanOrEqual(row(loops, 'aTint', 1)[3]);
    });

    it('tears a loop off once: from then on it holds nothing, and its strands leave one after another', () => {
        const loops = makeLoops();
        raise(loops, 2, 5);
        expect(loops.erupt(2, 8)).toBe(true);
        expect(loops.slot(2).erupt).toBe(8);
        expect(loops.held(2, 8)).toBe(0);
        expect(loops.held(2, 60)).toBe(0);
        expect(loops.litCount(8)).toBe(0);
        expect(loops.erupt(2, 9)).toBe(false); // already leaving
        expect(loops.erupt(2, 8)).toBe(false); // and at the very moment it left
        expect(loops.slot(2).erupt).toBe(8);
        const leave = [0, 1, 2].slice(0, LOOP_STRANDS).map((j) => row(loops, 'aShape', 2 * LOOP_STRANDS + j)[3]);
        expect(leave[0]).toBe(8);
        for (let j = 1; j < leave.length; j++) expect(leave[j]).toBeGreaterThanOrEqual(leave[j - 1]);
        expect(leave[leave.length - 1]).toBeLessThan(8 + 1);
        // A loop that has only just risen can be torn off; one that has burnt out cannot.
        raise(loops, 4, 20);
        expect(loops.erupt(4, 20.01)).toBe(true);
        raise(loops, 5, 20);
        expect(loops.erupt(5, 20 + LOOP_LIFE + 1)).toBe(false);
        // Raising a loop in a slot that was leaving starts it afresh.
        raise(loops, 2, 30);
        expect(loops.held(2, 30)).toBeGreaterThan(0);
        expect(loops.erupt(2, 31)).toBe(true);
    });

    it('a scheduled eruption still holds its light until its time, and an earlier one takes its place', () => {
        const loops = makeLoops();
        raise(loops, 1, 10, { strength: 0.8 });
        const before = loops.held(1, 12);
        expect(before).toBeGreaterThan(0);
        expect(loops.erupt(1, 15)).toBe(true); // three seconds ahead
        // Until then it is a standing loop like any other.
        expect(loops.held(1, 12)).toBe(before);
        expect(loops.held(1, 14.999)).toBeCloseTo(0.8 * loopHeld(4.999), 12);
        expect(loops.litCount(14)).toBe(1);
        expect(loops.totalHeld(14)).toBeCloseTo(0.8 * loopHeld(4), 12);
        expect(row(loops, 'aShape', LOOP_STRANDS)[3]).toBe(15); // the shader has its moment already
        // From its moment on it holds nothing.
        expect(loops.held(1, 15)).toBe(0);
        expect(loops.held(1, 16)).toBe(0);
        expect(loops.litCount(15)).toBe(0);
        // A later tearing changes nothing (it will have left by then); an earlier one takes its place.
        expect(loops.erupt(1, 20)).toBe(false);
        expect(loops.erupt(1, 15)).toBe(false);
        expect(loops.slot(1).erupt).toBe(15);
        expect(loops.erupt(1, 13)).toBe(true);
        expect(loops.slot(1).erupt).toBe(13);
        expect(loops.held(1, 12.9)).toBeGreaterThan(0);
        expect(loops.held(1, 13)).toBe(0);
        expect(row(loops, 'aShape', LOOP_STRANDS)[3]).toBe(13);
        // Raised again, the slot forgets what was scheduled for the loop it held.
        raise(loops, 1, 14, { strength: 0.8 });
        expect(loops.held(1, 40)).toBeCloseTo(0.8 * loopHeld(26), 12);
    });

    it('weakest: a free slot first, then the oldest arc that is leaving, then the dimmest standing loop', () => {
        const loops = makeLoops();
        const pick = (time) => loops.weakest(0, 4, time);
        expect(pick(0)).toBe(0);
        raise(loops, 0, 0, { strength: 0.9 });
        expect(pick(1)).toBe(1); // the first free one
        raise(loops, 1, 1, { strength: 0.9 });
        raise(loops, 2, 2, { strength: 0.9 });
        expect(pick(3)).toBe(3);
        raise(loops, 3, 3, { strength: 0.5 });
        // A loop that has just risen is the last to be replaced, however dim it is...
        expect(pick(4)).not.toBe(3);
        // ...and once it has stood a while, all standing: the one that holds the least light
        // (not the oldest, not the first).
        expect(pick(5.5)).toBe(3);
        raise(loops, 3, 4, { strength: 1.2 });
        expect(pick(5)).toBe(0);
        // Two are torn off, one after the other. Once an arc has been leaving for a moment it gives
        // way before any standing loop, and the one that left first before the one that left later.
        expect(loops.erupt(1, 5)).toBe(true);
        expect(loops.erupt(2, 5 + ERUPT_LIFE * 0.2)).toBe(true);
        const then = 5 + ERUPT_LIFE * 0.5;
        expect(loops.held(1, then)).toBe(0);
        expect(pick(then)).toBe(1);
        // A loop rises in that slot: the next landing takes the other arc, never the loop just risen.
        raise(loops, 1, then, { strength: 0.9 });
        expect(pick(then + ERUPT_LIFE * 0.1)).toBe(2);
        // Once an arc has left the sky its slot is simply free.
        expect(pick(5 + ERUPT_LIFE * 1.2 + 0.01)).toBe(2);
        expect(loops.held(2, 5 + ERUPT_LIFE * 1.2 + 0.01)).toBe(0);

        // A scheduled eruption is not one yet: until its time the loop is weighed by its light.
        const later = makeLoops();
        raise(later, 0, 0, { strength: 0.9 });
        raise(later, 1, 0, { strength: 0.5 });
        expect(later.erupt(0, 10)).toBe(true);
        expect(later.weakest(0, 2, 3)).toBe(1); // the dimmer one, though the other is due to leave
        // A loop whose comet has not landed yet is not free, whatever else there is.
        raise(later, 1, 10.4);
        expect(later.held(1, 10.2)).toBe(0);
        expect(later.weakest(0, 2, 10.2)).toBe(0); // the arc that left at 10, not the loop still to rise
        // It only looks where it is told.
        expect(loops.weakest(LOCK_LOOPS, LOOP_SLOTS, 10)).toBeGreaterThanOrEqual(LOCK_LOOPS);
    });

    it('reset empties every slot and collapses every strand', () => {
        const loops = makeLoops();
        for (let i = 0; i < LOOP_SLOTS; i++) raise(loops, i, 3);
        loops.erupt(1, 4);
        expect(loops.litCount(3.5)).toBeGreaterThan(0);
        loops.reset();
        expect(loops.litCount(3.5)).toBe(0);
        expect(loops.totalHeld(3.5)).toBe(0);
        for (let i = 0; i < LOOP_SLOTS; i++) {
            expect(loops.slot(i).strength).toBe(0);
            expect(loops.erupt(i, 5)).toBe(false);
        }
        for (let i = 0; i < LOOP_SLOTS * LOOP_STRANDS; i++) {
            expect(row(loops, 'aTint', i)[3]).toBe(0);
            expect(row(loops, 'aShape', i)[2]).toBeLessThan(0); // born long ago
            expect(row(loops, 'aShape', i)[3]).toBeGreaterThan(1e5); // not leaving
        }
        expect(loops.weakest(0, LOCK_LOOPS, 5)).toBe(0);
    });

    it('a torn-off loop climbs faster and faster, and the spark budget is shared out', () => {
        expect(eruptLift(0)).toBe(0);
        expect(eruptLift(-1)).toBe(0);
        let last = 0;
        let lastGain = 0;
        for (const tau of steps(0, ERUPT_LIFE, 52).slice(1)) {
            const lift = eruptLift(tau);
            expect(lift).toBeGreaterThan(last);
            expect(lift - last).toBeGreaterThan(lastGain - 1e-12); // it keeps gaining
            lastGain = lift - last;
            last = lift;
        }
        // The more loops let go, the fewer sparks each gets, and together never much over half the pool.
        for (const pool of TIERS.map((tier) => QUALITY[tier].sparks)) {
            let each = Infinity;
            for (let loops = 1; loops <= LOOP_SLOTS; loops++) {
                const share = loopSparkShare(pool, loops);
                expect(Number.isInteger(share)).toBe(true);
                expect(share).toBeGreaterThan(0);
                expect(share).toBeLessThanOrEqual(each);
                each = share;
            }
            expect(loopSparkShare(pool, 0)).toBe(loopSparkShare(pool, 1));
            expect(loopSparkShare(pool, LOCK_LOOPS) * LOCK_LOOPS).toBeLessThanOrEqual(pool * 0.75);
        }
    });
});

describe('void ember noise', () => {
    it('the lattice pairs two z-slices in one texel: G is R one slice on, A is B one slice on', () => {
        const size = 32;
        const data = bakeLattice(9917, size);
        expect(data).toHaveLength(size * size * 4);
        // The offset between slices is what sampleLattice (and the shader) step by per unit of z.
        let shift = null;
        for (let dy = 0; dy < size && !shift; dy++) {
            for (let dx = 0; dx < size && !shift; dx++) {
                let same = true;
                for (let i = 0; i < size * size && same; i++) {
                    const x = i % size;
                    const y = Math.floor(i / size);
                    const j = ((y + dy) % size) * size + ((x + dx) % size);
                    same = data[i * 4 + 1] === data[j * 4] && data[i * 4 + 3] === data[j * 4 + 2];
                }
                if (same) shift = [dx, dy];
            }
        }
        expect(shift).toEqual([37 % size, 17 % size]);
        // Two independent fields, both using the whole range.
        const r = data.filter((_, i) => i % 4 === 0);
        const b = data.filter((_, i) => i % 4 === 2);
        expect(Math.min(...r)).toBeLessThan(16);
        expect(Math.max(...r)).toBeGreaterThan(239);
        expect(Array.from(r)).not.toEqual(Array.from(b));
        expect(bakeLattice(9917, size)).toEqual(data);
        expect(bakeLattice(9918, size)).not.toEqual(data);
        expect(bakeLattice()).toHaveLength(LATTICE_SIZE * LATTICE_SIZE * 4);
    });

    it('sampleLattice is smooth value noise in [0, 1]: the texel at a lattice point, the next slice one z on', () => {
        const size = 32;
        const data = bakeLattice(4242, size);
        const texel = (x, y) => data[((((y % size) + size) % size) * size + (((x % size) + size) % size)) * 4] / 255;
        for (const [x, y] of [[0, 0], [5, 9], [31, 31], [-3, 40]]) {
            expect(sampleLattice(data, x, y, 0, size)).toBeCloseTo(texel(x, y), 12);
            expect(sampleLattice(data, x, y, 1, size)).toBeCloseTo(texel(x + 37, y + 17), 12);
            expect(sampleLattice(data, x, y, 2, size)).toBeCloseTo(texel(x + 74, y + 34), 12);
        }
        const rand = mulberry32(99);
        let low = 1;
        let high = 0;
        let jump = 0;
        for (let i = 0; i < 4000; i++) {
            const p = [rand() * 200 - 100, rand() * 200 - 100, rand() * 60 - 30];
            const v = sampleLattice(data, ...p, size);
            low = Math.min(low, v);
            high = Math.max(high, v);
            jump = Math.max(jump, Math.abs(sampleLattice(data, p[0] + 1e-4, p[1] + 1e-4, p[2] + 1e-4, size) - v));
        }
        expect(low).toBeGreaterThanOrEqual(0);
        expect(high).toBeLessThanOrEqual(1);
        expect(low).toBeLessThan(0.15);
        expect(high).toBeGreaterThan(0.85);
        // Continuous: a small step is a small change, across cell and slice borders too.
        expect(jump).toBeLessThan(1e-3);
        // It tiles with the texture.
        const tiled = sampleLattice(data, 3.3 + size, 7.7 - size, 0.4, size);
        expect(sampleLattice(data, 3.3, 7.7, 0.4, size)).toBeCloseTo(tiled, 9);
    });

    it('the lattice texture is set up for the one-fetch read: repeat, bilinear, no mips, raw values', () => {
        const data = bakeLattice(1, 16);
        const tex = createLatticeTexture(data, 16);
        expect(tex.image).toMatchObject({ width: 16, height: 16 });
        expect(tex.image.data).toBe(data);
        expect(tex).toMatchObject({
            wrapS: THREE.RepeatWrapping,
            wrapT: THREE.RepeatWrapping,
            magFilter: THREE.LinearFilter,
            minFilter: THREE.LinearFilter,
            generateMipmaps: false,
            colorSpace: THREE.NoColorSpace,
            format: THREE.RGBAFormat,
            type: THREE.UnsignedByteType,
        });
        tex.dispose();
    });

    it('bakes four different clouds, each spanning exactly [0, 1], that tile', () => {
        const size = 64;
        const field = bakeFbm(3141, size);
        expect(field).toHaveLength(size * size * 4);
        expect(Array.from(field).every(Number.isFinite)).toBe(true);
        const channels = [0, 1, 2, 3].map((c) => field.filter((_, i) => i % 4 === c));
        channels.forEach((channel) => {
            expect(Math.min(...channel)).toBe(0);
            expect(Math.max(...channel)).toBe(1);
            // Clouds, not static: a texel is close to its neighbour, also across the seam.
            let jump = 0;
            for (let y = 0; y < size; y++) {
                for (let x = 0; x < size; x++) {
                    jump = Math.max(jump, Math.abs(channel[y * size + x] - channel[y * size + ((x + 1) % size)]));
                    jump = Math.max(jump, Math.abs(channel[y * size + x] - channel[((y + 1) % size) * size + x]));
                }
            }
            expect(jump).toBeLessThan(0.5);
            expect(mean(Array.from(channel))).toBeGreaterThan(0.25);
            expect(mean(Array.from(channel))).toBeLessThan(0.75);
        });
        for (let a = 0; a < 4; a++) {
            for (let b = a + 1; b < 4; b++) expect(Array.from(channels[a])).not.toEqual(Array.from(channels[b]));
        }
        expect(bakeFbm(3141, size)).toEqual(field);
        expect(bakeFbm(3142, size)).not.toEqual(field);
    });

    it('builds the cloud texture with its own mip chain, down to one texel', () => {
        const size = 64;
        const field = bakeFbm(7, size);
        const tex = createFbmTexture(field, size);
        expect(tex.mipmaps.map((level) => level.width)).toEqual([64, 32, 16, 8, 4, 2, 1]);
        tex.mipmaps.forEach((level) => {
            expect(level.height).toBe(level.width);
            expect(level.data).toHaveLength(level.width * level.width * 4);
        });
        expect(tex.image.data).toBe(tex.mipmaps[0].data);
        expect(tex).toMatchObject({
            wrapS: THREE.RepeatWrapping,
            wrapT: THREE.RepeatWrapping,
            minFilter: THREE.LinearMipmapLinearFilter,
            generateMipmaps: false,
            type: THREE.HalfFloatType,
            colorSpace: THREE.NoColorSpace,
        });
        // Each level is the average of the one above: the last texel is the mean of the field.
        const last = tex.mipmaps[tex.mipmaps.length - 1].data;
        for (let c = 0; c < 4; c++) {
            const channel = Array.from(field.filter((_, i) => i % 4 === c));
            expect(THREE.DataUtils.fromHalfFloat(last[c])).toBeCloseTo(mean(channel), 2);
        }
        expect(THREE.DataUtils.fromHalfFloat(tex.mipmaps[0].data[5])).toBeCloseTo(field[5], 2);
        tex.dispose();
        expect(FBM_SIZE & (FBM_SIZE - 1)).toBe(0); // a power of two, or the chain is not whole
        expect(LATTICE_SIZE).toBeGreaterThan(37);
    });

    it('hands every material the same uniforms, with a dormant row for every impact and wave', () => {
        const lattice = createLatticeTexture(bakeLattice(1, 16), 16);
        const fbm = createFbmTexture(bakeFbm(1, 16), 16);
        const u = createVoidEmberUniforms({ lattice, fbm });
        expect(u.latticeTex).toBe(lattice);
        expect(u.fbmTex).toBe(fbm);
        expect(u.impacts.array).toHaveLength(core.IMPACT_SLOTS * 2);
        expect(u.waves.array).toHaveLength(core.WAVE_SLOTS * 3);
        expect(u.heat.value).toBe(REST_HEAT);
        expect(u.radius.value).toBe(EMBER.radius);
        expect(u.breath.value).toBe(1);
        expect(u.voidCol.value.toArray()).toEqual(VOID_PALETTES[0].void);
        for (const read of ['fbm', 'fbmLod', 'noise3']) expect(u[read]).toBeTypeOf('function');
    });
});

describe('void ember tiers', () => {
    it('defines every tier, in order, with every key', () => {
        expect(QUALITY_NAMES).toEqual(TIERS);
        const keys = Object.keys(QUALITY.High).sort();
        TIERS.forEach((tier) => {
            expect(Object.keys(QUALITY[tier]).sort(), tier).toEqual(keys);
            expect(Object.isFrozen(QUALITY[tier]), tier).toBe(true);
            expect(tierFor(tier)).toBe(QUALITY[tier]);
        });
        expect(tierFor('nope')).toBe(QUALITY.High);
        expect(tierFor(undefined)).toBe(QUALITY.High);
    });

    it('never asks less of a higher tier', () => {
        const flat = (tier) => Object.entries(QUALITY[tier]).flatMap(([key, value]) => (
            Array.isArray(value) ? value.map((v, i) => [`${key}[${i}]`, v]) : [[key, value]]
        ));
        for (let i = 1; i < TIERS.length; i++) {
            const lower = Object.fromEntries(flat(TIERS[i - 1]));
            for (const [key, value] of flat(TIERS[i])) {
                expect(Number(value), `${TIERS[i]}.${key}`).toBeGreaterThanOrEqual(Number(lower[key]));
            }
        }
        // And the two ends really differ.
        expect(QUALITY.Extreme.wind).toBeGreaterThan(QUALITY.Minimal.wind);
        expect(QUALITY.Extreme.sparks).toBeGreaterThan(QUALITY.Minimal.sparks);
        TIERS.forEach((tier) => {
            const q = QUALITY[tier];
            for (const count of [q.segments, q.wind, q.sparks, ...q.rocks]) {
                expect(Number.isInteger(count) && count > 0, tier).toBe(true);
            }
            // The pool holds what a whole star sheds when every loop is torn off at once.
            expect(loopSparkShare(q.sparks, LOOP_SLOTS) * LOOP_SLOTS, tier).toBeLessThanOrEqual(q.sparks);
        });
    });

    it('gives the post a look for every tier, heavier as the tier rises', () => {
        expect(Object.keys(POST_LOOK).sort()).toEqual([...TIERS].sort());
        const keys = Object.keys(POST_LOOK.High).sort();
        TIERS.forEach((tier, i) => {
            const look = POST_LOOK[tier];
            expect(Object.keys(look).sort(), tier).toEqual(keys);
            // No bloom, no rays and no streak: they are the bloom, dragged.
            if (!look.bloom) {
                expect(look.rays, tier).toBe(0);
                expect(look.streak, tier).toBe(0);
            } else {
                expect(look.bloomStrength, tier).toBeGreaterThan(0);
            }
            expect(look.bloomResolution, tier).toBeGreaterThan(0);
            expect(look.bloomResolution, tier).toBeLessThanOrEqual(1);
            expect([0, 2, 4, 8], tier).toContain(look.msaa);
            if (i === 0) return;
            const lower = POST_LOOK[TIERS[i - 1]];
            for (const key of keys) {
                expect(Number(look[key]), `${tier}.${key}`).toBeGreaterThanOrEqual(Number(lower[key]));
            }
        });
    });
});

describe('void ember playground effect: the URL parameter reference', () => {
    const file = 'src/playground/effects/void-ember.effect.js';
    const effect = readFileSync(path.join(root, file), 'utf8');
    const documented = URL_PARAMETER_CATALOG.filter((entry) => entry.sources.includes(file));

    it('documents every URL parameter the effect reads, and nothing it does not', () => {
        const read = new Set();
        for (const match of effect.matchAll(/params\.(?:get|has)\('([A-Za-z]+)'\)|num\(params, '([A-Za-z]+)'/g)) {
            read.add(match[1] || match[2]);
        }
        expect(read.size).toBeGreaterThan(10);
        expect(documented.map((entry) => entry.name).sort()).toEqual([...read].sort());
        for (const entry of documented) {
            expect(entry.category, entry.name).toBe('Playground');
            expect(entry.scope, entry.name).toMatch(/\bvoid-ember\b/);
        }
        // The header comment is the effect's own list: every parameter it names is one it reads.
        const header = effect.slice(effect.indexOf('/**'), effect.indexOf('*/', effect.indexOf('/**')));
        const named = [...header.matchAll(/^ \* {3}([A-Za-z]+)=/gm)].map((match) => match[1]);
        expect(named.length).toBeGreaterThan(10);
        for (const name of named) expect(read.has(name), `header names ${name}`).toBe(true);
    });

    it('quotes the defaults the effect really has', () => {
        const fallback = (name) => Number(new RegExp(`num\\(params, '${name}', (-?[0-9.]+)\\)`).exec(effect)[1]);
        const quoted = (name) => documented.find((entry) => entry.name === name).defaultValue;
        expect(quoted('iconFov')).toContain(`Void Ember ${fallback('iconFov')}`);
        expect(quoted('iconYaw')).toContain(`Void Ember ${fallback('iconYaw')} radians`);
        expect(quoted('iconPitch')).toContain(`Void Ember ${fallback('iconPitch')} radians`);
        expect(quoted('row')).toContain(`Void Ember ${fallback('row')}`);
        expect(quoted('u')).toContain(String(fallback('u')));
        // The cues it replays are the ones the reference lists for it.
        const cues = [...effect.matchAll(/eventName === '([A-Za-z]+)'/g)].map((match) => match[1]);
        expect(cues.length).toBeGreaterThan(4);
        const listed = documented.find((entry) => entry.name === 'event').values;
        const mine = /\(([^)]*Void Ember[^)]*)\)/.exec(listed)[1];
        for (const cue of cues) expect(mine, cue).toMatch(new RegExp(`\\b${cue}\\b`));
        // ?parts takes the world's own names, and its `rocks` alias is mentioned beside them.
        expect(documented.find((entry) => entry.name === 'parts').values).toMatch(/Void Ember.*\brocks\b/);
        const flag = URL_PARAMETER_CATALOG.find((entry) => entry.name === 'voidEmberParts');
        const listedParts = flag.values.replace(/^[^:]*:/, '').split(',').map((name) => name.trim());
        expect([...listedParts].sort()).toEqual([...VOID_EMBER_PARTS].sort());
        expect(flag.notes).toMatch(/\brocks\b/);
        expect(VOID_EMBER_PARTS).toContain(flag.example.replace('voidEmberParts=', ''));
    });
});
