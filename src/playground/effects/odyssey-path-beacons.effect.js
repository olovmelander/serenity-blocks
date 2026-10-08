/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
// Odyssey RIBBON + LEVEL NODE bench (2026-10 seamless pass).
//
// Mounts the SHIPPING OdysseyPathRenderer and LevelNodeManager on the real journey curve,
// driven by the real OdysseyCameraController + OdysseyDirector, over a plain sky/fog backdrop
// per chapter (no chapter environments — this bench is about the ribbon and the nodes, and it
// keeps the GPU load to one small scene). Anything tuned here ports straight into the journey.
//
// URL params:
//   ?effect=odyssey-path-beacons&orbit=0&t=9
//   ch=<1..8>        chapter to stand in (default 3)
//   local=<0..1>     camera position through that chapter (default 0.35)
//   p=<0..1>         absolute camera progress override
//   front=<id>       furthest unlocked level id (default: the 3rd level of the chapter)
//   sel=<id>         selected level id (optional)
//   nodes=0          hide the level nodes
//   cameraMotion=1   run the shipping camera's breathing, fall and lens framing
//   reducedMotion=1  apply the in-game camera comfort preference (OS preference still wins)
//
// Live hook (one page load, many shots): window.__RIBBON__.set({ ch, local, p, front, sel })
// returns a promise that resolves once the camera + node buffers are settled.
// `.travelTo(id, durationMs)` follows the shipping path; `.pauseTravel(bool)` holds it.
import * as THREE from 'three/webgpu';
import { CHAPTER_CONFIGS } from '../../core/odyssey/data/chapters.js';
import { LEVEL_CONFIGS } from '../../core/odyssey/data/levels.js';
import { applyOdysseyLayoutToLevels } from '../../core/odyssey/data/odyssey-layout.js';
import { OdysseyCameraController } from '../../rendering/odyssey/OdysseyCameraController.js';
import { OdysseyDirector } from '../../rendering/odyssey/composition/OdysseyDirector.js';
import { OdysseyPathRenderer } from '../../rendering/odyssey/OdysseyPathRenderer.js';
import { LevelNodeManager } from '../../rendering/odyssey/LevelNodeManager.js';
import {
    getActiveOdysseyChapterPositions,
    getActiveOdysseyPathData,
    getOdysseyPathCurve,
} from '../../rendering/odyssey/path-utils.js';
import { resolveChapterBlendState } from '../../rendering/odyssey/ChapterEnvironmentManager.js';
import { getChapterProfile } from '../../rendering/odyssey/chapter-environments/shared/chapter-profile.js';

export const meta = {
    id: 'odyssey-path-beacons',
    title: 'Odyssey ribbon + level nodes',
    description: 'The shipping path ribbon and level-node manager on the real curve and camera, per chapter.',
};

const num = (params, key, dflt) => {
    const value = Number.parseFloat(params.get(key));
    return Number.isFinite(value) ? value : dflt;
};
const clamp01 = (value) => THREE.MathUtils.clamp(value, 0, 1);

export function create({ scene, camera, params }) {
    const cameraMotion = params.get('cameraMotion') === '1';
    const chapterPositions = getActiveOdysseyChapterPositions();
    const pathData = getActiveOdysseyPathData();
    const pathCurve = getOdysseyPathCurve();
    const levels = applyOdysseyLayoutToLevels(LEVEL_CONFIGS);

    const state = {
        ch: Math.max(1, Math.min(8, Math.round(num(params, 'ch', 3)))),
        local: clamp01(num(params, 'local', 0.35)),
        p: params.has('p') ? clamp01(num(params, 'p', 0)) : null,
        front: params.has('front') ? Math.round(num(params, 'front', 1)) : null,
        sel: params.has('sel') ? Math.round(num(params, 'sel', 0)) : null,
    };

    camera.near = 0.1;
    camera.far = 9000;
    camera.updateProjectionMatrix();

    const pathRenderer = new OdysseyPathRenderer(scene, { aaa: true });
    pathRenderer.buildPath(pathData);

    const nodeManager = new LevelNodeManager(scene, pathRenderer.pathCurve);
    nodeManager.setCamera(camera);
    nodeManager.setAAAVisualsEnabled(true);
    let nodesReady = false;
    const showNodes = params.get('nodes') !== '0';

    const director = new OdysseyDirector({ chapterPositions });
    const cameraRig = new OdysseyCameraController(camera, pathCurve, {
        chapterPositions,
        levelPositions: levels.map((l) => l.pathPosition),
        startPosition: 0,
        idleAutoDrift: false,
        getReducedMotion: () => params.get('reducedMotion') === '1',
    });

    scene.fog = new THREE.FogExp2(0x000000, 0.002);
    scene.background = new THREE.Color(0x000000);

    let cameraProgress = 0;
    let directorState = null;
    let travelPaused = false;
    let travelling = false;

    function resolveProgress() {
        if (state.p !== null) return state.p;
        const lo = chapterPositions[state.ch - 1] ?? 0;
        const hi = chapterPositions[state.ch] ?? 1;
        return THREE.MathUtils.lerp(lo, hi, state.local);
    }

    function defaultFront() {
        const inChapter = levels.filter((l) => l.chapter === state.ch);
        return (inChapter[2] ?? inChapter[0] ?? levels[0]).id;
    }

    function applyProgressData() {
        const front = state.front ?? defaultFront();
        const levelProgress = {};
        levels.forEach((l) => {
            if (l.id < front) levelProgress[l.id] = { completed: true, stars: 1 + (l.id % 3) };
        });
        nodeManager.updateFromProgress({ furthestLevel: front, levelProgress });
        const frontierP = nodeManager.getFrontierPathPosition();
        pathRenderer.setProgress(Number.isFinite(frontierP) ? frontierP : 0);
        pathRenderer.setFocus?.(nodeManager.getCurrentPathPosition());
        if (nodeManager.selectedNode) nodeManager.setNodeSelected(nodeManager.selectedNode, false);
        if (state.sel) nodeManager.setNodeSelected(state.sel, true);
    }

    function settleCamera() {
        cameraProgress = resolveProgress();
        const blendState = resolveChapterBlendState(cameraProgress, CHAPTER_CONFIGS, chapterPositions);
        directorState = director.update(1 / 60, { ascentProgress: cameraProgress, blendState });
        for (let i = 0; i < 4; i += 1) {
            cameraRig.setCurrentPosition(cameraProgress);
            cameraRig.setDirectorState(directorState);
            cameraRig.updateDirectorCamera(2);
            cameraRig.updateChapterFraming(2);
            cameraRig.updateFollowPosition({ position: cameraProgress, direct: true });
        }
        const atmo = directorState.atmosphere;
        scene.fog.color.copy(atmo.fogColor);
        scene.fog.density = atmo.fogDensity;
        const profile = getChapterProfile(blendState.activeChapter ?? state.ch);
        scene.background.set(profile.atmosphere.skyColor);
        nodeManager.setCameraProgress(cameraProgress);
    }

    function driveCamera() {
        camera.up.copy(cameraRig.followCameraUp);
        camera.lookAt(cameraRig.lookAtTarget);
        camera.fov = directorState?.camera?.fovBase ?? camera.fov;
        camera.updateProjectionMatrix();
    }

    settleCamera();

    const nodesPromise = (async () => {
        await nodeManager.createNodes(levels);
        if (!showNodes) nodeManager.setAllVisible(false);
        applyProgressData();
        nodesReady = true;
    })();

    window.__RIBBON__ = {
        get ready() { return nodesReady; },
        async set(next = {}) {
            cameraRig.setFollowMode();
            travelling = false;
            Object.assign(state, next);
            if (next.p === undefined && (next.ch !== undefined || next.local !== undefined)) state.p = null;
            await nodesPromise;
            applyProgressData();
            settleCamera();
            driveCamera();
            return { cameraProgress, front: state.front ?? defaultFront() };
        },
        async travelTo(levelId, durationMs = 1500) {
            await nodesPromise;
            const node = nodeManager.nodes.get(levelId);
            if (!node) return false;
            state.sel = levelId;
            applyProgressData();
            travelling = true;
            const completed = await cameraRig.travelToPosition(node.pathPosition, durationMs, {
                isPaused: () => travelPaused,
            });
            travelling = false;
            return completed;
        },
        pauseTravel(paused = true) { travelPaused = paused; },
        /** Screen position (px) + distance of every node in front of the camera. */
        probe() {
            const out = [];
            const v = new THREE.Vector3();
            nodeManager.nodes.forEach((node, id) => {
                v.copy(node.group.position);
                const dist = v.distanceTo(camera.position);
                v.project(camera);
                if (v.z < 1 && Math.abs(v.x) < 1.2 && Math.abs(v.y) < 1.2) {
                    out.push({
                        id,
                        x: Math.round((v.x + 1) * 640),
                        y: Math.round((1 - v.y) * 360),
                        d: Math.round(dist),
                    });
                }
            });
            const meshes = {};
            ['glassInstancedMesh', 'glowInstancedMesh', 'innerCoreMesh', 'particleSystem', 'lockInstancedMesh']
                .forEach((key) => {
                    const mesh = nodeManager[key];
                    if (!mesh) return;
                    const m = new THREE.Matrix4();
                    if (mesh.isInstancedMesh && out[0]) mesh.getMatrixAt(nodeManager.instanceIdMap.get(out[0].id), m);
                    meshes[key] = {
                        visible: mesh.visible,
                        inScene: !!mesh.parent,
                        count: mesh.count,
                        firstScale: new THREE.Vector3().setFromMatrixScale(m).x.toFixed(3),
                        renderOrder: mesh.renderOrder,
                    };
                });
            return { cameraProgress, nodes: out, meshes };
        },
        pathRenderer,
        nodeManager,
        cameraRig,
    };

    let lastTime = null;
    return {
        camera() {
            if (!cameraMotion) driveCamera();
        },
        update(time) {
            const delta = lastTime === null ? 1 / 60 : Math.max(0, Math.min(0.05, time - lastTime));
            lastTime = time;
            if (travelling || cameraMotion) {
                cameraRig.update(delta);
                cameraProgress = cameraRig.getCurrentPosition();
                const blendState = resolveChapterBlendState(cameraProgress, CHAPTER_CONFIGS, chapterPositions);
                directorState = director.update(delta, { ascentProgress: cameraProgress, blendState });
                cameraRig.setDirectorState(directorState);
                nodeManager.setCameraProgress(cameraProgress);
            }
            pathRenderer.update(delta, directorState);
            if (nodesReady) nodeManager.update(delta, directorState?.path?.beatPulse ?? 0);
            // Phase lock: the playground's ?t= holds time; the renderer/manager clocks follow it.
            pathRenderer.time = time;
            nodeManager.time = time;
        },
        dispose() {
            cameraRig.setFollowMode();
            if (window.__RIBBON__) delete window.__RIBBON__;
            pathRenderer.dispose();
            nodeManager.dispose();
            director.dispose();
            scene.fog = null;
            scene.background = null;
        },
    };
}
