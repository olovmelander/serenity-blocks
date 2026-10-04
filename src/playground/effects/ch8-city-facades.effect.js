/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
// The shipping chapter and opacity collector: catches tower intersections and seam bleed
// that an opaque, standalone material preview misses. ?cityT=0..1&coverage=0..1&t=8
import * as THREE from 'three/webgpu';
import { CHAPTER_CONFIGS } from '../../core/odyssey/data/chapters.js';
import {
    createUrbanDreamsEnvironment,
    updateUrbanDreamsEnvironment,
} from '../../rendering/odyssey/chapter-environments/urban-dreams.js';
import {
    ChapterEnvironmentManager,
    resolveChapterBlendState,
} from '../../rendering/odyssey/ChapterEnvironmentManager.js';
import { OdysseyCameraController } from '../../rendering/odyssey/OdysseyCameraController.js';
import { OdysseyDirector } from '../../rendering/odyssey/composition/OdysseyDirector.js';
import {
    getActiveOdysseyChapterPositions,
    getOdysseyPathCurve,
} from '../../rendering/odyssey/path-utils.js';

export const meta = {
    id: 'ch8-city-facades',
    title: 'Ch8 City facades (shipping chapter + crossfade)',
    description: 'Urban towers and windows with the production camera, depth and chapter-opacity handling.',
};

const number = (params, key, fallback) => {
    const value = Number.parseFloat(params.get(key));
    return Number.isFinite(value) ? value : fallback;
};

export function create({ scene, camera, params }) {
    const positions = getActiveOdysseyChapterPositions();
    const cityT = THREE.MathUtils.clamp(number(params, 'cityT', 0.5), 0, 1);
    const progress = THREE.MathUtils.lerp(positions[7], 1, cityT);
    const coverage = THREE.MathUtils.clamp(number(params, 'coverage', 1), 0, 1);
    const env = createUrbanDreamsEnvironment({ qualityTier: params.get('tier') || 'High' });
    scene.add(env);
    const manager = ChapterEnvironmentManager.prototype;
    const targets = manager._collectOpacityTargets(env);
    manager.setGroupOpacity(targets, coverage, coverage);
    env.userData.chapterCoverage = coverage;
    if (params.get('facadesOnly') === '1') {
        env.traverse((object) => {
            if (object.isMesh && object !== env.userData.cityTowers) object.visible = false;
        });
        scene.background = new THREE.Color(0x080815);
    }

    camera.near = 0.1;
    camera.far = 12000;
    const director = new OdysseyDirector({ chapterPositions: positions });
    const cameraRig = new OdysseyCameraController(camera, getOdysseyPathCurve(), {
        chapterPositions: positions,
        levelPositions: [],
        startPosition: progress,
        idleAutoDrift: false,
    });
    cameraRig.setFollowMode({ position: progress, direct: true });
    const blendState = resolveChapterBlendState(progress, CHAPTER_CONFIGS, positions);
    const directorState = director.update(1 / 60, { ascentProgress: progress, blendState });
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
    window.__CH8_CITY__ = { env, cameraRig };
    return {
        camera: driveCamera,
        update(time) {
            driveCamera();
            updateUrbanDreamsEnvironment(env, 0, time, camera, progress, directorState);
        },
        getDiagnostics() {
            const { cityTowers } = env.userData;
            return {
                cityT,
                coverage,
                towers: cityTowers.count,
                transparent: cityTowers.material.transparent,
                depthWrite: cityTowers.material.depthWrite,
                renderOrder: cityTowers.renderOrder,
            };
        },
        dispose() {
            delete window.__CH8_CITY__;
            scene.remove(env);
            const geometries = new Set();
            const materials = new Set();
            env.traverse((object) => {
                if (object.geometry) geometries.add(object.geometry);
                const list = Array.isArray(object.material) ? object.material : [object.material];
                list.forEach((material) => { if (material) materials.add(material); });
            });
            geometries.forEach((geometry) => geometry.dispose());
            materials.forEach((material) => material.dispose());
            director.dispose();
        },
    };
}
