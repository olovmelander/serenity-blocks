/** Frame-rate independent choreography shared with the isolated Noir preview. */
export function decayNoirValue(value, retentionAt60Hz, delta) {
    return value * retentionAt60Hz ** (Math.max(0, delta) * 60);
}

export function sampleNoirNebula(time, layer, camera, target) {
    const phase = layer.driftPhase ?? 0;
    const speed = (layer.driftSpeed ?? 0.00015) * 160;
    const amplitude = layer.driftAmplitude ?? 100;
    target.x = (layer.baseX ?? 0) + camera.x * (layer.parallaxX ?? 0.2)
        + Math.sin(time * speed + phase) * amplitude;
    target.y = (layer.baseY ?? 0) + camera.y * (layer.parallaxY ?? 0.15)
        + Math.sin(time * speed * 0.73 + phase * 1.3) * amplitude * 0.45;
    target.rotation = (layer.baseRotation ?? 0)
        + Math.sin(time * 0.018 + phase) * 0.009;
    target.pulse = Math.sin(time * Math.PI * 0.2 + (layer.pulsePhase ?? phase));
    return target;
}

/** Keep the full 280-unit hero outside the camera, including parallax and shake. */
export function constrainNoirCamera(position, hero, minimumDistance = 900) {
    const centerX = hero?.x ?? 0;
    const centerY = hero?.y ?? 0;
    const centerZ = hero?.z ?? 0;
    // Preserve the intended framing when pushing in: move backward, not sideways.
    const dx = position.x - centerX;
    const dy = position.y - centerY;
    const minimumForward = minimumDistance * 0.8;
    const safeForward = Math.max(
        minimumForward,
        Math.sqrt(Math.max(0, minimumDistance * minimumDistance - dx * dx - dy * dy)),
    );
    position.z = Math.max(position.z, centerZ + safeForward);
    return position;
}

/** Sprites store their physical dimensions in scale; plane meshes already own them. */
export function applyNoirFlashScale(mesh, intensity) {
    const factor = 1 + intensity * 0.65;
    const baseSize = mesh.userData.baseSize ?? 1;
    mesh.scale.set(baseSize * factor, baseSize * factor, 1);
}

/** Normalized viewport pose; the core stays left of the central playfield. */
export function resolveNoirComposition(time, aspect, phaseX, phaseY, target) {
    const portrait = aspect < 1.1;
    target.x = (portrait ? 0.112 : 0.2)
        + Math.sin(time * 0.13 + phaseX) * (portrait ? 0.006 : 0.016);
    target.y = (portrait ? 0.135 : 0.36)
        + Math.cos(time * 0.11 + phaseY) * (portrait ? 0.008 : 0.022);
    target.radius = Math.min(portrait ? 0.09 : 0.19, Math.max(0.1, aspect) * (portrait ? 0.075 : 0.135))
        * (1 + Math.sin(time * 0.08 + phaseX * 0.7) * 0.025);
    return target;
}

/** World-radius / view-depth that fits an off-axis perspective sphere's silhouette. */
export function noirSphereRadiusRatio(radiusHeight, ndcX, ndcY, aspect, fov) {
    const tangent = Math.tan((fov * Math.PI) / 360);
    const slope = Math.max(Math.abs(ndcX * aspect * tangent), Math.abs(ndcY * tangent));
    const widthSquared = (2 * radiusHeight * tangent) ** 2;
    const b = 2 * widthSquared + 1 + slope * slope;
    const root = Math.sqrt(Math.max(0, b * b - 4 * (widthSquared + 1) * widthSquared));
    return Math.sqrt((2 * widthSquared) / (b + root));
}

export const NOIR_WAVE_LIMIT = 16;
export const NOIR_SHOCKWAVE_SHAPES = Object.freeze([
    Object.freeze({ radius: 40, tube: 1.6 }),
    Object.freeze({ radius: 52, tube: 2.4 }),
    Object.freeze({ radius: 64, tube: 3.2 }),
]);
