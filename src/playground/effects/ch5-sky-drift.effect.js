/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies, no-console */
// FULL Chapter-5 (Sky Drift) Odyssey composition harness.
//
// This is intentionally not a shader fork: it mounts createSkyDriftEnvironment(), the
// shipping OdysseyPathRenderer, and the live OdysseyCameraController against the current
// path data. Tuning the spline/camera/TSL builders here therefore ports directly into
// Odyssey mode.
//
// URL params:
//   ?effect=ch5-sky-drift&orbit=0&t=8
//   skyT=<0..1>      local progress through Chapter 5 (default 0.42)
//   p=<0..1>         absolute Odyssey progress override
//   pathProgress=<0..1> path illumination head (default follows p)
//   particles=<n>    Sky Drift wisp count (default 260 for the harness)
import * as THREE from 'three/webgpu';
import { CHAPTER_CONFIGS } from '../../core/odyssey/data/chapters.js';
import { createSkyDriftEnvironment, updateSkyDriftEnvironment } from '../../rendering/odyssey/chapter-environments/sky-drift.js';
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
    id: 'ch5-sky-drift',
    title: 'Ch5 Sky Drift (Odyssey composition)',
    description: 'Sky Drift with the real Odyssey path, camera, mountain handoff, and shipping TSL builders.',
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
    const ch5Start = chapterPositions[4] ?? 0.5;
    const ch6Start = chapterPositions[5] ?? 0.648;
    const skyT = clamp01(num(params, 'skyT', 0.42));
    // Mutable so the live dev hook (window.__SKYDRIFT__.setProgress) can sweep the chapter
    // from a SINGLE page load — re-navigating per skyT accumulates chrome-devtools-mcp
    // servers and wedges the browser.
    let cameraProgress = params.has('p')
        ? clamp01(num(params, 'p', ch5Start))
        : THREE.MathUtils.lerp(ch5Start, ch6Start, skyT);
    let pathProgress = clamp01(num(params, 'pathProgress', cameraProgress));

    camera.near = 0.1;
    camera.far = 9000;
    camera.updateProjectionMatrix();

    const sky = createSkyDriftEnvironment({
        particleCount: Math.max(80, Math.min(420, Math.floor(num(params, 'particles', 260)))),
    });
    scene.add(sky);

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

    const fill = new THREE.HemisphereLight(0xcbdcff, 0x253044, 0.24);
    scene.add(fill);

    let lastTime = null;
    let directorState = director.update(1 / 60, {
        ascentProgress: cameraProgress,
        blendState: resolveChapterBlendState(cameraProgress, CHAPTER_CONFIGS, chapterPositions),
    });

    function driveCamera() {
        cameraRig.setCurrentPosition(cameraProgress);
        cameraRig.setDirectorState(directorState);
        // Settle the act-level camera profile immediately so a fixed screenshot is not
        // halfway through a smoothing transition from the constructor defaults.
        cameraRig.updateDirectorCamera(2);
        cameraRig.updateChapterFraming(2);
        cameraRig.updateFollowPosition({
            position: cameraProgress,
            direct: true,
        });
        camera.up.copy(cameraRig.followCameraUp);
        camera.lookAt(cameraRig.lookAtTarget);
        camera.fov = directorState.camera?.fovBase ?? camera.fov;
        camera.updateProjectionMatrix();
    }

    // ── Live dev hook ────────────────────────────────────────────────────────────
    // Sweep the chapter (and the skyT→progress mapping) WITHOUT re-navigating, so a
    // composition pass can sample geometry + screenshot many beats from one page load.
    function setLiveProgress(p, opts = {}) {
        cameraProgress = clamp01(p);
        if (opts.pathProgress === undefined) pathProgress = cameraProgress;
        else pathProgress = clamp01(opts.pathProgress);
        directorState = director.update(1 / 60, {
            ascentProgress: cameraProgress,
            blendState: resolveChapterBlendState(cameraProgress, CHAPTER_CONFIGS, chapterPositions),
        });
        // Settle the smoothed framing/profile to the new progress so a fixed shot is not
        // mid-transition from the previous beat.
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
    function setLiveSkyT(t) {
        return setLiveProgress(THREE.MathUtils.lerp(ch5Start, ch6Start, clamp01(t)));
    }
    let cameraFrozen = false;
    window.__SKYDRIFT__ = {
        setProgress: setLiveProgress,
        setSkyT: setLiveSkyT,
        getProgress: () => cameraProgress,
        setFrozen: (v) => { cameraFrozen = !!v; },
        cameraRig,
        director,
        ch5Start,
        ch6Start,
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
            if (!scene.fog) scene.fog = new THREE.FogExp2(0x303656, 0.0035);
            scene.fog.color.copy(directorState.atmosphere.fogColor);
            scene.fog.density = directorState.atmosphere.fogDensity;

            updateSkyDriftEnvironment(sky, delta, time, camera, cameraProgress, directorState);
            pathRenderer.setProgress(pathProgress);
            pathRenderer.update(delta, directorState);
        },
        dispose() {
            if (window.__SKYDRIFT__) delete window.__SKYDRIFT__;
            scene.remove(sky);
            disposeObject(sky);
            pathRenderer.dispose();
            scene.remove(fill);
            director.dispose();
        },
    };
}
