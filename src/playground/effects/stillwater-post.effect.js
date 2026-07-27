/**
 * Stillwater Wave 6 selective-bloom and grade pilot.
 *
 * Query contract:
 *   ?effect=stillwater-post&quality=High&bloom=on&grade=full&t=8
 *   ?effect=stillwater-post&quality=Low&bloom=off&grade=full&t=8
 */

import * as THREE from 'three/webgpu';
import {
    vec3,
} from 'three/tsl';
import { getStillwaterQualityProfile } from '../../themes/stillwater/stillwater-quality.js';
import {
    StillwaterPipeline,
    configureStillwaterSelectiveBloomMaterial,
    getStillwaterPostConfig,
} from '../../themes/stillwater/post/stillwater-pipeline.js';

export const meta = {
    id: 'stillwater-post',
    title: 'Stillwater · Selective Ivory Post',
    description: 'MRT emissive bloom, ACES, nonlinear teal/warm grade, vignette, and dither.',
};

function readToggle(params, key, fallback = true) {
    if (!params?.has?.(key)) return fallback;
    return !['0', 'off', 'false', 'no'].includes(
        String(params.get(key)).toLowerCase(),
    );
}

function rendererCounters(renderer) {
    const render = renderer.info?.render || {};
    return {
        calls: render.drawCalls ?? render.calls ?? 0,
        triangles: render.triangles ?? 0,
        geometries: renderer.info?.memory?.geometries ?? 0,
        textures: renderer.info?.memory?.textures ?? 0,
        programs: renderer.info?.programs ? renderer.info.programs.length : null,
    };
}

export function create({
    scene,
    camera,
    renderer,
    sizes,
    params,
}) {
    const qualityProfile = getStillwaterQualityProfile(
        params?.get?.('quality') || 'High',
    );
    const bloomEnabled = readToggle(params, 'bloom', true);
    const gradeMode = String(params?.get?.('grade') || 'full').toLowerCase() === 'aces'
        ? 'aces'
        : 'full';
    const postConfig = getStillwaterPostConfig({
        qualityProfile,
        bloomEnabled,
        gradeMode,
    });
    const previous = {
        background: scene.background,
        fog: scene.fog,
        fogNode: scene.fogNode,
        fov: camera.fov,
        near: camera.near,
        far: camera.far,
        position: camera.position.clone(),
        quaternion: camera.quaternion.clone(),
    };
    const root = new THREE.Group();
    root.name = 'stillwater-post-pilot';
    const geometries = new Set();
    const materials = new Set();
    const ownGeometry = (geometry) => {
        geometries.add(geometry);
        return geometry;
    };
    const ownMaterial = (material, emissiveNode = null) => {
        materials.add(material);
        if (postConfig.useMRT) {
            configureStillwaterSelectiveBloomMaterial(material, emissiveNode);
        }
        return material;
    };

    scene.background = new THREE.Color(0x071713);
    scene.fog = null;
    scene.fogNode = null;

    const groundMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial());
    groundMaterial.colorNode = vec3(0.025, 0.075, 0.058);
    const ground = new THREE.Mesh(
        ownGeometry(new THREE.PlaneGeometry(44, 34, 1, 1)),
        groundMaterial,
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -2.8, -2);
    root.add(ground);

    const lakeMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial({
        transparent: true,
        opacity: 0.94,
    }));
    lakeMaterial.colorNode = vec3(0.025, 0.11, 0.12);
    const lake = new THREE.Mesh(
        ownGeometry(new THREE.CircleGeometry(12, 64)),
        lakeMaterial,
    );
    lake.rotation.x = -Math.PI / 2;
    lake.scale.set(1.5, 0.8, 1);
    lake.position.set(0, -2.68, 0);
    root.add(lake);

    const trunkMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial());
    trunkMaterial.colorNode = vec3(0.025, 0.06, 0.045);
    const trunks = new THREE.InstancedMesh(
        ownGeometry(new THREE.CylinderGeometry(0.55, 1.05, 15, 7, 1)),
        trunkMaterial,
        10,
    );
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const euler = new THREE.Euler();
    for (let index = 0; index < 10; index += 1) {
        const side = index % 2 === 0 ? -1 : 1;
        const depth = Math.floor(index / 2);
        position.set(side * (11 + depth * 1.5), 4.2, 4 - depth * 5.2);
        quaternion.setFromEuler(euler.set(0, side * 0.08, side * 0.025));
        scale.set(0.8 + depth * 0.08, 1 + depth * 0.07, 0.9);
        matrix.compose(position, quaternion, scale);
        trunks.setMatrixAt(index, matrix);
    }
    trunks.instanceMatrix.needsUpdate = true;
    trunks.computeBoundingSphere();
    root.add(trunks);

    const spirit = new THREE.Group();
    spirit.name = 'stillwater-post-emissive-spirit';
    spirit.position.set(-5.2, 1.7, -2.4);

    const coreEmission = vec3(3.1, 2.35, 1.36);
    const coreMaterial = ownMaterial(
        new THREE.MeshBasicNodeMaterial(),
        coreEmission,
    );
    coreMaterial.colorNode = vec3(0.72, 0.52, 0.26)
        .add(coreEmission.mul(0.13));
    const core = new THREE.Mesh(
        ownGeometry(new THREE.SphereGeometry(0.72, 28, 20)),
        coreMaterial,
    );
    core.scale.set(0.72, 1.45, 0.72);
    core.name = 'stillwater-post-ivory-core';
    spirit.add(core);

    const bodyMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial({
        transparent: true,
        opacity: 0.2,
        depthWrite: false,
        blending: THREE.NormalBlending,
        side: THREE.DoubleSide,
    }));
    bodyMaterial.colorNode = vec3(0.96, 0.82, 0.56);
    const body = new THREE.Mesh(
        ownGeometry(new THREE.SphereGeometry(1.45, 32, 24)),
        bodyMaterial,
    );
    body.scale.set(0.7, 1.55, 0.52);
    body.name = 'stillwater-post-translucent-body';
    spirit.add(body);

    const auraMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial({
        transparent: true,
        opacity: 0.12,
        depthWrite: false,
        blending: THREE.NormalBlending,
        side: THREE.BackSide,
    }));
    auraMaterial.colorNode = vec3(0.86, 0.72, 0.48);
    const aura = new THREE.Mesh(
        ownGeometry(new THREE.SphereGeometry(1.8, 24, 18)),
        auraMaterial,
    );
    aura.scale.set(0.74, 1.48, 0.62);
    const auraBaseScale = aura.scale.clone();
    aura.name = 'stillwater-post-nonemissive-aura';
    spirit.add(aura);

    const filamentEmission = vec3(1.9, 1.24, 0.58);
    const filamentMaterial = ownMaterial(
        new THREE.MeshBasicNodeMaterial(),
        filamentEmission,
    );
    filamentMaterial.colorNode = vec3(0.56, 0.34, 0.13)
        .add(filamentEmission.mul(0.12));
    for (let index = 0; index < 4; index += 1) {
        const side = index % 2 === 0 ? -1 : 1;
        const curve = new THREE.CatmullRomCurve3([
            new THREE.Vector3(side * (0.16 + index * 0.06), 0.4, 0),
            new THREE.Vector3(side * (0.45 + index * 0.08), 1.2, -0.05 * index),
            new THREE.Vector3(side * (0.72 + index * 0.1), 2.1, -0.1),
            new THREE.Vector3(side * (0.48 + index * 0.08), 3.2, 0.02),
        ]);
        const filament = new THREE.Mesh(
            ownGeometry(new THREE.TubeGeometry(curve, 20, 0.035, 5, false)),
            filamentMaterial,
        );
        filament.name = `stillwater-post-emissive-filament-${index}`;
        spirit.add(filament);
    }
    root.add(spirit);

    // Deliberately brighter than the spirit in the scene-color channel, but its
    // explicit zero-emissive MRT role proves that bright fog/sky objects do not bloom.
    const negativeMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial());
    negativeMaterial.colorNode = vec3(3.4, 3.4, 3.4);
    const negativeControl = new THREE.Mesh(
        ownGeometry(new THREE.SphereGeometry(0.82, 28, 20)),
        negativeMaterial,
    );
    negativeControl.name = 'stillwater-post-bright-nonemissive-negative-control';
    negativeControl.position.set(6.2, 1.8, -2.2);
    root.add(negativeControl);

    const pedestalMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial());
    pedestalMaterial.colorNode = vec3(0.09, 0.16, 0.13);
    const pedestalGeometry = ownGeometry(new THREE.CylinderGeometry(1.35, 1.8, 0.42, 28));
    const spiritPedestal = new THREE.Mesh(pedestalGeometry, pedestalMaterial);
    spiritPedestal.position.set(-5.2, -0.05, -2.4);
    root.add(spiritPedestal);
    const controlPedestal = new THREE.Mesh(pedestalGeometry, pedestalMaterial);
    controlPedestal.position.set(6.2, -0.05, -2.2);
    root.add(controlPedestal);

    const boardMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial({
        transparent: true,
        opacity: 0.62,
    }));
    boardMaterial.colorNode = vec3(0.018, 0.045, 0.038);
    const boardAperture = new THREE.Mesh(
        ownGeometry(new THREE.PlaneGeometry(6.4, 12.5, 1, 1)),
        boardMaterial,
    );
    boardAperture.position.set(0, 3.6, -5.2);
    boardAperture.name = 'stillwater-post-board-aperture';
    root.add(boardAperture);

    scene.add(root);

    const pipeline = new StillwaterPipeline(renderer, scene, camera, {
        qualityProfile,
        bloomEnabled,
        gradeMode,
        bloomStrength: 0.48,
        bloomRadius: 0.62,
        exposure: 0.94,
    });
    pipeline.setSize(
        sizes?.width || window.innerWidth,
        sizes?.height || window.innerHeight,
    );

    const diagnostics = {
        id: meta.id,
        wave: 6,
        backend: renderer.backend?.isWebGPUBackend ? 'WebGPU' : 'WebGL2',
        quality: qualityProfile.name,
        gradeMode,
        requestedBloom: bloomEnabled,
        post: pipeline.getDiagnostics(),
        emissiveControl: core.name,
        nonEmissiveNegativeControl: negativeControl.name,
        negativeControlHdrValue: 3.4,
    };
    const debugApi = Object.freeze({
        getDiagnostics: () => diagnostics,
        getRendererCounters: () => rendererCounters(renderer),
        getResourceState: () => ({
            ...rendererCounters(renderer),
            post: pipeline.getResourceState(),
            pilotGeometries: geometries.size,
            pilotMaterials: materials.size,
            rootObjects: root.children.length,
            negativeControlMaterial: negativeMaterial,
            coreMaterial,
        }),
    });
    window.__STILLWATER_POST__ = debugApi;

    return {
        ...debugApi,
        camera(_time, activeCamera) {
            activeCamera.position.set(0, 5.3, 20.5);
            activeCamera.lookAt(0, 2.8, -3.8);
            activeCamera.fov = 46;
            activeCamera.near = 0.1;
            activeCamera.far = 160;
            activeCamera.updateProjectionMatrix();
        },
        update(time) {
            spirit.position.y = 1.7 + Math.sin(time * 0.42) * 0.12;
            spirit.rotation.y = Math.sin(time * 0.17) * 0.05;
            aura.scale.copy(auraBaseScale)
                .multiplyScalar(1 + Math.sin(time * 0.51) * 0.025);
        },
        render: () => pipeline.render(),
        renderAsync: () => pipeline.renderAsync(),
        resize: (width, height) => pipeline.resize(width, height),
        dispose() {
            if (window.__STILLWATER_POST__ === debugApi) {
                delete window.__STILLWATER_POST__;
            }
            pipeline.dispose();
            scene.remove(root);
            geometries.forEach((geometry) => geometry.dispose());
            materials.forEach((material) => material.dispose());
            scene.background = previous.background;
            scene.fog = previous.fog;
            scene.fogNode = previous.fogNode;
            camera.fov = previous.fov;
            camera.near = previous.near;
            camera.far = previous.far;
            camera.position.copy(previous.position);
            camera.quaternion.copy(previous.quaternion);
            camera.updateProjectionMatrix();
        },
    };
}
