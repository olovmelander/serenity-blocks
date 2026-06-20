/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
// Playground isolation of the Chapter 4 mountains. Imports the SHIPPING assembly
// (createMountainPeaksPilotTSL) so iterating shared/mountain-language.js displacement or the
// mountain-peaks.tsl.js shaders here lands directly in the real chapter — no separate port step.
// See docs/ODYSSEY_VISUAL_UPGRADE_PLAN.md Workstream A.
import * as THREE from 'three/webgpu';
import { createMountainPeaksPilotTSL } from '../../rendering/odyssey/chapter-environments/mountain-peaks.tsl.js';

export const meta = {
    id: 'mountain-range',
    title: 'Mountain Range (Ch4)',
    description: 'Chapter 4 mountains (real shipping builder) — iterate displacement, sky/fog de-wash, depth tiers.',
};

export function create({ scene, camera }) {
    const pilot = createMountainPeaksPilotTSL({ foothillBaseY: -74 });
    scene.add(pilot.group);
    // Lit dusk read (NOT night) so silhouette + snow/rock are visible while iterating.
    pilot.uniforms.uTransition.value = 0.15;
    pilot.uniforms.uSummitGlow.value = 0.4;

    camera.near = 0.5;
    camera.far = 30000;
    camera.updateProjectionMatrix();

    return {
        camera(time, cam) {
            // Match the live climax framing: low on the lane, looking up at the hero massif (z -680).
            const drift = Math.sin(time * 0.04) * 60;
            cam.position.set(drift, 60, 180);
            cam.lookAt(0, 230, -680);
        },
        update(time) {
            pilot.uniforms.uTime.value = time;
        },
        dispose() {
            scene.remove(pilot.group);
            pilot.dispose();
        },
    };
}
