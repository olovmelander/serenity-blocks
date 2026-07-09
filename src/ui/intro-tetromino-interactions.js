/**
 * Shared helpers for pointer-driven intro tetromino interactions.
 * Kept dependency-free so WebGL, WebGPU, and unit tests can all use it.
 */

export const INTRO_TETROMINO_MAX_SPEED = 0.2;
export const INTRO_TETROMINO_CLICK_IMPULSE = 0.16;
export const INTRO_TETROMINO_BLOCK_RADIUS = 0.75;
export const INTRO_TETROMINO_PICK_PADDING = 0.35;
export const INTRO_TETROMINO_ROTATION_KICK = 0.035;

const RENDER_SCALE = 0.75;
const EPSILON = 0.000001;

export const INTRO_TETROMINO_BLOCK_OFFSETS = [
    [[-3, 0], [-1, 0], [1, 0], [3, 0]],
    [[-1, -1], [1, -1], [-1, 1], [1, 1]],
    [[-2, 0], [0, 0], [2, 0], [0, 2]],
    [[-2, -1], [0, -1], [0, 1], [2, 1]],
    [[0, -1], [2, -1], [-2, 1], [0, 1]],
    [[-1, -2], [1, -2], [1, 0], [1, 2]],
    [[-1, -2], [1, -2], [-1, 0], [-1, 2]],
].map((shape) => shape.map(([x, y]) => [x * RENDER_SCALE, y * RENDER_SCALE]));

export const INTRO_TETROMINO_BLOCK_OFFSETS_FLAT = INTRO_TETROMINO_BLOCK_OFFSETS.flat(2);

function toFiniteNumber(value, fallback = 0) {
    return Number.isFinite(value) ? value : fallback;
}

function normalizeVector(vector, fallback = { x: 0, y: 0, z: -1 }) {
    const x = toFiniteNumber(vector?.x);
    const y = toFiniteNumber(vector?.y);
    const z = toFiniteNumber(vector?.z);
    const lengthSq = x * x + y * y + z * z;

    if (lengthSq <= EPSILON) {
        return { ...fallback };
    }

    const invLength = 1 / Math.sqrt(lengthSq);
    return {
        x: x * invLength,
        y: y * invLength,
        z: z * invLength,
    };
}

function cross(a, b) {
    return {
        x: a.y * b.z - a.z * b.y,
        y: a.z * b.x - a.x * b.z,
        z: a.x * b.y - a.y * b.x,
    };
}

function getClosestRayPoint(ray, point) {
    const direction = normalizeVector(ray?.direction);
    const origin = {
        x: toFiniteNumber(ray?.origin?.x),
        y: toFiniteNumber(ray?.origin?.y),
        z: toFiniteNumber(ray?.origin?.z),
    };
    const px = toFiniteNumber(point?.x);
    const py = toFiniteNumber(point?.y);
    const pz = toFiniteNumber(point?.z);
    const vx = px - origin.x;
    const vy = py - origin.y;
    const vz = pz - origin.z;
    const rayT = vx * direction.x + vy * direction.y + vz * direction.z;

    return {
        direction,
        origin,
        rayT,
        point: {
            x: origin.x + direction.x * rayT,
            y: origin.y + direction.y * rayT,
            z: origin.z + direction.z * rayT,
        },
    };
}

export function clampVectorMagnitude(vector, maxMagnitude = INTRO_TETROMINO_MAX_SPEED) {
    const x = toFiniteNumber(vector?.x);
    const y = toFiniteNumber(vector?.y);
    const z = toFiniteNumber(vector?.z);
    const maxValue = Math.max(0, toFiniteNumber(maxMagnitude, INTRO_TETROMINO_MAX_SPEED));
    const lengthSq = x * x + y * y + z * z;
    const maxSq = maxValue * maxValue;

    if (maxValue === 0 || lengthSq <= EPSILON) {
        return { x: 0, y: 0, z: 0 };
    }

    if (lengthSq <= maxSq) {
        return { x, y, z };
    }

    const scale = maxValue / Math.sqrt(lengthSq);
    return {
        x: x * scale,
        y: y * scale,
        z: z * scale,
    };
}

export function computeImpulseAwayFromRay(
    ray,
    center,
    strength = INTRO_TETROMINO_CLICK_IMPULSE,
) {
    const { direction, point } = getClosestRayPoint(ray, center);
    const cx = toFiniteNumber(center?.x);
    const cy = toFiniteNumber(center?.y);
    const cz = toFiniteNumber(center?.z);
    let away = {
        x: cx - point.x,
        y: cy - point.y,
        z: cz - point.z,
    };
    const awayLengthSq = away.x * away.x + away.y * away.y + away.z * away.z;

    if (awayLengthSq <= EPSILON) {
        away = cross(direction, { x: 0, y: 1, z: 0 });
        const fallbackLengthSq = away.x * away.x + away.y * away.y + away.z * away.z;
        if (fallbackLengthSq <= EPSILON) {
            away = cross(direction, { x: 1, y: 0, z: 0 });
        }
    }

    const normalized = normalizeVector(away, { x: 1, y: 0, z: 0 });
    const impulse = Math.max(0, toFiniteNumber(strength, INTRO_TETROMINO_CLICK_IMPULSE));

    return {
        x: normalized.x * impulse,
        y: normalized.y * impulse,
        z: normalized.z * impulse,
    };
}

export function getPointerNdcFromClient(canvas, clientX, clientY) {
    if (!canvas || typeof canvas.getBoundingClientRect !== 'function') {
        return null;
    }

    const {
        left,
        top,
        width,
        height,
    } = canvas.getBoundingClientRect();

    if (width <= 0 || height <= 0) {
        return null;
    }

    return {
        x: ((clientX - left) / width) * 2 - 1,
        y: -(((clientY - top) / height) * 2 - 1),
    };
}

export function findClosestTetrominoRayHit({
    ray,
    positions,
    velocities,
    rotations,
    blockOffsets = INTRO_TETROMINO_BLOCK_OFFSETS,
    maxSlots,
    pickRadius = INTRO_TETROMINO_BLOCK_RADIUS + INTRO_TETROMINO_PICK_PADDING,
} = {}) {
    if (!ray || !positions || !velocities || !rotations) {
        return null;
    }

    const slotCapacity = Math.floor(Math.min(positions.length, velocities.length, rotations.length) / 4);
    const slotCount = Math.max(0, Math.min(Number.isFinite(maxSlots) ? maxSlots : slotCapacity, slotCapacity));
    const radiusSq = pickRadius * pickRadius;
    let bestHit = null;

    for (let slot = 0; slot < slotCount; slot++) {
        const i4 = slot * 4;
        if (positions[i4 + 3] <= 0.5) {
            continue;
        }

        const rawType = Math.round(toFiniteNumber(velocities[i4 + 3]));
        const type = Math.max(0, Math.min(blockOffsets.length - 1, rawType));
        const offsets = blockOffsets[type] || blockOffsets[0];
        const angle = toFiniteNumber(rotations[i4 + 2]);
        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);
        const center = {
            x: toFiniteNumber(positions[i4]),
            y: toFiniteNumber(positions[i4 + 1]),
            z: toFiniteNumber(positions[i4 + 2]),
        };

        for (let blockIndex = 0; blockIndex < offsets.length; blockIndex++) {
            const [offsetX, offsetY] = offsets[blockIndex];
            const blockCenter = {
                x: center.x + offsetX * cosA - offsetY * sinA,
                y: center.y + offsetX * sinA + offsetY * cosA,
                z: center.z,
            };
            const closest = getClosestRayPoint(ray, blockCenter);

            if (closest.rayT < 0) {
                continue;
            }

            const dx = blockCenter.x - closest.point.x;
            const dy = blockCenter.y - closest.point.y;
            const dz = blockCenter.z - closest.point.z;
            const distanceSq = dx * dx + dy * dy + dz * dz;

            if (distanceSq > radiusSq) {
                continue;
            }

            if (!bestHit
                || closest.rayT < bestHit.rayT
                || (closest.rayT === bestHit.rayT && distanceSq < bestHit.distanceSq)) {
                bestHit = {
                    slot,
                    type,
                    blockIndex,
                    center,
                    blockCenter,
                    point: closest.point,
                    distanceSq,
                    rayT: closest.rayT,
                };
            }
        }
    }

    return bestHit;
}
