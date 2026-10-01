/** A silver moon sits within the dark opening above the mountain walls. */
export function resolveWolfhourComposition(aspect) {
    const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
    const widthBlend = Math.min(1, Math.max(0, (safeAspect - 0.8) / 0.8));
    const blend = widthBlend * widthBlend * (3 - 2 * widthBlend);
    return {
        moonX: -500 * safeAspect * (0.18 + blend * 0.16),
        moonY: 375 - blend * 35,
        moonScale: (0.375 + blend * 0.175) * 1.5625,
    };
}

/** A slow pan and an 18-second breathing cycle drive the layered landscape. */
export function updateWolfhourCamera(camera, time, aspect, pointerX = 0, pointerY = 0, shake = 0) {
    const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
    const safeTime = Number.isFinite(time) ? time : 0;
    const px = Number.isFinite(pointerX) ? Math.max(-1, Math.min(1, pointerX)) : 0;
    const py = Number.isFinite(pointerY) ? Math.max(-1, Math.min(1, pointerY)) : 0;
    const boundedShake = Number.isFinite(shake) ? Math.min(0.45, Math.max(0, shake)) : 0;
    const horizontalRoom = Math.max(0.4, Math.min(1.2, safeAspect / (16 / 9)));
    const breath = Math.sin(safeTime * ((Math.PI * 2) / 18));
    camera.position.x = (Math.sin(safeTime * 0.089) * 32 + Math.sin(safeTime * 0.037) * 11 + px * 38)
        * horizontalRoom + Math.sin(safeTime * 51) * boundedShake * 3;
    camera.position.y = Math.sin(safeTime * 0.072) * 7 + Math.sin(safeTime * 0.032) * 3 - py * 18
        + breath * 4.5 + Math.cos(safeTime * 47) * boundedShake * 2;
    camera.rotation.z = 0;
    // Inhale moves gently into the valley; exhale eases back. Absolute time keeps
    // the motion smooth across frame-rate changes and deterministic when seeking.
    const halfHeight = 500 * (1 - breath * 0.028 + Math.sin(safeTime * 0.065) * 0.004);
    const nextRight = halfHeight * safeAspect;
    if (Math.abs(camera.right - nextRight) > 0.001 || Math.abs(camera.top - halfHeight) > 0.001) {
        camera.left = -nextRight; camera.right = nextRight;
        camera.top = halfHeight; camera.bottom = -halfHeight;
        camera.updateProjectionMatrix();
    }
}
