/* eslint-disable import/no-extraneous-dependencies */
/**
 * Starlight — Event Emitters
 *
 * Translates game events into Starlight's reactive magic. Per the combo/lock FX
 * plan (docs/STARLIGHT_COMBO_LOCK_EFFECTS_PLAN.md):
 *   - Effects originate AT THE ACTION: the lock cell / cleared-row centroid is
 *     mapped into the backdrop's world space (§7.4) and used as the origin for
 *     the twinkle-wave + stardust impulses (replacing the old random jitter).
 *   - Every beat rides the starfield TWINKLE-WAVE (the cheap, both-backends hero
 *     — "the sky responds where you played").
 *   - LOCK = "First Light": flat, subtle, NO camera shake, tiny bloom.
 *   - COMBO escalates; line clears / perfect clears layer meteors + constellation.
 *
 * Subscribes to the events this project emits (LINE_CLEAR / COMBO / HARD_DROP /
 * PIECE_LOCK / LEVEL_UP / PERFECT_CLEAR / TSPIN / B2B). Reads live subsystems off
 * the theme (stardustSim may be null on the WebGL2 fallback; the rest always present).
 *
 * Phases 0–3 of the plan: origin mapping, twinkle-wave, shockwave rings, Tetris
 * vertical sweep, combo-10+ supernova peak, T-spin inverted wave, B2B echo, aurora
 * surge. Deferred: CASCADE (no event/data emitted by the game modes).
 */
import * as THREE from 'three';
import { eventBus, EVENTS } from '../../../events/event-bus.js';
import { COLS, ROWS, HIDDEN_ROWS } from '../../../core/constants.js';
import { IMPULSE_TYPE } from './stardust-particles.js';
import { RING_PRESET } from './shockwave-system.js';

const VORTEX_AXIS = { x: 0, y: 0, z: 1 };

// Map the board's grid into visible sky lanes behind/around the game canvas.
// The board still chooses the beat, but central actions are pushed to side lanes
// so rings/waves are not hidden behind the middle playfield.
const ORIGIN_SPAN_X = 9.0;
const ORIGIN_SPAN_Y = 5.2;
const ORIGIN_Z = -3.5;
const CENTER_CLEAR_X = 3.2;
const SIDE_LANE_MIN_X = 6.6;

const SKY_LANES = Object.freeze([
    [-8.8, 4.7],
    [8.7, 4.2],
    [-8.4, -2.8],
    [8.5, -3.7],
    [-5.8, 5.1],
    [5.9, 5.0],
    [-7.2, 0.6],
    [7.3, -0.3],
]);

const _pos = new THREE.Vector3();
const _sweep = new THREE.Vector3();
const _conv = new THREE.Vector3();
const _b2bPos = new THREE.Vector3();
const _lane = new THREE.Vector3();

export class StarlightEmitters {
    constructor(theme) {
        this.theme = theme;
        this._unsubs = [];
        this._timers = [];
        this._b2bActive = false;
        // Most-recent action origin (combos carry no position → reuse this).
        this._lastOrigin = new THREE.Vector3(0, 0, ORIGIN_Z);
        this._originCursor = 0;
    }

    attach() {
        this._unsubs.push(
            eventBus.on(EVENTS.PIECE_LOCK, (d) => this._onPieceLock(d)),
            eventBus.on(EVENTS.HARD_DROP, () => this._onHardDrop()),
            eventBus.on(EVENTS.LINE_CLEAR, (d) => this._onLineClear(d)),
            eventBus.on(EVENTS.COMBO, (d) => this._onCombo(d)),
            eventBus.on(EVENTS.LEVEL_UP, () => this._onLevelUp()),
            eventBus.on(EVENTS.PERFECT_CLEAR, () => this._onPerfectClear()),
            eventBus.on(EVENTS.TSPIN, () => this._onTSpin()),
            eventBus.on(EVENTS.B2B, () => this._onB2B()),
        );
        return () => this.detach();
    }

    detach() {
        for (const unsub of this._unsubs) {
            try { unsub?.(); } catch (e) { /* ignore */ }
        }
        this._unsubs = [];
        for (const id of this._timers) clearTimeout(id);
        this._timers = [];
    }

    // ── Origin mapping (grid cell → backdrop world space) ──

    _nextOriginSeed() {
        this._originCursor = (this._originCursor + 1) % 100000;
        return this._originCursor;
    }

    _cellToWorld(col, row, out, seed = 0) {
        const safeCol = Number.isFinite(col) ? col : COLS / 2 - 0.5;
        const safeRow = Number.isFinite(row) ? row : ROWS / 2 - 0.5;
        const cx = Math.max(0, Math.min(1, (safeCol + 0.5) / COLS));
        const cy = Math.max(0, Math.min(1, (safeRow + 0.5) / ROWS));
        const rawX = (cx * 2 - 1) * ORIGIN_SPAN_X;
        const y = ((1 - cy) * 2 - 1) * ORIGIN_SPAN_Y;
        let x = rawX;

        if (Math.abs(rawX) < CENTER_CLEAR_X) {
            const fallbackSide = Math.floor(seed) % 2 === 0 ? -1 : 1;
            const side = Math.abs(rawX) > 0.001 ? Math.sign(rawX) : fallbackSide;
            const centerT = 1 - Math.abs(rawX) / CENTER_CLEAR_X;
            x = side * (SIDE_LANE_MIN_X + centerT * 1.2);
        }

        out.set(x, y, ORIGIN_Z);
        return out;
    }

    _skyLane(out, offset = 0) {
        const lane = SKY_LANES[(this._originCursor + offset) % SKY_LANES.length];
        out.set(lane[0], lane[1], ORIGIN_Z - 0.4);
        return out;
    }

    /** Centroid of the piece's filled cells (grid → world). Writes + returns out. */
    _lockOrigin(piece, out) {
        if (!piece || !Array.isArray(piece.shape)) {
            this._skyLane(out, 0);
            return out;
        }
        let sumC = 0;
        let sumR = 0;
        let n = 0;
        const px = piece.x || 0;
        const py = piece.y || 0;
        for (let y = 0; y < piece.shape.length; y += 1) {
            const rowArr = piece.shape[y];
            for (let x = 0; x < rowArr.length; x += 1) {
                if (rowArr[x] > 0) { sumC += px + x; sumR += py + y; n += 1; }
            }
        }
        if (!n) { this._skyLane(out, 0); return out; }
        return this._cellToWorld(sumC / n, sumR / n - HIDDEN_ROWS, out, this._nextOriginSeed());
    }

    /** Centroid of the cleared rows (col = board middle). Writes + returns out. */
    _rowsOrigin(clearedRows, out) {
        if (!Array.isArray(clearedRows) || !clearedRows.length) {
            out.copy(this._lastOrigin);
            return out;
        }
        const meanRow = clearedRows.reduce((a, b) => a + b, 0) / clearedRows.length;
        return this._cellToWorld(
            COLS / 2 - 0.5,
            meanRow - HIDDEN_ROWS,
            out,
            this._nextOriginSeed(),
        );
    }

    /** A single cleared row → world (col = board middle). */
    _rowOrigin(row, out, seed = 0) {
        return this._cellToWorld(COLS / 2 - 0.5, row - HIDDEN_ROWS, out, seed);
    }

    // ── Subsystem helpers ──

    /** Tracked setTimeout (cleared on detach so callbacks never fire post-teardown). */
    _setTimer(fn, ms) {
        const id = setTimeout(() => {
            this._timers = this._timers.filter((t) => t !== id);
            fn();
        }, ms);
        this._timers.push(id);
        return id;
    }

    _delayedOrigin(origin, delay, fn) {
        const p = origin.clone();
        if (delay <= 0) {
            fn(p);
            return;
        }
        this._setTimer(() => fn(p), delay);
    }

    _spreadWave(origin, opts, laneCount = 0) {
        this._wave(origin, opts);
        for (let i = 0; i < laneCount; i += 1) {
            const p = this._skyLane(new THREE.Vector3(), i + 1);
            this._delayedOrigin(p, 70 + i * 60, (laneOrigin) => {
                this._wave(laneOrigin, {
                    ...opts,
                    boost: (opts?.boost ?? 0.4) * 0.72,
                    sigma: (opts?.sigma ?? 30) + 4,
                });
            });
        }
    }

    _spreadImpulse(origin, strength, type = IMPULSE_TYPE.RADIAL, laneCount = 0) {
        this._impulseAt(origin, strength, type);
        for (let i = 0; i < laneCount; i += 1) {
            this._skyLane(_lane, i + 2);
            this._impulseAt(_lane, strength * 0.45, type);
        }
    }

    _spreadRing(origin, opts = {}, laneCount = 0) {
        this._ring(origin, opts);
        for (let i = 0; i < laneCount; i += 1) {
            const p = this._skyLane(new THREE.Vector3(), i + 2);
            this._delayedOrigin(p, 45 + i * 55, (laneOrigin) => {
                this._ring(laneOrigin, {
                    ...opts,
                    maxRadius: (opts.maxRadius ?? RING_PRESET.maxRadius) * 0.86,
                    alpha: (opts.alpha ?? RING_PRESET.alpha) * 0.6,
                });
            });
        }
    }

    _spreadEcho(origin, opts = {}, laneCount = 0) {
        this._echo(origin, opts);
        for (let i = 0; i < laneCount; i += 1) {
            const p = this._skyLane(new THREE.Vector3(), i + 3);
            this._delayedOrigin(p, 80 + i * 70, (laneOrigin) => {
                this._echo(laneOrigin, {
                    ...opts,
                    maxRadius: (opts.maxRadius ?? 3.0) * 0.9,
                    alpha: (opts.alpha ?? 0.5) * 0.55,
                });
            });
        }
    }

    _comboSigns(comboCount) {
        const c = Math.max(1, comboCount || 1);
        let count = 0;
        if (c >= 10) count = 3;
        else if (c >= 7) count = 2;
        else if (c >= 3) count = 1;
        if (!count) return;
        const name = c >= 10 ? 'earned' : 'zodiac';
        for (let i = 0; i < count; i += 1) {
            this._setTimer(() => {
                this.theme.constellations?.trigger(name);
            }, i * 120);
        }
    }

    /** B2B "echo": while a B2B is active, ring out a second faint shell a beat later. */
    _maybeB2BEcho(origin) {
        if (!this._b2bActive) return;
        _b2bPos.copy(origin);
        this._setTimer(() => {
            this._ring(_b2bPos, { color: [0.8, 0.9, 1.0], maxRadius: 1.6, alpha: 0.55 });
            this._skyLane(_lane, 4);
            this._ring(_lane, { color: [0.8, 0.9, 1.0], maxRadius: 1.3, alpha: 0.3 });
        }, 180);
    }

    _wave(origin, opts) {
        this.theme.starfield?.triggerWave?.(origin, opts);
    }

    _impulseAt(origin, strength, type = IMPULSE_TYPE.RADIAL) {
        const sim = this.theme.stardustSim;
        if (!sim) return;
        _pos.copy(origin);
        sim.pushImpulse(_pos, strength, VORTEX_AXIS, type);
    }

    _ring(origin, opts) {
        this.theme.shockwaves?.spawn(origin, RING_PRESET, opts);
    }

    _echo(origin, opts) {
        this.theme.shockwaves?.spawnEcho(origin, opts);
    }

    _bump(field, value) {
        const fx = this.theme.fxState;
        if (fx) fx[field] = Math.max(fx[field] || 0, value);
    }

    get _meteors() { return this.theme.meteors; }

    get _camera() { return this.theme.cameraDirector; }

    // ── Event handlers ──

    /** "First Light" — every lock births a point of light AT the cell. Flat. */
    _onPieceLock(data = {}) {
        const origin = this._lockOrigin(data?.piece, this._lastOrigin);
        this._wave(origin, { boost: 0.4, speed: 1.6, sigma: 34 });
        this._impulseAt(origin, 1.6, IMPULSE_TYPE.ATTRACTOR);
        this._bump('bloomPunch', 0.04);
        // NO camera shake (cut — over-juice on a calm theme). NO meteor, NO flash.
    }

    _onHardDrop() {
        const origin = this._lastOrigin;
        this._spreadWave(origin, { boost: 0.5, speed: 1.7, sigma: 32 }, 1);
        this._spreadImpulse(origin, 4.0, IMPULSE_TYPE.RADIAL, 1);
        this._meteors?.spawnBright();
        this._spreadRing(origin, { color: [0.9, 0.95, 1.1], maxRadius: 1.4, alpha: 0.8 }, 1);
        this._camera?.dolly(0.06);
        this._bump('bloomPunch', 0.12);
        this._bump('vignettePunch', 0.06);
    }

    _onLineClear(data = {}) {
        const n = Math.max(1, data?.lineCount || 1);
        const origin = this._rowsOrigin(data?.clearedRows, this._lastOrigin);
        if (n >= 4) {
            this._onTetris(origin, data?.clearedRows);
        } else if (n >= 2) {
            this._spreadWave(origin, { boost: 0.7, speed: 1.55, sigma: 28 }, 1);
            this._spreadImpulse(origin, 2.4 + n * 0.4, IMPULSE_TYPE.RADIAL, 1);
            this._spreadRing(origin, { color: [1.0, 0.87, 0.5], maxRadius: 1.8 }, 1);
            this._meteors?.spawnShower(n, 0.5);
            this._bump('bloomPunch', 0.14);
        } else {
            this._spreadWave(origin, { boost: 0.55, speed: 1.6, sigma: 30 }, 1);
            this._spreadImpulse(origin, 1.6, IMPULSE_TYPE.RADIAL, 1);
            this._meteors?.spawnFaint();
            this._bump('bloomPunch', 0.1);
        }
    }

    /** Tetris — a vertical SWEEP (a wave per cleared row, bottom→top) that converges
     * into the burst + fireball + the self-draw constellation. A distinct silhouette
     * from the point-origin combo. */
    _onTetris(origin, clearedRows) {
        const ox = origin.x;
        const oy = origin.y;
        const oz = origin.z;
        const rows = Array.isArray(clearedRows) ? clearedRows.slice().sort((a, b) => b - a) : [];
        rows.forEach((row, k) => {
            this._setTimer(() => {
                this._rowOrigin(row, _sweep, this._originCursor + k);
                this._wave(_sweep, { boost: 0.8, speed: 1.6, sigma: 28 });
            }, k * 55);
        });
        this._setTimer(() => {
            _conv.set(ox, oy, oz);
            this._spreadWave(_conv, { boost: 0.95, speed: 1.5, sigma: 22 }, 2);
            this._spreadImpulse(_conv, 6.0, IMPULSE_TYPE.VORTEX, 2);
            this._spreadRing(_conv, { color: [1.0, 0.96, 0.91], maxRadius: 3.0 }, 2);
            this._meteors?.spawnFireball();
            this.theme.constellations?.triggerMany?.(2, 'earned');
            this._camera?.fovPunch(-2.0);
            this._bump('flashPunch', 0.5);
            this._bump('bloomPunch', 0.18);
            this._maybeB2BEcho(_conv);
        }, rows.length * 55 + 30);
    }

    _onCombo(data = {}) {
        const c = Math.max(1, data?.comboCount || 1);
        const origin = this._lastOrigin; // combos carry no position
        if (c >= 10) {
            // Supernova + the sky remembers — inhale, then bloom into aurora + constellation.
            const ox = origin.x;
            const oy = origin.y;
            const oz = origin.z;
            this._spreadWave(origin, { boost: 0.95, speed: 1.5, sigma: 22 }, 2);
            this._spreadImpulse(origin, 4.0, IMPULSE_TYPE.ATTRACTOR, 1); // inhale
            this._camera?.vertigo(0.9);
            this._setTimer(() => {
                _conv.set(ox, oy, oz);
                this._spreadImpulse(_conv, 10.0, IMPULSE_TYPE.RADIAL, 2); // bloom
                this._spreadEcho(_conv, { maxRadius: 3.6 }, 2);
                this.theme.aurora?.surge?.(0.5, 1200);
                this._comboSigns(c);
                this._meteors?.spawnShower(4, 0.7);
                this._camera?.fovPunch(-2.5);
                this._bump('flashPunch', 0.4);
                this._bump('bloomPunch', 0.26);
                this._maybeB2BEcho(_conv);
            }, 180);
        } else if (c >= 7) {
            this._spreadWave(origin, { boost: 0.8, speed: 1.5, sigma: 26 }, 2);
            this._spreadImpulse(origin, 5.0, IMPULSE_TYPE.VORTEX, 1);
            this._spreadImpulse(origin, 3.0, IMPULSE_TYPE.RADIAL, 1);
            this._spreadRing(origin, { color: [1.0, 0.96, 0.91], maxRadius: 2.6 }, 2);
            this._meteors?.spawnShower(3, 0.55);
            this._camera?.vertigo(0.8);
            this._comboSigns(c);
            this._bump('bloomPunch', 0.22);
            this._maybeB2BEcho(origin);
        } else if (c >= 4) {
            this._spreadWave(origin, { boost: 0.7, speed: 1.55, sigma: 28 }, 1);
            this._spreadImpulse(origin, 3.0, IMPULSE_TYPE.VORTEX, 1);
            this._spreadRing(origin, { color: [1.0, 0.81, 0.42], maxRadius: 2.0 }, 1);
            this._meteors?.spawnShower(2, 0.5);
            this._camera?.dolly(0.1);
            this._comboSigns(c);
            this._bump('bloomPunch', 0.14);
        } else {
            this._spreadWave(origin, { boost: 0.6, speed: 1.6, sigma: 30 }, 1);
            this._spreadImpulse(origin, 1.5 + c * 0.3, IMPULSE_TYPE.VORTEX, 1);
            this._comboSigns(c);
        }
    }

    _onLevelUp() {
        // A wishing star — the earned, magical milestone.
        this._meteors?.spawnWishingStar();
        this._spreadWave(this._lastOrigin, { boost: 0.6, speed: 1.55, sigma: 28 }, 1);
        this._spreadImpulse(this._lastOrigin, 2.0, IMPULSE_TYPE.RADIAL, 1);
        this.theme.aurora?.surge?.(0.4, 1400);
        this._bump('bloomPunch', 0.15);
    }

    _onPerfectClear() {
        const origin = this._lastOrigin;
        this._meteors?.spawnFireball();
        this.theme.constellations?.triggerMany?.(3, 'earned');
        this._spreadWave(origin, { boost: 0.95, speed: 1.5, sigma: 22 }, 2);
        this._spreadImpulse(origin, 5.0, IMPULSE_TYPE.RADIAL, 2);
        this._spreadEcho(origin, { maxRadius: 3.4 }, 2);
        this.theme.aurora?.surge?.(0.6, 1600);
        this._bump('flashPunch', 0.5);
        this._bump('bloomPunch', 0.18);
        this._maybeB2BEcho(origin);
    }

    /** T-spin — "the twist": stars DIM-then-rebrighten (inverted wave) + dust swirl. */
    _onTSpin() {
        const origin = this._lastOrigin;
        this._spreadWave(origin, {
            boost: 0.6, speed: 1.6, sigma: 28, invert: true,
        }, 1);
        this._spreadImpulse(origin, 4.0, IMPULSE_TYPE.VORTEX, 1);
        this._spreadRing(origin, { color: [0.62, 0.55, 0.9], maxRadius: 2.0 }, 1); // lavender
        this._bump('chromaPunch', 0.08);
        this._maybeB2BEcho(origin);
    }

    /** Back-to-back — a "sustain": the next special rings out a second faint echo. */
    _onB2B() {
        this._b2bActive = true;
        this._setTimer(() => { this._b2bActive = false; }, 1500);
    }
}
