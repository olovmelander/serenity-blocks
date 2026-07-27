/**
 * Allocation-stable state for Stillwater's production water-response runtime.
 *
 * Slot 0 is permanently reserved for one dominant special. The remaining slots
 * form a circular routine-lock pool. Rendering owns the meaning of each packed
 * vec4; this module only owns deterministic priority, lifetime, and mutation.
 */

export const STILLWATER_RESPONSE_KIND = Object.freeze({
    idle: 0,
    lock: 1,
    tetris: 2,
    tspin: 3,
});

export const STILLWATER_RESPONSE_CAPACITY = Object.freeze({
    Low: 4,
    High: 10,
});

const MIN_CAPACITY = 4;
const MAX_CAPACITY = 12;
const INACTIVE_START_TIME = -1_000;
const DEFAULT_CENTER_X = 0;
const DEFAULT_CENTER_Z = -7;

const RESPONSE_SHAPES = Object.freeze({
    lock: Object.freeze({
        amplitude: 0.72,
        lifetime: 1.72,
        radiusScale: 1,
        phase: 0,
    }),
    tetris: Object.freeze({
        amplitude: 1,
        lifetime: 2.75,
        radiusScale: 1,
        phase: 0,
    }),
    tspin: Object.freeze({
        amplitude: 1,
        lifetime: 2.55,
        radiusScale: 1,
        phase: 1,
    }),
});

function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
}

function finiteOr(value, fallback) {
    return Number.isFinite(value) ? value : fallback;
}

function createPackedVector(x = 0, y = 0, z = 0, w = 0) {
    return {
        x, y, z, w,
    };
}

export function createStillwaterWaterResponseState({ capacity = 10 } = {}) {
    if (!Number.isInteger(capacity) || capacity < MIN_CAPACITY || capacity > MAX_CAPACITY) {
        throw new RangeError(`Stillwater response capacity must be ${MIN_CAPACITY}-${MAX_CAPACITY}.`);
    }

    // Plain x/y/z/w objects are accepted by three r181's uniformArray('vec4').
    // Their identities and the array lengths remain stable for this state's lifetime.
    const stateValues = Array.from(
        { length: capacity },
        () => createPackedVector(0, 0, INACTIVE_START_TIME, STILLWATER_RESPONSE_KIND.idle),
    );
    const shapeValues = Array.from(
        { length: capacity },
        () => createPackedVector(0, 1, 1, 0),
    );
    const bindings = Object.freeze({ stateValues, shapeValues });

    let routineCursor = 1;
    let specialUntil = INACTIVE_START_TIME;
    let eventWrites = 0;
    let overwriteCount = 0;
    let suppressedLocks = 0;
    let triggeredLocks = 0;
    let triggeredTetrises = 0;
    let triggeredTspins = 0;
    let peakActiveSlots = 0;
    let lastEvent = 'idle';

    function slotIsActive(index, time) {
        const state = stateValues[index];
        const shape = shapeValues[index];
        return state.w !== STILLWATER_RESPONSE_KIND.idle
            && time >= state.z
            && time < state.z + shape.y;
    }

    function countActive(time) {
        let active = 0;
        for (let index = 0; index < capacity; index += 1) {
            if (slotIsActive(index, time)) active += 1;
        }
        return active;
    }

    function getActiveMode(time) {
        const captureTime = finiteOr(time, 0);
        if (slotIsActive(0, captureTime)) {
            return stateValues[0].w;
        }
        for (let index = 1; index < capacity; index += 1) {
            if (slotIsActive(index, captureTime)) {
                return STILLWATER_RESPONSE_KIND.lock;
            }
        }
        return STILLWATER_RESPONSE_KIND.idle;
    }

    function recordPeak(time) {
        peakActiveSlots = Math.max(peakActiveSlots, countActive(time));
    }

    function clearSlot(index) {
        const state = stateValues[index];
        if (state.w === STILLWATER_RESPONSE_KIND.idle) return false;

        state.x = 0;
        state.y = 0;
        state.z = INACTIVE_START_TIME;
        state.w = STILLWATER_RESPONSE_KIND.idle;

        const shape = shapeValues[index];
        shape.x = 0;
        shape.y = 1;
        shape.z = 1;
        shape.w = 0;
        eventWrites += 1;
        return true;
    }

    function writeSlot(index, kind, time, x, z, shapeDefinition, options = undefined) {
        if (slotIsActive(index, time)) overwriteCount += 1;

        const amplitude = clamp(
            finiteOr(options?.strength, 1) * shapeDefinition.amplitude,
            0,
            1.35,
        );
        const radiusScale = clamp(
            finiteOr(options?.scale, shapeDefinition.radiusScale),
            0.55,
            1.65,
        );
        const phase = finiteOr(options?.phase, shapeDefinition.phase);

        const state = stateValues[index];
        state.x = finiteOr(x, DEFAULT_CENTER_X);
        state.y = finiteOr(z, DEFAULT_CENTER_Z);
        state.z = finiteOr(time, 0);
        state.w = kind;

        const shape = shapeValues[index];
        shape.x = amplitude;
        shape.y = shapeDefinition.lifetime;
        shape.z = radiusScale;
        shape.w = phase;
        eventWrites += 1;
    }

    function clearRoutineSlots() {
        for (let index = 1; index < capacity; index += 1) clearSlot(index);
    }

    function triggerLock(options = undefined) {
        const time = finiteOr(options?.time, 0);
        if (time < specialUntil) {
            suppressedLocks += 1;
            return false;
        }

        const index = routineCursor;
        routineCursor = index + 1 >= capacity ? 1 : index + 1;
        writeSlot(
            index,
            STILLWATER_RESPONSE_KIND.lock,
            time,
            finiteOr(options?.x, DEFAULT_CENTER_X),
            finiteOr(options?.z, DEFAULT_CENTER_Z),
            RESPONSE_SHAPES.lock,
            options,
        );
        triggeredLocks += 1;
        lastEvent = 'lock';
        recordPeak(time);
        return true;
    }

    function triggerSpecial(type, options = undefined) {
        const shapeDefinition = RESPONSE_SHAPES[type];
        const kind = STILLWATER_RESPONSE_KIND[type];
        const time = finiteOr(options?.time, 0);

        clearRoutineSlots();
        writeSlot(
            0,
            kind,
            time,
            finiteOr(options?.x, DEFAULT_CENTER_X),
            finiteOr(options?.z, DEFAULT_CENTER_Z),
            shapeDefinition,
            options,
        );
        routineCursor = 1;
        specialUntil = time + shapeDefinition.lifetime;
        lastEvent = type;
        if (type === 'tetris') triggeredTetrises += 1;
        else triggeredTspins += 1;
        recordPeak(time);
        return true;
    }

    function triggerReaction(type, options = undefined) {
        if (type === 'lock') return triggerLock(options);
        if (type === 'tetris' || type === 'tspin') return triggerSpecial(type, options);
        if (type === 'idle') return false;
        throw new RangeError(`Unknown Stillwater water response "${type}".`);
    }

    function clearReactions() {
        for (let index = 0; index < capacity; index += 1) clearSlot(index);
        routineCursor = 1;
        specialUntil = INACTIVE_START_TIME;
        lastEvent = 'idle';
    }

    function getSnapshot(time = 0) {
        const captureTime = finiteOr(time, 0);
        return {
            capacity,
            activeSlots: countActive(captureTime),
            activeMode: getActiveMode(captureTime),
            peakActiveSlots,
            reservedSpecialSlot: 0,
            routineCursor,
            specialActive: slotIsActive(0, captureTime),
            specialKind: stateValues[0].w,
            specialUntil,
            eventWrites,
            overwriteCount,
            suppressedLocks,
            triggeredLocks,
            triggeredTetrises,
            triggeredTspins,
            lastEvent,
            packedState: stateValues.map((state, index) => [
                state.x,
                state.y,
                state.z,
                state.w,
                shapeValues[index].x,
                shapeValues[index].y,
                shapeValues[index].z,
                shapeValues[index].w,
            ]),
        };
    }

    return Object.freeze({
        capacity,
        bindings,
        triggerReaction,
        clearReactions,
        getActiveSlotCount: countActive,
        getActiveMode,
        getSnapshot,
    });
}
