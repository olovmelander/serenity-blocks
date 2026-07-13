// @ts-check
/* eslint-disable max-classes-per-file -- RandomStream + its MatchRandom
   factory are one cohesive unit; splitting them would separate the stream
   from the only thing that constructs it. */

export const SFC32_ALGORITHM = 'sfc32-v1';

const UINT32_RANGE = 0x100000000;
const UINT32_MAX = 0xffffffff;
const INT32_MIN = -0x80000000;
// Keep every emitted cursor exactly serializable. The final safe integer is
// reserved so an externally restored terminal cursor cannot overflow on its
// next draw; streams stop atomically at this representable boundary.
const MAX_DRAW_COUNT = Number.MAX_SAFE_INTEGER - 1;

/**
 * @typedef {Object} RandomStreamState
 * @property {string} seed
 * @property {string} label
 * @property {number} a
 * @property {number} b
 * @property {number} c
 * @property {number} d
 * @property {number} drawCount
 */

/**
 * Validate an external RNG cursor before mutating a live stream.
 * @param {unknown} state
 * @returns {RandomStreamState}
 */
export function normalizeSfc32RandomState(state) {
    if (state === null || typeof state !== 'object' || Array.isArray(state)) {
        throw new TypeError('Random stream state must be an object');
    }

    const candidate = /** @type {Record<string, unknown>} */ (state);
    if (typeof candidate.seed !== 'string' || typeof candidate.label !== 'string') {
        throw new TypeError('Random stream seed and label must be strings');
    }

    /** @type {Record<'a'|'b'|'c'|'d', number>} */
    const words = {
        a: 0, b: 0, c: 0, d: 0,
    };
    for (const field of /** @type {const} */ (['a', 'b', 'c', 'd'])) {
        const value = candidate[field];
        if (typeof value !== 'number'
            || !Number.isSafeInteger(value)
            || value < INT32_MIN
            || value > UINT32_MAX) {
            throw new TypeError(
                `Random stream ${field} must be a signed-int32 or uint32 word`,
            );
        }
        // Early sfc32-v1 snapshots serialized the bitwise XOR result for `a`
        // as a signed int32. Canonicalize that legacy representation without
        // widening the accepted domain beyond one 32-bit word.
        words[field] = value >>> 0;
    }

    if (typeof candidate.drawCount !== 'number'
        || !Number.isSafeInteger(candidate.drawCount)
        || candidate.drawCount < 0
        || candidate.drawCount > MAX_DRAW_COUNT) {
        throw new TypeError(
            `Random stream drawCount must be an integer in [0, ${MAX_DRAW_COUNT}]`,
        );
    }

    return {
        seed: candidate.seed,
        label: candidate.label,
        ...words,
        drawCount: candidate.drawCount,
    };
}

/**
 * Deterministic PRNG for the simulation core (remediation plan §5.6).
 *
 * Replaces the 233,280-state LCG (utils/helpers.js seededRandom + its inline
 * clone in ffa-p2p-game-state.js) as the sim's randomness source — behind the
 * Phase 5 flag program, since changing the algorithm changes piece sequences
 * and invalidates old demos (they replay under a §5.8 rulesVersion gate).
 *
 * Design (research foundations, plan §5):
 *  - sfc32: fast, 128-bit state, passes PractRand — the quality pick over
 *    mulberry32 (bryc's JS PRNG shootout).
 *  - xmur3 seeding: hashes an arbitrary seed STRING into as many 32-bit words
 *    as needed, so a ≥64-bit match seed fully initializes the state.
 *  - Per-subsystem streams derived by label: stream(seed, 'pieces:P1') can
 *    never shift stream(seed, 'garbage:P1') — one subsystem's draw count
 *    cannot desync another, and a late joiner reconstructs THEIR OWN stream
 *    from (matchSeed, label, drawCount) independent of everyone else.
 *  - Integer draws use rejection sampling on the high bits — never modulo of
 *    low bits (the 7-bag trap the plan calls out).
 *  - getState/setState/drawCount: the save/restore seam §5.9's savestate and
 *    §6A.6's join snapshot need (the RNG CURSOR ships in the snapshot, not
 *    just the seed — Quadra takeaway #4).
 */

/**
 * xmur3 string hash — returns a function producing a new 32-bit word per call.
 * @param {string} str
 */
export function xmur3(str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i += 1) {
        h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
        h = (h << 13) | (h >>> 19);
    }
    return function next() {
        h = Math.imul(h ^ (h >>> 16), 2246822507);
        h = Math.imul(h ^ (h >>> 13), 3266489909);
        h ^= h >>> 16;
        return h >>> 0;
    };
}

/**
 * A deterministic random stream (sfc32 core).
 */
export class RandomStream {
    /**
     * @param {string|number} seed  Match seed (any length — hashed via xmur3).
     * @param {string} [label]  Subsystem label, e.g. 'pieces:P1', 'garbage:P2'.
     */
    constructor(seed, label = '') {
        this.seed = String(seed);
        this.label = String(label);
        const gen = xmur3(`${this.seed}:${this.label}`);
        this.a = gen(); this.b = gen(); this.c = gen(); this.d = gen();
        this.drawCount = 0;
        // Warm up: xmur3 words are decent but sfc32 mixes fully after a few rounds.
        for (let i = 0; i < 12; i += 1) this._next();
        this.drawCount = 0;
    }

    /** @returns {number} uint32 */
    _next() {
        if (this.drawCount >= MAX_DRAW_COUNT) {
            throw new RangeError('Random stream drawCount is exhausted');
        }
        this.drawCount += 1;
        const t = (((this.a + this.b) >>> 0) + this.d) >>> 0;
        this.d = (this.d + 1) >>> 0;
        this.a = (this.b ^ (this.b >>> 9)) >>> 0;
        this.b = (this.c + (this.c << 3)) >>> 0;
        this.c = ((this.c << 21) | (this.c >>> 11)) >>> 0;
        this.c = (this.c + t) >>> 0;
        return t;
    }

    /** Float in [0, 1) — 32-bit resolution. */
    next() {
        return this._next() / 4294967296;
    }

    /**
     * Integer in [0, maxExclusive) via rejection sampling on the full word —
     * unbiased, never modulo of low bits.
     * @param {number} maxExclusive  1..2^32
     */
    nextInt(maxExclusive) {
        if (!Number.isSafeInteger(maxExclusive)
            || maxExclusive < 1
            || maxExclusive > UINT32_RANGE) {
            throw new RangeError('maxExclusive must be a safe integer in [1, 2^32]');
        }
        const range = maxExclusive;
        const limit = UINT32_RANGE - (UINT32_RANGE % range);
        let x = this._next();
        while (x >= limit) x = this._next();
        return x % range;
    }

    /**
     * Fisher–Yates shuffle IN PLACE (7-bag). Deterministic per stream state.
     * @template T @param {T[]} array @returns {T[]}
     */
    shuffle(array) {
        for (let i = array.length - 1; i > 0; i -= 1) {
            const j = this.nextInt(i + 1);
            const tmp = array[i];
            array[i] = array[j];
            array[j] = tmp;
        }
        return array;
    }

    /**
     * The savestate/join-snapshot seam: full cursor, not just the seed
     * (Quadra #4 — anything the sim reads that is not in the snapshot is a
     * future desync).
     * @returns {RandomStreamState}
     */
    getState() {
        return {
            seed: this.seed,
            label: this.label,
            a: this.a >>> 0,
            b: this.b >>> 0,
            c: this.c >>> 0,
            d: this.d >>> 0,
            drawCount: this.drawCount,
        };
    }

    /** @param {unknown} state */
    setState(state) {
        const validated = normalizeSfc32RandomState(state);
        this.seed = validated.seed;
        this.label = validated.label;
        this.a = validated.a; this.b = validated.b;
        this.c = validated.c; this.d = validated.d;
        this.drawCount = validated.drawCount;
        return this;
    }

    /**
     * Rebuild a stream from a snapshot state.
     * @param {unknown} state
     */
    static fromState(state) {
        const validated = normalizeSfc32RandomState(state);
        return new RandomStream(validated.seed, validated.label).setState(validated);
    }
}

/**
 * @typedef {(() => number) & {
 *   algorithm: string,
 *   seed: string,
 *   label: string,
 *   nextInt: (maxExclusive: number) => number,
 *   getState: () => RandomStreamState,
 *   setState: (state: unknown) => Sfc32Random
 * }} Sfc32Random
 */

/** @param {RandomStream} stream @returns {Sfc32Random} */
function wrapRandomStream(stream) {
    const random = /** @type {Sfc32Random} */ (() => stream.next());
    random.algorithm = SFC32_ALGORITHM;
    random.seed = stream.seed;
    random.label = stream.label;
    random.nextInt = (maxExclusive) => stream.nextInt(maxExclusive);
    random.getState = () => stream.getState();
    random.setState = (state) => {
        stream.setState(state);
        random.seed = stream.seed;
        random.label = stream.label;
        return random;
    };
    return random;
}

/**
 * Create the canonical callable sfc32-v1 adapter.
 * @param {string|number} seed
 * @param {string} [label]
 * @returns {Sfc32Random}
 */
export function createSfc32Random(seed, label = '') {
    return wrapRandomStream(new RandomStream(seed, label));
}

/**
 * Restore the canonical callable sfc32-v1 adapter from serialized state.
 * @param {unknown} state
 * @returns {Sfc32Random}
 */
export function restoreSfc32Random(state) {
    return wrapRandomStream(RandomStream.fromState(state));
}

/**
 * Per-subsystem stream factory over one match seed. Late joiners reconstruct
 * any stream from (seed, label) + a drawCount fast-forward, or exactly via
 * RandomStream.fromState(snapshot.rngState).
 */
export class MatchRandom {
    /** @param {string|number} matchSeed */
    constructor(matchSeed) {
        this.matchSeed = String(matchSeed);
        /** @type {Map<string, RandomStream>} */
        this.streams = new Map();
    }

    /** @param {string} label e.g. 'pieces:P1' */
    stream(label) {
        let s = this.streams.get(label);
        if (!s) {
            s = new RandomStream(this.matchSeed, label);
            this.streams.set(label, s);
        }
        return s;
    }

    /** Snapshot every stream cursor (join snapshot / savestate). */
    getState() {
        return {
            matchSeed: this.matchSeed,
            streams: [...this.streams.values()].map((s) => s.getState()),
        };
    }

    /** @param {ReturnType<MatchRandom['getState']>} state */
    static fromState(state) {
        const m = new MatchRandom(state.matchSeed);
        for (const s of state.streams) m.streams.set(s.label, RandomStream.fromState(s));
        return m;
    }
}
