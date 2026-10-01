/* eslint-disable import/no-unresolved */
import * as THREE from 'three/webgpu';
import { OceanAtmosphereSystem } from '../../themes/ocean/ocean-atmosphere-system.js';
import { OceanFishSystem } from '../../themes/ocean/ocean-fish-system.js';
import { OceanPost } from '../../themes/ocean/ocean-post.js';
import { createOceanFogNode as createReefFogNode, OCEAN_WATER_COLOR } from '../../themes/ocean/ocean-fog-profile.js';
import { createModularCoralNodeMaterial, createWaterSurfaceNodeMaterial as createReefWaterMaterial, createSeabedNodeMaterial as createReefSandMaterial } from '../../themes/ocean/ocean-materials.js';
import { createCoralBatch, createCoralModuleLibrary, createCoralPlacementPlan } from '../../themes/ocean/ocean-coral-modules.js';

import { applyReefComposition, getReefSeabedHeight, updateReefCamera } from '../../themes/ocean/ocean-composition.js';
import { createOceanReefParticles } from '../../themes/ocean/ocean-particles.js';
import { createReefJellyfishPreview, createModeledReefJellyfishPreview } from './ocean-reef-jellyfish.js';

export const meta = {
    id: 'ocean-reef-light',
    title: 'Ocean — reef light study',
    description: 'Shipping reef assets with refractive water, sand caustics and restrained camera staging.',
};

export function create({
    scene, camera, renderer, params, rng = Math.random,
}) {
    const low = ['Low', 'Minimal'].includes(params.get('quality'));
    let quality = low ? 'Low' : 'High';
    if (['Ultra', 'Extreme'].includes(params.get('quality'))) quality = params.get('quality');
    const extreme = quality === 'Extreme';
    const advancedPost = extreme || quality === 'Ultra';
    const authored = params.get('models') === 'blender';
    const biodiversity = params.get('life') === '1';
    const heroCoralCount = authored && !low ? 4 : 2;
    const preset = {
        fishCount: low ? 100 : 240,
        heroFishCount: biodiversity ? 7 : 0,
        atmosphere: {
            blenderAssets: authored,
            biodiversityAssets: biodiversity,
            rayCount: low ? 2 : 4,
            rayStrength: 0.82,
            hazeLayers: low ? 1 : 3,
            hazeStrength: 0.22,
            reefCount: low ? 4 : 8,
            archCount: low ? 1 : 4,
            glowAnchors: low ? 2 : 11,
            beamDustCount: low ? 36 : 240,
            occluderCount: 0,
            biomeSilhouetteCount: low ? 0 : 4,
            foregroundRockCount: low ? 2 : 4,
            coralOvergrowthPerRock: 2,
            reefWallCount: low ? 2 : 4,
            coralCarpetPatchCount: low ? 0 : 2,
            importedSeabedDetailCount: low ? 0 : 10,
            tubeCoralClusterCount: 2,
            plateCoralShelfCount: 2,
            heroCoralCount,
            heroKelpCount: low ? 4 : 9,
        },
    };
    scene.background = new THREE.Color(OCEAN_WATER_COLOR);
    renderer.setClearColor(OCEAN_WATER_COLOR);
    // Reproduce the nested RTT clear-state bug without changing the shipping scene.
    if (params.get('rendererClearOnly') === '1') scene.background = null;
    scene.fogNode = createReefFogNode(quality);
    renderer.toneMapping = THREE.NoToneMapping;
    camera.near = 0.5;
    camera.far = 350;
    const waterGeometry = new THREE.PlaneGeometry(500, 500, 64, 64);
    waterGeometry.rotateX(Math.PI / 2);
    const waterMaterial = createReefWaterMaterial({ sunApertureStrength: 1.13 });
    const water = new THREE.Mesh(waterGeometry, waterMaterial);
    water.position.y = 72;
    scene.add(water);

    const sandGeometry = new THREE.PlaneGeometry(400, 400, low ? 80 : 150, low ? 80 : 150);
    sandGeometry.rotateX(-Math.PI / 2);
    const pos = sandGeometry.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, getReefSeabedHeight(pos.getX(i), pos.getZ(i)));
    sandGeometry.computeVertexNormals();
    const sandMaterial = createReefSandMaterial({ detailLevel: quality, rippleStrength: low ? 1 : 2.2, causticStrength: 0.78 });
    const sand = new THREE.Mesh(sandGeometry, sandMaterial);
    scene.add(sand);
    const ambient = new THREE.AmbientLight(0x527d60, 0.28);
    const sun = new THREE.DirectionalLight(0xf3e6a6, 1.62);
    sun.position.set(-12, 124, -100);
    sun.target.position.set(0, -8, -24);
    const hemi = new THREE.HemisphereLight(0xc4e6ae, 0x394530, 0.64);
    scene.add(ambient, sun, sun.target, hemi);
    const atmosphere = new OceanAtmosphereSystem({
        scene, camera, preset, getSeabedHeight: getReefSeabedHeight, isWebGPU: true,
    });
    atmosphere.initCritical();
    atmosphere.initDeferred();
    applyReefComposition(atmosphere);
    const fish = new OceanFishSystem({
        scene, camera, preset, getSeabedHeight: getReefSeabedHeight, isWebGPU: true,
    });
    fish.init();
    const particles = createOceanReefParticles({
        rng,
        planktonCount: low ? 160 : 360,
        bubbleCount: low ? 90 : 180,
        getSeabedHeight: getReefSeabedHeight,
    });
    scene.add(particles.group);
    let disposed = false;
    let jellyfish = authored ? null : createReefJellyfishPreview();
    if (jellyfish) scene.add(jellyfish.mesh);
    const jellyfishReady = authored ? createModeledReefJellyfishPreview().then((model) => {
        if (disposed) { model.dispose(); return; }
        jellyfish = model;
        scene.add(model.mesh);
    }) : Promise.resolve();
    const library = createCoralModuleLibrary({ detail: low ? 'Low' : 'High' });
    const gardens = [{
        x: -42, z: 22, radius: 12, warmth: 0.95,
    }, {
        x: 44, z: 20, radius: 13, warmth: 1,
    },
    {
        x: -54, z: -24, radius: 20, warmth: 0.72,
    }, {
        x: 57, z: -30, radius: 21, warmth: 0.78,
    },
    {
        x: -68, z: -82, radius: 26, warmth: 0.48,
    }, {
        x: 72, z: -88, radius: 27, warmth: 0.5,
    }];
    const placements = createCoralPlacementPlan({
        count: low ? 18 : 42, gardens, getSeabedHeight: getReefSeabedHeight, random: rng,
    });
    const coralMaterial = createModularCoralNodeMaterial();
    const coral = createCoralBatch({
        library, placements, material: coralMaterial, disposeSourceGeometries: true,
    });
    scene.add(coral);
    const post = new OceanPost(renderer, scene, camera, {
        useMRT: false,
        bloomStrength: low ? 0 : 0.085,
        bloomThreshold: 0.88,
        bloomRadius: 0.36,
        bloomScale: 0.55,
        sceneScale: 0.9,
        gradeStrength: 0.66,
        blackLift: 0.025,
        vignetteDarkness: 0.20,
        shaftSamples: { Ultra: 2, Extreme: 4 }[quality] ?? 0,
        shaftStrength: advancedPost ? 0.95 : 0,
        refractionEnabled: !low,
        refractionStrength: 0.34,
        chromaticAberrationEnabled: advancedPost,
        chromaStrength: advancedPost ? 0.0014 : 0,
        dofEnabled: extreme,
        dofStrength: extreme ? 0.82 : 0,
        dofMaxRadius: 0.0016,
        dofDeadZone: 0.035,
        focalDepth: 0.12,
        fogDensity: 0.24,
        exposure: 0.84,
    });
    let lastTime = null;
    return {
        camera(time, cam) { updateReefCamera(cam, time); },
        update(time, dt) {
            waterMaterial.userData.uTime.value = time;
            sandMaterial.userData.uTime.value = time;
            coralMaterial.userData.uTime.value = time;
            applyReefComposition(atmosphere);
            atmosphere.update(time);
            particles.update(time, 0.5, 0.65);
            jellyfish?.update(time, camera);
            if (lastTime !== time) fish.update(Math.min(dt || 0.016, 0.05), time, {});
            lastTime = time;
            post.updateTime(time);
        },
        render() { post.render(); },
        async renderAsync() {
            await jellyfishReady;
            await fish.schoolModelLoadPromise;
            if (biodiversity) {
                while (fish.activateNextSchool()) { /* Show every habitat in the isolated study. */ }
                fish.activateHeroFish();
                for (let i = 0; i < fish.totalSchoolFish; i++) {
                    const school = fish.schoolIndices[i];
                    const center = fish.schoolSeeds[school * 4];
                    fish.positions[i * 3] += center - Math.sign(center) * 175;
                }
                fish.updateMatrices();
                fish.meshes.forEach((mesh) => mesh?.userData.update?.(Number(params.get('t') || 8)));
                fish.initHeroAssetLayer();
                await fish.heroAssetLoadPromise;
                fish.heroAssetCreatures.forEach((creature, index) => {
                    creature.group.position.set(index ? 39 : -30, index ? 31 : 42, index ? -12 : -35);
                    creature.materials.forEach((material) => { material.opacity = 1; });
                    creature.mixer?.setTime(Number(params.get('t') || 8));
                });
            }
            await renderer.compileAsync(scene, camera);
            post.render();
        },
        resize(w, h) { post.setSize(w, h); },
        getDiagnostics() {
            return {
                loaded: atmosphere.isSceneReady(),
                quality,
                camera: camera.position.toArray(),
                fish: fish.collectSignoff(),
                atmosphere: atmosphere.collectSignoff(),
            };
        },
        dispose() {
            disposed = true;
            atmosphere.dispose(); fish.dispose(); particles.dispose(); post.dispose();
            jellyfish?.dispose();
            for (const mesh of [water, sand, coral]) { scene.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); }
            scene.remove(ambient, sun, sun.target, hemi);
            scene.fogNode = null;
        },
    };
}
