/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies, camelcase */
/**
 * Winter Wonderland — the COMPLETE winter scene in one playground effect, authored
 * the halcyon-apex way (whole scene here; the theme becomes a thin wrapper).
 *
 * A dark winter night: cobalt sky + volumetric aurora, a bright moon with halo,
 * layered cool-blue Odyssey-Ch4 snow peaks, a frozen reflective lake (moon glitter
 * column + aurora reflection), snow-laden detailed pines framing the corners +
 * a receding treeline, snowy ground, and heavy full-screen falling snow. No
 * post-processing (direct render, NoToneMapping) — the look is baked into the
 * materials, exactly like halcyon-apex.
 *
 * One palette (WINTER_PALETTE): cobalt night / cyan ice / emerald-teal aurora /
 * white moon, so every layer reads as one painting. Composition + framing solved
 * for the FOV-55 playground camera.
 */
import * as THREE from 'three/webgpu';
import {
    uniform, attribute, uv, positionLocal, positionWorld, positionView, normalView, normalWorld,
    normalize, vec2, vec3, float, mix, clamp, smoothstep, sin, cos, mod, pow,
    dot, length, cameraPosition, mx_noise_float,
} from 'three/tsl';
import { createAuroraVolume } from '../../themes/winter/rendering/aurora-volume.js';
import { createFramingSpruces } from '../../themes/winter/rendering/framing-spruces.js';
import { createArcticFox } from '../../themes/winter/rendering/arctic-fox.js';
import { SnowSim } from '../../themes/winter/sim/snow-sim.js';
import { createSnowRenderer } from '../../themes/winter/rendering/snow-renderer.js';
import {
    createWinterLakeNodeMaterial,
    createWinterMoonNodeMaterial,
    createWinterMoonHaloNodeMaterial,
} from '../../themes/winter/winter-materials.js';
import {
    mountainCpuDisplacement,
    mountainColorNode,
    resolveMountainTreatment,
} from '../../rendering/odyssey/chapter-environments/shared/mountain-language.js';

export const meta = {
    id: 'winter-wonderland',
    title: 'Winter Wonderland (full scene)',
    description: 'Complete dark winter night — aurora, moon, peaks, frozen lake, forest, snow.',
};

// ── One four-family palette (single source of truth) ──────────────────────────
const PAL = {
    skyTop: 0x040a1c,
    skyHorizon: 0x0a1c38,
    cobaltDeep: 0x081a30,
    cobaltMid: 0x12325a,
    cobaltLit: 0x2b5a93,
    iceShore: 0x0c4a5e,
    iceCenter: 0x1fb6c4,
    iceCrack: 0x9fe8f4,
    auroraEmerald: 0x39e0a0,
    auroraTeal: 0x2aa890,
    auroraCyanTip: 0x7ff2d6,
    moonWhite: 0xf4f8ff,
    snowLit: 0xbcd2ef,
    snowShadow: 0x4f6f9e,
};

const FEET_Y = -260;
const GROUND_Y = -280;
const LAKE_Y = -276;
const LAKE_Z = -1350;
const MOON_POS = new THREE.Vector3(1650, 1050, -2400);

// Close-camera framing spruces [x, z, worldHeight] — snow-laden summer-spruce
// "wings" hugging the LEFT & RIGHT screen edges, framing the open centre (lake /
// peaks / moon). Per side: a near hero (big, low corner), a taller one set back +
// further out, and a wide back tree that closes the frame. Base sits at FEET_Y; the
// GLB is unit-height so the third value is the world height. Tuned for the FOV-55
// camera resting at (0,78,760) looking toward (0,120,-1900) — iterate via the
// playground screenshot, not by eye (see framing-spruces.js).
const FRAMING_SPRUCES = [
    // [x, z, worldHeight, variantIndex] (0 slim / 1 full / 2 classic) — mixed per
    // side so the wings don't look like clones. Left: full near hero + tall slim set
    // back. Right: classic near hero + tall slim set back.
    [-520, 230, 600, 1], [-740, 40, 800, 0],
    // Right side
    [520, 250, 600, 1], [740, 60, 800, 0],
];
// Treeline on the FAR lakeshore — a fuller mid-ground forest BAND (per reference):
// more trees, an extra row, taller, brought slightly forward of the (now lower)
// mountains so it reads as the dense conifer belt between lake and peaks.
const TREELINE = {
    count: 340, rows: 6, xSpan: 5400, xCenter: 0, zBack: -1880, rowGap: 110, baseY: -274, hMin: 90, hMax: 190,
};

// ── AAA falling-snow tiers (camera-relative GPU-compute billboards) ──
// docs/WINTER_SNOW_MASTERPIECE_PLAN.md. `bounds` = half-extents of the wrap box
// centred on the live camera; `boxOffset` shifts it forward(-z)/up so the volume
// sits in front of the eye. Depth comes from STRATIFICATION (far→mid→near→bokeh),
// each tier with its own size / fall speed / colour / blend.
const SNOW_TIERS = [
    {
        name: 'far',
        sim: {
            count: 6000, bounds: { x: 2400, y: 1400, z: 1500 }, boxOffset: new THREE.Vector3(0, 160, -650),
            fallSpeed: 38, curlFreq: 0.0035, curlStr: 16, breeze: new THREE.Vector3(12, 0, 5),
            gustFreq: 0.18, gustAmp: 0.7, inertia: 0.12, spinRate: 0.25,
        },
        render: {
            shape: 'gaussian', color: 0xcfe0ff, size: 2.6, opacity: 0.24, glint: 0.0,
            fogNear: 1300, fogFar: 3000, fogStrength: 0.9, additive: false, renderOrder: 1,
        },
    },
    {
        name: 'mid',
        sim: {
            count: 4500, bounds: { x: 1500, y: 1050, z: 1100 }, boxOffset: new THREE.Vector3(0, 90, -460),
            fallSpeed: 66, curlFreq: 0.006, curlStr: 26, breeze: new THREE.Vector3(16, 0, 7),
            gustFreq: 0.22, gustAmp: 0.85, inertia: 0.18, spinRate: 0.6,
        },
        render: {
            shape: 'star', color: 0xf5f8ff, size: 4.4, opacity: 0.42, glint: 0.35,
            fogNear: 1100, fogFar: 2800, fogStrength: 0.45, additive: false, renderOrder: 2,
        },
    },
    {
        name: 'near',
        sim: {
            count: 1000, bounds: { x: 820, y: 680, z: 720 }, boxOffset: new THREE.Vector3(0, 30, -300),
            fallSpeed: 92, curlFreq: 0.009, curlStr: 42, breeze: new THREE.Vector3(22, 0, 10),
            gustFreq: 0.26, gustAmp: 1.1, inertia: 0.22, spinRate: 1.0,
        },
        render: {
            shape: 'star', color: 0xd8f0ff, size: 12, opacity: 0.6, glint: 0.9,
            fogNear: 1600, fogFar: 3200, fogStrength: 0.1, additive: false, renderOrder: 3,
        },
    },
    {
        name: 'bokeh',
        sim: {
            count: 12, bounds: { x: 650, y: 420, z: 150 }, boxOffset: new THREE.Vector3(0, 70, -170),
            fallSpeed: 22, curlFreq: 0.004, curlStr: 8, breeze: new THREE.Vector3(10, 0, 4),
            gustFreq: 0.15, gustAmp: 0.5, inertia: 0.10, spinRate: 0.25,
        },
        render: {
            shape: 'bokeh', color: 0xeaf2ff, size: 90, opacity: 0.1, glint: 0.0,
            fogNear: 1400, fogFar: 3000, fogStrength: 0.0, additive: true, renderOrder: 4,
        },
    },
];

// ── One Odyssey-Ch4 FBM snow peak (cool, moonlit; no warm alpenglow) — APPROVED ──
function buildWinterPeak({
    size, height, seed, position, fogNear, fogFar,
}) {
    const segments = 64;
    const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
    geometry.rotateX(-Math.PI / 2);
    const posAttr = geometry.attributes.position;
    const heights = new Float32Array(posAttr.count);
    for (let i = 0; i < posAttr.count; i += 1) {
        const h = mountainCpuDisplacement(posAttr.getX(i), posAttr.getZ(i), { size, height, seed });
        posAttr.setY(i, h);
        heights[i] = h / height;
    }
    geometry.computeVertexNormals();
    geometry.setAttribute('aHeight', new THREE.BufferAttribute(heights, 1));

    const t = resolveMountainTreatment({ coolTemp: 1.0 });
    const color = mountainColorNode({
        uSnow: uniform(new THREE.Color(t.snow)),
        uSnowShadow: uniform(new THREE.Color(t.snowShadow)),
        uRock: uniform(new THREE.Color(t.rock)),
        uShadow: uniform(new THREE.Color(t.shadow)),
        uFog: uniform(new THREE.Color(t.fog)),
        uAlpen: uniform(new THREE.Color(t.alpenglow)),
        uRim: uniform(new THREE.Color(t.rim)),
        uSnowLine: uniform(t.snowLine),
        uSnowBlend: uniform(0.4),
        vNormal: normalView,
        vWorldPosition: positionWorld,
        vHeight: attribute('aHeight', 'float'),
        keyDir: [0.4, 0.85, 0.35],
        alpenStrength: 0.0,
        ...(fogNear !== undefined ? { fogNear } : {}),
        ...(fogFar !== undefined ? { fogFar } : {}),
    });

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = color;
    material.opacityNode = clamp(smoothstep(0.02, 0.12, attribute('aHeight', 'float')), 0.0, 1.0);
    material.transparent = true;
    material.depthWrite = false;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(position);
    mesh.renderOrder = -20;
    mesh.frustumCulled = false;
    return { mesh, geometry, material };
}

// ── Vertex-animated full-screen falling snow (no compute; wraps in a world box) ──
function buildSnow(count, box) {
    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    const sizes = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
        positions[i * 3] = (Math.random() - 0.5) * box.w + box.cx;
        positions[i * 3 + 1] = (Math.random() - 0.5) * box.h + box.cy;
        positions[i * 3 + 2] = (Math.random() - 0.5) * box.d + box.cz;
        seeds[i] = Math.random();
        sizes[i] = 0.6 + Math.random() * 1.8;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

    const uTime = uniform(0);
    const aSeed = attribute('aSeed');
    const aSize = attribute('aSize');
    const material = new THREE.PointsNodeMaterial();
    material.transparent = true;
    material.depthWrite = false;

    const tau = float(Math.PI * 2);
    const fallSpeed = float(70).add(aSeed.mul(70));
    const bottom = float(box.cy - box.h * 0.5);
    const y0 = positionLocal.y.sub(bottom);
    const yWrapped = mod(y0.sub(uTime.mul(fallSpeed)), float(box.h)).add(bottom);
    const swayX = sin(uTime.mul(0.5).add(aSeed.mul(tau))).mul(float(30).add(aSeed.mul(40)));
    const swayZ = cos(uTime.mul(0.4).add(aSeed.mul(tau))).mul(22);
    material.positionNode = vec3(positionLocal.x.add(swayX), yWrapped, positionLocal.z.add(swayZ));
    material.sizeNode = aSize.mul(float(820).div(positionView.z.negate()));
    material.colorNode = vec3(0.74, 0.82, 0.96);
    material.opacityNode = clamp(aSize.mul(0.28).add(0.18), 0.0, 0.7);

    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    return {
        points, geometry, material, uTime,
    };
}

// ── Faceted low-poly snow drift field (CPU value-noise displace + flat normals) ──
function _vhash(ix, iz, seed) {
    const s = Math.sin(ix * 127.1 + iz * 311.7 + seed * 74.7) * 43758.5453;
    return s - Math.floor(s);
}
function _valueNoise2D(x, z, seed) {
    const ix = Math.floor(x); const iz = Math.floor(z);
    const fx = x - ix; const fz = z - iz;
    const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
    const uz = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
    const a = _vhash(ix, iz, seed); const b = _vhash(ix + 1, iz, seed);
    const c = _vhash(ix, iz + 1, seed); const d = _vhash(ix + 1, iz + 1, seed);
    const ab = a + (b - a) * ux; const cd = c + (d - c) * ux;
    return ab + (cd - ab) * uz;
}

function buildFacetedSnowDrifts({
    width = 12000, depth = 7000, segX = 120, segZ = 70, amp = 130, detailAmp = 36,
    posY = -280, posZ = -1400, lakeHalfX = 1900, lakeHalfZ = 850,
    lakeZWorld = -1500, lakeDepth = 150, moonDir = new THREE.Vector3(1500, 820, -2400),
} = {}) {
    const geometry = new THREE.PlaneGeometry(width, depth, segX, segZ);
    geometry.rotateX(-Math.PI / 2);
    const pos = geometry.attributes.position;
    const seed = 11.3;
    for (let i = 0; i < pos.count; i += 1) {
        const wx = pos.getX(i);
        const wz = pos.getZ(i) + posZ;
        const big = _valueNoise2D(wx * 0.00075, wz * 0.00075, seed);
        const small = _valueNoise2D(wx * 0.0032 + 5.0, wz * 0.0032 + 5.0, seed + 3.0);
        let h = (big - 0.45) * 2.0 * amp + (small - 0.5) * 2.0 * detailAmp;
        const bx = Math.max(0, Math.abs(wx) - lakeHalfX);
        const bz = Math.max(0, Math.abs(wz - lakeZWorld) - lakeHalfZ);
        const basin = Math.min(1, Math.sqrt(bx * bx + bz * bz) / 900);
        // Inside the lake: a near-FLAT bed sitting just below the ice plane (not a
        // deep pit) so the snow fills the space under the transparent ice — otherwise
        // the ice reads as a floating layer with a visible void beneath it.
        h = h * (0.05 + 0.95 * basin) - lakeDepth * (1 - basin);
        pos.setY(i, h);
    }
    const flatGeo = geometry.toNonIndexed();
    flatGeo.computeVertexNormals();
    geometry.dispose();

    const uMoonDir = uniform(moonDir.clone().normalize());
    const uLit = uniform(new THREE.Color(0xbcd2f2));
    const uShadow = uniform(new THREE.Color(0x16335c));
    const uDeep = uniform(new THREE.Color(0x0a1f3d));
    const uFog = uniform(new THREE.Color(0x12233a));
    const nView = normalize(normalView);
    const nWorld = normalize(normalWorld);
    const moonLambert = clamp(dot(nWorld, uMoonDir), 0.0, 1.0);
    const upFace = clamp(nWorld.y, 0.0, 1.0);
    const litAmount = clamp(moonLambert.mul(0.7).add(upFace.mul(0.45)), 0.0, 1.0);
    const lowMix = mix(uDeep, uShadow, smoothstep(0.0, 0.45, litAmount));
    let snowCol = mix(lowMix, uLit, smoothstep(0.4, 0.95, litAmount));
    const facetRim = pow(float(1.0).sub(clamp(nView.z, 0.0, 1.0)), float(2.2)).mul(0.10);
    snowCol = snowCol.add(vec3(0.32, 0.46, 0.7).mul(facetRim));
    const glint = mx_noise_float(vec3(positionWorld.xz.mul(0.06), float(0.0))).mul(0.5).add(0.5);
    const sparkle = smoothstep(0.86, 1.0, glint).mul(litAmount).mul(0.4);
    snowCol = snowCol.add(vec3(0.7, 0.82, 1.0).mul(sparkle));
    const dist = length(positionWorld.sub(cameraPosition));
    const fogT = smoothstep(float(300.0), float(3400.0), dist);
    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = clamp(mix(snowCol, uFog, fogT.mul(0.92)), 0.0, 1.1);
    material.emissiveNode = vec3(0.0);
    const mesh = new THREE.Mesh(flatGeo, material);
    mesh.position.set(0, posY, posZ);
    mesh.renderOrder = -30;
    mesh.frustumCulled = false;
    return { mesh, geometry: flatGeo, material };
}

function makeFacetedRockMaterial({ moonDir = new THREE.Vector3(1500, 820, -2400) } = {}) {
    const uMoonDir = uniform(moonDir.clone().normalize());
    const uRock = uniform(new THREE.Color(0x0c1c30));
    const uRockLit = uniform(new THREE.Color(0x24405f));
    const uSnow = uniform(new THREE.Color(0xcfe0f7));
    const uSnowShadow = uniform(new THREE.Color(0x33507a));
    const nWorld = normalize(normalWorld);
    const nView = normalize(normalView);
    const capNoise = mx_noise_float(vec3(positionWorld.mul(0.02))).mul(0.16);
    const snowFactor = smoothstep(float(0.34).add(capNoise), float(0.72).add(capNoise), nWorld.y);
    const moonLambert = clamp(dot(nWorld, uMoonDir), 0.0, 1.0);
    const rockCol = mix(uRock, uRockLit, smoothstep(0.1, 0.85, moonLambert));
    const snowCol = mix(uSnowShadow, uSnow, clamp(moonLambert.mul(0.6).add(0.4), 0.0, 1.0));
    let col = mix(rockCol, snowCol, snowFactor);
    const rim = pow(float(1.0).sub(clamp(nView.z, 0.0, 1.0)), float(2.5)).mul(0.08);
    col = col.add(vec3(0.3, 0.42, 0.62).mul(rim));
    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = clamp(col, 0.0, 1.1);
    material.emissiveNode = vec3(0.0);
    return material;
}

function buildFacetedRock(material, radius = 90) {
    const geo = new THREE.IcosahedronGeometry(radius, 1);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i += 1) {
        const x = pos.getX(i); const y = pos.getY(i); const z = pos.getZ(i);
        const j = 0.55 + 0.45 * _vhash(Math.round(x), Math.round(z), i * 0.13 + 7);
        const sy = y < 0 ? 0.5 : 1.0;
        pos.setXYZ(i, x * j * 1.15, y * j * sy, z * j * 1.15);
    }
    const flat = geo.toNonIndexed();
    flat.computeVertexNormals();
    geo.dispose();
    const mesh = new THREE.Mesh(flat, material);
    mesh.rotation.y = Math.random() * Math.PI * 2;
    mesh.frustumCulled = false;
    return { mesh, geometry: flat };
}

// ── Soft painterly cloud: a camera-facing quad carved by noise (NormalBlending) ──
function buildSoftCloud(scale = 1.0) {
    const uTime = uniform(0);
    const uDrift = uniform(0);
    const uTint = uniform(new THREE.Color(0x9fb6d6));
    const uTintLit = uniform(new THREE.Color(0xdfe9fb));
    const uMoonSide = uniform(new THREE.Vector2(1.0, 0.55));
    const uOpacity = uniform(0.62);

    const vUv = uv();
    const cUv = vUv.sub(0.5);
    const ell = length(vec2(cUv.x.mul(1.0), cUv.y.mul(2.35)));
    const body = smoothstep(0.52, 0.16, ell);
    const f = float(2.6).mul(scale);
    const scroll = uTime.mul(0.015).add(uDrift);
    const n1 = mx_noise_float(vec3(vUv.x.mul(f).add(scroll), vUv.y.mul(f.mul(1.4)), uTime.mul(0.02)))
        .mul(0.5).add(0.5);
    const n2 = mx_noise_float(vec3(vUv.x.mul(f.mul(2.7)).sub(scroll.mul(0.6)), vUv.y.mul(f.mul(3.0)), float(7.0)))
        .mul(0.5).add(0.5);
    const puff = clamp(n1.mul(0.62).add(n2.mul(0.38)), 0.0, 1.0);
    const carved = clamp(body.mul(puff.mul(0.85).add(0.35)), 0.0, 1.0);
    const alpha = clamp(smoothstep(0.06, 0.42, carved), 0.0, 1.0).mul(uOpacity);
    const towardMoon = clamp(cUv.x.mul(uMoonSide.x).add(cUv.y.mul(uMoonSide.y)).add(0.5), 0.0, 1.0);
    const litGrad = smoothstep(0.25, 0.95, towardMoon);
    const litMix = clamp(litGrad.mul(0.7).add(puff.mul(0.3)), 0.0, 1.0);
    const tint = mix(uTint, uTintLit, litMix);

    const material = new THREE.MeshBasicNodeMaterial();
    material.transparent = true;
    material.depthWrite = false;
    material.depthTest = true;
    material.blending = THREE.NormalBlending;
    material.side = THREE.DoubleSide;
    material.colorNode = tint;
    material.opacityNode = alpha;
    material.emissiveNode = tint.mul(alpha.mul(0.12));
    return {
        material,
        uniforms: {
            uTime, uDrift, uMoonSide, uOpacity,
        },
    };
}

function buildMoonClouds(moonPos) {
    const group = new THREE.Group();
    const clouds = [];
    const specs = [
        [[-60, -70, 120], 620, 230, 0.9, 0.5, 130, 0.018, 0.0, -3],
        [[-520, -200, -40], 900, 300, 1.25, 0.46, 200, 0.013, 1.7, -4],
        [[260, 180, 110], 480, 150, 0.7, 0.4, 110, 0.024, 3.1, -3],
        [[640, -120, -120], 760, 240, 1.1, 0.36, 170, 0.011, 5.0, -5],
    ];
    specs.forEach(([off, w, h, scale, op, driftAmp, driftSpeed, phase, ro]) => {
        const { material, uniforms } = buildSoftCloud(scale);
        uniforms.uOpacity.value = op;
        uniforms.uMoonSide.value.set(-Math.sign(off[0] || 1) * 0.85, 0.7);
        const geo = new THREE.PlaneGeometry(w, h, 1, 1);
        const mesh = new THREE.Mesh(geo, material);
        mesh.position.set(moonPos.x + off[0], moonPos.y + off[1], moonPos.z + off[2]);
        mesh.renderOrder = ro;
        mesh.frustumCulled = false;
        group.add(mesh);
        clouds.push({
            mesh, uniforms, geo, baseX: mesh.position.x, driftAmp, driftSpeed, phase,
        });
    });
    return { group, clouds };
}

// ── Drifting snow-mist band: a wide, short, noise-carved soft billboard (cold pale
// haze) that hugs the treeline/lake to add atmospheric depth — the visible snowfog. ──
function buildSnowMistBand(scale = 1.0) {
    const uTime = uniform(0);
    const uDrift = uniform(0);
    const uTint = uniform(new THREE.Color(0xbcd3e3)); // cold pale haze
    const uOpacity = uniform(0.5);

    const vUv = uv();
    const cUv = vUv.sub(0.5);
    // Wide + short soft band: x tolerant (wide), y tight (short) → a low fog bank.
    const band = smoothstep(0.5, 0.05, length(vec2(cUv.x.mul(0.82), cUv.y.mul(2.3))));
    const f = float(3.0).mul(scale);
    const scroll = uTime.mul(0.01).add(uDrift);
    const n1 = mx_noise_float(vec3(vUv.x.mul(f).add(scroll), vUv.y.mul(f.mul(0.8)), uTime.mul(0.015)))
        .mul(0.5).add(0.5);
    const n2 = mx_noise_float(vec3(vUv.x.mul(f.mul(2.3)).sub(scroll.mul(0.5)), vUv.y.mul(f.mul(1.6)), float(11.0)))
        .mul(0.5).add(0.5);
    const puff = clamp(n1.mul(0.6).add(n2.mul(0.4)), 0.0, 1.0);
    const carved = clamp(band.mul(puff.mul(0.7).add(0.5)), 0.0, 1.0);
    const alpha = clamp(smoothstep(0.05, 0.5, carved), 0.0, 1.0).mul(uOpacity);

    const material = new THREE.MeshBasicNodeMaterial();
    material.transparent = true;
    material.depthWrite = false;
    material.depthTest = true;
    material.blending = THREE.NormalBlending;
    material.side = THREE.DoubleSide;
    material.colorNode = uTint;
    material.opacityNode = alpha;
    material.emissiveNode = uTint.mul(alpha.mul(0.1));
    return {
        material, uniforms: {
            uTime, uDrift, uOpacity, uTint,
        },
    };
}

function buildSnowMist() {
    const group = new THREE.Group();
    const bands = [];
    // [ [x,y,z], width, height, scale, opacity, driftPhase, renderOrder ]
    // Near band hugs the lake/forest base; far band separates forest from the peaks.
    const specs = [
        [[-200, -185, -1740], 5400, 520, 1.0, 0.40, 0.0, -8],
        [[1100, -195, -1660], 4200, 440, 1.2, 0.34, 1.7, -8],
        [[-1500, -165, -1820], 4400, 470, 1.1, 0.32, 3.1, -8],
        [[100, -80, -2080], 6200, 640, 1.4, 0.34, 4.2, -12],
        [[400, 40, -2780], 7200, 780, 1.7, 0.28, 5.5, -16],
    ];
    specs.forEach(([off, w, h, scale, op, phase, ro]) => {
        const { material, uniforms } = buildSnowMistBand(scale);
        uniforms.uOpacity.value = op;
        uniforms.uDrift.value = phase;
        const geo = new THREE.PlaneGeometry(w, h, 1, 1);
        const mesh = new THREE.Mesh(geo, material);
        mesh.position.set(off[0], off[1], off[2]);
        mesh.renderOrder = ro;
        mesh.frustumCulled = false;
        group.add(mesh);
        bands.push({
            mesh, uniforms, geo, baseX: off[0], driftAmp: 50 + scale * 50, driftSpeed: 0.008 + scale * 0.005, phase,
        });
    });
    return { group, bands };
}

export function create({ scene, renderer, camera }) {
    const disposables = [];
    const track = (obj) => { disposables.push(obj); return obj; };
    let prevTime = 0;

    // --- Pointer parallax + idle "breathing" camera state ---
    let pointerX = 0;
    let pointerY = 0;
    let smoothPointerX = 0;
    let smoothPointerY = 0;
    let prevCamTime = 0;
    const onPointerMove = (e) => {
        pointerX = (e.clientX / window.innerWidth) * 2 - 1;
        pointerY = (e.clientY / window.innerHeight) * 2 - 1;
    };
    if (typeof window !== 'undefined') window.addEventListener('pointermove', onPointerMove);

    // --- Sky + volumetric aurora dome (APPROVED) ---
    const aurora = createAuroraVolume({
        radius: 6000,
        steps: 26,
        accent: new THREE.Color(PAL.auroraEmerald),
        moonDir: MOON_POS.clone(),
    });
    aurora.uniforms.uIntensity.value = 0.62;
    scene.add(aurora.mesh);
    disposables.push(aurora);

    // --- Moon + halo (upper-right) ---
    const { material: moonMat } = createWinterMoonNodeMaterial({ color: new THREE.Color(PAL.moonWhite) });
    const moon = new THREE.Mesh(track(new THREE.SphereGeometry(190, 48, 48)), moonMat);
    moon.position.copy(MOON_POS);
    scene.add(moon);
    const { material: haloMat, uniforms: haloU } = createWinterMoonHaloNodeMaterial({
        intensity: 0.5, color: new THREE.Color(PAL.auroraCyanTip),
    });
    moon.add(new THREE.Mesh(track(new THREE.SphereGeometry(360, 32, 32)), haloMat));

    // --- Soft painterly clouds near the moon (NormalBlending wisps, not blobs) ---
    const moonClouds = buildMoonClouds(MOON_POS);
    scene.add(moonClouds.group);

    // --- Layered mountains (APPROVED look; placement reworked to reference) ---
    // Pushed FAR back + LOWERED to a distant, atmospheric (fog-blued) backdrop —
    // in the reference the peaks are a low, hazy-blue range sitting BELOW the aurora,
    // with the conifer treeline reading clearly in front. Tighter fog blues them out.
    // Nearest feet ≈ z-3200, well behind the treeline (z-1880…-2360).
    const peakSpecs = [
        {
            size: 4800, height: 540, seed: 5.1, position: new THREE.Vector3(-2700, FEET_Y, -4500), fogNear: 1100, fogFar: 5000,
        },
        {
            size: 4600, height: 500, seed: 9.7, position: new THREE.Vector3(2400, FEET_Y, -4700), fogNear: 1100, fogFar: 5000,
        },
        {
            size: 3500, height: 640, seed: 21.3, position: new THREE.Vector3(-1000, FEET_Y, -3800), fogNear: 1500, fogFar: 4700,
        },
        {
            size: 3300, height: 560, seed: 33.9, position: new THREE.Vector3(1300, FEET_Y, -3950), fogNear: 1500, fogFar: 4700,
        },
        {
            size: 3000, height: 600, seed: 42.2, position: new THREE.Vector3(-2150, FEET_Y, -3200), fogNear: 1900, fogFar: 5000,
        },
        {
            size: 2800, height: 540, seed: 58.6, position: new THREE.Vector3(2150, FEET_Y, -3300), fogNear: 1900, fogFar: 5000,
        },
    ];
    peakSpecs.forEach((s) => { const p = buildWinterPeak(s); scene.add(p.mesh); disposables.push(p); });

    // --- Faceted low-poly snow drift field (angular flat-shaded drifts) ---
    const drifts = buildFacetedSnowDrifts({
        width: 12000,
        depth: 7000,
        segX: 120,
        segZ: 70,
        amp: 130,
        detailAmp: 36,
        posY: GROUND_Y,
        posZ: -1400,
        lakeHalfX: 2050,
        lakeHalfZ: 600,
        lakeZWorld: LAKE_Z,
        lakeDepth: 12,
        moonDir: MOON_POS.clone(),
    });
    scene.add(drifts.mesh);
    disposables.push(drifts);

    // --- Frozen lake (reflective ice + moon column + aurora reflection) ---
    const { material: lakeMat, uniforms: lakeU } = createWinterLakeNodeMaterial({
        baseColor: new THREE.Color(PAL.iceShore),
        lakeColor: new THREE.Color(PAL.iceCenter),
        aurora: new THREE.Color(PAL.auroraTeal),
        moonColor: new THREE.Color(PAL.iceCrack),
        moonU: 0.78,
        fogColor: new THREE.Color(PAL.cobaltDeep),
        near: 320,
        far: 3000,
    });
    const lake = new THREE.Mesh(track(new THREE.PlaneGeometry(4200, 1100, 8, 8)), lakeMat);
    lake.rotation.x = -Math.PI / 2;
    lake.position.set(0, LAKE_Y, LAKE_Z);
    lake.renderOrder = -10;
    scene.add(lake);

    // --- Mid-ground conifer belt behind the lake: positions for the distant snowy
    // spruce treeline (the SAME snow-spruce GLB as the framing wings, instanced into
    // a few draw calls by framing-spruces.js → placeTreeline). Slight per-tree jitter
    // + random yaw breaks up the rows into an organic forest band. ---
    const placements = []; // { x, y, z, h, rotY }
    for (let i = 0; i < TREELINE.count; i += 1) {
        const row = i % TREELINE.rows;
        const x = TREELINE.xCenter - TREELINE.xSpan / 2
            + (Math.floor(i / TREELINE.rows) / (TREELINE.count / TREELINE.rows - 1)) * TREELINE.xSpan
            + (Math.random() - 0.5) * 150;
        const z = TREELINE.zBack - row * TREELINE.rowGap + (Math.random() - 0.5) * 110;
        placements.push({
            x,
            y: TREELINE.baseY,
            z,
            h: TREELINE.hMin + Math.random() * (TREELINE.hMax - TREELINE.hMin),
            rotY: Math.random() * Math.PI * 2,
        });
    }

    // --- Snowy spruces (framing wings + distant belt) are MeshStandard-lit GLBs and
    // the rest of the scene is unlit, so add a cool moon key + ambient that affect
    // only these trees.
    // De-blued ambient: 0x6a82a0@1.3 was the strongest blue contributor, washing the
    // foliage toward teal on every facet. A desaturated green-gray (R~G>B) at 1.0 keeps
    // the cold night feel without the blue dominance, so the green reads green.
    const ambientLight = new THREE.AmbientLight(0x6c8088, 1.3);
    scene.add(ambientLight);
    const treeMoonLight = new THREE.DirectionalLight(0xdce8ff, 1.7);
    treeMoonLight.position.copy(MOON_POS);
    scene.add(treeMoonLight);
    // FRONT fill (from the camera side) so the camera-facing foliage of the framing
    // trees reveals its green + snow instead of reading as a dark, moon-back-lit
    // silhouette. Near-neutral (faint green-white) so it doesn't blue-wash the green;
    // kept below the moon key so shaping is preserved.
    // COOL-neutral front fill (camera side) so the snow reads cool blue-white and the
    // green a cool spruce-green — matching the scene's cold palette (a warm fill made the
    // trees pop warm against the cold lake / mountains). Kept just below the moon key so
    // form still reads; the cool moon backlight rims the snow (classic snow-tree look).
    const treeFillLight = new THREE.DirectionalLight(0xf2eee6, 2.0);
    treeFillLight.position.set(200, 460, 1500);
    scene.add(treeFillLight);
    // One snow-laden summer-spruce GLB → the close-camera framing wings + the
    // mid-ground conifer belt behind the lake.
    const spruces = createFramingSpruces(scene, { feetY: FEET_Y });
    spruces.load().then(() => {
        spruces.placeTreeline(placements); // distant belt (instanced)
        spruces.placeFraming(FRAMING_SPRUCES); // close-camera left/right wings
    });

    // --- Arctic foxes trotting across the foreground snow (TRELLIS.2 low-poly,
    // rigged "Run" clip). Lit by the same ambient + moon key + warm fill as the
    // GLB trees; ground-follows the snow drifts via raycast, kept in front of the
    // frozen lake so the paws stay planted and the foxes read clearly. ---
    const arcticFox = createArcticFox(scene, {
        // Small foxes so the landscape reads vast/majestic; they ground-follow the
        // snow + ice and fade into the haze with distance (see arctic-fox.js).
        groundMeshes: [drifts.mesh, lake], fallbackY: FEET_Y, count: 3, scale: 80,
    });
    arcticFox.load();

    // --- Faceted snow-capped foreground rocks ---
    const rockMat = track(makeFacetedRockMaterial({ moonDir: MOON_POS.clone() }));
    // Per reference: one prominent dark rock in the lower-right foreground + a
    // smaller left one; kept clear of the lake so they read as shore boulders.
    [[-560, -252, 600, 105], [780, -246, 720, 165], [-150, -262, 840, 60]].forEach(([x, y, z, r]) => {
        const rk = buildFacetedRock(rockMat, r);
        rk.mesh.position.set(x, y, z);
        scene.add(rk.mesh);
        disposables.push(rk);
    });

    // --- Falling snow: AAA multi-tier, camera-relative GPU-compute system ---
    // (docs/WINTER_SNOW_MASTERPIECE_PLAN.md). Far→mid→near→bokeh tiers wrap around
    // the live camera. Graceful fallback to the legacy vertex-animated Points cloud
    // when WebGPU compute is unavailable.
    const uSnowCamPos = uniform(new THREE.Vector3(0, 78, 760));
    const uSnowAurora = uniform(0);
    const snowTiers = [];
    let snowFallback = null;
    let snowComputeErr = false;
    const snowComputeOk = renderer && typeof renderer.compute === 'function';
    if (snowComputeOk) {
        SNOW_TIERS.forEach((tier) => {
            const sim = new SnowSim({ ...tier.sim, camPosUniform: uSnowCamPos });
            sim.createComputeNode();
            const rend = createSnowRenderer(sim, { ...tier.render, auroraTintUniform: uSnowAurora });
            scene.add(rend.mesh);
            snowTiers.push({ sim, rend });
        });
    } else {
        snowFallback = buildSnow(4200, {
            w: 4600, h: 2800, d: 3800, cx: 0, cy: 560, cz: -1000,
        });
        scene.add(snowFallback.points);
        disposables.push(snowFallback);
    }

    // --- Drifting snow-mist banks (atmospheric depth / cold haze) ---
    const mist = buildSnowMist();
    scene.add(mist.group);

    return {
        cameraRadius: 0.001,
        camera(time, camera) {
            // Wide eye-level framing: big snow-pines frame both corners, the cracked
            // ice fills the lower third, treeline + peaks recede.
            if (camera.fov !== undefined && Math.abs(camera.fov - 55) > 0.01) {
                camera.fov = 55;
                camera.updateProjectionMatrix();
            }

            // Ease the raw pointer so the look-around glides (no per-frame jitter).
            const dt = Math.min(0.05, Math.max(0, time - prevCamTime));
            prevCamTime = time;
            smoothPointerX = THREE.MathUtils.lerp(smoothPointerX, pointerX, dt * 2.4);
            smoothPointerY = THREE.MathUtils.lerp(smoothPointerY, pointerY, dt * 2.4);
            // Softer parallax so moving the cursor never swings a framing tree into the
            // centre of the view (keeps the back clear at any pointer position).
            const parallaxX = smoothPointerX * 55.0;
            const parallaxY = -smoothPointerY * 28.0;

            // Idle breathing/sway — always present but subtle; mouse parallax rides on
            // top. When the pointer is still, only this gentle drift remains.
            const swayX = Math.sin(time * 0.15) * 9 + Math.sin(time * 0.33 + 1.1) * 4;
            const bobY = Math.sin(time * 0.40) * 4 + Math.cos(time * 0.26) * 2.5;
            const dollyZ = Math.sin(time * 0.12) * 12;

            camera.position.set(
                swayX + parallaxX,
                Math.max(46, 78 + bobY + parallaxY),
                760 + dollyZ,
            );
            // Look target wanders subtly + leans toward the cursor for a parallax feel.
            const lookX = Math.sin(time * 0.16 + 0.7) * 14 + parallaxX * 0.4;
            const lookY = 120 + Math.cos(time * 0.21) * 5 + parallaxY * 0.35;
            camera.lookAt(lookX, lookY, -1900);
        },
        update(time) {
            // Derive dt locally so the GLB wind-sway mixers work whether the host
            // calls update(time) (playground) or update(time, delta) (theme).
            const dt = Math.min(0.05, Math.max(0, time - prevTime));
            prevTime = time;
            aurora.uniforms.uTime.value = time;
            if (lakeU?.uTime) lakeU.uTime.value = time;
            if (haloU?.uTime) haloU.uTime.value = time;
            // Falling snow: dispatch each tier's GPU compute + advance render uniforms.
            if (camera) uSnowCamPos.value.copy(camera.position);
            uSnowAurora.value = aurora.uniforms.uIntensity.value;
            for (let s = 0; s < snowTiers.length; s += 1) {
                const { sim, rend } = snowTiers[s];
                sim.update(dt, time);
                try {
                    renderer.compute(sim.computeNode);
                } catch (e) {
                    // eslint-disable-next-line no-console
                    if (!snowComputeErr) { snowComputeErr = true; console.error('[winter snow] compute failed:', e); }
                }
                rend.update(time);
            }
            if (snowFallback) snowFallback.uTime.value = time;
            moonClouds.clouds.forEach((c) => {
                c.uniforms.uTime.value = time;
                c.mesh.position.x = c.baseX + Math.sin(time * c.driftSpeed + c.phase) * c.driftAmp;
            });
            mist.bands.forEach((b) => {
                b.uniforms.uTime.value = time;
                b.mesh.position.x = b.baseX + Math.sin(time * b.driftSpeed + b.phase) * b.driftAmp;
            });
            spruces.update(dt);
            arcticFox.update(dt);
        },
        dispose() {
            if (typeof window !== 'undefined') window.removeEventListener('pointermove', onPointerMove);
            scene.remove(aurora.mesh, moon, lake, moonClouds.group);
            scene.remove(drifts.mesh, ambientLight, treeMoonLight, treeFillLight, mist.group);
            snowTiers.forEach(({ sim, rend }) => { scene.remove(rend.mesh); rend.dispose(); sim.dispose(); });
            if (snowFallback) scene.remove(snowFallback.points);
            moonClouds.clouds.forEach((c) => { c.geo.dispose(); c.mesh.material.dispose(); });
            mist.bands.forEach((b) => { b.geo.dispose(); b.mesh.material.dispose(); });
            spruces.dispose?.();
            arcticFox.dispose?.();
            disposables.forEach((d) => { try { d.dispose?.(); } catch (e) { /* noop */ } });
        },
    };
}
