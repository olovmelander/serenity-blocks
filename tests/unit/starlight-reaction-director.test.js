import {
    describe, expect, it,
} from 'vitest';

import {
    StarlightReactionDirector, IMPULSE,
} from '../../src/themes/starlight/sim/starlight-reaction-director.js';

// The StarlightReactionDirector is a pure, renderer-free coalescing brain, so its
// dominance/coalescing/theme-time discipline is exercised directly with spy adapters
// and stub resolvers — no Three, no eventBus, no GPU. The invariants under test are the
// plan §5 contract: ONE dominant cue per lock resolution, COMBO never double-fires the
// clear's wave, delayed beats ride a theme-time timeline (not setTimeout), origins are
// captured by value, state is per-player, and dead events are never consumed.

/** Records every adapter call as { name, args } in order. */
function makeSpy() {
    const calls = [];
    const record = (name) => (...args) => calls.push({ name, args });
    const adapters = {
        seal: record('seal'),
        wave: record('wave'),
        impulse: record('impulse'),
        ring: record('ring'),
        echo: record('echo'),
        meteor: record('meteor'),
        sign: record('sign'),
        camera: record('camera'),
        fx: record('fx'),
        aurora: record('aurora'),
    };
    calls.of = (name) => calls.filter((c) => c.name === name);
    calls.count = (name) => calls.of(name).length;
    return { adapters, calls };
}

// Per-player resolvers: origin.x encodes the player so isolation is observable.
// clearedRows map 1:1 to row origins so sweep counts are assertable.
const resolvers = {
    lockOrigin: (piece, player) => ({ x: player * 100 + 1, y: 2, z: 3 }),
    lockCells: (piece, player) => (piece?.cells || [{ x: player * 100, y: 0, z: 0 }]),
    rowsOrigin: (rows, player) => ({ x: player * 100 + 5, y: (rows?.[0] ?? 0), z: 0 }),
    rowOrigins: (rows, player) => (rows || []).map((r) => ({ x: player * 100, y: r, z: 0 })),
};

function makeDirector(overrides = {}) {
    const spy = makeSpy();
    const director = new StarlightReactionDirector({ adapters: spy.adapters, resolvers, ...overrides });
    return { director, ...spy };
}

/** Advance theme time in small steps so scheduled beats fire naturally. */
function advance(director, seconds, step = 1 / 120) {
    for (let t = 0; t < seconds - 1e-9; t += step) director.update(step);
}

describe('StarlightReactionDirector', () => {
    describe('ordinary lock (no clear)', () => {
        it('plays a cell-centered seal + one shallow release wave, and NOTHING else', () => {
            const { director, calls } = makeDirector();
            director.onPieceLock({ piece: { cells: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }] } });
            advance(director, 0.6);

            expect(calls.count('seal')).toBe(1);
            expect(calls.of('seal')[0].args[0]).toHaveLength(2); // both cells passed through
            expect(calls.count('wave')).toBe(1); // one shallow release wave
            expect(calls.count('meteor')).toBe(0); // ordinary lock earns no meteor
            expect(calls.count('sign')).toBe(0);
            expect(calls.count('ring')).toBe(0);
            // Dust inhale impulse is an ATTRACTOR (gather), not radial.
            expect(calls.of('impulse')[0].args[2]).toBe(IMPULSE.ATTRACTOR);
        });

        it('schedules the release wave on theme time — it does NOT fire until ~0.22s elapses', () => {
            const { director, calls } = makeDirector();
            director.onPieceLock({ piece: { cells: [{ x: 0, y: 0, z: 0 }] } });

            director.update(0); // flush: seal + inhale fire immediately (offset 0)
            expect(calls.count('seal')).toBe(1);
            expect(calls.count('wave')).toBe(0);

            director.update(0.1); // t=0.1 < 0.22 → still no wave
            expect(calls.count('wave')).toBe(0);

            director.update(0.2); // t=0.3 > 0.22 → wave releases
            expect(calls.count('wave')).toBe(1);
        });

        it('holds the timeline while paused (no update = no delayed beats fire)', () => {
            const { director, calls } = makeDirector();
            director.onPieceLock({ piece: { cells: [{ x: 0, y: 0, z: 0 }] } });
            director.update(0); // seal fires
            // Simulate a long pause: never call update again.
            expect(calls.count('wave')).toBe(0); // release wave stays pending, not on wall-clock
        });
    });

    describe('COMBO coalescing (no double-fire)', () => {
        it('a COMBO with the following LINE_CLEAR produces ONE sweep, not two', () => {
            const single = makeDirector();
            single.director.onLineClear({ lineCount: 1, clearedRows: [18] });
            advance(single.director, 0.4);
            const wavesWithoutCombo = single.calls.count('wave');

            const combo = makeDirector();
            combo.director.onCombo({ comboCount: 2 }); // resonance only — no geometry of its own
            combo.director.onLineClear({ lineCount: 1, clearedRows: [18] });
            advance(combo.director, 0.4);

            expect(wavesWithoutCombo).toBe(1); // single row → one sweep
            expect(combo.calls.count('wave')).toBe(1); // COMBO added no extra wave
        });

        it('COMBO alone (no clear this frame) launches no geometry', () => {
            const { director, calls } = makeDirector();
            director.onCombo({ comboCount: 5 });
            advance(director, 0.4);
            expect(calls.length).toBe(0);
        });

        it('seeds a small sign only when a resonance milestone is newly crossed, once per tier', () => {
            const { director, calls } = makeDirector();
            // Climb a combo streak 4→5→6 (tier 1) then 7 (tier 2); each clear is one row.
            const clearAt = (combo) => {
                director.onCombo({ comboCount: combo });
                director.onLineClear({ lineCount: 1, clearedRows: [18] });
                advance(director, 0.35);
            };
            clearAt(4); // tier 1 crossed → one small seed (zodiac)
            clearAt(5); // still tier 1 → no new sign
            clearAt(6); // still tier 1 → no new sign
            expect(calls.count('sign')).toBe(1);
            expect(calls.of('sign')[0].args[0]).toBe('zodiac');
            expect(calls.of('sign')[0].args[1].persistent).toBe(false);

            clearAt(7); // tier 2 crossed → one readable trace (earned, still not persistent)
            expect(calls.count('sign')).toBe(2);
            expect(calls.of('sign')[1].args[0]).toBe('earned');
        });
    });

    describe('dominance order', () => {
        it('perfect clear beats a co-resolving Tetris/combo — no fireball, one full reveal', () => {
            const { director, calls } = makeDirector();
            director.onPieceLock({ piece: { cells: [{ x: 0, y: 0, z: 0 }] } });
            director.onLineClear({ lineCount: 4, clearedRows: [16, 17, 18, 19] });
            director.onCombo({ comboCount: 5 });
            director.onPerfectClear({ depth: 0 });
            advance(director, 0.6);

            expect(calls.count('seal')).toBe(0); // lock absorbed
            expect(calls.of('meteor').some((c) => c.args[0] === 'fireball')).toBe(false);
            const signs = calls.of('sign');
            expect(signs).toHaveLength(1);
            expect(signs[0].args[1].full).toBe(true);
        });

        it('Tetris resolves to a hero fireball + FOV breath', () => {
            const { director, calls } = makeDirector();
            director.onPieceLock({ piece: { cells: [{ x: 0, y: 0, z: 0 }] } });
            director.onLineClear({ lineCount: 4, clearedRows: [16, 17, 18, 19] });
            advance(director, 0.6);

            expect(calls.of('meteor').some((c) => c.args[0] === 'fireball')).toBe(true);
            expect(calls.of('camera').some((c) => c.args[0] === 'fovPunch')).toBe(true);
            expect(calls.count('seal')).toBe(0); // lock absorbed by the Tetris
        });

        it('T-spin resolves to a vortex + ring, never a fireball', () => {
            const { director, calls } = makeDirector();
            director.onPieceLock({ piece: { cells: [{ x: 0, y: 0, z: 0 }] } });
            director.onTSpin({ lineCount: 1 });
            advance(director, 0.6);

            expect(calls.of('impulse').some((c) => c.args[2] === IMPULSE.VORTEX)).toBe(true);
            expect(calls.count('ring')).toBeGreaterThanOrEqual(1);
            expect(calls.of('meteor').some((c) => c.args[0] === 'fireball')).toBe(false);
        });
    });

    describe('combo apex (≥10 with a clear)', () => {
        it('fires an earned persistent constellation birth, then respects the cooldown', () => {
            const { director, calls } = makeDirector({ apexCooldown: 6 });
            const comboClear = (combo) => {
                director.onCombo({ comboCount: combo });
                director.onLineClear({ lineCount: 1, clearedRows: [18] });
                advance(director, 0.4);
            };
            comboClear(10); // apex
            const apexSigns = calls.of('sign').filter((c) => c.args[1].persistent === true);
            expect(apexSigns).toHaveLength(1);
            expect(apexSigns[0].args[0]).toBe('earned');

            comboClear(11); // within cooldown → NOT another apex (falls back to line clear)
            const apexSignsAfter = calls.of('sign').filter((c) => c.args[1].persistent === true);
            expect(apexSignsAfter).toHaveLength(1);
        });
    });

    describe('B2B echo (replay by value, no future-recognition timer)', () => {
        it('replays the just-recorded special once, ~0.19s later', () => {
            const { director, calls } = makeDirector();
            director.onPieceLock({ piece: { cells: [{ x: 0, y: 0, z: 0 }] } });
            director.onTSpin({ lineCount: 1 });
            director.onB2B({ active: true });

            director.update(0); // flush: tspin cue fires now (ring #1)
            const ringsImmediate = calls.count('ring');
            expect(ringsImmediate).toBeGreaterThanOrEqual(1);

            advance(director, 0.3); // pass 0.19 → the echo replays
            expect(calls.count('ring')).toBeGreaterThan(ringsImmediate);
        });

        it('does NOT echo when the resolution is a plain lock (no special was recorded)', () => {
            const { director, calls } = makeDirector();
            director.onPieceLock({ piece: { cells: [{ x: 0, y: 0, z: 0 }] } });
            director.onB2B({ active: true });
            advance(director, 0.5);
            expect(calls.count('ring')).toBe(0); // lock cue has no ring, and B2B armed nothing
        });

        it('captures the echo origin by value — a later cue cannot move it', () => {
            const shared = { x: 7, y: 7, z: 7 };
            const spy = makeSpy();
            const director = new StarlightReactionDirector({
                adapters: spy.adapters,
                resolvers: { ...resolvers, lockOrigin: () => shared },
            });
            director.onPieceLock({ piece: { cells: [shared] } });
            director.onTSpin({ lineCount: 1 });
            director.onB2B({ active: true });
            director.update(0); // tspin ring uses x=7
            shared.x = 999; // mutate the source AFTER the beat was scheduled
            advance(director, 0.3);
            const echoRing = spy.calls.of('ring').at(-1);
            expect(echoRing.args[0].x).toBe(7); // cloned — not 999
        });
    });

    describe('per-player isolation', () => {
        it('resolves each player from their own origin and combo state', () => {
            const { director, calls } = makeDirector();
            director.onPieceLock({ player: 1, piece: { cells: [{ x: 100, y: 0, z: 0 }] } });
            director.onPieceLock({ player: 2, piece: { cells: [{ x: 200, y: 0, z: 0 }] } });
            director.update(0);

            const seals = calls.of('seal');
            expect(seals).toHaveLength(2);
            const sealXs = seals.map((c) => c.args[0][0].x).sort((a, b) => a - b);
            expect(sealXs).toEqual([100, 200]);
        });

        it("player 1's combo streak does not advance player 2's milestone gate", () => {
            const { director } = makeDirector();
            director.onCombo({ player: 1, comboCount: 8 });
            director.onLineClear({ player: 1, lineCount: 1, clearedRows: [18] });
            director.update(0);
            const diag = director.getDiagnostics();
            const p1 = diag.players.find((p) => p.player === 1);
            const p2 = diag.players.find((p) => p.player === 2);
            expect(p1.comboTier).toBe(2); // combo 8 → tier 2
            expect(p2).toBeUndefined(); // player 2 never touched
        });
    });

    describe('lifecycle + dead events', () => {
        it('attach() subscribes to the six canonical events and NEVER HARD_DROP/LEVEL_UP', () => {
            const subscribed = [];
            const bus = { on: (evt) => { subscribed.push(evt); return () => {}; } };
            const EVENTS = {
                PIECE_LOCK: 'pieceLock',
                LINE_CLEAR: 'lineClear',
                COMBO: 'combo',
                TSPIN: 'tspin',
                B2B: 'b2b',
                PERFECT_CLEAR: 'perfectClear',
                HARD_DROP: 'hardDrop',
                LEVEL_UP: 'levelUp',
            };
            const { director } = makeDirector();
            director.attach(bus, EVENTS);
            expect(subscribed).toHaveLength(6);
            expect(subscribed).not.toContain('hardDrop');
            expect(subscribed).not.toContain('levelUp');
        });

        it('reset() clears the timeline, pending, and per-player state', () => {
            const { director } = makeDirector();
            director.onPieceLock({ piece: { cells: [{ x: 0, y: 0, z: 0 }] } });
            director.onCombo({ comboCount: 9 });
            director.onLineClear({ lineCount: 1, clearedRows: [18] });
            director.update(0);
            director.reset();
            const diag = director.getDiagnostics();
            expect(diag.time).toBe(0);
            expect(diag.scheduledBeats).toBe(0);
            expect(diag.pendingPlayers).toBe(0);
            expect(diag.players).toHaveLength(0);
        });

        it('never grows the beat queue without bound under an event storm', () => {
            const { director } = makeDirector();
            for (let i = 0; i < 500; i += 1) {
                director.onCombo({ comboCount: 12 });
                director.onLineClear({ lineCount: 4, clearedRows: [16, 17, 18, 19] });
            }
            director.update(0); // one giant coalesced resolution
            expect(director.getDiagnostics().scheduledBeats).toBeLessThanOrEqual(64);
        });
    });
});
