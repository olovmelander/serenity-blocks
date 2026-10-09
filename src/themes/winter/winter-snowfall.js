/**
 * Winter — snow in the air.
 *
 *  - Snowfall: flakes in a box of air round the viewer, each falling at its own pace, swaying,
 *    carried on the wind and wrapped so the same flake comes round again. Its whole path is
 *    closed form in the world clock, the wind's run and the gusts, so nothing is simulated.
 *    Far flakes are points; near ones are six-armed; the nearest pass the lens as soft discs.
 *    They are lit as snow in the air is: brightest toward the moon.
 *  - Diamond dust: ice crystals that fire when the light finds them. It thickens as the fires
 *    rise, and takes their colour.
 */

import {
    Fn,
    abs,
    atan,
    attribute,
    cameraPosition,
    clamp,
    cos,
    dot,
    exp,
    fract,
    length,
    max,
    mix,
    normalize,
    positionGeometry,
    sin,
    smoothstep,
    uv,
    varying,
    vec3,
    vec4,
} from 'three/tsl';
import {
    EYE, mulberry32, wClip, wFxMaterial, wGust, wPart, wPow4, wQuadGeometry, wSq,
} from './winter-tsl.js';

/** The box of air the snowfall lives in (metres), and where its middle is from the eye. */
export const SNOW_BOX = Object.freeze([48, 26, 46]);
export const SNOW_CENTRE = Object.freeze([0, 8.5, -16]);

/**
 * @param {object} u
 * @param {number} count
 */
export function createSnowfall(u, count) {
    const aSeed = new Float32Array(count * 4);
    const rand = mulberry32(0x5f0a);
    for (let i = 0; i < count * 4; i++) aSeed[i] = rand();
    const geometry = wQuadGeometry(count, { aSeed: [aSeed, 4] });
    const seed = attribute('aSeed', 'vec4');
    const material = wFxMaterial('WinterSnowfall');

    const box = vec3(...SNOW_BOX);
    const heavy = seed.w.mul(seed.w);
    // Big flakes fall slower than they look, small ones dither down.
    const fall = heavy.mul(0.7).add(0.75);
    const carried = vec3(
        u.windRun.x.mul(seed.w.mul(0.35).add(0.85)),
        u.time.mul(fall).negate(),
        u.windRun.y.mul(seed.w.mul(0.35).add(0.85)),
    );
    const local = fract(seed.xyz.add(carried.div(box))).sub(0.5).mul(box).toVar();
    const swing = u.time.mul(seed.x.mul(0.7).add(0.5)).add(seed.y.mul(40.0));
    const sway = vec3(sin(swing).mul(0.24), 0.0, cos(swing.mul(0.83)).mul(0.2));
    const rest = vec3(EYE.x + SNOW_CENTRE[0], EYE.y + SNOW_CENTRE[1], EYE.z + SNOW_CENTRE[2]).add(local).add(sway);
    // A gust takes the flakes with it as its front passes.
    const gust = wGust(u, rest);
    const world = rest.add(vec3(gust.x, gust.z.mul(0.25), gust.y).mul(2.6));
    const clip = wClip(world);
    const metres = heavy.mul(0.036).add(0.019);
    const rawPx = u.pxScale.mul(metres).div(max(clip.w, 0.3));
    // Never smaller than a pixel (they dim instead), never a blob that fills the lens.
    const px = clamp(rawPx, 1.3, u.viewport.y.mul(0.03));
    const half = u.viewport.mul(0.5);
    material.vertexNode = vec4(clip.xy.add(positionGeometry.xy.mul(px.mul(2.0)).div(half).mul(clip.w)), clip.z, clip.w);

    const toFlake = normalize(world.sub(cameraPosition));
    const toMoon = max(dot(toFlake, u.moonDir), 0.0);
    const lit = u.shade.mul(1.5).add(u.band.mul(0.55)).add(u.glow.mul(0.22))
        .add(u.moonCol.mul(wPow4(toMoon).mul(1.7).add(0.3)))
        .add(mix(u.fire, u.crown, 0.3).mul(u.power.mul(0.3)));
    // The edge of the box is not a wall: flakes thin out toward it.
    const edge = smoothstep(0.5, 0.4, abs(local.x).div(box.x)).mul(smoothstep(0.5, 0.4, abs(local.z).div(box.z)))
        .mul(smoothstep(0.5, 0.42, abs(local.y).div(box.y)));
    const dim = clamp(rawPx.div(1.3), 0.3, 1.0);
    const vLight = varying(lit.mul(u.breath.mul(0.8).add(0.2)), 'wFlakeLight');
    // (alpha, pixels across, spin)
    const vShape = varying(vec3(edge.mul(dim), px, seed.z.mul(6.28).add(u.time.mul(seed.x.sub(0.5)).mul(0.9))), 'wFlakeShape');
    material.colorNode = Fn(() => {
        const q = uv().sub(0.5).mul(2.0);
        const d = length(q);
        const size = vShape.y;
        // Far: a soft point. Mid: a six-armed crystal. Against the lens: a pale disc.
        const point = exp(d.mul(d).mul(-3.6)).mul(0.8);
        const angle = atan(q.y, q.x).add(vShape.z);
        const arms = wSq(abs(cos(angle.mul(3.0)))).mul(smoothstep(1.0, 0.2, d)).mul(0.55)
            .add(exp(d.mul(d).mul(-7.0)).mul(0.75));
        const disc = smoothstep(1.0, 0.72, d).mul(0.34);
        const crisp = smoothstep(4.0, 9.0, size);
        const blurred = smoothstep(16.0, 30.0, size);
        const shape = mix(mix(point, clamp(arms, 0.0, 1.0), crisp), disc, blurred);
        const a = clamp(shape.mul(vShape.x).mul(0.8), 0.0, 1.0);
        return vec4(vLight.mul(a), a);
    })();
    const part = wPart('WinterSnowfall', geometry, material, 40);
    part.count = count;
    return part;
}

/** The box of air round the viewer the dust lives in (metres). */
const DUST_BOX = [44, 20, 44];

/**
 * @param {object} u
 * @param {number} count
 */
export function createDust(u, count) {
    const aSeed = new Float32Array(count * 4);
    const rand = mulberry32(0xd057);
    for (let i = 0; i < count * 4; i++) aSeed[i] = rand();
    const geometry = wQuadGeometry(count, { aSeed: [aSeed, 4] });
    const seed = attribute('aSeed', 'vec4');
    const material = wFxMaterial('WinterDust');
    const drift = vec3(
        u.windRun.x.mul(0.5),
        u.time.mul(-0.16).add(sin(u.time.mul(0.4).add(seed.w.mul(20.0))).mul(0.3)),
        u.windRun.y.mul(0.5),
    );
    const box = vec3(...DUST_BOX);
    const local = fract(seed.xyz.add(drift.div(box))).sub(0.5).mul(box);
    const world = vec3(EYE.x, EYE.y + 5.5, EYE.z - 14.0).add(local);
    const clip = wClip(world);
    const half = u.viewport.mul(0.5);
    const px = clamp(u.pxScale.mul(0.014).div(max(clip.w, 0.5)), 1.0, u.viewport.y.mul(0.004));
    material.vertexNode = vec4(clip.xy.add(positionGeometry.xy.mul(px.mul(2.0)).div(half).mul(clip.w)), clip.z, clip.w);
    // A crystal fires when it turns a face to the light: briefly, and not all at once.
    const fire = sin(u.time.mul(seed.w.mul(3.0).add(1.5)).add(seed.x.mul(60.0))).mul(0.5).add(0.5);
    const flash = fire.mul(fire).mul(fire).mul(fire);
    const reach = smoothstep(0.5, 0.36, length(local.div(box)));
    const toMoon = max(dot(normalize(world.sub(cameraPosition)), u.moonDir), 0.0);
    const light = u.moonCol.mul(wSq(toMoon).mul(1.6).add(0.5))
        .add(mix(u.fire, u.crown, seed.y).mul(u.power.mul(1.6).add(u.surge.mul(1.4))));
    // More of it hangs in the air as the fires rise.
    const present = smoothstep(0.0, 0.06, u.power.mul(0.75).add(0.3).add(u.surge.mul(0.4)).sub(seed.z));
    const vLight = varying(light.mul(flash.mul(reach).mul(present)).mul(u.breath), 'wDust');
    material.colorNode = Fn(() => {
        const q = uv().sub(0.5).mul(2.0);
        const d = length(q);
        return vec4(vLight.mul(exp(d.mul(d).mul(-5.0))).mul(smoothstep(1.0, 0.6, d)), 0.0);
    })();
    const part = wPart('WinterDust', geometry, material, 42);
    part.count = count;
    return part;
}
