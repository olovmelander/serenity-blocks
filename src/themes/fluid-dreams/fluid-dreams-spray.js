/**
 * Fluid Dreams — the liquid that is too fine for the distance field: spray and motes.
 *
 *  - Spray: droplets thrown by a splash, a crown, a drip, or poured out of the card by a cleared
 *    row. Each is a closed-form ballistic point drawn as a short streak along its own motion; it
 *    is gone the moment it meets the sea. A ring of preallocated slots.
 *  - Motes: the fine mist the sea gives up, rising slowly through the picture like rain in
 *    reverse. Static seeds, animated in the vertex stage.
 *
 * Nothing is created at event time and both pools are always drawn (dormant slots collapse to
 * zero size), so the first frame compiles every pipeline.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    attribute,
    cameraProjectionMatrix,
    cameraViewMatrix,
    clamp,
    exp,
    float,
    length,
    max,
    mix,
    mod,
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
import { TAU, mulberry32 } from './fluid-dreams-core.js';

const GRAVITY = 9.8;
/** Seconds of its own motion a droplet is smeared along. */
const SHUTTER = 0.028;

const viewProjection = (world) => cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(world, 1.0));

/** Additive, premultiplied: a fragment adds its light and leaves the target's alpha alone. */
function fxMaterial(name) {
    const m = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
    });
    m.name = name;
    m.fog = false;
    m.blending = THREE.CustomBlending;
    m.blendSrc = THREE.OneFactor;
    m.blendDst = THREE.OneMinusSrcAlphaFactor;
    m.blendSrcAlpha = THREE.OneFactor;
    m.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
    m.forceSinglePass = true;
    return m;
}

function quadGeometry(count, attributes) {
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
        -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
    ], 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    Object.keys(attributes).forEach((name) => {
        geometry.setAttribute(name, new THREE.InstancedBufferAttribute(attributes[name], 4));
    });
    geometry.instanceCount = count;
    return geometry;
}

function part(name, geometry, material, renderOrder) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = renderOrder;
    return { mesh, material, geometry };
}

/** Height of a droplet `tau` seconds after it leaves `y0` at `vy`. CPU twin of the shader. */
export function sprayHeight(y0, vy, tau) {
    return y0 + vy * tau - 0.5 * GRAVITY * tau * tau;
}

/**
 * How a burst of each kind is thrown. `n` droplets per unit of power; speeds in m/s; `out` is
 * the horizontal speed range, `up` the vertical one, `ring` a radius the burst starts on.
 */
export const SPRAY_KINDS = Object.freeze({
    splash: {
        n: 12, out: [0.6, 3.4], up: [2.2, 6.2], life: [0.5, 1.2], size: 0.05, ring: 0.15, gain: 3.2,
    },
    drip: {
        n: 8, out: [0.3, 1.6], up: [1.2, 3.2], life: [0.4, 0.8], size: 0.035, ring: 0.05, gain: 2.2,
    },
    crown: {
        n: 46, out: [1.5, 7.5], up: [5.5, 14.5], life: [1.2, 2.9], size: 0.085, ring: 1.0, gain: 4.2,
    },
    pour: {
        n: 13, out: [2.8, 8.5], up: [0.4, 3.6], life: [0.7, 1.6], size: 0.055, ring: 0.0, gain: 3.4,
    },
    rain: {
        n: 5, out: [0.0, 1.6], up: [-9.0, -3.5], life: [1.6, 2.6], size: 0.05, ring: 15, gain: 2.4, disc: true,
    },
    trail: {
        n: 3, out: [0.1, 0.9], up: [-0.4, 1.2], life: [0.45, 0.95], size: 0.09, ring: 0.1, gain: 4.6,
    },
});

/**
 * @param {object} u  shared uniforms (time, viewport)
 * @param {number} count  pool size
 */
export function createSpray(u, count) {
    const aBirth = new Float32Array(count * 4);
    const aVel = new Float32Array(count * 4);
    const aTint = new Float32Array(count * 4);
    for (let i = 0; i < count; i += 1) aBirth[i * 4 + 3] = -100;
    const geometry = quadGeometry(count, { aBirth, aVel, aTint });
    ['aBirth', 'aVel', 'aTint'].forEach((name) => geometry.getAttribute(name).setUsage(THREE.DynamicDrawUsage));
    const birth = attribute('aBirth', 'vec4');
    const vel = attribute('aVel', 'vec4');
    const tint = attribute('aTint', 'vec4');

    const material = fxMaterial('Fluid Dreams — spray');
    const tau = u.time.sub(birth.w);
    const span = vel.w;
    const at = (t) => vec3(
        birth.x.add(vel.x.mul(t)),
        birth.y.add(vel.y.mul(t)).sub(t.mul(t).mul(GRAVITY * 0.5)),
        birth.z.add(vel.z.mul(t)),
    );
    const t = max(tau, 0.0);
    const p1 = at(t);
    const p0 = at(max(t.sub(SHUTTER), 0.0));
    // gone when its time is up, or when it meets the sea
    const alive = step(0.0, tau).mul(step(tau, span)).mul(step(0.0, p1.y));
    const along = positionGeometry.x.add(0.5);
    const c0 = viewProjection(p0);
    const c1 = viewProjection(p1);
    const half = u.viewport.mul(0.5);
    const s0 = c0.xy.div(max(c0.w, 0.05)).mul(half);
    const s1 = c1.xy.div(max(c1.w, 0.05)).mul(half);
    const dir = normalize(s1.sub(s0).add(vec2(1e-4, 0.0)));
    const nrm = vec2(dir.y.negate(), dir.x);
    const clip = mix(c0, c1, along);
    const pxPerMetre = u.viewport.y.mul(1.05).div(max(clip.w, 0.3));
    const widthPx = clamp(tint.w.mul(pxPerMetre), u.viewport.y.mul(0.0016), u.viewport.y.mul(0.012)).mul(alive);
    const lead = dir.mul(along.sub(0.5).mul(2.0)).mul(widthPx);
    material.vertexNode = vec4(
        clip.xy.add(nrm.mul(positionGeometry.y.mul(2.0).mul(widthPx)).add(lead).div(half).mul(clip.w)),
        clip.z,
        clip.w,
    );
    const ageK = clamp(t.div(max(span, 0.01)), 0.0, 1.0);
    const fade = float(1.0).sub(ageK.mul(ageK));
    // a droplet catches the light as it turns over
    const turn = sin(t.mul(tint.w.mul(160.0).add(11.0)).add(birth.x.mul(13.0))).mul(0.3).add(0.7);
    const hot = mix(vec3(1.0), tint.rgb, smoothstep(0.0, 0.22, ageK).mul(0.75).add(0.25));
    const vLight = varying(hot.mul(fade).mul(turn).mul(alive), 'fdSpray');
    material.colorNode = Fn(() => {
        const st = uv();
        const across = float(1.0).sub(st.y.sub(0.5).abs().mul(2.0));
        const head = smoothstep(0.0, 0.85, st.x);
        return vec4(vLight.mul(across.mul(across)).mul(head).mul(u.sprayGain), 0.0);
    })();

    const spray = part('FluidDreamsSpray', geometry, material, 30);
    let cursor = 0;
    let bursts = 0;
    /**
     * Throw one burst at `time`.
     * @param {object} burst
     * @param {'splash'|'drip'|'crown'|'pour'|'trail'|'rain'} burst.kind
     * @param {number[]} [burst.dir] 'pour' only: the horizontal direction (x, z) the row empties in
     */
    spray.emit = ({
        kind, x, y, z, color, power = 1, time, dir: aim = null,
    }) => {
        const spec = SPRAY_KINDS[kind] || SPRAY_KINDS.splash;
        const rand = mulberry32(0x51a7 + bursts * 7919);
        bursts += 1;
        const total = Math.min(count, Math.round(spec.n * Math.max(0.4, power)));
        const scale = kind === 'crown' ? 1 : Math.sqrt(Math.max(0.3, power));
        for (let k = 0; k < total; k += 1) {
            const i = cursor % count;
            cursor += 1;
            let a = rand() * TAU;
            if (aim) a = Math.atan2(aim[0], aim[1]) + (rand() - 0.5) * 0.9;
            const speed = (spec.out[0] + (spec.out[1] - spec.out[0]) * rand() ** 1.6) * scale;
            const rise = (spec.up[0] + (spec.up[1] - spec.up[0]) * rand()) * scale;
            // a ring the burst starts on, or (rain) anywhere inside it
            const ring = spec.ring * (kind === 'crown' ? power : 1) * (spec.disc ? Math.sqrt(rand()) : 1);
            const b = spec.disc ? rand() * TAU : a;
            aBirth.set([x + Math.sin(b) * ring, y, z + Math.cos(b) * ring, time + rand() * 0.06], i * 4);
            const life = spec.life[0] + (spec.life[1] - spec.life[0]) * rand();
            aVel.set([Math.sin(a) * speed, rise, Math.cos(a) * speed, life], i * 4);
            const g = (0.65 + rand() * 0.7) * spec.gain;
            aTint.set([color[0] * g, color[1] * g, color[2] * g, spec.size * (0.55 + rand() * 0.9)], i * 4);
        }
        geometry.getAttribute('aBirth').needsUpdate = true;
        geometry.getAttribute('aVel').needsUpdate = true;
        geometry.getAttribute('aTint').needsUpdate = true;
    };
    spray.reset = () => {
        for (let i = 0; i < count; i += 1) aBirth[i * 4 + 3] = -100;
        geometry.getAttribute('aBirth').needsUpdate = true;
        cursor = 0;
        bursts = 0;
    };
    spray.count = count;
    return spray;
}

/** The volume the motes live in (metres, camera at the origin looking down −Z). */
export const MOTE_BOX = Object.freeze({
    halfWidth: 34, height: 19, near: -5, far: -58,
});

/**
 * @param {object} u  shared uniforms (time, viewport, palette, charge)
 * @param {number} count
 */
export function createMotes(u, count) {
    const n = Math.max(1, count);
    const aSeed = new Float32Array(n * 4);
    const aKind = new Float32Array(n * 4);
    const rand = mulberry32(0xf1d5);
    for (let i = 0; i < n; i += 1) {
        aSeed.set([
            (rand() * 2 - 1) * MOTE_BOX.halfWidth,
            rand() * MOTE_BOX.height,
            MOTE_BOX.near + (MOTE_BOX.far - MOTE_BOX.near) * rand() ** 0.8,
            rand() * TAU,
        ], i * 4);
        aKind.set([0.05 + rand() ** 3 * 0.34, rand(), 0.12 + rand() * 0.42, 0.6 + rand() * 2.4], i * 4);
    }
    const geometry = quadGeometry(count > 0 ? n : 0, { aSeed, aKind });
    const seed = attribute('aSeed', 'vec4');
    const kind = attribute('aKind', 'vec4');

    const material = fxMaterial('Fluid Dreams — motes');
    const rise = kind.z.mul(u.charge.mul(1.6).add(1.0));
    const y = mod(seed.y.add(u.time.mul(rise)), MOTE_BOX.height);
    const world = vec3(
        seed.x.add(sin(u.time.mul(0.21).add(seed.w)).mul(0.7)),
        y,
        seed.z.add(sin(u.time.mul(0.17).add(seed.w.mul(1.7))).mul(0.7)),
    );
    const clip = viewProjection(world);
    const half = u.viewport.mul(0.5);
    const pxPerMetre = u.viewport.y.mul(1.05).div(max(clip.w, 0.3));
    const px = clamp(kind.x.mul(pxPerMetre), u.viewport.y.mul(0.0016), u.viewport.y.mul(0.03));
    material.vertexNode = vec4(clip.xy.add(positionGeometry.xy.mul(px.mul(2.0)).div(half).mul(clip.w)), clip.z, clip.w);
    const edge = smoothstep(0.0, 1.4, y).mul(float(1.0).sub(smoothstep(MOTE_BOX.height - 4, MOTE_BOX.height, y)));
    const twinkle = sin(u.time.mul(kind.w).add(seed.w.mul(7.0))).mul(0.5).add(0.5);
    const hue = mix(mix(u.inkA, u.inkB, smoothstep(0.2, 0.8, kind.y)), u.sun, smoothstep(0.82, 1.0, kind.y));
    const vLight = varying(
        mix(hue, vec3(1.0), 0.3).mul(edge).mul(twinkle.mul(twinkle).mul(0.9).add(0.12))
            .mul(u.charge.mul(1.5).add(1.0).add(u.surge))
            .mul(float(1.0).div(px.div(u.viewport.y.mul(0.004)).add(1.0)).mul(1.6)),
        'fdMote',
    );
    material.colorNode = Fn(() => {
        const q = uv().sub(0.5).mul(2.0);
        const d = length(q);
        const core = exp(d.mul(d).mul(-7.0)).add(exp(d.mul(-4.0)).mul(0.18));
        return vec4(vLight.mul(core).mul(smoothstep(1.0, 0.7, d)).mul(u.moteGain), 0.0);
    })();

    const motes = part('FluidDreamsMotes', geometry, material, 20);
    motes.count = count;
    return motes;
}
