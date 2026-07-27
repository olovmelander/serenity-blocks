import { describe, expect, it } from 'vitest';

import { createReactionAdapters } from '../../src/themes/starlight/sim/starlight-reaction-adapters.js';
import { StarlightReactionDirector } from '../../src/themes/starlight/sim/starlight-reaction-director.js';
import { IMPULSE_TYPE } from '../../src/themes/starlight/sim/impulse-types.js';

// End-to-end but renderer-free: the real createReactionAdapters bridge wired to a SPY
// theme, driven by the real StarlightReactionDirector. Verifies the director's abstract
// cues reach the correct theme subsystem methods with correctly-mapped arguments — the
// production integration path — without any Three/GPU. Origin mapping (grid → side-lane
// backdrop world) is the ported legacy behavior, so placement stays as it is today.

function spyTheme(overrides = {}) {
    const calls = [];
    const rec = (name) => (...args) => calls.push({ name, args });
    const theme = {
        starfield: { triggerWave: rec('wave') },
        stardustSim: { pushImpulse: rec('impulse') },
        shockwaves: { spawn: rec('ring'), spawnEcho: rec('echo') },
        meteors: {
            spawnFaint: rec('faint'),
            spawnBright: rec('bright'),
            spawnFireball: rec('fireball'),
            spawnShower: rec('shower'),
        },
        constellations: { trigger: rec('trigger'), triggerMany: rec('triggerMany') },
        cameraDirector: {
            fovPunch: rec('fovPunch'), dolly: rec('dolly'), vertigo: rec('vertigo'), shake: rec('shake'),
        },
        aurora: { surge: rec('aurora') },
        fxState: {
            bloomPunch: 0, flashPunch: 0, chromaPunch: 0, vignettePunch: 0,
        },
        ...overrides,
    };
    calls.of = (name) => calls.filter((c) => c.name === name);
    return { theme, calls };
}

function wire(themeOverrides) {
    const spy = spyTheme(themeOverrides);
    const { adapters, resolvers } = createReactionAdapters(spy.theme);
    const director = new StarlightReactionDirector({ adapters, resolvers });
    return { director, ...spy };
}

function advance(director, seconds, step = 1 / 120) {
    for (let t = 0; t < seconds - 1e-9; t += step) director.update(step);
}

// A centered T-piece near the board bottom (visible rows). Shape rows are top→bottom.
const T_PIECE = { shape: [[0, 1, 0], [1, 1, 1]], x: 4, y: 20 };

describe('StarlightReactionDirector ↔ theme adapters', () => {
    it('a lock drives an inward ATTRACTOR tug + a release twinkle-wave + a small bloom, no meteor', () => {
        const { director, theme, calls } = wire();
        director.onPieceLock({ piece: T_PIECE });
        advance(director, 0.5);

        const impulses = calls.of('impulse');
        expect(impulses).toHaveLength(1);
        expect(impulses[0].args[3]).toBe(IMPULSE_TYPE.ATTRACTOR); // string kind → numeric enum
        expect(calls.of('wave')).toHaveLength(1);
        expect(theme.fxState.bloomPunch).toBeGreaterThan(0);
        expect(calls.of('fireball')).toHaveLength(0);
        expect(calls.of('shower')).toHaveLength(0);
    });

    it('maps every IMPULSE kind to its numeric IMPULSE_TYPE (T-spin uses VORTEX)', () => {
        const { director, calls } = wire();
        director.onPieceLock({ piece: T_PIECE });
        director.onTSpin({ lineCount: 1 });
        advance(director, 0.5);
        const kinds = calls.of('impulse').map((c) => c.args[3]);
        expect(kinds).toContain(IMPULSE_TYPE.VORTEX);
        expect(kinds.every((k) => typeof k === 'number')).toBe(true);
    });

    it('a lock and a combo both fire a subtle camera shake (edv3-style feedback)', () => {
        const lock = wire();
        lock.director.onPieceLock({ piece: T_PIECE });
        advance(lock.director, 0.3);
        expect(lock.calls.of('shake').length).toBeGreaterThanOrEqual(1);
        expect(lock.calls.of('shake')[0].args[0]).toBeLessThan(0.03); // lock shake stays subtle

        const combo = wire();
        combo.director.onCombo({ comboCount: 6 });
        combo.director.onLineClear({ lineCount: 2, clearedRows: [17, 18] });
        advance(combo.director, 0.4);
        expect(combo.calls.of('shake').length).toBeGreaterThanOrEqual(1);
    });

    it('a Tetris spawns a hero fireball and a FOV breath through the real adapters', () => {
        const { director, calls } = wire();
        director.onPieceLock({ piece: T_PIECE });
        director.onLineClear({ lineCount: 4, clearedRows: [16, 17, 18, 19] });
        advance(director, 0.6);
        expect(calls.of('fireball')).toHaveLength(1);
        expect(calls.of('fovPunch')).toHaveLength(1);
    });

    it('a combo-10 apex surges the aurora and births an earned constellation', () => {
        const { director, calls } = wire();
        director.onCombo({ comboCount: 10 });
        director.onLineClear({ lineCount: 1, clearedRows: [18] });
        advance(director, 0.5);
        expect(calls.of('aurora')).toHaveLength(1);
        expect(calls.of('trigger').length + calls.of('triggerMany').length).toBeGreaterThanOrEqual(1);
    });

    it('the seal adapter is a deliberate no-op (deferred until board-rect projection)', () => {
        // No `seal` spy exists on the theme; a lock must not throw reaching for one.
        const { director } = wire();
        expect(() => { director.onPieceLock({ piece: T_PIECE }); advance(director, 0.3); }).not.toThrow();
    });

    it('degrades safely on the WebGL2 fallback (no stardust compute) — impulses no-op', () => {
        const { director, calls } = wire({ stardustSim: null });
        expect(() => {
            director.onPieceLock({ piece: T_PIECE });
            director.onLineClear({ lineCount: 4, clearedRows: [16, 17, 18, 19] });
            advance(director, 0.6);
        }).not.toThrow();
        expect(calls.of('impulse')).toHaveLength(0); // no sim → skipped, not crashed
        expect(calls.of('wave').length).toBeGreaterThan(0); // starfield still reacts
    });

    it('resolves origins into world space, shunting a centered piece to a side lane', () => {
        const { adapters, resolvers } = createReactionAdapters(spyTheme().theme);
        expect(adapters.seal()).toBeUndefined(); // seal no-op returns nothing
        const origin = resolvers.lockOrigin(T_PIECE);
        expect(Number.isFinite(origin.x) && Number.isFinite(origin.y)).toBe(true);
        // The centered T-piece must be pushed out of the central board strip.
        expect(Math.abs(origin.x)).toBeGreaterThan(6.0);
        const cells = resolvers.lockCells(T_PIECE);
        expect(cells).toHaveLength(4); // T = 4 filled cells
        expect(cells.every((c) => Number.isFinite(c.x) && Number.isFinite(c.z))).toBe(true);
    });

    it('prefers a mode-supplied viewportOrigin so an Infinity lock is not pinned to the bottom', () => {
        const { resolvers } = createReactionAdapters(spyTheme().theme);
        // An absolute Infinity row (piece.y=214) saturates the fixed-board mapping to the floor.
        const highPiece = { shape: [[0, 1, 0], [1, 1, 1]], x: 4, y: 214 };
        expect(resolvers.lockOrigin(highPiece).y).toBeLessThan(0); // fixed-board path → bottom

        // The on-screen origin wins: a top-of-viewport lock maps to the top half of the backdrop.
        const topLock = resolvers.lockOrigin(highPiece, 0, { x: 0.5, y: 0.12 });
        expect(topLock.y).toBeGreaterThan(0);
        const bottomLock = resolvers.lockOrigin(highPiece, 0, { x: 0.5, y: 0.88 });
        expect(bottomLock.y).toBeLessThan(topLock.y);
        // With a viewportOrigin the seal collapses to the single on-screen centroid cell.
        expect(resolvers.lockCells(highPiece, 0, { x: 0.5, y: 0.5 })).toHaveLength(1);
    });

    it('threads viewportOrigin through the director → adapter lock cue', () => {
        const { director, calls } = wire();
        director.onPieceLock({
            piece: { shape: [[0, 1, 0], [1, 1, 1]], x: 4, y: 214 }, // absolute Infinity row
            viewportOrigin: { x: 0.5, y: 0.12 }, // locked near the TOP of the viewport
        });
        advance(director, 0.3);
        // The inward ATTRACTOR impulse fires at the resolved lock centroid (args[0]); it must
        // land in the top half, proving the on-screen origin reached the resolver.
        expect(calls.of('impulse')[0].args[0].y).toBeGreaterThan(0);
    });

    it('prefers viewportOrigin for the line-clear rows origin (Infinity)', () => {
        const { resolvers } = createReactionAdapters(spyTheme().theme);
        const rows = [210, 211]; // absolute Infinity clear rows
        expect(resolvers.rowsOrigin(rows).y).toBeLessThan(0); // fixed-board → bottom
        expect(resolvers.rowsOrigin(rows, 0, { x: 0.5, y: 0.12 }).y).toBeGreaterThan(0); // on-screen top
        expect(resolvers.rowOrigins(rows, 0, { x: 0.5, y: 0.5 })).toHaveLength(1); // collapsed to origin
    });

    it('threads viewportOrigin through the director → adapter line-clear cue', () => {
        const { director, calls } = wire();
        director.onLineClear({
            lineCount: 2,
            clearedRows: [210, 211], // absolute Infinity rows
            viewportOrigin: { x: 0.5, y: 0.12 }, // cleared near the TOP of the viewport
        });
        advance(director, 0.4);
        // The clear cue fans waves/rings at the resolved rows origin; at least one must land in
        // the top half, proving the on-screen clear origin reached the resolvers.
        const waves = calls.of('wave');
        expect(waves.length).toBeGreaterThan(0);
        expect(waves.some((w) => w.args[0].y > 0)).toBe(true);
    });
});
