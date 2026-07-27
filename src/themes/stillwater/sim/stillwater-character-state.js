const SPIRIT_ANCHORS = Object.freeze({
    observe: Object.freeze([-18.4, 5.2, -20.5]),
    approach: Object.freeze([-15.8, 4.35, -14.6]),
    respond: Object.freeze([-17.1, 4.85, -17.2]),
    withdraw: Object.freeze([-23.4, 6.1, -25.8]),
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
const TROLL_X = Object.freeze({
    hidden: 27.6,
    reveal: 23.4,
    listen: 21.0,
    water: 17.4,
    react: 18.6,
    retreat: 25.8,
});

// World units per second. A heavy, deliberate stride rather than a stroll.
const TROLL_WALK_SPEED = 1.45;

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

function advanceSpiritState(state, next) {
    state.name = next;
    state.age = 0;
    const anchor = SPIRIT_ANCHORS[next];
    state.targetX = anchor[0];
    state.targetY = anchor[1];
    state.targetZ = anchor[2];
}

function advanceTrollState(state, next) {
    state.name = next;
    state.age = 0;
    state.targetX = TROLL_X[next];
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
    };
    const troll = {
        name: 'hidden',
        age: 0,
        x: TROLL_X.hidden,
        targetX: TROLL_X.hidden,
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
    const state = Object.freeze({ spirit, troll });

    function cueSpirit(kind, strength = 1) {
        const safeStrength = Number.isFinite(strength)
            ? Math.max(0, Math.min(1.5, strength))
            : 1;
        spirit.attention = Math.max(spirit.attention, safeStrength);

        if (kind === 'perfectClear' || kind === 'combo10') {
            advanceSpiritState(spirit, 'respond');
        } else if (kind === 'tspin' || kind === 'tetris' || kind === 'lineClear') {
            if (spirit.name === 'observe' || spirit.name === 'withdraw') {
                advanceSpiritState(spirit, 'approach');
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
            advanceTrollState(troll, 'react');
        } else if (kind === 'combo10') {
            if (!startTrollGesture(
                STILLWATER_TROLL_GESTURE.COMBO_DELIGHT,
                safeStrength,
            )) return;
            advanceTrollState(troll, 'react');
        } else if (kind === 'comboHigh' || kind === 'combo') {
            if (!startTrollGesture(
                STILLWATER_TROLL_GESTURE.COMBO_WARY,
                safeStrength,
            )) return;
            if (troll.name === 'hidden' || troll.name === 'retreat') {
                advanceTrollState(troll, 'reveal');
            } else {
                advanceTrollState(troll, 'listen');
            }
        } else if (kind === 'tspin' || kind === 'tetris' || kind === 'lineClear') {
            if (!startTrollGesture(
                STILLWATER_TROLL_GESTURE.LINE_TURN,
                safeStrength,
            )) return;
            if (troll.name === 'hidden' || troll.name === 'retreat') {
                advanceTrollState(troll, 'reveal');
            } else {
                advanceTrollState(troll, 'listen');
            }
        } else if (kind === 'lock' || kind === 'hardDrop') {
            if (!startTrollGesture(
                STILLWATER_TROLL_GESTURE.LOCK_GLANCE,
                safeStrength,
            )) return;
            if (troll.name === 'hidden') advanceTrollState(troll, 'reveal');
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
            advanceSpiritState(spirit, 'approach');
        } else if (spirit.name === 'approach' && spirit.age >= SPIRIT_DURATIONS.approach) {
            advanceSpiritState(spirit, 'respond');
        } else if (spirit.name === 'respond' && spirit.age >= SPIRIT_DURATIONS.respond) {
            advanceSpiritState(spirit, 'withdraw');
        } else if (spirit.name === 'withdraw' && spirit.age >= SPIRIT_DURATIONS.withdraw) {
            advanceSpiritState(spirit, 'observe');
        }

        // Dwell times cover the walk plus a beat of stillness at each stop, so
        // the character reads as arriving, pausing, then moving on.
        if (troll.name === 'hidden' && troll.age >= 5.2) {
            advanceTrollState(troll, 'reveal');
        } else if (troll.name === 'reveal' && troll.age >= 4.6) {
            advanceTrollState(troll, 'listen');
        } else if (troll.name === 'listen' && troll.age >= 4.4) {
            advanceTrollState(troll, 'water');
        } else if (troll.name === 'water' && troll.age >= 5.2) {
            advanceTrollState(troll, 'retreat');
        } else if (troll.name === 'react' && troll.age >= 3.0) {
            advanceTrollState(troll, 'retreat');
        } else if (troll.name === 'retreat' && troll.age >= 6.4) {
            advanceTrollState(troll, 'hidden');
        }

        const spiritAlpha = smoothingAlpha(0.78 * motionScale, dt);
        spirit.x += (spirit.targetX - spirit.x) * spiritAlpha;
        spirit.y += (spirit.targetY - spirit.y) * spiritAlpha;
        spirit.z += (spirit.targetZ - spirit.z) * spiritAlpha;
        spirit.response = Math.max(
            spirit.response,
            spirit.name === 'respond' ? Math.sin(Math.min(1, spirit.age / 2.2) * Math.PI) : 0,
        );

        // Speed-limited rather than exponentially eased. Exponential approach
        // spends almost all its travel in the first moments and then crawls, so
        // a stride locked to it flickers on and dies — the troll spent nearly
        // all its time standing. A constant walking speed gives sustained
        // locomotion the animation can actually be driven from.
        const walkStep = TROLL_WALK_SPEED * motionScale * dt;
        const trollDelta = troll.targetX - troll.x;
        const trollStep = Math.abs(trollDelta) <= walkStep
            ? trollDelta
            : Math.sign(trollDelta) * walkStep;
        troll.x += trollStep;
        // Published so the renderer locks the Walk cycle to real ground speed
        // instead of differencing positions, which breaks under fixed-time capture.
        troll.speed = dt > 0 ? Math.abs(trollStep) / dt : 0;
        troll.reveal = Math.max(0, Math.min(1, (TROLL_X.hidden - troll.x) / 8.0));
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
        troll.x = TROLL_X.hidden;
        troll.targetX = troll.x;
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
export const STILLWATER_TROLL_PATH_X = TROLL_X;
