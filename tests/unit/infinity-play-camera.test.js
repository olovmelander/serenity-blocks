import { describe, expect, it } from 'vitest';
import {
    InfinityPlayCamera, PLAY_CAMERA, filledRowSpan, playFramingTop,
} from '../../src/ui/infinity/infinity-play-camera.js';

const V = 20;
const T = [[0, 1, 0], [1, 1, 1], [0, 0, 0]];
const I_VERTICAL = [[1], [1], [1], [1]];

/** Run the camera at `hz` for `ms`, toward a fixed home unless `homeAt(t)` says otherwise. */
function run(camera, {
    from, home, hz = 60, ms, maxTop = 500, start = 0, homeAt = null,
}) {
    let top = from;
    const frames = [];
    const dt = 1000 / hz;
    for (let t = start; t <= start + ms + 1e-9; t += dt) {
        top = camera.step({
            now: t, top, home: homeAt ? homeAt(t) : home, maxTop, visibleRows: V,
        });
        frames.push({ t, top });
    }
    return frames;
}

describe('Infinity play camera framing', () => {
    it('finds the rows of a shape that hold cells', () => {
        expect(filledRowSpan(T)).toEqual({ first: 0, last: 1 });
        expect(filledRowSpan([[0, 0], [1, 1], [1, 1]])).toEqual({ first: 1, last: 2 });
        expect(filledRowSpan(I_VERTICAL)).toEqual({ first: 0, last: 3 });
    });

    it('rests an empty well on its floor and puts a tower\'s top a fifth of the way down', () => {
        expect(playFramingTop({ boardRows: 44, visibleRows: V, highestRow: 44 })).toBe(24);
        expect(playFramingTop({ boardRows: 164, visibleRows: V, highestRow: 84 })).toBe(80);
        // A low stack keeps the floor in view.
        expect(playFramingTop({ boardRows: 44, visibleRows: V, highestRow: 40 })).toBe(24);
    });

    it('leaves a piece above the tower to the tower framing', () => {
        const framing = { boardRows: 164, visibleRows: V, highestRow: 84 };
        expect(playFramingTop({ ...framing, piece: { y: 78, shape: T }, landingY: 82 })).toBe(80);
        // Hovering over a deep shaft changes nothing until the piece itself goes down.
        expect(playFramingTop({ ...framing, piece: { y: 78, shape: T }, landingY: 162 })).toBe(80);
    });

    it('follows a piece down a shaft with the rows below it on screen, then shows its landing', () => {
        const framing = { boardRows: 164, visibleRows: V, highestRow: 84 };
        // Deep in the shaft: its top six rows (30 %) down the view, fourteen rows ahead of it.
        expect(playFramingTop({ ...framing, piece: { y: 120, shape: T }, landingY: 162 })).toBe(114);
        // Its landing in reach: the view goes only as low as showing it, one row to spare.
        expect(playFramingTop({ ...framing, piece: { y: 120, shape: T }, landingY: 128 })).toBe(130 - V + 1);
        // At the floor the view stops at the floor.
        expect(playFramingTop({ ...framing, piece: { y: 158, shape: T }, landingY: 162 })).toBe(144);
    });
});

describe('Infinity play camera motion', () => {
    it('moves the same at 60 and 165 Hz', () => {
        const at60 = run(new InfinityPlayCamera(), {
            from: 0, home: 40, hz: 60, ms: 600,
        });
        const at165 = run(new InfinityPlayCamera(), {
            from: 0, home: 40, hz: 165, ms: 600,
        });
        for (const ms of [100, 250, 400]) {
            const a = at60.reduce((best, f) => (Math.abs(f.t - ms) < Math.abs(best.t - ms) ? f : best));
            const b = at165.reduce((best, f) => (Math.abs(f.t - ms) < Math.abs(best.t - ms) ? f : best));
            // Frames land at different instants; compare at the 60 Hz frame's own time.
            const c = run(new InfinityPlayCamera(), {
                from: 0, home: 40, hz: 165, ms: a.t,
            });
            expect(Math.abs(c.at(-1).top - a.top)).toBeLessThan(0.6);
            expect(b.top).toBeGreaterThan(0);
        }
    });

    it('starts a long trip from rest and arrives without overshooting', () => {
        const frames = run(new InfinityPlayCamera(), {
            from: 144, home: 80, hz: 165, ms: 900,
        });
        // The first frames ease out (an exponential lerp would jump a quarter of the way at once).
        expect(144 - frames[1].top).toBeLessThan(0.5);
        expect(Math.min(...frames.map((f) => f.top))).toBeGreaterThanOrEqual(80 - 1e-6);
        // Home within half a second.
        const home = frames.find((f) => f.top < 81);
        expect(home.t).toBeLessThan(500);
    });

    it('starts from rest again after a pause', () => {
        const camera = new InfinityPlayCamera();
        run(camera, {
            from: 0, home: 40, hz: 60, ms: 120,
        });
        expect(Math.abs(camera.velocity)).toBeGreaterThan(10);
        // Five seconds later: the same step a camera at rest takes, not a fling.
        const resumed = camera.step({
            now: 5000, top: 20, home: 40, maxTop: 500, visibleRows: V,
        });
        const fresh = new InfinityPlayCamera();
        fresh.step({
            now: 0, top: 20, home: 40, maxTop: 500, visibleRows: V,
        });
        const atRest = fresh.step({
            now: PLAY_CAMERA.MAX_DT_S * 1000, top: 20, home: 40, maxTop: 500, visibleRows: V,
        });
        expect(resumed).toBeCloseTo(atRest, 9);
    });
});

describe('Infinity play camera beats', () => {
    const lockAt = (camera, now, fields) => camera.onLock({
        now, visibleRows: V, maxTop: 144, home: 80, ...fields,
    });

    it('shows a lock it followed down before going home', () => {
        const camera = new InfinityPlayCamera();
        lockAt(camera, 0, {
            pieceTop: 160, pieceBottom: 161, viewTop: 144, pieceHome: 144,
        });
        expect(camera.beat?.kind).toBe('lock');
        const frames = run(camera, {
            from: 144, home: 80, hz: 120, ms: 800, maxTop: 144,
        });
        const left = frames.find((f) => f.top < 143.5);
        expect(left.t).toBeGreaterThanOrEqual(PLAY_CAMERA.LOCK_HOLD_MS);
        expect(left.t).toBeLessThan(PLAY_CAMERA.LOCK_HOLD_MS + 60);
        expect(camera.beat).toBeNull();
    });

    it('holds nothing for a piece it only passed on its way home', () => {
        const camera = new InfinityPlayCamera();
        // Locked on the tower while the view climbs home through it…
        lockAt(camera, 0, {
            pieceTop: 86, pieceBottom: 87, viewTop: 85, pieceHome: 80,
        });
        expect(camera.beat).toBeNull();
        // …or above the view, where home will show it anyway.
        lockAt(camera, 0, {
            pieceTop: 82, pieceBottom: 83, viewTop: 110, pieceHome: 80,
        });
        expect(camera.beat).toBeNull();
    });

    it('goes after a landing out of sight, shows it, and comes home', () => {
        const camera = new InfinityPlayCamera();
        lockAt(camera, 0, {
            pieceTop: 160, pieceBottom: 163, viewTop: 80, pieceHome: 144,
        });
        expect(camera.beat).toMatchObject({ kind: 'landing', top: 144 });
        const frames = run(camera, {
            from: 80, home: 80, hz: 120, ms: 1600, maxTop: 144,
        });
        const shown = frames.find((f) => f.top >= 143);
        expect(shown.t).toBeLessThan(450);
        const back = frames.find((f) => f.t > shown.t && f.top < 81);
        expect(back).toBeDefined();
        expect(back.t).toBeLessThan(1300);
    });

    it('yields a beat to the player\'s next move', () => {
        const camera = new InfinityPlayCamera();
        lockAt(camera, 0, {
            pieceTop: 160, pieceBottom: 163, viewTop: 80, pieceHome: 144,
        });
        run(camera, {
            from: 80, home: 80, hz: 60, ms: 100, maxTop: 144,
        });
        camera.onPlayerInput();
        expect(camera.beat).toBeNull();
    });

    it('watches a clear out of sight until its cascade settles, and ignores one in sight', () => {
        const camera = new InfinityPlayCamera();
        camera.onClear({
            now: 0, rows: [90, 91], viewTop: 80, visibleRows: V, home: 80, maxTop: 144,
        });
        expect(camera.beat).toBeNull();

        camera.onClear({
            now: 0, rows: [160, 161, 162, 163], viewTop: 80, visibleRows: V, home: 80, maxTop: 144,
        });
        expect(camera.beat).toMatchObject({ kind: 'clear', top: 144 });
        // Still cascading at 2 s: the view stays.
        let top = 80;
        for (let t = 0; t <= 2000; t += 10) {
            top = camera.step({
                now: t, top, home: 80, maxTop: 144, visibleRows: V,
            });
        }
        expect(top).toBeGreaterThan(143);
        camera.onPlayerInput(); // no piece in hand while it cascades: nothing to yield to yet
        expect(camera.beat?.kind).toBe('clear');
        camera.onCascadeComplete(2000);
        for (let t = 2010; t <= 2000 + PLAY_CAMERA.CLEAR_HOLD_MS - 20; t += 10) {
            top = camera.step({
                now: t, top, home: 80, maxTop: 144, visibleRows: V,
            });
        }
        expect(camera.beat?.kind).toBe('clear');
        for (let t = 2000 + PLAY_CAMERA.CLEAR_HOLD_MS; t <= 3000; t += 10) {
            top = camera.step({
                now: t, top, home: 80, maxTop: 144, visibleRows: V,
            });
        }
        expect(camera.beat).toBeNull();
        expect(top).toBeLessThan(82);
    });

    it('moves a held framing down with rows added above the board', () => {
        const camera = new InfinityPlayCamera();
        lockAt(camera, 0, {
            pieceTop: 160, pieceBottom: 163, viewTop: 80, pieceHome: 144,
        });
        camera.shift(10);
        expect(camera.beat.top).toBe(154);
        expect(camera.beat.first).toBe(170);
    });

    it('under reduced motion holds no beats and cuts a trip longer than a view', () => {
        const camera = new InfinityPlayCamera({ reducedMotion: () => true });
        lockAt(camera, 0, {
            pieceTop: 160, pieceBottom: 163, viewTop: 80, pieceHome: 144,
        });
        camera.onClear({
            now: 0, rows: [163], viewTop: 80, visibleRows: V, home: 80, maxTop: 144,
        });
        expect(camera.beat).toBeNull();
        expect(camera.step({
            now: 0, top: 144, home: 80, maxTop: 144, visibleRows: V,
        })).toBe(80);
        // A short move still glides.
        camera.step({
            now: 0, top: 84, home: 80, maxTop: 144, visibleRows: V,
        });
        expect(camera.step({
            now: 16, top: 84, home: 80, maxTop: 144, visibleRows: V,
        })).toBeGreaterThan(80);
    });
});
