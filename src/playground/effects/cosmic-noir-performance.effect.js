/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
import * as THREE from 'three/webgpu';
import {
    createAccretionDiskNodeMaterial,
    createAtmosphereNodeMaterial,
    createPlanetGlowSpriteNodeMaterial,
    createPlanetNodeMaterial,
    createStarfieldNodeMaterial,
} from '../../themes/cosmic-noir/cosmic-noir-materials.js';
import { CosmicNoirPost } from '../../themes/cosmic-noir/cosmic-noir-post.js';

export const meta = {
    id: 'cosmic-noir-performance',
    title: 'Cosmic Noir Performance',
    description: 'Focused planet, disk, atmosphere, stars, and scaled post-pass validation scene.',
};

function mulberry32(seed) {
    let value = seed >>> 0;
    return () => {
        value += 0x6d2b79f5;
        let result = Math.imul(value ^ (value >>> 15), 1 | value);
        result ^= result + Math.imul(result ^ (result >>> 7), 61 | result);
        return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
    };
}

function setUniform(uniforms, name, value) {
    if (uniforms?.[name] && 'value' in uniforms[name]) {
        uniforms[name].value = value;
    }
}

function createStarfield(pixelRatio) {
    const random = mulberry32(0xc05c1c);
    const count = 1600;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const twinkles = new Float32Array(count * 2);
    const brightness = new Float32Array(count);

    for (let i = 0; i < count; i += 1) {
        const i2 = i * 2;
        const i3 = i * 3;
        positions[i3] = (random() - 0.5) * 4200;
        positions[i3 + 1] = (random() - 0.5) * 2500;
        positions[i3 + 2] = -300 - random() * 3200;

        const tint = 0.72 + random() * 0.28;
        colors[i3] = tint * 0.9;
        colors[i3 + 1] = tint * 0.94;
        colors[i3 + 2] = tint;
        sizes[i] = 9 + random() * 28;
        twinkles[i2] = random() * Math.PI * 2;
        twinkles[i2 + 1] = 0.35 + random() * 1.15;
        brightness[i] = 0.45 + random() * 0.55;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('aTwinkle', new THREE.BufferAttribute(twinkles, 2));
    geometry.setAttribute('aBrightness', new THREE.BufferAttribute(brightness, 1));

    const { material, uniforms } = createStarfieldNodeMaterial({ pixelRatio });
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    points.renderOrder = -20;
    points.userData.uniforms = uniforms;
    return points;
}

function createAccretionGeometry() {
    const innerRadius = 190;
    const outerRadius = 820;
    const geometry = new THREE.RingGeometry(innerRadius, outerRadius, 48, 24);
    const { position, uv } = geometry.attributes;

    for (let i = 0; i < position.count; i += 1) {
        const x = position.getX(i);
        const y = position.getY(i);
        const radius = Math.hypot(x, y);
        let angle = Math.atan2(y, x);
        if (angle < 0) angle += Math.PI * 2;
        uv.setXY(
            i,
            angle / (Math.PI * 2),
            (radius - innerRadius) / (outerRadius - innerRadius),
        );
    }
    uv.needsUpdate = true;
    return geometry;
}

export function create({
    scene,
    camera,
    renderer,
    params,
}) {
    const previousBackground = scene.background;
    const previousSortObjects = renderer.sortObjects;
    scene.background = new THREE.Color(0x000002);
    renderer.sortObjects = true;

    const group = new THREE.Group();
    scene.add(group);

    const stars = createStarfield(renderer.getPixelRatio());
    group.add(stars);

    const { material: planetMaterial, uniforms: planetUniforms } = createPlanetNodeMaterial({
        fbmOctaves: 4,
    });
    const planet = new THREE.Mesh(new THREE.SphereGeometry(170, 48, 40), planetMaterial);
    planet.renderOrder = 100;
    group.add(planet);

    const { material: glowMaterial } = createPlanetGlowSpriteNodeMaterial({
        color: new THREE.Color(0x303044),
        opacity: 0.18,
    });
    const glow = new THREE.Sprite(glowMaterial);
    glow.scale.set(465, 465, 1);
    glow.position.z = -14;
    glow.renderOrder = 50;
    group.add(glow);

    const { material: diskMaterial, uniforms: diskUniforms } = createAccretionDiskNodeMaterial();
    const disk = new THREE.Mesh(createAccretionGeometry(), diskMaterial);
    disk.rotation.x = Math.PI * 0.42;
    disk.rotation.y = Math.PI * 0.12;
    disk.renderOrder = 102;
    group.add(disk);

    const atmosphereResult = createAtmosphereNodeMaterial();
    const { material: atmosphereMaterial, uniforms: atmosphereUniforms } = atmosphereResult;
    const atmosphere = new THREE.Mesh(new THREE.SphereGeometry(198, 40, 32), atmosphereMaterial);
    atmosphere.renderOrder = 110;
    group.add(atmosphere);

    const ambient = new THREE.AmbientLight(0x202030, 0.25);
    const key = new THREE.PointLight(0xe8ecff, 2.2, 2600);
    key.position.set(520, 420, 760);
    group.add(ambient, key);

    camera.position.set(0, 95, 980);
    camera.lookAt(0, 0, 0);

    const requestedScale = Number(params.get('scale'));
    const resolutionScale = Number.isFinite(requestedScale)
        ? THREE.MathUtils.clamp(requestedScale, 0.5, 1)
        : 0.92;
    const post = new CosmicNoirPost(renderer, scene, camera, {
        useMRT: false,
        bloomStrength: 0.2,
        bloomRadius: 0.35,
        bloomThreshold: 0.88,
        bloomDownsample: 0.65,
        resolutionScale,
        chromaticStrength: 0.0022,
        lensingStrength: 0.7,
        vignetteOffset: 1.2,
        vignetteDarkness: 0.86,
        exposure: 1.04,
        contrast: 1.04,
        saturation: 1,
        blackFloor: 0,
        ditherStrength: 0.003,
    });
    post.setSize(window.innerWidth, window.innerHeight);

    const drawingBufferSize = new THREE.Vector2();
    const diagnostics = {
        snapshot() {
            renderer.getDrawingBufferSize(drawingBufferSize);
            return {
                backend: renderer.backend?.isWebGPUBackend ? 'webgpu' : 'webgl2',
                drawingBuffer: {
                    width: drawingBufferSize.x,
                    height: drawingBufferSize.y,
                },
                sceneTarget: {
                    width: post.scenePass.renderTarget.width,
                    height: post.scenePass.renderTarget.height,
                },
                resolutionScale: post.scenePass.getResolutionScale(),
                bloomDownsample: post.bloomDownsample,
            };
        },
    };
    window.__COSMIC_NOIR_PERF__ = diagnostics;

    return {
        cameraRadius: 980,
        camera(time, activeCamera) {
            activeCamera.position.set(Math.sin(time * 0.08) * 22, 95, 980);
            activeCamera.lookAt(0, 0, 0);
        },
        update(time) {
            setUniform(stars.userData.uniforms, 'uTime', time);
            setUniform(planetUniforms, 'uTime', time);
            setUniform(planetUniforms, 'uPulseIntensity', 0.08);
            setUniform(diskUniforms, 'uTime', time);
            setUniform(diskUniforms, 'uPulseIntensity', 0.06);
            setUniform(atmosphereUniforms, 'uTime', time);
            setUniform(atmosphereUniforms, 'uPulseIntensity', 0.08);
        },
        render() {
            post.render();
        },
        renderAsync() {
            post.render();
            return Promise.resolve();
        },
        resize(width, height) {
            post.setSize(width, height);
        },
        dispose() {
            delete window.__COSMIC_NOIR_PERF__;
            renderer.sortObjects = previousSortObjects;
            scene.background = previousBackground;
            post.dispose();
            scene.remove(group);
            group.traverse((object) => {
                object.geometry?.dispose?.();
                if (Array.isArray(object.material)) {
                    object.material.forEach((material) => material.dispose?.());
                } else {
                    object.material?.dispose?.();
                }
            });
        },
    };
}
