/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Koi Pond — what hangs in the air and lies on the water as light: fireflies (each with its
 * image in the pond), sheets of mist along the far bank, and soft pools of light on the
 * surface under whatever glows (an open lily, a floating lantern, a splash).
 *
 * All of it is stateless or nearly so: a firefly is a function of the clock and its own
 * numbers, a pool is one slot of a small buffer.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, attribute, cameraPosition, cameraViewMatrix, cos, exp, float, length, max, mix, positionGeometry, positionWorld,
    sin, smoothstep, uniform, uv, varying, vec2, vec3, vec4,
} from 'three/tsl';
import {
    TAU, mulberry32, shoreZ, waterDepth,
} from './koi-pond-core.js';

/** Additive light that leaves the frame's alpha alone (see the TSL skill's gotcha table). */
function additive(name) {
    const material = new THREE.MeshBasicNodeMaterial({
        fog: false,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        premultipliedAlpha: true,
        // (Quads built in the shader may wind either way: never cull them.)
        side: THREE.DoubleSide,
    });
    material.name = name;
    return material;
}

// ── Fireflies ───────────────────────────────────────────────────────────────────────────────

export const FIREFLY_COLOR = Object.freeze([0.62, 1.0, 0.22]);

export function createFireflies(light, count, seed = 9431) {
    const { u } = light;
    const rand = mulberry32(seed);
    const data = new Float32Array(Math.max(1, count) * 8);
    for (let i = 0; i < count; i += 1) {
        // Most keep to the banks and the iris; a few wander out over the water.
        const bank = rand() < 0.6;
        const x = -10 + rand() * 20;
        let z = bank ? shoreZ(x) + (rand() - 0.6) * 1.6 : -3.2 + rand() * 5.6;
        if (!bank && Math.abs(x) < 1.6) z = -3 + rand() * 1.2;
        const overWater = waterDepth(x, z) > 0;
        const y = (overWater ? 0.18 : 0.35) + rand() ** 1.4 * (overWater ? 0.9 : 1.3);
        data.set([x, y, z, rand() * TAU, 0.35 + rand() * 0.5, 0.5 + rand() * 0.9, rand() * TAU, 0.6 + rand() * 0.8], i * 8);
    }
    const buffer = new THREE.InstancedInterleavedBuffer(data, 8);
    const home = new THREE.InterleavedBufferAttribute(buffer, 4, 0);
    const trait = new THREE.InterleavedBufferAttribute(buffer, 4, 4);
    /** 0..1: a clear sends them up, brighter and all alight at once. */
    const stir = uniform(0);

    const aHome = attribute('aFly', 'vec4');
    const aTrait = attribute('aFlyTrait', 'vec4');
    // Where a firefly is: a slow figure of its own around home, lifted when the pond stirs.
    const whereabouts = () => {
        const t = u.time.mul(aTrait.x);
        const p = aHome.w;
        return aHome.xyz.add(vec3(
            sin(t.add(p)).mul(0.55).add(sin(t.mul(2.3).add(p.mul(1.7))).mul(0.18)),
            sin(t.mul(1.4).add(p.mul(2.1))).mul(0.16).add(stir.mul(aTrait.w).mul(0.5)),
            cos(t.mul(0.8).add(p.mul(1.3))).mul(0.55),
        ));
    };
    // It glows in slow pulses, each in its own time; a stir lights them all.
    const pulse = () => {
        const beat = sin(u.time.mul(aTrait.y).add(aTrait.z));
        return max(smoothstep(0.2, 0.95, beat), stir.mul(0.85)).mul(u.breath);
    };

    const build = (mirrored) => {
        const geometry = new THREE.InstancedBufferGeometry();
        const quad = new THREE.PlaneGeometry(1, 1);
        geometry.setIndex(quad.getIndex());
        geometry.setAttribute('position', quad.getAttribute('position'));
        geometry.setAttribute('uv', quad.getAttribute('uv'));
        geometry.setAttribute('aFly', home);
        geometry.setAttribute('aFlyTrait', trait);
        geometry.instanceCount = count;
        const material = additive(mirrored ? 'Koi Pond — fireflies in the water' : 'Koi Pond — fireflies');
        const vGlow = varying(pulse(), mirrored ? 'vFlyMirrorGlow' : 'vFlyGlow');
        if (mirrored) {
            // Its image lies where the eye's line to the mirrored firefly meets the water,
            // drawn out toward the viewer and broken by the surface's slope.
            material.positionNode = Fn(() => {
                const at = whereabouts();
                const below = vec3(at.x, at.y.negate(), at.z);
                const k = cameraPosition.y.div(cameraPosition.y.add(at.y));
                const on = cameraPosition.add(below.sub(cameraPosition).mul(k));
                const slope = light.surfaceAt(on.xz).xy;
                const toward = cameraPosition.xz.sub(on.xz).normalize();
                const across = vec2(toward.y.negate(), toward.x);
                const local = across.mul(positionGeometry.x.mul(0.1)).add(toward.mul(positionGeometry.y.mul(0.34)));
                return vec3(on.x.add(local.x).add(slope.x.mul(at.y).mul(1.6)), 0.03, on.z.add(local.y).add(slope.y.mul(at.y).mul(1.6)));
            })();
        } else {
            material.positionNode = Fn(() => {
                const at = whereabouts();
                const right = vec3(cameraViewMatrix[0].x, cameraViewMatrix[1].x, cameraViewMatrix[2].x);
                const up = vec3(cameraViewMatrix[0].y, cameraViewMatrix[1].y, cameraViewMatrix[2].y);
                const size = float(0.11).add(vGlow.mul(0.05));
                return at.add(right.mul(positionGeometry.x.mul(size))).add(up.mul(positionGeometry.y.mul(size)));
            })();
        }
        material.outputNode = Fn(() => {
            const d = length(uv().sub(0.5).mul(2.0));
            const core = exp(d.mul(d).mul(-9.0)).mul(mirrored ? 1.3 : 5.0).add(exp(d.mul(-3.2)).mul(mirrored ? 0.3 : 0.5));
            const fade = float(1.0).sub(smoothstep(0.8, 1.0, d));
            return vec4(vec3(...FIREFLY_COLOR).mul(core.mul(fade).mul(vGlow)), 0.0);
        })();
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = material.name;
        mesh.frustumCulled = false;
        mesh.renderOrder = mirrored ? 6 : 8;
        mesh.castShadow = false;
        return {
            mesh, geometry, material, dispose: () => quad.dispose(),
        };
    };

    return {
        air: build(false), mirror: build(true), stir, count,
    };
}

// ── Mist ────────────────────────────────────────────────────────────────────────────────────

export function createMist(light, sheets) {
    const { u } = light;
    const n = Math.max(1, sheets);
    const quad = new THREE.PlaneGeometry(1, 1);
    quad.rotateX(-Math.PI / 2);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex(quad.getIndex());
    geometry.setAttribute('position', quad.getAttribute('position'));
    geometry.setAttribute('uv', quad.getAttribute('uv'));
    const data = new Float32Array(n * 8);
    for (let i = 0; i < n; i += 1) {
        // Low over the far shelf and the bank, each sheet a little higher and further back.
        const f = n > 1 ? i / (n - 1) : 0;
        const x = (i % 2 ? 1 : -1) * (1.5 + f * 4.5) * (i % 3 === 0 ? 0.3 : 1);
        data.set([x, 0.16 + f * 0.55, -3.0 - f * 1.6, 13 + f * 5, 3.4 + f * 1.8, i * 1.7, 0.6 + f * 0.5, 0], i * 8);
    }
    const buffer = new THREE.InstancedInterleavedBuffer(data, 8);
    geometry.setAttribute('aMist', new THREE.InterleavedBufferAttribute(buffer, 4, 0));
    geometry.setAttribute('aMistLook', new THREE.InterleavedBufferAttribute(buffer, 4, 4));
    geometry.instanceCount = n;
    const aMist = attribute('aMist', 'vec4');
    const aLook = attribute('aMistLook', 'vec4');
    /** How thick the mist lies (the hush before a four-line clear thins it). */
    const density = uniform(1);

    const material = additive('Koi Pond — mist');
    material.positionNode = Fn(() => vec3(
        aMist.x.add(positionGeometry.x.mul(aMist.w)),
        aMist.y,
        aMist.z.add(positionGeometry.z.mul(aLook.x)),
    ))();
    material.outputNode = Fn(() => {
        const point = positionWorld;
        const drift = u.time.mul(0.012);
        const a = light.noise.sample(point.xz.mul(0.045).add(vec2(drift, aLook.y)));
        const b = light.noise.sample(point.xz.mul(0.11).sub(vec2(drift.mul(1.6), aLook.y.mul(0.3))));
        const cloud = smoothstep(0.5, 0.95, a.r.mul(0.65).add(b.g.mul(0.5)));
        const st = uv();
        const edge = smoothstep(0.0, 0.3, st.x).mul(smoothstep(0.0, 0.3, st.x.oneMinus()))
            .mul(smoothstep(0.0, 0.4, st.y)).mul(smoothstep(0.0, 0.25, st.y.oneMinus()));
        // Moon-silver, warmed where the lantern's light reaches it.
        const toLamp = length(u.lantern.xyz.sub(point));
        const warm = float(1.0).div(float(1.0).add(toLamp.div(2.2).pow2()));
        const tint = mix(u.moonColor.mul(0.04), u.lanternColor.mul(0.13), warm);
        return vec4(tint.mul(cloud.mul(edge).mul(aLook.z).mul(density).mul(u.breath.mul(0.6).add(0.4))), 0.0);
    })();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'Koi Pond — mist';
    mesh.frustumCulled = false;
    mesh.renderOrder = 7;
    mesh.castShadow = false;
    return {
        mesh, geometry, material, density, dispose: () => quad.dispose(),
    };
}

// ── Pools of light on the water ─────────────────────────────────────────────────────────────

/** Floats per pool: x, z, radius, strength, r, g, b, flicker phase. */
export const POOL_STRIDE = 8;

/**
 * A fixed pool of soft discs of light lying on the water: slot `i` is rewritten with set().
 * @param {PondLight} light
 * @param {number} slots
 */
export function createLightPools(light, slots) {
    const { u } = light;
    const quad = new THREE.PlaneGeometry(2, 2);
    quad.rotateX(-Math.PI / 2);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex(quad.getIndex());
    geometry.setAttribute('position', quad.getAttribute('position'));
    geometry.setAttribute('uv', quad.getAttribute('uv'));
    const data = new Float32Array(slots * POOL_STRIDE);
    const buffer = new THREE.InstancedInterleavedBuffer(data, POOL_STRIDE);
    buffer.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aPool', new THREE.InterleavedBufferAttribute(buffer, 4, 0));
    geometry.setAttribute('aPoolTint', new THREE.InterleavedBufferAttribute(buffer, 4, 4));
    geometry.instanceCount = slots;
    const aPool = attribute('aPool', 'vec4');
    const aTint = attribute('aPoolTint', 'vec4');

    const material = additive('Koi Pond — light on the water');
    material.positionNode = Fn(() => vec3(
        aPool.x.add(positionGeometry.x.mul(aPool.z)),
        0.02,
        aPool.y.add(positionGeometry.z.mul(aPool.z)),
    ))();
    material.outputNode = Fn(() => {
        const d = length(uv().sub(0.5).mul(2.0));
        // The water's own ripples break the pool into moving flakes.
        const slope = light.surfaceAt(positionWorld.xz).xy;
        const flake = float(1.0).add(slope.x.add(slope.y).mul(9.0)).clamp(0.4, 1.9);
        const fall = exp(d.mul(d).mul(-3.2)).mul(float(1.0).sub(smoothstep(0.75, 1.0, d)));
        return vec4(aTint.rgb.mul(fall.mul(flake).mul(aPool.w).mul(u.breath)), 0.0);
    })();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'Koi Pond — light on the water';
    mesh.frustumCulled = false;
    mesh.renderOrder = 5;
    mesh.castShadow = false;
    return {
        mesh,
        geometry,
        material,
        slots,
        data,
        /** Rewrite slot `i` (strength 0 hides it). */
        set(i, x, z, radius, strength, rgb) {
            const o = i * POOL_STRIDE;
            data[o] = x;
            data[o + 1] = z;
            data[o + 2] = radius;
            data[o + 3] = strength;
            data[o + 4] = rgb[0];
            data[o + 5] = rgb[1];
            data[o + 6] = rgb[2];
        },
        commit() {
            buffer.needsUpdate = true;
        },
        dispose: () => quad.dispose(),
    };
}
