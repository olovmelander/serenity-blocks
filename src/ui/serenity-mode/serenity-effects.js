// @ts-check
/**
 * Theme effects in Serenity Mode: every reaction a theme has to play — a piece locking, a
 * hard drop, line clears, combos, cascades, a T-spin, back-to-back, a perfect clear, a level
 * up — on demand, so you can watch what each world does without playing a game. Two more play
 * the BUILD-UP of fast play (Rush: twenty quick hard drops; Fever: a twelve-clear chain to a
 * perfect clear), where a theme's answers must accumulate rather than pop and restart
 * (src/themes/shared/gameplay-surge.js).
 *
 * Each effect is a short script of the gameplay events real play sends, in the order and
 * with the payloads it sends them (the pinned physics schedule, ADR-0011 and
 * tests/unit/physics-callback-schedule.test.js), through the canonical emitters
 * (src/events/gameplay-events.js). A theme receives exactly what a game would give it; the
 * only addition is `source: 'serenity-effects'`, which no theme reads. Only themes listen to
 * these events, so nothing is scored, saved or unlocked.
 *
 * Every effect stands on its own: when the last lock cleared lines, the next clearing effect
 * first sets down one plain piece, as play would, so a Double after a Single is a double and
 * not the second step of a combo (themes count combos from the lock sequence: see
 * src/core/combo-tracker.js).
 *
 * The scripts are data (`buildEffect`), so tests read them without a bus or a clock; the
 * player (`SerenityEffects`) runs them on injected timers.
 */
import {
    COLORS, COLS, HIDDEN_ROWS, ROWS, SHAPES,
} from '../../core/constants.js';
import { rotateShape } from '../../core/pieces.js';
import { calculateLineClearScore } from '../../core/scoring.js';
import {
    emitB2B, emitCombo, emitHardDrop, emitLevelUp, emitLineClear, emitPerfectClear, emitPieceLock,
    emitTSpin,
} from '../../events/gameplay-events.js';

/** The board's bottom row (the matrix counts the hidden rows above the visible twenty). */
export const FLOOR_ROW = ROWS + HIDDEN_ROWS - 1;
/** Where a piece appears before it falls (src/core/pieces.js spawnPiece). */
const SPAWN_Y = HIDDEN_ROWS - 2;
/** Between cascade waves: the cleared rows' hold (160 ms) and the fall of what was above. */
export const WAVE_MS = 360;
/** Between the locks of a combo: a quick, steady hand. */
export const LOCK_MS = 720;
/** Between the two difficult clears of a back-to-back. */
export const B2B_MS = 1400;
/** The plain piece that ends a chain comes this long before the effect's own lock. */
export const BREAK_MS = 900;
/** Rush: between the hard drops of a quick hand (over three pieces a second). */
export const RUSH_MS = 300;
/** Fever: between the clearing locks of a long chain. */
export const FEVER_MS = 640;
/** Play all: the quiet after each effect, so its afterglow can be seen. */
export const TOUR_REST_MS = 2600;
export const SOURCE = 'serenity-effects';

export const EFFECT_GROUPS = [
    { id: 'pieces', label: 'Pieces' },
    { id: 'clears', label: 'Line clears' },
    { id: 'cascades', label: 'Cascades' },
    { id: 'chains', label: 'Chains' },
    { id: 'moments', label: 'Moments' },
    { id: 'buildup', label: 'Build-up' },
];

/**
 * @typedef {{ at: number, type: string, payload: Record<string, any> }} EffectStep
 * @typedef {{ colorFor: (shapeKey: string) => string, pieces: number, level: number,
 *   chain: boolean }} EffectContext
 * @typedef {{ id: string, group: string, label: string, name: string,
 *   build: (s: ReturnType<typeof script>, ctx: EffectContext) => void }} EffectDefinition
 */

/** Pieces in turn for the effects that may use any shape, and the columns they land in. */
const LOCK_SHAPES = ['T', 'L', 'S', 'O', 'J', 'Z', 'I'];
const LOCK_COLUMNS = [1, 6, 3, 0, 7, 4, 2];

/** @param {number} count @param {number} [floor] the rows a clear of `count` lines takes */
export function rowsFromFloor(count, floor = FLOOR_ROW) {
    return Array.from({ length: count }, (_, i) => floor - count + 1 + i);
}

/**
 * A piece set down with its lowest cell on `floor` and its leftmost cell in `column`.
 * @param {EffectContext} ctx
 * @param {string} shapeKey
 * @param {{ column: number, turns?: number, floor?: number }} place
 */
export function placePiece(ctx, shapeKey, { column, turns = 0, floor = FLOOR_ROW }) {
    let shape = SHAPES[shapeKey].map((row) => row.slice());
    for (let i = 0; i < turns; i += 1) shape = rotateShape(shape, 'right');
    let bottom = -1;
    let left = Infinity;
    let right = -1;
    shape.forEach((row, y) => row.forEach((cell, x) => {
        if (!cell) return;
        bottom = Math.max(bottom, y);
        left = Math.min(left, x);
        right = Math.max(right, x);
    }));
    const width = right - left + 1;
    const x = Math.max(0, Math.min(COLS - width, column)) - left;
    ctx.pieces += 1;
    return {
        shapeKey,
        shape,
        rotation: turns % 4,
        x,
        y: floor - bottom,
        color: ctx.colorFor(shapeKey),
        pieceId: ctx.pieces,
    };
}

/** The next shape and column in turn. @param {EffectContext} ctx */
function nextPiece(ctx) {
    const turn = ctx.pieces;
    return placePiece(ctx, LOCK_SHAPES[turn % LOCK_SHAPES.length], {
        column: LOCK_COLUMNS[turn % LOCK_COLUMNS.length],
    });
}

/** A timeline the effects write into. */
function script() {
    /** @type {EffectStep[]} */
    const steps = [];
    let t = 0;
    return {
        steps,
        /** @param {string} type @param {Record<string, any>} payload */
        emit(type, payload) {
            steps.push({ at: t, type, payload: { ...payload, source: SOURCE } });
        },
        /** @param {number} ms */
        wait(ms) {
            t += ms;
        },
    };
}

/** The piece leaves the hand: a hard drop (optional, same tick) and the lock. */
function lock(s, ctx, piece, { drop = false, clears = false } = {}) {
    if (drop) s.emit('hardDrop', { piece, startY: SPAWN_Y, endY: piece.y });
    s.emit('pieceLock', { piece });
    ctx.chain = clears;
}

/**
 * One wave of a lock's clear, in the physics order: COMBO (the cascade depth, from the second
 * wave), LEVEL_UP when the clear crosses a level, then LINE_CLEAR.
 */
function wave(s, ctx, rows, cascadeCount, { levelUp = false } = {}) {
    if (cascadeCount >= 2) s.emit('combo', { comboCount: cascadeCount });
    if (levelUp) {
        ctx.level += 1;
        s.emit('levelUp', { level: ctx.level });
    }
    s.emit('lineClear', { lineCount: rows.length, clearedRows: rows, cascadeCount });
}

/** A clearing effect stands alone: end the chain the last one left with one plain piece. */
function freshChain(s, ctx) {
    if (!ctx.chain) return;
    lock(s, ctx, nextPiece(ctx));
    s.wait(BREAK_MS);
}

/** A clear of `lines` by one piece that fits it (the same column order as plain locks). */
function clearWith(s, ctx, lines, shapes) {
    freshChain(s, ctx);
    const turn = ctx.pieces;
    const { key, turns } = shapes[turn % shapes.length];
    const piece = placePiece(ctx, key, { column: LOCK_COLUMNS[turn % LOCK_COLUMNS.length], turns });
    lock(s, ctx, piece, { clears: true });
    wave(s, ctx, rowsFromFloor(lines), 1);
}

/** The I piece standing in the well at the right edge: four rows, a quad. */
function quad(s, ctx) {
    lock(s, ctx, placePiece(ctx, 'I', { column: COLS - 1, turns: 1 }), { clears: true });
    wave(s, ctx, rowsFromFloor(4), 1);
}

/** A cascade of `depth` waves set off by one lock. */
function cascade(depth) {
    return (s, ctx) => {
        clearWith(s, ctx, 2, [{ key: 'O', turns: 0 }, { key: 'S', turns: 0 }, { key: 'Z', turns: 0 }]);
        for (let n = 2; n <= depth; n += 1) {
            s.wait(WAVE_MS);
            // The rows that fill as the blocks above fall: one, now and then two.
            wave(s, ctx, rowsFromFloor(n % 3 === 0 ? 2 : 1), n);
        }
    };
}

/**
 * Rush: twenty pieces hard-dropped at a quick hand's pace. Every fourth clears a line or two
 * (the last a quad), with plain pieces between, so no combo forms: what builds is the PACE.
 */
function rush(s, ctx) {
    freshChain(s, ctx);
    for (let n = 0; n < 20; n += 1) {
        if (n > 0) s.wait(RUSH_MS);
        if (n === 19) {
            lock(s, ctx, placePiece(ctx, 'I', { column: COLS - 1, turns: 1 }), { drop: true, clears: true });
            wave(s, ctx, rowsFromFloor(4), 1);
        } else if (n % 4 === 3) {
            const lines = n % 8 === 3 ? 1 : 2;
            const key = lines === 1 ? 'I' : 'O';
            const column = LOCK_COLUMNS[n % LOCK_COLUMNS.length];
            lock(s, ctx, placePiece(ctx, key, { column }), { drop: true, clears: true });
            wave(s, ctx, rowsFromFloor(lines), 1);
        } else {
            lock(s, ctx, nextPiece(ctx), { drop: true });
        }
    }
}

/**
 * Fever: twelve clearing locks in a row, hard-dropped, each one bigger than the play before —
 * singles into doubles into triples, a T-spin, a four-wave cascade — ending in a quad that
 * empties the board. A theme counts the combo from one to twelve.
 */
const FEVER_PIECES = [null, { key: 'I', turns: 0 }, { key: 'O', turns: 0 }, { key: 'L', turns: 1 }];

function fever(s, ctx) {
    freshChain(s, ctx);
    const plan = [1, 1, 2, 1, 2, 2, 3, 'tspin', 2, 'cascade', 3, 'quad'];
    plan.forEach((step, n) => {
        if (n > 0) s.wait(FEVER_MS);
        if (step === 'quad') {
            lock(s, ctx, placePiece(ctx, 'I', { column: COLS - 1, turns: 1 }), { drop: true, clears: true });
            wave(s, ctx, rowsFromFloor(4), 1);
            s.wait(WAVE_MS);
            const level = Math.max(1, ctx.level);
            const perfectClearBonus = calculateLineClearScore(4, level, 1, true)
                - calculateLineClearScore(4, level, 1, false);
            s.emit('perfectClear', { depth: 4, perfectClearBonus });
        } else if (step === 'tspin') {
            lock(s, ctx, placePiece(ctx, 'T', { column: 3 }), { drop: true, clears: true });
            wave(s, ctx, rowsFromFloor(2), 1);
            s.emit('tspin', { lineCount: 2 });
        } else if (step === 'cascade') {
            const column = LOCK_COLUMNS[n % LOCK_COLUMNS.length];
            lock(s, ctx, placePiece(ctx, 'S', { column }), { drop: true, clears: true });
            wave(s, ctx, rowsFromFloor(2), 1);
            for (let w = 2; w <= 4; w += 1) {
                s.wait(WAVE_MS);
                wave(s, ctx, rowsFromFloor(w % 3 === 0 ? 2 : 1), w);
            }
        } else {
            // A flat I for one row, an O for two, an L stood on end for three.
            const lines = Number(step);
            const { key, turns } = FEVER_PIECES[lines];
            const column = LOCK_COLUMNS[n % LOCK_COLUMNS.length];
            lock(s, ctx, placePiece(ctx, key, { column, turns }), { drop: true, clears: true });
            wave(s, ctx, rowsFromFloor(lines), 1);
        }
    });
}

/** @type {EffectDefinition[]} */
export const EFFECTS = [
    {
        id: 'lock',
        group: 'pieces',
        label: 'Lock',
        name: 'Piece lock',
        build: (s, ctx) => lock(s, ctx, nextPiece(ctx)),
    },
    {
        id: 'hard-drop',
        group: 'pieces',
        label: 'Hard drop',
        name: 'Hard drop',
        build: (s, ctx) => lock(s, ctx, nextPiece(ctx), { drop: true }),
    },
    {
        id: 'single',
        group: 'clears',
        label: 'Single',
        name: 'Single · one line',
        build: (s, ctx) => clearWith(s, ctx, 1, LOCK_SHAPES.map((key) => ({ key, turns: 0 }))),
    },
    {
        id: 'double',
        group: 'clears',
        label: 'Double',
        name: 'Double · two lines',
        build: (s, ctx) => clearWith(s, ctx, 2, ['O', 'S', 'Z', 'T', 'J', 'L'].map((key) => ({ key, turns: 0 }))),
    },
    {
        id: 'triple',
        group: 'clears',
        label: 'Triple',
        name: 'Triple · three lines',
        // Stood on end, three rows tall.
        build: (s, ctx) => clearWith(s, ctx, 3, ['L', 'J', 'T'].map((key) => ({ key, turns: 1 }))),
    },
    {
        id: 'quad',
        group: 'clears',
        label: 'Quad',
        name: 'Quad · four lines',
        build: (s, ctx) => {
            freshChain(s, ctx);
            quad(s, ctx);
        },
    },
    {
        id: 'cascade-3',
        group: 'cascades',
        label: '3 waves',
        name: 'Cascade · three waves',
        build: cascade(3),
    },
    {
        id: 'cascade-6',
        group: 'cascades',
        label: '6 waves',
        name: 'Cascade · six waves',
        build: cascade(6),
    },
    {
        id: 'cascade-10',
        group: 'cascades',
        label: '10 waves',
        name: 'Mega cascade · ten waves',
        build: cascade(10),
    },
    {
        id: 'combo',
        group: 'chains',
        label: 'Combo ×5',
        name: 'Combo · five clears in a row',
        build: (s, ctx) => {
            freshChain(s, ctx);
            for (let n = 0; n < 5; n += 1) {
                if (n > 0) s.wait(LOCK_MS);
                lock(s, ctx, nextPiece(ctx), { clears: true });
                wave(s, ctx, rowsFromFloor(1), 1);
            }
        },
    },
    {
        id: 'b2b',
        group: 'chains',
        label: 'Back-to-back',
        name: 'Back-to-back · two quads',
        build: (s, ctx) => {
            freshChain(s, ctx);
            quad(s, ctx);
            s.wait(B2B_MS);
            // A plain piece between them, as play would: the second quad is back-to-back,
            // not the second step of a combo.
            lock(s, ctx, nextPiece(ctx));
            s.wait(BREAK_MS);
            quad(s, ctx);
            s.emit('b2b', { active: true });
        },
    },
    {
        id: 'tspin',
        group: 'moments',
        label: 'T-spin',
        name: 'T-spin double',
        build: (s, ctx) => {
            freshChain(s, ctx);
            // The T turned point-down into its slot: its bar and its point are the two rows.
            lock(s, ctx, placePiece(ctx, 'T', { column: 3 }), { clears: true });
            wave(s, ctx, rowsFromFloor(2), 1);
            s.emit('tspin', { lineCount: 2 });
        },
    },
    {
        id: 'perfect-clear',
        group: 'moments',
        label: 'Perfect clear',
        name: 'Perfect clear · the board empties',
        build: (s, ctx) => {
            freshChain(s, ctx);
            quad(s, ctx);
            // After the last wave has settled, the board is empty.
            s.wait(WAVE_MS);
            const level = Math.max(1, ctx.level);
            const perfectClearBonus = calculateLineClearScore(4, level, 1, true)
                - calculateLineClearScore(4, level, 1, false);
            s.emit('perfectClear', { depth: 4, perfectClearBonus });
        },
    },
    {
        id: 'level-up',
        group: 'moments',
        label: 'Level up',
        name: 'Level up',
        build: (s, ctx) => {
            freshChain(s, ctx);
            lock(s, ctx, nextPiece(ctx), { clears: true });
            wave(s, ctx, rowsFromFloor(1), 1, { levelUp: true });
        },
    },
    {
        id: 'rush',
        group: 'buildup',
        label: 'Rush',
        name: "Rush · twenty pieces at a quick hand's pace",
        build: rush,
    },
    {
        id: 'fever',
        group: 'buildup',
        label: 'Fever',
        name: 'Fever · a twelve-clear chain to a perfect clear',
        build: fever,
    },
];

const BY_ID = new Map(EFFECTS.map((effect) => [effect.id, effect]));

/** @param {string} id */
export function effectById(id) {
    return BY_ID.get(id) || null;
}

/**
 * What repeated effects remember: the next piece, the level, whether the last lock cleared.
 * @param {{ colorFor?: (shapeKey: string) => string|null|undefined }} [options] the theme's
 *   colour for a piece, as a game would paint it (the standard colour when it has none)
 * @returns {EffectContext}
 */
export function createEffectContext({ colorFor } = {}) {
    return {
        colorFor: (key) => colorFor?.(key) || COLORS[key] || '#808080',
        pieces: 0,
        level: 1,
        chain: false,
    };
}

/**
 * The events an effect sends, with when (ms from its start). Advances `ctx`.
 * @param {string} id @param {EffectContext} ctx
 * @returns {EffectStep[]|null}
 */
export function buildEffect(id, ctx) {
    const effect = effectById(id);
    if (!effect) return null;
    const s = script();
    effect.build(s, ctx);
    return s.steps;
}

/** How long an effect's events take. @param {EffectStep[]} steps */
export function effectDuration(steps) {
    return steps.length ? steps[steps.length - 1].at : 0;
}

const EMITTERS = {
    hardDrop: emitHardDrop,
    pieceLock: emitPieceLock,
    lineClear: emitLineClear,
    combo: emitCombo,
    levelUp: emitLevelUp,
    tspin: emitTSpin,
    b2b: emitB2B,
    perfectClear: emitPerfectClear,
};

/** Send one step through its canonical emitter. @param {EffectStep} step */
export function emitEffectStep(step) {
    const emit = /** @type {Record<string, (payload: any) => void>} */ (EMITTERS)[step.type];
    if (emit) emit(step.payload);
}

/**
 * Plays effects one at a time: a new one ends the one before it (play never overlaps two
 * locks). "Play all" walks through every effect in the tray's order.
 */
export class SerenityEffects {
    /**
     * @param {object} [options]
     * @param {(step: EffectStep) => void} [options.emit]
     * @param {(fn: () => void, ms: number) => any} [options.setTimer]
     * @param {(handle: any) => void} [options.clearTimer]
     * @param {(shapeKey: string) => string|null|undefined} [options.colorFor] the theme's colour
     *   for a piece (none: the standard colour)
     * @param {(state: { playing: string|null, touring: boolean }) => void} [options.onChange]
     * @param {(effect: EffectDefinition, index: number, total: number) => void} [options.onTourStep]
     */
    constructor({
        emit = emitEffectStep,
        setTimer = (fn, ms) => setTimeout(fn, ms),
        clearTimer = (handle) => clearTimeout(handle),
        colorFor,
        onChange = () => {},
        onTourStep = () => {},
    } = {}) {
        this.emit = emit;
        this.setTimer = setTimer;
        this.clearTimer = clearTimer;
        this.onChange = onChange;
        this.onTourStep = onTourStep;
        this.ctx = createEffectContext({ colorFor });
        /** @type {any[]} */
        this.timers = [];
        /** @type {string|null} */
        this.playing = null;
        this.touring = false;
    }

    /**
     * Play one effect now (ending any other, and Play all).
     * @param {string} id @returns {boolean} whether it is a known effect
     */
    play(id) {
        if (!effectById(id)) return false;
        this._cancel();
        this.touring = false;
        this._run(id, () => this._settle());
        return true;
    }

    /** Every effect in turn, with a pause after each. Again, or any effect, ends it. */
    playAll() {
        this._cancel();
        this.touring = true;
        const next = (index) => {
            if (index >= EFFECTS.length) {
                this._settle();
                return;
            }
            const effect = EFFECTS[index];
            this.onTourStep(effect, index, EFFECTS.length);
            this._run(effect.id, () => this._after(TOUR_REST_MS, () => next(index + 1)));
        };
        next(0);
    }

    /** Stop what is playing (its later events are not sent). */
    stop() {
        if (!this.playing && !this.touring && !this.timers.length) return;
        this._cancel();
        this._settle();
    }

    destroy() {
        this._cancel();
        this.playing = null;
        this.touring = false;
    }

    /** @param {string} id @param {() => void} done */
    _run(id, done) {
        const steps = buildEffect(id, this.ctx) || [];
        this.playing = id;
        this.onChange({ playing: this.playing, touring: this.touring });
        steps.filter((step) => step.at === 0).forEach((step) => this.emit(step));
        steps.filter((step) => step.at > 0).forEach((step) => {
            this._after(step.at, () => this.emit(step));
        });
        // The effect's name stays lit a moment after its last event.
        this._after(effectDuration(steps) + 500, done);
    }

    /** @param {number} ms @param {() => void} fn */
    _after(ms, fn) {
        const handle = this.setTimer(() => {
            this.timers = this.timers.filter((timer) => timer !== handle);
            fn();
        }, ms);
        this.timers.push(handle);
    }

    _cancel() {
        this.timers.forEach((handle) => this.clearTimer(handle));
        this.timers = [];
    }

    _settle() {
        this.playing = null;
        this.touring = false;
        this.onChange({ playing: null, touring: false });
    }
}
