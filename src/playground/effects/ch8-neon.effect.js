/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
// CHAPTER 8 — NEON CITY bench (2026-10-20 overhaul).
//
// Mounts the shipping createUrbanDreamsEnvironment() with the real OdysseyPathRenderer (the
// rail), the chapter-8 corridor field, the live OdysseyCameraController/Director and the REAL
// Odyssey post pipeline (bloom + ACES + the per-chapter grade), so the neon city can be judged
// as the game shows it — the city's emitters are authored against that tone curve and its
// 0.85 bloom threshold, and a bare playground frame (no tone map, no bloom) misleads.
//
// URL params:
//   ?effect=ch8-neon&orbit=0&t=9
//   cityT=<0..1>   chapter-8 local progress (0 = the 7->8 boundary, 1 = journey end; default 0.45)
//   p=<0..1>       absolute Odyssey progress override
//   tier=<name>    quality tier (default High)
//   post=0         render without the Odyssey post pipeline
//   hide=a,b       hide every chapter mesh whose name contains one of the words
//   field=0        leave out the chapter-8 corridor field (sheets + motes)
//   air=k:v,...    override the neon air uniforms (e.g. mistDensity:0.012, mistLow:0.07/0.02/0.1)
import * as THREE from 'three/webgpu';
import { CHAPTER_CONFIGS } from '../../core/odyssey/data/chapters.js';
import {
    createUrbanDreamsEnvironment,
    updateUrbanDreamsEnvironment,
} from '../../rendering/odyssey/chapter-environments/urban-dreams.js';
import { resolveChapterBlendState } from '../../rendering/odyssey/ChapterEnvironmentManager.js';
import { OdysseyCameraController } from '../../rendering/odyssey/OdysseyCameraController.js';
import { OdysseyDirector } from '../../rendering/odyssey/composition/OdysseyDirector.js';
import { OdysseyCorridorField } from '../../rendering/odyssey/composition/odyssey-corridor-field.js';
import { OdysseyPathRenderer } from '../../rendering/odyssey/OdysseyPathRenderer.js';
import { OdysseyTslPipeline } from '../../rendering/odyssey/odyssey-post/odyssey-tsl-pipeline.js';
import {
    getActiveOdysseyChapterPositions,
    getActiveOdysseyPathData,
    getOdysseyPathCurve,
} from '../../rendering/odyssey/path-utils.js';

export const meta = {
    id: 'ch8-neon',
    title: 'Ch8 Neon city (chapter + rail + Odyssey post)',
    description: 'Chapter 8 with the real rail, camera, corridor field and the Odyssey bloom/ACES grade.',
};

const num = (params, key, fallback) => {
    const value = Number.parseFloat(params.get(key));
    return Number.isFinite(value) ? value : fallback;
};

function disposeObject(root) {
    root.traverse?.((child) => {
        child.geometry?.dispose?.();
        const { material } = child;
        if (Array.isArray(material)) material.forEach((m) => m.dispose?.());
        else material?.dispose?.();
    });
}

export function create({
    scene, camera, renderer, params, sizes,
}) {
    const positions = getActiveOdysseyChapterPositions();
    const ch8Start = positions[7];
    const toProgress = (t) => THREE.MathUtils.clamp(THREE.MathUtils.lerp(ch8Start, 1, t), 0, 1);
    let progress = params.has('p')
        ? THREE.MathUtils.clamp(num(params, 'p', ch8Start), 0, 1)
        : toProgress(THREE.MathUtils.clamp(num(params, 'cityT', 0.45), 0, 1));

    camera.near = 0.1;
    camera.far = 9000;
    camera.updateProjectionMatrix();

    const env = createUrbanDreamsEnvironment({ qualityTier: params.get('tier') || 'High' });
    env.userData.chapterCoverage = 1;
    scene.add(env);

    // air=mistDensity:0.012,hazeDistance:700,mistLow:0.07/0.02/0.1 — A/B the neon city's air
    // uniforms (odyssey-neon-light.tsl.js) without a rebuild.
    (params.get('air') || '').split(',').filter(Boolean).forEach((pair) => {
        const [key, raw = ''] = pair.split(':');
        const target = env.userData.neon?.[key];
        if (!target) return;
        const values = raw.split('/').map(Number);
        if (values.some((v) => !Number.isFinite(v))) return;
        if (target.value?.isVector3 && values.length === 3) target.value.set(...values);
        else if (typeof target.value === 'number') [target.value] = values;
    });

    const hide = (params.get('hide') || '').split(',').map((w) => w.trim()).filter(Boolean);
    if (hide.length) {
        env.traverse((object) => {
            if (object.isMesh && hide.some((word) => object.name.includes(word))) object.visible = false;
        });
    }

    const pathRenderer = new OdysseyPathRenderer(scene, { aaa: true });
    pathRenderer.buildPath(getActiveOdysseyPathData());
    pathRenderer.setProgress(progress);

    const field = params.get('field') === '0'
        ? null
        : new OdysseyCorridorField(scene, { suppressedChapters: [1, 2, 3, 4, 5, 6, 7] });

    const director = new OdysseyDirector({ chapterPositions: positions });
    const cameraRig = new OdysseyCameraController(camera, getOdysseyPathCurve(), {
        chapterPositions: positions,
        levelPositions: [],
        startPosition: progress,
        idleAutoDrift: false,
    });
    cameraRig.setFollowMode({ position: progress, direct: true });
    const blendAt = (p) => resolveChapterBlendState(p, CHAPTER_CONFIGS, positions);
    let directorState = director.update(1 / 60, { ascentProgress: progress, blendState: blendAt(progress) });

    // The renderer must stay LINEAR: the Odyssey post owns the tone map (as the board sets it).
    const postEnabled = params.get('post') !== '0';
    let post = null;
    if (postEnabled) {
        renderer.toneMapping = THREE.NoToneMapping;
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        post = new OdysseyTslPipeline(renderer, scene, camera, {
            enableBloom: true,
            bloomStrength: 0.32,
            bloomThreshold: 0.85,
            bloomRadius: 0.7,
            sceneSamples: 4,
        });
        post.setSize(Math.max(1, sizes?.width || 1280), Math.max(1, sizes?.height || 720));
    }

    const driveCamera = () => {
        cameraRig.setCurrentPosition(progress);
        cameraRig.setDirectorState(directorState);
        cameraRig.updateDirectorCamera(2);
        cameraRig.updateChapterFraming(2);
        cameraRig.updateFollowPosition({ position: progress, direct: true });
        camera.up.copy(cameraRig.followCameraUp);
        camera.lookAt(cameraRig.lookAtTarget);
        cameraRig.applyFramingRoll();
        camera.fov = cameraRig._resolveBaseFov();
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld(true);
    };

    let lastTime = null;
    window.__CH8_NEON__ = {
        env,
        cameraRig,
        setCityT: (t) => { progress = toProgress(t); return progress; },
        setProgress: (p) => { progress = THREE.MathUtils.clamp(p, 0, 1); return progress; },
    };

    return {
        camera: driveCamera,
        update(time) {
            const delta = lastTime === null ? 1 / 60 : Math.max(0, Math.min(0.05, time - lastTime));
            lastTime = time;
            // The director smooths its state by dt: a fixed ?t= frame (delta 0) would never settle.
            directorState = director.update(1 / 60, { ascentProgress: progress, blendState: blendAt(progress) });
            driveCamera();
            updateUrbanDreamsEnvironment(env, delta, time, camera, progress, directorState);
            pathRenderer.setProgress(progress);
            pathRenderer.update(delta, directorState);
            field?.update(camera, progress, delta);
            post?.update(delta, directorState);
        },
        render() {
            if (post) post.render();
            else renderer.render(scene, camera);
        },
        resize(w, h) {
            post?.setSize(Math.max(1, w), Math.max(1, h));
        },
        getDiagnostics() {
            return {
                progress,
                reveal: env.userData.reveal,
                camera: camera.position.toArray().map((v) => Number(v.toFixed(2))),
            };
        },
        dispose() {
            delete window.__CH8_NEON__;
            scene.remove(env);
            disposeObject(env);
            pathRenderer.dispose();
            field?.dispose();
            post?.dispose?.();
            director.dispose();
        },
    };
}
