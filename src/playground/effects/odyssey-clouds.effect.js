import * as THREE from 'three/webgpu';
import {
    cameraPosition, clamp, dot, exp, float, max, mix, normalize, positionWorld, pow, smoothstep, uniform, vec3, vec4,
} from 'three/tsl';

import { CLOUD_SHAPES, createCloudTextures } from '../../rendering/odyssey/world/odyssey-cloud-data.js';
import {
    CLOUD_INSTANCE, CLOUD_LOOK, createCloudGeometry, createCloudMaterial,
} from '../../rendering/odyssey/world/odyssey-cloud-material.js';
import { ODYSSEY_WORLD_SUN } from '../../rendering/odyssey/chapter-environments/shared/chapter-profile.js';

/**
 * ODYSSEY'S CLOUDS, AUDITIONED (2026-11-24): the sculpted shapes side by side under a plain sky and the
 * world's sun. The page is not the game's grade: judge shape, mass and light here, colour in the game.
 *
 *   ?only=heap,tower    the shapes whose id starts with one of these
 *   ?az= ?el= ?dist=    the camera (degrees, degrees, u), looking at the board's middle
 *   ?yaw=90             turn every cloud
 *   ?eaten=0.4          how far gone they are
 *   ?steps=             the march's budget
 */

export const meta = {
    id: 'odyssey-clouds',
    title: 'Odyssey clouds — audition board',
    description: 'Every sculpted cloud, traced, under the world\'s sun.',
};

export function create({ scene, camera, params }) {
    const get = (k) => params?.get?.(k);
    const only = get('only')?.split(',').filter(Boolean) ?? null;
    const shown = CLOUD_SHAPES.map((s, i) => ({ s, i })).filter(({ s }) => !only || only.some((o) => s.id.startsWith(o)));
    const sunDir = new THREE.Vector3(...ODYSSEY_WORLD_SUN).normalize();
    const uSunDir = uniform(sunDir);
    const uTime = uniform(0);
    const uOn = uniform(0);
    const uSun = uniform(new THREE.Color(1, 0.93, 0.80));
    const uHorizon = uniform(new THREE.Color(0.66, 0.78, 0.92));
    const uZenith = uniform(new THREE.Color(0.17, 0.36, 0.72));
    const skyAt = (rd) => mix(uHorizon, uZenith, smoothstep(float(-0.02), float(0.62), rd.y));
    const prev = scene.background;
    const sky = new THREE.Mesh(new THREE.SphereGeometry(30000, 48, 24), new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false }));
    sky.material.colorNode = skyAt(normalize(positionWorld.sub(cameraPosition)));
    sky.renderOrder = -10;
    scene.add(sky);

    const volumes = createCloudTextures({ onReady: () => { uOn.value = 1; } });
    const L = CLOUD_LOOK;
    const material = createCloudMaterial({
        volumes,
        uOn,
        steps: Number(get('steps')) || 40,
        fineOn: get('fine') !== '0',
        cameraPosition,
        uTime,
        uSunDir,
        prepare: (rd) => ({ toSun: clamp(dot(rd, uSunDir), 0, 1).toVar() }),
        light: (k, s) => {
            const { toSun } = k;
            const crease = mix(float(1 - L.relief), float(1 + (L.relief * 0.55)), s.relief.mul(0.45).add(s.lit.mul(0.55)));
            const direct = s.sun.mul(s.sun.mul(0.35).add(0.65)).mul(crease);
            const thin = float(1).sub(s.body);
            const silver = pow(toSun, float(10)).mul(L.silver).mul(thin.add(0.25));
            const sun = uSun.mul(direct.mul(L.sun).add(silver.mul(s.sun)));
            const skyUp = mix(uHorizon, uZenith, 0.42).mul(s.sky.mul(0.72).add(0.14)).mul(L.sky).mul(mix(float(0.86), float(1.08), s.relief));
            const bounce = vec3(0.62, 0.60, 0.56).mul(s.ground.mul(L.ground)).mul(0.6);
            return sun.add(skyUp).add(bounce).add(uHorizon.mul(float(1).sub(s.dens).mul(L.rim).mul(s.sky)));
        },
        air: (rgb, alpha, rd, p, dist) => {
            const haze = float(1).sub(exp(dist.div(9000).negate())).mul(exp(max(p.y, 0).div(2600).negate()).mul(0.6).add(0.4));
            return vec4(mix(rgb, skyAt(rd).mul(alpha), haze), alpha);
        },
    });
    const { geometry, data, buffer } = createCloudGeometry(shown.length);
    const cols = Math.min(4, Math.ceil(Math.sqrt(shown.length)));
    const items = shown.map(({ i }, k) => ({
        x: ((k % cols) - ((cols - 1) / 2)) * 1150, y: Math.floor(k / cols) * 760, z: 0, i, yaw: ((Number(get('yaw')) || 0) * Math.PI) / 180, seed: k * 0.37,
    }));
    const write = () => {
        const order = [...items].sort((a, b) => ((b.x - camera.position.x) ** 2) + ((b.y - camera.position.y) ** 2) + ((b.z - camera.position.z) ** 2)
            - (((a.x - camera.position.x) ** 2) + ((a.y - camera.position.y) ** 2) + ((a.z - camera.position.z) ** 2)));
        order.forEach((it, k) => {
            data.set([it.x, it.y, it.z, it.yaw, 1000, 1, it.i, it.seed, Number(get('eaten')) || 0, 1, 1, 0], k * CLOUD_INSTANCE.stride);
        });
        geometry.instanceCount = order.length;
        buffer.needsUpdate = true;
    };
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    scene.add(mesh);
    const rows = Math.ceil(shown.length / cols);
    const target = new THREE.Vector3(0, ((rows - 1) * 760 * 0.5) + 230, 0);
    const az = THREE.MathUtils.degToRad(Number(get('az') ?? 0));
    const el = THREE.MathUtils.degToRad(Number(get('el') ?? -8));
    const dist = Number(get('dist')) || 3400;
    camera.near = 1;
    camera.far = 60000;
    return {
        camera(_t, cam) {
            cam.position.set(
                target.x + (Math.sin(az) * Math.cos(el) * dist),
                target.y + (Math.sin(el) * dist),
                target.z + (Math.cos(az) * Math.cos(el) * dist),
            );
            cam.lookAt(target);
            cam.updateProjectionMatrix();
        },
        update(time) {
            uTime.value = time;
            write();
        },
        dispose() {
            scene.remove(mesh);
            scene.remove(sky);
            geometry.dispose();
            material.dispose();
            sky.geometry.dispose();
            sky.material.dispose();
            volumes.dispose();
            scene.background = prev;
        },
    };
}
