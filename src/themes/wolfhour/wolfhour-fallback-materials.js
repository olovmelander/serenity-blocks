const clamp01 = (value) => Math.min(1, Math.max(0, value));

const smoothstep = (edge0, edge1, value) => {
    const t = clamp01((value - edge0) / (edge1 - edge0));
    return t * t * (3 - 2 * t);
};

/**
 * Builds the WebGL fallback halo as data rather than adding another GLSL twin.
 * The profile deliberately mirrors createLunarHaloNodeMaterial's quiet corona.
 *
 * @param {typeof import('three')} THREE
 * @param {{ size?: number }} [options]
 * @returns {import('three').DataTexture}
 */
export function createLunarHaloFallbackTexture(THREE, { size = 256 } = {}) {
    const resolution = Math.max(16, Math.floor(size));
    const pixels = new Uint8Array(resolution * resolution * 4);

    for (let y = 0; y < resolution; y += 1) {
        const v = (y + 0.5) / resolution;
        for (let x = 0; x < resolution; x += 1) {
            const u = (x + 0.5) / resolution;
            const radius = Math.hypot(u - 0.5, v - 0.5) * 2;
            const corona = smoothstep(0.28, 0.44, radius)
                * (1 - smoothstep(0.46, 1, radius));
            const rim = 1 - smoothstep(0.018, 0.065, Math.abs(radius - 0.52));
            const alpha = clamp01(corona * 0.72 + rim * 0.28);
            const offset = (y * resolution + x) * 4;
            pixels[offset] = 255;
            pixels[offset + 1] = 255;
            pixels[offset + 2] = 255;
            pixels[offset + 3] = Math.round(alpha * 255);
        }
    }

    const texture = new THREE.DataTexture(
        pixels,
        resolution,
        resolution,
        THREE.RGBAFormat,
        THREE.UnsignedByteType,
    );
    texture.name = 'wolfhour-lunar-halo-fallback';
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    return texture;
}

/**
 * @param {typeof import('three')} THREE
 * @param {{ color?: number, opacity?: number, textureSize?: number }} [options]
 * @returns {import('three').MeshBasicMaterial}
 */
export function createLunarHaloFallbackMaterial(THREE, {
    color = 0x829fe8,
    opacity = 0.075,
    textureSize = 256,
} = {}) {
    const material = new THREE.MeshBasicMaterial({
        map: createLunarHaloFallbackTexture(THREE, { size: textureSize }),
        color,
        opacity,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide,
        toneMapped: false,
    });
    material.name = 'wolfhour-lunar-halo-fallback';
    return material;
}
