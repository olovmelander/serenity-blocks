/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Winter — footfall SNOW PUFFS.
 *
 * Every AAA deformable-snow implementation punctuates the moment of contact: without a puff
 * the deformation appears out of thin air, which reads as a decal switching on rather than a
 * paw pressing into powder. This is the cheap companion to the trail height field
 * (paw-trail.js) — see docs/WINTER_FOX_PAW_TRAILS_AAA_PLAN_2026-07.md.
 *
 * Deliberately NOT a GPU compute sim like SnowSim: the pool is tiny (a handful of live puffs
 * from three foxes), so a CPU pool + a compacted instanced draw is far simpler and cheaper
 * than a storage-buffer round trip. Dead puffs cost nothing — `instanceCount` drops to 0 and
 * the draw is skipped entirely.
 *
 * Uses an InstancedBufferGeometry + explicit instanced attributes rather than an InstancedMesh:
 * the billboard needs its own vertexNode, which bypasses InstanceNode anyway, and reading our
 * own attributes keeps it clear of the r181 InstanceNode/positionLocal ordering trap.
 */
import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
    Fn, attribute, cameraProjectionMatrix, cameraViewMatrix, float, length, mix,
    positionGeometry, smoothstep, uniform, uv, vec2, vec4,
} from 'three/tsl';

export function createSnowPuffs({
    pool = 96,
    color = 0xf2f7ff, // moonlit crown
    // The shaded underside. This is what makes a puff READ: the ground here is near-white, so
    // a white puff over it is invisible — all the contrast has to come from its own shadow.
    shadow = 0x8598bd,
    gravity = 150,
    drag = 0.86,
} = {}) {
    const base = new THREE.PlaneGeometry(1, 1);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = base.index;
    geometry.setAttribute('position', base.attributes.position);
    geometry.setAttribute('uv', base.attributes.uv);

    const centers = new Float32Array(pool * 3);
    const params = new Float32Array(pool * 3); // size, alpha, seed
    const aCenter = new THREE.InstancedBufferAttribute(centers, 3);
    const aParams = new THREE.InstancedBufferAttribute(params, 3);
    aCenter.setUsage(THREE.DynamicDrawUsage);
    aParams.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aCenter', aCenter);
    geometry.setAttribute('aParams', aParams);
    geometry.instanceCount = 0;

    const uColor = uniform(new THREE.Color(color));
    const uShadow = uniform(new THREE.Color(shadow));

    const material = new MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
    });

    // Camera-facing billboard at the instance centre. `positionGeometry` (not positionLocal)
    // so nothing downstream can have reassigned it.
    material.vertexNode = Fn(() => {
        const c = attribute('aCenter', 'vec3');
        const p = attribute('aParams', 'vec3');
        const viewC = cameraViewMatrix.mul(vec4(c, 1.0));
        const off = positionGeometry.xy.mul(p.x);
        return cameraProjectionMatrix.mul(viewC.add(vec4(off, 0.0, 0.0)));
    })();

    // Soft puff: a gaussian-ish disc, brighter at the top (moon above) so it reads as a little
    // volume of kicked-up powder rather than a flat dot.
    material.colorNode = Fn(() => {
        const d = length(uv().sub(vec2(0.5, 0.5))).mul(2.0);
        const lift = smoothstep(1.0, 0.0, uv().y);
        return mix(uColor, uShadow, lift.mul(0.85)).mul(float(1.0).sub(d.mul(0.15)));
    })();
    material.opacityNode = Fn(() => {
        const p = attribute('aParams', 'vec3');
        const d = length(uv().sub(vec2(0.5, 0.5))).mul(2.0);
        return smoothstep(1.0, 0.1, d).mul(p.y);
    })();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 5;
    mesh.name = 'winter-snow-puffs';

    // CPU pool state.
    const px = new Float32Array(pool);
    const py = new Float32Array(pool);
    const pz = new Float32Array(pool);
    const vx = new Float32Array(pool);
    const vy = new Float32Array(pool);
    const vz = new Float32Array(pool);
    const life = new Float32Array(pool);
    const lifeMax = new Float32Array(pool);
    const size0 = new Float32Array(pool);
    let cursor = 0;
    let live = 0;

    /**
     * Kick up a little powder.
     * @param x,y,z   world position of the contact (y = the snow surface)
     * @param scale   the animal's rendered size — puffs scale with the foot that made them
     * @param ux,uz   heading (powder is thrown up and slightly BACKWARD from the step)
     * @param n       how many grains
     * @param force   0..1+ — a trotting paw barely lifts snow, a pounce landing erupts
     */
    function burst(x, y, z, scale, ux, uz, n = 4, force = 1) {
        for (let k = 0; k < n; k += 1) {
            const i = cursor;
            cursor = (cursor + 1) % pool;
            if (life[i] <= 0) live += 1;
            const spread = scale * 0.05;
            px[i] = x + (Math.random() - 0.5) * spread;
            py[i] = y + scale * 0.02;
            pz[i] = z + (Math.random() - 0.5) * spread;
            const up = (0.5 + Math.random() * 0.7) * scale * 0.9 * force;
            const back = (0.2 + Math.random() * 0.5) * scale * 0.5 * force;
            vx[i] = -ux * back + (Math.random() - 0.5) * scale * 0.35 * force;
            vy[i] = up;
            vz[i] = -uz * back + (Math.random() - 0.5) * scale * 0.35 * force;
            lifeMax[i] = 0.5 + Math.random() * 0.5;
            life[i] = lifeMax[i];
            // ~5-10% of the animal's length. The first pass at 2× this merged into one grey
            // smear; at half of it the grains vanished against near-white snow. This reads.
            size0[i] = scale * (0.05 + Math.random() * 0.05) * (0.75 + force * 0.35);
        }
    }

    function update(dt) {
        if (live <= 0) {
            if (geometry.instanceCount !== 0) geometry.instanceCount = 0;
            return;
        }
        const k = drag ** (dt * 60);
        let n = 0;
        live = 0;
        for (let i = 0; i < pool; i += 1) {
            if (life[i] <= 0) continue;
            life[i] -= dt;
            if (life[i] <= 0) continue;
            live += 1;
            vy[i] -= gravity * dt;
            vx[i] *= k; vy[i] *= k; vz[i] *= k;
            px[i] += vx[i] * dt;
            py[i] += vy[i] * dt;
            pz[i] += vz[i] * dt;
            const t = life[i] / lifeMax[i]; // 1 fresh → 0 gone
            const o = n * 3;
            centers[o] = px[i];
            centers[o + 1] = py[i];
            centers[o + 2] = pz[i];
            // Powder billows OUT as it disperses while fading — the classic puff signature.
            params[o] = size0[i] * (1.7 - t * 0.7);
            // t^1.5 rather than t²: holds visible presence through most of the flight, then
            // drops away quickly at the end.
            params[o + 1] = t * Math.sqrt(t) * 0.8;
            params[o + 2] = i / pool;
            n += 1;
        }
        geometry.instanceCount = n;
        if (n > 0) {
            aCenter.needsUpdate = true;
            aParams.needsUpdate = true;
        }
    }

    function dispose() {
        geometry.dispose();
        material.dispose();
        base.dispose();
    }

    return {
        mesh, burst, update, dispose, get live() { return live; },
    };
}
