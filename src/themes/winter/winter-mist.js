/**
 * Winter — the mist on the lake.
 *
 * On a still, very cold night a mist lies over the ice, a few metres deep, in banks that drift.
 * It is a handful of tall cards standing across the lake at different distances, the last behind
 * the first trees of the far shore: each is a bank whose top rises and falls along its length
 * (one noise read) and thins upward into nothing. They are drawn over the solids at their own
 * depths, so the bear walks into the mist and out of it, the spits' trees stand in front of the
 * banks behind them, and the far shore is seen through all of them.
 *
 * It takes the light it lies in: the moon's, most of all toward the moon; the last light on the
 * side it glows from; and the fires' colour when they burn. How much of it there is is the
 * weather's (`u.weather.z`): a breath on most nights, banks in the ice haze.
 */

import {
    Fn,
    attribute,
    cameraPosition,
    dot,
    exp,
    float,
    length,
    max,
    mix,
    normalize,
    positionGeometry,
    smoothstep,
    uv,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    ICE_Y, wClip, wFxMaterial, wPart, wPow4, wQuadGeometry, wSq,
} from './winter-tsl.js';

/** The banks: [metres from the eye, metres deep, how much of the mist it carries]. */
export const MIST_BANKS = Object.freeze([
    [84, 7.5, 0.5],
    [128, 10, 0.75],
    [176, 12.5, 0.9],
    [262, 19, 1],
]);

/** Half the angle a card spans from the eye (it must cover the frame at any aspect, and its sway). */
const HALF_SPAN = Math.tan((56 * Math.PI) / 180);

/**
 * @param {object} u
 * @param {number} [count]  banks to draw, nearest first dropped (lean tiers keep the far ones)
 */
export function createMist(u, count = MIST_BANKS.length) {
    const banks = MIST_BANKS.slice(MIST_BANKS.length - Math.max(1, Math.min(MIST_BANKS.length, count)));
    const aBank = new Float32Array(banks.length * 4);
    banks.forEach(([far, deep, share], i) => aBank.set([far, deep, share, i * 0.37 + 0.11], i * 4));
    const geometry = wQuadGeometry(banks.length, { aBank: [aBank, 4] });
    const bank = attribute('aBank', 'vec4');
    const material = wFxMaterial('WinterLakeMist');
    const world = vec3(
        positionGeometry.x.mul(2.0).mul(bank.x).mul(HALF_SPAN),
        positionGeometry.y.add(0.5).mul(bank.y).add(ICE_Y - 0.3),
        bank.x.negate(),
    );
    material.vertexNode = wClip(world);
    const toBank = normalize(world.sub(cameraPosition));
    const cs = max(dot(toBank, u.moonDir), 0.0);
    const flat = toBank.xz.div(max(length(toBank.xz), 1e-3));
    const toward = dot(flat, u.glowDir).mul(0.5).add(0.5);
    const burning = u.curtains.x.add(u.curtains.y).add(u.curtains.z).add(u.curtains.w);
    const light = u.moonCol.mul(wPow4(cs).mul(0.7).add(wSq(cs).mul(0.2)).add(0.3))
        .add(u.shade.mul(0.9)).add(u.band.mul(0.5))
        .add(u.glow.mul(wSq(toward).mul(toward).mul(0.4)))
        .add(mix(u.fire, u.crown, 0.25).mul(burning.mul(0.05)));
    const vLight = varying(light.mul(u.breath.mul(0.7).add(0.3)), 'wMistLight');
    // (metres along the bank, its seed, how much it carries)
    const vBank = varying(vec3(world.x, bank.w, bank.z), 'wMistBank');
    material.colorNode = Fn(() => {
        const st = uv();
        // The bank's top rises and falls along it, and it drifts on the wind.
        const along = vBank.x.mul(0.0042).add(u.windRun.x.mul(0.0016)).add(vBank.y);
        const lie = u.noise(vec2(along, vBank.y.mul(3.1).add(0.27)));
        const top = lie.r.mul(0.75).add(0.2);
        const body = smoothstep(top, top.mul(0.2), st.y).mul(smoothstep(0.0, 0.05, st.y));
        const thick = smoothstep(0.22, 0.75, lie.a).mul(0.7).add(0.3);
        // (It thins to nothing at the card's ends, far outside the frame.)
        const ends = smoothstep(0.0, 0.08, st.x).mul(smoothstep(1.0, 0.92, st.x));
        const a = body.mul(thick).mul(ends).mul(vBank.z).mul(float(1.0).sub(exp(u.weather.z.mul(-1.3))))
            .mul(0.9);
        return vec4(vLight.mul(a), a);
    })();
    const part = wPart('WinterLakeMist', geometry, material, 33);
    part.count = banks.length;
    return part;
}
