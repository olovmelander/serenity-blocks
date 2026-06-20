/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies, camelcase */
/**
 * Winter Mountains — layered cool-blue snow-capped peaks, built on the Odyssey
 * Chapter 4 (Mountain Peaks) mountain language so they match that AAA look:
 *   - CPU-baked FBM heightfield (cone + ridged-multifractal crests + detail)
 *   - shared mountainColorNode shading (3-zone alpine snow, snow line, rim, fog)
 *   - resolveMountainTreatment({coolTemp}) for the saturated cool-blue palette
 *
 * Winter tuning vs Ch4: the warm sunset ALPENGLOW is killed (alpenStrength 0) —
 * this is a moonlit night, so caps stay cool blue-white. Peaks are layered in 3
 * depth tiers so atmospheric fog recedes the far range to pale blue (the painted
 * reference look).
 *
 * Port target: src/themes/winter/winter-theme.js createMountains().
 */
import * as THREE from 'three/webgpu';
import {
    uniform, attribute, normalView, positionWorld, normalize,
    vec3, mix, clamp, smoothstep, float, mx_noise_float,
} from 'three/tsl';
import {
    mountainCpuDisplacement,
    mountainColorNode,
    resolveMountainTreatment,
} from '../../rendering/odyssey/chapter-environments/shared/mountain-language.js';

export const meta = {
    id: 'winter-mountains',
    title: 'Winter Mountains (Odyssey Ch4 language)',
    description: 'Layered cool-blue snow-capped FBM peaks for the winter theme.',
};

function buildWinterPeak({
    size, height, seed, position, coolTemp = 1.0, snowLine, isHero = false,
    fogNear, fogFar,
}) {
    // --- CPU heightfield bake (identical language to Odyssey Ch4) ---
    const segments = 64;
    const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
    geometry.rotateX(-Math.PI / 2);
    const posAttr = geometry.attributes.position;
    const heights = new Float32Array(posAttr.count);
    for (let i = 0; i < posAttr.count; i += 1) {
        const x = posAttr.getX(i);
        const z = posAttr.getZ(i);
        const h = mountainCpuDisplacement(x, z, { size, height, seed });
        posAttr.setY(i, h);
        heights[i] = h / height;
    }
    geometry.computeVertexNormals();
    geometry.setAttribute('aHeight', new THREE.BufferAttribute(heights, 1));

    // --- Cool-blue winter treatment ---
    const t = resolveMountainTreatment({ coolTemp, snowLine });
    const uSnow = uniform(new THREE.Color(t.snow));
    const uSnowShadow = uniform(new THREE.Color(t.snowShadow));
    const uRock = uniform(new THREE.Color(t.rock));
    const uShadow = uniform(new THREE.Color(t.shadow));
    const uFog = uniform(new THREE.Color(t.fog));
    const uAlpen = uniform(new THREE.Color(t.alpenglow));
    const uRim = uniform(new THREE.Color(t.rim));
    const uSnowLine = uniform(t.snowLine);
    const uSnowBlend = uniform(0.35); // winter: snow line pulled down a touch

    const vHeight = attribute('aHeight', 'float');
    const snowNoise = mx_noise_float(vec3(positionWorld.xz.mul(0.05), float(0.0)))
        .mul(0.5).add(0.5);

    const color = mountainColorNode({
        uSnow,
        uSnowShadow,
        uRock,
        uShadow,
        uFog,
        uAlpen,
        uRim,
        uSnowLine,
        uSnowBlend,
        vNormal: normalView,
        vWorldPosition: positionWorld,
        vHeight,
        snowNoise,
        // Moonlit night → key from a cool high angle, NO warm sunset alpenglow.
        keyDir: [0.35, 0.85, 0.4],
        alpenStrength: 0.0,
        // Per-tier atmospheric perspective: far ridges haze to pale blue.
        ...(fogNear !== undefined ? { fogNear } : {}),
        ...(fogFar !== undefined ? { fogFar } : {}),
    });

    // Hide the flat plane feet: fade alpha out below the snow/rock body.
    const baseFade = smoothstep(0.02, 0.12, vHeight);

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = color;
    material.opacityNode = clamp(baseFade, 0.0, 1.0);
    material.transparent = true;
    material.depthWrite = false;
    if (isHero) material.userData = { emitsBloom: false };

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(position);
    return { mesh, geometry, material };
}

export function create({ scene }) {
    // --- Cobalt night sky backdrop so the peaks read against sky ---
    const skyMat = new THREE.MeshBasicNodeMaterial();
    const h = normalize(positionWorld).y;
    skyMat.colorNode = mix(
        vec3(0.05, 0.12, 0.30),
        vec3(0.02, 0.05, 0.16),
        clamp(h, 0.0, 1.0),
    );
    skyMat.side = THREE.BackSide;
    skyMat.depthWrite = false;
    skyMat.fog = false;
    skyMat.toneMapped = false;
    const skyGeo = new THREE.SphereGeometry(5000, 48, 24);
    const sky = new THREE.Mesh(skyGeo, skyMat);
    sky.frustumCulled = false;
    scene.add(sky);

    // --- Three depth tiers of peaks (atmospheric perspective via distance fog) ---
    const feetY = -180;
    const specs = [
        // Far range — wide, low, heavy haze → pale blue silhouettes.
        {
            size: 1900, height: 300, seed: 5.1, position: new THREE.Vector3(-820, feetY, -1600), coolTemp: 1.0, fogNear: 120, fogFar: 1000,
        },
        {
            size: 1750, height: 280, seed: 9.7, position: new THREE.Vector3(620, feetY, -1680), coolTemp: 1.0, fogNear: 120, fogFar: 1000,
        },
        // Mid range — moderate haze.
        {
            size: 1250, height: 360, seed: 21.3, position: new THREE.Vector3(-280, feetY, -1050), coolTemp: 1.0, isHero: true, fogNear: 380, fogFar: 1300,
        },
        {
            size: 1150, height: 320, seed: 33.9, position: new THREE.Vector3(440, feetY, -1100), coolTemp: 1.0, fogNear: 380, fogFar: 1300,
        },
        // Near hero peaks — full contrast + detail, pushed to the SIDES so the
        // hazed mid/far ridges read in the centre (layered-recession composition).
        {
            size: 1050, height: 400, seed: 42.2, position: new THREE.Vector3(-760, feetY, -640), coolTemp: 1.0, isHero: true,
        },
        {
            size: 980, height: 360, seed: 58.6, position: new THREE.Vector3(720, feetY, -700), coolTemp: 1.0,
        },
    ];
    const peaks = specs.map((s) => {
        const p = buildWinterPeak(s);
        scene.add(p.mesh);
        return p;
    });

    return {
        cameraRadius: 0.001,
        camera(time, camera) {
            // Slightly raised wide vantage so the layered ridges recede into haze.
            const yaw = Math.sin(time * 0.03) * 0.1;
            camera.position.set(Math.sin(yaw) * 80, 175, 560);
            camera.lookAt(Math.sin(yaw) * 160, 40, -1050);
        },
        update() {},
        dispose() {
            scene.remove(sky);
            skyGeo.dispose();
            skyMat.dispose();
            peaks.forEach((p) => {
                scene.remove(p.mesh);
                p.geometry.dispose();
                p.material.dispose();
            });
        },
    };
}
