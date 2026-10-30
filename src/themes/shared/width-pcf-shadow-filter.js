/**
 * three r186's PCF shadow filter, kept for the themes whose look was set with it.
 *
 * three's PCF filter takes five depth compares on a Vogel disc turned from pixel to pixel by
 * interleaved gradient noise. Up to r186 it scaled the disc by the texel WIDTH on both axes; r187
 * (#35018, "Fix PCF radius for non-square shadow maps") scales each axis by its own texel size. On
 * a 2:1 map (Summer's sun, Forest's and Sakura Twilight's moon: 4096 x 2048 on High) that doubles
 * the disc's height, and the per-pixel turn of a disc reaching that far across the canopy's depths
 * printed a diamond screen-door grain over the lit leaves and petals (r186 vs r187 captures,
 * 2026-10-30). This is r186's filter as it was, so those themes draw what they drew.
 *
 * The uniforms are made once per shadow and shared by every material that receives it, as r187's
 * own filter now does (#35047), instead of once per material.
 *
 * Use: `light.shadow.filterNode = widthPcfShadowFilter`.
 */
import {
    Fn, add, interleavedGradientNoise, reference, renderGroup, screenCoordinate, texture, vec2, vogelDiskSample,
} from 'three/tsl';

const uniformsByShadow = new WeakMap();

function shadowUniforms(shadow) {
    let uniforms = uniformsByShadow.get(shadow);
    if (!uniforms) {
        uniforms = {
            mapSize: reference('mapSize', 'vec2', shadow).setGroup(renderGroup),
            radius: reference('radius', 'float', shadow).setGroup(renderGroup),
        };
        uniformsByShadow.set(shadow, uniforms);
    }
    return uniforms;
}

export const widthPcfShadowFilter = Fn(({
    depthTexture, shadowCoord, shadow, depthLayer,
}) => {
    const depthCompare = (uv, compare) => {
        let depth = texture(depthTexture, uv);
        if (depthTexture.isArrayTexture) depth = depth.depth(depthLayer);
        return depth.compare(compare);
    };
    const { mapSize, radius } = shadowUniforms(shadow);
    const radiusScaled = radius.mul(vec2(1).div(mapSize).x);
    // The disc turned per pixel by interleaved gradient noise (phi = IGN * 2 pi).
    const phi = interleavedGradientNoise(screenCoordinate.xy).mul(6.28318530718);
    const tap = (i) => depthCompare(shadowCoord.xy.add(vogelDiskSample(i, 5, phi).mul(radiusScaled)), shadowCoord.z);
    return add(tap(0), tap(1), tap(2), tap(3), tap(4)).mul(1 / 5);
});
