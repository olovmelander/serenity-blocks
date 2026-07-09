/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies, no-console */
// Chapter 3 → 4 SEAM harness — both real environments cross-dissolving at the boundary.
//
// Mounts BOTH createSurfaceWorldEnvironment() and createMountainPeaksEnvironment() (each
// self-world-positions its content) and drives BOTH update functions with the SAME swept
// cameraProgress, so the shipping recede/entry ramps reproduce the ACTUAL 3→4 transition:
// the waterfall recede, tree/ground handoff, the shared hero-chain cross-dissolve + snow/warmth
// parity, and the winter colour/fog bridge. This is the tool for verifying the seam fixes.
//
//   ?effect=ch3-ch4-seam&orbit=0&t=8
//   seamT=<0..1>   sweep across the boundary: 0 = late Ch3, ~0.5 = the seam, 1 = early Ch4
//   p=<0..1>       absolute Odyssey progress override
// Live sweep without reload: window.__SEAM__.setSeamT(0..1) / setProgress(0..1).
import * as THREE from 'three/webgpu';
import { CHAPTER_CONFIGS } from '../../core/odyssey/data/chapters.js';
import { createSurfaceWorldEnvironment, updateSurfaceWorldEnvironment } from '../../rendering/odyssey/chapter-environments/surface-world.js';
import { createMountainPeaksEnvironment, updateMountainPeaksEnvironment } from '../../rendering/odyssey/chapter-environments/mountain-peaks.js';
import { OdysseyCameraController } from '../../rendering/odyssey/OdysseyCameraController.js';
import { OdysseyDirector } from '../../rendering/odyssey/composition/OdysseyDirector.js';
import { getActiveOdysseyChapterPositions, getOdysseyPathCurve } from '../../rendering/odyssey/path-utils.js';
import { resolveChapterBlendState } from '../../rendering/odyssey/ChapterEnvironmentManager.js';

export const meta = {
    id: 'ch3-ch4-seam',
    title: 'Ch3→Ch4 Seam (both environments)',
    description: 'Surface World + Mountain Peaks cross-dissolving at the real 3→4 boundary — for seam-transition review.',
};

const num = (params, key, dflt) => {
    const v = Number.parseFloat(params.get(key));
    return Number.isFinite(v) ? v : dflt;
};
const clamp01 = (v) => THREE.MathUtils.clamp(v, 0, 1);

export function create({ scene, camera, params }) {
    const chapterPositions = getActiveOdysseyChapterPositions();
    const pathCurve = getOdysseyPathCurve();
    const ch4Start = chapterPositions[3] ?? 0.352;
    // Sweep window: from a little before the recede band start to a little into Ch4.
    const seamLo = ch4Start - 0.075;
    const seamHi = ch4Start + 0.09;
    const seamT = clamp01(num(params, 'seamT', 0.5));
    let cameraProgress = params.has('p')
        ? clamp01(num(params, 'p', ch4Start))
        : THREE.MathUtils.lerp(seamLo, seamHi, seamT);

    camera.near = 0.1;
    camera.far = 12000;
    camera.updateProjectionMatrix();

    const surface = createSurfaceWorldEnvironment();
    const mountains = createMountainPeaksEnvironment();
    scene.add(surface, mountains);

    const director = new OdysseyDirector({ chapterPositions });
    const cameraRig = new OdysseyCameraController(camera, pathCurve, {
        chapterPositions,
        levelPositions: [],
        startPosition: cameraProgress,
        idleAutoDrift: false,
    });
    cameraRig.setFollowMode({ position: cameraProgress, direct: true });

    const fill = new THREE.HemisphereLight(0xcfe0ff, 0x3a4658, 0.4);
    scene.add(fill);

    let lastTime = null;
    let directorState = director.update(1 / 60, {
        ascentProgress: cameraProgress,
        blendState: resolveChapterBlendState(cameraProgress, CHAPTER_CONFIGS, chapterPositions),
    });

    function driveCamera() {
        cameraRig.setCurrentPosition(cameraProgress);
        cameraRig.setDirectorState(directorState);
        cameraRig.updateDirectorCamera(2);
        cameraRig.updateChapterFraming(2);
        cameraRig.updateFollowPosition({ position: cameraProgress, direct: true });
        camera.up.copy(cameraRig.followCameraUp);
        camera.lookAt(cameraRig.lookAtTarget);
        camera.fov = directorState.camera?.fovBase ?? camera.fov;
        camera.updateProjectionMatrix();
    }

    function setLiveProgress(p) {
        cameraProgress = clamp01(p);
        directorState = director.update(1 / 60, {
            ascentProgress: cameraProgress,
            blendState: resolveChapterBlendState(cameraProgress, CHAPTER_CONFIGS, chapterPositions),
        });
        for (let i = 0; i < 4; i += 1) {
            cameraRig.setCurrentPosition(cameraProgress);
            cameraRig.setDirectorState(directorState);
            cameraRig.updateDirectorCamera(2);
            cameraRig.updateChapterFraming(2);
            cameraRig.updateFollowPosition({ position: cameraProgress, direct: true });
        }
        driveCamera();
        return cameraProgress;
    }
    window.__SEAM__ = {
        setProgress: setLiveProgress,
        setSeamT: (t) => setLiveProgress(THREE.MathUtils.lerp(seamLo, seamHi, clamp01(t))),
        getProgress: () => cameraProgress,
        ch4Start,
        seamLo,
        seamHi,
    };

    return {
        camera() {
            driveCamera();
        },
        update(time) {
            const delta = lastTime === null ? 1 / 60 : Math.max(0, Math.min(0.05, time - lastTime));
            lastTime = time;
            directorState = director.update(delta, {
                ascentProgress: cameraProgress,
                blendState: resolveChapterBlendState(cameraProgress, CHAPTER_CONFIGS, chapterPositions),
            });
            if (!scene.fog) scene.fog = new THREE.FogExp2(0x638699, 0.0024);
            if (directorState.atmosphere?.fogColor) scene.fog.color.copy(directorState.atmosphere.fogColor);
            if (Number.isFinite(directorState.atmosphere?.fogDensity)) scene.fog.density = directorState.atmosphere.fogDensity;
            updateSurfaceWorldEnvironment(surface, delta, time, camera, cameraProgress);
            updateMountainPeaksEnvironment(mountains, delta, time, camera, cameraProgress);
        },
        dispose() {
            if (window.__SEAM__) delete window.__SEAM__;
            scene.remove(surface, mountains, fill);
            [surface, mountains].forEach((root) => root.traverse?.((c) => {
                c.geometry?.dispose?.();
                if (Array.isArray(c.material)) c.material.forEach((m) => m.dispose?.());
                else c.material?.dispose?.();
            }));
            director.dispose?.();
        },
    };
}
