import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import * as BLOOM from 'three/addons/tsl/display/BloomNode.js';
import IceTempleTheme from '../../themes/ice-temple/ice-temple-theme.js';
import { initIceTempleMaterialRuntime } from '../../themes/ice-temple/ice-temple-materials.js';
import { IceTemplePost } from '../../themes/ice-temple/ice-temple-post.js';

export const meta = {
    id: 'ice-temple',
    title: 'Ice Temple — portable scene',
    description: 'Authored ice, aurora and attribute-based snow with the shared node bloom pipeline.',
};

// Static modules are already loaded; initialize before the host awaits renderer.init().
initIceTempleMaterialRuntime();

export function create({
    scene, camera, renderer, params,
}) {
    const theme = new IceTempleTheme();
    theme.applyQualityPreset(params?.get('quality') || 'High');
    theme.scene = scene;
    theme.camera = camera;
    theme.renderer = renderer;
    theme.isWebGPU = renderer.backend?.isWebGPUBackend === true;
    theme.isWebGL = !theme.isWebGPU;
    theme.useWebGPUMaterials = true;
    theme.flags.useCompute = false;
    theme.flags.useMRT = false;
    // These enhancements are ordinary node graphs, independently of compute/MRT.
    theme.shouldUseVolumetricAurora = () => !theme.flags.noEnhancements
        && !theme.flags.noAuroraVolume && (theme.qualityPreset.auroraLayers ?? 1) > 1;
    theme.shouldUseEnhancedFogMotion = () => !theme.flags.noEnhancements
        && !theme.flags.noFogMotion && theme.getFogMotionProfile().enabled;
    const previousFog = scene.fog;
    scene.fog = new THREE.FogExp2(0x040c14, 0.015);
    camera.fov = 60;
    camera.near = 0.1;
    camera.far = 200;
    camera.position.set(0, 8, 25);
    camera.lookAt(0, 3, 0);
    camera.updateProjectionMatrix();
    theme.mainGroup = new THREE.Group();
    scene.add(theme.mainGroup);
    const previousChildren = new Set(scene.children.filter((child) => child !== theme.mainGroup));
    theme.createStarField();
    theme.createAurora();
    theme.createFrostFloor();
    theme.createIcePillars();
    theme.createSnowSystem();
    theme.setupLighting();
    const post = new IceTemplePost(renderer, scene, camera, {
        bloomStrength: theme.qualityPreset.bloomStrength,
        bloomRadius: theme.qualityPreset.bloomRadius,
        bloomThreshold: theme.qualityPreset.bloomThreshold,
        bloomDownsample: theme.getAdaptiveBloomDownsample(),
        useMRT: false,
    }, THREE, TSL, BLOOM);
    return {
        camera() {
            camera.position.set(0, 8, 25);
            camera.lookAt(0, 3, 0);
        },
        update(time, dt = 0) {
            theme.uniforms.time.value = time;
            theme.mainGroup.position.x = Math.sin(time * 0.08) * 1.5;
            theme.mainGroup.position.y = Math.cos(time * 0.056) * 0.5;
            theme.updateFogMotion(time, dt);
            scene.traverse((object) => {
                if (object.material) theme.setMaterialUniform(object.material, 'uTime', time);
            });
        },
        render() { post.render(); },
        resize(width, height) { post.setSize(width, height); },
        dispose() {
            post.dispose();
            for (const child of [...scene.children]) {
                if (previousChildren.has(child)) continue;
                theme.disposeObject3D(child);
                scene.remove(child);
            }
            scene.fog = previousFog;
        },
    };
}
