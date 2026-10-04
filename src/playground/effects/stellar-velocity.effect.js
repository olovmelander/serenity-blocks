/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/** The production Stellar Velocity scene and grade, isolated from the game. */
import * as THREE from 'three/webgpu';
import StellarVelocityTheme from '../../themes/stellar-velocity/stellar-velocity-theme.js';

export const meta = {
    id: 'stellar-velocity',
    title: 'Stellar Velocity — luminous slipstream',
    description: 'The shipping scene, quality tiers, and hyperdrive reactions in isolation.',
};

export function create({
    scene, camera, renderer, params,
}) {
    const saved = { fov: camera.fov, far: camera.far, tone: renderer.toneMapping };
    const theme = new StellarVelocityTheme();
    theme.scene = scene;
    theme.camera = camera;
    theme.renderer = renderer;
    theme.usesNodeMaterials = true;
    theme.isWebGPU = renderer.backend?.isWebGPUBackend === true;
    theme.isWebGL = !theme.isWebGPU;
    theme.flags.noCompute = params.get('compute') !== '1';
    theme.flags.noDrs = true;
    theme.flags.noMRT = params.get('mrt') !== '1';
    theme.flags.noPost = params.get('noPost') === '1';
    theme.getCurrentQualityLevel = () => params.get('quality') || 'High';
    let seed = Number(params.get('seed') || 187) % 2147483647;
    theme.random = () => {
        seed = (seed * 16807) % 2147483647;
        return (seed - 1) / 2147483646;
    };
    theme.applyQualityPreset(params.get('quality') || 'High');
    theme.probeCapabilities();
    theme.configureRendererColorPipeline();
    camera.fov = theme.baseFOV;
    camera.far = 100000;
    camera.position.set(0, 0, 1000);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    scene.add(new THREE.AmbientLight(0x404060, 0.3));
    theme.coreLight = new THREE.PointLight(0xffffff, 1, 2000);
    scene.add(theme.coreLight);
    theme.createStarfield();
    theme.createNebulaBackdrop();
    theme.createWarpCore();
    theme.createAsteroidField();
    theme.createAsteroidMicroDebris();
    theme.applyActivePalette();
    theme.setupPostProcessing();
    const roots = scene.children.slice();
    let overlay;
    if (params.get('board') === '1') {
        overlay = document.createElement('div');
        overlay.className = 'player-card';
        overlay.dataset.player = 'solo';
        overlay.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);'
            + 'width:calc(min(clamp(220px,22vw,300px),(100vh - 250px)/2) + 24px);'
            + 'height:calc(2 * min(clamp(220px,22vw,300px),(100vh - 250px)/2) + 24px);'
            + 'border:1px solid #adcbe840;border-radius:16px;'
            + 'background:#070c18e0;pointer-events:none;z-index:3;box-shadow:0 16px 60px #0008';
        document.body.appendChild(overlay);
    }
    theme.atmosphere.nextLayoutCheck = 0;
    theme.atmosphere.update(theme, 0);
    const step = (time, dt) => {
        theme.time = time;
        theme.updateWarpState(dt);
        theme.updateStarfield(dt);
        theme.updateNebulas(dt);
        theme.updateWarpCore(dt);
        theme.updateAsteroids(dt);
        theme.updateAsteroidMicroDebris(dt);
        theme.updateBurstParticles(dt);
        theme.updateShockwaveRings(dt);
        theme.updateEnergyDischargeArcs(dt);
        theme.updateCometStreaks(dt);
        theme.updatePostProcessing();
        theme.updateCamera(dt);
    };
    let sought;
    const seek = (time) => {
        if (sought === time) return;
        const start = sought ?? 0;
        sought = time;
        const eventName = params.get('event');
        const age = Math.max(0, Number(params.get('eventAge') || 1.5));
        const eventTime = Math.max(start, time - age);
        const steps = Math.max(1, Math.ceil((time - start) * 60));
        let fired = false;
        for (let i = 1; i <= steps; i += 1) {
            const t = start + ((time - start) * i) / steps;
            if (eventName && !fired && t >= eventTime) {
                theme.time = t;
                if (eventName === 'lock') theme.onPieceLock();
                else if (eventName === 'combo') theme.onCombo(Number(params.get('combo') || 5));
                else theme.onLineClear(eventName === 'tetris' ? 4 : 2);
                fired = true;
            }
            step(t, (time - start) / steps);
        }
    };
    window.__STELLAR_VELOCITY__ = theme;
    return {
        cameraRadius: 1,
        seek,
        update(time, dt) {
            if (params.has('t')) return;
            step(time, Math.min(0.05, Math.max(0, dt)));
        },
        camera() {},
        render() { theme.renderFrame(); },
        resize(width, height) {
            theme.postProcessing?.setSize(width, height);
        },
        getDiagnostics() {
            return {
                quality: theme.activeQualityLevel,
                renderPath: theme.lastRenderPath,
                phase: theme.hyperdriveSequence.phase,
                materialAudit: theme.materialAuditReport,
                ribbons: theme.atmosphere.tier.ribbons,
                compute: Boolean(theme.starfieldCompute),
                selectiveBloom: theme.postProcessing?.useMRT === true,
            };
        },
        dispose() {
            overlay?.remove();
            theme.clearThemeTimeouts();
            theme.disposePostProcessingStack();
            theme.disposeComputeResources();
            theme.disposeSceneResources();
            roots.forEach((root) => scene.remove(root));
            delete window.__STELLAR_VELOCITY__;
            camera.fov = saved.fov;
            camera.far = saved.far;
            camera.updateProjectionMatrix();
            renderer.toneMapping = saved.tone;
        },
    };
}
