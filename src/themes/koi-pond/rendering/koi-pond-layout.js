/**
 * Canonical production-space metrics for Koi Pond.
 *
 * Water, landscape dressing, camera framing, and gameplay reactions all use
 * this one contract so a lock cannot drift away from the pond after a visual
 * composition change.
 */

export const KOI_POND_QUALITY_NAMES = Object.freeze([
    'Minimal',
    'Low',
    'Medium',
    'High',
    'Ultra',
    'Extreme',
]);

const QUALITY_NAME_LOOKUP = new Map(
    KOI_POND_QUALITY_NAMES.map((name) => [name.toLowerCase(), name]),
);

export const KOI_POND_LAYOUT = Object.freeze({
    pondCenter: Object.freeze({ x: 0, y: 0, z: -6 }),
    pondRadii: Object.freeze({ x: 20, z: 13 }),
    gameplayCenter: Object.freeze({ x: 0, y: 0.30, z: -6 }),
    gameplayRadii: Object.freeze({ x: 14.4, z: 7.8 }),
    boardSanctuary: Object.freeze({
        center: Object.freeze({ x: 0, y: 0.24, z: -5.5 }),
        width: 7.3,
        depth: 13.2,
    }),
    moon: Object.freeze({
        // Lifted into clear sky above the far ridge for the shallower cinematic
        // camera (the old y=-8 sat on the mountain line and read as "in" the
        // mountains). Still upper-left and distant so the trees partly frame it.
        position: Object.freeze({ x: -14, y: 6, z: -66 }),
        radius: 2.9,
        glowScale: 11.5,
        lightDirection: Object.freeze({ x: -0.36, y: 0.82, z: -0.44 }),
    }),
    guardian: Object.freeze({
        position: Object.freeze({ x: -15, z: -18.4 }),
        // A three-quarter profile lets the hooked nose and watching eye read
        // cleanly while the guardian faces into the pond.
        rotationY: 0.72,
        scale: 1.08,
    }),
    camera: Object.freeze({
        position: Object.freeze({ x: 0, y: 17.6, z: 27.4 }),
        target: Object.freeze({ x: 0, y: 1.2, z: -5.5 }),
        parallax: Object.freeze({
            position: Object.freeze({ x: 1.25, y: 0.52, z: 0.28 }),
            target: Object.freeze({ x: 0.38, y: 0.16, z: 0 }),
            springFrequency: 1.15,
        }),
        fov: 42,
        near: 0.1,
        far: 140,
    }),
});

export const KOI_POND_TERRAIN = Object.freeze({
    innerRadius: 1,
    outerRadius: 2.18,
});

export const KOI_POND_PIXEL_RATIO_CAPS = Object.freeze({
    Minimal: 0.8,
    Low: 1,
    Medium: 1.15,
    High: 1.35,
    Ultra: 1.4,
    Extreme: 1.4,
});

export function normalizeKoiPondQuality(value, fallback = 'High') {
    const normalizedFallback = QUALITY_NAME_LOOKUP.get(
        String(fallback || 'High').trim().toLowerCase(),
    ) || 'High';
    return QUALITY_NAME_LOOKUP.get(String(value || '').trim().toLowerCase())
        || normalizedFallback;
}

export function getKoiPondPixelRatioCap(quality) {
    return KOI_POND_PIXEL_RATIO_CAPS[normalizeKoiPondQuality(quality)];
}

/**
 * Deterministic terrain height shared by the bank and shoreline vegetation.
 * It keeps the wet inner lip fixed while turning the old flat outer ring into
 * a low, asymmetric woodland floor.
 */
export function sampleKoiPondGroundHeight(x, z) {
    const pondX = Number(x) / KOI_POND_LAYOUT.pondRadii.x;
    const pondZ = (Number(z) - KOI_POND_LAYOUT.pondCenter.z)
        / KOI_POND_LAYOUT.pondRadii.z;
    const radial = Math.hypot(pondX, pondZ);
    const progress = Math.max(0, Math.min(
        1,
        (radial - KOI_POND_TERRAIN.innerRadius)
            / (KOI_POND_TERRAIN.outerRadius - KOI_POND_TERRAIN.innerRadius),
    ));
    const angle = Math.atan2(pondZ, pondX);
    const shoreShelf = Math.sin(progress * Math.PI) * 0.30;
    const broadRelief = (
        Math.sin(angle * 2.0 + 0.65) * 0.105
        + Math.sin(angle * 5.0 - 0.4) * 0.045
    ) * progress;
    const farBankRise = Math.max(0, -Math.sin(angle)) * progress * 0.16;
    const foregroundFall = Math.max(0, Math.sin(angle)) * progress * 0.13;
    return -0.18
        + shoreShelf
        - progress * 0.19
        + broadRelief
        + farBankRise
        - foregroundFall;
}

/**
 * Resolve a bounded canonical camera pose without allocating when an output
 * object is supplied. Pointer Y is positive toward the top of the viewport.
 */
export function resolveKoiPondCameraPose(pointer = {}, output = null) {
    const rawX = Number(pointer.x);
    const rawY = Number(pointer.y);
    const x = Math.max(-1, Math.min(1, Number.isFinite(rawX) ? rawX : 0));
    const y = Math.max(-1, Math.min(1, Number.isFinite(rawY) ? rawY : 0));
    const { camera } = KOI_POND_LAYOUT;
    const pose = output || {
        position: { x: 0, y: 0, z: 0 },
        target: { x: 0, y: 0, z: 0 },
    };
    pose.position ??= { x: 0, y: 0, z: 0 };
    pose.target ??= { x: 0, y: 0, z: 0 };

    pose.position.x = camera.position.x + x * camera.parallax.position.x;
    pose.position.y = camera.position.y + y * camera.parallax.position.y;
    pose.position.z = camera.position.z + y * camera.parallax.position.z;
    pose.target.x = camera.target.x + x * camera.parallax.target.x;
    pose.target.y = camera.target.y + y * camera.parallax.target.y;
    pose.target.z = camera.target.z + y * camera.parallax.target.z;
    return pose;
}

/**
 * Convert the router's gameplay-safe side lane into the canonical water plane.
 */
export function mapKoiPondSideLaneToWorld(origin = {}) {
    const sideLane = origin?.sideLane;
    const side = sideLane?.side === 'left' ? -1 : 1;
    const rawY = Number(sideLane?.normalized?.y);
    const normalizedY = Number.isFinite(rawY)
        ? Math.max(0, Math.min(1, rawY))
        : 0.5;
    return {
        x: side * 10.9,
        y: KOI_POND_LAYOUT.gameplayCenter.y,
        z: -16.1 + normalizedY * 21.2,
    };
}
