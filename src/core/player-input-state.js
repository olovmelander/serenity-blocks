// @ts-check

import {
    COLS,
    DEFAULT_SETTINGS,
    ROWS,
} from './constants.js';
import {
    advanceDas,
    advanceSoftDrop,
    clearDasTimers,
    createDasDirectionState,
    createSoftDropState,
    startDas,
    stopDas,
} from './das.js';
import { FIXED_TICK_MS } from './fixed-tick-clock.js';

export const PLAYER_INPUT_EDGE_CAPACITY = 64;
export const PLAYER_INPUT_REPEAT_CAPACITY_PER_TICK = (COLS * 2) + ROWS;

const INPUT_ACTIONS = new Set(['move', 'rotate', 'softDrop', 'hardDrop']);
const INPUT_PHASES = new Set(['down', 'up']);

const DEFAULT_CONFIG = Object.freeze({
    dasDelay: DEFAULT_SETTINGS.dasDelay,
    dasInterval: DEFAULT_SETTINGS.dasInterval,
    softDropInterval: DEFAULT_SETTINGS.softDropInterval,
});

const INPUT_CLOCK = 'input60k';

/** @returns {TickDasDirectionState} */
const createTickDasDirectionState = () => ({
    ...createDasDirectionState(),
    clock: INPUT_CLOCK,
});

/** @returns {TickSoftDropInputState} */
const createTickSoftDropState = () => ({
    ...createSoftDropState(),
    clock: INPUT_CLOCK,
});

const finiteNonNegative = (value, fallback) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.max(0, numeric) : fallback;
};

const nonNegativeInteger = (value, fallback = 0) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : fallback;
};

/**
 * Copy handling values into a browser-free simulation config. Invalid values
 * fall back independently; the source object is never retained.
 *
 * @param {Partial<InputHandlingConfig>|null|undefined} source
 * @returns {InputHandlingConfig}
 */
export function normalizeInputHandlingConfig(source) {
    return {
        dasDelay: finiteNonNegative(source?.dasDelay, DEFAULT_CONFIG.dasDelay),
        dasInterval: finiteNonNegative(source?.dasInterval, DEFAULT_CONFIG.dasInterval),
        softDropInterval: finiteNonNegative(
            source?.softDropInterval,
            DEFAULT_CONFIG.softDropInterval,
        ),
    };
}

/** @param {Partial<InputHandlingConfig>|null|undefined} [config] */
export function createPlayerInputState(config) {
    return {
        clock: INPUT_CLOCK,
        config: normalizeInputHandlingConfig(config),
        das: {
            moveLeft: createTickDasDirectionState(),
            moveRight: createTickDasDirectionState(),
            softDrop: createTickSoftDropState(),
        },
        /** @type {InputEdge[]} */
        pendingEdges: [],
        nextEdgeSequence: 0,
        overflowCount: 0,
    };
}

/**
 * @param {PlayerInputState} state
 * @param {Partial<InputHandlingConfig>|null|undefined} config
 */
export function updateInputHandlingConfig(state, config) {
    if (!state) return;
    state.config = normalizeInputHandlingConfig({
        ...state.config,
        ...(config || {}),
    });
}

function clearDirectionState(state) {
    if (!state) return;
    stopDas(state);
    clearDasTimers(state);
}

/**
 * End every hold and discard undrained edges while retaining configuration,
 * sequence history, and overflow telemetry. Pause/visibility boundaries use
 * this stronger operation; clearDasTimers alone intentionally retains a hold.
 *
 * @param {PlayerInputState} state
 */
export function clearPlayerInput(state) {
    if (!state) return;
    clearDirectionState(state.das.moveLeft);
    clearDirectionState(state.das.moveRight);
    state.das.softDrop.active = false;
    state.das.softDrop.intervalAccumulator = 0;
    state.pendingEdges.length = 0;
}

/** Reset a round in place so controller adapters cannot retain stale aliases. */
export function resetPlayerInputState(state) {
    if (!state) return;
    clearPlayerInput(state);
    state.nextEdgeSequence = 0;
    state.overflowCount = 0;
}

/**
 * @param {Partial<InputEdge>|null|undefined} candidate
 * @param {number} sequence
 * @returns {InputEdge|null}
 */
function normalizeEdgeCandidate(candidate, sequence) {
    if (!candidate || typeof candidate !== 'object') return null;
    if (!Number.isInteger(candidate.tick) || Number(candidate.tick) < 0) return null;
    if (!Number.isInteger(sequence) || sequence < 0) return null;

    const candidateAction = String(candidate.action || '');
    const candidatePhase = String(candidate.phase || '');
    if (!INPUT_ACTIONS.has(candidateAction) || !INPUT_PHASES.has(candidatePhase)) return null;
    const phase = /** @type {InputPhase} */ (candidatePhase);
    const common = {
        tick: nonNegativeInteger(candidate.tick),
        subframe: Math.min(9, nonNegativeInteger(candidate.subframe)),
        sequence: nonNegativeInteger(sequence),
    };

    if (candidateAction === 'move') {
        const numericValue = Number(candidate.value);
        if (numericValue !== -1 && numericValue !== 1) return null;
        return {
            ...common,
            action: 'move',
            value: /** @type {-1|1} */ (numericValue),
            phase,
        };
    }
    if (candidateAction === 'rotate') {
        if (phase !== 'down') return null;
        if (!['left', 'right', 'flip'].includes(String(candidate.value))) return null;
        return {
            ...common,
            action: 'rotate',
            value: /** @type {'left'|'right'|'flip'} */ (candidate.value),
            phase: 'down',
        };
    }
    if (candidateAction === 'softDrop') {
        return {
            ...common, action: 'softDrop', value: null, phase,
        };
    }
    if (candidateAction === 'hardDrop' && phase === 'down') {
        return {
            ...common, action: 'hardDrop', value: null, phase: 'down',
        };
    }
    return null;
}

const compareEdges = (left, right) => left.tick - right.tick
    || left.subframe - right.subframe
    || left.sequence - right.sequence;

/**
 * Enqueue one canonical logical edge. Overflow rejects the entire pending
 * batch and clears holds: losing an `up` edge is worse than losing a batch.
 *
 * @param {PlayerInputState} state
 * @param {Partial<InputEdge>} candidate
 * @returns {InputEdge|null}
 */
export function enqueueInputEdge(state, candidate) {
    if (!state) return null;
    const edge = normalizeEdgeCandidate(candidate, state.nextEdgeSequence);
    if (!edge) return null;
    if (state.pendingEdges.length >= PLAYER_INPUT_EDGE_CAPACITY) {
        clearPlayerInput(state);
        state.overflowCount += 1;
        return null;
    }

    state.nextEdgeSequence += 1;
    state.pendingEdges.push(edge);
    state.pendingEdges.sort(compareEdges);
    return edge;
}

/**
 * Remove and return edges through an inclusive simulation tick. The future
 * shared advanceTick owns applying those edges and producing commands.
 *
 * @param {PlayerInputState} state
 * @param {number} tick
 * @returns {InputEdge[]}
 */
export function drainInputEdgesThroughTick(state, tick) {
    if (!state || state.pendingEdges.length === 0) return [];
    const inclusiveTick = nonNegativeInteger(tick);
    let count = 0;
    while (count < state.pendingEdges.length && state.pendingEdges[count].tick <= inclusiveTick) {
        count += 1;
    }
    return count > 0 ? state.pendingEdges.splice(0, count) : [];
}

// Integer fixed-point input clock: at canonical 60 Hz, one tick advances 1000
// units and one configured millisecond is 60 units. This preserves the legacy
// 40 ms ARR's 2/2/3-tick cadence without serializing float-ms accumulators.
const INPUT_TIME_UNITS_PER_MS = 60;
const durationToInputUnits = (durationMs) => Math.max(
    0,
    Math.round(Number(durationMs) * INPUT_TIME_UNITS_PER_MS),
);

/**
 * Advance the GameState-owned input engine by exactly one canonical tick.
 * Edge ingestion and repeat generation share one stable order: queued edges,
 * left DAS, right DAS, then soft drop. The supplied emitter applies or rejects
 * each command at the simulation boundary and returns false when an instant
 * repeat should stop (for example, wall contact or hit-stop rejection).
 *
 * @param {PlayerInputState} state
 * @param {{
 *   tick: number,
 *   tickMs?: number,
 *   emit?: (command: InputCommand) => boolean|void,
 * }} context
 * @returns {InputCommand[]} commands offered to the simulation boundary
 */
export function advancePlayerInputTick(state, context) {
    if (!state || !Number.isInteger(context?.tick) || context.tick < 0) return [];

    const numericTickMs = Number(context.tickMs);
    const tickMs = Number.isFinite(numericTickMs) && numericTickMs > 0
        ? numericTickMs
        : FIXED_TICK_MS;
    /** @type {InputCommand[]} */
    const commands = [];
    const emit = (action, value, source, edge = null) => {
        /** @type {InputCommand} */
        const command = {
            tick: context.tick,
            subframe: edge?.subframe ?? 9,
            action,
            value,
            source,
            edgeSequence: edge?.sequence ?? null,
        };
        commands.push(command);
        return context.emit?.(command) !== false;
    };

    const edges = drainInputEdgesThroughTick(state, context.tick);
    edges.forEach((edge) => {
        if (edge.action === 'move') {
            const directionState = edge.value === -1
                ? state.das.moveLeft
                : state.das.moveRight;
            if (edge.phase === 'up') {
                stopDas(directionState);
            } else if (!directionState.active) {
                startDas(directionState);
                emit('move', edge.value, 'edge', edge);
            }
            return;
        }

        if (edge.action === 'softDrop') {
            if (edge.phase === 'up') {
                state.das.softDrop.active = false;
            } else if (!state.das.softDrop.active) {
                state.das.softDrop.active = true;
                state.das.softDrop.intervalAccumulator = 0;
                emit('softDrop', null, 'edge', edge);
            }
            return;
        }

        // Rotation and hard drop are canonical down-only edges.
        emit(edge.action, edge.value, 'edge', edge);
    });

    const tickUnits = Math.max(1, Math.round(tickMs * INPUT_TIME_UNITS_PER_MS));
    const tickConfig = {
        dasDelay: durationToInputUnits(state.config.dasDelay),
        dasInterval: durationToInputUnits(state.config.dasInterval),
        softDropInterval: durationToInputUnits(state.config.softDropInterval),
    };
    advanceDas(state.das.moveLeft, tickUnits, {
        ...tickConfig,
        instantLimit: COLS,
    }, () => emit('move', -1, 'repeat'));
    advanceDas(state.das.moveRight, tickUnits, {
        ...tickConfig,
        instantLimit: COLS,
    }, () => emit('move', 1, 'repeat'));
    advanceSoftDrop(state.das.softDrop, tickUnits, {
        softDropInterval: tickConfig.softDropInterval,
        instantLimit: ROWS,
    }, () => emit('softDrop', null, 'repeat'));

    return commands;
}

function restoreDirection(target, source) {
    target.active = source?.active === true;
    target.delayAccumulator = nonNegativeInteger(source?.delayAccumulator);
    target.intervalAccumulator = nonNegativeInteger(source?.intervalAccumulator);
    target.isRepeating = target.active && source?.isRepeating === true;
    if (!target.active) clearDasTimers(target);
}

/**
 * Deeply restore serialized input state without replacing the target object.
 * Missing legacy state is a safe full clear that preserves current handling.
 *
 * @param {PlayerInputState} state
 * @param {Partial<PlayerInputState>|null|undefined} snapshot
 */
export function restorePlayerInputState(state, snapshot) {
    if (!state) return;
    if (!snapshot || typeof snapshot !== 'object') {
        clearPlayerInput(state);
        return;
    }
    if (
        snapshot.clock !== INPUT_CLOCK
        || snapshot.das?.moveLeft?.clock !== INPUT_CLOCK
        || snapshot.das?.moveRight?.clock !== INPUT_CLOCK
        || snapshot.das?.softDrop?.clock !== INPUT_CLOCK
    ) {
        clearPlayerInput(state);
        state.overflowCount += 1;
        return;
    }

    updateInputHandlingConfig(state, snapshot.config);
    restoreDirection(state.das.moveLeft, snapshot.das?.moveLeft);
    restoreDirection(state.das.moveRight, snapshot.das?.moveRight);
    state.das.softDrop.active = snapshot.das?.softDrop?.active === true;
    state.das.softDrop.intervalAccumulator = nonNegativeInteger(
        snapshot.das?.softDrop?.intervalAccumulator,
    );
    state.overflowCount = nonNegativeInteger(snapshot.overflowCount);
    state.nextEdgeSequence = nonNegativeInteger(snapshot.nextEdgeSequence);
    state.pendingEdges.length = 0;

    const edgeCandidates = Array.isArray(snapshot.pendingEdges) ? snapshot.pendingEdges : [];
    const restoredEdges = edgeCandidates
        .map((edge) => normalizeEdgeCandidate(edge, edge?.sequence));

    if (
        restoredEdges.length > PLAYER_INPUT_EDGE_CAPACITY
        || restoredEdges.some((edge) => edge === null)
        || new Set(restoredEdges.map((edge) => edge?.sequence)).size !== restoredEdges.length
    ) {
        clearPlayerInput(state);
        state.overflowCount += 1;
        return;
    }

    const validEdges = /** @type {InputEdge[]} */ (restoredEdges);
    validEdges.sort(compareEdges);
    state.pendingEdges.push(...validEdges);
    const sequenceFloor = validEdges.reduce(
        (highest, edge) => Math.max(highest, edge.sequence + 1),
        0,
    );
    state.nextEdgeSequence = Math.max(state.nextEdgeSequence, sequenceFloor);
}
