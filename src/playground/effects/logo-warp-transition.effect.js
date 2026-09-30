/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Logo Warp Transition — WebGPU studio-ident → intro reveal.
 *
 * Iteration harness for the boot warp. The scene lives in the SHARED builder so the playground
 * and the real boot renderer stay pixel-identical — improve one, improve both.
 *
 *   /playground.html?effect=logo-warp-transition&orbit=0
 *   optional:  &count=48000 (boot count)  &dur=6.5  &t=1.4 (phase-lock a still)
 *              &gemX=640&gemY=329  (CSS px centre of the DOM mark; default: the ident layout)
 *
 * Progress phases (uProgress) — see boot-warp-transition-scene.js for the full timeline:
 *   0.00–0.07  MATCH FRAME — the stage reproduces the CSS ident pixel-for-pixel
 *   0.07–0.17  IGNITION    — flare, the gem shatters into particles
 *   0.17–0.33  CREEP/JUMP  — bars retract, the flight kicks with an FOV push
 *   0.33–0.60  CRUISE      — trailing streaks, vanishing-point glow
 *   0.60–0.70  DROP-OUT    — hard stop, second flash
 *   0.66–1.00  ARRIVAL     — soft star field + haze for the intro title
 *
 * To judge the match frame against the real DOM ident, capture with
 *   node scripts/run-electron.mjs scripts/playground-phase-capture.mjs --ident-compare 1 --times 0
 */
import * as THREE from 'three/webgpu';
import { createWarpParticles, warpFovAt } from '../../ui/boot-warp-transition-scene.js';

export const meta = {
    id: 'logo-warp-transition',
    title: 'Logo Warp Transition',
    description: 'Studio-ident match frame → ignition → hyperspace flight → arrival field.',
};

function createSeededRng(seed = 0x5e12f10) {
    let value = seed >>> 0;
    return () => {
        value += 0x6d2b79f5;
        let mixed = value;
        mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
        mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
        return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
    };
}

export function create({
    scene, renderer, sizes, params,
}) {
    const count = parseInt(params.get('count'), 10) || 60000;
    const duration = parseFloat(params.get('dur')) || 6.5;
    const seed = parseInt(params.get('seed'), 10) || 0x5e12f10;

    let width = (sizes && sizes.width) || window.innerWidth;
    let height = (sizes && sizes.height) || window.innerHeight;
    const aspect = width / height;

    // Fixed camera (matches render framing) → deterministic view-projection.
    const projCam = new THREE.PerspectiveCamera(45, aspect, 0.1, 200);
    projCam.position.set(0, 0, 7);
    projCam.lookAt(0, 0, 0);
    projCam.updateMatrixWorld();

    const warp = createWarpParticles({
        count,
        aspect,
        viewportWidth: width,
        viewportHeight: height,
        compute: typeof renderer.compute === 'function',
        rng: createSeededRng(seed),
    });
    const placeGem = () => {
        const gx = parseFloat(params.get('gemX'));
        const gy = parseFloat(params.get('gemY'));
        if (Number.isFinite(gx) && Number.isFinite(gy)) warp.setGemCenterPx(gx, gy);
        else warp.setGemCenterPx(width / 2, height / 2 - 31);
    };
    // Debug: &layers=stage or &layers=particles renders one layer alone.
    const layers = params.get('layers');
    if (layers === 'stage') warp.particles.visible = false;
    if (layers === 'particles') warp.stage.visible = false;
    warp.setViewport(width, height);
    placeGem();
    scene.add(warp.mesh);

    const previousBackground = scene.background;
    const previousToneMapping = renderer.toneMapping;
    const previousExposure = renderer.toneMappingExposure;
    scene.background = new THREE.Color(0x02040b);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.9;

    let fov = 45;
    const refreshViewProj = () => {
        projCam.fov = fov;
        projCam.updateProjectionMatrix();
        projCam.updateMatrixWorld();
        warp.setViewProj(new THREE.Matrix4().multiplyMatrices(projCam.projectionMatrix, projCam.matrixWorldInverse));
    };
    refreshViewProj();

    return {
        cameraRadius: 7,
        update(time) {
            const cycle = duration + 2.4; // hold on the arrival field, then loop
            const local = time % cycle;
            const p = Math.min(local / duration, 1);
            warp.setProgress(p);
            warp.setTime(time);
            const nextFov = warpFovAt(p);
            if (nextFov !== fov) {
                fov = nextFov;
                refreshViewProj();
            }
            if (warp.computeNode) {
                try {
                    renderer.compute(warp.computeNode);
                } catch (e) {
                    // eslint-disable-next-line no-console
                    console.error('[logo-warp-transition] compute failed:', e);
                }
            }
        },
        camera(time, cam) {
            if (cam.fov !== fov) { cam.fov = fov; cam.updateProjectionMatrix(); }
            cam.position.set(0, 0, 7);
            cam.lookAt(0, 0, 0);
        },
        resize(w, h) {
            width = w;
            height = h;
            projCam.aspect = w / h;
            warp.setViewport(w, h);
            placeGem();
            refreshViewProj();
        },
        dispose() {
            scene.remove(warp.mesh);
            warp.dispose();
            scene.background = previousBackground;
            renderer.toneMapping = previousToneMapping;
            renderer.toneMappingExposure = previousExposure;
        },
    };
}
