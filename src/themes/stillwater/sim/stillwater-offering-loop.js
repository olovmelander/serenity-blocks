/**
 * Stillwater — "The Offering Loop".
 *
 * The theme had two characters and no relationship between them. This module is
 * the relationship: a timed five-beat loop, wrapped in a one-way session arc, in
 * which a troll carries his lantern to the water, reaches, withdraws before she
 * answers, and must be gone before dawn.
 *
 * Folkloric spine (see docs/STILLWATER_BAUER_MASTERPIECE_PLAN_2026-07.md §3):
 * the troll is the landscape made animate and is unmade by the first ray of
 * dawn; an offering left at the water is the transaction with näcken; the
 * skogsrå aids those who show the forest respect. One relationship, never
 * consummated.
 *
 * Deliberately renderer-free and dependency-free so it is unit-testable without
 * a GPU, in the same spirit as the storm and vesper directors.
 *
 * The single most important design rule here: gameplay may add a GESTURE inside
 * the current beat, but may never change the beat. One-to-one coupling between
 * line clears and character reactions reads as a slot machine and destroys any
 * sense that the characters have volition.
 */

export const STILLWATER_BEAT = Object.freeze({
    REST: 'rest',
    NOTICE: 'notice',
    APPROACH: 'approach',
    OFFER: 'offer',
    RETURN: 'return',
});

export const STILLWATER_FEATURE = Object.freeze({
    NONE: null,
    TROLL: 'troll',
    SPIRIT: 'spirit',
});

/**
 * Response gestures, drawn without replacement so the same reaction never
 * repeats back to back.
 */
export const STILLWATER_RESPONSE = Object.freeze([
    'troll-head-snap',
    'lantern-flare',
    'spirit-mote-surge',
    'troll-step-closer',
    'firefly-scatter',
]);

// Beat durations in seconds. REST is long on purpose: dead air is what makes the
// next movement register as an event rather than as constant fidgeting.
const BEAT_PLAN = Object.freeze({
    [STILLWATER_BEAT.REST]: {
        duration: 90, intimacy: 0.05, separation: 22, lantern: 0.35, feature: STILLWATER_FEATURE.NONE,
    },
    [STILLWATER_BEAT.NOTICE]: {
        duration: 25, intimacy: 0.25, separation: 18, lantern: 0.60, feature: STILLWATER_FEATURE.TROLL,
    },
    [STILLWATER_BEAT.APPROACH]: {
        duration: 35, intimacy: 0.60, separation: 12, lantern: 0.85, feature: STILLWATER_FEATURE.TROLL,
    },
    [STILLWATER_BEAT.OFFER]: {
        duration: 45, intimacy: 0.85, separation: 9, lantern: 1.0, feature: STILLWATER_FEATURE.TROLL,
    },
    [STILLWATER_BEAT.RETURN]: {
        duration: 45, intimacy: 0.05, separation: 22, lantern: 0.35, feature: STILLWATER_FEATURE.SPIRIT,
    },
});

const BEAT_ORDER = Object.freeze([
    STILLWATER_BEAT.REST,
    STILLWATER_BEAT.NOTICE,
    STILLWATER_BEAT.APPROACH,
    STILLWATER_BEAT.OFFER,
    STILLWATER_BEAT.RETURN,
]);

// They never touch and never enter personal distance. This floor is a hard
// invariant, not a tuning value — the whole point is that it is never resolved.
export const MIN_SEPARATION = 7;
export const MAX_INTIMACY = 0.85;

// Gameplay accumulation. Weights are per event; the pool leaks continuously so
// sustained good play matters more than any single clear.
const EVENT_WEIGHTS = Object.freeze({
    tetris: 3.0,
    tspin: 2.5,
    combo: 1.0,
    lineClear: 0.6,
    perfectClear: 3.5,
    hardDrop: 0.15,
});
const ACCUMULATOR_DECAY_PER_SECOND = 0.35;
const ACCUMULATOR_THRESHOLD = 6.0;
const RESPONSE_LOCKOUT_SECONDS = 45;
const RESPONSE_LATENCY_RANGE = Object.freeze([0.8, 2.2]);

// The session arc. Sunrise never arrives — D caps below 1 so the deadline is
// always approaching and never resolved.
const DAWN_DURATION_SECONDS = 1500;
export const DAWN_CAP = 0.94;
const DAWN_NO_APPROACH = 0.70;
const DAWN_PETRIFY = 0.90;

// Reach and withdraw during OFFER, as offsets from the beat start. The withdraw
// is deliberately slower than the reach; that asymmetry is the characterisation.
const REACH_START = 12;
const REACH_RISE = 1.1;
const REACH_HOLD = 0.9;
const REACH_FALL = 1.4;

function clamp(value, low, high) {
    return Math.min(high, Math.max(low, value));
}

function smoothstep(edge0, edge1, x) {
    const t = clamp((x - edge0) / (edge1 - edge0 || 1e-6), 0, 1);
    return t * t * (3 - 2 * t);
}

/**
 * @param {object} [options]
 * @param {() => number} [options.random] injectable RNG so tests are deterministic
 */
export function createStillwaterOfferingLoop({ random = Math.random } = {}) {
    let beatIndex = 0;
    let beatAge = 0;
    let beatDuration = BEAT_PLAN[STILLWATER_BEAT.REST].duration;
    let { intimacy } = BEAT_PLAN[STILLWATER_BEAT.REST];
    let { separation } = BEAT_PLAN[STILLWATER_BEAT.REST];
    let { lantern } = BEAT_PLAN[STILLWATER_BEAT.REST];
    let dawn = 0;
    let accumulator = 0;
    let lockout = 0;
    let armedLatency = -1;
    let pendingResponse = null;
    let activeResponse = null;
    let activeResponseAge = 0;
    let deck = [];
    let lastDrawn = null;
    let restEarlyExitUsed = false;
    let elapsed = 0;

    function refillDeck() {
        deck = STILLWATER_RESPONSE.slice();
        for (let i = deck.length - 1; i > 0; i -= 1) {
            const j = Math.floor(random() * (i + 1));
            [deck[i], deck[j]] = [deck[j], deck[i]];
        }
        // Shuffle-bag boundary: the last card of the previous deck can otherwise
        // be the first of the next, which is the one repeat draw-without-
        // replacement exists to prevent. Cards are drawn with pop(), so the next
        // draw is the tail.
        if (deck.length > 1 && deck[deck.length - 1] === lastDrawn) {
            const swap = Math.floor(random() * (deck.length - 1));
            [deck[deck.length - 1], deck[swap]] = [deck[swap], deck[deck.length - 1]];
        }
    }
    refillDeck();

    function beatName() {
        return BEAT_ORDER[beatIndex];
    }

    function jitterFor(name) {
        // Only the final beat carries the jitter, so the cycle boundary never
        // lands on a predictable clock.
        return name === STILLWATER_BEAT.RETURN ? 20 + random() * 20 : 0;
    }

    function enterBeat(index) {
        beatIndex = index % BEAT_ORDER.length;
        beatAge = 0;
        const name = beatName();
        beatDuration = BEAT_PLAN[name].duration + jitterFor(name);
        if (name === STILLWATER_BEAT.REST) restEarlyExitUsed = false;
    }

    function advanceBeat() {
        let next = (beatIndex + 1) % BEAT_ORDER.length;
        // Late in the session he rises and sits back down: the approach is the
        // first thing the deadline takes away from him.
        if (BEAT_ORDER[next] === STILLWATER_BEAT.APPROACH && dawn > DAWN_NO_APPROACH) {
            next = BEAT_ORDER.indexOf(STILLWATER_BEAT.RETURN);
        }
        enterBeat(next);
    }

    /** Reach envelope during OFFER: rise, hold at full extension, slower withdraw. */
    function reachExtension(age) {
        if (beatName() !== STILLWATER_BEAT.OFFER) return 0;
        const t = age - REACH_START;
        if (t <= 0) return 0;
        if (t < REACH_RISE) return smoothstep(0, REACH_RISE, t);
        if (t < REACH_RISE + REACH_HOLD) return 1;
        const fall = t - REACH_RISE - REACH_HOLD;
        if (fall < REACH_FALL) return 1 - smoothstep(0, REACH_FALL, fall);
        return 0;
    }

    /**
     * She reacts only AFTER he has given up — 0.6s behind the withdraw — and he
     * retreats the instant she moves.
     */
    function spiritAnswer(age) {
        if (beatName() !== STILLWATER_BEAT.OFFER) return 0;
        const withdrawEnd = REACH_START + REACH_RISE + REACH_HOLD + REACH_FALL;
        return smoothstep(withdrawEnd + 0.6, withdrawEnd + 2.4, age);
    }

    function fireResponse() {
        if (!deck.length) refillDeck();
        activeResponse = deck.pop();
        lastDrawn = activeResponse;
        activeResponseAge = 0;
        lockout = RESPONSE_LOCKOUT_SECONDS;
        pendingResponse = null;
        armedLatency = -1;
        // A response during REST may pull the loop forward into NOTICE, but only
        // once per cycle: the world reacting to sustained good play, not a
        // trigger the player can farm.
        if (beatName() === STILLWATER_BEAT.REST && !restEarlyExitUsed) {
            restEarlyExitUsed = true;
            enterBeat(BEAT_ORDER.indexOf(STILLWATER_BEAT.NOTICE));
        }
    }

    function update(deltaSeconds) {
        const dt = clamp(Number.isFinite(deltaSeconds) ? deltaSeconds : 0, 0, 0.1);
        elapsed += dt;
        beatAge += dt;
        dawn = Math.min(DAWN_CAP, elapsed / DAWN_DURATION_SECONDS);

        if (beatAge >= beatDuration) advanceBeat();

        const plan = BEAT_PLAN[beatName()];
        // Ease toward the beat's targets rather than snapping; every ambient
        // change must be slow enough not to claim attention from the board.
        const ease = 1 - Math.exp(-dt * 0.9);
        intimacy += (plan.intimacy - intimacy) * ease;
        separation += (plan.separation - separation) * ease;
        lantern += (plan.lantern * (1 - dawn * 0.4) - lantern) * ease;

        accumulator = Math.max(0, accumulator - ACCUMULATOR_DECAY_PER_SECOND * dt);
        lockout = Math.max(0, lockout - dt);
        if (armedLatency > 0) {
            armedLatency -= dt;
            if (armedLatency <= 0) fireResponse();
        }
        if (activeResponse) {
            activeResponseAge += dt;
            if (activeResponseAge > 2.5) activeResponse = null;
        }

        const petrified = dawn >= DAWN_PETRIFY;
        return {
            beat: beatName(),
            beatAge,
            beatDuration,
            // Eight consumers, one float: path anchors, lantern, spirit emissive,
            // mote radius, shoulder droop and channel mist all read `intimacy`.
            intimacy: clamp(intimacy, 0, MAX_INTIMACY),
            separation: Math.max(MIN_SEPARATION, separation),
            lanternIntensity: clamp(lantern, 0, 1),
            reach: reachExtension(beatAge),
            spiritAnswer: spiritAnswer(beatAge),
            // The non-featured character is clamped so the two are never busy at
            // the same time — one idea on screen at once.
            featureToken: petrified ? STILLWATER_FEATURE.SPIRIT : plan.feature,
            dawn,
            petrified,
            response: activeResponse,
            responseAge: activeResponseAge,
            accumulator,
            lockout,
        };
    }

    /**
     * Feed a gameplay event. Never fires a response directly — it fills a leaky
     * pool, and crossing the threshold merely ARMS one after a randomised delay.
     */
    function notifyGameplay(kind, weight) {
        const amount = Number.isFinite(weight) ? weight : (EVENT_WEIGHTS[kind] ?? 0);
        if (amount <= 0) return;
        accumulator += amount;
        if (accumulator < ACCUMULATOR_THRESHOLD || lockout > 0 || armedLatency > 0) return;
        accumulator = 0;
        const [low, high] = RESPONSE_LATENCY_RANGE;
        armedLatency = low + random() * (high - low);
        pendingResponse = true;
    }

    function reset() {
        beatIndex = 0;
        beatAge = 0;
        ({
            duration: beatDuration,
            intimacy,
            separation,
            lantern,
        } = BEAT_PLAN[STILLWATER_BEAT.REST]);
        dawn = 0;
        elapsed = 0;
        accumulator = 0;
        lockout = 0;
        armedLatency = -1;
        pendingResponse = null;
        activeResponse = null;
        activeResponseAge = 0;
        restEarlyExitUsed = false;
        lastDrawn = null;
        refillDeck();
    }

    return Object.freeze({
        update,
        notifyGameplay,
        reset,
        isResponseArmed: () => armedLatency > 0 || pendingResponse === true,
    });
}
