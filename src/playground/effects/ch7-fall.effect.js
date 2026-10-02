/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies, no-console */
// CHAPTER 7 — THE FALL bench (2026-10-02).
//
// Mounts the shipping createBlackHoleTranscendenceEnvironment(), the real OdysseyPathRenderer
// and the live OdysseyCameraController/Director against the current path data, so the fall
// (transitions/odyssey-black-hole-fall.js: the hole growing until it swallows the frame, the
// disk-plane crossing, the singularity window / warp tunnel, the exit mouth onto the Retrosun)
// can be scrubbed and screenshotted in isolation before it is checked in the journey. The post
// lens / bloom are NOT in the playground (they live in the Odyssey post pipeline) — verify those
// with the in-game chapter capture.
//
// URL params:
//   ?effect=ch7-fall&orbit=0&t=8
//   fallT=<number>   local progress through chapter 7 (0 = level 49, 1 = ch8 start; default 0.25)
//   p=<0..1>         absolute Odyssey progress override
//   particles=<n>    particle budget (default 600, the High preset)
import * as THREE from 'three/webgpu';
import { CHAPTER_CONFIGS } from '../../core/odyssey/data/chapters.js';
import {
    createBlackHoleTranscendenceEnvironment,
    updateBlackHoleTranscendenceEnvironment,
} from '../../rendering/odyssey/chapter-environments/black-hole-transcendence.js';
import { OdysseyCameraController } from '../../rendering/odyssey/OdysseyCameraController.js';
import { OdysseyDirector } from '../../rendering/odyssey/composition/OdysseyDirector.js';
import { OdysseyPathRenderer } from '../../rendering/odyssey/OdysseyPathRenderer.js';
import {
    getActiveOdysseyChapterPositions,
    getActiveOdysseyPathData,
    getOdysseyPathCurve,
} from '../../rendering/odyssey/path-utils.js';
import { resolveChapterBlendState } from '../../rendering/odyssey/ChapterEnvironmentManager.js';

export const meta = {
    id: 'ch7-fall',
    title: 'Ch7 The Fall (black hole + warp tunnel)',
    description: 'Chapter 7 with the real path/camera: the hole grows, the disk plane crosses, the shadow opens onto the warp tunnel.',
};

const num = (params, key, dflt) => {
    const value = Number.parseFloat(params.get(key));
    return Number.isFinite(value) ? value : dflt;
};

function disposeObject(root) {
    root.traverse?.((child) => {
        child.geometry?.dispose?.();
        const { material } = child;
        if (Array.isArray(material)) material.forEach((m) => m.dispose?.());
        else material?.dispose?.();
    });
}

export function create({ scene, camera, params }) {
    const chapterPositions = getActiveOdysseyChapterPositions();
    const pathData = getActiveOdysseyPathData();
    const pathCurve = getOdysseyPathCurve();
    const ch7Start = chapterPositions[6];
    const ch8Start = chapterPositions[7];
    const toProgress = (fallT) => THREE.MathUtils.clamp(THREE.MathUtils.lerp(ch7Start, ch8Start, fallT), 0, 1);
    let cameraProgress = params.has('p')
        ? THREE.MathUtils.clamp(num(params, 'p', ch7Start), 0, 1)
        : toProgress(num(params, 'fallT', 0.25));

    camera.near = 0.1;
    camera.far = 9000;
    camera.updateProjectionMatrix();

    const env = createBlackHoleTranscendenceEnvironment({
        particleCount: Math.max(100, Math.min(1200, Math.floor(num(params, 'particles', 600)))),
        qualityTier: params.get('tier') || 'High',
    });
    scene.add(env);

    const pathRenderer = new OdysseyPathRenderer(scene, { aaa: true });
    pathRenderer.buildPath(pathData);
    pathRenderer.setProgress(cameraProgress);

    const director = new OdysseyDirector({ chapterPositions });
    const cameraRig = new OdysseyCameraController(camera, pathCurve, {
        chapterPositions,
        levelPositions: [],
        startPosition: cameraProgress,
        idleAutoDrift: false,
    });
    cameraRig.setFollowMode({ position: cameraProgress, direct: true });

    let lastTime = null;
    const blendAt = (p) => resolveChapterBlendState(p, CHAPTER_CONFIGS, chapterPositions);
    let directorState = director.update(1 / 60, { ascentProgress: cameraProgress, blendState: blendAt(cameraProgress) });

    function driveCamera() {
        cameraRig.setCurrentPosition(cameraProgress);
        cameraRig.setDirectorState(directorState);
        cameraRig.updateDirectorCamera(2);
        cameraRig.updateChapterFraming(2);
        cameraRig.updateFollowPosition({ position: cameraProgress, direct: true });
        camera.up.copy(cameraRig.followCameraUp);
        camera.lookAt(cameraRig.lookAtTarget);
        cameraRig.applyFramingRoll?.();
        camera.fov = cameraRig._resolveBaseFov?.() ?? directorState.camera?.fovBase ?? camera.fov;
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld(true);
    }

    window.__CH7_FALL__ = {
        setFallT: (t) => { cameraProgress = toProgress(t); return cameraProgress; },
        setProgress: (p) => { cameraProgress = THREE.MathUtils.clamp(p, 0, 1); return cameraProgress; },
        getFall: () => env.userData.fall,
        env,
        ch7Start,
        ch8Start,
    };

    return {
        camera() {
            driveCamera();
        },
        update(time) {
            const delta = lastTime === null ? 1 / 60 : Math.max(0, Math.min(0.05, time - lastTime));
            lastTime = time;
            directorState = director.update(delta, { ascentProgress: cameraProgress, blendState: blendAt(cameraProgress) });
            driveCamera();
            updateBlackHoleTranscendenceEnvironment(env, delta, time, camera, cameraProgress, directorState);
            pathRenderer.setProgress(cameraProgress);
            pathRenderer.update(delta, directorState);
        },
        dispose() {
            if (window.__CH7_FALL__) delete window.__CH7_FALL__;
            scene.remove(env);
            disposeObject(env);
            pathRenderer.dispose();
            director.dispose();
        },
    };
}
