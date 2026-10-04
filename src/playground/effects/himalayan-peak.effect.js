import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { createSkyDome } from '../../themes/himalayan-peak/rendering/sky-dome.js';
import { createRidgeTerrain } from '../../themes/himalayan-peak/rendering/ridge-terrain.js';
import { createPrayerFlags } from '../../themes/himalayan-peak/rendering/prayer-flags.js';
import { createSpindrift } from '../../themes/himalayan-peak/sim/spindrift.js';
import { PeakPostPipeline, getPeakPostProfile } from '../../themes/himalayan-peak/post/peak-pipeline.js';

export const meta = {
    id: 'himalayan-peak',
    title: 'Himalayan Peak — node compatibility',
    description: 'Production ridges, scattering sky, flags, snow and grade on either node backend.',
};

export function create({
    scene, camera, renderer, params,
}) {
    const quality = params.get('quality') || 'Low';
    const u = {
        uTime: uniform(0),
        uWarmth: uniform(0),
        uIgnite: uniform(0),
        uSunDir: uniform(new THREE.Vector3(-0.48, 0.36, -0.8).normalize()),
        uSunColor: uniform(new THREE.Color(0xfdeedb)),
        uSkyZenith: uniform(new THREE.Color(0x3b4d86)),
        uSkyHorizon: uniform(new THREE.Color(0xb4bbdd)),
        uFogColor: uniform(new THREE.Color(0xb4bbdd)),
        uRimColor: uniform(new THREE.Color(0xffd9a0)),
        uStarFade: uniform(1),
        uCameraPos: uniform(new THREE.Vector3()),
    };
    const sky = createSkyDome(u);
    const terrain = createRidgeTerrain(u, { segments: 128 });
    const flags = createPrayerFlags({ count: 9 });
    const snow = createSpindrift(800);
    scene.add(sky.mesh, terrain.mesh, flags.mesh, snow.mesh);
    camera.fov = 46; camera.near = 1; camera.far = 4000;
    camera.updateProjectionMatrix();
    const post = params.get('noPost') !== '1'
        ? new PeakPostPipeline(renderer, scene, camera, {
            ...getPeakPostProfile(quality), useMRT: renderer.backend?.isWebGPUBackend === true,
        }) : null;
    return {
        camera() {
            camera.position.set(0, 58, 160); camera.lookAt(0, 95, -260);
            u.uCameraPos.value.copy(camera.position);
        },
        update(time) {
            u.uTime.value = time;
            flags.update?.(time); snow.update?.(time);
            post?.updateDynamic({ time });
        },
        render() {
            if (post?.isEnabled()) post.render();
            else renderer.render(scene, camera);
        },
        resize(width, height) { post?.setSize?.(width, height); },
        dispose() {
            [sky, terrain, flags, snow].forEach((part) => {
                scene.remove(part.mesh); part.dispose();
            });
            post?.dispose();
        },
    };
}
