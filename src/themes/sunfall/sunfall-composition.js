/**
 * Sunfall — composition: the rest camera for each screen shape, and the board's calm lane.
 *
 * The 16:9 reference frame: the eye on its ledge at the origin, pitched 4° down with a 52°
 * vertical lens. The oculus is cropped by the top-left, the sunfall stands in the left free
 * space and lands on the canopy about a fifth across the frame, the passage and the far
 * doline fill the right third, the card sits over the open air in the middle. Wider screens
 * keep the vertical lens and see more of both sides; an upright phone raises the lens and
 * turns toward the column so the oculus is in the top band and the pool in the bottom one.
 */
import {
    CANOPY_LEVEL, FAR_DOLINE_CENTER, OCULUS_CENTER, SUNFALL_STATIONS, clamp01, footFor, smooth,
} from './sunfall-core.js';

export const BOARD_VIEWPORT = Object.freeze({
    ndcLeft: -0.24,
    ndcRight: 0.24,
    ndcBottom: -0.82,
    ndcTop: 0.82,
    featherX: 0.06,
    featherY: 0.12,
});

const RIGS = Object.freeze([
    Object.freeze({
        name: 'portrait', maxAspect: 0.75, fov: 74, pitch: 9, yaw: 22, position: Object.freeze([0, 0, 0]),
    }),
    Object.freeze({
        name: 'square', maxAspect: 1.45, fov: 56, pitch: -1, yaw: 4, position: Object.freeze([0, 0, 0]),
    }),
    Object.freeze({
        name: 'landscape', maxAspect: 2.05, fov: 52, pitch: -2, yaw: 0, position: Object.freeze([0, 0, 0]),
    }),
    Object.freeze({
        name: 'ultrawide', maxAspect: Infinity, fov: 48, pitch: -2, yaw: 0, position: Object.freeze([0, 0, 0]),
    }),
]);

/** The rest camera for a screen aspect (width / height). */
export function cameraRigFor(aspect = 16 / 9) {
    const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
    return RIGS.find((rig) => a <= rig.maxAspect) || RIGS[RIGS.length - 1];
}

export const SUNFALL_COMPOSITION = Object.freeze({
    rigs: RIGS,
    landmarks: Object.freeze({
        oculus: OCULUS_CENTER,
        foot: Object.freeze(footFor(SUNFALL_STATIONS[1].sunDir, CANOPY_LEVEL)),
        farDoline: FAR_DOLINE_CENTER,
    }),
    boardCalmStrength: 0.85,
});

/** Project a world point into NDC for a rig (`{ x, y, depth }`, depth along the view axis). */
export function projectWorldToNdc(worldPos, rig = cameraRigFor(16 / 9), aspect = 16 / 9) {
    const [px, py, pz] = worldPos;
    const [cx, cy, cz] = rig.position;
    const pitch = (rig.pitch * Math.PI) / 180;
    const yaw = (rig.yaw * Math.PI) / 180;
    // Camera basis for rotation order YXZ (yaw about y, then pitch about x).
    const fwd = [-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
    const right = [Math.cos(yaw), 0, -Math.sin(yaw)];
    const up = [
        right[1] * fwd[2] - right[2] * fwd[1],
        right[2] * fwd[0] - right[0] * fwd[2],
        right[0] * fwd[1] - right[1] * fwd[0],
    ];
    const d = [px - cx, py - cy, pz - cz];
    const camX = d[0] * right[0] + d[1] * right[1] + d[2] * right[2];
    const camY = -(d[0] * up[0] + d[1] * up[1] + d[2] * up[2]);
    const camZ = d[0] * fwd[0] + d[1] * fwd[1] + d[2] * fwd[2];
    const depth = Math.max(0.1, camZ);
    const tanHalf = Math.tan(((rig.fov || 52) * Math.PI) / 360);
    return { x: camX / (depth * tanHalf * aspect), y: -camY / (depth * tanHalf), depth: camZ };
}

/** 0 outside the board, 1 inside its core, at NDC `(ndcX, ndcY)`. */
export function calmMaskAtNdc(ndcX = 0, ndcY = 0, viewport = BOARD_VIEWPORT) {
    const halfW = (viewport.ndcRight - viewport.ndcLeft) * 0.5;
    const centerX = (viewport.ndcRight + viewport.ndcLeft) * 0.5;
    const halfH = (viewport.ndcTop - viewport.ndcBottom) * 0.5;
    const centerY = (viewport.ndcTop + viewport.ndcBottom) * 0.5;
    const dx = Math.abs(ndcX - centerX);
    const dy = Math.abs(ndcY - centerY);
    const mx = 1 - smooth(halfW - viewport.featherX * 0.5, halfW + viewport.featherX, dx);
    const my = 1 - smooth(halfH - viewport.featherY * 0.5, halfH + viewport.featherY, dy);
    return clamp01(mx * my);
}

export function calmFactorAtNdc(ndcX = 0, ndcY = 0, strength = SUNFALL_COMPOSITION.boardCalmStrength) {
    return 1 - clamp01(strength) * calmMaskAtNdc(ndcX, ndcY);
}

/** The live board rectangle in NDC when there is one, else `BOARD_VIEWPORT`. */
export function readBoardViewport(doc = globalThis.document) {
    if (!doc || typeof doc.querySelector !== 'function') return { ...BOARD_VIEWPORT };
    const el = doc.querySelector('.player-card, #game-canvas, .board-container');
    const winW = globalThis.window?.innerWidth || 1920;
    const winH = globalThis.window?.innerHeight || 1080;
    if (!el || typeof el.getBoundingClientRect !== 'function' || !(winW > 0 && winH > 0)) return { ...BOARD_VIEWPORT };
    const rect = el.getBoundingClientRect();
    if (!(rect.width > 40 && rect.height > 40)) return { ...BOARD_VIEWPORT };
    return {
        ndcLeft: (rect.left / winW) * 2 - 1,
        ndcRight: (rect.right / winW) * 2 - 1,
        ndcTop: 1 - (rect.top / winH) * 2,
        ndcBottom: 1 - (rect.bottom / winH) * 2,
        featherX: BOARD_VIEWPORT.featherX,
        featherY: BOARD_VIEWPORT.featherY,
    };
}

/**
 * The composition contract for a rig: where the oculus, the foot of the sunfall and the far
 * doline land on screen, and whether the column's foot stays out of the board.
 */
export function auditSunfallComposition(aspect = 16 / 9) {
    const rig = cameraRigFor(aspect);
    const projected = {};
    for (const [key, p] of Object.entries(SUNFALL_COMPOSITION.landmarks)) {
        projected[key] = projectWorldToNdc(p, rig, aspect);
    }
    const footCalm = calmFactorAtNdc(projected.foot.x, projected.foot.y);
    const centerCalm = calmFactorAtNdc(0, 0);
    return {
        rig: rig.name,
        projected,
        footCalm,
        centerCalm,
        footOutsideBoard: footCalm > 0.9,
        boardIsCalmerThanFoot: centerCalm < footCalm,
    };
}
