/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
import * as THREE from 'three/webgpu';
import GoldenForestTheme from '../../themes/golden-forest/golden-forest-theme.js';
import { GoldenForestBirds } from '../../themes/golden-forest/golden-forest-birds.js';

export const meta = {
    id: 'golden-forest-mobile',
    title: 'Golden Forest — modern compatibility scene',
    description: 'Production golden lake, forest and node birds on the WebGL2 backend.',
};

export function create({
    scene, camera, renderer, params,
}) {
    const saved = {
        fog: scene.fog, background: scene.background, fov: camera.fov, far: camera.far,
    };
    const theme = new GoldenForestTheme();
    theme.scene = scene;
    theme.camera = camera;
    theme.renderer = renderer;
    theme.isWebGPU = renderer.backend?.isWebGPUBackend === true;
    theme.usesNodeMaterials = renderer.isWebGPURenderer === true;
    theme.applyQualityPreset(params.get('quality') || 'Low');
    theme.flags.useCompute = false;
    theme.flags.useMRT = false;
    theme.flags.usePost = theme.qualityPreset.enablePostProcessing !== false;
    theme.flags.useBloom = theme.flags.usePost;
    scene.fog = new THREE.FogExp2(0x3a2510, 0.008);
    scene.background = null;
    camera.fov = 55;
    camera.far = 800;
    camera.position.set(0, 5, 160);
    camera.lookAt(0, 6, -20);
    camera.updateProjectionMatrix();
    theme.mainGroup = new THREE.Group();
    scene.add(theme.mainGroup);
    theme.uniforms.mistIntensity.value = Math.min(theme.uniforms.mistIntensity.value, 0.38);
    for (const method of [
        'createSkyDome', 'createMountains', 'createSilhouetteMountain', 'createSun',
        'createAuroraLayers', 'createGodRays', 'createLensFlares', 'createTrees',
        'createHazeLayers', 'createForestFloor', 'createLake', 'createShoreFoam',
        'createWaterLogs', 'createShoreRocks', 'createShoreReeds', 'createLakeFramingTrees',
        'createMistLayers', 'createStylizedClouds', 'createSpiritWinds', 'createDustMotes',
        'createFireflySystem', 'createForestSpirits', 'setupLighting', 'setupDistanceFog',
    ]) theme[method]();
    if (theme.qualityPreset.birdCount > 0) {
        theme.birds = new GoldenForestBirds(renderer, scene, { birdCount: theme.qualityPreset.birdCount });
        theme.birds.init();
        theme.mainGroup.add(theme.birds.mesh);
    }
    theme.setupPostProcessing();
    theme.applyReflectionLayer();
    const owned = scene.children.slice();
    const updateTimes = (value, time) => {
        if (!value) return;
        if (Array.isArray(value)) value.forEach((item) => updateTimes(item, time));
        else if (value.uTime) value.uTime.value = time;
    };
    return {
        camera(time) {
            // The startup camera at z=160 is replaced on the first live frame.
            // Mirror the production exploratory pose, so the lake framing is
            // validated from the actual gameplay location rather than startup.
            const ro = theme.cameraRandomOffsets;
            const t = time * 0.05 * ro.speedMult;
            camera.position.set(
                Math.sin(t + ro.posX1) * 18 + Math.sin(t * 0.37 + ro.posX2) * 10
                    + Math.cos(t * 0.71 + ro.posX3) * 6,
                Math.max(1.5, 8 + Math.sin(t * 0.43 + ro.posY) * 3 + Math.cos(time * 0.25) * 1.5),
                30 + Math.cos(t * 0.31 + ro.posZ1) * 8 + Math.sin(t * 0.53 + ro.posZ2) * 4
                    + Math.sin(t * 0.22) * 22,
            );
            const lookX = Math.sin(t * 0.47 + ro.lookX1) * 22 + Math.cos(t * 0.29 + ro.lookX2) * 12;
            const lookY = 12 + Math.cos(t * 0.23 + ro.lookY) * 5;
            camera.lookAt(lookX, lookY, -30);
            theme.skyDome.position.copy(camera.position);
        },
        update(time) {
            theme.uniforms.time.value = time;
            for (const [key, value] of Object.entries(theme)) {
                if (key.endsWith('Uniforms')) updateTimes(value, time);
            }
            if (theme.waterNodeUniforms?.uTime) theme.waterNodeUniforms.uTime.value = time * 0.38;
            if (theme.birds) theme.birds.compatibilityTime.value = time;
            theme.postComposer?.update({ time });
        },
        render() {
            if (theme.postComposer) theme.postComposer.render();
            else renderer.render(scene, camera);
        },
        resize(width, height) { theme.postComposer?.setSize(width, height); },
        dispose() {
            theme.disposePostProcessing();
            theme.birds?.dispose();
            for (const root of owned) {
                scene.remove(root);
                root.traverse((object) => {
                    object.geometry?.dispose();
                    if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
                    else object.material?.dispose();
                });
            }
            scene.fog = saved.fog;
            scene.background = saved.background;
            camera.fov = saved.fov;
            camera.far = saved.far;
            camera.updateProjectionMatrix();
        },
    };
}
