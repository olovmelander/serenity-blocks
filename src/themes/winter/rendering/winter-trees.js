import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { clone as cloneHierarchy } from 'three/addons/utils/SkeletonUtils.js';
import spruceUrl from '../assets/spruce.glb?url';
import pineUrl from '../assets/pine.glb?url';
import firUrl from '../assets/fir.glb?url';

// ─────────────────────────────────────────────────────────────────────────────
// WinterTrees — Firewatch-style snow trees with THREE.LOD.
//
// LOD levels:
//   0  –  80m : Full rigged skinned mesh (AnimationMixer wind sway)
//   80 – 250m : Procedural low-poly silhouette (cones + cylinder, instant)
//   250m+     : Black/dark silhouette (same procedural shape, dark material)
//
// The LOD geometry is built entirely in JS — no extra GLB files, no Blender
// decimation artefacts. This is the same technique Firewatch uses for trees.
// ─────────────────────────────────────────────────────────────────────────────

const VARIANTS = [
    {
        name: 'spruce',
        url: spruceUrl,
        heightRange: [55, 130],
        swayAmp: 0.018,
        swaySpeed: 0.55,
        // Procedural LOD parameters
        type: 'conifer',
        layers: 4, // stacked cone tiers
        layerColors: [0x1a3d22, 0x244f2e, 0x2d5c35, 0x366840], // dark→lighter green
        snowColor: 0xe8eef0,
        trunkColor: 0x3d2b1a,
        taper: 0.68, // how much narrower each tier is vs the last
        coneAspect: 0.82, // height / radius ratio per tier
    },
    {
        name: 'pine',
        url: pineUrl,
        heightRange: [45, 110],
        swayAmp: 0.022,
        swaySpeed: 0.48,
        type: 'conifer',
        layers: 3,
        layerColors: [0x1e3d1e, 0x2a5226, 0x325032],
        snowColor: 0xe4ecef,
        trunkColor: 0x4a3420,
        taper: 0.72,
        coneAspect: 0.72,
    },
    {
        name: 'fir',
        url: firUrl,
        heightRange: [50, 120],
        swayAmp: 0.015,
        swaySpeed: 0.62,
        type: 'conifer',
        layers: 5,
        layerColors: [0x152e1a, 0x1d3e23, 0x244b2c, 0x2d5835, 0x35633c],
        snowColor: 0xeaeef2,
        trunkColor: 0x3a2818,
        taper: 0.64,
        coneAspect: 0.90,
    },
];

// ── Shared silhouette material (cold near-black for winter) ──────────────────
const SILHOUETTE_MAT = new THREE.MeshBasicMaterial({
    color: 0x080c12,
    side: THREE.DoubleSide,
});

function makeDracoLoader() {
    const d = new DRACOLoader();
    d.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
    return d;
}

// ─────────────────────────────────────────────────────────────────────────────
// Build a procedural Firewatch-style conifer LOD mesh.
// Returns a THREE.Group, height-normalised to ~1 unit (Three.js scales up).
// ─────────────────────────────────────────────────────────────────────────────
function buildConiferLod(v, silhouette = false) {
    const root = new THREE.Group();
    const n = v.layers;

    // Total height = 1.0 unit (Three.js scales). Trunk takes bottom 12%.
    const trunkH = 0.12;
    const canopyH = 1.0 - trunkH;

    // Each tier overlaps 20% of the previous.
    const tierH = (canopyH / n) * 1.22;
    const topR = 0.06;
    const baseR = topR / Math.pow(v.taper, n - 1);

    // Trunk
    const trunkMat = silhouette ? SILHOUETTE_MAT : new THREE.MeshBasicMaterial({
        color: v.trunkColor, flatShading: true,
    });
    const trunkGeo = new THREE.CylinderGeometry(trunkH * 0.28, trunkH * 0.38, trunkH, 5, 1);
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.y = trunkH / 2;
    root.add(trunk);

    // Cone tiers — bottom to top
    for (let i = 0; i < n; i++) {
        const t = i / (n - 1); // 0 = bottom tier, 1 = top
        const r = baseR * Math.pow(v.taper, i);
        const h = r / v.coneAspect;
        const yBase = trunkH + (canopyH / n) * i * 0.88;

        // Pick color per layer — bottom is darker, tip is lighter
        const col = v.layerColors[Math.min(i, v.layerColors.length - 1)];
        const coneGeo = new THREE.ConeGeometry(r, h, Math.max(5, 8 - i), 1);
        const coneMat = silhouette ? SILHOUETTE_MAT : new THREE.MeshBasicMaterial({
            color: col, flatShading: true,
        });
        const cone = new THREE.Mesh(coneGeo, coneMat);
        cone.position.y = yBase + h / 2;
        root.add(cone);

        // Light snow cap on top half of each cone
        if (!silhouette && i >= n / 2) {
            const snowR = r * 0.7;
            const snowH = h * 0.25;
            const snowGeo = new THREE.ConeGeometry(snowR, snowH, Math.max(5, 8 - i), 1);
            const snowMat = new THREE.MeshBasicMaterial({ color: v.snowColor, flatShading: true });
            const snow = new THREE.Mesh(snowGeo, snowMat);
            snow.position.y = yBase + h * 0.65;
            root.add(snow);
        }
    }

    return root;
}

// ─────────────────────────────────────────────────────────────────────────────
// Build procedural LOD for a given variant
// ─────────────────────────────────────────────────────────────────────────────
function buildLodGroup(v, silhouette = false) {
    return buildConiferLod(v, silhouette);
}

export function createWinterTrees(scene) {
    const group = new THREE.Group();
    group.name = 'winter-trees-glb';
    scene.add(group);

    const loader = new GLTFLoader();
    loader.setDRACOLoader(makeDracoLoader());

    /** @type {Array<{scene:THREE.Group, clip:THREE.AnimationClip|null, variant:object}>} */
    const loaded = [];

    /** @type {Array<{lod:THREE.LOD, mixer:THREE.AnimationMixer|null, phase:number, swayAmp:number, swaySpeed:number}>} */
    const instances = [];

    // ── Load full GLBs (main only — LOD is procedural) ────────────────────
    async function load() {
        const results = await Promise.allSettled(
            VARIANTS.map((v) => loader.loadAsync(v.url).then((gltf) => {
                gltf.scene.traverse((o) => {
                    if (!o.isMesh) return;
                    o.material.flatShading = true;
                    o.material.vertexColors = true;
                    o.material.side = THREE.DoubleSide;
                    o.material.needsUpdate = true;
                    o.frustumCulled = false;
                });
                loaded.push({ scene: gltf.scene, clip: gltf.animations?.[0] ?? null, variant: v });
                console.log(`[WinterTrees] Loaded ${v.name}`);
            }).catch((e) => console.warn(`[WinterTrees] Failed ${v.name}:`, e))),
        );
        console.log(`[WinterTrees] ${results.filter((r) => r.status === 'fulfilled').length}/${VARIANTS.length} loaded.`);
    }

    // ── Spawn one LOD tree ─────────────────────────────────────────────────
    function spawnTree({
        x, z, groundY = -298, heightScale = 1.0, variantIndex = null, rotY = null,
    }) {
        if (loaded.length === 0) return;

        const idx = variantIndex !== null
            ? Math.min(variantIndex, loaded.length - 1)
            : Math.floor(Math.random() * loaded.length);
        const src = loaded[idx];
        const { variant } = src;

        const h = (variant.heightRange[0] + Math.random() * (variant.heightRange[1] - variant.heightRange[0])) * heightScale;

        const lod = new THREE.LOD();
        lod.position.set(x, groundY, z);
        lod.rotation.y = rotY ?? (Math.random() * Math.PI * 2);

        // ── Level 0: full skinned mesh ────────────────────────────────────
        let mixer = null;
        const main = cloneHierarchy(src.scene);
        main.scale.setScalar(h);
        main.frustumCulled = false;
        if (src.clip) {
            mixer = new THREE.AnimationMixer(main);
            mixer.clipAction(src.clip).play();
        }
        lod.addLevel(main, 0);

        // ── Level 1: procedural Firewatch-style cone tree ─────────────────
        const lodMesh = buildLodGroup(variant, false);
        lodMesh.scale.setScalar(h);
        lod.addLevel(lodMesh, 80);

        // ── Level 2: dark silhouette (same shape, dark material) ──────────
        const silMesh = buildLodGroup(variant, true);
        silMesh.scale.setScalar(h);
        lod.addLevel(silMesh, 250);

        group.add(lod);
        instances.push({
            lod,
            mixer,
            phase: Math.random() * Math.PI * 2,
            swayAmp: variant.swayAmp * (0.8 + Math.random() * 0.4),
            swaySpeed: variant.swaySpeed * (0.85 + Math.random() * 0.3),
        });
    }

    // ── Place the full forest ─────────────────────────────────────────────
    function placeForest() {
        if (loaded.length === 0) {
            console.warn('[WinterTrees] placeForest() called before load()');
            return;
        }

        function groundY(tx, tz) {
            const dx = Math.max(0, Math.abs(tx) - 1200);
            const dz = Math.max(0, Math.abs(tz - (-700)) - 400);
            const dist = Math.sqrt(dx * dx + dz * dz);
            let y = -280 - 18;
            if (dist > 0) y += Math.min(220, dist * 0.16);
            return y;
        }

        // Foreground hero trees
        [
            {
                x: -1380, z: -90, h: 1.15, vi: 0,
            },
            {
                x: -1080, z: -300, h: 0.90, vi: 2,
            },
            {
                x: -1560, z: -380, h: 1.05, vi: 0,
            },
            {
                x: -840, z: -520, h: 0.65, vi: 1,
            },
            {
                x: -1240, z: -560, h: 0.72, vi: 2,
            },
            {
                x: 1360, z: -110, h: 1.10, vi: 1,
            },
            {
                x: 1090, z: -320, h: 0.87, vi: 0,
            },
            {
                x: 1540, z: -400, h: 1.02, vi: 2,
            },
            {
                x: 860, z: -540, h: 0.62, vi: 1,
            },
            {
                x: 1260, z: -580, h: 0.70, vi: 0,
            },
        ].forEach((t) => spawnTree({
            x: t.x, z: t.z, groundY: groundY(t.x, t.z), heightScale: t.h, variantIndex: t.vi,
        }));

        // Mid-ground
        spawnTree({
            x: -620, z: -780, groundY: groundY(-620, -780), heightScale: 0.50, variantIndex: 0,
        });
        spawnTree({
            x: 660, z: -800, groundY: groundY(660, -800), heightScale: 0.48, variantIndex: 2,
        });

        // Far treeline — all at silhouette distance, drawn as procedural cone shapes
        const farLine = [
            [-2000, -600], [-1700, -700], [-1400, -750], [-1100, -800], [-800, -820], [-500, -830],
            [-200, -835], [100, -830], [400, -820], [700, -810], [1000, -790], [1300, -760], [1600, -700], [1900, -620],
        ];
        farLine.forEach(([x, z], i) => spawnTree({
            x,
            z,
            groundY: groundY(x, z),
            heightScale: 0.55 + Math.random() * 0.3,
            variantIndex: i % 3,
        }));

        console.log(`[WinterTrees] Placed ${instances.length} trees.`);
    }

    // ── Per-frame update ──────────────────────────────────────────────────
    let elapsed = 0;
    function update(dt, camera) {
        elapsed += dt;
        if (camera) {
            for (const inst of instances) inst.lod.update(camera);
        }
        for (const inst of instances) {
            if (inst.mixer) {
                inst.mixer.update(dt);
            } else {
                // Fallback sway on LOD/silhouette levels
                inst.lod.rotation.z = Math.sin(elapsed * inst.swaySpeed + inst.phase) * inst.swayAmp * 0.5;
            }
        }
    }

    // ── Dispose ───────────────────────────────────────────────────────────
    function dispose() {
        for (const inst of instances) {
            if (inst.mixer) inst.mixer.stopAllAction();
            group.remove(inst.lod);
        }
        instances.length = 0;
        loaded.length = 0;
        scene.remove(group);
    }

    return {
        group, load, placeForest, update, dispose,
    };
}
