/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies, no-console */
// FULL Chapter-4 (Mountain Peaks / winter) Odyssey composition harness.
//
// Mounts the SHIPPING createMountainPeaksEnvironment() with the live Odyssey path + camera +
// director, so tuning the mountain-peaks(.tsl).js builders here ports directly into the real
// chapter. Built to review the 3→4 seam issues: the (missing) snow-floor baseplate, the
// cloud-sea rim, hero-peak snow/warmth parity, and the winter handoff.
//
// URL params:
//   ?effect=ch4-mountain-peaks&orbit=0&t=8
//   mountT=<0..1>   local progress through Chapter 4 (default 0.12 — just above the cloud-sea)
//   p=<0..1>        absolute Odyssey progress override
// Live sweep without reload: window.__MOUNTAIN__.setProgress(0..1) / setMountT(0..1).
import * as THREE from 'three/webgpu';
import { CHAPTER_CONFIGS } from '../../core/odyssey/data/chapters.js';
import { createMountainPeaksEnvironment, updateMountainPeaksEnvironment } from '../../rendering/odyssey/chapter-environments/mountain-peaks.js';
import { OdysseyCameraController } from '../../rendering/odyssey/OdysseyCameraController.js';
import { OdysseyDirector } from '../../rendering/odyssey/composition/OdysseyDirector.js';
import {
    getActiveOdysseyChapterPositions,
    getOdysseyPathCurve,
} from '../../rendering/odyssey/path-utils.js';
import { resolveChapterBlendState } from '../../rendering/odyssey/ChapterEnvironmentManager.js';

export const meta = {
    id: 'ch4-mountain-peaks',
    title: 'Ch4 Mountain Peaks (Odyssey composition)',
    description: 'Mountain Peaks with the real Odyssey path, camera, and shipping TSL builders — for the 3→4 seam review.',
};

const num = (params, key, dflt) => {
    const v = Number.parseFloat(params.get(key));
    return Number.isFinite(v) ? v : dflt;
};
const clamp01 = (v) => THREE.MathUtils.clamp(v, 0, 1);

export function create({ scene, camera, params }) {
    const chapterPositions = getActiveOdysseyChapterPositions();
    const pathCurve = getOdysseyPathCurve();
    const ch4Start = chapterPositions[3] ?? 0.35;
    const ch5Start = chapterPositions[4] ?? 0.5;
    const mountT = clamp01(num(params, 'mountT', 0.12));
    let cameraProgress = params.has('p')
        ? clamp01(num(params, 'p', ch4Start))
        : THREE.MathUtils.lerp(ch4Start, ch5Start, mountT);

    camera.near = 0.1;
    camera.far = 12000;
    camera.updateProjectionMatrix();

    const env = createMountainPeaksEnvironment();
    scene.add(env);

    const director = new OdysseyDirector({ chapterPositions });
    const cameraRig = new OdysseyCameraController(camera, pathCurve, {
        chapterPositions,
        levelPositions: [],
        startPosition: cameraProgress,
        idleAutoDrift: false,
    });
    cameraRig.setFollowMode({ position: cameraProgress, direct: true });

    const fill = new THREE.HemisphereLight(0xcfe0ff, 0x2a3344, 0.35);
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
    window.__MOUNTAIN__ = {
        setProgress: setLiveProgress,
        setMountT: (t) => setLiveProgress(THREE.MathUtils.lerp(ch4Start, ch5Start, clamp01(t))),
        getProgress: () => cameraProgress,
        ch4Start,
        ch5Start,
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
            updateMountainPeaksEnvironment(env, delta, time, camera, cameraProgress);
        },
        dispose() {
            if (window.__MOUNTAIN__) delete window.__MOUNTAIN__;
            scene.remove(env, fill);
            env.traverse?.((c) => {
                c.geometry?.dispose?.();
                if (Array.isArray(c.material)) c.material.forEach((m) => m.dispose?.());
                else c.material?.dispose?.();
            });
            director.dispose?.();
        },
    };
}
