/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
// Playground isolation of the Chapter 2 deep ocean. Imports the SHIPPING assembly
// (createDeepOceanEnvironment / updateDeepOceanEnvironment) so iterating deep-ocean.tsl.js
// shaders or deep-ocean.js placement here lands directly in the real chapter — no port step.
//
// The camera flies UP the real spline corridor for chapter 2 (a follow camera along the
// path tangent), and time maps to chapter progress so `?t=<sec>` scrubs the depth ladder:
//   ?t=0   → uDepth 0    (abyssal foot: vent glow / drowned First Heart, jellies hidden)
//   ?t=12  → uDepth 0.5  (mid-climb: god-rays, manta trio, jellyfish procession)
//   ?t=22  → uDepth ~0.9 (breach approach: caustic ceiling brightens, skylight panes)
// Review-only harness; not shipped to the game.
import * as THREE from 'three/webgpu';
import {
    createDeepOceanEnvironment,
    updateDeepOceanEnvironment,
} from '../../rendering/odyssey/chapter-environments/deep-ocean.js';
import {
    getOdysseyPathCurve,
    getActiveOdysseyChapterPositions,
} from '../../rendering/odyssey/path-utils.js';

export const meta = {
    id: 'deep-ocean',
    title: 'Deep Ocean (Ch2)',
    description: 'Chapter 2 underwater (real shipping builder). Fly the corridor; ?t scrubs depth 0→1.',
};

const TRAVEL_SECONDS = 24; // seconds to climb the whole chapter corridor

export function create({ scene, camera }) {
    const group = createDeepOceanEnvironment({ particleCount: 600 });
    scene.add(group);
    if (typeof window !== 'undefined') window.__DO_GROUP__ = group; // review-only introspection handle

    // The ChapterEnvironmentManager owns scene.fog in-game (chapter-profile lerp); several
    // chapter materials set fog:true, so replicate Ch2's authored fog for a faithful read.
    scene.fog = new THREE.FogExp2(new THREE.Color(0x041726), 0.0035);

    const curve = getOdysseyPathCurve();
    const positions = getActiveOdysseyChapterPositions();
    const tStart = positions[1];
    const tEnd = positions[2];

    camera.near = 0.5;
    camera.far = 6000;
    camera.updateProjectionMatrix();

    const p = new THREE.Vector3();

    const chapterFrac = (time) => THREE.MathUtils.clamp((time % TRAVEL_SECONDS) / TRAVEL_SECONDS, 0, 1);
    const globalProgress = (time) => tStart + (tEnd - tStart) * chapterFrac(time);

    return {
        camera(time, cam) {
            const gp = THREE.MathUtils.clamp(globalProgress(time), 0, 1);
            curve.getPointAt(gp, p);
            // Review-only: ?inspect=manta|whale tracks that creature from above so its
            // head-first swim direction is unambiguous (the iconic diamond should lead with
            // its cephalic/head end). Removed after verification.
            const insp = (typeof window !== 'undefined') && window.__DO_GROUP__
                && new URLSearchParams(window.location.search).get('inspect');
            if (insp) {
                const fl = window.__DO_GROUP__.userData.mantaFlights || [];
                const c = fl.find((f) => f.role === insp) || fl[0];
                if (c && c.root) {
                    const mp = c.root.position;
                    cam.position.set(mp.x + 0.01, mp.y + 60, mp.z + 0.01);
                    cam.lookAt(mp.x, mp.y, mp.z);
                    return;
                }
            }
            // Ch2's path tangent is almost straight +Y (the camera climbs), so looking ALONG
            // it just stares at the caustic ceiling. The chapter's content (depth gradient,
            // god-rays, creatures) rings the corridor and sits toward local -Z. Climb in Y with
            // the path but hold a stable horizontal-forward look into the depth axis (toward -Z),
            // tilted slightly up — this is the authored "ascending while gazing into the deep"
            // composition where the gradient reads top-bright / bottom-dark.
            cam.position.set(p.x, p.y, p.z + 34);
            cam.lookAt(p.x, p.y + 9, p.z - 70);
        },
        update(time, dt) {
            updateDeepOceanEnvironment(group, dt ?? 0.016, time, camera, globalProgress(time));
        },
        dispose() {
            scene.remove(group);
            group.traverse((child) => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    const mats = Array.isArray(child.material) ? child.material : [child.material];
                    mats.forEach((m) => m.dispose?.());
                }
            });
            scene.fog = null;
        },
    };
}
