/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Logo Warp Transition — WebGPU compute-particle studio-ident dissolve.
 *
 * Iteration harness for the studio-ident → intro reveal. The diamond studio mark
 * is a GPU point-cloud that IGNITES, DIVES through a hyperspace warp toward the
 * camera (light-streaks), then settles into the intro nebula seed. The particle
 * scene itself lives in the SHARED builder so the playground and the real boot
 * renderer stay pixel-identical — improve one, improve both.
 *
 *   /playground.html?effect=logo-warp-transition&orbit=0
 *   optional:  &count=60000  &dur=6.5   &t=1.4 (phase-lock a still)
 *
 * Progress phases (uProgress):
 *   0.00–0.13  FACET FOCUS   — the game-ident diamond resolves in cyan-violet
 *   0.13–0.30  IGNITION      — facets separate and acquire depth
 *   0.30–0.67  WARP FLIGHT   — controlled radial streaks accelerate toward camera
 *   0.67–0.94  ARRIVAL       — trails shorten and curl into a layered field
 *   0.94–1.00  NEBULA SEED   — persistent quiet field for the title crossfade
 */
import * as THREE from 'three/webgpu';
import { createWarpParticles } from '../../ui/boot-warp-transition-scene.js';

export const meta = {
    id: 'logo-warp-transition',
    title: 'Logo Warp Transition',
    description: 'GPU compute-particle studio-ident dissolve: diamond → hyperspace dive → nebula seed.',
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

    const aspect = (sizes && sizes.width / sizes.height) || (window.innerWidth / window.innerHeight);

    // Fixed camera (matches render framing) → deterministic view-projection.
    const projCam = new THREE.PerspectiveCamera(45, aspect, 0.1, 200);
    projCam.position.set(0, 0, 7);
    projCam.lookAt(0, 0, 0);
    projCam.updateMatrixWorld();

    const warp = createWarpParticles({
        count,
        aspect,
        viewportHeight: (sizes && sizes.height) || window.innerHeight,
        compute: typeof renderer.compute === 'function',
        rng: createSeededRng(seed),
    });
    warp.setAspect(aspect);
    warp.setViewProj(new THREE.Matrix4().multiplyMatrices(projCam.projectionMatrix, projCam.matrixWorldInverse));
    scene.add(warp.mesh);

    const previousBackground = scene.background;
    const previousToneMapping = renderer.toneMapping;
    const previousExposure = renderer.toneMappingExposure;
    scene.background = new THREE.Color(0x02040b);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.9;

    const refreshViewProj = () => {
        projCam.updateProjectionMatrix();
        projCam.updateMatrixWorld();
        warp.setViewProj(new THREE.Matrix4().multiplyMatrices(projCam.projectionMatrix, projCam.matrixWorldInverse));
    };

    return {
        cameraRadius: 7,
        update(time) {
            const cycle = duration + 2.4; // hold on the nebula seed, then loop
            const local = time % cycle;
            warp.setProgress(Math.min(local / duration, 1));
            warp.setTime(time);
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
            if (cam.fov !== 45) { cam.fov = 45; cam.updateProjectionMatrix(); }
            cam.position.set(0, 0, 7);
            cam.lookAt(0, 0, 0);
        },
        resize(w, h) {
            const a = w / h;
            projCam.aspect = a;
            warp.setAspect(a);
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
