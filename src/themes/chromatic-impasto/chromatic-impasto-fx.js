/**
 * Chromatic Impasto — what is in the air over the canvas: thrown paint, and dust in the lamp.
 *
 * The canvas lies flat under the eye, as an action painter's does: +z is up, toward the camera.
 * A drop of thrown paint leaves the cloth, rises, and falls back; where it lands the painter lays
 * a dot (the world schedules it from the landing this pool reports). Its whole flight is closed
 * form in the world clock, so nothing is stepped: a pool of instanced quads, always drawn, with
 * dormant slots collapsed to nothing. Every drop throws a shadow on the paint beneath it, which
 * is what tells the eye it is in the air.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    attribute,
    clamp,
    dot,
    float,
    length,
    max,
    min,
    mix,
    normalize,
    positionGeometry,
    reflect,
    sin,
    smoothstep,
    sqrt,
    step,
    uniform,
    uv,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';

import { DROPLET_GRAVITY, TAU, mulberry32 } from './chromatic-impasto-core.js';
import { ciSoftBox } from './chromatic-impasto-tsl.js';

function quadGeometry(count, attributes) {
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
        -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
    ], 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    Object.keys(attributes).forEach((name) => geometry.setAttribute(name, attributes[name]));
    geometry.instanceCount = count;
    return geometry;
}

function fxMaterial(name) {
    const m = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
    });
    m.name = name;
    m.fog = false;
    m.toneMapped = false;
    // Premultiplied "over": a fragment that returns alpha 0 is purely additive.
    m.blending = THREE.CustomBlending;
    m.blendSrc = THREE.OneFactor;
    m.blendDst = THREE.OneMinusSrcAlphaFactor;
    m.blendSrcAlpha = THREE.OneFactor;
    m.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
    m.forceSinglePass = true;
    return m;
}

function part(name, geometry, material, renderOrder) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = renderOrder;
    return { mesh, geometry, material };
}

/** Seconds a drop thrown up at `vz` from height `z0` stays in the air. */
export function flightTime(vz, z0 = 0) {
    return (vz + Math.sqrt(vz * vz + 2 * DROPLET_GRAVITY * Math.max(0, z0))) / DROPLET_GRAVITY;
}

/**
 * Thrown paint.
 *
 * @param {object} u      the studio's uniforms
 * @param {number} count  drops in the air at once
 */
export function createDroplets(u, count) {
    const aStart = new Float32Array(count * 4);
    const aVel = new Float32Array(count * 4);
    const aTint = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) aStart[i * 4 + 3] = -1000;
    const attributes = {
        aStart: new THREE.InstancedBufferAttribute(aStart, 4),
        aVel: new THREE.InstancedBufferAttribute(aVel, 4),
        aTint: new THREE.InstancedBufferAttribute(aTint, 4),
    };
    const geometry = quadGeometry(count, attributes);

    const start = attribute('aStart', 'vec4');
    const vel = attribute('aVel', 'vec4');
    const tint = attribute('aTint', 'vec4');
    const g = DROPLET_GRAVITY;
    const tau = u.time.sub(start.w);
    const span = vel.z.add(sqrt(vel.z.mul(vel.z).add(start.z.mul(2 * g)))).div(g);
    const alive = step(0.0, tau).mul(step(tau, span));
    const t = clamp(tau, 0.0, span);
    const centre = vec3(
        start.x.add(vel.x.mul(t)),
        start.y.add(vel.y.mul(t)),
        max(start.z.add(vel.z.mul(t)).sub(t.mul(t).mul(g * 0.5)), 0.0),
    );
    const pace = length(vel.xy);
    const heading = vel.xy.div(max(pace, 1e-4));
    const across = vec2(heading.y.negate(), heading.x);
    // A drop in flight is drawn out along its path.
    const stretch = float(1.0).add(min(pace.mul(0.75), 1.9));
    const corner = positionGeometry.xy.mul(2.0);
    const extent = vel.w.mul(alive);

    const material = fxMaterial('Chromatic Impasto — thrown paint');
    material.positionNode = vec3(
        centre.xy.add(heading.mul(corner.x.mul(extent).mul(stretch))).add(across.mul(corner.y.mul(extent))),
        centre.z,
    );
    const vHeading = varying(heading, 'ciDropHeading');
    const vStretch = varying(stretch, 'ciDropStretch');
    const vTint = varying(tint, 'ciDropTint');
    material.colorNode = Fn(() => {
        const st = uv().mul(2.0).sub(1.0);
        const r2 = dot(st, st);
        const mask = float(1.0).sub(smoothstep(0.78, 1.0, r2));
        const nz = sqrt(max(float(1.0).sub(r2), 0.0));
        const side = vec2(vHeading.y.negate(), vHeading.x);
        const N = normalize(vec3(vHeading.mul(st.x.div(vStretch)).add(side.mul(st.y)), nz.add(0.05)));
        const V = vec3(0.0, 0.0, 1.0);
        const metal = clamp(vTint.w, 0.0, 1.0);
        const ndl = max(dot(N, u.lightDir), 0.0);
        const diffuse = vTint.rgb.mul(u.keyColor.mul(ndl).add(u.fillColor.mul(N.z.mul(0.5).add(0.5))))
            .mul(float(1.0).sub(metal));
        const R = reflect(V.negate(), N);
        const window = ciSoftBox(R, u.lightDir, vec2(0.62, 0.44), float(0.1), true);
        const cool = ciSoftBox(R, u.rimDir, vec2(0.7, 0.5), float(0.18), false);
        const fres = float(1.0).sub(clamp(N.z, 0.0, 1.0));
        const F0 = mix(vec3(0.05), vTint.rgb, metal);
        const F = F0.add(vec3(1.0).sub(F0).mul(fres.mul(fres).mul(fres)));
        const mirror = u.keyColor.mul(window.mul(u.windowGain)).add(u.rimColor.mul(cool)).add(vec3(0.2).mul(metal));
        return vec4(diffuse.add(mirror.mul(F)).mul(u.exposure).mul(mask), mask);
    })();
    const drops = part('Chromatic Impasto — thrown paint', geometry, material, 4);

    // ── Their shadows on the paint ──
    const shadowGeometry = quadGeometry(count, attributes);
    const shadowMaterial = fxMaterial('Chromatic Impasto — drop shadows');
    const away = u.lightDir.xy.div(max(u.lightDir.z, 0.15)).negate();
    const spreadOut = float(1.25).add(centre.z.mul(7.0));
    shadowMaterial.positionNode = vec3(
        centre.xy.add(away.mul(centre.z))
            .add(heading.mul(corner.x.mul(extent).mul(stretch).mul(spreadOut)))
            .add(across.mul(corner.y.mul(extent).mul(spreadOut))),
        0.0005,
    );
    const vDark = varying(alive.mul(0.62).div(centre.z.mul(16.0).add(1.0)), 'ciDropShade');
    shadowMaterial.colorNode = Fn(() => {
        const st = uv().mul(2.0).sub(1.0);
        const soft = float(1.0).sub(smoothstep(0.1, 1.0, dot(st, st)));
        return vec4(0.0, 0.0, 0.0, soft.mul(vDark));
    })();
    const shadows = part('Chromatic Impasto — drop shadows', shadowGeometry, shadowMaterial, 2);

    let cursor = 0;
    let bursts = 0;
    const touch = () => {
        attributes.aStart.needsUpdate = true;
        attributes.aVel.needsUpdate = true;
        attributes.aTint.needsUpdate = true;
    };

    /**
     * Throw `n` drops from (x, y) toward (dx, dy) at `time` (which may be a moment ahead).
     * `spread` = the fan's full angle (radians); `speed` and `size` scale the defaults.
     * @returns {{ x:number, y:number, time:number, radius:number, speed:number, angle:number, seed:number }[]}
     *          where and when each drop lands
     */
    drops.emit = ({
        x, y, dx = 0, dy = 1, n, color, time, speed = 1, spread = 0.9, size = 1, special = 0,
    }) => {
        const rand = mulberry32(0x7a31 + bursts * 7919);
        bursts += 1;
        const landings = [];
        const total = Math.min(Math.max(0, Math.round(n)), count);
        const base = Math.atan2(dy, dx);
        for (let k = 0; k < total; k++) {
            const i = cursor % count;
            cursor += 1;
            const a = base + (rand() - 0.5) * spread;
            const out = speed * (0.25 + rand() ** 1.5 * 1.0);
            const vz = Math.sqrt(speed) * (0.45 + rand() * 1.5);
            const t0 = time + rand() * 0.07;
            const z0 = 0.008;
            const radius = (0.0055 + rand() ** 2 * 0.012) * size;
            const vx = Math.cos(a) * out;
            const vy = Math.sin(a) * out;
            aStart.set([x, y, z0, t0], i * 4);
            aVel.set([vx, vy, vz, radius], i * 4);
            const shade = 0.82 + rand() * 0.3;
            aTint.set([color[0] * shade, color[1] * shade, color[2] * shade, special], i * 4);
            const flight = flightTime(vz, z0);
            landings.push({
                x: x + vx * flight,
                y: y + vy * flight,
                time: t0 + flight,
                radius: radius * (1.15 + rand() * 0.9),
                speed: clamp01js(out / 1.6),
                angle: a,
                seed: rand() * 4096,
            });
        }
        touch();
        return landings;
    };
    drops.reset = () => {
        for (let i = 0; i < count; i++) aStart[i * 4 + 3] = -1000;
        attributes.aStart.needsUpdate = true;
        cursor = 0;
        bursts = 0;
    };
    drops.update = () => {};
    drops.count = count;
    drops.state = { aStart, aVel, aTint };
    drops.shadows = shadows;
    drops.dispose = () => {
        shadowGeometry.dispose();
        shadowMaterial.dispose();
    };
    return drops;
}

function clamp01js(v) {
    return Math.max(0, Math.min(1, v));
}

/**
 * Dust in the lamp's beam: a few soft, slow points between the eye and the canvas.
 *
 * @param {object} u
 * @param {number} count
 */
export function createMotes(u, count) {
    const aSeed = new Float32Array(count * 4);
    const rand = mulberry32(0x40d7);
    for (let i = 0; i < count; i++) aSeed.set([rand(), rand(), rand(), rand()], i * 4);
    const geometry = quadGeometry(count, { aSeed: new THREE.InstancedBufferAttribute(aSeed, 4) });
    const seed = attribute('aSeed', 'vec4');
    const frame = uniform(new THREE.Vector2(1.78, 1));

    const material = fxMaterial('Chromatic Impasto — dust');
    const tt = u.time;
    // Each mote wanders on its own slow loop and drifts with the room's air.
    const drift = vec3(
        sin(tt.mul(seed.w.mul(0.05).add(0.03)).add(seed.x.mul(TAU))).mul(0.12),
        sin(tt.mul(seed.z.mul(0.04).add(0.025)).add(seed.y.mul(TAU))).mul(0.1),
        sin(tt.mul(0.021).add(seed.w.mul(TAU))).mul(0.15),
    );
    const home = vec3(
        seed.x.mul(2.0).sub(1.0).mul(frame.x),
        seed.y.mul(2.0).sub(1.0).mul(frame.y),
        seed.z.mul(1.5).add(0.25),
    );
    const centre = home.add(drift);
    // Nearer the eye a mote is further out of focus: larger and fainter.
    const blur = centre.z.mul(0.0035).add(0.0016);
    material.positionNode = vec3(centre.xy.add(positionGeometry.xy.mul(blur.mul(2.0))), centre.z);
    const twinkle = sin(tt.mul(seed.w.mul(0.7).add(0.4)).add(seed.z.mul(40.0))).mul(0.4).add(0.6);
    const vGlow = varying(twinkle.mul(float(0.012).div(blur.mul(blur).mul(9000.0).add(0.2))), 'ciMote');
    material.colorNode = Fn(() => {
        const st = uv().mul(2.0).sub(1.0);
        const disc = float(1.0).sub(smoothstep(0.35, 1.0, dot(st, st)));
        return vec4(u.keyColor.mul(disc.mul(vGlow)).mul(u.exposure), 0.0);
    })();
    const motes = part('Chromatic Impasto — dust', geometry, material, 6);
    motes.count = count;
    motes.update = (time, aspect) => {
        frame.value.set(Math.max(0.3, aspect) * 1.02, 1.02);
    };
    return motes;
}
