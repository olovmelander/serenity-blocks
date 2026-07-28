/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Stillwater painterly pass — Kuwahara region flattening plus watercolour
 * boundary behaviour.
 *
 * Why this exists, measured rather than asserted: John Bauer's forest pictures
 * are structurally bimodal — 50-66% of pixels carry essentially zero local
 * gradient while the tail saturates at hard boundaries. A clean real-time render
 * is the exact inverse, mid-frequency gradient everywhere. Kuwahara is the
 * filter that attacks that directly: it flattens region interiors into constant
 * colour while preserving, and in practice sharpening, the boundaries between
 * them. It also eats a low-variance shading seam for free, because a seam is
 * exactly a low-variance gradient.
 *
 * Two hard constraints, both non-negotiable:
 *
 * 1. NEVER full-screen. At any useful radius this smears the falling pieces,
 *    and gameplay legibility outranks art direction at the exact moment they
 *    conflict. The board rect plus a margin is masked out with a soft feather.
 * 2. Judge it in MOTION. `?t=` captures freeze dt and hide sector crawl, which
 *    is this filter's characteristic failure. scripts/dev/stillwater-temporal.mjs
 *    measures per-pixel luma variance across live frames for exactly this.
 *
 * This is the single-pass variant: sector variance is computed directly from the
 * colour buffer rather than from a separately-rendered structure tensor. That
 * costs some orientation coherence versus Kyprianidis's anisotropic form, but it
 * fits three's single output-node chain without additional render targets, and
 * the smoothing that buys temporal stability is recovered by keeping the radius
 * small and the sector count even.
 */
import {
    add,
    cos,
    dot,
    float,
    Fn,
    Loop,
    max,
    mix,
    screenSize,
    screenUV,
    sin,
    smoothstep,
    vec2,
    vec3,
} from 'three/tsl';
/** Sector count. Even counts keep opposing lobes balanced and reduce crawl. */
const SECTORS = 8;
/** Samples per sector. */
const SECTOR_SAMPLES = 6;
/** Radius in pixels at 1080p; scaled with height so the LOOK is resolution-independent. */
const BASE_RADIUS_PX = 4.5;
const REFERENCE_HEIGHT = 1080;
/**
 * Build the Kuwahara + watercolour node chain.
 *
 * @param {object} options
 * @param {import('three/tsl').ShaderNodeObject} options.colorNode source colour
 * @param {import('three/tsl').ShaderNodeObject} options.strengthNode 0..1 mask
 * @returns {import('three/tsl').ShaderNodeObject} filtered colour
 */
export function createStillwaterPainterly({ colorNode, strengthNode }) {
    const texel = vec2(1).div(screenSize);
    const radius = float(BASE_RADIUS_PX).mul(screenSize.y.div(REFERENCE_HEIGHT)).max(1.5);
    const kuwahara = Fn(() => {
        const bestColor = vec3(0).toVar();
        const bestVariance = float(1e9).toVar();
        Loop({
            start: 0, end: SECTORS, type: 'int', condition: '<',
        }, ({ i }) => {
            const sectorAngle = float(i).mul((Math.PI * 2) / SECTORS);
            const sum = vec3(0).toVar();
            const sumSquared = vec3(0).toVar();
            Loop({
                start: 1, end: SECTOR_SAMPLES + 1, type: 'int', condition: '<',
            }, ({ i: j }) => {
                // Fan the taps across the sector wedge rather than along a single
                // spoke, so each sector actually samples an area.
                const t = float(j).div(SECTOR_SAMPLES);
                const spread = t.mul((Math.PI * 2) / SECTORS);
                const angle = sectorAngle.add(spread);
                const offset = vec2(cos(angle), sin(angle)).mul(radius).mul(t).mul(texel);
                const sample = colorNode.sample(screenUV.add(offset)).rgb;
                sum.addAssign(sample);
                sumSquared.addAssign(sample.mul(sample));
            });
            const mean = sum.div(SECTOR_SAMPLES);
            const variance = sumSquared.div(SECTOR_SAMPLES).sub(mean.mul(mean));
            // Weight variance by luminance response: the eye judges flatness by
            // value, not by channel.
            const scalarVariance = dot(max(variance, vec3(0)), vec3(0.299, 0.587, 0.114));
            // TSL cannot see a plain JS reassignment inside a loop; mix() on a
            // comparison is the branch-free form that actually compiles.
            const isBetter = scalarVariance.lessThan(bestVariance);
            bestColor.assign(mix(bestColor, mean, float(isBetter)));
            bestVariance.assign(mix(bestVariance, scalarVariance, float(isBetter)));
        });
        return bestColor;
    });
    const flattened = kuwahara();
    const original = colorNode.sample(screenUV).rgb;
    // Watercolour edge darkening (Curtis et al. 1997, minus the fluid sim):
    // pigment pools at a wash boundary. This is what makes a flat region read as
    // a wash rather than as untextured shading, and it is the cheap half of what
    // makes Bauer's boulders look painted.
    const lumaAt = (offset) => dot(colorNode.sample(screenUV.add(offset)).rgb, vec3(0.2126, 0.7152, 0.0722));
    const centre = lumaAt(vec2(0));
    const gradientX = lumaAt(vec2(texel.x, 0)).sub(lumaAt(vec2(texel.x.negate(), 0)));
    const gradientY = lumaAt(vec2(0, texel.y)).sub(lumaAt(vec2(0, texel.y.negate())));
    const edge = smoothstep(0.02, 0.16, add(gradientX.abs(), gradientY.abs()));
    const darkened = flattened.mul(mix(float(1), float(0.80), edge));
    // Paper granulation. Modulates value MORE in dark washes than light ones,
    // which is where most of this frame lives. Locked to screen pixels via
    // screenSize so it cannot swim on resize the way a screenUV-sampled grain
    // would; static, because animated grain crawls.
    const grainCoord = screenUV.mul(screenSize).div(vec2(3.0));
    const grain = sin(grainCoord.x.mul(12.9898).add(grainCoord.y.mul(78.233)))
        .mul(43758.5453)
        .fract();
    const granulated = darkened.mul(
        mix(float(1), float(0.92).add(grain.mul(0.16)), centre.oneMinus().mul(1.4).clamp()),
    );
    return mix(original, granulated, strengthNode);
}
/**
 * Mask for the painterly pass: full strength on the far background, zero over
 * the play field. `board` is a normalized screen rect.
 */
export function createStillwaterPainterlyMask({ board, marginScale = 1.2, feather = 0.02 }) {
    const halfWidth = (board.width * marginScale) / 2;
    const halfHeight = (board.height * marginScale) / 2;
    const centreX = board.x + board.width / 2;
    const centreY = board.y + board.height / 2;
    const dx = screenUV.x.sub(centreX).abs();
    const dy = screenUV.y.oneMinus().sub(centreY).abs();
    // 1 outside the board rect, 0 inside, with a soft edge so the transition is
    // never a visible seam across the water.
    const outsideX = smoothstep(halfWidth - feather, halfWidth + feather, dx);
    const outsideY = smoothstep(halfHeight - feather, halfHeight + feather, dy);
    return max(outsideX, outsideY);
}
export default createStillwaterPainterly;
