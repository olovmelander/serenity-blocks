/**
 * A soft shadow filter with no per-pixel noise, for themes drawn without a temporal filter.
 *
 * three r186's PCF filter takes five depth compares on a Vogel disc that it turns from pixel to
 * pixel by interleaved gradient noise, which a temporal filter (TAA) is meant to average away.
 * Without one the noise stays, and under a low sun nearly every surface sits at the edge of its
 * own shadow, so it shows as a fine diagonal crosshatch over the whole frame (MSAA does not
 * help: shading is per pixel). A fixed grid of hardware-filtered compares, each already a
 * smooth 2 x 2 PCF because PCF shadow maps sample with LinearFilter, gives the same width of
 * penumbra with no grain.
 *
 * Use: `light.shadow.filterNode = gridShadowFilter(mapSize, radius, taps)`, nine taps where the
 * frame can afford them, four on the low tiers.
 */
import {
    Fn, float, texture, vec2,
} from 'three/tsl';

/**
 * @param {readonly number[]} mapSize the shadow map's [width, height] in texels
 * @param {number} radius the penumbra's half-width in texels (the light's `shadow.radius`)
 * @param {number} [taps=9] 9 for a 3 x 3 grid, anything less for four taps
 */
export function gridShadowFilter(mapSize, radius, taps = 9) {
    const step = vec2(radius / mapSize[0], radius / mapSize[1]);
    const grid = taps >= 9
        ? [-0.5, 0, 0.5].flatMap((y) => [-0.5, 0, 0.5].map((x) => [x, y]))
        : [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]];
    return Fn(({ depthTexture, shadowCoord }) => {
        let sum = float(0);
        grid.forEach(([x, y]) => {
            sum = sum.add(texture(depthTexture, shadowCoord.xy.add(step.mul(vec2(x, y)))).compare(shadowCoord.z));
        });
        return sum.mul(1 / grid.length);
    });
}
