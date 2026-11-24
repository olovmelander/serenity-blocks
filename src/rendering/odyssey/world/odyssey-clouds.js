import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { createCloudTextures } from './odyssey-cloud-data.js';
import {
    CloudState, SKY_CLOUDS, cloudAt, cloudExtent,
} from './odyssey-cloud-composition.js';
import { CLOUD_INSTANCE, createCloudGeometry, createCloudMaterial } from './odyssey-cloud-material.js';
import { seaFloorAt } from './odyssey-cloud-sea.js';

/**
 * ODYSSEY'S CLOUDS (2026-11-24): the composition (odyssey-cloud-composition.js) drawn. Every frame each cloud
 * is asked where it is, those the eye can see are written far to near into one buffer, and one draw traces
 * them all (odyssey-cloud-material.js).
 */

/** What a quality tier pays: the longest walk a ray takes, the fine billows, and which of the
 * heaps and of the floor's shelves are drawn (every n-th). */
export const CLOUD_TIERS = Object.freeze({
    Minimal: Object.freeze({
        steps: 16, fine: false, every: 2, floor: 3,
    }),
    Low: Object.freeze({
        steps: 20, fine: false, every: 1, floor: 2,
    }),
    Medium: Object.freeze({
        steps: 28, fine: false, every: 1, floor: 1,
    }),
    High: Object.freeze({
        steps: 40, fine: true, every: 1, floor: 1,
    }),
    Ultra: Object.freeze({
        steps: 48, fine: true, every: 1, floor: 1,
    }),
    Extreme: Object.freeze({
        steps: 56, fine: true, every: 1, floor: 1,
    }),
});

export function cloudTier(name) {
    return CLOUD_TIERS[name] ?? CLOUD_TIERS.High;
}

/** A cloud this near the eye (u, to its box) is already dissolving, and is gone at the second. */
const NEAR = Object.freeze([420, 130]);

/**
 * @param {object} opts
 * @param {string} opts.tier the quality tier's name
 * @param {boolean} [opts.load] fetch the volumes
 * @param {{x:number,y:number,z:number}} [opts.summit] the hero summit's tip
 * @param {object} opts.ctx what the material reads of the world (cameraPosition, uTime, uSunDir, prepare, light, air)
 */
export function createOdysseyClouds({
    tier, load = true, summit = null, ctx,
}) {
    const t = cloudTier(tier);
    const uOn = uniform(0);
    const volumes = createCloudTextures({ load, onReady: () => { uOn.value = 1; } });
    const clouds = SKY_CLOUDS.filter((c) => !(c.lane?.role === 'fair' && c.k % t.every) && !(c.lane?.role === 'floor' && c.k % t.floor));
    const { geometry, data, buffer } = createCloudGeometry(clouds.length);
    const material = createCloudMaterial({
        ...ctx, volumes, uOn, steps: t.steps, fineOn: t.fine,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'odyssey-world-clouds';
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.raycast = () => {};
    const states = clouds.map(() => new CloudState());
    let gather = 0;
    const world = {
        summit, cap: 0, climb: 1, floorAt: (x, z, reach) => seaFloorAt(x, z, reach, gather),
    };
    const order = [];
    const frustum = new THREE.Frustum();
    const projView = new THREE.Matrix4();
    const sphere = new THREE.Sphere();
    const eye = new THREE.Vector3();
    let shown = true;

    /**
     * @param {number} time seconds
     * @param {THREE.Camera} camera in the world's own frame (the climb shrinks the group: `inFrame` maps it)
     * @param {(v: THREE.Vector3) => THREE.Vector3} [inFrame] a world position into the group's own frame
     */
    function update(time, camera, visible, evening = null, inFrame = null, toWorld = null, climb = 1) {
        world.climb = climb;
        world.cap = evening?.cap ?? 0;
        gather = evening?.sea ?? 0;
        shown = visible && uOn.value > 0;
        mesh.visible = shown;
        if (!shown || !camera) return;
        camera.getWorldPosition(eye);
        if (inFrame) inFrame(eye);
        projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
        frustum.setFromProjectionMatrix(projView);
        order.length = 0;
        for (let i = 0; i < clouds.length; i += 1) {
            if (clouds[i].lane?.role === 'floor' && gather < 0.002) continue;
            const s = cloudAt(clouds[i], time, states[i], world);
            if (s.cover < 0.004 || s.eaten > 0.98) continue;
            const e = cloudExtent(s);
            sphere.center.set(s.x, s.y + (e.up * 0.5), s.z);
            sphere.radius = Math.hypot(e.across, e.up * 0.5) * 1.05;
            s.dist = Math.hypot(s.x - eye.x, (s.y + (e.up * 0.5)) - eye.y, s.z - eye.z);
            s.near = s.dist - sphere.radius;
            if (toWorld) toWorld(sphere);
            if (!frustum.intersectsSphere(sphere)) continue;
            order.push(s);
        }
        order.sort((a, b) => b.dist - a.dist);
        order.forEach((s, k) => {
            const o = k * CLOUD_INSTANCE.stride;
            const away = Math.max(0, Math.min(1, (s.near - NEAR[1]) / (NEAR[0] - NEAR[1])));
            data[o] = s.x;
            data[o + 1] = s.y;
            data[o + 2] = s.z;
            data[o + 3] = s.yaw;
            data[o + 4] = s.w;
            data[o + 5] = s.tall;
            data[o + 6] = s.shape;
            data[o + 7] = s.seed;
            data[o + 8] = s.eaten + ((1 - away) * (1 - s.eaten));
            data[o + 9] = s.cover * away;
            data[o + 10] = s.softness;
            data[o + 11] = s.role === 'wall' ? 1 : 0;
        });
        geometry.instanceCount = order.length;
        buffer.needsUpdate = true;
    }

    return {
        mesh,
        material,
        volumes,
        states,
        clouds,
        get drawn() { return geometry.instanceCount; },
        update,
        dispose() {
            geometry.dispose();
            material.dispose();
            volumes.dispose();
        },
    };
}
