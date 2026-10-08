/**
 * Himalayan Peak — snow in the air.
 *
 *  - Spindrift: the wind tears snow off every crest. A third of the sprites stream from the
 *    hero's summit as its banner; the rest smoke along the skylines. Each rides the wind from
 *    its place on the crest in closed form, grows, thins and starts again. What makes them is
 *    the light: a sprite is lit only above the amphitheatre's shadow (the shadow volume), and
 *    seen against the sun it burns — so the headwall's crest smokes gold long before the sun
 *    clears it, and the hero's banner catches fire from its tip downward as the chain grows.
 *  - The avalanche: four lines bring a powder cloud down the hero's east face along the baked
 *    ground's own fall line.
 *
 * Both live in the amphitheatre's (squeezed) space and build their own clip positions.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    attribute,
    cameraPosition,
    clamp,
    dot,
    float,
    floor,
    fract,
    length,
    max,
    mix,
    normalize,
    positionGeometry,
    sin,
    smoothstep,
    step,
    uniformArray,
    uv,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { AVALANCHE_RUN, mulberry32 } from './himalayan-peak-core.js';
import { avalancheTrack, crestEmitters } from './himalayan-peak-layout.js';
import {
    hpAirLight, hpClip, hpFxMaterial, hpPart, hpPow4, hpQuadGeometry,
} from './himalayan-peak-tsl.js';

/** The wind's heading over the crests (unit): from the west, lifting, a little to the north. */
const ALOFT = new THREE.Vector3(1, 0.12, -0.22).normalize();

/** A soft, torn puff: `shape` = (random offset xy, _, _). Returns coverage 0..1. */
const puff = (u, shape) => {
    const q = uv().sub(0.5).mul(2.0);
    const d = length(q);
    const disc = smoothstep(1.0, 0.15, d);
    const torn = u.noise(uv().mul(0.55).add(shape.xy.mul(3.7))).x;
    return disc.mul(smoothstep(0.24, 0.8, torn.add(disc.mul(0.4))).mul(0.8).add(0.2));
};

/**
 * A sprite's corner in clip space: a billboard `metres` across at design-space point `p`,
 * `drawn` times as long as it is tall (the wind draws snow out along itself).
 */
const billboard = (u, p, metres, drawn = 1) => {
    const clip = hpClip(u, p);
    const half = u.viewport.mul(0.5);
    const px = metres.mul(u.pxScale).div(max(clip.w, 1.0));
    const offset = positionGeometry.xy.mul(px).mul(vec2(u.squeeze.mul(drawn), 1 / Math.sqrt(drawn)));
    return vec4(clip.xy.add(offset.div(half).mul(clip.w)), clip.z, clip.w);
};

/** What snow in the air looks like at `p`: lit above the shadow, burning against the sun. */
const snowLight = (u, p, soft) => {
    const eye = vec3(cameraPosition.x.div(u.squeeze), cameraPosition.y, cameraPosition.z);
    const toward = normalize(p.sub(eye));
    const lit = hpAirLight(u, p, soft);
    const forward = hpPow4(max(dot(toward, u.sunDir), 0.0));
    // In shadow it is the colour of the whole sky, not only of its blue: a powder cloud that
    // goes cobalt under the wall reads as paint, not snow.
    return u.sunCol.mul(lit.mul(forward.mul(2.6).add(0.42)))
        .add(u.shade.mul(0.5)).add(u.horizon.mul(0.42)).add(u.zenith.mul(0.2))
        .mul(u.breath.mul(0.85).add(0.15));
};

/**
 * @param {object} u
 * @param {object} field
 * @param {number} count
 */
export function createSpindrift(u, field, count) {
    const emitters = crestEmitters(field, count);
    const n = emitters.length;
    const aEmit = new Float32Array(n * 4);
    const aSeed = new Float32Array(n * 4);
    const rand = mulberry32(0x5d21);
    for (let i = 0; i < n; i++) {
        const e = emitters[i];
        aEmit.set([e[0], e[1], e[2], e[3]], i * 4);
        aSeed.set([rand(), rand(), rand(), e[4]], i * 4);
    }
    const geometry = hpQuadGeometry(n, { aEmit: [aEmit, 4], aSeed: [aSeed, 4] });
    const emit = attribute('aEmit', 'vec4');
    const seed = attribute('aSeed', 'vec4');
    const banner = seed.w;

    const material = hpFxMaterial('HimalayanPeakSpindrift');
    const life = mix(float(10.0), float(17.0), seed.x).mul(banner.mul(0.5).add(1.0));
    const age = fract(u.time.div(life).add(seed.x.mul(7.31)).add(seed.y.mul(3.17)));
    const reach = mix(float(240.0), float(560.0), seed.y).mul(u.gale.mul(0.9).add(0.45)).mul(banner.mul(3.4).add(1.0));
    const run = age.pow(0.8);
    const wind = vec3(ALOFT.x, ALOFT.y, ALOFT.z);
    const rise = age.mul(banner.mul(50.0).add(30.0)).add(sin(age.mul(7.0).add(seed.x.mul(30.0))).mul(10.0).mul(age));
    const p = emit.xyz
        .add(wind.mul(reach.mul(run)))
        .add(vec3(0.0, 1.0, 0.0).mul(rise))
        .add(vec3(0.0, 0.0, 1.0).mul(seed.z.sub(0.5).mul(reach).mul(banner.mul(-0.1).add(0.22)).mul(age)));
    const metres = mix(float(26.0), float(64.0), seed.y).mul(age.mul(2.3).add(0.85)).mul(banner.mul(0.9).add(1.0));
    material.vertexNode = billboard(u, p, metres, 2.3);
    const thin = float(1.0).sub(age);
    // (It gathers before it shows: a sprite that pops in at full strength reads as a dot.)
    const cover = emit.w.mul(smoothstep(0.0, 0.22, age)).mul(thin.mul(thin)).mul(u.gale.mul(0.8).add(0.22));
    const vLight = varying(vec4(snowLight(u, p, 120), clamp(cover, 0.0, 1.0)), 'hpDriftLight');
    const vShape = varying(seed.xyz, 'hpDriftShape');
    material.colorNode = Fn(() => {
        const a = puff(u, vShape).mul(vLight.a);
        return vec4(vLight.rgb.mul(a).mul(0.8), a.mul(0.42));
    })();
    const part = hpPart('HimalayanPeakSpindrift', geometry, material, 36);
    part.count = n;
    return part;
}

/** Points the avalanche's track is handed to the shader as. */
const TRACK_POINTS = 24;

/**
 * @param {object} u       `avalanche` = (birth time, strength)
 * @param {object} field
 * @param {number} count
 */
export function createAvalanche(u, field, count) {
    const raw = avalancheTrack(field);
    const total = raw[raw.length - 1][3] || 1;
    const points = [];
    for (let i = 0; i < TRACK_POINTS; i++) {
        const want = (i / (TRACK_POINTS - 1)) * total;
        let k = 0;
        while (k < raw.length - 2 && raw[k + 1][3] < want) k += 1;
        const t = (want - raw[k][3]) / Math.max(1e-6, raw[k + 1][3] - raw[k][3]);
        points.push(new THREE.Vector3(
            raw[k][0] + (raw[k + 1][0] - raw[k][0]) * t,
            raw[k][1] + (raw[k + 1][1] - raw[k][1]) * t,
            raw[k][2] + (raw[k + 1][2] - raw[k][2]) * t,
        ));
    }
    const track = uniformArray(points);
    const aSeed = new Float32Array(count * 4);
    const rand = mulberry32(0xa7a1);
    for (let i = 0; i < count * 4; i++) aSeed[i] = rand();
    const geometry = hpQuadGeometry(count, { aSeed: [aSeed, 4] });
    const seed = attribute('aSeed', 'vec4');

    const material = hpFxMaterial('HimalayanPeakAvalanche');
    const tau = u.time.sub(u.avalanche.x);
    const live = step(0.0, tau).mul(step(tau, AVALANCHE_RUN * 2.2));
    // The front runs out fast and dies on the cloud.
    const out = float(1.0).sub(clamp(tau.div(AVALANCHE_RUN), 0.0, 1.0));
    const front = float(1.0).sub(out.mul(out).mul(out.sqrt()));
    const s = front.mul(float(1.0).sub(seed.x.mul(0.62))).mul(TRACK_POINTS - 1);
    const i0 = clamp(floor(s), 0.0, TRACK_POINTS - 2);
    const base = mix(track.element(i0.toInt()), track.element(i0.add(1.0).toInt()), s.sub(i0));
    const grown = smoothstep(0.0, 1.0, tau.mul(0.55).sub(seed.x.mul(0.9)));
    // The cloud boils up and OUT from the wall (the east face looks along +x), and that is the
    // way the eye sees it grow; along the wall it only spreads.
    const billow = float(14.0).add(seed.y.mul(210.0).mul(grown)).mul(front.add(0.4));
    const wide = seed.z.sub(0.5).mul(front.mul(300.0).add(60.0));
    const churn = sin(u.time.mul(1.3).add(seed.w.mul(40.0))).mul(16.0).mul(grown);
    const p = base.add(vec3(billow.mul(0.95).add(churn), billow.mul(0.55), wide));
    const metres = float(70.0).add(seed.w.mul(250.0)).mul(grown.mul(0.8).add(0.35).add(front.mul(0.7)));
    material.vertexNode = billboard(u, p, metres.mul(live));
    const cover = u.avalanche.y.mul(grown).mul(float(1.0).sub(smoothstep(AVALANCHE_RUN * 0.85, AVALANCHE_RUN * 1.9, tau)))
        .mul(live).mul(0.7);
    // (Some of it hangs in front of the rest: lighter and darker billows give the cloud a body.)
    const vLight = varying(vec4(snowLight(u, p, 140).mul(seed.y.mul(0.7).add(0.75)), cover), 'hpPowderLight');
    const vShape = varying(seed.xyz, 'hpPowderShape');
    material.colorNode = Fn(() => {
        const a = puff(u, vShape).mul(vLight.a);
        return vec4(vLight.rgb.mul(a), a.mul(0.85));
    })();
    const part = hpPart('HimalayanPeakAvalanche', geometry, material, 38);
    part.count = count;
    part.track = raw;
    return part;
}

export { ALOFT };
