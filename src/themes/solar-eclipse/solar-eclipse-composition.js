// Keep the authored orbit and aim. Only widen a portrait projection enough to
// contain the solar disc and the moon's silhouette during central alignment.
const HERO_BOUNDS = [
    { y: 0, z: -100, radius: 350 },
    { y: 25, z: 50, radius: 320 },
];
const HERO_FRAME_LIMIT = 0.9;

export function applySolarEclipsePortraitFit(camera) {
    let zoom = 1;
    if (Number.isFinite(camera.aspect) && camera.aspect > 0 && camera.aspect < 1) {
        camera.updateMatrixWorld();
        const matrix = camera.matrixWorldInverse.elements;
        const focalLength = 1 / Math.tan((camera.fov * Math.PI) / 360);
        let extent = 0;
        for (const { y, z, radius } of HERO_BOUNDS) {
            const centerX = matrix[4] * y + matrix[8] * z + matrix[12];
            const centerY = matrix[5] * y + matrix[9] * z + matrix[13];
            const depth = -(matrix[6] * y + matrix[10] * z + matrix[14]);
            // Exact perspective tangents of a sphere, including an off-axis aim.
            const denominator = depth * depth - radius * radius;
            if (denominator <= 0) continue;
            const horizontal = (Math.abs(centerX) * depth
                + radius * Math.sqrt(centerX * centerX + denominator)) / denominator;
            const vertical = (Math.abs(centerY) * depth
                + radius * Math.sqrt(centerY * centerY + denominator)) / denominator;
            extent = Math.max(extent, (horizontal * focalLength) / camera.aspect, vertical * focalLength);
        }
        if (extent > HERO_FRAME_LIMIT) zoom = Math.max(0.05, HERO_FRAME_LIMIT / extent);
    }
    if (camera.zoom !== zoom) {
        camera.zoom = zoom;
        camera.updateProjectionMatrix();
    }
    return zoom;
}
