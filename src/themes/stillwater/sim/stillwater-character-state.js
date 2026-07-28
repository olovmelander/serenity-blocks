// Pulled ~12 units toward camera from the original ring, with x scaled by the
// same factor so every beat keeps its screen position. She is the subject of the
// painting and was reading at about 1.5% of frame height, which put her in
// competition with the lantern and the moon lane instead of above them. The
// depth change costs nothing and the beats' relative geometry is untouched.
//
// x is then pushed a further ~4 units outboard, because she is now roughly twice
// the on-screen size she was: the old ring cleared the board rect by as little as
// 1.2% of frame width measured from her CENTRE, which was invisible while she was
// a speck and is a robe-edge intrusion at subject scale. The screen-space
// clearance is now ~7.5% at every beat, and the test measures it as such rather
// than through the world-space proxy that never checked it.
const SPIRIT_ANCHORS = Object.freeze({
    observe: Object.freeze([-18.6, 4.90, -8.0]),
    approach: Object.freeze([-16.5, 4.15, -2.4]),
    respond: Object.freeze([-17.6, 4.60, -5.2]),
    withdraw: Object.freeze([-22.0, 5.70, -13.0]),
});

const SPIRIT_DURATIONS = Object.freeze({
    observe: 8.5,
    approach: 3.4,
    respond: 2.2,
    withdraw: 4.6,
});

// The troll's peripheral path. The former range spanned only 4.55 units, which
// is not enough travel to read as walking at this camera distance — the hero
// character appeared to hover between poses. The path is now long enough that
// each leg of it is a visible traversal along the bank.
// Waypoints in the XZ plane, not a single axis. A creature that only ever moves
// along X traces the same line every cycle and reads as a machine on rails; the
// z component is what turns a shuttle into a walk. Each entry is [x, z].
const TROLL_PATH = Object.freeze({
    hidden: Object.freeze([27.6, -22.5]),
    reveal: Object.freeze([23.4, -20.2]),
    // The three inboard beats were pushed out on 2026-07-28. Measured against
    // the authored camera they cleared the board's right edge by 2.5-6.1% of
    // frame width from his ORIGIN, and he is a 7%-wide silhouette — so at his
    // closest beats he was standing partly over the play field. The world-space
    // threshold this used to be gated on never measured that. Clearance is now
    // ~8.5% at every waypoint, which survives the full waypoint jitter.
    listen: Object.freeze([22.7, -17.4]),
    water: Object.freeze([22.2, -15.8]),
    react: Object.freeze([23.2, -18.6]),
    retreat: Object.freeze([25.8, -21.4]),
});

// Per-arrival scatter. He never stands in exactly the same spot twice, which is
// most of what separates "wandering the bank" from "returning to a marker".
const TROLL_WAYPOINT_JITTER = 1.6;

// World units per second at the middle of a leg. A heavy, deliberate stride.
const TROLL_WALK_SPEED = 1.45;
// Legs ease in and out rather than starting and stopping instantly; a constant
// speed with hard ends is the other half of the on-rails read.
const TROLL_EASE_DISTANCE = 2.6;
// Occasional mid-leg hesitations: he is old, heavy, and in no hurry.
const TROLL_PAUSE_CHANCE = 0.35;
const TROLL_PAUSE_SECONDS = Object.freeze([0.8, 2.4]);

// The spirit does not walk, she drifts. Her motion needs the opposite treatment
// to the troll's: no weight, no footfall, no eased stop — instead a slow
// current that never quite settles, so she reads as suspended rather than
// standing. Scatter is smaller than his because her anchors are compositional.
const SPIRIT_ANCHOR_JITTER = 0.9;
// Perpendicular sway amplitude and rate. Drifting off the straight line between
// anchors is what stops her sliding along a rail.
const SPIRIT_SWAY = 0.20;
const SPIRIT_SWAY_RATE = 0.13;
const SPIRIT_BOB = 0.10;
const SPIRIT_BOB_RATE = 0.34;

/**
 * Seeded RNG. The wander MUST be deterministic: this state machine drives
 * phase-locked captures and replays, and Math.random() would make two runs of
 * the same seed diverge. Variation and reproducibility are not in tension —
 * they just require the randomness to be owned rather than ambient.
 */
function makeWanderRng(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
const WANDER_SEED = 0x5721b3;

export const STILLWATER_TROLL_GESTURE = Object.freeze({
    IDLE: 'idle',
    LOCK_GLANCE: 'lock-glance',
    LINE_TURN: 'line-turn-pause',
    COMBO_WARY: 'combo-wary',
    COMBO_DELIGHT: 'combo-delight',
    PERFECT_BOW_LOOK_UP: 'perfect-bow-look-up',
});

const TROLL_GESTURE_PRIORITY = Object.freeze({
    [STILLWATER_TROLL_GESTURE.IDLE]: 0,
    [STILLWATER_TROLL_GESTURE.LOCK_GLANCE]: 1,
    [STILLWATER_TROLL_GESTURE.LINE_TURN]: 2,
    [STILLWATER_TROLL_GESTURE.COMBO_WARY]: 3,
    [STILLWATER_TROLL_GESTURE.COMBO_DELIGHT]: 3,
    [STILLWATER_TROLL_GESTURE.PERFECT_BOW_LOOK_UP]: 4,
});

const TROLL_GESTURE_DURATION = Object.freeze({
    [STILLWATER_TROLL_GESTURE.IDLE]: 0,
    [STILLWATER_TROLL_GESTURE.LOCK_GLANCE]: 0.82,
    [STILLWATER_TROLL_GESTURE.LINE_TURN]: 1.35,
    [STILLWATER_TROLL_GESTURE.COMBO_WARY]: 1.8,
    [STILLWATER_TROLL_GESTURE.COMBO_DELIGHT]: 2.05,
    [STILLWATER_TROLL_GESTURE.PERFECT_BOW_LOOK_UP]: 2.8,
});

function smoothingAlpha(rate, delta) {
    return 1 - Math.exp(-Math.max(0, rate) * Math.max(0, delta));
}

function clamp01(value) {
    return Math.max(0, Math.min(1, value));
}

function gestureEnvelope(progress) {
    return Math.sin(clamp01(progress) * Math.PI);
}

function advanceSpiritState(state, next, random) {
    state.name = next;
    state.age = 0;
    const anchor = SPIRIT_ANCHORS[next];
    // Same reasoning as the troll: a fixed anchor visited twice is a marker.
    const jx = random ? (random() - 0.5) * SPIRIT_ANCHOR_JITTER : 0;
    const jz = random ? (random() - 0.5) * SPIRIT_ANCHOR_JITTER : 0;
    state.jitterX = jx;
    state.jitterZ = jz;
    state.targetX = anchor[0];
    state.targetY = anchor[1];
    state.targetZ = anchor[2];
}

function advanceTrollState(state, next, random) {
    state.name = next;
    state.age = 0;
    const [wx, wz] = TROLL_PATH[next];
    // Scatter the arrival point so repeated visits are never identical.
    state.targetX = wx + (random() - 0.5) * TROLL_WAYPOINT_JITTER;
    state.targetZ = wz + (random() - 0.5) * TROLL_WAYPOINT_JITTER;
    state.legStartX = state.x;
    state.legStartZ = state.z;
    state.pauseTimer = random() < TROLL_PAUSE_CHANCE
        ? TROLL_PAUSE_SECONDS[0] + random() * (TROLL_PAUSE_SECONDS[1] - TROLL_PAUSE_SECONDS[0])
        : 0;
    state.pauseAt = 0.25 + random() * 0.5;
}

export function createStillwaterCharacterState() {
    const spirit = {
        name: 'observe',
        age: 0,
        x: SPIRIT_ANCHORS.observe[0],
        y: SPIRIT_ANCHORS.observe[1],
        z: SPIRIT_ANCHORS.observe[2],
        targetX: SPIRIT_ANCHORS.observe[0],
        targetY: SPIRIT_ANCHORS.observe[1],
        targetZ: SPIRIT_ANCHORS.observe[2],
        attention: 0,
        response: 0,
        jitterX: 0,
        jitterZ: 0,
        driftPhase: 0,
    };
    const troll = {
        name: 'hidden',
        age: 0,
        x: TROLL_PATH.hidden[0],
        z: TROLL_PATH.hidden[1],
        targetX: TROLL_PATH.hidden[0],
        targetZ: TROLL_PATH.hidden[1],
        legStartX: TROLL_PATH.hidden[0],
        legStartZ: TROLL_PATH.hidden[1],
        heading: -0.52,
        pauseTimer: 0,
        pauseAt: 0.5,
        speed: 0,
        cue: 0,
        look: 0,
        reveal: 0,
        gesture: STILLWATER_TROLL_GESTURE.IDLE,
        gestureAge: 0,
        gestureDuration: 0,
        gesturePriority: 0,
        gestureStrength: 0,
        glance: 0,
        turn: 0,
        pause: 0,
        delight: 0,
        wary: 0,
        bow: 0,
        lookUp: 0,
    };
    // Owned by the closure, deliberately NOT on the exposed state: the state
    // object is deep-compared in determinism tests and a function member
    // would never match across instances.
    let wander = makeWanderRng(WANDER_SEED);
    const state = Object.freeze({ spirit, troll });

    function cueSpirit(kind, strength = 1) {
        const safeStrength = Number.isFinite(strength)
            ? Math.max(0, Math.min(1.5, strength))
            : 1;
        spirit.attention = Math.max(spirit.attention, safeStrength);

        if (kind === 'perfectClear' || kind === 'combo10') {
            advanceSpiritState(spirit, 'respond', wander);
        } else if (kind === 'tspin' || kind === 'tetris' || kind === 'lineClear') {
            if (spirit.name === 'observe' || spirit.name === 'withdraw') {
                advanceSpiritState(spirit, 'approach', wander);
            }
        }
    }

    function startTrollGesture(gesture, strength) {
        const priority = TROLL_GESTURE_PRIORITY[gesture] || 0;
        const active = troll.gesture !== STILLWATER_TROLL_GESTURE.IDLE
            && troll.gestureAge < troll.gestureDuration;
        const comboDelightUpgrade = (
            troll.gesture === STILLWATER_TROLL_GESTURE.COMBO_WARY
            && gesture === STILLWATER_TROLL_GESTURE.COMBO_DELIGHT
        );
        if (
            active
            && (
                priority < troll.gesturePriority
                || (
                    priority === troll.gesturePriority
                    && gesture !== troll.gesture
                    && !comboDelightUpgrade
                )
            )
        ) return false;
        troll.gesture = gesture;
        troll.gestureAge = 0;
        troll.gestureDuration = TROLL_GESTURE_DURATION[gesture] || 0;
        troll.gesturePriority = priority;
        troll.gestureStrength = strength;
        return true;
    }

    function cueTroll(kind, strength = 1) {
        const safeStrength = Number.isFinite(strength)
            ? Math.max(0, Math.min(1.5, strength))
            : 1;
        troll.cue = Math.max(troll.cue, safeStrength);

        if (kind === 'perfectClear') {
            if (!startTrollGesture(
                STILLWATER_TROLL_GESTURE.PERFECT_BOW_LOOK_UP,
                safeStrength,
            )) return;
            advanceTrollState(troll, 'react', wander);
        } else if (kind === 'combo10') {
            if (!startTrollGesture(
                STILLWATER_TROLL_GESTURE.COMBO_DELIGHT,
                safeStrength,
            )) return;
            advanceTrollState(troll, 'react', wander);
        } else if (kind === 'comboHigh' || kind === 'combo') {
            if (!startTrollGesture(
                STILLWATER_TROLL_GESTURE.COMBO_WARY,
                safeStrength,
            )) return;
            if (troll.name === 'hidden' || troll.name === 'retreat') {
                advanceTrollState(troll, 'reveal', wander);
            } else {
                advanceTrollState(troll, 'listen', wander);
            }
        } else if (kind === 'tspin' || kind === 'tetris' || kind === 'lineClear') {
            if (!startTrollGesture(
                STILLWATER_TROLL_GESTURE.LINE_TURN,
                safeStrength,
            )) return;
            if (troll.name === 'hidden' || troll.name === 'retreat') {
                advanceTrollState(troll, 'reveal', wander);
            } else {
                advanceTrollState(troll, 'listen', wander);
            }
        } else if (kind === 'lock' || kind === 'hardDrop') {
            if (!startTrollGesture(
                STILLWATER_TROLL_GESTURE.LOCK_GLANCE,
                safeStrength,
            )) return;
            if (troll.name === 'hidden') advanceTrollState(troll, 'reveal', wander);
        }
    }

    function cue(kind, strength = 1) {
        cueSpirit(kind, strength);
        cueTroll(kind, strength);
    }

    function update(delta, reducedMotion = false) {
        const dt = Math.min(0.1, Math.max(0, Number.isFinite(delta) ? delta : 0));
        const motionScale = reducedMotion ? 0.36 : 1;
        spirit.age += dt;
        troll.age += dt;
        troll.gestureAge += dt;
        spirit.attention *= Math.exp((-Math.LN2 * dt) / 1.15);
        spirit.response *= Math.exp((-Math.LN2 * dt) / 0.72);
        troll.cue *= Math.exp((-Math.LN2 * dt) / 1.0);

        if (spirit.name === 'observe' && spirit.age >= SPIRIT_DURATIONS.observe) {
            advanceSpiritState(spirit, 'approach', wander);
        } else if (spirit.name === 'approach' && spirit.age >= SPIRIT_DURATIONS.approach) {
            advanceSpiritState(spirit, 'respond', wander);
        } else if (spirit.name === 'respond' && spirit.age >= SPIRIT_DURATIONS.respond) {
            advanceSpiritState(spirit, 'withdraw', wander);
        } else if (spirit.name === 'withdraw' && spirit.age >= SPIRIT_DURATIONS.withdraw) {
            advanceSpiritState(spirit, 'observe', wander);
        }

        // Dwell times cover the walk plus a beat of stillness at each stop, so
        // the character reads as arriving, pausing, then moving on.
        if (troll.name === 'hidden' && troll.age >= 5.2) {
            advanceTrollState(troll, 'reveal', wander);
        } else if (troll.name === 'reveal' && troll.age >= 4.6) {
            advanceTrollState(troll, 'listen', wander);
        } else if (troll.name === 'listen' && troll.age >= 4.4) {
            advanceTrollState(troll, 'water', wander);
        } else if (troll.name === 'water' && troll.age >= 5.2) {
            advanceTrollState(troll, 'retreat', wander);
        } else if (troll.name === 'react' && troll.age >= 3.0) {
            advanceTrollState(troll, 'retreat', wander);
        } else if (troll.name === 'retreat' && troll.age >= 6.4) {
            advanceTrollState(troll, 'hidden', wander);
        }

        // Drift toward the anchor, then add a slow perpendicular sway so the
        // path between two points is a curve rather than a line. The sway is
        // applied to the POSITION rather than the target, so it never fights
        // the approach or leaves her short of where the composition wants her.
        const spiritAlpha = smoothingAlpha(0.78 * motionScale, dt);
        const anchorX = spirit.targetX + (spirit.jitterX || 0);
        const anchorZ = spirit.targetZ + (spirit.jitterZ || 0);
        spirit.x += (anchorX - spirit.x) * spiritAlpha;
        spirit.y += (spirit.targetY - spirit.y) * spiritAlpha;
        spirit.z += (anchorZ - spirit.z) * spiritAlpha;
        spirit.driftPhase = (spirit.driftPhase || 0) + dt;
        const swayAngle = spirit.driftPhase * SPIRIT_SWAY_RATE * motionScale;
        // Two detuned components so the drift never resolves into a visible
        // circle or figure-of-eight.
        spirit.x += Math.sin(swayAngle) * SPIRIT_SWAY * dt * motionScale;
        spirit.z += Math.cos(swayAngle * 0.61 + 1.3) * SPIRIT_SWAY * 0.7 * dt * motionScale;
        spirit.y += Math.sin(spirit.driftPhase * SPIRIT_BOB_RATE) * SPIRIT_BOB * dt * motionScale;
        spirit.response = Math.max(
            spirit.response,
            spirit.name === 'respond' ? Math.sin(Math.min(1, spirit.age / 2.2) * Math.PI) : 0,
        );

        // 2D locomotion with eased ends and occasional hesitation.
        const toTargetX = troll.targetX - troll.x;
        const toTargetZ = troll.targetZ - troll.z;
        const remaining = Math.hypot(toTargetX, toTargetZ);
        const legTotal = Math.max(
            0.001,
            Math.hypot(troll.targetX - troll.legStartX, troll.targetZ - troll.legStartZ),
        );
        const travelled = legTotal - remaining;

        // Mid-leg hesitation: he stops, looks, then goes on.
        if (troll.pauseTimer > 0 && travelled / legTotal >= troll.pauseAt) {
            troll.pauseTimer = Math.max(0, troll.pauseTimer - dt);
            troll.speed = 0;
        } else if (remaining > 0.02) {
            // Ease in from the start and out into the arrival, so legs begin and
            // end as a body would rather than snapping to full speed.
            const easeIn = Math.min(1, travelled / TROLL_EASE_DISTANCE);
            const easeOut = Math.min(1, remaining / TROLL_EASE_DISTANCE);
            const ease = Math.min(easeIn, easeOut);
            const eased = 0.18 + 0.82 * (ease * ease * (3 - 2 * ease));
            const walkStep = Math.min(remaining, TROLL_WALK_SPEED * eased * motionScale * dt);
            troll.x += (toTargetX / remaining) * walkStep;
            troll.z += (toTargetZ / remaining) * walkStep;
            troll.speed = dt > 0 ? walkStep / dt : 0;
            // Face the direction of travel. A character that walks sideways
            // while facing the camera is the single loudest tell of a rig on a
            // track; heading follows velocity, and only snaps to a look target
            // once stopped.
            const desired = Math.atan2(toTargetX, -toTargetZ);
            let turn = desired - troll.heading;
            while (turn > Math.PI) turn -= Math.PI * 2;
            while (turn < -Math.PI) turn += Math.PI * 2;
            troll.heading += turn * smoothingAlpha(2.6 * motionScale, dt);
        } else {
            troll.speed = 0;
        }
        troll.reveal = Math.max(0, Math.min(1, (TROLL_PATH.hidden[0] - troll.x) / 8.0));
        troll.look += ((spirit.x < troll.x ? -1 : 1) - troll.look)
            * smoothingAlpha(2.1 * motionScale, dt);

        troll.glance = 0;
        troll.turn = 0;
        troll.pause = 0;
        troll.delight = 0;
        troll.wary = 0;
        troll.bow = 0;
        troll.lookUp = 0;
        if (
            troll.gesture !== STILLWATER_TROLL_GESTURE.IDLE
            && troll.gestureAge < troll.gestureDuration
        ) {
            const progress = troll.gestureDuration > 0
                ? clamp01(troll.gestureAge / troll.gestureDuration)
                : 1;
            const amplitude = troll.gestureStrength * motionScale;
            const envelope = gestureEnvelope(progress) * amplitude;
            if (troll.gesture === STILLWATER_TROLL_GESTURE.LOCK_GLANCE) {
                troll.glance = envelope;
            } else if (troll.gesture === STILLWATER_TROLL_GESTURE.LINE_TURN) {
                troll.turn = envelope;
                troll.pause = clamp01(Math.sin(progress * Math.PI) * 1.35) * amplitude;
            } else if (troll.gesture === STILLWATER_TROLL_GESTURE.COMBO_WARY) {
                troll.wary = envelope;
            } else if (troll.gesture === STILLWATER_TROLL_GESTURE.COMBO_DELIGHT) {
                troll.delight = envelope;
            } else if (
                troll.gesture === STILLWATER_TROLL_GESTURE.PERFECT_BOW_LOOK_UP
            ) {
                // One authored sentence: acknowledge the board, then look to the spirit.
                troll.bow = gestureEnvelope(clamp01(progress / 0.58)) * amplitude;
                troll.lookUp = gestureEnvelope(
                    clamp01((progress - 0.38) / 0.62),
                ) * amplitude;
            }
        } else if (troll.gesture !== STILLWATER_TROLL_GESTURE.IDLE) {
            troll.gesture = STILLWATER_TROLL_GESTURE.IDLE;
            troll.gestureAge = 0;
            troll.gestureDuration = 0;
            troll.gesturePriority = 0;
            troll.gestureStrength = 0;
        }

        return state;
    }

    function reset() {
        spirit.name = 'observe';
        spirit.age = 0;
        spirit.x = SPIRIT_ANCHORS.observe[0];
        spirit.y = SPIRIT_ANCHORS.observe[1];
        spirit.z = SPIRIT_ANCHORS.observe[2];
        spirit.targetX = spirit.x;
        spirit.targetY = spirit.y;
        spirit.targetZ = spirit.z;
        spirit.attention = 0;
        spirit.response = 0;
        troll.name = 'hidden';
        troll.age = 0;
        [troll.x, troll.z] = TROLL_PATH.hidden;
        troll.targetX = troll.x;
        troll.targetZ = troll.z;
        troll.legStartX = troll.x;
        troll.legStartZ = troll.z;
        troll.heading = -0.52;
        wander = makeWanderRng(WANDER_SEED);
        troll.pauseTimer = 0;
        troll.speed = 0;
        troll.cue = 0;
        troll.look = 0;
        troll.reveal = 0;
        troll.gesture = STILLWATER_TROLL_GESTURE.IDLE;
        troll.gestureAge = 0;
        troll.gestureDuration = 0;
        troll.gesturePriority = 0;
        troll.gestureStrength = 0;
        troll.glance = 0;
        troll.turn = 0;
        troll.pause = 0;
        troll.delight = 0;
        troll.wary = 0;
        troll.bow = 0;
        troll.lookUp = 0;
    }

    return Object.freeze({
        state,
        cue,
        cueSpirit,
        cueTroll,
        update,
        reset,
    });
}

export const STILLWATER_SPIRIT_ANCHORS = SPIRIT_ANCHORS;
export const STILLWATER_TROLL_PATH_X = TROLL_PATH;
