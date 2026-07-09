/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies, no-console */
// FULL Chapter-6 (Cosmic Expanse / Space) Odyssey composition harness.
//
// Mirrors ch5-sky-drift.effect.js: it mounts the shipping createCosmicExpanseEnvironment(),
// the real OdysseyPathRenderer, and the live OdysseyCameraController/Director against the
// current path data — so tuning the hero placement (APPROACH endpoints), the camera framing
// and the TSL builders here ports directly into Odyssey mode.
//
// URL params:
//   ?effect=ch6-cosmic-expanse&orbit=0&t=8
//   spaceT=<0..1>    local progress through Chapter 6 (default 0.45)
//   p=<0..1>         absolute Odyssey progress override
//   particles=<n>    cosmic particle budget (default 700 for the harness)
import * as THREE from 'three/webgpu';
import { CHAPTER_CONFIGS } from '../../core/odyssey/data/chapters.js';
import { createCosmicExpanseEnvironment, updateCosmicExpanseEnvironment } from '../../rendering/odyssey/chapter-environments/cosmic-expanse.js';
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
    id: 'ch6-cosmic-expanse',
    title: 'Ch6 Cosmic Expanse (Odyssey composition)',
    description: 'Space with the real Odyssey path, camera, hero march (black hole / planet / galaxy) and shipping TSL builders.',
};

const num = (params, key, dflt) => {
    const value = Number.parseFloat(params.get(key));
    return Number.isFinite(value) ? value : dflt;
};

const clamp01 = (value) => THREE.MathUtils.clamp(value, 0, 1);

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
    const ch6Start = chapterPositions[5] ?? 0.648;
    const ch7Start = chapterPositions[6] ?? 0.815;
    const spaceT = clamp01(num(params, 'spaceT', 0.45));
    let cameraProgress = params.has('p')
        ? clamp01(num(params, 'p', ch6Start))
        : THREE.MathUtils.lerp(ch6Start, ch7Start, spaceT);
    let pathProgress = clamp01(num(params, 'pathProgress', cameraProgress));

    camera.near = 0.1;
    camera.far = 12000;
    camera.updateProjectionMatrix();

    const space = createCosmicExpanseEnvironment({
        particleCount: Math.max(200, Math.min(1200, Math.floor(num(params, 'particles', 700)))),
    });
    scene.add(space);

    const pathRenderer = new OdysseyPathRenderer(scene, { aaa: true });
    pathRenderer.buildPath(pathData);
    pathRenderer.setProgress(pathProgress);

    const director = new OdysseyDirector({ chapterPositions });
    const cameraRig = new OdysseyCameraController(camera, pathCurve, {
        chapterPositions,
        levelPositions: [],
        startPosition: cameraProgress,
        idleAutoDrift: false,
    });
    cameraRig.setFollowMode({ position: cameraProgress, direct: true });

    const fill = new THREE.HemisphereLight(0x223044, 0x05060c, 0.12);
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

    // ── Live dev hook ────────────────────────────────────────────────────────────
    function setLiveProgress(p) {
        cameraProgress = clamp01(p);
        pathProgress = cameraProgress;
        directorState = director.update(1 / 60, {
            ascentProgress: cameraProgress,
            blendState: resolveChapterBlendState(cameraProgress, CHAPTER_CONFIGS, chapterPositions),
        });
        // Run the env update a few times so the uApproach-driven hero march settles to the
        // new progress (the heroes are positioned from camera.position.y in update()).
        for (let i = 0; i < 4; i += 1) {
            cameraRig.setCurrentPosition(cameraProgress);
            cameraRig.setDirectorState(directorState);
            cameraRig.updateDirectorCamera(2);
            cameraRig.updateChapterFraming(2);
            cameraRig.updateFollowPosition({ position: cameraProgress, direct: true });
            camera.up.copy(cameraRig.followCameraUp);
            camera.lookAt(cameraRig.lookAtTarget);
            updateCosmicExpanseEnvironment(space, 1 / 60, 8, camera, cameraProgress, directorState);
        }
        driveCamera();
        return cameraProgress;
    }
    function setLiveSpaceT(t) {
        return setLiveProgress(THREE.MathUtils.lerp(ch6Start, ch7Start, clamp01(t)));
    }
    let cameraFrozen = false;
    window.__SPACE__ = {
        setProgress: setLiveProgress,
        setSpaceT: setLiveSpaceT,
        getProgress: () => cameraProgress,
        setFrozen: (v) => { cameraFrozen = !!v; },
        env: space,
        cameraRig,
        director,
        ch6Start,
        ch7Start,
    };

    return {
        camera() {
            if (!cameraFrozen) driveCamera();
        },
        update(time) {
            const delta = lastTime === null ? 1 / 60 : Math.max(0, Math.min(0.05, time - lastTime));
            lastTime = time;
            const blendState = resolveChapterBlendState(cameraProgress, CHAPTER_CONFIGS, chapterPositions);
            directorState = director.update(delta, {
                ascentProgress: cameraProgress,
                blendState,
            });
            if (!scene.fog) scene.fog = new THREE.FogExp2(0x05060c, 0.0010);
            scene.fog.color.copy(directorState.atmosphere.fogColor);
            scene.fog.density = directorState.atmosphere.fogDensity;

            updateCosmicExpanseEnvironment(space, delta, time, camera, cameraProgress, directorState);
            pathRenderer.setProgress(pathProgress);
            pathRenderer.update(delta, directorState);
        },
        dispose() {
            if (window.__SPACE__) delete window.__SPACE__;
            scene.remove(space);
            disposeObject(space);
            pathRenderer.dispose();
            scene.remove(fill);
            director.dispose();
        },
    };
}
