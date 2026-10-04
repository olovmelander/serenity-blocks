/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
import * as THREE from 'three/webgpu';
import FluidDreamsTheme from '../../themes/fluid-dreams/fluid-dreams-theme.js';
import { FluidDreamsPost } from '../../themes/fluid-dreams/fluid-dreams-post.js';
import {
    createFluidDreamsCompatibilityParticles,
} from '../../themes/fluid-dreams/fluid-dreams-compatibility-particles.js';

export const meta = {
    id: 'fluid-dreams-mobile',
    title: 'Fluid Dreams — modern compatibility scene',
    description: 'Production iridescent fluid and haze with attribute-driven WebGL2 motes.',
};

export function create({
    scene, camera, renderer, params,
}) {
    const saved = { tone: renderer.toneMapping, fov: camera.fov };
    const theme = new FluidDreamsTheme();
    theme.scene = scene;
    theme.camera = camera;
    theme.renderer = renderer;
    theme.isWebGPU = renderer.backend?.isWebGPUBackend === true;
    theme.usesNodeMaterials = renderer.isWebGPURenderer === true;
    theme.applyQualityPreset(params.get('quality') || 'Low');
    theme.initMetaballState();
    theme.createBackground();
    theme.createHaze();
    theme.createHero();
    const particles = createFluidDreamsCompatibilityParticles(theme.activePreset.particleCount);
    scene.add(particles.mesh);
    const post = new FluidDreamsPost(renderer, scene, camera, {
        useMRT: false,
        bloomStrength: theme.activePreset.bloomStrength,
        bloomRadius: theme.activePreset.bloomRadius,
        bloomThreshold: 0.55,
        bloomDownsample: theme.activePreset.bloomDownsample,
        chromaticStrength: theme.activePreset.enableChromaticAberration ? 0.0018 : 0,
        exposure: 1,
        contrast: 1.06,
        saturation: 1.15,
        tintStrength: 0.12,
        grainStrength: 0.015,
    });
    renderer.toneMapping = THREE.NoToneMapping;
    camera.fov = 60;
    camera.updateProjectionMatrix();
    const owned = scene.children.slice();
    return {
        camera() {
            camera.position.copy(theme.baseCameraPos);
            camera.lookAt(theme.cameraLook);
        },
        update(time) {
            theme.updateMetaballState(time);
            theme.pushMetaballsToHero();
            theme.heroMaterial.userData.uTime.value = time;
            theme.backgroundMaterial.userData.uTime.value = time;
            if (theme.hazeMaterial) theme.hazeMaterial.userData.uTime.value = time;
            particles.material.userData.uTime.value = time;
            post.update({ time });
        },
        render() { post.render(); },
        resize(width, height) { post.setSize(width, height); },
        dispose() {
            post.dispose();
            for (const root of owned) {
                scene.remove(root);
                root.traverse((object) => {
                    object.geometry?.dispose();
                    object.material?.dispose();
                });
            }
            renderer.toneMapping = saved.tone;
            camera.fov = saved.fov;
            camera.updateProjectionMatrix();
        },
    };
}
