/* eslint-disable import/no-extraneous-dependencies, import/no-unresolved */
import * as THREE from 'three/webgpu';
import { float, vec3 } from 'three/tsl';

import { createStillwaterForest } from '../../themes/stillwater/rendering/stillwater-forest.js';

function readBoolean(params, key, fallback = false) {
    if (!params?.has?.(key)) return fallback;
    return !['0', 'false', 'off', 'no'].includes(
        String(params.get(key) || '').toLowerCase(),
    );
}

function createBoardGuide(camera, scene) {
    const cameraHadParent = Boolean(camera.parent);
    if (!cameraHadParent) scene.add(camera);

    const geometry = new THREE.PlaneGeometry(1, 1);
    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = vec3(0.020, 0.070, 0.064);
    material.opacityNode = float(0.13);
    material.transparent = true;
    material.depthTest = false;
    material.depthWrite = false;
    material.toneMapped = false;

    const plane = new THREE.Mesh(geometry, material);
    plane.name = 'stillwater-wave4-board-guide';
    plane.renderOrder = 10000;
    camera.add(plane);

    const resize = () => {
        const distance = 1.2;
        const viewHeight = 2
            * Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5))
            * distance;
        const viewWidth = viewHeight * camera.aspect;
        plane.position.set(0, 0, -distance);
        plane.scale.set(viewWidth * 0.36, viewHeight * 0.82, 1);
    };
    resize();

    return {
        resize,
        dispose() {
            camera.remove(plane);
            if (!cameraHadParent) scene.remove(camera);
            geometry.dispose();
            material.dispose();
        },
    };
}

export function createStillwaterWave4Playground({
    scene,
    camera,
    renderer,
    params,
    sizes,
}, {
    mode,
    id,
    debugKey,
}) {
    const quality = params?.get?.('quality') || 'High';
    const reducedMotion = readBoolean(params, 'reducedMotion', false);
    const showBoardGuide = readBoolean(params, 'boardGuide', false);
    const previous = {
        background: scene.background,
        fog: scene.fog,
        toneMapping: renderer.toneMapping,
        exposure: renderer.toneMappingExposure,
        fov: camera.fov,
        near: camera.near,
        far: camera.far,
        position: camera.position.clone(),
        quaternion: camera.quaternion.clone(),
    };

    scene.background = new THREE.Color(0x071713);
    scene.fog = new THREE.FogExp2(0x18332d, 0.0065);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.88;

    let viewport = {
        width: sizes?.width || window.innerWidth,
        height: sizes?.height || window.innerHeight,
    };
    const runtime = createStillwaterForest({
        scene,
        camera,
        renderer,
        quality,
        mode,
        reducedMotion,
    });
    const boardGuide = showBoardGuide ? createBoardGuide(camera, scene) : null;

    const applyCamera = () => {
        const aspect = Math.max(0.5, viewport.width / Math.max(1, viewport.height));
        const narrowPullback = aspect < 1.68 ? 4 : 0;
        camera.position.set(0, 25.5, 80 + narrowPullback);
        camera.lookAt(0, 21, -54);
        camera.fov = aspect > 2.05 ? 43 : 47;
        camera.near = 0.1;
        camera.far = 850;
        camera.updateProjectionMatrix();
        boardGuide?.resize();
    };
    applyCamera();

    const debugApi = Object.freeze({
        pulse: runtime.pulse,
        setQuality: runtime.setQuality,
        setReducedMotion: runtime.setReducedMotion,
        getResourceState: runtime.getResourceState,
        getDiagnostics: () => ({
            id,
            backend: renderer.backend?.isWebGPUBackend ? 'WebGPU' : 'WebGL2',
            boardGuide: showBoardGuide,
            ...runtime.getDiagnostics(),
        }),
    });
    window[debugKey] = debugApi;

    return {
        ...debugApi,
        camera() {
            applyCamera();
        },
        update(time, delta) {
            runtime.update(time, delta);
        },
        resize(width, height) {
            viewport = { width, height };
            applyCamera();
        },
        dispose() {
            if (window[debugKey] === debugApi) delete window[debugKey];
            boardGuide?.dispose();
            runtime.dispose();
            scene.background = previous.background;
            scene.fog = previous.fog;
            renderer.toneMapping = previous.toneMapping;
            renderer.toneMappingExposure = previous.exposure;
            camera.fov = previous.fov;
            camera.near = previous.near;
            camera.far = previous.far;
            camera.position.copy(previous.position);
            camera.quaternion.copy(previous.quaternion);
            camera.updateProjectionMatrix();
            camera.clearViewOffset?.();
        },
    };
}

export default createStillwaterWave4Playground;
