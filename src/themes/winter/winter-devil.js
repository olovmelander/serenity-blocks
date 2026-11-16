/**
 * Winter — the snow devil a twist raises.
 *
 * The wind turns on itself: a whirl of spindrift stands up from the snow beside the board, a
 * leaning funnel a few metres tall that wanders off across the snowfield and is gone in a few
 * seconds. It is one pool of soft sprites wound round an axis: each climbs the funnel at its own
 * pace and comes round again from the foot, turning faster low down where the funnel is narrow,
 * so the whole reads as a turning column and not as a cloud. All of it is closed form in the time
 * since the twist, and with no twist the pool collapses to nothing.
 *
 * It is lit as the snow in the air is (the moon, the sky's shade, the last light) with the
 * piece's colour struck into its heart.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    attribute,
    clamp,
    cos,
    exp,
    float,
    fract,
    length,
    max,
    mix,
    positionGeometry,
    pow,
    sin,
    smoothstep,
    step,
    uniform,
    uv,
    varying,
    vec3,
    vec4,
} from 'three/tsl';
import {
    TAU, mulberry32, wClip, wFxMaterial, wPart, wQuadGeometry,
} from './winter-tsl.js';

/** Seconds a snow devil stands, and how tall and how wide (at its top) it is at full strength. */
export const DEVIL_LASTS = 4.6;
export const DEVIL_HEIGHT = 5.2;
export const DEVIL_RADIUS = 1.25;

/**
 * Where the funnel's axis is at height share `h` (0 its foot .. 1 its top) `tau` seconds in:
 * [x, y, z] from where it rose. It walks along `walk` and leans with the wind as it climbs.
 * CPU twin of the shader.
 */
export function devilAxis(h, tau, walk, out = [0, 0, 0]) {
    const t = Math.max(0, tau);
    out[0] = walk[0] * t + (0.9 * h * h + 0.25 * Math.sin(t * 1.7 + h * 3.1) * h);
    out[1] = h * DEVIL_HEIGHT;
    out[2] = walk[1] * t + 0.3 * Math.sin(t * 1.3 + h * 2.4) * h;
    return out;
}

/**
 * @param {object} u
 * @param {number} count  sprites in the funnel
 */
export function createDevil(u, count) {
    const aSeed = new Float32Array(count * 4);
    const rand = mulberry32(0xde71);
    for (let i = 0; i < count * 4; i++) aSeed[i] = rand();
    const geometry = wQuadGeometry(count, { aSeed: [aSeed, 4] });
    const seed = attribute('aSeed', 'vec4');
    const uniforms = {
        /** (x, z where it rose, birth time, strength) */
        at: uniform(new THREE.Vector4(0, -10, -100, 0)),
        /** (walk x, walk z in m/s, ground y, which way it turns: ±1) */
        go: uniform(new THREE.Vector4(1, 0, 0, 1)),
        color: uniform(new THREE.Vector3(0.6, 0.8, 1)),
    };
    const material = wFxMaterial('WinterSnowDevil');
    const tau = u.time.sub(uniforms.at.z);
    const t = max(tau, 0.0);
    const env = smoothstep(0.0, 0.5, t).mul(float(1.0).sub(smoothstep(DEVIL_LASTS * 0.62, DEVIL_LASTS, t)))
        .mul(step(0.0, tau)).mul(step(tau, DEVIL_LASTS))
        .mul(clamp(uniforms.at.w, 0.0, 1.5));
    // Each sprite climbs at its own pace and comes round again from the foot.
    const h = fract(seed.x.add(t.mul(seed.w.mul(0.22).add(0.2))));
    const turn = seed.y.mul(TAU).add(t.mul(mix(float(7.5), float(3.2), h)).mul(uniforms.go.w));
    const grown = smoothstep(0.0, 0.9, t);
    const radius = pow(h, 0.65).mul(0.85).add(0.14).mul(DEVIL_RADIUS)
        .mul(seed.z.mul(0.5).add(0.72))
        .mul(grown.mul(0.6).add(0.4));
    const axis = vec3(
        uniforms.go.x.mul(t).add(h.mul(h).mul(0.9)).add(sin(t.mul(1.7).add(h.mul(3.1))).mul(0.25).mul(h)),
        h.mul(DEVIL_HEIGHT).mul(grown.mul(0.7).add(0.3)),
        uniforms.go.y.mul(t).add(sin(t.mul(1.3).add(h.mul(2.4))).mul(0.3).mul(h)),
    );
    const world = vec3(uniforms.at.x, uniforms.go.z.add(0.1), uniforms.at.y).add(axis)
        .add(vec3(cos(turn).mul(radius), sin(turn.mul(2.0).add(seed.z.mul(9.0))).mul(0.12), sin(turn).mul(radius)));
    const clip = wClip(world);
    const metres = h.mul(0.5).add(0.2).mul(seed.w.mul(0.6).add(0.7));
    const px = clamp(u.pxScale.mul(metres).div(max(clip.w, 0.4)), 2.0, u.viewport.y.mul(0.085));
    const half = u.viewport.mul(0.5);
    const corner = positionGeometry.xy.mul(px.mul(2.0)).div(half).mul(clip.w).mul(step(0.002, env));
    material.vertexNode = vec4(clip.xy.add(corner), clip.z, clip.w);
    // Thick at the foot, thinning out at the top where the wind takes it; the near side of the
    // whirl is brighter than the far one, which is what makes it read as turning.
    const nearSide = sin(turn).mul(0.5).add(0.5);
    const body = float(1.0).sub(smoothstep(0.7, 1.0, h)).mul(smoothstep(0.0, 0.06, h)).mul(h.mul(-0.5).add(1.0));
    const vLook = varying(vec3(env.mul(body), nearSide, h), 'wDevilLook');
    material.colorNode = Fn(() => {
        const q = uv().sub(0.5).mul(2.0);
        const d = length(q);
        const puff = smoothstep(1.0, 0.1, d);
        const a = puff.mul(puff).mul(vLook.x).mul(vLook.y.mul(0.3).add(0.14));
        const lit = u.moonCol.mul(vLook.y.mul(0.75).add(0.2)).add(u.shade.mul(1.2)).add(u.glow.mul(0.2))
            // The piece's colour, strongest low in the funnel where the twist struck.
            .add(uniforms.color.mul(exp(vLook.z.mul(-2.2)).mul(1.5).add(0.25)));
        return vec4(lit.mul(a).mul(u.breath.mul(0.85).add(0.15)), a);
    })();
    const part = wPart('WinterSnowDevil', geometry, material, 44);
    part.uniforms = uniforms;
    /**
     * Raise one at (x, z) on ground `y`, at `time`: it walks off along (wx, wz) m/s.
     * @param {object} o
     */
    part.raise = ({
        x, z, y = 0, time, strength = 1, walk = [1, 0], rgb = [0.6, 0.8, 1], hand = 1,
    }) => {
        uniforms.at.value.set(x, z, time, strength);
        uniforms.go.value.set(walk[0], walk[1], y, hand < 0 ? -1 : 1);
        uniforms.color.value.set(rgb[0], rgb[1], rgb[2]);
    };
    part.reset = () => {
        uniforms.at.value.set(0, -10, -100, 0);
    };
    part.count = count;
    return part;
}
