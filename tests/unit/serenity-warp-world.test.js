/**
 * Serenity Warp — the world, on the CPU: a real SerenityWarpWorld in a THREE.Scene, no renderer
 * (the environment target is simply not painted).
 *
 * These pin behaviour and contracts — what a lock, a clear, a chain, four lines and a new level
 * DO, in what order and how often — never a tuning number: constants are imported, and the
 * assertions are relations (counted, ordered, bounded, monotonic).
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import {
    REST_RIG, SERENITY_WARP_PARTS, SerenityWarpWorld, fovForAspect,
} from '../../src/themes/serenity-warp/serenity-warp-world.js';
import {
    BIRTH_FLIGHT, CELL, DIVE_LOCK, FALL_PULLED, GATE, HUSH_HOLD, JUMP_TUNNEL, JUMP_EXIT, PALETTE_HOME, PALETTE_STEP, SHAPES,
    SKY_PALETTES, cellsFromMatrix, packCells, unpackCell,
} from '../../src/themes/serenity-warp/serenity-warp-core.js';
import { QUALITY } from '../../src/themes/serenity-warp/serenity-warp-quality.js';
import { fallbackLayout } from '../../src/themes/serenity-warp/serenity-warp-composition.js';
import { SERENITY_WARP_TETROMINOS } from '../../src/themes/serenity-warp/serenity-warp-tetrominos.js';

const COLORS = SERENITY_WARP_TETROMINOS.colors;
const DEG = Math.PI / 180;

function makeWorld(quality = 'Minimal', {
    width = 1600, height = 900, layout, at = 10, reduce = false,
} = {}) {
    const scene = new THREE.Scene();
    const aspect = width / height;
    const camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, REST_RIG.near, REST_RIG.far);
    const world = new SerenityWarpWorld({ scene, quality, capture: true }).build();
    world.bindCamera(camera);
    world.setReducedMotion(reduce);
    world.setViewport(width, height, aspect);
    world.setLayout(layout === undefined ? fallbackLayout(width, height) : layout, aspect);
    settle(world, camera, at);
    return { scene, camera, world };
}

function settle(world, camera, time) {
    world.seek(time);
    const sim = {
        time, delta: 0, pointerX: 0, pointerY: 0,
    };
    world.updateCamera(camera, sim);
    world.update(sim, camera);
}

/** One frame as the theme runs it: the camera, the gameplay staged since the last frame, the world. */
function frame(world, camera, dt, during = null) {
    const sim = {
        time: world.time + dt, delta: dt, pointerX: 0, pointerY: 0,
    };
    world.updateCamera(camera, sim);
    during?.();
    world.update(sim, camera);
}

function run(world, camera, seconds, dt = 1 / 30) {
    const steps = Math.round(seconds / dt);
    for (let i = 0; i < steps; i++) frame(world, camera, dt);
}

const T_CELLS = cellsFromMatrix(SHAPES.T);
const lock = (world, extra = {}) => world.onLock({
    u: 0.3, rows: [12, 11], color: COLORS.T, cells: T_CELLS, ...extra,
});

describe('Serenity Warp world', () => {
    it('builds every part once, for every tier, with the tier\'s pools', () => {
        for (const quality of Object.keys(QUALITY)) {
            const { world, scene } = makeWorld(quality);
            expect(Object.keys(world.parts).sort()).toEqual([...SERENITY_WARP_PARTS].sort());
            expect(world.capacity).toBe(Math.min(24, QUALITY[quality].pieces));
            expect(world.stars.count).toBe(QUALITY[quality].stars);
            expect(world.motes.count).toBe(QUALITY[quality].motes);
            const materials = [];
            scene.traverse((o) => { if (o.material) materials.push(o.material); });
            expect(materials.every((m) => m.isNodeMaterial)).toBe(true);
            world.dispose();
            expect(scene.children).toHaveLength(0);
        }
    });

    it('is never empty: with no play the drifting pieces are already on their way', () => {
        const { world, camera } = makeWorld('High', { at: 30 });
        const state = world.getState();
        expect(state.pieces).toBe(QUALITY.High.ambient);
        expect(state.lockPieces).toBe(0);
        // And it stays populated as they fall in and others drift in from the edge.
        run(world, camera, 120, 1 / 10);
        const later = world.getState();
        expect(later.pieces).toBeGreaterThanOrEqual(QUALITY.High.ambient - 2);
        expect(later.counts.falls).toBeGreaterThan(0);
        expect(later.counts.spawned).toBeGreaterThan(QUALITY.High.ambient);
    });

    it('replays any moment exactly: a seek is a function of the clock', () => {
        const a = makeWorld('Medium', { at: 47.5 }).world;
        const b = makeWorld('Medium', { at: 47.5 }).world;
        expect(a.getState()).toEqual(b.getState());
        expect(a.glass.snapshot()).toEqual(b.glass.snapshot());
    });

    it('turns a lock into a piece of glass with the locked shape, colour and turn, hot, leaving the card', () => {
        const { world, camera } = makeWorld('High');
        const before = world.getState().pieces;
        let born = null;
        frame(world, camera, 1 / 60, () => {
            lock(world, { cells: cellsFromMatrix([[1, 0, 0], [1, 1, 1]]) });
            born = world.pieces.find((p) => p.live && p.lock);
        });
        expect(born).toBeTruthy();
        expect(world.getState().pieces).toBe(before + 1);
        expect(world.getState().counts.locks).toBe(1);
        // It is the J it locked as: one solid piece of that shape, its cells packed for the shader.
        expect(born.shape).toBe(5);
        expect(born.turns).toBe(0);
        const cells = [];
        born.codes.forEach((code) => cells.push(...unpackCell(code)));
        expect(cells).toEqual(cellsFromMatrix(SHAPES.J));
        // White hot, in its colour, facing the camera the way the board showed it.
        expect(born.hot).toBeGreaterThan(0.9);
        expect(born.rgb[2]).toBeCloseTo(1, 5); // T is blue
        expect(born.q0).toEqual([camera.quaternion.x, camera.quaternion.y, camera.quaternion.z, camera.quaternion.w]);
        // It has come out of the card on the gate's side once its flight is over.
        run(world, camera, BIRTH_FLIGHT + 0.1, 1 / 60);
        const at = world.worldToScreen(born.place, { x: 0, y: 0 });
        const card = world.layout.cards[0];
        expect(at.x).toBeLessThan(card.x0);
        expect(at.x).toBeGreaterThan(world.heart.x);
        // A flare and a ripple went out with it.
        expect(world.flares.table.some((row, i) => i % 2 === 1 && row.w > 0)).toBe(true);
        expect(world.getState().ripples).toBe(1);
    });

    it('keeps the turn a piece locked in: a quarter-turned L is an L, turned a quarter about its face', () => {
        const { world, camera } = makeWorld('High');
        // L turned once clockwise on the board.
        const turned = cellsFromMatrix([[1, 0], [1, 0], [1, 1]]);
        frame(world, camera, 1 / 60, () => lock(world, { cells: turned }));
        const piece = world.pieces.find((p) => p.live && p.lock);
        expect(piece.shape).toBe(6);
        expect(piece.turns).toBe(3);
        // Its base turn is the camera's, turned three quarters about the view axis.
        const q = new THREE.Quaternion(...piece.q0);
        const face = camera.quaternion.clone().invert().multiply(q);
        const axis = new THREE.Vector3(0, 0, 1).applyQuaternion(face);
        expect(axis.z).toBeCloseTo(1, 6);
        // The shader is handed the shape's own spawn cells; the turn is in the quaternion.
        const cells = [];
        piece.codes.forEach((code) => cells.push(...unpackCell(code)));
        expect(cells).toEqual(cellsFromMatrix(SHAPES.L));
    });

    it('sizes a lock piece from the board cells, within bounds', () => {
        const big = fallbackLayout(1600, 900);
        const small = JSON.parse(JSON.stringify(big));
        // The same board at two thirds of the height: its cells are smaller on screen.
        const b = small.boards[0];
        const mid = (b.y0 + b.y1) / 2;
        const half = ((b.y1 - b.y0) / 2) * 0.66;
        b.y0 = mid - half;
        b.y1 = mid + half;
        const one = makeWorld('High', { layout: big });
        frame(one.world, one.camera, 1 / 60, () => lock(one.world));
        const two = makeWorld('High', { layout: small });
        frame(two.world, two.camera, 1 / 60, () => lock(two.world));
        const p1 = one.world.pieces.find((p) => p.live && p.lock);
        const p2 = two.world.pieces.find((p) => p.live && p.lock);
        expect(p2.scale).toBeLessThan(p1.scale);
        expect(p2.scale).toBeGreaterThanOrEqual(CELL * 0.55 - 1e-9);
        expect(p1.scale).toBeLessThanOrEqual(CELL + 1e-9);
        // And it dives: the run it takes is a lock run.
        expect(p1.start.dive).toBe(DIVE_LOCK);
    });

    it('gives a hard drop a heavier piece, a kick and a stronger ripple', () => {
        const { world, camera } = makeWorld('High');
        frame(world, camera, 1 / 60, () => lock(world, { hardDrop: true }));
        const piece = world.pieces.find((p) => p.live && p.lock);
        const { world: soft, camera: c2 } = makeWorld('High');
        frame(soft, c2, 1 / 60, () => lock(soft));
        const softPiece = soft.pieces.find((p) => p.live && p.lock);
        expect(piece.scale).toBeGreaterThan(softPiece.scale);
        expect(piece.flight).toBeLessThan(softPiece.flight);
        expect(world.rippleSlots[0].strength).toBeGreaterThan(soft.rippleSlots[0].strength);
        frame(world, camera, 1 / 60);
        expect(world.kick).toBeGreaterThan(soft.kick);
    });

    it('never holds more glass than its tier, and keeps room for the next lock', () => {
        const { world, camera } = makeWorld('Low');
        for (let i = 0; i < 60; i++) {
            frame(world, camera, 0.4, () => lock(world, { u: (i * 0.37) % 1, color: COLORS[Object.keys(SHAPES)[i % 7]] }));
            const state = world.getState();
            expect(state.pieces).toBeLessThanOrEqual(world.capacity);
        }
        expect(world.getState().counts.locks).toBe(60);
        expect(world.getState().counts.falls).toBeGreaterThan(20);
    });

    it('sends one wave and one piece into the throat per line, and the rows\' light into the gate', () => {
        const { world, camera } = makeWorld('High', { at: 20 });
        const { falls } = world.getState().counts;
        frame(world, camera, 1 / 60, () => world.onClear({ rows: [19, 18, 17], lines: 3 }));
        expect(world.getState().counts.clears).toBe(1);
        run(world, camera, 0.4, 1 / 60);
        const state = world.getState();
        expect(state.waves).toBe(3);
        expect(state.falling).toBeGreaterThanOrEqual(3);
        // Streams from three rows of the card.
        const streams = world.streams.table.filter((row, i) => i % 2 === 0 && row.w > 0);
        expect(streams).toHaveLength(3);
        run(world, camera, FALL_PULLED + 0.4, 1 / 60);
        expect(world.getState().counts.falls).toBeGreaterThanOrEqual(falls + 3);
        // A piece that fell flared the rim in its colour.
        expect(world.rimFlash).toBeGreaterThan(0);
    });

    it('flares the glass as a wave passes through it', () => {
        const { world, camera } = makeWorld('High', { at: 20 });
        const before = world.pieces.filter((p) => p.live).map((p) => p.charge);
        frame(world, camera, 1 / 60, () => world.onClear({ rows: [19], lines: 1 }));
        let peak = 0;
        for (let i = 0; i < 90; i++) {
            frame(world, camera, 1 / 60);
            const live = world.pieces.filter((p) => p.live).map((p) => p.charge);
            peak = Math.max(peak, ...live);
        }
        expect(peak).toBeGreaterThan(Math.max(...before) + 0.3);
    });

    it('holds its breath on four lines, then opens the throat round us and lets us out under the other sky', () => {
        const { world, camera } = makeWorld('High', { at: 20 });
        const here = world.u.hereShift.value.clone();
        const there = world.u.thereShift.value.clone();
        frame(world, camera, 1 / 60, () => world.onClear({ rows: [19, 18, 17, 16], lines: 4 }));
        run(world, camera, HUSH_HOLD * 0.5, 1 / 60);
        expect(world.breath).toBeLessThan(0.5);
        run(world, camera, HUSH_HOLD * 0.5 + 1.0, 1 / 60);
        const inside = world.getState();
        expect(inside.jump).toBe(1);
        expect(inside.gateRadius).toBeGreaterThan(90 * DEG);
        expect(inside.counts.quads).toBe(1);
        run(world, camera, JUMP_TUNNEL + JUMP_EXIT, 1 / 60);
        const out = world.getState();
        expect(out.jump).toBe(0);
        expect(out.jumps).toBe(1);
        expect(out.gateRadius).toBeLessThan(10 * DEG);
        // We came out where the throat looked: our sky is the one it showed, and it shows a new one.
        expect(world.u.hereShift.value.equals(there)).toBe(true);
        expect(world.u.thereShift.value.equals(there)).toBe(false);
        expect(world.u.hereShift.value.equals(here)).toBe(false);
    });

    it('winds the warp up step by step through a chain and lets it go when the chain breaks', () => {
        const { world, camera } = makeWorld('High', { at: 20 });
        const rest = world.getState();
        let last = rest.warp;
        for (let n = 2; n <= 6; n++) {
            world.onCombo(n);
            run(world, camera, 1.2, 1 / 30);
            const s = world.getState();
            expect(s.warp).toBeGreaterThan(last);
            last = s.warp;
        }
        expect(world.getState().current).toBeGreaterThan(rest.current);
        // Each step sent a ring in the nebula's glow.
        expect(world.waveCursor).toBe(5);
        world.onCombo(0);
        run(world, camera, 6, 1 / 30);
        expect(world.getState().warp).toBeLessThan(last * 0.3);
    });

    it('twists the vortex on a T-spin and lets it spring back', () => {
        const { world, camera } = makeWorld('High', { at: 20 });
        frame(world, camera, 1 / 60, () => world.onClear({ rows: [19, 18], lines: 2, tspin: true }));
        run(world, camera, 0.15, 1 / 60);
        expect(Math.abs(world.twist)).toBeGreaterThan(0.02);
        run(world, camera, 4, 1 / 60);
        expect(Math.abs(world.twist)).toBeLessThan(0.005);
    });

    it('moves the sky a palette along on a new level, and the clock moves it on its own', () => {
        const { world, camera } = makeWorld('High', { at: 1 });
        expect(world.getState().palette).toBe(SKY_PALETTES[PALETTE_HOME].name);
        world.levelUp(2);
        run(world, camera, 8, 1 / 20);
        expect(world.levelPlace).toBeCloseTo(1, 2);
        // The throat always shows the next one along.
        expect(world.getState().there).not.toBe(world.getState().palette);
        // With no play at all the clock carries it one palette per step.
        const { world: idle } = makeWorld('High', { at: 1 });
        const { world: later } = makeWorld('High', { at: 1 + PALETTE_STEP });
        expect(later.getState().palette).not.toBe(idle.getState().palette);
        expect(later.getState().level).toBe(1);
    });

    it('starts a new run at rest, keeping the clock and the glass already in flight', () => {
        const { world, camera } = makeWorld('High', { at: 20 });
        lock(world);
        world.onCombo(5);
        run(world, camera, 1, 1 / 30);
        const { pieces } = world.getState();
        const { time } = world;
        world.resetSession();
        expect(world.combo).toBe(0);
        expect(world.time).toBe(time);
        expect(world.getState().pieces).toBe(pieces);
    });

    it('runs the current slower for reduced motion', () => {
        const calm = makeWorld('High', { reduce: true }).world;
        const full = makeWorld('High').world;
        expect(calm.getState().current).toBeLessThan(full.getState().current);
    });

    it('hands the post one reused object, pointing at the gate', () => {
        const { world, camera } = makeWorld('High');
        const post = world.getPostState();
        frame(world, camera, 1 / 60);
        expect(world.getPostState()).toBe(post);
        expect(post.heart.x).toBeLessThan(0.35);
        expect(post.exposure).toBeGreaterThan(0);
        expect(post.exposure).toBeLessThanOrEqual(1);
    });

    it('puts the gate where the composition wants it, in landscape and on a phone', () => {
        const wide = makeWorld('Low', { width: 1600, height: 900 }).world;
        const { anchors } = wide;
        expect(wide.heart.x).toBeCloseTo(anchors.x, 1);
        expect(wide.heart.y).toBeCloseTo(anchors.y, 1);
        const phone = makeWorld('Low', { width: 390, height: 844, layout: null }).world;
        expect(phone.heart.y).toBeLessThan(0.3);
        // The throat at rest is the size the composition gives it.
        expect(wide.getState().gateRadius).toBeCloseTo(GATE.radius * DEG, 3);
    });

    it('feeds a jump already running: four more lines and the crown stretch the tunnel, and we arrive once', () => {
        const { world, camera } = makeWorld('High', { at: 20 });
        const there = world.u.thereShift.value.clone();
        frame(world, camera, 1 / 60, () => world.onClear({ rows: [19, 18, 17, 16], lines: 4 }));
        run(world, camera, HUSH_HOLD + 1.0, 1 / 60);
        const first = world.getState();
        expect(first.jump).toBe(1);
        // Four more lines inside the throat: no second hush, no restart; the tunnel runs on, faster.
        frame(world, camera, 1 / 60, () => world.onClear({ rows: [19, 18, 17, 16], lines: 4 }));
        let lowest = 1;
        let breath = 1;
        for (let i = 0; i < 40; i++) {
            frame(world, camera, 1 / 60);
            lowest = Math.min(lowest, world.getState().jump);
            breath = Math.min(breath, world.breath);
        }
        expect(lowest).toBe(1);
        expect(breath).toBeGreaterThan(0.99);
        const fed = world.getState();
        expect(fed.jumpLength).toBeGreaterThan(first.jumpLength);
        expect(fed.jumpDepth).toBe(1);
        expect(fed.gateRadius).toBeGreaterThan(90 * DEG);
        // The perfect clear that settles after it crowns the same jump.
        frame(world, camera, 1 / 60, () => world.onPerfect({ player: 0 }));
        expect(world.getState().jumpLength).toBeGreaterThan(fed.jumpLength);
        expect(world.getState().jump).toBe(1);
        run(world, camera, 8 + JUMP_EXIT, 1 / 30);
        const out = world.getState();
        expect(out.jump).toBe(0);
        // One arrival: our sky is the one the throat showed, swapped exactly once.
        expect(out.jumps).toBe(1);
        expect(world.u.hereShift.value.equals(there)).toBe(true);
        expect(out.counts.quads).toBe(2);
        expect(out.counts.crowns).toBe(1);
    });

    it('crowns a quad with the perfect clear that settles after it: one hush, one jump, one arrival', () => {
        const { world, camera } = makeWorld('High', { at: 20 });
        frame(world, camera, 1 / 60, () => world.onClear({ rows: [19, 18, 17, 16], lines: 4 }));
        run(world, camera, HUSH_HOLD + 0.1, 1 / 60);
        // The hush is over and the throat is opening when the crown lands (physics: ~360 ms later).
        // The breath only comes back from here: no second hush.
        let prev = world.breath;
        frame(world, camera, 1 / 60, () => world.onPerfect({ player: 0 }));
        for (let i = 0; i < 60; i++) {
            frame(world, camera, 1 / 60);
            expect(world.breath).toBeGreaterThanOrEqual(prev - 1e-9);
            prev = world.breath;
        }
        expect(world.getState().jumpLength).toBeGreaterThan(JUMP_TUNNEL);
        const rings = world.waveCursor;
        run(world, camera, JUMP_TUNNEL + JUMP_EXIT + 1, 1 / 30);
        expect(world.getState().jumps).toBe(1);
        // Crowned: the arrival sent more than its one ring, and its afterglow is the perfect one.
        expect(world.waveCursor - rings).toBeGreaterThanOrEqual(3);
        expect(world.getState().counts.crowns).toBe(1);
        expect(world.surge).toBeGreaterThan(0.5);
    });

    it('a quad mid-fever only inhales: the hush is as deep as play is cold', () => {
        const hushOf = (world, camera) => {
            let breath = 1;
            frame(world, camera, 1 / 60, () => world.onClear({ rows: [19, 18, 17, 16], lines: 4 }));
            for (let i = 0; i < Math.round(HUSH_HOLD * 60); i++) {
                frame(world, camera, 1 / 60);
                breath = Math.min(breath, world.breath);
            }
            return breath;
        };
        const cold = makeWorld('High', { at: 20 });
        const coldBreath = hushOf(cold.world, cold.camera);
        const hot = makeWorld('High', { at: 20 });
        for (let n = 1; n <= 10; n++) {
            frame(hot.world, hot.camera, 1 / 60, () => {
                lock(hot.world, { hardDrop: true });
                hot.world.onClear({ rows: [19, 18], lines: 2, combo: n });
                hot.world.onCombo(n);
            });
            run(hot.world, hot.camera, 0.62, 1 / 60);
        }
        expect(hot.world.heat.level).toBeGreaterThan(0.6);
        const hotBreath = hushOf(hot.world, hot.camera);
        expect(coldBreath).toBeLessThan(0.4);
        expect(hotBreath).toBeGreaterThan(coldBreath + 0.3);
    });

    it('builds with a long chain past what its first clear showed, and breathes back when the hands rest', () => {
        const { world, camera } = makeWorld('High', { at: 20 });
        const rest = {
            radius: world.getState().gateRadius, gain: world.u.gateGain.value, rays: world.getPostState().rays,
        };
        const step = (n) => frame(world, camera, 1 / 60, () => {
            lock(world, { hardDrop: true });
            world.onClear({ rows: [19, 18], lines: 2, combo: n });
            world.onCombo(n);
        });
        const read = () => ({
            level: world.heat.level,
            fever: world.heat.fever,
            radius: world.getState().gateRadius,
            gain: world.u.gateGain.value,
            rays: world.getPostState().rays,
            exposure: world.getPostState().exposure,
            shutter: world.stars.uniforms.shutter.value,
            warp: world.warp,
        });
        step(1);
        run(world, camera, 0.6, 1 / 60);
        const first = read();
        for (let n = 2; n <= 12; n++) {
            step(n);
            run(world, camera, 0.6, 1 / 60);
        }
        const late = read();
        // The first clear barely warms the world; twelve in a row light the fever.
        expect(first.level).toBeLessThan(0.3);
        expect(late.level).toBeGreaterThan(first.level + 0.4);
        expect(late.fever).toBeGreaterThan(0.5);
        expect(world.heat.stage).toBe(3);
        // The gate opens, burns brighter and reaches further; the stars draw out; the iris closes.
        expect(late.radius).toBeGreaterThan(first.radius * 1.1);
        expect(late.gain).toBeGreaterThan(first.gain);
        expect(late.rays).toBeGreaterThan(first.rays);
        expect(late.shutter).toBeGreaterThan(first.shutter);
        expect(late.warp).toBeGreaterThan(first.warp);
        expect(late.exposure).toBeLessThan(first.exposure);
        // The chain breaks and the hands rest: the world breathes back to how it was.
        world.onCombo(0);
        run(world, camera, 12, 1 / 30);
        const after = read();
        expect(after.level).toBeLessThan(0.1);
        expect(after.fever).toBe(0);
        expect(after.radius).toBeCloseTo(rest.radius, 3);
        expect(after.gain).toBeLessThan(rest.gain + 0.1);
        expect(after.rays).toBeLessThan(rest.rays + 0.05);
    });

    it('never cuts the light: a weak hit after a strong one adds to it; a burst of rings replaces the faintest', () => {
        const { world, camera } = makeWorld('High', { at: 20 });
        frame(world, camera, 1 / 60, () => world.onClear({ rows: [19, 18, 17], lines: 3 }));
        run(world, camera, 0.1, 1 / 60);
        const strong = world.heat.punch;
        frame(world, camera, 1 / 240, () => lock(world));
        expect(world.heat.punch).toBeGreaterThan(strong * 0.99);
        // Three fading rings, three in full light, then three more: the fading ones make room.
        run(world, camera, 1.6, 1 / 60);
        frame(world, camera, 1 / 60, () => world.onClear({ rows: [19, 18, 17], lines: 3 }));
        run(world, camera, 0.4, 1 / 60);
        const bright = world.waveSlots.filter((s) => world.time - s.birth < 0.5).map((s) => s.birth);
        expect(bright).toHaveLength(3);
        frame(world, camera, 1 / 60, () => world.onClear({ rows: [19, 18, 17], lines: 3 }));
        run(world, camera, 0.4, 1 / 60);
        bright.forEach((birth) => expect(world.waveSlots.some((s) => s.birth === birth)).toBe(true));
    });

    it('builds a cascade wave on wave instead of replaying its first', () => {
        const { world, camera } = makeWorld('High', { at: 20 });
        const rings = [];
        const wave = world.wave.bind(world);
        world.wave = (time, data) => {
            rings.push(data.strength);
            wave(time, data);
        };
        const peaks = [];
        const counts = [];
        for (let depth = 1; depth <= 4; depth++) {
            rings.length = 0;
            frame(world, camera, 1 / 60, () => world.onClear({
                rows: [19], lines: 1, cascade: depth, combo: 1,
            }));
            run(world, camera, 0.36, 1 / 60);
            peaks.push(Math.max(...rings));
            counts.push(rings.length);
        }
        for (let i = 1; i < peaks.length; i++) {
            expect(peaks[i]).toBeGreaterThan(peaks[i - 1]);
            expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1]);
        }
        expect(counts[3]).toBeGreaterThan(counts[0]);
    });

    it('rings twice for a back-to-back, more the longer the run, and answers a T-spin that cleared nothing', () => {
        const { world, camera } = makeWorld('High', { at: 20 });
        let rim = 0;
        const clear = (b2b) => {
            const before = world.waveCursor;
            frame(world, camera, 1 / 60, () => world.onClear({
                rows: [19, 18], lines: 2, tspin: true, b2b,
            }));
            rim = world.rimFlash;
            run(world, camera, 0.4, 1 / 60);
            return world.waveCursor - before;
        };
        const plain = clear(false);
        const once = clear(true);
        expect(once).toBeGreaterThanOrEqual(plain + 2);
        expect(rim).toBeGreaterThan(0.7);
        const twice = clear(true);
        expect(twice).toBeGreaterThan(once);
        expect(world.getState().b2bRun).toBe(2);
        clear(false);
        expect(world.getState().b2bRun).toBe(0);
        // A T-spin that cleared nothing: a small twist, the glass turning over, one faint ring.
        run(world, camera, 4, 1 / 30);
        const before = world.waveCursor;
        const { level } = world.heat;
        frame(world, camera, 1 / 60, () => world.onSpin({ player: 0 }));
        run(world, camera, 0.15, 1 / 60);
        expect(Math.abs(world.twist)).toBeGreaterThan(0.01);
        expect(world.waveCursor).toBe(before + 1);
        expect(world.heat.level).toBeGreaterThan(level);
        expect(world.getState().counts.spins).toBe(1);
    });

    it('packs ambient shapes from the theme\'s own seven', () => {
        const { world } = makeWorld('Extreme', { at: 3 });
        const keys = new Set();
        world.pieces.filter((p) => p.live).forEach((p) => keys.add(p.codes.join(',')));
        const known = Object.keys(SHAPES).map((k) => packCells(cellsFromMatrix(SHAPES[k])).join(','));
        keys.forEach((k) => expect(known).toContain(k));
    });
});
