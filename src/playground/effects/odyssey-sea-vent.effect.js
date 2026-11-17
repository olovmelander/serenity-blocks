/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
// THE SEA VENT — chapter 1's top and the 1->2 seam, without the world.
//
// The real Earth Core chapter (so the shaft's throat, the sea vent's black smokers, their smoke,
// the gas and the sparks of life are the shipped ones) under the real steam quench, seen as the
// follow camera sees them: from the rail, looking straight up the shaft. The ocean is not built
// (seam-12-dive is the harness with the world): past the boundary the frame's background is the
// abyss's own dark, which is what the quench's veil paints over the water there anyway.
//
//   ?effect=odyssey-sea-vent&orbit=0&t=12&maxFps=30
//   p=<0..0.09>     camera progress (default 0.056, orb 5's station inside the steam)
//   clock=<seconds> the chapter's clock at t = 0 (earth-core-clock.js: fountains, gusts, pulses)
//   steam=0         without the steam's shell (the vent alone against the dark)
//   quality=Low|Medium|High
// Live: window.__SEA_VENT__.setProgress(p).
import * as THREE from 'three/webgpu';
import {
    createEarthCoreEnvironment,
    updateEarthCoreEnvironment,
} from '../../rendering/odyssey/chapter-environments/earth-core.js';
import {
    getActiveOdysseyChapterPositions,
    getOdysseyPathPointAt,
} from '../../rendering/odyssey/path-utils.js';
import {
    createSteamQuench,
    steamQuenchSeamT,
    STEAM_QUENCH_APPROACH_HALF_WIDTH,
    STEAM_QUENCH_EXIT_HALF_WIDTH,
    STEAM_DECKS_BY_TIER,
} from '../../rendering/odyssey/composition/odyssey-steam-quench.js';
import { pickByQualityTier } from '../../rendering/odyssey/chapter-environments/shared/odyssey-quality-tier.js';

export const meta = {
    id: 'odyssey-sea-vent',
    title: 'Odyssey — the sea vent (1→2 seam)',
    description: 'Earth Core\'s top under the steam quench: the sea\'s eye, black smokers, gas, sparks of life.',
};

const num = (params, key, dflt) => {
    const v = Number.parseFloat(params.get(key));
    return Number.isFinite(v) ? v : dflt;
};

export function create({ scene, camera, params }) {
    const boundary = getActiveOdysseyChapterPositions()[1] ?? 0.0649;
    let progress = THREE.MathUtils.clamp(num(params, 'p', 0.056), 0, 0.09);
    const quality = params.get('quality') || 'High';
    const previousBackground = scene.background;
    scene.background = new THREE.Color(0.004, 0.011, 0.022);

    const core = createEarthCoreEnvironment({ qualityTier: quality, clockOffset: num(params, 'clock', 0) });
    scene.add(core);

    let steam = null;
    if (params.get('steam') !== '0') {
        steam = createSteamQuench({ decks: pickByQualityTier(quality, STEAM_DECKS_BY_TIER) });
        steam.mesh.position.copy(getOdysseyPathPointAt(boundary));
        scene.add(steam.mesh);
    }

    if (camera) {
        camera.near = 0.5;
        camera.far = 4000;
        camera.fov = 58;
        camera.updateProjectionMatrix();
    }
    if (typeof window !== 'undefined') {
        window.__SEA_VENT__ = {
            boundary,
            setProgress: (p) => { progress = THREE.MathUtils.clamp(p, 0, 0.09); },
            get progress() { return progress; },
        };
    }

    const eye = new THREE.Vector3();
    const up = new THREE.Vector3();
    return {
        cameraRadius: 60,
        update(time, delta) {
            // The follow camera trails the rail by ~20 u while it climbs, a few units off the
            // rail on the vista's far side (measured from the game's camera rig).
            const rail = getOdysseyPathPointAt(progress);
            eye.set(rail.x - 4.2, rail.y - 20.2, rail.z - 5.6);
            if (camera && params.get('orbit') === '0') {
                camera.position.copy(eye);
                // Straight up, the frame's top toward the vista's far side (as in the game).
                up.set(-0.677, 0, -0.736).normalize();
                camera.up.copy(up);
                camera.lookAt(eye.x + 0.02, eye.y + 100, eye.z + 0.05);
                camera.updateMatrixWorld(true);
            }
            updateEarthCoreEnvironment(core, Math.min(0.05, delta ?? 1 / 60), time, camera, progress, null);
            if (steam) {
                const lo = boundary - STEAM_QUENCH_APPROACH_HALF_WIDTH;
                const hi = boundary + STEAM_QUENCH_EXIT_HALF_WIDTH;
                steam.mesh.visible = progress > lo && progress < hi;
                steam.update(time, steamQuenchSeamT(progress, boundary));
            }
        },
        dispose() {
            scene.remove(core);
            if (steam) { scene.remove(steam.mesh); steam.dispose(); }
            scene.background = previousBackground;
            if (typeof window !== 'undefined') delete window.__SEA_VENT__;
        },
    };
}
