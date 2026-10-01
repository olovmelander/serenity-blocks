/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/** One isolated Cosmic Noir scene, built and animated by the production theme. */
import * as THREE from 'three/webgpu';
import CosmicNoirTheme from '../../themes/cosmic-noir/cosmic-noir-theme.js';
import { ThemeCameraRig } from '../../themes/shared/camera-rig.js';

export const meta = {
    id: 'cosmic-noir',
    title: 'Cosmic Noir — silver singularity',
    description: 'Production nebula, accretion disk and pooled reactions in isolation.',
};

export function create({
    scene, camera, renderer, params,
}) {
    const saved = {
        background: scene.background,
        fog: scene.fog,
        tone: renderer.toneMapping,
        exposure: renderer.toneMappingExposure,
        fov: camera.fov,
        far: camera.far,
    };
    const quality = params.get('quality') || 'High';
    const theme = new CosmicNoirTheme();
    theme.scene = scene;
    theme.camera = camera;
    theme.renderer = renderer;
    // The playground owns a node renderer on either backend. Production's classic
    // fallback is separately validated in the built game.
    theme.isWebGPU = true;
    theme.getCurrentQualityLevel = () => quality;
    Object.assign(theme.flags, {
        seed: Number(params.get('seed') || 12345),
        fixedDeltaMs: 1000 / 60,
        noAdaptiveScale: true,
        noCompute: true,
        useCompute: false,
        useMRT: false,
        renderScale: 0.92,
    });
    theme.applyQualityPreset(quality);
    theme.flags.usePost = theme.qualityPreset.enablePostProcessing !== false;
    theme.initializeDeterministicState();
    theme.initializeAdaptiveBudgetState();
    scene.background = new THREE.Color(0x000002);
    scene.fog = new THREE.FogExp2(0x010101, 0.00026);
    camera.fov = 60;
    camera.far = 30000;
    camera.updateProjectionMatrix();
    camera.position.set(0, 0, 1200);
    theme.cameraRig = new ThemeCameraRig(camera, {
        breathe: true,
        pointer: false,
        idlePhase: theme.planetPhaseX * 0.73 + theme.planetPhaseY,
    });
    const key = new THREE.PointLight(0x9ea3be, 2.2, 3500);
    key.position.set(350, 200, 600);
    const fill = new THREE.PointLight(0x3a3d52, 0.6, 3000);
    fill.position.set(-250, -100, 300);
    scene.add(key, fill, new THREE.AmbientLight(0x101218, 0.35));
    theme.ensureSharedNoiseTexture();
    theme.createStarfield();
    theme.createNebulaClouds();
    theme.createAmbientDust();
    theme.createPlanet();
    theme.createAtmosphere();
    theme.createVoidSparks();
    theme.createGasSwirlParticles();
    theme.setupPostProcessing();
    theme.configureRendererColorPipeline();
    const ownedRoots = scene.children.slice();

    // Track the real material textures, including TSL texture nodes, without
    // replacing the global loading manager or issuing duplicate asset requests.
    const textures = new Set([theme.sharedNoiseTexture]);
    scene.traverse((object) => {
        const { material } = object;
        if (!material) return;
        for (const value of Object.values(material)) {
            if (value?.isTexture) textures.add(value);
            if (value?.isNode) {
                value.traverse((node) => {
                    if (node.isTextureNode && node.value?.isTexture) textures.add(node.value);
                });
            }
        }
    });
    let disposed = false;
    let ready = false;
    let preparing;
    let warmLockWave = null;
    const prepare = () => {
        if (!preparing) {
            preparing = (async () => {
                const deadline = performance.now() + 20000;
                while ([...textures].some((map) => !map.image?.width)) {
                    if (disposed) return;
                    if (performance.now() > deadline) throw new Error('Cosmic Noir textures did not load.');
                    // eslint-disable-next-line no-await-in-loop
                    await new Promise((resolve) => { setTimeout(resolve, 30); });
                }
                if (disposed) return;
                warmLockWave = theme.acquireCosmicWave({ radius: 288, tube: 1.3 });
                try { await renderer.compileAsync(scene, camera); } finally {
                    theme.releaseCosmicWave(warmLockWave);
                }
                ready = true;
            })();
        }
        return preparing;
    };
    let overlay;
    if (params.get('board') === '1') {
        overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);'
            + 'width:min(25vw,280px);height:70vh;border:1px solid #adbac340;border-radius:16px;'
            + 'background:#07090fe0;pointer-events:none;z-index:3;box-shadow:0 16px 60px #0008';
        document.body.appendChild(overlay);
    }
    const update = (time, dt = 0) => {
        theme.time = time;
        theme.fixedElapsed = time;
        theme.updateScene(Math.min(0.05, Math.max(0, dt)));
    };
    let sought = null;
    const seek = (time) => {
        if (sought === time) return;
        sought = time;
        theme.clearDeferredTimeouts();
        theme.initializeDeterministicState();
        theme.planet.rotation.y = 0;
        for (const wave of [...theme.cosmicWaves]) theme.releaseCosmicWave(wave);
        theme.cosmicWaves.length = 0;
        for (const data of [theme.gasSwirlData, theme.unifiedSparkData]) {
            if (!data) continue;
            data.activeWindows.length = 0;
            data.highWaterMark = 0;
            data.nextIndex = 0;
            data.activeEstimate = 0;
            data.births?.fill(-1000);
        }
        for (const object of [theme.gasSwirl, ...theme.voidSparks]) {
            const birth = object?.geometry?.getAttribute('aBirth');
            if (birth) { birth.clearUpdateRanges(); birth.needsUpdate = true; }
        }
        theme.planetPulseIntensity = 0;
        theme.starEventBoost = 0;
        theme.gasExplosionTimer = -10;
        theme.gasExplosionIntensity = 0;
        theme.comboFlashIntensity = 0;
        theme.comboLensFlareIntensity = 0;
        Object.keys(theme.reactiveEnvelope).forEach((keyName) => { theme.reactiveEnvelope[keyName] = 0; });
        theme.cameraRig.reset();
        const event = params.get('event');
        const age = event ? Math.max(0, Number(params.get('eventAge') || 0.5)) : 0;
        theme.cameraRig._idlePhase = theme.cameraRig._idlePhaseSeed + time - age;
        theme.planet.rotation.y = (time - age) * 0.05;
        update(time - age, 0);
        if (event === 'lock') theme.handlePieceLock();
        else if (event) theme.onLineClear(4, Number(params.get('combo') || 3));
        for (let elapsed = 0; elapsed < age; elapsed += 1 / 60) {
            const delta = Math.min(1 / 60, age - elapsed);
            update(time - age + elapsed + delta, delta);
        }
        update(time, 0);
    };
    return {
        camera() {},
        update,
        seek,
        prepare,
        render() { theme.renderFrame(); },
        async renderAsync() { await prepare(); if (!disposed) theme.renderFrame(); },
        resize(width, height) {
            camera.aspect = width / height;
            camera.updateProjectionMatrix();
            theme.postProcessing?.setSize(width, height);
            sought = null;
        },
        getDiagnostics() {
            return {
                loaded: ready,
                quality,
                time: theme.time,
                hero: theme.planetGroup.position.toArray(),
                camera: camera.position.toArray(),
                waves: theme.cosmicWaves.length,
                gasParticles: theme.gasSwirlData?.activeEstimate ?? 0,
                sparks: theme.unifiedSparkData?.activeEstimate ?? 0,
                flashScale: theme.comboFlash.scale.toArray(),
            };
        },
        dispose() {
            disposed = true;
            overlay?.remove();
            theme.clearDeferredTimeouts();
            // The playground reuses its scene immediately on effect switches.
            // Detach now; delayed compile cleanup must only touch our own roots.
            for (const object of ownedRoots) scene.remove(object);
            if (warmLockWave) scene.remove(warmLockWave);
            const release = () => {
                // Active waves belong to planetGroup and are disposed with its roots.
                theme.disposeCosmicWavePool();
                theme.disposePostProcessingStack();
                const geometries = new Set();
                const materials = new Set();
                for (const root of ownedRoots) {
                    root.traverse((object) => {
                        if (object.geometry) geometries.add(object.geometry);
                        if (object.material) materials.add(object.material);
                    });
                }
                geometries.forEach((geometry) => geometry.dispose());
                materials.forEach((material) => material.dispose());
                textures.forEach((map) => map.dispose());
            };
            if (preparing) preparing.then(release, release);
            else release();
            scene.background = saved.background;
            scene.fog = saved.fog;
            renderer.toneMapping = saved.tone;
            renderer.toneMappingExposure = saved.exposure;
            camera.fov = saved.fov;
            camera.far = saved.far;
            camera.updateProjectionMatrix();
        },
    };
}
