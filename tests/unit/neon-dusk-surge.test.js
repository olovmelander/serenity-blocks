/**
 * Neon Dusk builds with play (src/themes/shared/gameplay-surge.js): every event adds to what is
 * still lit, a long chain reads hotter than its first clear, the world breathes back when the
 * hands rest, the late perfect clear crowns the clear before it, the locked piece's hologram is
 * one solid shape, and Reduce flashing holds the tape glitch back.
 */
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';

import NeonDuskTheme from '../../src/themes/neon-dusk/neon-dusk-theme.js';
import { NeonDuskWorld, PIECE_COLORS, TETROMINO_SHAPES } from '../../src/themes/neon-dusk/neon-dusk-world.js';
import { OUTLINE_BITS, pieceOutlineBits } from '../../src/themes/neon-dusk/neon-dusk-fx.js';
import { GLITCH_CUTS } from '../../src/themes/neon-dusk/neon-dusk-post.js';
import { REDUCED_FLASH_SCALE } from '../../src/utils/photosensitivity.js';

const DT = 1 / 60;

function makeWorld() {
    let s = 7;
    const random = () => {
        s = (s * 16807) % 2147483647;
        return (s - 1) / 2147483646;
    };
    const world = new NeonDuskWorld({ scene: new THREE.Scene(), random }).build();
    world.setLayout(16 / 9, null, { immediate: true });
    world.update({ time: 10, delta: DT });
    return world;
}

/** Run the world's frames from its time to `until`. */
function runTo(world, until) {
    for (let t = world.time + DT; t <= until + 1e-9; t += DT) world.update({ time: t, delta: DT });
}

/** One clearing lock, hard-dropped, as the tray's Fever plays it. */
function clearingLock(world, lines, type = 'I') {
    world.onHardDrop();
    world.onPieceLock({ type, x: 2, rotation: 0 });
    world.onLineClear(lines, { cascade: 1 });
}

/** The live scan sweeps: [distance, energy] for each slot with light. */
function sweeps(world) {
    const a = world.u.contourA.value;
    const b = world.u.contourB.value;
    return [[a.x, a.y], [a.z, a.w], [b.x, b.y], [b.z, b.w]].filter(([, e]) => e > 0);
}

describe('neon-dusk builds with play', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('never cuts the light: a single after a quad adds to it, and a cascade sweeps the ranges as a train', () => {
        const world = makeWorld();
        clearingLock(world, 4);
        runTo(world, world.time + 0.3);
        const glow = world.sunPulse;
        const quadSweep = sweeps(world)[0];
        expect(quadSweep[1]).toBeGreaterThan(0.5);

        // A weak single, 0.3 s on: the sun only rises, the quad's sweep rolls on undisturbed.
        clearingLock(world, 1, 'O');
        runTo(world, world.time + DT);
        expect(world.sunPulse).toBeGreaterThanOrEqual(glow * 0.98);
        const after = sweeps(world);
        expect(after.length).toBe(2);
        expect(after.some(([d, e]) => d < quadSweep[0] && e > 0.5)).toBe(true);

        // A four-wave cascade (waves 360 ms apart): every wave sends its own sweep, deeper
        // waves faster and brighter, and the first one still reaches the near range.
        const cold = makeWorld();
        cold.onPieceLock({ type: 'S', x: 4 });
        cold.onLineClear(2, { cascade: 1 });
        const energies = [];
        let nearest = Infinity;
        for (let w = 2; w <= 4; w += 1) {
            const until = cold.time + 0.36;
            while (cold.time < until - 1e-9) {
                runTo(cold, cold.time + DT);
                for (const [d] of sweeps(cold)) nearest = Math.min(nearest, d);
            }
            cold.onCombo(w);
            cold.onLineClear(1, { cascade: w });
            runTo(cold, cold.time + DT);
            energies.push(Math.max(...cold.contours.map((c) => (cold.time - c.t0 < 0.1 ? c.energy : 0))));
        }
        expect(sweeps(cold).length).toBeGreaterThanOrEqual(3);
        expect(energies[2]).toBeGreaterThan(energies[0]);
        for (let i = 0; i < 90; i += 1) {
            runTo(cold, cold.time + DT);
            for (const [d] of sweeps(cold)) nearest = Math.min(nearest, d);
        }
        expect(nearest).toBeLessThan(700);
        world.dispose();
        cold.dispose();
    });

    it('reads a long chain hotter than its first clear, then breathes back to calm when the hands rest', () => {
        const world = makeWorld();
        const rest = {
            scan: world.u.scanGain.value,
            shift: world.u.comboShift.value,
            lift: world.u.tileLift.value,
            pulse: world.u.pulse.value.y,
        };
        clearingLock(world, 1);
        runTo(world, world.time + 0.3);
        const first = {
            scan: world.u.scanGain.value,
            shift: world.u.comboShift.value,
            heat: world.u.sunHeat.value,
            pulse: world.u.pulse.value.y,
        };
        for (let n = 0; n < 11; n += 1) {
            runTo(world, world.time + 0.64);
            clearingLock(world, 1 + (n % 3), ['I', 'O', 'L'][n % 3]);
        }
        runTo(world, world.time + 0.3);
        expect(world.combo.combo).toBe(12);
        expect(world.heat.stage).toBe(3);
        expect(world.u.scanGain.value).toBeGreaterThan(first.scan + 0.6);
        expect(world.u.comboShift.value).toBeGreaterThan(first.shift + 0.4);
        expect(world.u.sunHeat.value).toBeGreaterThan(first.heat + 0.5);
        expect(world.u.pulse.value.y).toBeGreaterThan(first.pulse * 2);
        expect(world.u.tileLift.value).toBeGreaterThan(rest.lift);
        const scrollRate = (w) => {
            const before = w.scrollRun;
            runTo(w, w.time + 0.5);
            return (w.scrollRun - before) / 0.5;
        };
        expect(scrollRate(world)).toBeGreaterThan(12);

        // The hands rest: the dusk comes back to itself within a few seconds, never snapping.
        let last = world.u.scanGain.value;
        for (let i = 0; i < 12 * 60; i += 1) {
            runTo(world, world.time + DT);
            expect(world.u.scanGain.value).toBeLessThanOrEqual(last + 0.02);
            last = world.u.scanGain.value;
        }
        expect(world.heat.stage).toBe(0);
        expect(world.u.scanGain.value).toBeCloseTo(rest.scan, 2);
        expect(world.u.tileLift.value).toBeCloseTo(rest.lift, 2);
        expect(world.u.comboShift.value).toBeLessThan(0.05);
        expect(world.u.pulse.value.y).toBeCloseTo(rest.pulse, 2);
        expect(scrollRate(world)).toBeCloseTo(6, 1);
        world.dispose();
    });

    it('crowns the clear still playing with the late perfect clear: no new clear, no second inward wave', () => {
        const world = makeWorld();
        clearingLock(world, 4);
        runTo(world, world.time + 0.36);
        const { combo } = world.combo;
        const inward = world.rings.filter((r) => !r.out && r.energy > 0).length;
        world.onPerfectClear();
        runTo(world, world.time + 0.4);
        expect(world.u.crown.value).toBeGreaterThan(0.6);
        expect(world.combo.combo).toBe(combo);
        expect(world.rings.filter((r) => !r.out && r.energy > 0).length).toBe(inward);
        // ...and the glass breathes the light back out to the horizon as the crown lets go.
        expect(world.rings.some((r) => r.out && r.energy > 0)).toBe(true);
        runTo(world, world.time + 4);
        expect(world.u.crown.value).toBeLessThan(0.1);
        world.dispose();
    });

    it('answers a hard drop, a T-spin that clears nothing, and back-to-back', () => {
        const world = makeWorld();
        world.onHardDrop();
        world.onPieceLock({ type: 'T', x: 2 });
        expect(Math.max(...world.ripples.map((r) => r.energy))).toBeCloseTo(1.5);

        runTo(world, world.time + 0.5);
        world.onTSpin(0);
        runTo(world, world.time + 0.2);
        const spun = world.holos.find((h) => h.energy > 0);
        expect(spun.spin).not.toBe(0);

        runTo(world, world.time + 3);
        world.onB2B(true);
        runTo(world, world.time + 0.3);
        expect(world.holos.filter((h) => h.energy > 0 && h.spin !== 0).length).toBe(2);
        expect(sweeps(world).length).toBeGreaterThanOrEqual(2);
        world.dispose();
    });

    it('stands the Serenity tray\'s pieces up in their own shape and colour (it sends shapeKey, not type)', () => {
        const world = makeWorld();
        world.onPieceLock({ shapeKey: 'I', x: 3, rotation: 0 });
        const { iCell, iTint } = world.fx.tiles;
        const live = [];
        for (let i = 0; i < iCell.count; i += 1) {
            if (iCell.array[i * 4 + 2] > -1e5) live.push(i);
        }
        expect(live).toHaveLength(4);
        const want = new THREE.Color(PIECE_COLORS.I);
        for (const i of live) {
            expect(iTint.array[i * 4]).toBeCloseTo(want.r, 5);
            expect(iTint.array[i * 4 + 2]).toBeCloseTo(want.b, 5);
        }
        // Four in one row.
        expect(new Set(live.map((i) => iCell.array[i * 4 + 1].toFixed(3))).size).toBe(1);

        // The piece's own colour when it carries one.
        world.seek(world.time);
        world.onPieceLock({ shapeKey: 'Z', x: 3, color: '#123456' });
        const own = new THREE.Color('#123456');
        const slot = [...Array(iCell.count).keys()].find((i) => iCell.array[i * 4 + 2] > -1e5);
        expect(iTint.array[slot * 4 + 1]).toBeCloseTo(own.g, 5);
        world.dispose();
    });

    it('draws each locked piece as one solid shape: no walls or edges between its cells, one outline round it', () => {
        const B = OUTLINE_BITS;
        const walls = [
            [B.joinPX, B.endPXtoPZ, B.endPXtoNZ],
            [B.joinNX, B.endNXtoPZ, B.endNXtoNZ],
            [B.joinPZ, B.endPZtoPX, B.endPZtoNX],
            [B.joinNZ, B.endNZtoPX, B.endNZtoNX],
        ];
        const corners = [B.cornerPXPZ, B.cornerNXPZ, B.cornerPXNZ, B.cornerNXNZ];
        const outline = (type) => {
            const bits = pieceOutlineBits(TETROMINO_SHAPES[type]);
            let uprights = 0;
            let inner = 0;
            let joins = 0;
            for (const b of bits) {
                for (const [join, endA, endB] of walls) {
                    if (b & join) {
                        joins += 1;
                    } else {
                        uprights += ((b & endA) ? 1 : 0) + ((b & endB) ? 1 : 0);
                    }
                }
                for (const c of corners) inner += (b & c) ? 1 : 0;
            }
            // Each vertex of the outline is where two outer walls end.
            return { vertices: uprights / 2, inner, joins };
        };
        // Every side two cells share is joined from both cells (the O's four, the others' three).
        for (const type of Object.keys(TETROMINO_SHAPES)) expect(outline(type).joins, type).toBe(type === 'O' ? 8 : 6);
        expect(outline('I')).toMatchObject({ vertices: 4, inner: 0 });
        expect(outline('O')).toMatchObject({ vertices: 4, inner: 0 });
        expect(outline('L')).toMatchObject({ vertices: 6, inner: 1 });
        expect(outline('J')).toMatchObject({ vertices: 6, inner: 1 });
        expect(outline('T')).toMatchObject({ vertices: 8, inner: 2 });
        expect(outline('S')).toMatchObject({ vertices: 8, inner: 2 });
        expect(outline('Z')).toMatchObject({ vertices: 8, inner: 2 });
    });

    it('holds the tape glitch back under Reduce flashing and re-cuts it under 3 Hz', () => {
        expect(GLITCH_CUTS).toBeLessThan(3);
        vi.stubGlobal('window', {
            settings: { reduceFlashing: true }, innerWidth: 1920, innerHeight: 1080, location: { search: '' },
        });
        const theme = new NeonDuskTheme();
        const post = { update: vi.fn(), render: vi.fn() };
        theme.postProcessing = post;
        theme.camera = {};
        theme.world = {
            updateCamera: vi.fn(),
            update: vi.fn(),
            sunPulse: 0.5,
            glitch: 1,
            drive: { exposure: 0.9, bloomGain: 1.1 },
        };
        theme.stepFrame(16);
        expect(post.update.mock.calls[0][0].glitch).toBeCloseTo(REDUCED_FLASH_SCALE);
        expect(post.update.mock.calls[0][0].exposure).toBeCloseTo(0.9);
        window.settings.reduceFlashing = false;
        theme.stepFrame(32);
        expect(post.update.mock.calls[1][0].glitch).toBeCloseTo(1);
    });
});
