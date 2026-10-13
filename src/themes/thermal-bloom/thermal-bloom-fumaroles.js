/**
 * Thermal Bloom — the fumaroles (iris-springs.md §1.4): small vents across the apron that chuff
 * sharp white puffs of steam on their own hashed clocks (every 6–15 s each, a chuff showing for
 * about three seconds, so one or two are mid-chuff at any moment), and the Sleeper's faint
 * resting wisp (a large vent that never chuffs). A far vent's chuffs are scaled up with its
 * distance (the plan's `scale`), so every chuff reads at about the same size on screen.
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
    min,
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

/**
 * A fumarole's card (metres at scale 1: half its width, its height); its chuff's launch speed,
 * drag time and buoyant rise, how it grows (2 → 6 m across in about 1.5 s) and how long it shows.
 */
const FUM_HALF = 12;
const FUM_TALL = 22;
const CHUFF_V0 = 11;
const CHUFF_TAU = 0.42;
const CHUFF_RISE = 1.1;
const CHUFF_R0 = 1.0;
const CHUFF_R1 = 3.4;
const CHUFF_GROW = 0.75;
const CHUFF_LIFE = 3.4;

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
        const ownAge = fract(u.time.div(vVent.z).add(seed)).mul(vVent.z);
        // A chain's links 4–5: every vent chuffs at once, in sympathy (§1.5).
        const symAge = u.time.sub(u.sympathyAt);
        const inSym = step(0.0, symAge).mul(step(symAge, CHUFF_LIFE));
        const age = mix(ownAge, min(ownAge, symAge), inSym).toVar();
        // The chuff: shot out fast, braked hard by the air, then rising slowly on its own heat;
        // a compact puff growing from about 2 to 6 m across, drifting downwind.
        const yc = float(CHUFF_V0 * CHUFF_TAU).mul(float(1.0).sub(exp(age.div(-CHUFF_TAU)))).add(age.mul(CHUFF_RISE))
            .add(1.0);
        const xc = vWind.mul(age).mul(0.75);
        const R = float(CHUFF_R0).add(float(CHUFF_R1 - CHUFF_R0).mul(float(1.0).sub(exp(age.div(-CHUFF_GROW)))));
        const fade = smoothstep(0.0, 0.05, age).mul(float(1.0).sub(smoothstep(CHUFF_LIFE * 0.35, CHUFF_LIFE, age)));
        // Taller than wide: a puff rising on its own heat, not a ball.
        const q = vec2(x.sub(xc), y.sub(yc).mul(0.62)).div(R).toVar();
        // A hard-edged, lumpy billow (cauliflower lobes boiling as it grows), thresholded high.
        const b1 = texture(tex.noise, q.mul(0.42).add(vec2(seed.mul(7.0), age.mul(-0.07)))).x;
        const b2 = texture(tex.noise, q.mul(0.95).add(vec2(age.mul(0.05), seed.mul(3.0)))).y;
        const billow = b1.mul(0.6).add(b2.mul(0.4));
        const body = exp(dot(q, q).mul(-1.15)).mul(billow.mul(1.5).add(0.2));
        const thin = smoothstep(0.0, CHUFF_LIFE, age);
        // Soft-edged and translucent (steam, never cotton wool): a wide ramp, thinning as it ages.
        const blob = smoothstep(mix(float(0.18), float(0.35), thin), mix(float(0.75), float(1.1), thin), body)
            .mul(fade).mul(mix(float(0.8), float(0.45), thin));
        // The jet for the chuff's first moments: a narrow stem from the vent up to the puff, then
        // a thin trail left behind it.
        const sx = x.sub(xc.mul(clamp(y.div(max(yc, 1.0)), 0.0, 1.0)));
        const sw = y.mul(0.08).add(0.35);
        const trailN = texture(tex.noise, vec2(x.div(3.0).add(seed), y.div(4.0).sub(age.mul(0.6)))).z;
        const stem = exp(sx.div(sw).mul(sx.div(sw)).negate()).mul(step(y, yc))
            .mul(smoothstep(0.7, 0.05, age).add(smoothstep(0.45, 0.75, trailN).mul(0.35).mul(fade)));
        // Between chuffs a faint wisp leans downwind off the vent.
        const wx = x.sub(vWind.mul(y).mul(0.3));
        const ww = y.mul(0.16).add(0.45);
        const wispN = texture(tex.noise, vec2(x.div(7.0), y.sub(u.time.mul(1.4)).div(7.0)).add(seed)).y;
        const wisp = exp(wx.div(ww).mul(wx.div(ww)).negate()).mul(exp(y.div(-6.0))).mul(wispN.mul(0.8).add(0.2));
        const chuffs = vShape.z;
        const rho = blob.add(stem.mul(0.85)).mul(chuffs).add(wisp.mul(mix(float(0.4), float(0.2), chuffs)))
            .mul(u.steam.mul(0.3).add(0.7));
        const alpha = clamp(rho.mul(0.8), 0.0, 0.62).mul(smoothstep(0.0, 0.6, y)).toVar();
        alpha.lessThan(0.003).discard();
        // Light: bright Steam Pearl on the sun's side and top, the sky's blue-grey in its shade.
        // (a dense puff scatters more of the sun than the pale apron under it: it stands out white,
        // its shade side reading blue-grey against the ground)
        const side = clamp(q.x.mul(vSun).mul(0.55).add(q.y.mul(u.sunDir.y).mul(0.5)).add(0.5), 0.0, 1.0);
        const pearl = u.sunColor.mul(1.05).add(mix(u.haze, u.zenith, 0.5).mul(0.18));
        const shade = vec3(0.42, 0.5, 0.63).mul(mix(float(0.85), float(1.0), u.sunColor.y));
        const P = positionWorld;
        const toCam = u.camPos.sub(P);
        const dist = length(toCam);
        const out = tbAerial(
            u,
            mix(shade, pearl, side.mul(side).mul(float(3.0).sub(side.mul(2.0)))),
            dist,
            toCam.div(max(dist, 1e-3)).negate(),
        );
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
