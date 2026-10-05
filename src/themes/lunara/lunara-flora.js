/**
 * Lunara — the small lights of the valley.
 *
 *  - Lantern flowers: drifts of them on the damp ground above the water — a thread of a stem
 *    and a bulb of the bed's light, each one a single quad drawn in its fragment shader. They
 *    sway, they breathe, and they flare as a ring or a clear passes over their roots.
 *  - Motes: spores of light that rise through the air over the flats. Closed form: a mote's
 *    place is a function of the clock, the valley's lift and its seed, so nothing is simulated
 *    and both backends draw the same thing.
 */

import {
    Fn,
    attribute,
    cameraPosition,
    cameraProjectionMatrix,
    cameraViewMatrix,
    clamp,
    cos,
    cross,
    exp,
    float,
    fract,
    length,
    max,
    mix,
    normalize,
    positionGeometry,
    sin,
    smoothstep,
    step,
    uv,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    luClearLight, luFogAmount, luFxMaterial, luLockLight, luPart, luQuadGeometry, mulberry32,
} from './lunara-tsl.js';

/** Width of a flower's quad as a fraction of its height. */
const FLOWER_ASPECT = 0.62;

/**
 * @param {object} u
 * @param {object} plan
 * @param {number} count  flowers drawn (the plan's first N)
 */
export function createFlowers(u, plan, count) {
    const n = Math.min(count, plan.flora.length);
    const aRoot = new Float32Array(Math.max(1, n) * 4);
    const aBloom = new Float32Array(Math.max(1, n) * 2);
    for (let i = 0; i < n; i++) {
        const f = plan.flora[i];
        aRoot.set([f.x, f.y, f.z, f.height], i * 4);
        aBloom.set([f.hue, f.seed], i * 2);
    }
    const geometry = luQuadGeometry(n, { aRoot: [aRoot, 4], aBloom: [aBloom, 2] });
    const root = attribute('aRoot', 'vec4');
    const bloom = attribute('aBloom', 'vec2');
    const material = luFxMaterial('LunaraFlowers');

    const height = root.w;
    const along = positionGeometry.y.add(0.5);
    const toCam = normalize(cameraPosition.sub(root.xyz).mul(vec3(1.0, 0.0, 1.0)));
    const right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
    const sway = sin(u.time.mul(0.9).add(bloom.y.mul(11.0))).mul(0.07)
        .add(sin(u.time.mul(0.37).add(bloom.y.mul(5.0))).mul(0.05));
    const world = root.xyz
        .add(vec3(0.0, 1.0, 0.0).mul(along.mul(height)))
        .add(right.mul(positionGeometry.x.mul(FLOWER_ASPECT).add(sway.mul(along).mul(along)).mul(height)));
    material.vertexNode = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(world, 1.0));

    // Light, decided at the root: the bulb's own colour, and whatever passes over the ground.
    const own = mix(
        mix(u.bed, u.auroraLow, step(0.55, bloom.x)),
        u.companionCol.mul(0.8).add(u.glow.mul(0.4)),
        step(0.82, bloom.x),
    );
    const breathe = sin(u.time.mul(1.15).add(bloom.y.mul(17.0))).mul(0.28).add(0.72);
    const clear = luClearLight(u, root.xyz);
    const lit = own.mul(breathe.mul(u.power.mul(1.2).add(1.0)).add(clear.w.mul(1.5))).mul(u.breath)
        .add(luLockLight(u, root.xyz).mul(2.6))
        .add(clear.rgb.mul(2.6));
    const dist = length(cameraPosition.sub(root.xyz));
    const vLight = varying(lit.mul(float(1.0).sub(luFogAmount(dist, root.y).mul(0.9))), 'luFlower');
    const vBend = varying(fract(bloom.y.mul(3.17)).sub(0.5).mul(0.3), 'luFlowerBend');

    material.colorNode = Fn(() => {
        const st = uv();
        const cx = float(0.5).add(vBend.mul(st.y).mul(st.y));
        const dx = st.x.sub(cx).mul(FLOWER_ASPECT);
        const stem = exp(dx.mul(dx).mul(-9000.0)).mul(step(st.y, 0.8)).mul(smoothstep(0.0, 0.08, st.y));
        const head = vec2(st.x.sub(float(0.5).add(vBend.mul(0.64))).mul(FLOWER_ASPECT), st.y.sub(0.82));
        const d = length(head);
        const bulb = exp(d.mul(d).mul(-520.0)).mul(1.6).add(exp(d.mul(-17.0)).mul(0.5));
        return vec4(vLight.mul(bulb.add(stem.mul(0.14))), 0.0);
    })();

    const part = luPart('LunaraFlowers', geometry, material, 12);
    part.count = n;
    return part;
}

/** The box of air the motes live in (metres; the camera stands near its near end). */
export const MOTE_BOX = Object.freeze({
    halfWidth: 70, depth: 130, near: 10, height: 16,
});

/**
 * @param {object} u
 * @param {number} count
 * @param {number} [seed]
 */
export function createMotes(u, count, seed = 0x10ae) {
    const rand = mulberry32(seed);
    const aHome = new Float32Array(Math.max(1, count) * 4);
    for (let i = 0; i < count; i++) {
        // Denser near the middle of the flats, where the eye rests.
        const x = (rand() + rand() - 1) * MOTE_BOX.halfWidth;
        const z = MOTE_BOX.near - rand() ** 1.3 * MOTE_BOX.depth;
        aHome.set([x, rand(), z, rand()], i * 4);
    }
    const geometry = luQuadGeometry(count, { aHome: [aHome, 4] });
    const home = attribute('aHome', 'vec4');
    const material = luFxMaterial('LunaraMotes');

    const s = home.w;
    // Each mote climbs at its own pace and starts over; the valley's lift carries them all.
    const climb = fract(home.y.add(u.moteLift.mul(s.mul(0.03).add(0.018))));
    const wander = vec2(
        sin(u.time.mul(s.mul(0.2).add(0.13)).add(s.mul(41.0))),
        cos(u.time.mul(s.mul(0.17).add(0.11)).add(s.mul(23.0))),
    ).mul(s.mul(1.6).add(0.8));
    const world = vec3(
        home.x.add(wander.x),
        climb.mul(MOTE_BOX.height).add(0.15),
        home.z.add(wander.y),
    );
    const clip = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(world, 1.0));
    const half = u.viewport.mul(0.5);
    const pxPerMetre = u.viewport.y.mul(1.05).div(max(clip.w, 0.3));
    const px = clamp(s.mul(0.05).add(0.03).mul(pxPerMetre), u.viewport.y.mul(0.0016), u.viewport.y.mul(0.012));
    material.vertexNode = vec4(clip.xy.add(positionGeometry.xy.mul(px.mul(2.0)).div(half).mul(clip.w)), clip.z, clip.w);

    const twinkle = sin(u.time.mul(s.mul(2.3).add(0.9)).add(s.mul(77.0))).mul(0.5).add(0.5);
    const life = sin(climb.mul(Math.PI));
    const tone = mix(u.bed, mix(u.glow, u.moonCol, 0.5), step(0.6, fract(s.mul(7.7))));
    const dist = length(cameraPosition.sub(world));
    const gain = twinkle.mul(twinkle).mul(0.9).add(0.12).mul(life)
        .mul(u.power.mul(1.4).add(0.75))
        .mul(float(1.0).sub(luFogAmount(dist, world.y).mul(0.9)))
        .mul(u.breath);
    const vLight = varying(tone.mul(gain), 'luMote');
    material.colorNode = Fn(() => {
        const q = uv().sub(0.5).mul(2.0);
        const d = length(q);
        return vec4(vLight.mul(exp(d.mul(d).mul(-5.5))).mul(smoothstep(1.0, 0.7, d)).mul(1.3), 0.0);
    })();

    const part = luPart('LunaraMotes', geometry, material, 18);
    part.count = count;
    return part;
}
