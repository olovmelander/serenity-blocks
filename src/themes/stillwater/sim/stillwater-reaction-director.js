/**
 * Stillwater gameplay reaction director.
 *
 * This module is deliberately renderer-free. Canonical gameplay events are staged
 * until the next update(), where events from one lock resolution are collapsed into
 * one dominant environmental response:
 *
 * perfect clear > combo 10 miracle > T-spin > line wake > hard-drop dimple
 * > lock dimple. Level-up enrichment is an independent, slowly-eased response.
 *
 * The fixed-capacity implementation is suitable for the gameplay hot path:
 *
 * - five preallocated stream records isolate default/local-multiplayer/Odyssey state;
 * - every stream owns one fixed Int16Array(4) cleared-row buffer;
 * - delayed B2B echoes use a fixed typed-array ring, never timers or closures;
 * - one mutable sink-options object is reused for every synchronous sink call;
 * - event handlers create no arrays, objects, Maps, keys, or delayed callbacks.
 *
 * Sink methods must consume their arguments synchronously and must not retain or
 * mutate the options/row buffer. A later renderer adapter can map normalized origins
 * to lake space and drive prebuilt uniforms, integrated wake slots, mote buffers,
 * character state, and the single priority-special slot.
 */

const BOARD_COLUMNS = 10;
const HIDDEN_ROWS = 4;
const VISIBLE_ROWS = 20;

export const STILLWATER_STREAM_CAPACITY = 5;
export const STILLWATER_ROW_CAPACITY = 4;
export const STILLWATER_BEAT_CAPACITY = 8;

const DEFAULT_MAX_DELTA = 0.1;
const DEFAULT_ECHO_DELAY = 0.18;
const DEFAULT_TIDE_RISE_HALF_LIFE = 0.28;
const DEFAULT_TIDE_FALL_HALF_LIFE = 0.82;
const TIDE_HOLD_SECONDS = 1.65;
const HALF_LIFE_FACTOR = Math.log(2);
const EPSILON = 0.00001;

const EMPTY_PAYLOAD = Object.freeze({});
const EMPTY_CONFIG = Object.freeze({});
const acceptAll = () => true;

export const STILLWATER_CHANNEL = Object.freeze({
    DIMPLE: 'dimple',
    WAKE: 'wake',
    TWIST: 'twist',
    ECHO: 'echo',
    MIRACLE: 'miracle',
    SPIRIT_ATTENTION: 'spiritAttention',
    TROLL_CUE: 'trollCue',
    TIDE: 'enchantmentTide',
    LEVEL_UP: 'levelUp',
});

export const STILLWATER_CUE = Object.freeze({
    RUNE_DIMPLE: 'rune-dimple',
    STONEFALL_DIMPLE: 'stonefall-dimple',
    REED_WHISPER: 'reed-whisper',
    TWIN_CURRENT: 'twin-current',
    MOON_PATH: 'moon-path',
    LAKE_OPENS: 'lake-opens',
    NACKS_TURN: 'nacks-turn',
    FOREST_REMEMBERS: 'forest-remembers',
    STILLWATER_AWAKENING: 'stillwater-awakening',
    ECHO_ACROSS_MERE: 'echo-across-mere',
    FOREST_NOTICE: 'forest-notice',
    ENCHANTMENT_TIDE: 'enchantment-tide',
    MOON_DEEPENS: 'moon-deepens',
});

export const STILLWATER_EVENT = Object.freeze({
    PIECE_LOCK: 'pieceLock',
    LINE_CLEAR: 'lineClear',
    COMBO: 'combo',
    TSPIN: 'tspin',
    B2B: 'b2b',
    PERFECT_CLEAR: 'perfectClear',
    HARD_DROP: 'hardDrop',
    LEVEL_UP: 'levelUp',
});

const SPECIAL_NONE = 0;
const SPECIAL_TETRIS = 1;
const SPECIAL_TSPIN = 2;
const SPECIAL_COMBO_APEX = 3;
const SPECIAL_PERFECT_CLEAR = 4;

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function clamp01(value) {
    return clamp(value, 0, 1);
}

function finiteNumber(value, fallback) {
    return Number.isFinite(value) ? Number(value) : fallback;
}

function positiveHalfLife(value, fallback) {
    return Number.isFinite(value) && value > EPSILON ? Number(value) : fallback;
}

function normalizeSource(payload) {
    return typeof payload.source === 'string' && payload.source.length > 0
        ? payload.source
        : null;
}

function normalizeLevelId(payload) {
    const { levelId } = payload;
    if (typeof levelId === 'string') return levelId;
    if (Number.isFinite(levelId)) return Number(levelId);
    return null;
}

function normalizePlayer(payload) {
    return Number.isFinite(payload.player) ? Math.trunc(Number(payload.player)) : 0;
}

function comboTier(comboCount) {
    if (comboCount >= 10) return 4;
    if (comboCount >= 7) return 3;
    if (comboCount >= 4) return 2;
    if (comboCount >= 2) return 1;
    return 0;
}

function tideForTier(tier) {
    if (tier >= 4) return 1;
    if (tier === 3) return 0.76;
    if (tier === 2) return 0.5;
    if (tier === 1) return 0.26;
    return 0;
}

function cueForLineCount(lineCount) {
    if (lineCount >= 4) return STILLWATER_CUE.LAKE_OPENS;
    if (lineCount === 3) return STILLWATER_CUE.MOON_PATH;
    if (lineCount === 2) return STILLWATER_CUE.TWIN_CURRENT;
    return STILLWATER_CUE.REED_WHISPER;
}

function cueForSpecial(special) {
    if (special === SPECIAL_TETRIS) return STILLWATER_CUE.LAKE_OPENS;
    if (special === SPECIAL_TSPIN) return STILLWATER_CUE.NACKS_TURN;
    if (special === SPECIAL_COMBO_APEX) return STILLWATER_CUE.FOREST_REMEMBERS;
    if (special === SPECIAL_PERFECT_CLEAR) return STILLWATER_CUE.STILLWATER_AWAKENING;
    return STILLWATER_CUE.ECHO_ACROSS_MERE;
}

function createStream(index) {
    return {
        index,
        assigned: false,
        source: null,
        levelId: null,
        player: 0,
        touched: 0,
        pending: false,
        lock: false,
        hardDrop: false,
        dropDistance: 0,
        lockBoardX: BOARD_COLUMNS * 0.5,
        lockBoardY: HIDDEN_ROWS + VISIBLE_ROWS * 0.5,
        lockX: 0.5,
        lockY: 0.5,
        lineCount: 0,
        rowCount: 0,
        rows: new Int16Array(STILLWATER_ROW_CAPACITY),
        // ON-SCREEN clear origin supplied by scrolling-grid modes (Infinity); null → use the
        // fixed-board row normalization. Kept separate from lockX/lockY (the lock origin).
        lineViewportX: null,
        lineViewportY: null,
        cascadeCount: 1,
        comboPresent: false,
        comboCount: 0,
        tspin: false,
        tspinLineCount: 0,
        b2b: false,
        perfectClear: false,
        perfectDepth: 0,
        levelUp: false,
        level: 0,
        hasPosition: false,
        positionX: 0,
        positionY: 0,
        lastBoardX: BOARD_COLUMNS * 0.5,
        lastBoardY: HIDDEN_ROWS + VISIBLE_ROWS * 0.5,
        lastX: 0.5,
        lastY: 0.5,
        lastComboCount: 0,
        lastComboTier: 0,
        lastSpecial: SPECIAL_NONE,
        tideTarget: 0,
        tideHold: 0,
    };
}

function clearPending(stream) {
    stream.pending = false;
    stream.lock = false;
    stream.hardDrop = false;
    stream.dropDistance = 0;
    stream.lineCount = 0;
    stream.rowCount = 0;
    stream.lineViewportX = null;
    stream.lineViewportY = null;
    stream.cascadeCount = 1;
    stream.comboPresent = false;
    stream.comboCount = 0;
    stream.tspin = false;
    stream.tspinLineCount = 0;
    stream.b2b = false;
    stream.perfectClear = false;
    stream.perfectDepth = 0;
    stream.levelUp = false;
    stream.level = 0;
    stream.hasPosition = false;
    stream.positionX = 0;
    stream.positionY = 0;
}

function resetStream(stream, releaseIdentity) {
    clearPending(stream);
    stream.lastBoardX = BOARD_COLUMNS * 0.5;
    stream.lastBoardY = HIDDEN_ROWS + VISIBLE_ROWS * 0.5;
    stream.lastX = 0.5;
    stream.lastY = 0.5;
    stream.lastComboCount = 0;
    stream.lastComboTier = 0;
    stream.lastSpecial = SPECIAL_NONE;
    stream.tideTarget = 0;
    stream.tideHold = 0;
    if (releaseIdentity) {
        stream.assigned = false;
        stream.source = null;
        stream.levelId = null;
        stream.player = 0;
        stream.touched = 0;
    }
}

function createSinkOptions() {
    return {
        sequence: 0,
        channel: '',
        cue: '',
        source: null,
        levelId: null,
        player: 0,
        streamIndex: -1,
        originX: 0.5,
        originY: 0.5,
        boardX: BOARD_COLUMNS * 0.5,
        boardY: HIDDEN_ROWS + VISIBLE_ROWS * 0.5,
        hasPosition: false,
        positionX: 0,
        positionY: 0,
        strength: 0,
        motionScale: 1,
        durationMs: 0,
        moteCount: 0,
        lineCount: 0,
        comboCount: 0,
        comboTier: 0,
        cascadeCount: 1,
        cascadeDepth: 0,
        depth: 0,
        level: 0,
        dropDistance: 0,
        direction: 0,
        rowCount: 0,
        specialPriority: 0,
        reducedMotion: false,
        echoOf: '',
    };
}

/**
 * @typedef {Object} StillwaterReactionSink
 * @property {(options: object, rows?: Int16Array) => void} [dimple]
 * @property {(options: object, rows?: Int16Array) => void} [wake]
 * @property {(options: object, rows?: Int16Array) => void} [twist]
 * @property {(options: object, rows?: Int16Array) => void} [echo]
 * @property {(options: object, rows?: Int16Array) => void} [miracle]
 * @property {(options: object, rows?: Int16Array) => void} [spiritAttention]
 * @property {(options: object, rows?: Int16Array) => void} [trollCue]
 * @property {(options: object, rows?: Int16Array) => void} [tide]
 * @property {(options: object, rows?: Int16Array) => void} [levelUp]
 */

export class StillwaterReactionDirector {
    /**
     * @param {{
     *   sink?: StillwaterReactionSink,
     *   acceptPayload?: (payload: object, eventName: string) => boolean,
     *   enabled?: boolean,
     *   backgroundComboEffects?: boolean,
     *   pieceLockRipple?: boolean,
     *   reducedMotion?: boolean,
     *   intensity?: number,
     *   echoDelay?: number,
     *   maxDelta?: number,
     *   tideRiseHalfLife?: number,
     *   tideFallHalfLife?: number,
     * }} [options]
     */
    constructor(options = EMPTY_CONFIG) {
        this.sink = options.sink || null;
        this.acceptPayload = typeof options.acceptPayload === 'function'
            ? options.acceptPayload
            : acceptAll;
        this.enabled = options.enabled !== false;
        this.backgroundComboEffects = options.backgroundComboEffects !== false;
        this.pieceLockRipple = options.pieceLockRipple !== false;
        this.reducedMotion = options.reducedMotion === true;
        this.intensity = clamp01(finiteNumber(options.intensity, 1));
        this.echoDelay = clamp(finiteNumber(options.echoDelay, DEFAULT_ECHO_DELAY), 0.16, 0.2);
        this.maxDelta = clamp(
            finiteNumber(options.maxDelta, DEFAULT_MAX_DELTA),
            1 / 1000,
            DEFAULT_MAX_DELTA,
        );
        this.tideRiseHalfLife = positiveHalfLife(
            options.tideRiseHalfLife,
            DEFAULT_TIDE_RISE_HALF_LIFE,
        );
        this.tideFallHalfLife = positiveHalfLife(
            options.tideFallHalfLife,
            DEFAULT_TIDE_FALL_HALF_LIFE,
        );

        this.time = 0;
        this.enchantmentTide = 0;
        this.tideTarget = 0;
        this.disposed = false;
        this.touchSerial = 0;
        this.sinkSequence = 0;
        this.droppedEvents = 0;
        this.droppedBeats = 0;
        this.sinkErrors = 0;

        this.streams = new Array(STILLWATER_STREAM_CAPACITY);
        this.rowBuffers = new Array(STILLWATER_STREAM_CAPACITY);
        for (let index = 0; index < STILLWATER_STREAM_CAPACITY; index += 1) {
            const stream = createStream(index);
            this.streams[index] = stream;
            this.rowBuffers[index] = stream.rows;
        }

        this.beatHead = 0;
        this.beatCount = 0;
        this.beatDue = new Float64Array(STILLWATER_BEAT_CAPACITY);
        this.beatSpecial = new Uint8Array(STILLWATER_BEAT_CAPACITY);
        this.beatSource = new Array(STILLWATER_BEAT_CAPACITY).fill(null);
        this.beatLevelId = new Array(STILLWATER_BEAT_CAPACITY).fill(null);
        this.beatPlayer = new Float64Array(STILLWATER_BEAT_CAPACITY);
        this.beatX = new Float32Array(STILLWATER_BEAT_CAPACITY);
        this.beatY = new Float32Array(STILLWATER_BEAT_CAPACITY);
        this.beatBoardX = new Float32Array(STILLWATER_BEAT_CAPACITY);
        this.beatBoardY = new Float32Array(STILLWATER_BEAT_CAPACITY);
        this.beatStrength = new Float32Array(STILLWATER_BEAT_CAPACITY);
        this.beatMotionScale = new Float32Array(STILLWATER_BEAT_CAPACITY);
        this.beatDurationMs = new Uint16Array(STILLWATER_BEAT_CAPACITY);

        this.sinkOptions = createSinkOptions();
        this.unsubscribers = new Array(8).fill(null);
        this.attached = false;

        this.boundPieceLock = this.onPieceLock.bind(this);
        this.boundLineClear = this.onLineClear.bind(this);
        this.boundCombo = this.onCombo.bind(this);
        this.boundTSpin = this.onTSpin.bind(this);
        this.boundB2B = this.onB2B.bind(this);
        this.boundPerfectClear = this.onPerfectClear.bind(this);
        this.boundHardDrop = this.onHardDrop.bind(this);
        this.boundLevelUp = this.onLevelUp.bind(this);
        this.boundDetach = this.detach.bind(this);
    }

    /**
     * Subscribe defensively to the eight canonical gameplay events. Older
     * harnesses may omit HARD_DROP/LEVEL_UP; cascade remains encoded in the
     * LINE_CLEAR payload's clearedRows/cascadeCount fields.
     */
    attach(bus, events) {
        if (this.disposed || !bus || typeof bus.on !== 'function' || !events) {
            return this.boundDetach;
        }
        this.detach();
        this.unsubscribers[0] = bus.on(events.PIECE_LOCK, this.boundPieceLock);
        this.unsubscribers[1] = bus.on(events.LINE_CLEAR, this.boundLineClear);
        this.unsubscribers[2] = bus.on(events.COMBO, this.boundCombo);
        this.unsubscribers[3] = bus.on(events.TSPIN, this.boundTSpin);
        this.unsubscribers[4] = bus.on(events.B2B, this.boundB2B);
        this.unsubscribers[5] = bus.on(events.PERFECT_CLEAR, this.boundPerfectClear);
        this.unsubscribers[6] = events.HARD_DROP
            ? bus.on(events.HARD_DROP, this.boundHardDrop)
            : null;
        this.unsubscribers[7] = events.LEVEL_UP
            ? bus.on(events.LEVEL_UP, this.boundLevelUp)
            : null;
        this.attached = true;
        return this.boundDetach;
    }

    detach() {
        for (let index = 0; index < this.unsubscribers.length; index += 1) {
            const unsubscribe = this.unsubscribers[index];
            if (typeof unsubscribe === 'function') {
                try {
                    unsubscribe();
                } catch (error) {
                    // A failing external unsubscribe must not strand the other five.
                }
            }
            this.unsubscribers[index] = null;
        }
        this.attached = false;
    }

    /**
     * Runtime settings may change without recreating pools or this director.
     * Turning reactions off clears pending work and delayed echoes so re-enabling
     * cannot replay stale gameplay.
     */
    configure(options = EMPTY_CONFIG) {
        if (this.disposed) return;
        if (options.sink !== undefined) this.sink = options.sink || null;
        if (typeof options.acceptPayload === 'function') this.acceptPayload = options.acceptPayload;
        if (options.enabled !== undefined) this.enabled = options.enabled !== false;
        if (options.backgroundComboEffects !== undefined) {
            this.backgroundComboEffects = options.backgroundComboEffects !== false;
        }
        if (options.pieceLockRipple !== undefined) {
            this.pieceLockRipple = options.pieceLockRipple !== false;
            if (!this.pieceLockRipple) {
                for (let index = 0; index < this.streams.length; index += 1) {
                    // Retain the captured centroid for a co-resolving T-spin/clear,
                    // but cancel the routine dimple immediately.
                    this.streams[index].lock = false;
                    this.streams[index].hardDrop = false;
                }
            }
        }
        if (options.reducedMotion !== undefined) {
            this.reducedMotion = options.reducedMotion === true;
        }
        if (options.intensity !== undefined) {
            this.intensity = clamp01(finiteNumber(options.intensity, this.intensity));
        }
        if (options.echoDelay !== undefined) {
            this.echoDelay = clamp(
                finiteNumber(options.echoDelay, this.echoDelay),
                0.16,
                0.2,
            );
        }
        if (options.maxDelta !== undefined) {
            this.maxDelta = clamp(
                finiteNumber(options.maxDelta, this.maxDelta),
                1 / 1000,
                DEFAULT_MAX_DELTA,
            );
        }
        if (options.tideRiseHalfLife !== undefined) {
            this.tideRiseHalfLife = positiveHalfLife(
                options.tideRiseHalfLife,
                this.tideRiseHalfLife,
            );
        }
        if (options.tideFallHalfLife !== undefined) {
            this.tideFallHalfLife = positiveHalfLife(
                options.tideFallHalfLife,
                this.tideFallHalfLife,
            );
        }

        if (!this._effectsEnabled()) this._clearTransientState();
    }

    onPieceLock(payload = EMPTY_PAYLOAD) {
        if (!this._canStage(payload, STILLWATER_EVENT.PIECE_LOCK)) return false;
        const stream = this._streamFor(payload);
        if (!stream) return false;
        stream.pending = true;
        stream.lock = this.pieceLockRipple;
        this._capturePosition(stream, payload);
        this._captureLockCentroid(stream, payload);
        return true;
    }

    onHardDrop(payload = EMPTY_PAYLOAD) {
        if (!this._canStage(payload, STILLWATER_EVENT.HARD_DROP)) return false;
        const stream = this._streamFor(payload);
        if (!stream) return false;
        stream.pending = true;
        stream.hardDrop = this.pieceLockRipple;
        stream.dropDistance = Math.max(
            0,
            finiteNumber(
                payload.distance,
                finiteNumber(payload.endY, 0) - finiteNumber(payload.startY, 0),
            ),
        );
        this._capturePosition(stream, payload);
        this._captureLockCentroid(stream, payload);
        return true;
    }

    onLevelUp(payload = EMPTY_PAYLOAD) {
        if (!this._canStage(payload, STILLWATER_EVENT.LEVEL_UP)) return false;
        const stream = this._streamFor(payload);
        if (!stream) return false;
        stream.pending = true;
        stream.levelUp = true;
        stream.level = Math.max(1, Math.trunc(finiteNumber(payload.level, 1)));
        this._capturePosition(stream, payload);
        return true;
    }

    onLineClear(payload = EMPTY_PAYLOAD) {
        if (!this._canStage(payload, STILLWATER_EVENT.LINE_CLEAR)) return false;
        const stream = this._streamFor(payload);
        if (!stream) return false;
        stream.pending = true;

        const rawRows = payload.clearedRows;
        const incomingCascade = clamp(
            Math.trunc(finiteNumber(payload.cascadeCount, 1)),
            1,
            255,
        );
        if (stream.lineCount === 0 || incomingCascade >= stream.cascadeCount) {
            const fallbackCount = rawRows && Number.isFinite(rawRows.length)
                ? rawRows.length
                : 1;
            stream.lineCount = clamp(
                Math.trunc(finiteNumber(payload.lineCount, fallbackCount)),
                1,
                STILLWATER_ROW_CAPACITY,
            );
            stream.cascadeCount = incomingCascade;
            this._copyRows(stream, rawRows);
            // Capture the ON-SCREEN clear origin (Infinity) alongside the rows it belongs to.
            const hasViewport = Number.isFinite(payload.viewportOrigin?.x)
                && Number.isFinite(payload.viewportOrigin?.y);
            stream.lineViewportX = hasViewport ? clamp01(Number(payload.viewportOrigin.x)) : null;
            stream.lineViewportY = hasViewport ? clamp01(Number(payload.viewportOrigin.y)) : null;
        }

        if (Number.isFinite(payload.comboCount)) {
            const combo = Math.max(0, Math.trunc(Number(payload.comboCount)));
            if (!stream.comboPresent || combo > stream.comboCount) stream.comboCount = combo;
            stream.comboPresent = true;
        }
        this._capturePosition(stream, payload);
        return true;
    }

    onCombo(payload = EMPTY_PAYLOAD) {
        if (!this._canStage(payload, STILLWATER_EVENT.COMBO)) return false;
        const stream = this._streamFor(payload);
        if (!stream) return false;
        stream.pending = true;
        const combo = Math.max(0, Math.trunc(finiteNumber(payload.comboCount, 0)));
        if (!stream.comboPresent || combo > stream.comboCount) stream.comboCount = combo;
        stream.comboPresent = true;
        this._capturePosition(stream, payload);
        return true;
    }

    onTSpin(payload = EMPTY_PAYLOAD) {
        if (!this._canStage(payload, STILLWATER_EVENT.TSPIN)) return false;
        const stream = this._streamFor(payload);
        if (!stream) return false;
        stream.pending = true;
        stream.tspin = true;
        stream.tspinLineCount = clamp(
            Math.trunc(finiteNumber(payload.lineCount, 0)),
            0,
            STILLWATER_ROW_CAPACITY,
        );
        this._capturePosition(stream, payload);
        return true;
    }

    onB2B(payload = EMPTY_PAYLOAD) {
        if (!this._canStage(payload, STILLWATER_EVENT.B2B)) return false;
        const stream = this._streamFor(payload);
        if (!stream) return false;
        stream.pending = true;
        stream.b2b = payload.active !== false;
        this._capturePosition(stream, payload);
        return true;
    }

    onPerfectClear(payload = EMPTY_PAYLOAD) {
        if (!this._canStage(payload, STILLWATER_EVENT.PERFECT_CLEAR)) return false;
        const stream = this._streamFor(payload);
        if (!stream) return false;
        stream.pending = true;
        stream.perfectClear = true;
        stream.perfectDepth = Math.max(0, finiteNumber(payload.depth, 0));
        this._capturePosition(stream, payload);
        return true;
    }

    /**
     * Advance theme time with a clamped delta, resolve staged gameplay, fire due
     * B2B echoes, and ease the continuous enchantment tide by half-life.
     */
    update(deltaSeconds) {
        if (this.disposed) return;
        const delta = clamp(finiteNumber(deltaSeconds, 0), 0, this.maxDelta);
        this.time += delta;

        for (let index = 0; index < this.streams.length; index += 1) {
            const stream = this.streams[index];
            if (stream.pending) this._flushStream(stream);
        }

        this._fireDueBeats();
        this._updateTide(delta);
    }

    reset() {
        this.time = 0;
        this.enchantmentTide = 0;
        this.tideTarget = 0;
        this.touchSerial = 0;
        this.sinkSequence = 0;
        this.droppedEvents = 0;
        this.droppedBeats = 0;
        this.sinkErrors = 0;
        for (let index = 0; index < this.streams.length; index += 1) {
            resetStream(this.streams[index], true);
        }
        this._clearBeats();
    }

    dispose() {
        if (this.disposed) return;
        this.detach();
        this.reset();
        this.disposed = true;
        this.sink = null;
    }

    /**
     * Diagnostics may allocate; gameplay intake/update do not. Buffer references are
     * exposed solely so QA can prove fixed backing identities during reaction storms.
     */
    getDebugState() {
        const streamState = [];
        let activeStreams = 0;
        let pendingStreams = 0;
        for (let index = 0; index < this.streams.length; index += 1) {
            const stream = this.streams[index];
            if (stream.assigned) activeStreams += 1;
            if (stream.pending) pendingStreams += 1;
            streamState.push({
                index,
                assigned: stream.assigned,
                source: stream.source,
                levelId: stream.levelId,
                player: stream.player,
                pending: stream.pending,
                lastComboCount: stream.lastComboCount,
                lastComboTier: stream.lastComboTier,
                tideTarget: stream.tideTarget,
                level: stream.level,
            });
        }
        return {
            time: this.time,
            enchantmentTide: this.enchantmentTide,
            tideTarget: this.tideTarget,
            activeStreams,
            pendingStreams,
            scheduledBeats: this.beatCount,
            droppedEvents: this.droppedEvents,
            droppedBeats: this.droppedBeats,
            sinkErrors: this.sinkErrors,
            attached: this.attached,
            disposed: this.disposed,
            reducedMotion: this.reducedMotion,
            intensity: this.intensity,
            streams: streamState,
            rowBuffers: this.rowBuffers,
            beatDue: this.beatDue,
            beatSpecial: this.beatSpecial,
            sinkOptions: this.sinkOptions,
        };
    }

    _effectsEnabled() {
        return this.enabled && this.backgroundComboEffects && this.intensity > 0;
    }

    _canStage(payload, eventName) {
        if (this.disposed || !this._effectsEnabled()) return false;
        try {
            return this.acceptPayload(payload, eventName) !== false;
        } catch (error) {
            return false;
        }
    }

    _streamFor(payload) {
        const source = normalizeSource(payload);
        const levelId = normalizeLevelId(payload);
        const player = normalizePlayer(payload);
        this.touchSerial += 1;

        let unused = null;
        let reusable = null;
        let oldestTouch = Infinity;
        for (let index = 0; index < this.streams.length; index += 1) {
            const stream = this.streams[index];
            if (
                stream.assigned
                && stream.source === source
                && stream.levelId === levelId
                && stream.player === player
            ) {
                stream.touched = this.touchSerial;
                return stream;
            }
            if (!stream.assigned && unused === null) unused = stream;
            if (stream.assigned && !stream.pending && stream.touched < oldestTouch) {
                oldestTouch = stream.touched;
                reusable = stream;
            }
        }

        const selected = unused || reusable;
        if (!selected) {
            this.droppedEvents += 1;
            return null;
        }
        resetStream(selected, false);
        selected.assigned = true;
        selected.source = source;
        selected.levelId = levelId;
        selected.player = player;
        selected.touched = this.touchSerial;
        return selected;
    }

    _capturePosition(stream, payload) {
        if (Number.isFinite(payload.position?.x) && Number.isFinite(payload.position?.y)) {
            stream.hasPosition = true;
            stream.positionX = Number(payload.position.x);
            stream.positionY = Number(payload.position.y);
        }
    }

    _captureLockCentroid(stream, payload) {
        const piece = payload.piece || EMPTY_PAYLOAD;
        const { shape } = piece;
        const pieceX = finiteNumber(piece.x, BOARD_COLUMNS * 0.5 - 0.5);
        const pieceY = finiteNumber(piece.y, HIDDEN_ROWS + VISIBLE_ROWS * 0.5 - 0.5);
        let totalX = 0;
        let totalY = 0;
        let occupied = 0;

        if (Array.isArray(shape)) {
            const rowLimit = Math.min(shape.length, 8);
            for (let rowIndex = 0; rowIndex < rowLimit; rowIndex += 1) {
                const row = shape[rowIndex];
                if (!Array.isArray(row)) continue;
                const columnLimit = Math.min(row.length, 8);
                for (let columnIndex = 0; columnIndex < columnLimit; columnIndex += 1) {
                    if (Number(row[columnIndex]) > 0) {
                        totalX += pieceX + columnIndex + 0.5;
                        totalY += pieceY + rowIndex + 0.5;
                        occupied += 1;
                    }
                }
            }
        }

        const boardX = occupied > 0 ? totalX / occupied : pieceX + 0.5;
        const boardY = occupied > 0 ? totalY / occupied : pieceY + 0.5;
        stream.lockBoardX = boardX;
        stream.lockBoardY = boardY;
        stream.lockX = clamp01(boardX / BOARD_COLUMNS);
        stream.lockY = clamp01((boardY - HIDDEN_ROWS) / VISIBLE_ROWS);

        if (
            Number.isFinite(payload.viewportOrigin?.x)
            && Number.isFinite(payload.viewportOrigin?.y)
        ) {
            stream.lockX = clamp01(Number(payload.viewportOrigin.x));
            stream.lockY = clamp01(Number(payload.viewportOrigin.y));
        }

        stream.lastBoardX = boardX;
        stream.lastBoardY = boardY;
        stream.lastX = stream.lockX;
        stream.lastY = stream.lockY;
    }

    _copyRows(stream, rows) {
        stream.rowCount = 0;
        if (!Array.isArray(rows)) return;
        const limit = Math.min(rows.length, STILLWATER_ROW_CAPACITY);
        for (let index = 0; index < limit; index += 1) {
            if (!Number.isFinite(rows[index])) continue;
            const row = clamp(Math.trunc(Number(rows[index])), -32768, 32767);
            stream.rows[stream.rowCount] = row;
            stream.rowCount += 1;
        }
    }

    _flushStream(stream) {
        const lineCount = Math.max(stream.lineCount, stream.tspinLineCount);
        const comboCount = stream.comboPresent ? stream.comboCount : 0;
        const tier = comboTier(comboCount);
        let crossedTier = 0;

        if (stream.comboPresent) {
            if (comboCount < stream.lastComboCount) stream.lastComboTier = 0;
            if (tier > stream.lastComboTier) crossedTier = tier;
            stream.lastComboCount = comboCount;
            if (tier > stream.lastComboTier) stream.lastComboTier = tier;
            stream.tideTarget = tideForTier(tier);
            stream.tideHold = tier > 0 ? TIDE_HOLD_SECONDS : 0;
        }

        let originX = stream.lastX;
        let originY = stream.lastY;
        let boardX = stream.lastBoardX;
        let boardY = stream.lastBoardY;
        if (stream.lineCount > 0 && stream.rowCount > 0) {
            let rowTotal = 0;
            for (let index = 0; index < stream.rowCount; index += 1) {
                rowTotal += stream.rows[index];
            }
            boardX = BOARD_COLUMNS * 0.5;
            boardY = rowTotal / stream.rowCount + 0.5;
            // Prefer the ON-SCREEN clear origin (Infinity) over the fixed-board row
            // normalization, which pins to the bottom when clearedRows are absolute.
            originX = Number.isFinite(stream.lineViewportX) ? stream.lineViewportX : 0.5;
            originY = Number.isFinite(stream.lineViewportY)
                ? stream.lineViewportY
                : clamp01((boardY - HIDDEN_ROWS) / VISIBLE_ROWS);
            stream.lastBoardX = boardX;
            stream.lastBoardY = boardY;
            stream.lastX = originX;
            stream.lastY = originY;
        }

        let special = SPECIAL_NONE;
        let specialStrength = 0;
        if (stream.perfectClear) {
            special = SPECIAL_PERFECT_CLEAR;
            specialStrength = 1;
            this._emitMiracle(
                stream,
                STILLWATER_CUE.STILLWATER_AWAKENING,
                originX,
                originY,
                boardX,
                boardY,
                1,
                tier,
            );
        } else if (lineCount > 0 && comboCount >= 10) {
            special = SPECIAL_COMBO_APEX;
            specialStrength = 0.92;
            this._emitMiracle(
                stream,
                STILLWATER_CUE.FOREST_REMEMBERS,
                originX,
                originY,
                boardX,
                boardY,
                0.92,
                tier,
            );
        } else if (stream.tspin) {
            special = SPECIAL_TSPIN;
            specialStrength = clamp(0.72 + lineCount * 0.08, 0.72, 1);
            this._emitTwist(stream, specialStrength, lineCount, tier);
            originX = stream.lock ? stream.lockX : stream.lastX;
            originY = stream.lock ? stream.lockY : stream.lastY;
            boardX = stream.lock ? stream.lockBoardX : stream.lastBoardX;
            boardY = stream.lock ? stream.lockBoardY : stream.lastBoardY;
        } else if (stream.lineCount > 0) {
            this._emitWake(stream, comboCount, tier);
            if (stream.lineCount >= 4) {
                special = SPECIAL_TETRIS;
                specialStrength = 1;
            }
        } else if (stream.hardDrop) {
            this._emitDimple(stream, true);
        } else if (stream.lock) {
            this._emitDimple(stream);
        }

        if (crossedTier >= 3) this._emitForestNotice(stream, crossedTier, comboCount);
        if (special !== SPECIAL_NONE) {
            stream.lastSpecial = special;
            if (stream.b2b) {
                this._scheduleEcho(
                    stream,
                    special,
                    originX,
                    originY,
                    boardX,
                    boardY,
                    specialStrength,
                );
            }
        }
        if (stream.levelUp) this._emitLevelUp(stream);

        clearPending(stream);
    }

    _prepareOptions(stream, channel, cue) {
        const options = this.sinkOptions;
        this.sinkSequence += 1;
        options.sequence = this.sinkSequence;
        options.channel = channel;
        options.cue = cue;
        options.source = stream ? stream.source : null;
        options.levelId = stream ? stream.levelId : null;
        options.player = stream ? stream.player : 0;
        options.streamIndex = stream ? stream.index : -1;
        options.originX = stream ? stream.lastX : 0.5;
        options.originY = stream ? stream.lastY : 0.5;
        options.boardX = stream ? stream.lastBoardX : BOARD_COLUMNS * 0.5;
        options.boardY = stream
            ? stream.lastBoardY
            : HIDDEN_ROWS + VISIBLE_ROWS * 0.5;
        options.hasPosition = stream ? stream.hasPosition : false;
        options.positionX = stream ? stream.positionX : 0;
        options.positionY = stream ? stream.positionY : 0;
        options.strength = 0;
        options.motionScale = this.reducedMotion ? 0 : 1;
        options.durationMs = 0;
        options.moteCount = 0;
        options.lineCount = stream ? stream.lineCount : 0;
        options.comboCount = stream && stream.comboPresent ? stream.comboCount : 0;
        options.comboTier = options.comboCount > 0 ? comboTier(options.comboCount) : 0;
        options.cascadeCount = stream ? stream.cascadeCount : 1;
        options.cascadeDepth = Math.max(0, options.cascadeCount - 1);
        options.depth = stream ? stream.perfectDepth : 0;
        options.level = stream ? stream.level : 0;
        options.dropDistance = stream ? stream.dropDistance : 0;
        options.direction = 0;
        options.rowCount = stream ? stream.rowCount : 0;
        options.specialPriority = 0;
        options.reducedMotion = this.reducedMotion;
        options.echoOf = '';
        return options;
    }

    _emitDimple(stream, hardDrop = false) {
        const options = this._prepareOptions(
            stream,
            STILLWATER_CHANNEL.DIMPLE,
            hardDrop
                ? STILLWATER_CUE.STONEFALL_DIMPLE
                : STILLWATER_CUE.RUNE_DIMPLE,
        );
        options.originX = stream.lockX;
        options.originY = stream.lockY;
        options.boardX = stream.lockBoardX;
        options.boardY = stream.lockBoardY;
        if (hardDrop) {
            const distanceWeight = clamp(stream.dropDistance / 18, 0, 1);
            options.strength = (0.58 + distanceWeight * 0.18) * this.intensity;
            options.durationMs = this.reducedMotion ? 260 : 680;
            options.moteCount = this.reducedMotion ? 0 : 7;
            options.direction = stream.lockX < 0.5 ? -1 : 1;
        } else {
            options.strength = 0.34 * this.intensity;
            options.durationMs = this.reducedMotion ? 220 : 520;
            options.moteCount = this.reducedMotion ? 0 : 4;
        }
        this._invokeSink('dimple', null);
    }

    _emitLevelUp(stream) {
        const options = this._prepareOptions(
            stream,
            STILLWATER_CHANNEL.LEVEL_UP,
            STILLWATER_CUE.MOON_DEEPENS,
        );
        options.level = stream.level;
        options.strength = clamp(
            0.34 + Math.log2(stream.level + 1) * 0.11,
            0.34,
            1,
        ) * this.intensity;
        options.durationMs = this.reducedMotion ? 1600 : 2800;
        options.moteCount = 0;
        this._invokeSink('levelUp', null);
    }

    _emitWake(stream, comboCount, tier) {
        const { lineCount } = stream;
        const options = this._prepareOptions(
            stream,
            STILLWATER_CHANNEL.WAKE,
            cueForLineCount(lineCount),
        );
        let strength = 0.44;
        let durationMs = 620;
        let motes = 8;
        if (lineCount === 2) {
            strength = 0.6;
            durationMs = 760;
            motes = 16;
        } else if (lineCount === 3) {
            strength = 0.78;
            durationMs = 920;
            motes = 24;
        } else if (lineCount >= 4) {
            strength = 1;
            durationMs = 1200;
            motes = 40;
            options.specialPriority = 1;
        }
        options.strength = strength * this.intensity;
        options.durationMs = this.reducedMotion ? Math.min(380, durationMs * 0.4) : durationMs;
        options.moteCount = this.reducedMotion ? 0 : motes;
        options.comboCount = comboCount;
        options.comboTier = tier;
        options.direction = stream.cascadeCount % 2 === 0 ? 1 : -1;
        this._invokeSink('wake', stream.rows);
    }

    _emitTwist(stream, strength, lineCount, tier) {
        const options = this._prepareOptions(
            stream,
            STILLWATER_CHANNEL.TWIST,
            STILLWATER_CUE.NACKS_TURN,
        );
        options.originX = stream.lock ? stream.lockX : stream.lastX;
        options.originY = stream.lock ? stream.lockY : stream.lastY;
        options.boardX = stream.lock ? stream.lockBoardX : stream.lastBoardX;
        options.boardY = stream.lock ? stream.lockBoardY : stream.lastBoardY;
        options.strength = strength * this.intensity;
        options.durationMs = this.reducedMotion ? 300 : 980;
        options.moteCount = this.reducedMotion ? 4 : 20;
        options.lineCount = lineCount;
        options.comboTier = tier;
        options.direction = -1;
        options.specialPriority = 1;
        this._invokeSink('twist', null);
    }

    _emitMiracle(stream, cue, x, y, boardX, boardY, strength, tier) {
        const options = this._prepareOptions(stream, STILLWATER_CHANNEL.MIRACLE, cue);
        options.originX = x;
        options.originY = y;
        options.boardX = boardX;
        options.boardY = boardY;
        options.strength = strength * this.intensity;
        const awakening = cue === STILLWATER_CUE.STILLWATER_AWAKENING;
        if (this.reducedMotion) {
            options.durationMs = awakening ? 520 : 420;
            options.moteCount = 8;
        } else {
            options.durationMs = awakening ? 1600 : 1280;
            options.moteCount = awakening ? 72 : 56;
        }
        options.comboTier = tier;
        options.specialPriority = 2;
        this._invokeSink('miracle', null);
    }

    _emitForestNotice(stream, tier, comboCount) {
        let options = this._prepareOptions(
            stream,
            STILLWATER_CHANNEL.SPIRIT_ATTENTION,
            STILLWATER_CUE.FOREST_NOTICE,
        );
        options.strength = (tier >= 4 ? 0.9 : 0.62) * this.intensity;
        options.durationMs = this.reducedMotion ? 260 : 760;
        options.comboCount = comboCount;
        options.comboTier = tier;
        this._invokeSink('spiritAttention', null);

        options = this._prepareOptions(
            stream,
            STILLWATER_CHANNEL.TROLL_CUE,
            STILLWATER_CUE.FOREST_NOTICE,
        );
        options.strength = (tier >= 4 ? 0.72 : 0.48) * this.intensity;
        options.durationMs = this.reducedMotion ? 280 : 920;
        options.comboCount = comboCount;
        options.comboTier = tier;
        this._invokeSink('trollCue', null);
    }

    _scheduleEcho(stream, special, x, y, boardX, boardY, strength) {
        if (this.beatCount >= STILLWATER_BEAT_CAPACITY) {
            this.droppedBeats += 1;
            return;
        }
        const slot = (this.beatHead + this.beatCount) % STILLWATER_BEAT_CAPACITY;
        this.beatDue[slot] = this.time + this.echoDelay;
        this.beatSpecial[slot] = special;
        this.beatSource[slot] = stream.source;
        this.beatLevelId[slot] = stream.levelId;
        this.beatPlayer[slot] = stream.player;
        this.beatX[slot] = x;
        this.beatY[slot] = y;
        this.beatBoardX[slot] = boardX;
        this.beatBoardY[slot] = boardY;
        this.beatStrength[slot] = strength * 0.5 * this.intensity;
        this.beatMotionScale[slot] = this.reducedMotion ? 0 : 1;
        this.beatDurationMs[slot] = this.reducedMotion ? 180 : 540;
        this.beatCount += 1;
    }

    _fireDueBeats() {
        while (
            this.beatCount > 0
            && this.beatDue[this.beatHead] <= this.time + Number.EPSILON
        ) {
            const slot = this.beatHead;
            const options = this._prepareOptions(
                null,
                STILLWATER_CHANNEL.ECHO,
                STILLWATER_CUE.ECHO_ACROSS_MERE,
            );
            options.source = this.beatSource[slot];
            options.levelId = this.beatLevelId[slot];
            options.player = this.beatPlayer[slot];
            options.originX = this.beatX[slot];
            options.originY = this.beatY[slot];
            options.boardX = this.beatBoardX[slot];
            options.boardY = this.beatBoardY[slot];
            options.strength = this.beatStrength[slot];
            options.motionScale = this.beatMotionScale[slot];
            options.durationMs = this.beatDurationMs[slot];
            options.moteCount = this.reducedMotion ? 0 : 8;
            options.specialPriority = 1;
            options.echoOf = cueForSpecial(this.beatSpecial[slot]);
            this._invokeSink('echo', null);

            this.beatSource[slot] = null;
            this.beatLevelId[slot] = null;
            this.beatSpecial[slot] = SPECIAL_NONE;
            this.beatHead = (this.beatHead + 1) % STILLWATER_BEAT_CAPACITY;
            this.beatCount -= 1;
        }
    }

    _updateTide(delta) {
        let target = 0;
        for (let index = 0; index < this.streams.length; index += 1) {
            const stream = this.streams[index];
            if (!stream.assigned) continue;
            if (stream.tideHold > 0) {
                stream.tideHold = Math.max(0, stream.tideHold - delta);
                if (stream.tideHold === 0) stream.tideTarget = 0;
            }
            if (stream.tideTarget > target) target = stream.tideTarget;
        }
        target *= this.intensity * (this.reducedMotion ? 0.58 : 1);
        this.tideTarget = target;

        const difference = target - this.enchantmentTide;
        if (Math.abs(difference) <= EPSILON || delta <= 0) return;
        const halfLife = difference > 0 ? this.tideRiseHalfLife : this.tideFallHalfLife;
        const blend = 1 - Math.exp((-HALF_LIFE_FACTOR * delta) / halfLife);
        this.enchantmentTide += difference * blend;
        if (Math.abs(target - this.enchantmentTide) <= EPSILON) {
            this.enchantmentTide = target;
        }

        const options = this._prepareOptions(
            null,
            STILLWATER_CHANNEL.TIDE,
            STILLWATER_CUE.ENCHANTMENT_TIDE,
        );
        options.strength = this.enchantmentTide;
        options.durationMs = 0;
        this._invokeSink('tide', null);
    }

    _invokeSink(method, rows) {
        const sinkMethod = this.sink && this.sink[method];
        if (typeof sinkMethod !== 'function') return;
        try {
            sinkMethod.call(this.sink, this.sinkOptions, rows || undefined);
        } catch (error) {
            this.sinkErrors += 1;
        }
    }

    _clearBeats() {
        for (let index = 0; index < STILLWATER_BEAT_CAPACITY; index += 1) {
            this.beatSource[index] = null;
            this.beatLevelId[index] = null;
            this.beatSpecial[index] = SPECIAL_NONE;
        }
        this.beatHead = 0;
        this.beatCount = 0;
    }

    _clearTransientState() {
        const hadTide = this.enchantmentTide > EPSILON;
        for (let index = 0; index < this.streams.length; index += 1) {
            resetStream(this.streams[index], false);
        }
        this._clearBeats();
        this.enchantmentTide = 0;
        this.tideTarget = 0;
        if (hadTide) {
            const options = this._prepareOptions(
                null,
                STILLWATER_CHANNEL.TIDE,
                STILLWATER_CUE.ENCHANTMENT_TIDE,
            );
            options.strength = 0;
            this._invokeSink('tide', null);
        }
    }
}

export default StillwaterReactionDirector;
