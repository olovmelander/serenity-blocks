/* eslint-disable camelcase, import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Moonlit Forest — Silverheart Glade composition foundation.
 *
 * This is deliberately a playground-owned runtime: the production theme can import
 * create() after the composition has passed phase-locked WebGPU/WebGL2 screenshots.
 * Repeated scenery is instanced, event response is uniform-driven, and every owned
 * GPU resource is disposed explicitly.
 */
import * as THREE from 'three/webgpu';
import {
    abs, attribute, cameraPosition, clamp, color, cos, dot, float, fog, length,
    mix, modelWorldMatrix, mx_fractal_noise_float, mx_noise_float, normalWorld,
    normalize, positionLocal, positionWorld, pow, rangeFogFactor, sin, smoothstep,
    uniform, uv, vec2, vec3, vec4,
} from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const meta = {
    id: 'moonlit-forest-master',
    title: 'Moonlit Forest — Silverheart Glade',
    description: 'Natural-cathedral composition study with a silver moon, black-water clearing, and layered forest.',
};

const TAU = Math.PI * 2;
const MAX_BURSTS_PER_TICK = 8;
const WORLD_LIMIT = 180;

const QUALITY_TIERS = Object.freeze({
    Minimal: {
        stars: 26,
        density: 0.48,
        rocks: 10,
        fungi: 6,
        fireflies: 12,
        ferns: 24,
        mistLayers: 1,
        atmosphereNoise: false,
    },
    Low: {
        stars: 38,
        density: 0.64,
        rocks: 14,
        fungi: 8,
        fireflies: 16,
        ferns: 32,
        mistLayers: 1,
        atmosphereNoise: false,
    },
    Medium: {
        stars: 54,
        density: 0.82,
        rocks: 18,
        fungi: 10,
        fireflies: 22,
        ferns: 44,
        mistLayers: 2,
        atmosphereNoise: true,
    },
    High: {
        stars: 72,
        density: 1,
        rocks: 22,
        fungi: 14,
        fireflies: 30,
        ferns: 58,
        mistLayers: 3,
        atmosphereNoise: true,
    },
    Ultra: {
        stars: 84,
        density: 1.14,
        rocks: 26,
        fungi: 18,
        fireflies: 34,
        ferns: 66,
        mistLayers: 3,
        atmosphereNoise: true,
    },
    Extreme: {
        stars: 96,
        density: 1.26,
        rocks: 30,
        fungi: 22,
        fireflies: 38,
        ferns: 72,
        mistLayers: 3,
        atmosphereNoise: true,
    },
});

const PALETTE = Object.freeze({
    sky: 0x050812,
    foreground: 0x1c2b3b,
    bark: 0x25263a,
    midForest: 0x21364a,
    mist: 0x386675,
    silver: 0xc5d8dc,
    fungal: 0x62d9bd,
    firefly: 0xebcb69,
});

function makeRng(seed) {
    let state = seed % 2147483647;
    if (state <= 0) state += 2147483646;
    return () => {
        state = (state * 16807) % 2147483647;
        return (state - 1) / 2147483646;
    };
}

function nodeColor(hex) {
    const c = new THREE.Color(hex);
    return vec3(c.r, c.g, c.b);
}

function prepareMergeGeometry(source) {
    const geometry = source.index ? source.toNonIndexed() : source;
    if (geometry !== source) source.dispose();
    [...Object.keys(geometry.attributes)].forEach((name) => {
        if (name !== 'position' && name !== 'normal') geometry.deleteAttribute(name);
    });
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
    return geometry;
}

function mergeParts(parts) {
    const prepared = parts.map(prepareMergeGeometry);
    const merged = mergeGeometries(prepared, false);
    prepared.forEach((geometry) => geometry.dispose());
    if (!merged) throw new Error('[MoonlitForest] Failed to merge procedural geometry.');
    merged.computeVertexNormals();
    merged.computeBoundingSphere();
    return merged;
}

function taperedSegment(start, end, bottomRadius, topRadius, sides = 7) {
    const direction = end.clone().sub(start);
    const segmentLength = direction.length();
    const geometry = new THREE.CylinderGeometry(
        topRadius,
        bottomRadius,
        segmentLength,
        sides,
        1,
        false,
    );
    const midpoint = start.clone().add(end).multiplyScalar(0.5);
    const quaternion = new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        direction.normalize(),
    );
    geometry.applyMatrix4(new THREE.Matrix4().compose(
        midpoint,
        quaternion,
        new THREE.Vector3(1, 1, 1),
    ));
    return geometry;
}

function ellipsoid(center, scale, rotation, detail = 1) {
    const geometry = new THREE.IcosahedronGeometry(1, detail);
    const quaternion = new THREE.Quaternion().setFromEuler(rotation);
    geometry.applyMatrix4(new THREE.Matrix4().compose(center, quaternion, scale));
    return geometry;
}

function buildHeroWoodGeometry(inward, stature = 1) {
    const v = (x, y, z) => new THREE.Vector3(x * inward, y * stature, z);
    const parts = [
        taperedSegment(v(0, -4, 0), v(2.2, 19, 0), 5.1, 3.7),
        taperedSegment(v(2.2, 19, 0), v(5.0, 39, -1.2), 3.7, 2.35),
        taperedSegment(v(4.0, 29, -0.5), v(15.0, 46, -3.2), 2.25, 1.25),
        taperedSegment(v(15.0, 46, -3.2), v(29.0, 53, -7.0), 1.25, 0.42),
        taperedSegment(v(3.0, 24, 0.5), v(-10.0, 34, 1.4), 2.0, 0.75),
        taperedSegment(v(-10.0, 34, 1.4), v(-17.0, 43, -1.0), 0.75, 0.28),
        taperedSegment(v(5.0, 37, -1.2), v(1.0, 51, 2.2), 1.35, 0.35),
        taperedSegment(v(16.0, 46, -3.0), v(19.0, 59, -4.4), 0.8, 0.22),
        taperedSegment(v(0, -2.4, 0), v(-14.0, -1.0, 5.0), 2.4, 0.25, 6),
        taperedSegment(v(0, -2.6, 0), v(13.0, -1.5, 8.0), 2.3, 0.24, 6),
        taperedSegment(v(1, -2.8, 0), v(8.0, -1.8, -12.0), 2.0, 0.2, 6),
    ];
    return mergeParts(parts);
}

function buildHeroCanopyGeometry(inward, stature = 1, variant = 0) {
    const c = (x, y, z) => new THREE.Vector3(x * inward, y * stature, z);
    const s = (x, y, z) => new THREE.Vector3(x, y * stature, z);
    const variantShift = variant === 0 ? 0 : 1.8;
    const clumps = [
        [c(-16, 43 + variantShift, 0), s(7.0, 5.2, 5.7), -0.55],
        [c(-9, 40, 2), s(7.4, 5.6, 5.9), 0.18],
        [c(-3, 47 + variantShift, 2), s(8.0, 6.3, 6.2), -0.36],
        [c(5, 45, 1), s(7.2, 5.7, 5.8), 0.42],
        [c(10, 52 + variantShift, -1), s(7.6, 5.8, 5.6), 0.58],
        [c(18, 50, -4), s(7.1, 5.1, 5.2), -0.18],
        [c(25, 55 + variantShift, -7), s(6.7, 4.7, 4.9), -0.28],
        [c(4, 57, 0), s(6.3, 5.0, 5.1), 0.72],
        [c(18, 60, -5), s(5.2, 3.9, 4.2), 0.16],
    ];
    if (variant === 1) clumps.splice(3, 1);
    return mergeParts(clumps.map(([center, scale, yaw], index) => ellipsoid(
        center,
        scale,
        new THREE.Euler(index * 0.21, yaw, index * -0.13),
        1,
    )));
}

function buildSupportingTreeGeometry(seed) {
    const rng = makeRng(seed);
    const lean = (rng() - 0.5) * 0.12;
    const parts = [
        taperedSegment(
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(lean, 0.61, 0),
            0.055,
            0.025,
            5,
        ),
        taperedSegment(
            new THREE.Vector3(lean * 0.7, 0.42, 0),
            new THREE.Vector3(-0.20, 0.75, -0.02),
            0.027,
            0.010,
            5,
        ),
        taperedSegment(
            new THREE.Vector3(lean * 0.8, 0.48, 0),
            new THREE.Vector3(0.22, 0.80, 0.02),
            0.026,
            0.009,
            5,
        ),
        ellipsoid(
            new THREE.Vector3(-0.17, 0.79, 0),
            new THREE.Vector3(0.30, 0.23, 0.20),
            new THREE.Euler(0.1, rng() * TAU, -0.12),
            0,
        ),
        ellipsoid(
            new THREE.Vector3(0.16, 0.82, 0.01),
            new THREE.Vector3(0.32, 0.25, 0.22),
            new THREE.Euler(-0.1, rng() * TAU, 0.18),
            0,
        ),
        ellipsoid(
            new THREE.Vector3(0.01, 0.98, -0.02),
            new THREE.Vector3(0.28, 0.23, 0.20),
            new THREE.Euler(0.2, rng() * TAU, 0),
            0,
        ),
    ];
    return mergeParts(parts);
}

function buildRidgeGeometry({
    seed, width, z, baseY, peakY, samples, centerDip,
}) {
    const rng = makeRng(seed);
    const positions = [];
    const indices = [];
    for (let i = 0; i <= samples; i += 1) {
        const t = i / samples;
        const x = (t - 0.5) * width;
        const edge = Math.abs(x) / (width * 0.5);
        const clearing = Math.exp(-((x / centerDip) ** 2));
        const rhythm = Math.sin(t * 17.0 + seed) * 0.12
            + Math.sin(t * 39.0 + seed * 0.31) * 0.06
            + (rng() - 0.5) * 0.10;
        const top = baseY + peakY * (0.22 + edge ** 1.35 * 0.55 + rhythm)
            - clearing * peakY * 0.12;
        positions.push(x, top, z, x, -24, z + 8);
    }
    for (let i = 0; i < samples; i += 1) {
        const a = i * 2;
        indices.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
}

function buildWaterClearingGeometry(seed) {
    const segments = 88;
    const rng = makeRng(seed);
    const positions = [0, 0, 0];
    const indices = [];
    for (let i = 0; i < segments; i += 1) {
        const angle = (i / segments) * TAU;
        const harmonic = Math.sin(angle * 3 + 0.8) * 0.035
            + Math.sin(angle * 7 - 0.4) * 0.022
            + (rng() - 0.5) * 0.028;
        const radius = 1 + harmonic;
        const sideTuck = 0.94 + Math.abs(Math.sin(angle)) * 0.06;
        positions.push(
            Math.cos(angle) * 27 * radius * sideTuck,
            0,
            Math.sin(angle) * 54 * radius,
        );
    }
    for (let i = 0; i < segments; i += 1) {
        indices.push(0, i + 1, ((i + 1) % segments) + 1);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
}

function buildTerrainGeometry(seed) {
    const columns = 48;
    const rows = 34;
    const width = 360;
    const nearZ = 62;
    const farZ = -310;
    const positions = [];
    const indices = [];
    const rng = makeRng(seed);
    const jitter = Array.from({ length: (columns + 1) * (rows + 1) }, () => rng() - 0.5);
    for (let row = 0; row <= rows; row += 1) {
        const rz = row / rows;
        const z = THREE.MathUtils.lerp(nearZ, farZ, rz);
        for (let column = 0; column <= columns; column += 1) {
            const rx = column / columns;
            const x = (rx - 0.5) * width;
            const edge = Math.abs(x) / (width * 0.5);
            const clearing = Math.exp(-((x / 54) ** 2)) * Math.exp(-(((z + 62) / 125) ** 2));
            const undulation = Math.sin(x * 0.052 + z * 0.017) * 0.75
                + Math.sin(x * 0.018 - z * 0.031) * 0.48;
            const noise = jitter[row * (columns + 1) + column] * 0.42;
            const y = -5.2 + edge ** 1.65 * 18.0 + undulation + noise - clearing * 1.4;
            positions.push(x, y, z);
        }
    }
    for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
            const a = row * (columns + 1) + column;
            const b = a + columns + 1;
            indices.push(a, b, a + 1, a + 1, b, b + 1);
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
}

function buildFernGeometry() {
    const positions = [];
    const indices = [];
    const addLeaf = (baseX, baseY, tipX, tipY, width, z) => {
        const first = positions.length / 3;
        const dx = tipX - baseX;
        const dy = tipY - baseY;
        const d = Math.hypot(dx, dy) || 1;
        const nx = (-dy / d) * width;
        const ny = (dx / d) * width;
        positions.push(
            baseX + nx,
            baseY + ny,
            z,
            baseX - nx,
            baseY - ny,
            z,
            tipX,
            tipY,
            z,
        );
        indices.push(first, first + 1, first + 2);
    };
    for (let i = -3; i <= 3; i += 1) {
        const angle = i * 0.20;
        addLeaf(0, 0, Math.sin(angle) * 0.62, 0.62 + Math.cos(angle) * 0.28, 0.055, i * 0.006);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
}

function setInstancedTransforms(mesh, placements) {
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const position = new THREE.Vector3();
    const euler = new THREE.Euler();
    placements.forEach((placement, index) => {
        position.set(placement.x, placement.y, placement.z);
        euler.set(placement.rx || 0, placement.ry || 0, placement.rz || 0);
        quaternion.setFromEuler(euler);
        scale.set(
            placement.sx ?? placement.scale,
            placement.sy ?? placement.scale,
            placement.sz ?? placement.scale,
        );
        matrix.compose(position, quaternion, scale);
        mesh.setMatrixAt(index, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
}

function extractWorldOrigin(payload = {}) {
    const raw = payload.worldOrigin || payload.origin || payload.position;
    if (Array.isArray(raw)) {
        return {
            x: Number(raw[0]) || 0,
            z: Number(raw[2] ?? raw[1]) || -45,
        };
    }
    if (raw && typeof raw === 'object') {
        if (raw.centered && Number.isFinite(raw.centered.x) && Number.isFinite(raw.centered.y)) {
            return {
                x: Number(raw.centered.x) * 18,
                z: -50 - Number(raw.centered.y) * 18,
            };
        }
        if (raw.normalized && Number.isFinite(raw.normalized.x) && Number.isFinite(raw.normalized.y)) {
            return {
                x: (Number(raw.normalized.x) - 0.5) * 36,
                z: -32 - Number(raw.normalized.y) * 36,
            };
        }
        return {
            x: Number(raw.x) || 0,
            z: Number(raw.z ?? raw.y) || -45,
        };
    }
    return null;
}

export function create({
    scene, camera, renderer, params, quality: requestedQuality,
}) {
    const requestedName = String(
        requestedQuality
        || params?.get('quality')
        || (typeof window !== 'undefined' ? window.settings?.effectQuality : '')
        || 'High',
    );
    const qualityName = Object.keys(QUALITY_TIERS)
        .find((name) => name.toLowerCase() === requestedName.toLowerCase()) || 'High';
    const quality = QUALITY_TIERS[qualityName];

    const root = new THREE.Group();
    root.name = 'moonlit-forest-silverheart-glade';
    scene.add(root);

    const geometries = new Set();
    const materials = new Set();
    const ownGeometry = (geometry) => {
        geometries.add(geometry);
        return geometry;
    };
    const ownMaterial = (material) => {
        materials.add(material);
        return material;
    };
    const add = (object) => {
        root.add(object);
        return object;
    };

    const previousBackground = scene.background;
    const previousFog = scene.fog;
    const previousFogNode = scene.fogNode;
    const previousToneMapping = renderer?.toneMapping;
    const previousExposure = renderer?.toneMappingExposure;
    const previousOutputColorSpace = renderer?.outputColorSpace;
    scene.background = new THREE.Color(PALETTE.sky);
    scene.fog = null;
    if (renderer) {
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.16;
        renderer.outputColorSpace = THREE.SRGBColorSpace;
    }

    const uTime = uniform(0);
    const uAmbientEnergy = uniform(0.16);
    const uLockPulse = uniform(0);
    const uLockPhase = uniform(1);
    const uComboPulse = uniform(0);
    const uComboPhase = uniform(1);
    const uComboTier = uniform(0);
    const uLockOrigin = uniform(new THREE.Vector2(0, -45));
    const lockTarget = new THREE.Vector2(0, -45);
    let ambientTarget = 0.16;
    let lastTime = null;
    let cameraConfigured = false;
    let reactivePipelinesPrimed = false;
    let lockAge = Number.POSITIVE_INFINITY;
    let lockDuration = 0.62;
    let lockStrength = 0;
    let comboAge = Number.POSITIVE_INFINITY;
    let comboDuration = 1.45;
    let comboStrength = 0;
    let comboVeilEnabled = false;

    const distanceFog = rangeFogFactor(105, 520);
    const lowFog = smoothstep(-4, 27, positionWorld.y).oneMinus();
    const fogFactor = clamp(distanceFog.mul(float(0.72).add(lowFog.mul(0.24))), 0, 0.94);
    scene.fogNode = fog(color(PALETTE.mist), fogFactor);

    // Sky: near-black zenith, violet transition, and a restrained teal horizon.
    const skyMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial());
    const skyDirection = normalize(positionLocal);
    const skyHeight = pow(clamp(skyDirection.y.mul(0.5).add(0.5), 0, 1), 0.72);
    const horizonBand = smoothstep(0.03, 0.46, abs(skyDirection.y)).oneMinus();
    const skyNoise = quality.atmosphereNoise
        ? mx_fractal_noise_float(skyDirection.mul(2.7), 3, 2, 0.52, 1)
            .mul(0.5)
            .add(0.5)
        : float(0.55);
    skyMaterial.colorNode = mix(nodeColor(0x162a39), nodeColor(PALETTE.sky), skyHeight)
        .add(nodeColor(0x17172a).mul(horizonBand.mul(0.28)))
        .add(nodeColor(0x294d59).mul(horizonBand.mul(0.075)))
        .add(nodeColor(0x315666).mul(skyNoise.mul(horizonBand).mul(0.052)));
    skyMaterial.side = THREE.BackSide;
    skyMaterial.depthWrite = false;
    skyMaterial.fog = false;
    skyMaterial.toneMapped = false;
    const sky = add(new THREE.Mesh(
        ownGeometry(new THREE.SphereGeometry(1100, 48, 24)),
        skyMaterial,
    ));
    sky.position.set(0, 0, -90);
    sky.frustumCulled = false;

    // Sparse, geometry-backed stars avoid the r181 WebGPU fixed-size Points path.
    const starGeometry = ownGeometry(new THREE.IcosahedronGeometry(0.7, 0));
    const starMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial());
    starMaterial.colorNode = nodeColor(0xa9c4cd);
    starMaterial.toneMapped = false;
    starMaterial.fog = false;
    const starPlacements = [];
    const starRng = makeRng(94177);
    for (let i = 0; i < quality.stars; i += 1) {
        const x = (starRng() - 0.5) * 650;
        const y = 24 + starRng() * 185;
        const scale = 0.25 + starRng() * 0.72;
        starPlacements.push({
            x, y, z: -470 - starRng() * 120, scale,
        });
    }
    const stars = add(new THREE.InstancedMesh(starGeometry, starMaterial, starPlacements.length));
    setInstancedTransforms(stars, starPlacements);

    // Neutral silver moon and a soft halo. The moon remains off-centre and unobscured.
    const moonGroup = add(new THREE.Group());
    moonGroup.position.set(74, 94, -285);
    const moonMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial());
    const moonUv = uv();
    const lunarNoise = mx_fractal_noise_float(vec3(moonUv.mul(5.2), float(0.4)), 3, 2, 0.5, 1)
        .mul(0.5)
        .add(0.5);
    const lunarBasin = mx_noise_float(moonUv.mul(12), 1, 0).mul(0.5).add(0.5);
    moonMaterial.colorNode = mix(nodeColor(0xa9bdc2), nodeColor(0xd7e2e2), lunarNoise)
        .sub(nodeColor(0x283a43).mul(lunarBasin.mul(0.10)));
    moonMaterial.toneMapped = false;
    moonMaterial.fog = false;
    const moon = new THREE.Mesh(ownGeometry(new THREE.CircleGeometry(18.5, 96)), moonMaterial);
    moonGroup.add(moon);

    const haloMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial());
    const haloRadius = length(uv().sub(vec2(0.5)));
    haloMaterial.colorNode = nodeColor(PALETTE.silver);
    haloMaterial.opacityNode = smoothstep(0.08, 0.50, haloRadius).oneMinus()
        .mul(float(0.17)
            .add(uAmbientEnergy.mul(0.045))
            .add(uLockPulse.mul(0.025))
            .add(uComboPulse.mul(0.14)));
    haloMaterial.transparent = true;
    haloMaterial.depthWrite = false;
    haloMaterial.fog = false;
    haloMaterial.toneMapped = false;
    const halo = new THREE.Mesh(ownGeometry(new THREE.PlaneGeometry(62, 62)), haloMaterial);
    halo.position.z = 0.5;
    moonGroup.add(halo);

    // One controlled shaft. Its procedural alpha removes every rectangular edge.
    const shaftMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial());
    const shaftUv = uv();
    const shaftHalfWidth = mix(float(0.43), float(0.085), shaftUv.y);
    const shaftNoise = mx_noise_float(
        vec3(shaftUv.x.mul(6.0), shaftUv.y.mul(2.3), uTime.mul(0.025)),
        1,
        0,
    ).mul(0.5).add(0.5);
    const shaftCenter = float(0.5).add(shaftNoise.sub(0.5).mul(0.045));
    const shaftEdge = smoothstep(
        shaftHalfWidth.mul(0.42),
        shaftHalfWidth,
        abs(shaftUv.x.sub(shaftCenter)),
    ).oneMinus();
    const shaftEnds = smoothstep(0.01, 0.18, shaftUv.y)
        .mul(smoothstep(0.78, 0.995, shaftUv.y).oneMinus());
    shaftMaterial.colorNode = mix(nodeColor(0x86afb6), nodeColor(PALETTE.silver), shaftUv.y);
    shaftMaterial.opacityNode = shaftEdge.mul(shaftEnds)
        .mul(float(0.016).add(pow(shaftNoise, 1.7).mul(0.052)))
        .mul(float(1)
            .add(uAmbientEnergy.mul(0.25))
            .add(uLockPulse.mul(0.14))
            .add(uComboPulse.mul(0.82)));
    shaftMaterial.transparent = true;
    shaftMaterial.depthWrite = false;
    shaftMaterial.side = THREE.DoubleSide;
    shaftMaterial.blending = THREE.NormalBlending;
    shaftMaterial.toneMapped = false;
    const shaft = add(new THREE.Mesh(
        ownGeometry(new THREE.PlaneGeometry(48, 126, 1, 12)),
        shaftMaterial,
    ));
    shaft.position.set(48, 45, -176);
    shaft.rotation.z = -0.23;
    shaft.renderOrder = -4;

    // A preallocated lunar veil answers strong combos behind the mid-forest.
    // It is invisible at rest, so the response feels like the glade breathing
    // open rather than a generic screen flash.
    const veilMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial());
    const veilUv = uv();
    const veilCurve = veilUv.y.add(sin(
        veilUv.x.mul(TAU * 1.35).add(uTime.mul(0.04)),
    ).mul(0.055));
    const veilHorizontal = smoothstep(0.0, 0.17, veilUv.x)
        .mul(smoothstep(0.83, 1.0, veilUv.x).oneMinus());
    const veilVertical = smoothstep(0.01, 0.24, veilCurve)
        .mul(smoothstep(0.70, 0.98, veilCurve).oneMinus());
    const veilNoise = quality.atmosphereNoise
        ? mx_noise_float(
            vec3(veilUv.x.mul(4.7), veilUv.y.mul(2.2), uTime.mul(0.055)),
            1,
            0,
        ).mul(0.5).add(0.5)
        : float(0.62);
    const veilBands = sin(
        veilCurve.mul(18.0)
            .add(veilUv.x.mul(5.5))
            .sub(uTime.mul(0.19)),
    ).mul(0.5).add(0.5);
    const veilPattern = veilNoise.mul(0.62).add(veilBands.mul(0.38));
    veilMaterial.colorNode = mix(nodeColor(0x51466f), nodeColor(0x58aaa2), veilCurve);
    veilMaterial.opacityNode = veilHorizontal.mul(veilVertical)
        .mul(smoothstep(0.30, 0.82, veilPattern))
        .mul(pow(uComboPulse, 0.82))
        .mul(uComboTier.mul(0.45).add(0.55))
        .mul(0.145);
    veilMaterial.transparent = true;
    veilMaterial.depthWrite = false;
    veilMaterial.side = THREE.DoubleSide;
    veilMaterial.blending = THREE.AdditiveBlending;
    veilMaterial.toneMapped = false;
    const veil = add(new THREE.Mesh(
        ownGeometry(new THREE.PlaneGeometry(214, 82, 18, 6)),
        veilMaterial,
    ));
    veil.position.set(3, 26, -178);
    veil.rotation.z = -0.015;
    veil.renderOrder = -2;

    const ridgeSpecs = [
        {
            seed: 113, width: 760, z: -365, baseY: -7, peakY: 64, samples: 120, centerDip: 88, color: 0x2d4d5a,
        },
        {
            seed: 227, width: 620, z: -270, baseY: -7, peakY: 50, samples: 104, centerDip: 74, color: 0x223c49,
        },
        {
            seed: 359, width: 500, z: -205, baseY: -7, peakY: 39, samples: 92, centerDip: 62, color: 0x182c3a,
        },
    ];
    ridgeSpecs.forEach((spec) => {
        const material = ownMaterial(new THREE.MeshBasicNodeMaterial());
        const ridgeHeight = smoothstep(-9, spec.peakY * 0.82, positionLocal.y);
        material.colorNode = mix(nodeColor(0x0d1b27), nodeColor(spec.color), ridgeHeight)
            .add(nodeColor(0x3c6871).mul(ridgeHeight.mul(0.045)));
        material.side = THREE.DoubleSide;
        const mesh = add(new THREE.Mesh(ownGeometry(buildRidgeGeometry(spec)), material));
        mesh.renderOrder = -3;
    });

    // Three depth layers, each split across two organic broadleaf variants.
    const supportingGeometries = [
        ownGeometry(buildSupportingTreeGeometry(719)),
        ownGeometry(buildSupportingTreeGeometry(1531)),
    ];
    const forestLayers = [
        {
            seed: 1901, z: -300, width: 480, step: 15, h: [21, 32], clear: 22, color: 0x2b4a57,
        },
        {
            seed: 2801, z: -218, width: 390, step: 13, h: [27, 39], clear: 28, color: 0x203946,
        },
        {
            seed: 3701, z: -142, width: 310, step: 12, h: [33, 48], clear: 35, color: 0x182b38,
        },
    ];
    forestLayers.forEach((layer) => {
        const rng = makeRng(layer.seed);
        const lists = [[], []];
        let ordinal = 0;
        const step = layer.step / quality.density;
        for (let x = -layer.width * 0.5; x <= layer.width * 0.5; x += step) {
            const px = x + (rng() - 0.5) * layer.step * 0.72;
            if (Math.abs(px) < layer.clear && rng() < 0.78) continue;
            const centerScale = THREE.MathUtils.lerp(0.72, 1, Math.min(1, Math.abs(px) / 95));
            const height = THREE.MathUtils.lerp(layer.h[0], layer.h[1], rng()) * centerScale;
            lists[ordinal % 2].push({
                x: px,
                y: -5.1,
                z: layer.z + (rng() - 0.5) * 20,
                scale: height,
                ry: rng() * TAU,
            });
            ordinal += 1;
        }
        const material = ownMaterial(new THREE.MeshBasicNodeMaterial());
        const crownMask = smoothstep(0.55, 0.72, positionLocal.y);
        const crownKey = clamp(dot(
            normalize(normalWorld),
            normalize(vec3(0.20, 0.42, -0.88)),
        ).mul(0.5).add(0.5), 0, 1);
        material.colorNode = mix(nodeColor(0x101c29), nodeColor(layer.color), crownMask)
            .add(nodeColor(0x5d8990).mul(crownMask.mul(crownKey).mul(0.11)));
        lists.forEach((placements, variant) => {
            const mesh = add(new THREE.InstancedMesh(
                supportingGeometries[variant],
                material,
                placements.length,
            ));
            setInstancedTransforms(mesh, placements);
        });
    });

    const terrainMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial());
    const terrainNormal = normalize(normalWorld);
    const terrainKey = clamp(dot(terrainNormal, normalize(vec3(0.34, 0.82, 0.46))), 0, 1);
    const terrainNear = smoothstep(-245, 48, positionWorld.z);
    const terrainHeight = smoothstep(-6, 13, positionWorld.y);
    const clearingDistance = length(positionWorld.xz.sub(vec2(0, -58)));
    const clearingWash = smoothstep(22, 118, clearingDistance).oneMinus();
    const groundVariation = mx_noise_float(positionWorld.xz.mul(0.052), 1, 0)
        .mul(0.5)
        .add(0.5);
    const moonPathCenter = sin(positionWorld.z.mul(0.028)).mul(3.2).add(7.0);
    const moonPath = smoothstep(4, 34, abs(positionWorld.x.sub(moonPathCenter)))
        .oneMinus()
        .mul(clearingWash);
    const sanctuaryEdges = smoothstep(20, 62, abs(positionWorld.x))
        .mul(smoothstep(-155, 52, positionWorld.z));
    terrainMaterial.colorNode = mix(nodeColor(0x183641), nodeColor(PALETTE.foreground), terrainNear)
        .add(nodeColor(0x4a7778).mul(terrainKey.mul(0.20)))
        .add(nodeColor(0x343352).mul(terrainHeight.mul(0.13)))
        .add(nodeColor(0x4c8781).mul(clearingWash.mul(groundVariation).mul(0.30)))
        .add(nodeColor(0x5b9a8d).mul(sanctuaryEdges.mul(groundVariation).mul(0.29)))
        .add(nodeColor(PALETTE.silver).mul(moonPath.mul(0.075)));
    const terrain = add(new THREE.Mesh(ownGeometry(buildTerrainGeometry(44119)), terrainMaterial));
    terrain.receiveShadow = false;

    // Analytical black water: an irregular shallow basin, a narrow silver path,
    // quiet ripples, and a reusable lock ring.
    const waterGeometry = ownGeometry(buildWaterClearingGeometry(31417));
    const shorelineMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial());
    shorelineMaterial.colorNode = nodeColor(0x10272d);
    shorelineMaterial.side = THREE.DoubleSide;
    const shoreline = add(new THREE.Mesh(waterGeometry, shorelineMaterial));
    shoreline.position.set(0, -4.54, -72);
    shoreline.scale.set(1.035, 1, 1.035);

    const waterMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial());
    const waterPosition = positionWorld.xz;
    const waterRipples = sin(waterPosition.x.mul(0.31).add(uTime.mul(0.22)))
        .add(sin(waterPosition.y.mul(0.12).sub(uTime.mul(0.17))))
        .mul(0.5)
        .add(0.5);
    const streakCenter = sin(waterPosition.y.mul(0.05)).mul(1.4).add(23.0);
    const glintBands = smoothstep(
        0.38,
        0.82,
        sin(waterPosition.y.mul(0.64).add(uTime.mul(0.11))).mul(0.5).add(0.5),
    );
    const streakBreakup = smoothstep(0.24, 0.82, waterRipples)
        .mul(0.34)
        .add(0.18)
        .mul(glintBands.mul(0.78).add(0.22));
    const moonStreak = smoothstep(1.4, 6.2, abs(waterPosition.x.sub(streakCenter)))
        .oneMinus()
        .mul(smoothstep(-128, -28, waterPosition.y))
        .mul(streakBreakup);
    const lockProgress = uLockPhase;
    const lockDistance = length(waterPosition.sub(uLockOrigin));
    const contactRing = smoothstep(
        0.28,
        1.65,
        abs(lockDistance.sub(lockProgress.mul(17.0))),
    ).oneMinus().mul(pow(uLockPulse, 0.65));
    const secondaryRing = smoothstep(
        0.42,
        2.1,
        abs(lockDistance.sub(lockProgress.mul(27.0).add(2.0))),
    ).oneMinus().mul(pow(uLockPulse, 0.88));
    const contactBloom = smoothstep(1.2, 12.0, lockDistance)
        .oneMinus()
        .mul(pow(uLockPulse, 1.7));
    const comboDistance = length(waterPosition.sub(vec2(0, -72)));
    const comboProgress = uComboPhase;
    const comboRing = smoothstep(
        0.6,
        3.2,
        abs(comboDistance.sub(comboProgress.mul(54.0).add(7.0))),
    ).oneMinus().mul(pow(uComboPulse, 0.72));
    waterMaterial.colorNode = mix(nodeColor(0x091a22), nodeColor(0x1b4145), waterRipples.mul(0.29))
        .add(nodeColor(PALETTE.silver).mul(moonStreak.mul(0.20)))
        .add(nodeColor(PALETTE.fungal).mul(contactRing.mul(0.62)))
        .add(nodeColor(PALETTE.silver).mul(secondaryRing.mul(0.25)))
        .add(nodeColor(0x7fe8d5).mul(contactBloom.mul(0.24)))
        .add(nodeColor(0x748bb5).mul(comboRing.mul(0.24)))
        .add(nodeColor(PALETTE.silver).mul(moonStreak.mul(uComboPulse).mul(0.16)));
    waterMaterial.toneMapped = false;
    waterMaterial.side = THREE.DoubleSide;
    const water = add(new THREE.Mesh(
        waterGeometry,
        waterMaterial,
    ));
    water.position.set(0, -4.42, -72);

    // One reusable contact bloom carries locks beyond the water mesh and keeps
    // piece feedback spatial even when a gameplay origin lands on the bank.
    const lockBloomMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial());
    const lockBloomRadius = length(uv().sub(vec2(0.5))).mul(2.0);
    const lockBloomProgress = uLockPhase;
    const lockBloomCore = smoothstep(0.04, 0.62, lockBloomRadius)
        .oneMinus()
        .mul(pow(uLockPulse, 1.8));
    const lockBloomRing = smoothstep(
        0.018,
        0.09,
        abs(lockBloomRadius.sub(lockBloomProgress.mul(0.88))),
    ).oneMinus().mul(pow(uLockPulse, 0.62));
    lockBloomMaterial.colorNode = mix(
        nodeColor(PALETTE.fungal),
        nodeColor(PALETTE.silver),
        uLockPulse.mul(0.42),
    );
    lockBloomMaterial.opacityNode = lockBloomCore.mul(0.24)
        .add(lockBloomRing.mul(0.52));
    lockBloomMaterial.transparent = true;
    lockBloomMaterial.depthWrite = false;
    lockBloomMaterial.side = THREE.DoubleSide;
    lockBloomMaterial.blending = THREE.AdditiveBlending;
    lockBloomMaterial.toneMapped = false;
    const lockBloom = add(new THREE.Mesh(
        ownGeometry(new THREE.PlaneGeometry(38, 38)),
        lockBloomMaterial,
    ));
    lockBloom.position.set(0, -4.02, -45);
    lockBloom.rotation.x = -Math.PI * 0.5;
    lockBloom.renderOrder = 7;

    // Hero trees create the asymmetric cathedral arch and leave the playfield clear.
    const barkMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial());
    const viewDirection = normalize(cameraPosition.sub(positionWorld));
    const barkNormal = normalize(normalWorld);
    const barkKey = clamp(dot(barkNormal, normalize(vec3(0.38, 0.82, 0.40))), 0, 1);
    const barkRim = pow(clamp(float(1).sub(dot(barkNormal, viewDirection)), 0, 1), 3.0);
    const barkGrain = mx_noise_float(vec3(
        positionWorld.x.mul(0.09),
        positionWorld.y.mul(0.19),
        positionWorld.z.mul(0.09),
    ), 1, 0).mul(0.5).add(0.5);
    const rootMoss = smoothstep(-2, 15, positionLocal.y).oneMinus();
    barkMaterial.colorNode = nodeColor(PALETTE.bark)
        .add(nodeColor(0x527887).mul(barkKey.mul(0.34)))
        .add(nodeColor(0x3d536c).mul(barkGrain.mul(0.12)))
        .add(nodeColor(0x3f8178).mul(rootMoss.mul(barkGrain).mul(0.10)))
        .add(nodeColor(PALETTE.silver).mul(barkRim.mul(0.13)));
    barkMaterial.fog = true;

    const foliageMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial());
    const foliageNormal = normalize(normalWorld);
    const foliageKey = clamp(dot(foliageNormal, normalize(vec3(0.34, 0.86, 0.38))), 0, 1);
    const foliageRim = pow(clamp(float(1).sub(dot(foliageNormal, viewDirection)), 0, 1), 3.2);
    const foliageVariation = mx_noise_float(positionWorld.mul(vec3(0.045, 0.058, 0.045)), 1, 0)
        .mul(0.5)
        .add(0.5);
    const treeBase = modelWorldMatrix.mul(vec4(0, 0, 0, 1)).x;
    const treePhase = treeBase.mul(0.043);
    const canopyMask = smoothstep(19, 57, positionLocal.y);
    const canopySway = sin(uTime.mul(0.22).add(treePhase).add(positionLocal.y.mul(0.026)))
        .mul(canopyMask)
        .mul(0.24);
    foliageMaterial.colorNode = nodeColor(0x172d35)
        .add(nodeColor(0x4b7b80).mul(foliageKey.mul(0.37)))
        .add(nodeColor(0x3f666d).mul(foliageVariation.mul(0.12)))
        .add(nodeColor(0x9eb8ba).mul(foliageRim.mul(0.145)))
        .add(nodeColor(PALETTE.silver).mul(
            foliageRim.mul(uLockPulse.mul(0.035).add(uComboPulse.mul(0.24))),
        ));
    foliageMaterial.positionNode = positionLocal.add(vec3(
        canopySway,
        sin(uTime.mul(0.17).add(treePhase)).mul(canopyMask).mul(0.055),
        canopySway.mul(0.24),
    ));
    foliageMaterial.fog = true;

    const heroSpecs = [
        {
            inward: 1, stature: 1.04, position: [-51, -3.7, 5], yaw: -0.04,
        },
        {
            inward: -1, stature: 0.91, position: [60, -3.9, -7], yaw: 0.09,
        },
    ];
    heroSpecs.forEach((spec, index) => {
        const group = add(new THREE.Group());
        group.position.set(...spec.position);
        group.rotation.y = spec.yaw;
        const wood = new THREE.Mesh(
            ownGeometry(buildHeroWoodGeometry(spec.inward, spec.stature)),
            barkMaterial,
        );
        const canopy = new THREE.Mesh(
            ownGeometry(buildHeroCanopyGeometry(spec.inward, spec.stature, index)),
            foliageMaterial,
        );
        group.add(wood, canopy);
    });

    // Rocks and ferns structure the lower frame without filling the central altar.
    const rockGeometry = ownGeometry(new THREE.DodecahedronGeometry(1, 0));
    const rockMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial());
    rockMaterial.colorNode = nodeColor(0x263949)
        .add(nodeColor(0x739698).mul(terrainKey.mul(0.34)));
    const rockPlacements = [];
    const fernPlacements = [];
    const floorRng = makeRng(81773);
    for (let i = 0; i < quality.rocks; i += 1) {
        const side = i % 2 === 0 ? -1 : 1;
        const z = 30 - floorRng() * 165;
        const x = side * (29 + floorRng() * (44 + Math.max(0, -z) * 0.24));
        const scale = 1.1 + floorRng() * 3.4;
        rockPlacements.push({
            x,
            y: -3.6 + floorRng() * 1.8,
            z,
            sx: scale * (0.8 + floorRng() * 0.8),
            sy: scale * (0.45 + floorRng() * 0.42),
            sz: scale * (0.75 + floorRng() * 0.7),
            ry: floorRng() * TAU,
            rz: (floorRng() - 0.5) * 0.4,
        });
    }
    for (let i = 0; i < quality.ferns; i += 1) {
        const side = i % 2 === 0 ? -1 : 1;
        const z = 36 - floorRng() * 190;
        const x = side * (24 + floorRng() * (58 + Math.max(0, -z) * 0.20));
        const scale = 1.4 + floorRng() * 3.4;
        fernPlacements.push({
            x,
            y: -3.8 + floorRng() * 1.2,
            z,
            sx: scale * (0.68 + floorRng() * 0.5),
            sy: scale,
            sz: scale,
            ry: floorRng() * TAU,
            rz: (floorRng() - 0.5) * 0.18,
        });
    }
    const authoredRocks = [
        {
            x: -68, y: -2.6, z: 13, sx: 4.8, sy: 2.1, sz: 3.6, ry: 0.45, rz: -0.08,
        },
        {
            x: 73, y: -2.8, z: 5, sx: 4.1, sy: 1.8, sz: 4.7, ry: 1.3, rz: 0.11,
        },
        {
            x: -49, y: -3.1, z: -55, sx: 3.5, sy: 1.5, sz: 2.8, ry: 2.1, rz: 0.06,
        },
        {
            x: 54, y: -3.2, z: -72, sx: 3.2, sy: 1.3, sz: 3.8, ry: 0.8, rz: -0.04,
        },
    ];
    authoredRocks.forEach((placement, index) => {
        if (index < rockPlacements.length) rockPlacements[index] = placement;
    });
    const authoredFerns = [
        {
            x: -63, y: -3.2, z: 11, sx: 3.8, sy: 4.8, sz: 4.8, ry: 0.2, rz: -0.05,
        },
        {
            x: 69, y: -3.3, z: 3, sx: 3.3, sy: 4.2, sz: 4.2, ry: -0.4, rz: 0.04,
        },
        {
            x: -46, y: -3.5, z: -51, sx: 2.7, sy: 3.6, sz: 3.6, ry: 0.8, rz: 0.02,
        },
        {
            x: 50, y: -3.5, z: -68, sx: 2.6, sy: 3.4, sz: 3.4, ry: -0.7, rz: -0.02,
        },
    ];
    authoredFerns.forEach((placement, index) => {
        if (index < fernPlacements.length) fernPlacements[index] = placement;
    });
    const rocks = add(new THREE.InstancedMesh(rockGeometry, rockMaterial, rockPlacements.length));
    setInstancedTransforms(rocks, rockPlacements);

    const fernGeometry = ownGeometry(buildFernGeometry());
    const fernMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial());
    fernMaterial.colorNode = nodeColor(0x235145)
        .add(nodeColor(PALETTE.fungal).mul(foliageKey.mul(0.19)));
    fernMaterial.side = THREE.DoubleSide;
    const ferns = add(new THREE.InstancedMesh(fernGeometry, fernMaterial, fernPlacements.length));
    setInstancedTransforms(ferns, fernPlacements);

    // A small authored vocabulary of bioluminescent fungi provides rare color
    // punctuation at the clearing edge without becoming a glitter field.
    const fungiCapGeometry = ownGeometry(new THREE.SphereGeometry(1, 10, 5, 0, TAU, 0, Math.PI * 0.5));
    const fungiStemGeometry = ownGeometry(new THREE.CylinderGeometry(0.22, 0.34, 1, 6));
    const fungiKinds = new Float32Array(quality.fungi);
    const fungiOrders = new Float32Array(quality.fungi);
    fungiCapGeometry.setAttribute('aFungiKind', new THREE.InstancedBufferAttribute(fungiKinds, 1));
    fungiCapGeometry.setAttribute('aFungiOrder', new THREE.InstancedBufferAttribute(fungiOrders, 1));
    const fungiKind = attribute('aFungiKind', 'float');
    const fungiOrder = attribute('aFungiOrder', 'float');
    const fungiWakeWave = sin(fungiOrder.sub(uComboPhase).mul(TAU)).mul(0.5).add(0.5);
    const fungiWake = smoothstep(0.82, 0.98, fungiWakeWave).mul(uComboTier);
    const fungiLockDistance = length(positionWorld.xz.sub(uLockOrigin));
    const fungiLockWake = smoothstep(5, 25, fungiLockDistance).oneMinus();
    const fungiCapMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial());
    const fungiGlow = float(0.68)
        .add(uAmbientEnergy.mul(0.16))
        .add(uLockPulse.mul(fungiLockWake).mul(0.32))
        .add(uComboPulse.mul(0.24))
        .add(uComboPulse.mul(fungiWake).mul(0.38));
    const fungiBaseColor = mix(
        nodeColor(PALETTE.fungal),
        nodeColor(PALETTE.firefly),
        fungiKind,
    );
    fungiCapMaterial.colorNode = mix(
        fungiBaseColor,
        nodeColor(PALETTE.silver),
        fungiWake.mul(uComboPulse).mul(0.28),
    ).mul(fungiGlow);
    fungiCapMaterial.toneMapped = false;
    const fungiStemMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial());
    fungiStemMaterial.colorNode = nodeColor(0x17292d);
    const capPlacements = [];
    const stemPlacements = [];
    const fungiRng = makeRng(58193);
    const authoredFungi = [
        {
            x: -65, z: 10, scale: 1.55, baseY: -3.2, kind: 1,
        },
        {
            x: -61, z: 7, scale: 0.92, baseY: -3.1, kind: 1,
        },
        {
            x: 62, z: -7, scale: 1.35, baseY: -3.3, kind: 0,
        },
        {
            x: 57, z: -12, scale: 0.82, baseY: -3.25, kind: 0,
        },
    ];
    for (let i = 0; i < quality.fungi; i += 1) {
        const authored = authoredFungi[i];
        const side = i % 2 === 0 ? -1 : 1;
        const z = authored?.z ?? (20 - fungiRng() * 138);
        const x = authored?.x ?? (side * (28 + fungiRng() * (39 + Math.max(0, -z) * 0.16)));
        const scale = authored?.scale ?? (0.7 + fungiRng() * 1.15);
        const baseY = authored?.baseY ?? (-3.8 + fungiRng() * 1.15);
        fungiKinds[i] = authored?.kind ?? (fungiRng() > 0.86 ? 1 : 0);
        fungiOrders[i] = quality.fungi > 1 ? i / (quality.fungi - 1) : 0;
        stemPlacements.push({
            x, y: baseY + scale * 0.42, z, sx: scale * 0.72, sy: scale, sz: scale * 0.72,
        });
        capPlacements.push({
            x,
            y: baseY + scale * 0.86,
            z,
            sx: scale,
            sy: scale * 0.42,
            sz: scale,
            ry: fungiRng() * TAU,
        });
    }
    const fungiStems = add(new THREE.InstancedMesh(
        fungiStemGeometry,
        fungiStemMaterial,
        stemPlacements.length,
    ));
    setInstancedTransforms(fungiStems, stemPlacements);
    const fungiCaps = add(new THREE.InstancedMesh(
        fungiCapGeometry,
        fungiCapMaterial,
        capPlacements.length,
    ));
    setInstancedTransforms(fungiCaps, capPlacements);

    const fungiAuraGeometry = ownGeometry(new THREE.PlaneGeometry(1, 1));
    fungiAuraGeometry.setAttribute(
        'aFungiKind',
        new THREE.InstancedBufferAttribute(new Float32Array(fungiKinds), 1),
    );
    fungiAuraGeometry.setAttribute(
        'aFungiOrder',
        new THREE.InstancedBufferAttribute(new Float32Array(fungiOrders), 1),
    );
    const fungiAuraMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial());
    const fungiAuraRadius = length(uv().sub(vec2(0.5)));
    const fungiAuraOrder = attribute('aFungiOrder', 'float');
    const fungiAuraWakeWave = sin(fungiAuraOrder.sub(uComboPhase).mul(TAU)).mul(0.5).add(0.5);
    const fungiAuraWake = smoothstep(0.82, 0.98, fungiAuraWakeWave).mul(uComboTier);
    const fungiAuraLockDistance = length(positionWorld.xz.sub(uLockOrigin));
    const fungiAuraLockWake = smoothstep(5, 25, fungiAuraLockDistance).oneMinus();
    fungiAuraMaterial.colorNode = mix(
        nodeColor(PALETTE.fungal),
        nodeColor(PALETTE.firefly),
        attribute('aFungiKind', 'float'),
    );
    fungiAuraMaterial.opacityNode = smoothstep(0.08, 0.50, fungiAuraRadius)
        .oneMinus()
        .mul(float(0.055)
            .add(uAmbientEnergy.mul(0.025))
            .add(uLockPulse.mul(fungiAuraLockWake).mul(0.11))
            .add(uComboPulse.mul(0.10))
            .add(uComboPulse.mul(fungiAuraWake).mul(0.20)));
    fungiAuraMaterial.transparent = true;
    fungiAuraMaterial.depthWrite = false;
    fungiAuraMaterial.blending = THREE.AdditiveBlending;
    fungiAuraMaterial.toneMapped = false;
    const fungiAuras = add(new THREE.InstancedMesh(
        fungiAuraGeometry,
        fungiAuraMaterial,
        capPlacements.length,
    ));
    setInstancedTransforms(fungiAuras, capPlacements.map((placement) => ({
        ...placement,
        sx: placement.sx * 3.0,
        sy: placement.sx * 3.0,
        sz: 1,
    })));

    // Three localized mist ribbons; soft UV/noise masks keep their planes invisible.
    const mistGeometry = ownGeometry(new THREE.PlaneGeometry(1, 1, 20, 2));
    const mistMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial());
    const mistUv = uv();
    const mistHorizontal = smoothstep(0.0, 0.18, mistUv.x)
        .mul(smoothstep(0.82, 1.0, mistUv.x).oneMinus());
    const mistVertical = smoothstep(0.02, 0.38, mistUv.y)
        .mul(smoothstep(0.56, 0.98, mistUv.y).oneMinus());
    const mistNoise = quality.atmosphereNoise
        ? mx_noise_float(
            vec3(
                mistUv.x.mul(5.2),
                mistUv.y.mul(1.7),
                uTime.mul(0.018).add(positionWorld.z.mul(0.002)),
            ),
            1,
            0,
        ).mul(0.5).add(0.5)
        : float(0.5);
    mistMaterial.colorNode = mix(nodeColor(0x335d68), nodeColor(0x54808a), mistUv.y);
    const mistComboEdges = smoothstep(18, 48, abs(positionWorld.x));
    mistMaterial.opacityNode = mistHorizontal.mul(mistVertical)
        .mul(float(0.14).add(mistNoise.mul(quality.atmosphereNoise ? 0.17 : 0.08)))
        .mul(float(1)
            .add(uAmbientEnergy.mul(0.12))
            .add(uLockPulse.mul(0.10))
            .add(uComboPulse.mul(mistComboEdges).mul(0.56)));
    mistMaterial.transparent = true;
    mistMaterial.depthWrite = false;
    mistMaterial.side = THREE.DoubleSide;
    mistMaterial.blending = THREE.NormalBlending;
    mistMaterial.toneMapped = false;
    const mistPlacements = [
        {
            x: -20, y: 9.5, z: -96, sx: 148, sy: 23, rz: -0.018,
        },
        {
            x: 29, y: 13.5, z: -151, sx: 188, sy: 28, rz: 0.014,
        },
        {
            x: -18, y: 18.5, z: -218, sx: 238, sy: 32, rz: -0.01,
        },
    ];
    const activeMistPlacements = mistPlacements.slice(0, quality.mistLayers).reverse();
    const mist = add(new THREE.InstancedMesh(
        mistGeometry,
        mistMaterial,
        activeMistPlacements.length,
    ));
    setInstancedTransforms(mist, activeMistPlacements.map((placement) => ({
        ...placement,
        sz: 1,
    })));
    mist.renderOrder = 2;

    // Patterned fireflies: compact instanced geometry, long dark pauses, no sprite pool.
    const fireflyCount = quality.fireflies;
    const fireflyGeometry = ownGeometry(new THREE.IcosahedronGeometry(0.12, 0));
    const fireflyPhases = new Float32Array(fireflyCount);
    const fireflyKinds = new Float32Array(fireflyCount);
    fireflyGeometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(fireflyPhases, 1));
    fireflyGeometry.setAttribute('aKind', new THREE.InstancedBufferAttribute(fireflyKinds, 1));
    const fireflyMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial());
    const fireflyPhase = attribute('aPhase', 'float');
    const fireflyKind = attribute('aKind', 'float');
    const flashWave = sin(uTime.mul(1.08).add(fireflyPhase.mul(TAU))).mul(0.5).add(0.5);
    const flash = smoothstep(0.78, 0.965, flashWave);
    const comboWakeWave = sin(fireflyPhase.sub(uComboPhase).mul(TAU)).mul(0.5).add(0.5);
    const comboWake = smoothstep(0.80, 0.985, comboWakeWave).mul(uComboTier);
    const fireflyBaseColor = mix(
        nodeColor(PALETTE.fungal),
        nodeColor(PALETTE.firefly),
        fireflyKind,
    );
    fireflyMaterial.colorNode = mix(
        fireflyBaseColor,
        nodeColor(PALETTE.silver),
        uComboPulse.mul(0.24),
    );
    fireflyMaterial.opacityNode = clamp(
        flash.mul(0.72)
            .add(uLockPulse.mul(0.14))
            .add(uComboPulse.mul(0.16))
            .add(uComboPulse.mul(comboWake).mul(0.52))
            .add(uAmbientEnergy.mul(0.04)),
        0,
        0.92,
    );
    fireflyMaterial.positionNode = positionLocal.add(vec3(
        sin(uTime.mul(0.23).add(fireflyPhase.mul(9.1))).mul(0.72)
            .add(sin(uTime.mul(1.8).add(fireflyPhase.mul(TAU)))
                .mul(uComboPulse).mul(comboWake.mul(0.9).add(0.1)).mul(1.4)),
        sin(uTime.mul(0.19).add(fireflyPhase.mul(13.7))).mul(0.42)
            .add(cos(uTime.mul(1.45).add(fireflyPhase.mul(TAU)))
                .mul(uComboPulse).mul(comboWake.mul(0.9).add(0.1)).mul(0.82)),
        cos(uTime.mul(0.17).add(fireflyPhase.mul(7.3))).mul(0.55),
    ));
    fireflyMaterial.transparent = true;
    fireflyMaterial.depthWrite = false;
    fireflyMaterial.blending = THREE.AdditiveBlending;
    fireflyMaterial.toneMapped = false;
    const fireflyPlacements = [];
    const fireflyRng = makeRng(66337);
    for (let i = 0; i < fireflyCount; i += 1) {
        const side = i % 2 === 0 ? -1 : 1;
        const z = 8 - fireflyRng() * 122;
        const x = side * (20 + fireflyRng() * 55);
        const scale = 0.65 + fireflyRng() * 1.35;
        fireflyPhases[i] = fireflyRng();
        fireflyKinds[i] = fireflyRng() > 0.76 ? 1 : 0;
        fireflyPlacements.push({
            x, y: 1.0 + fireflyRng() * 19, z, scale,
        });
    }
    const fireflies = add(new THREE.InstancedMesh(
        fireflyGeometry,
        fireflyMaterial,
        fireflyPlacements.length,
    ));
    setInstancedTransforms(fireflies, fireflyPlacements);

    const fireflyAuraGeometry = ownGeometry(new THREE.PlaneGeometry(1, 1));
    fireflyAuraGeometry.setAttribute(
        'aPhase',
        new THREE.InstancedBufferAttribute(new Float32Array(fireflyPhases), 1),
    );
    fireflyAuraGeometry.setAttribute(
        'aKind',
        new THREE.InstancedBufferAttribute(new Float32Array(fireflyKinds), 1),
    );
    const fireflyAuraMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial());
    const auraPhase = attribute('aPhase', 'float');
    const auraFlashWave = sin(uTime.mul(1.08).add(auraPhase.mul(TAU))).mul(0.5).add(0.5);
    const auraFlash = smoothstep(0.78, 0.965, auraFlashWave);
    const auraComboWakeWave = sin(auraPhase.sub(uComboPhase).mul(TAU)).mul(0.5).add(0.5);
    const auraComboWake = smoothstep(0.80, 0.985, auraComboWakeWave).mul(uComboTier);
    const auraRadius = length(uv().sub(vec2(0.5)));
    fireflyAuraMaterial.colorNode = mix(
        nodeColor(PALETTE.fungal),
        nodeColor(PALETTE.firefly),
        attribute('aKind', 'float'),
    );
    fireflyAuraMaterial.opacityNode = smoothstep(0.02, 0.50, auraRadius)
        .oneMinus()
        .mul(auraFlash.mul(0.105)
            .add(uLockPulse.mul(0.045))
            .add(uComboPulse.mul(0.055))
            .add(uComboPulse.mul(auraComboWake).mul(0.19)));
    fireflyAuraMaterial.positionNode = positionLocal.add(vec3(
        sin(uTime.mul(0.23).add(auraPhase.mul(9.1))).mul(0.72)
            .add(sin(uTime.mul(1.8).add(auraPhase.mul(TAU)))
                .mul(uComboPulse).mul(auraComboWake.mul(0.9).add(0.1)).mul(1.4)),
        sin(uTime.mul(0.19).add(auraPhase.mul(13.7))).mul(0.42)
            .add(cos(uTime.mul(1.45).add(auraPhase.mul(TAU)))
                .mul(uComboPulse).mul(auraComboWake.mul(0.9).add(0.1)).mul(0.82)),
        cos(uTime.mul(0.17).add(auraPhase.mul(7.3))).mul(0.55),
    ));
    fireflyAuraMaterial.transparent = true;
    fireflyAuraMaterial.depthWrite = false;
    fireflyAuraMaterial.blending = THREE.AdditiveBlending;
    fireflyAuraMaterial.toneMapped = false;
    const fireflyAuras = add(new THREE.InstancedMesh(
        fireflyAuraGeometry,
        fireflyAuraMaterial,
        fireflyPlacements.length,
    ));
    setInstancedTransforms(fireflyAuras, fireflyPlacements.map((placement) => ({
        ...placement,
        scale: placement.scale * 2.8,
    })));

    if (params?.get('boardGuide') === '1') {
        const guideMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial());
        guideMaterial.colorNode = nodeColor(0x91b5b8);
        guideMaterial.wireframe = true;
        guideMaterial.transparent = true;
        guideMaterial.opacity = 0.28;
        guideMaterial.depthWrite = false;
        const guide = add(new THREE.Mesh(
            ownGeometry(new THREE.PlaneGeometry(36, 48)),
            guideMaterial,
        ));
        guide.position.set(0, 20, -52);
    }

    const setLockOrigin = (origin) => {
        if (!origin) return;
        lockTarget.set(
            THREE.MathUtils.clamp(origin.x, -WORLD_LIMIT, WORLD_LIMIT),
            THREE.MathUtils.clamp(origin.z, -WORLD_LIMIT, 52),
        );
    };

    const reactiveEnvelope = (progress, attackEnd, releaseStart) => {
        const attack = THREE.MathUtils.smoothstep(progress, 0, attackEnd);
        const release = 1 - THREE.MathUtils.smoothstep(progress, releaseStart, 1);
        return attack * release;
    };

    const advanceReactiveEvents = (dt) => {
        if (Number.isFinite(lockAge)) {
            lockAge = Math.min(lockDuration, lockAge + dt);
            const progress = lockDuration > 0 ? lockAge / lockDuration : 1;
            uLockPhase.value = progress;
            uLockPulse.value = lockStrength * reactiveEnvelope(progress, 0.07, 0.62);
            if (progress >= 1) {
                lockAge = Number.POSITIVE_INFINITY;
                uLockPulse.value = 0;
            }
        }
        if (Number.isFinite(comboAge)) {
            comboAge = Math.min(comboDuration, comboAge + dt);
            const progress = comboDuration > 0 ? comboAge / comboDuration : 1;
            uComboPhase.value = progress;
            uComboPulse.value = comboStrength * reactiveEnvelope(progress, 0.10, 0.60);
            if (progress >= 1) {
                comboAge = Number.POSITIVE_INFINITY;
                uComboPulse.value = 0;
                comboVeilEnabled = false;
            }
        }
    };

    const startLockEvent = (strength, duration = 0.62) => {
        lockAge = 0;
        lockDuration = Math.max(0.12, duration);
        lockStrength = THREE.MathUtils.clamp(strength, 0, 1);
        uLockPhase.value = 0;
        uLockPulse.value = 0;
        if (reactivePipelinesPrimed) lockBloom.visible = true;
    };

    const startComboEvent = ({
        strength, tier = 0, duration = 1.45, veilEnabled = false,
    }) => {
        comboAge = 0;
        comboDuration = Math.max(0.2, duration);
        comboStrength = THREE.MathUtils.clamp(strength, 0, 1);
        uComboTier.value = THREE.MathUtils.clamp(tier, 0, 1);
        uComboPhase.value = 0;
        uComboPulse.value = 0;
        comboVeilEnabled = veilEnabled
            && qualityName !== 'Minimal'
            && qualityName !== 'Low';
        if (reactivePipelinesPrimed && comboVeilEnabled) veil.visible = true;
    };

    const setReactive = (state = {}) => {
        const {
            energy: directEnergy,
            atmospherePulse,
        } = state;
        let energy = null;
        if (Number.isFinite(directEnergy)) energy = directEnergy;
        else if (Number.isFinite(atmospherePulse)) energy = atmospherePulse / 2.5;
        if (Number.isFinite(energy)) {
            ambientTarget = THREE.MathUtils.clamp(energy, 0, 1);
        }
        setLockOrigin(extractWorldOrigin(state));
    };

    const triggerEvent = (type, payload = {}) => {
        const eventType = String(type || '').toLowerCase();
        const intensity = Number.isFinite(payload.intensity)
            ? THREE.MathUtils.clamp(Number(payload.intensity), 0, 1)
            : 1;
        const amount = THREE.MathUtils.clamp(Number(payload.amount) || 1, 0, 12);
        const directOrigin = extractWorldOrigin(payload);
        setLockOrigin(directOrigin);
        if (eventType.includes('lock')) {
            if (directOrigin) uLockOrigin.value.copy(lockTarget);
            startLockEvent(intensity, 0.62);
        } else if (eventType.includes('line')) {
            if (directOrigin) uLockOrigin.value.copy(lockTarget);
            const lineCount = Math.max(1, Number(payload.lineCount) || 1);
            startLockEvent(Math.min(1, (0.48 + lineCount * 0.12) * intensity), 0.76);
            startComboEvent({
                strength: Math.min(0.62, 0.16 + lineCount * 0.09) * intensity,
                tier: Math.min(0.58, lineCount * 0.14),
                duration: 0.94,
            });
        } else if (eventType.includes('combo')) {
            const count = Number(payload.comboCount ?? payload.count ?? 2);
            const tier = THREE.MathUtils.clamp((count - 1) / 7, 0, 1);
            startComboEvent({
                strength: THREE.MathUtils.clamp(0.32 + count * 0.085, 0, 1) * intensity,
                tier,
                duration: 1.45,
                veilEnabled: count >= 4,
            });
        } else if (eventType.includes('tspin') || eventType.includes('t-spin')) {
            if (directOrigin) uLockOrigin.value.copy(lockTarget);
            startLockEvent(0.88 * intensity, 0.90);
            startComboEvent({
                strength: 0.62 * intensity,
                tier: 0.72,
                duration: 1.05,
            });
        } else if (eventType.includes('perfect')) {
            if (directOrigin) uLockOrigin.value.copy(lockTarget);
            startLockEvent(0.92 * intensity, 1.35);
            startComboEvent({
                strength: intensity,
                tier: 1,
                duration: 2.2,
                veilEnabled: true,
            });
        } else if (
            eventType.includes('firefl')
            || eventType.includes('spore')
            || eventType.includes('leav')
            || eventType.includes('wisp')
            || eventType.includes('spark')
            || eventType.includes('rune')
            || eventType.includes('mist')
            || eventType.includes('shooting')
            || eventType.includes('aurora')
        ) {
            // Legacy burst directives feed the slow atmosphere without restarting
            // the authored event envelope or allocating a particle pool.
            ambientTarget = Math.max(
                ambientTarget,
                THREE.MathUtils.clamp(0.16 + amount * 0.018, 0.16, 0.42) * intensity,
            );
        }
    };

    const triggerBursts = (bursts = []) => {
        const count = Math.min(MAX_BURSTS_PER_TICK, Array.isArray(bursts) ? bursts.length : 0);
        for (let i = 0; i < count; i += 1) {
            const burst = bursts[i] || {};
            const payload = burst.payload
                ? { ...burst.payload, amount: burst.amount ?? burst.payload.amount }
                : burst;
            triggerEvent(burst.type || burst.event || burst.kind || burst.name, payload);
        }
    };

    const previewEvent = params?.get('event');
    if (previewEvent) {
        triggerEvent(previewEvent, {
            comboCount: Number(params?.get('combo') || 6),
            origin: { x: 0, z: -50 },
        });
        const previewPhase = THREE.MathUtils.clamp(Number(params?.get('eventPhase') || 0.32), 0, 2);
        if (Number.isFinite(lockAge)) lockAge = Math.min(lockDuration, previewPhase);
        if (Number.isFinite(comboAge)) comboAge = Math.min(comboDuration, previewPhase);
        advanceReactiveEvents(0);
    }

    return {
        cameraRadius: 104,
        camera(_time, activeCamera) {
            if (cameraConfigured) return;
            activeCamera.position.set(0, 22, 86);
            activeCamera.lookAt(0, 14, -104);
            activeCamera.fov = 46;
            activeCamera.near = 0.1;
            activeCamera.far = 2400;
            activeCamera.updateProjectionMatrix();
            cameraConfigured = true;
        },
        update(time, suppliedDt) {
            const measuredDt = lastTime == null ? 0 : THREE.MathUtils.clamp(time - lastTime, 0, 0.1);
            const dt = Number.isFinite(suppliedDt)
                ? THREE.MathUtils.clamp(suppliedDt, 0, 0.1)
                : measuredDt;
            lastTime = time;
            uTime.value = time;
            const ambientEase = 1 - Math.exp(-dt * 2.4);
            const originEase = 1 - Math.exp(-dt * 9.0);
            uAmbientEnergy.value += (ambientTarget - uAmbientEnergy.value) * ambientEase;
            uLockOrigin.value.lerp(lockTarget, originEase);
            advanceReactiveEvents(dt);
            lockBloom.position.x = uLockOrigin.value.x;
            lockBloom.position.z = uLockOrigin.value.y;
            if (reactivePipelinesPrimed) {
                lockBloom.visible = uLockPulse.value > 0.008;
                veil.visible = comboVeilEnabled && uComboPulse.value > 0.012;
            }
            moonGroup.quaternion.copy(camera.quaternion);
            halo.scale.setScalar(1 + uComboPulse.value * 0.075);
        },
        render() {
            renderer?.render(scene, camera);
            if (!reactivePipelinesPrimed) {
                reactivePipelinesPrimed = true;
                lockBloom.visible = uLockPulse.value > 0.008;
                veil.visible = comboVeilEnabled && uComboPulse.value > 0.012;
            }
        },
        async renderAsync() {
            await renderer?.compileAsync?.(scene, camera);
            renderer?.render(scene, camera);
            if (!reactivePipelinesPrimed) {
                reactivePipelinesPrimed = true;
                lockBloom.visible = uLockPulse.value > 0.008;
                veil.visible = comboVeilEnabled && uComboPulse.value > 0.012;
            }
        },
        resize() {},
        getDiagnostics() {
            let meshCount = 0;
            let visibleMeshCount = 0;
            let instanceCount = 0;
            root.traverse((object) => {
                if (!object.isMesh) return;
                meshCount += 1;
                if (object.visible) visibleMeshCount += 1;
                if (object.isInstancedMesh) instanceCount += object.count;
            });
            return {
                quality: qualityName,
                meshCount,
                visibleMeshCount,
                instanceCount,
                post: false,
            };
        },
        setReactive,
        triggerEvent,
        triggerBursts,
        dispose() {
            scene.remove(root);
            geometries.forEach((geometry) => geometry.dispose());
            materials.forEach((material) => material.dispose());
            geometries.clear();
            materials.clear();
            scene.background = previousBackground;
            scene.fog = previousFog;
            scene.fogNode = previousFogNode;
            if (renderer) {
                renderer.toneMapping = previousToneMapping;
                renderer.toneMappingExposure = previousExposure;
                renderer.outputColorSpace = previousOutputColorSpace;
            }
        },
    };
}
