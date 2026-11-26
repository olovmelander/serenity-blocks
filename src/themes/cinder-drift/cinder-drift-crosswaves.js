import { RING_REACH } from './cinder-drift-core.js';

const DEEP_LAVA = [1.0, 0.26, 0.06];
const HOT_LAVA = [1.0, 0.67, 0.26];

/** A later cascade wave splits the crust in two places. The curved fronts meet beside the card. */
export function emitCascadeCrosswaves(world, cascade, birth = world.time) {
    const depth = Math.min(6, Math.round(Number(cascade) || 1) - 1);
    if (depth < 1) return;
    const left = world.bankRoom(-1);
    const right = world.bankRoom(1);
    // Alternate the exposed bank on successive waves when both sides have similar room.
    const leftBank = left >= right * 1.25 || (left >= right * 0.8 && depth % 2 === 1);
    const room = leftBank ? left : right;
    const sx = (fraction) => (leftBank ? fraction * room : 1 - fraction * room);
    // When multiplayer or a tall card takes both margins, cross along the foot of the board.
    const belowBoard = room < 0.075;
    const { x: x0, z: z0 } = world.screenToLake(
        belowBoard ? 0.22 : sx(0.76),
        Math.max(world.horizon + 0.09, belowBoard ? 0.88 : 0.69),
    );
    const { x: x1, z: z1 } = world.screenToLake(
        belowBoard ? 0.75 : sx(0.33),
        Math.max(world.horizon + 0.19, belowBoard ? 0.96 : 0.82),
    );
    const gap = Math.hypot(x0 - x1, z0 - z1);
    const reach = Math.min(0.9, Math.max(0.18, (gap * 1.05) / RING_REACH));
    const strength = (0.52 + 0.07 * depth) * (world.reducedMotion ? 0.72 : 1);
    world.ring(x0, z0, birth + 0.08, strength, DEEP_LAVA, reach);
    world.ring(x1, z1, birth + 0.23, strength * 0.85, HOT_LAVA, reach * 0.86);
}
