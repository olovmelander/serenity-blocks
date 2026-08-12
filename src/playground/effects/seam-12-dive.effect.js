/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies, no-console */
// Chapter 1 → 2 SEAM harness — Earth Core handing off to the CONTINUOUS WORLD.
//
// This boundary changed character when One World shipped and nothing has looked at it since.
// Chapter 2 is suppressed, so 1→2 is no longer diorama→diorama: it is Earth Core's vault
// crossfading into the world itself, and it is one of only TWO act edges left in the journey
// (the other is 5→6). The plan wants both rebuilt as OCCLUSION moments — a dive, a cloud bank
// — rather than alpha crossfades, and this is the tool for seeing what they have to beat.
//
// What the current transition actually does, from the code: Earth Core's backstop is an
// OPAQUE BackSide sphere at r=250, renderOrder −90; the world's sky dome is r=3600 at −100, so
// it draws FIRST and the vault covers it completely in steady-state Ch1. But the vault fades
// with the chapter's ecotone opacity — so across the seam the magma cavern DISSOLVES TO REVEAL
// DAYLIGHT, before the traveller has surfaced. That is the artefact the dive replaces.
//
//   ?effect=seam-12-dive&orbit=0&t=8
//   seamT=<0..1>   sweep across the boundary: 0 = late Ch1, ~0.5 = the seam, 1 = early Act II
//   p=<0..1>       absolute Odyssey progress override
//   only=core|world   isolate one side (the other is not built at all)
//   gate=0            disable the act-gate, reproducing the pre-fix overdraw defect
//   steam=0           drop the steam-quench occlusion volume (the crossfade-only baseline)
// Live sweep without reload: window.__SEAM12__.setSeamT(0..1) / setProgress(0..1).
import * as THREE from 'three/webgpu';
import {
    createEarthCoreEnvironment,
    updateEarthCoreEnvironment,
} from '../../rendering/odyssey/chapter-environments/earth-core.js';
import { createOdysseyWorld } from '../../rendering/odyssey/world/odyssey-world-renderer.js';
import {
    getActiveOdysseyChapterPositions,
    getOdysseyPathPointAt,
} from '../../rendering/odyssey/path-utils.js';
import { resolveChapterBlendState } from '../../rendering/odyssey/ChapterEnvironmentManager.js';
import { isWorldVisibleAtProgress } from '../../rendering/odyssey/world/odyssey-world-act-gate.js';
import { createSteamQuench } from '../../rendering/odyssey/composition/odyssey-steam-quench.js';

export const meta = {
    id: 'seam-12-dive',
    title: 'Ch1→Act II Seam (the dive)',
    description: 'Earth Core crossfading into the continuous world at the real 1→2 boundary — the occlusion-moment baseline.',
};

const num = (params, key, dflt) => {
    const v = Number.parseFloat(params.get(key));
    return Number.isFinite(v) ? v : dflt;
};
const clamp01 = (v) => THREE.MathUtils.clamp(v, 0, 1);

export function create({ scene, camera, params }) {
    // The world's clipmap reaches far and its dome sits at 3,600; the playground's default
    // 0.1/20000 frustum clips the dome and the sky renders black at altitude.
    if (camera) {
        camera.near = 1.0;
        camera.far = 30000;
        camera.updateProjectionMatrix();
    }

    const chapterPositions = getActiveOdysseyChapterPositions();
    const boundary = chapterPositions[1] ?? 0.093;
    // Wide enough to hold the whole handoff: Ch1's authored seamWidth is 0.03 (widened from
    // 0.018 for exactly this transition), and the ecotone window is that same seamWidth.
    const seamLo = Math.max(0, boundary - 0.06);
    const seamHi = Math.min(1, boundary + 0.06);
    const seamT = clamp01(num(params, 'seamT', 0.5));
    let cameraProgress = params.has('p')
        ? clamp01(num(params, 'p', boundary))
        : THREE.MathUtils.lerp(seamLo, seamHi, seamT);

    const only = params?.get?.('only') || '';
    const wantCore = only !== 'world';
    const wantWorld = only !== 'core';

    let core = null;
    if (wantCore) {
        core = createEarthCoreEnvironment({ particleCount: 400 });
        scene.add(core);
    }

    let world = null;
    if (wantWorld) {
        world = createOdysseyWorld({
            quality: 'high',
            skyRadius: 3600, // the in-game value; the dome must sit inside the far plane
            railSamples: Array.from({ length: 48 }, (_, i) => getOdysseyPathPointAt(i / 47)),
        });
        scene.add(world.group);
    }

    const actStart = chapterPositions[1];
    const actEnd = chapterPositions[5];
    const actSpan = (actEnd - actStart) || 1;

    // THE OCCLUSION MOMENT. Seated on the rail AT the boundary, sized to envelop the corridor,
    // so the camera flies through it rather than watching it from outside.
    let steam = null;
    if (params?.get?.('steam') !== '0') {
        steam = createSteamQuench();
        const at = getOdysseyPathPointAt(boundary);
        steam.mesh.position.set(at.x, at.y, at.z);
        scene.add(steam.mesh);
    }

    /** Drive both sides from ONE progress, exactly as the board does. */
    function applyProgress(p, time, delta) {
        const blendState = resolveChapterBlendState(p, chapterPositions);
        if (core) {
            // The manager drives chapter opacity through the ecotone weights; mirror that so
            // the vault fades here the way it fades in game.
            const w = blendState?.weights?.[1];
            let coreOpacity = p < boundary ? 1 : 0;
            if (Number.isFinite(w)) coreOpacity = w;
            core.userData.chapterOpacity = coreOpacity;
            core.visible = coreOpacity > 0.002;
            updateEarthCoreEnvironment(core, delta, time, camera, p, null);
        }
        if (steam) {
            // Map absolute progress onto the seam window: 0 approaching, 0.5 at the boundary,
            // 1 leaving. Outside the window the volume is transparent and costs one draw.
            steam.update(time, (p - seamLo) / ((seamHi - seamLo) || 1));
        }
        if (world) {
            // The SAME gate the board applies (shared module, deliberately not re-derived):
            // outside Act II the world must not draw, or it paints over the chapter that owns
            // the frame. `gate=0` disables it to reproduce the pre-fix defect for comparison.
            const gated = params?.get?.('gate') !== '0';
            const worldVisible = !gated || isWorldVisibleAtProgress(p, actStart, actEnd);
            world.group.visible = worldVisible;
            if (worldVisible) {
                const railPoint = getOdysseyPathPointAt(p);
                world.update(time, railPoint, (p - actStart) / actSpan);
            }
        }
    }

    if (typeof window !== 'undefined') {
        window.__SEAM12__ = {
            boundary,
            setSeamT: (t) => { cameraProgress = THREE.MathUtils.lerp(seamLo, seamHi, clamp01(t)); },
            setProgress: (p) => { cameraProgress = clamp01(p); },
            get progress() { return cameraProgress; },
        };
    }
    console.log('[seam-12-dive]', JSON.stringify({
        boundary, seamLo, seamHi, cameraProgress, core: !!core, world: !!world,
    }));

    return {
        cameraRadius: 260,
        update(time, delta) {
            applyProgress(cameraProgress, time, Math.min(0.05, delta ?? 1 / 60));
        },
        camera(time, cam) {
            // Ride the real rail, looking down-corridor — the framing the seam is authored for.
            const pt = getOdysseyPathPointAt(cameraProgress);
            const ahead = getOdysseyPathPointAt(Math.min(1, cameraProgress + 0.02));
            const behind = getOdysseyPathPointAt(Math.max(0, cameraProgress - 0.008));
            const tx = pt.x - behind.x;
            const tz = pt.z - behind.z;
            const tl = Math.hypot(tx, pt.y - behind.y, tz) || 1;
            cam.position.set(pt.x - ((tx / tl) * 26), pt.y + 8, pt.z - ((tz / tl) * 26));
            cam.lookAt(ahead.x, ahead.y + 4, ahead.z);
        },
        resize() {},
        dispose() {
            if (steam) { scene.remove(steam.mesh); steam.dispose(); }
            if (core) scene.remove(core);
            if (world) { scene.remove(world.group); world.dispose(); }
            if (typeof window !== 'undefined') delete window.__SEAM12__;
        },
    };
}
