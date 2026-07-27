/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { FluidDreamsParticleCompute } from '../../themes/fluid-dreams/fluid-dreams-compute.js';
import { createFluidParticleNodeMaterial } from '../../themes/fluid-dreams/fluid-dreams-materials.js';
import { IntroCameraParallax } from '../../ui/intro-camera-parallax.js';

export const meta = {
    id: 'fluid-dreams-particles',
    title: 'Fluid Dreams — Cursor Parallax',
    description: 'The production curl-flow particles with smoothed cursor-driven camera depth.',
};

export function create({
    scene, renderer, params,
}) {
    const count = 9000;
    const sim = new FluidDreamsParticleCompute(count, {
        boundsRadius: 34,
        spawnInner: 5,
        spawnOuter: 28,
        flowStrength: 1.6,
        damping: 0.93,
    });
    sim.createComputeNode();

    const material = createFluidParticleNodeMaterial({
        isWebGPU: true,
        particleCompute: sim,
    });
    const geometry = new THREE.PlaneGeometry(1, 1);
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 40);
    const points = new THREE.InstancedMesh(geometry, material, count);
    points.frustumCulled = false;
    scene.add(points);

    const heroMaterial = new THREE.MeshBasicNodeMaterial();
    const heroColor = uniform(new THREE.Color(0x6a1bff));
    heroMaterial.colorNode = heroColor;
    const hero = new THREE.Mesh(new THREE.IcosahedronGeometry(4.2, 5), heroMaterial);
    hero.position.set(-3.5, -0.4, -3);
    scene.add(hero);
    scene.background = new THREE.Color(0x090316);

    const cameraParallax = new IntroCameraParallax({
        orbitX: 5.5,
        orbitY: 3.6,
        orbitZ: 1.8,
        lookAtGain: 0.22,
        dampRate: 3.8,
    });
    cameraParallax.setPointer(
        Number(params.get('pointerX')) || 0,
        Number(params.get('pointerY')) || 0,
    );
    cameraParallax.attach();
    let frameDelta = params.has('pointerX') || params.has('pointerY') ? 1 : 0;

    return {
        cameraRadius: 22,
        update(time, dt) {
            const delta = Number.isFinite(dt) ? Math.min(dt, 0.1) : 0.016;
            sim.update(delta, { time });
            renderer.compute(sim.computeNode);
            hero.rotation.y = time * 0.08;
            heroColor.value.setHSL(0.72 + Math.sin(time * 0.2) * 0.04, 0.85, 0.48);

            if (delta > 0) frameDelta = delta;
        },
        camera(time, cam) {
            const idleX = 0;
            const idleY = 1.5;
            cam.position.set(idleX, idleY, 22 + Math.sin(time * 0.35) * 1.2);
            cameraParallax.apply(cam, frameDelta, { x: 3.5, y: 0.5, z: 0 });
            points.position.set(
                -(cam.position.x - idleX) * 0.16,
                -(cam.position.y - idleY) * 0.12,
                0,
            );
        },
        dispose() {
            cameraParallax.detach();
            scene.remove(points);
            scene.remove(hero);
            geometry.dispose();
            material.dispose();
            hero.geometry.dispose();
            heroMaterial.dispose();
            sim.dispose();
        },
    };
}
