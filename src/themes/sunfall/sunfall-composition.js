/**
 * Sunfall Theme — Board-Safe Composition & Calm-Zone Contract
 *
 * Ensures the Hang Sơn Đoòng doline composition frames the Serenity Blocks
 * board without visual clutter behind the playfield:
 * - Primary focal point (the oculus + main sunfall pillar + sunlit jungle cone)
 *   sits to the right of the board (`x = +14..+26`, NDC `x ≈ +0.26..+0.42`).
 * - Secondary focal point (the second distant doline 1 km down the passage)
 *   sits to the left of the board (`x = -32, y = +34, z = -340`, NDC `x ≈ -0.28`).
 * - Foreground rimstone gour terraces with Peacock Fern (`Selaginella`) frame the
 *   lower-left and lower-right corners outside the board lane.
 * - `calmFactorAtNdc(nx, ny)` attenuates volumetric beam contrast inside the
 *   central board rectangle (`1 - 0.85 * calmMask`).
 */

import {
    FAR_DOLINE_CENTER,
    OCULUS_CENTER,
    POOL_CENTER,
    clamp01,
    smooth,
} from './sunfall-core.js';

export const BOARD_VIEWPORT = Object.freeze({
    ndcLeft: -0.22,
    ndcRight: 0.06,
    ndcBottom: -0.72,
    ndcTop: 0.72,
    featherX: 0.06,
    featherY: 0.12,
});

export const SUNFALL_COMPOSITION = Object.freeze({
    camera: Object.freeze({
        pos: Object.freeze([0, 6.5, 22]),
        lookAt: Object.freeze([4, 10, -88]),
        fov: 50,
        aspect: 16 / 9,
    }),
    landmarks: Object.freeze({
        oculus: OCULUS_CENTER,
        pool: POOL_CENTER,
        farDoline: FAR_DOLINE_CENTER,
        gourLeft: Object.freeze([-18, -13, -26]),
        gourRight: Object.freeze([22, -13, -24]),
    }),
    boardCalmStrength: 0.85,
    minFocalSeparationNdc: 0.22,
});

/**
 * Project a 3D world point `[x, y, z]` into Normalized Device Coordinates `{ x, y, depth }`
 * for the given camera configuration.
 */
export function projectWorldToNdc(
    worldPos,
    cameraCfg = SUNFALL_COMPOSITION.camera,
) {
    const [px, py, pz] = worldPos;
    const [cx, cy, cz] = cameraCfg.pos;
    const [tx, ty, tz] = cameraCfg.lookAt;
    const fovRad = ((cameraCfg.fov || 50) * Math.PI) / 180;
    const aspect = cameraCfg.aspect || (16 / 9);

    // Forward vector
    let fx = tx - cx;
    let fy = ty - cy;
    let fz = tz - cz;
    const fLen = Math.hypot(fx, fy, fz) || 1;
    fx /= fLen;
    fy /= fLen;
    fz /= fLen;

    // Right vector = normalize(cross(forward, worldUp)) where worldUp = (0, 1, 0)
    let rx = -fz;
    let ry = 0;
    let rz = fx;
    const rLen = Math.hypot(rx, ry, rz) || 1;
    rx /= rLen;
    ry /= rLen;
    rz /= rLen;

    // Up vector = cross(right, forward)
    const ux = ry * fz - rz * fy;
    const uy = rz * fx - rx * fz;
    const uz = rx * fy - ry * fx;

    const dx = px - cx;
    const dy = py - cy;
    const dz = pz - cz;

    const camX = dx * rx + dy * ry + dz * rz;
    const camY = dx * ux + dy * uy + dz * uz;
    const camZ = dx * fx + dy * fy + dz * fz;

    const depth = Math.max(0.1, camZ);
    const tanHalfFov = Math.tan(fovRad * 0.5);
    const ndcX = camX / (depth * tanHalfFov * aspect);
    const ndcY = camY / (depth * tanHalfFov);

    return { x: ndcX, y: ndcY, depth: camZ };
}

/**
 * Evaluate the board-calm mask (`0` outside the board, `1` inside the board core)
 * at Normalized Device Coordinates `(ndcX, ndcY)`.
 */
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

/**
 * Multiplier in `[0.15, 1.0]` applied to volumetric beam scattering so the board
 * column stays calm and readable while the main sunfall shaft blazes beside it.
 */
export function calmFactorAtNdc(
    ndcX = 0,
    ndcY = 0,
    strength = SUNFALL_COMPOSITION.boardCalmStrength,
) {
    return 1 - clamp01(strength) * calmMaskAtNdc(ndcX, ndcY);
}

/**
 * Read the live DOM board rectangle into NDC bounds when available, falling back
 * to `BOARD_VIEWPORT`.
 */
export function readBoardViewport(doc = globalThis.document) {
    if (!doc || typeof doc.querySelector !== 'function') {
        return { ...BOARD_VIEWPORT };
    }
    const el = doc.querySelector('.player-card, #game-canvas, .board-container');
    const winW = globalThis.window?.innerWidth || 1920;
    const winH = globalThis.window?.innerHeight || 1080;
    if (!el || typeof el.getBoundingClientRect !== 'function' || !(winW > 0 && winH > 0)) {
        return { ...BOARD_VIEWPORT };
    }
    const rect = el.getBoundingClientRect();
    if (!(rect.width > 40 && rect.height > 40)) {
        return { ...BOARD_VIEWPORT };
    }
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
 * Verify that the primary focal landmarks (`oculus`, `pool`, `farDoline`, `gourLeft`, `gourRight`)
 * project in front of the lens and maintain clear angular separation across the frame.
 */
export function verifyFocalSeparations(cameraCfg = SUNFALL_COMPOSITION.camera) {
    const projected = {};
    for (const [key, worldPos] of Object.entries(SUNFALL_COMPOSITION.landmarks)) {
        projected[key] = projectWorldToNdc(worldPos, cameraCfg);
    }

    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const oculusToFar = dist(projected.oculus, projected.farDoline);
    const oculusToPool = dist(projected.oculus, projected.pool);
    const poolToFar = dist(projected.pool, projected.farDoline);
    const goursSpan = dist(projected.gourLeft, projected.gourRight);

    return {
        projected,
        oculusToFar,
        oculusToPool,
        poolToFar,
        goursSpan,
        valid: (
            projected.oculus.depth > 10
            && projected.pool.depth > 10
            && projected.farDoline.depth > 50
            && oculusToFar >= SUNFALL_COMPOSITION.minFocalSeparationNdc
            && oculusToPool >= SUNFALL_COMPOSITION.minFocalSeparationNdc
            && goursSpan >= 0.5
        ),
    };
}

/**
 * Audit the full Sunfall composition contract (focal separation + board-center calm factor).
 */
export function auditSunfallComposition(cameraCfg = SUNFALL_COMPOSITION.camera) {
    const separations = verifyFocalSeparations(cameraCfg);
    const centerCalm = calmFactorAtNdc(-0.08, 0);
    const beamCalm = calmFactorAtNdc(separations.projected.oculus.x, separations.projected.oculus.y);
    return {
        ...separations,
        centerCalm,
        beamCalm,
        boardIsCalmerThanBeam: centerCalm < beamCalm,
    };
}
