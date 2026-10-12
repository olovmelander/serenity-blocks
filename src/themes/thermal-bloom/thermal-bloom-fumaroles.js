/**
 * Thermal Bloom — the fumaroles (iris-springs.md §1.4): small vents across the apron that chuff
 * sharp white puffs of steam on their own hashed clocks, and the Sleeper's faint resting wisp
 * (a large vent that never chuffs).
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    attribute,
    clamp,
    dot,
    exp,
    float,
    fract,
    length,
    max,
    mix,
    normalize,
    positionGeometry,
    positionWorld,
    smoothstep,
    step,
    texture,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    tbAerial,
    tbFxMaterial,
    tbPart,
} from './thermal-bloom-tsl.js';

/** A fumarole's card (metres: half its width, its height); its chuff's launch speed and drag. */
const FUM_HALF = 12;
const FUM_TALL = 26;
const CHUFF_V0 = 12;
const CHUFF_TAU = 0.9;

/**
 * The fumaroles: `count` small vents on the apron (one camera-facing card each, one call), each
 * chuffing a sharp white puff on its own closed-form clock — launched as a narrow jet, slowed by
 * the air, spreading, thinning and drifting downwind — with a faint wisp leaning off the vent
 * between chuffs. The world writes each vent's (x, z, period, phase) with `part.setVents(vents)`.
 * @param {object} u     the shared uniforms
 * @param {number} count the vents
 * @param {object} tex   the world's baked textures (the noise atlas)
 */
export function createFumaroles(u, count, tex) {
    const n = Math.max(1, count);
    const positions = new Float32Array(n * 4 * 3);
    const vents = new Float32Array(n * 4 * 4);
    const index = new Uint32Array(n * 6);
    for (let i = 0; i < n; i++) {
        [[-1, 0], [1, 0], [1, 1], [-1, 1]].forEach(([x, y], c) => {
            positions.set([x, y, 0], (i * 4 + c) * 3);
        });
        index.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const ventAttr = new THREE.BufferAttribute(vents, 4);
    geometry.setAttribute('aVent', ventAttr);
    const shape = new Float32Array(n * 4 * 3);
    const shapeAttr = new THREE.BufferAttribute(shape, 3);
    geometry.setAttribute('aShape', shapeAttr);
    geometry.setIndex(new THREE.BufferAttribute(index, 1));

    const aVent = attribute('aVent', 'vec4');
    // (base height, scale, chuffs): a resting wisp (the Sleeper's) is a large vent that never chuffs.
    const aShape = attribute('aShape', 'vec3');
    const vShape = varying(aShape, 'vFumShape');
    // The card's right axis (world xz), turned about the vent to face the camera.
    const toCamXZ = normalize(u.camPos.xz.sub(aVent.xy).add(vec2(1e-3, 0.0)));
    const right = vec2(toCamXZ.y.negate(), toCamXZ.x);
    // The wind across the card (m/s along its right axis), and the sun's side of it.
    const vWind = varying(dot(u.windDir, right).mul(u.windSpeed), 'vFumWind');
    const vSun = varying(dot(u.sunDir.xz, right), 'vFumSun');
    const vLocal = varying(positionGeometry.xy, 'vFumLocal');
    const vVent = varying(aVent, 'vFumVent');
    /** The card's centre sits downwind of the vent, where the puffs drift. */
    const shiftOf = (wind) => wind.mul(1.6);

    const material = tbFxMaterial('ThermalBloomFumaroles');
    material.positionNode = Fn(() => {
        const live = step(0.5, aVent.z);
        const across = positionGeometry.x.mul(FUM_HALF).add(shiftOf(dot(u.windDir, right).mul(u.windSpeed)))
            .mul(aShape.y);
        const xz = aVent.xy.add(right.mul(across));
        const y = positionGeometry.y.mul(FUM_TALL).mul(aShape.y).add(aShape.x);
        return mix(vec3(0.0, -1e5, 0.0), vec3(xz.x, y, xz.y), live);
    })();
    const fumFn = Fn(() => {
        const x = vLocal.x.mul(FUM_HALF).add(shiftOf(vWind)).toVar();
        const y = vLocal.y.mul(FUM_TALL).toVar();
        const seed = vVent.w;
        const age = fract(u.time.div(vVent.z).add(seed)).mul(vVent.z).toVar();
        // The chuff: launched at CHUFF_V0, slowed by the air, spreading and thinning as it rises.
        const yc = float(CHUFF_V0 * CHUFF_TAU).mul(float(1.0).sub(exp(age.div(-CHUFF_TAU))));
        const xc = vWind.mul(age).mul(0.7);
        const R = float(0.7).add(float(4.6).mul(float(1.0).sub(exp(age.div(-1.3)))));
        const fade = smoothstep(0.0, 0.1, age).mul(exp(age.div(-1.5)));
        const q = vec2(x.sub(xc), y.sub(yc)).div(R).toVar();
        const billow = texture(tex.noise, q.mul(0.16).add(vec2(seed.mul(7.0), age.mul(-0.04)))).x;
        const blob = exp(dot(q, q).mul(-1.5)).mul(billow.mul(1.3).add(0.35)).mul(fade);
        // The jet for the chuff's first moments: a narrow stem from the vent up to the puff.
        const sx = x.sub(xc.mul(clamp(y.div(max(yc, 1.0)), 0.0, 1.0)));
        const sw = y.mul(0.1).add(0.3);
        const stem = exp(sx.div(sw).mul(sx.div(sw)).negate()).mul(step(y, yc)).mul(smoothstep(0.8, 0.1, age));
        // Between chuffs a faint wisp leans downwind off the vent.
        const wx = x.sub(vWind.mul(y).mul(0.3));
        const ww = y.mul(0.16).add(0.45);
        const wispN = texture(tex.noise, vec2(x.div(7.0), y.sub(u.time.mul(1.4)).div(7.0)).add(seed)).y;
        const wisp = exp(wx.div(ww).mul(wx.div(ww)).negate()).mul(exp(y.div(-6.0))).mul(wispN.mul(0.8).add(0.2));
        const chuffs = vShape.z;
        const rho = blob.add(stem.mul(0.8)).mul(chuffs).add(wisp.mul(mix(float(0.4), float(0.22), chuffs)))
            .mul(u.steam.mul(0.4).add(0.6));
        const alpha = clamp(rho.mul(0.85), 0.0, 0.9).mul(smoothstep(0.0, 0.8, y)).toVar();
        alpha.lessThan(0.003).discard();
        // Light: Steam Pearl on the sun's side and top, the sky's blue-grey in its shade.
        const side = clamp(q.x.mul(vSun).mul(0.45).add(q.y.mul(u.sunDir.y).mul(0.4)).add(0.6), 0.0, 1.0);
        const pearl = u.sunColor.mul(0.78).add(mix(u.haze, u.zenith, 0.5).mul(0.12));
        const shade = vec3(0.34, 0.43, 0.56).mul(mix(float(0.85), float(1.0), u.sunColor.y));
        const P = positionWorld;
        const toCam = u.camPos.sub(P);
        const dist = length(toCam);
        const out = tbAerial(u, mix(shade, pearl, side), dist, toCam.div(max(dist, 1e-3)).negate());
        return vec4(out.mul(alpha), alpha);
    });
    material.colorNode = fumFn();
    const part = tbPart('ThermalBloomFumaroles', geometry, material, 59);
    /** Write the vents: [{ x, z, period, phase, base?, scale?, chuff? }] (the rest fold away). */
    part.setVents = (list) => {
        for (let i = 0; i < n; i++) {
            const v = list[i];
            for (let c = 0; c < 4; c++) {
                const o = (i * 4 + c) * 4;
                vents[o] = v ? v.x : 0;
                vents[o + 1] = v ? v.z : 0;
                vents[o + 2] = v ? v.period : 0;
                vents[o + 3] = v ? v.phase : 0;
                shape[(i * 4 + c) * 3] = v ? (v.base ?? 0) : 0;
                shape[(i * 4 + c) * 3 + 1] = v ? (v.scale ?? 1) : 1;
                shape[(i * 4 + c) * 3 + 2] = v && v.chuff === false ? 0 : 1;
            }
        }
        ventAttr.needsUpdate = true;
        shapeAttr.needsUpdate = true;
    };
    part.count = n;
    return part;
}
