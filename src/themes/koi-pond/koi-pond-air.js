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
    TAU, groundHeight, mulberry32, shoreZ, smooth, waterDepth,
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
        // Neighbouring insects answer each other across the bank with a second, softer blink.
        const call = sin(u.time.mul(0.54).sub(aHome.x.mul(0.78)).add(aHome.z.mul(0.5)));
        const answer = smoothstep(0.58, 0.96, call).mul(smoothstep(-0.45, 0.75, beat)).mul(0.42);
        return max(smoothstep(0.35, 0.96, beat).mul(0.84).add(answer), stir.mul(0.8)).mul(u.breath);
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
                const size = aTrait.w.mul(0.052).add(0.049).add(vGlow.mul(0.033));
                return at.add(right.mul(positionGeometry.x.mul(size))).add(up.mul(positionGeometry.y.mul(size)));
            })();
        }
        material.outputNode = Fn(() => {
            const d = length(uv().sub(0.5).mul(2.0)).toVar();
            const core = exp(d.mul(d).mul(-21)).mul(mirrored ? 0.78 : 3.2);
            const halo = exp(d.mul(d).mul(-5.2)).mul(mirrored ? 0.23 : 0.46);
            const warmCore = mix(u.firefly, vec3(1.0, 0.89, 0.55), aTrait.y.mul(0.30).add(0.25));
            const fade = float(1.0).sub(smoothstep(0.8, 1.0, d));
            return vec4(warmCore.mul(core).add(u.firefly.mul(halo)).mul(fade).mul(vGlow), 0.0);
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

export function createMist(light, sheets, rocks = []) {
    const { u } = light;
    const n = Math.max(1, sheets);
    // Low pockets follow the bank. Bake the clearance round every boulder once.
    const positions = [];
    const uvs = [];
    const traits = [];
    const indices = [];
    const centres = [-3.2, 4.8, 0.7, -6.5, 7.1, 2.9];
    const columns = 16;
    const rows = 8;
    for (let i = 0; i < n; i += 1) {
        const start = positions.length / 3;
        for (let row = 0; row <= rows; row += 1) {
            const v = row / rows;
            for (let col = 0; col <= columns; col += 1) {
                const s = col / columns;
                const x = centres[i % centres.length] + (s - 0.5) * (4.7 + (i % 3) * 0.45);
                const z = shoreZ(x) + (v - 0.54) * 2.9 + Math.sin(x * 1.3 + i) * 0.15;
                const y = Math.max(0.095, groundHeight(x, z) + 0.08) + Math.sin(Math.PI * s) * Math.sin(Math.PI * v) * 0.085;
                let clearance = 1;
                for (const rock of rocks) {
                    const inside = Math.hypot(x - rock.x, z - rock.z) - rock.radius;
                    clearance = Math.min(clearance, smooth(-0.13, 0.37, inside));
                }
                positions.push(x, y, z);
                uvs.push(s, v);
                traits.push(i * 1.74, clearance);
                if (row < rows && col < columns) {
                    const a = start + row * (columns + 1) + col;
                    const b = a + columns + 1;
                    indices.push(a, b, a + 1, a + 1, b, b + 1);
                }
            }
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute('aMistLook', new THREE.Float32BufferAttribute(traits, 2));
    geometry.setIndex(indices);
    const aLook = attribute('aMistLook', 'vec2');
    /** How thick the mist lies (the hush before a four-line clear thins it). */
    const density = uniform(1);

    const material = additive('Koi Pond — mist');
    material.outputNode = Fn(() => {
        const point = positionWorld;
        const drift = u.time.mul(0.012);
        const a = light.noise.sample(point.xz.mul(0.077).add(vec2(drift, aLook.x)));
        const b = light.noise.sample(point.xz.mul(0.14).sub(vec2(drift.mul(1.6), aLook.x.mul(0.3))));
        const cloud = smoothstep(0.38, 0.85, a.r.mul(0.65).add(b.g.mul(0.46)));
        const edge = smoothstep(0.24, 0.99, uv().mul(2).sub(1).length()).oneMinus().mul(aLook.y);
        // Moon-silver, warmed where the lantern's light reaches it.
        const toLamp = length(u.lantern.xyz.sub(point));
        const warm = float(1.0).div(float(1.0).add(toLamp.div(2.2).pow2()));
        const tint = mix(u.moonColor.mul(0.035), u.lanternColor.mul(0.07), warm);
        return vec4(tint.mul(cloud.mul(edge).mul(density).mul(u.breath.mul(0.6).add(0.4))), 0.0);
    })();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'Koi Pond — mist';
    mesh.frustumCulled = false;
    mesh.renderOrder = 7;
    mesh.castShadow = false;
    return {
        mesh, geometry, material, density,
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
