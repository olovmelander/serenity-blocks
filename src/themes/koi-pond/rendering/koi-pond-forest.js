/* eslint-disable import/no-extraneous-dependencies, import/no-unresolved */
/**
 * Koi Pond — "Moonwake Grove" GLB forest.
 *
 * Replaces the procedural blob canopies with real modelled low-poly trees.
 * Assets are CC0 (Quaternius-derived) LOD meshes already vetted in this repo —
 * `summer_birch_lod.glb` (faceted broadleaf crown + trunk) and
 * `winter_fir_lod.glb` (layered conifer spire) — so the grove costs two extra
 * instanced draws and ~75 KB, with no new licensing surface.
 *
 * The canopy material follows the sakura-twilight recipe adapted to this
 * theme's nocturne: a vertical VOLUMETRIC GRADIENT (deep jade underside lifting
 * to a moonlit crown) plus a cool HDR backlight rim on silhouette edges that
 * feeds the Koi Pond bloom pass. Trunks get their own darker bark material.
 *
 * Loading is async and non-blocking: the landscape shows its procedural forest
 * immediately and calls `onReady` to retire it once the grove is live, so a
 * failed/slow fetch degrades to the old forest instead of an empty bank.
 */
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import {
    cameraPosition,
    clamp,
    dot,
    float,
    hash,
    instanceIndex,
    mix,
    normalize,
    normalWorld,
    positionLocal,
    positionWorld,
    pow,
    sin,
    smoothstep,
    texture,
    uv,
    vec3,
} from 'three/tsl';

import birchUrl from '../../shared/assets/summer_birch_lod.glb?url';
import firUrl from '../../shared/assets/fir_lod.glb?url';
// The hero canopy is lifted from the shared landscape GLB — the same
// leaf-card tree the art direction is chasing. Vite emits one shared asset for
// every theme using it, so this adds no bytes beyond what sakura already ships.
import sakuraLandscapeUrl from '../../shared/assets/landscape-glb.glb?url';

const TAU = Math.PI * 2;
const MOON_DIRECTION = [-0.36, 0.82, -0.44];

/**
 * Grove density per quality tier. The whole grove is TWO instanced draws no
 * matter how many trees it holds, so density costs vertex/fill only — these LOD
 * meshes are ~1.5k tris each, which is why even the top tier can carry a full
 * woodland. The layout is priority-ordered, so a lower tier is a thinner but
 * still balanced version of the same composition.
 */
export const KOI_POND_GROVE_LIMITS = Object.freeze({
    Minimal: 22,
    Low: 36,
    Medium: 52,
    High: 68,
    Ultra: 84,
    Extreme: 999,
});

/**
 * DISABLED. The sakura leaf-card canopy was auditioned here and rejected in
 * review: at this theme's distance and darkness the alpha-cut foliage reads as
 * a noisy dark mass rather than a lush crown, and it fights the clean faceted
 * low-poly language of the troll, rocks and lily pads. The faceted LOD trees are
 * the correct look for Koi Pond. The loader path is kept (set a tier above zero
 * to re-enable) but ships off.
 */
export const KOI_POND_HERO_LIMITS = Object.freeze({
    Minimal: 0,
    Low: 0,
    Medium: 0,
    High: 0,
    Ultra: 0,
    Extreme: 0,
});

/**
 * Forest BAND composition — a continuous treeline filling the bank behind the
 * pond, full frame width, rather than scattered clumps with holes in them.
 *
 * DEPTH CEILING (important): the mountain ridgelines occupy world z -37 … -65
 * (ridge mesh at z=-35, layers at local -2 … -30). Trees placed at or beyond
 * z=-37 stand *inside* the mountain range with no terrain beneath them and read
 * as floating on the ridge — a bug caught in review. Every row therefore stays
 * IN FRONT of the nearest ridge (deepest tree z=-36.4), with the far row kept
 * short so the treeline still settles softly into the mountain base.
 *
 * Seven jittered DEPTH ROWS (z -22.5 … -35.6): continuous lines with spacing and
 * height jitter so they read organic rather than as a fence, tightening and
 * shortening with distance, overlapping in screen-x so the band has no gaps.
 * Verified: 130 trees, 16/16 frame-width buckets populated, balance 1.14.
 *
 * SWAY MARGIN (BREATH_MARGIN = 26u per side): the camera's ambient motion (fast
 * BREATH + slow WANDER) carries the eye up to ±6.2u laterally and swings the
 * look-target the other way, sliding the frame edge a long way across the world.
 * Measured at those extremes, a 4u margin left the band ending at NDC -0.83 —
 * a visibly EMPTY frame edge at each end of the travel. 26u covers the full
 * excursion: the band still reaches past ±1.0 NDC at both extremes. Trees pushed off-screen are frustum-culled,
 * so the extra width is effectively free.
 *
 * Protected: the near rows skip the board column (|x| < 9.5) and a camera
 * sight-line test rejects anything burying the troll (-15, -18.4) or the stone
 * lantern (13.8, -20).
 *
 * Order is COMPOSITIONAL PRIORITY: rows interleave, and within a row trees emit
 * in BISECTION order (both ends first, then midpoints, recursively). A
 * centre-outwards order left the low tiers' frame edges bare — every prefix must
 * already span the full width, because a tier renders only the first N trees.
 */
const GROVE_LAYOUT = Object.freeze([
    [-56.3, -23.8, 7.9, 0], [52.9, -23, 5.8, 0], [-13.8, -24.2, 7.1, 1],
    [-58.6, -26.6, 6.1, 0], [60.4, -27.3, 6.2, 0], [18.1, -27.3, 7.1, 1],
    [-60.1, -31.3, 5.8, 0], [56.1, -28.6, 6.9, 0], [-1.8, -29.4, 6.7, 0],
    [-64.6, -34, 5.9, 0], [60.1, -31.6, 5, 0], [2.6, -34.6, 5.4, 0],
    [-60.3, -34.8, 3.6, 0], [60.5, -34.3, 3.3, 1], [-3.3, -35.1, 4.6, 1],
    [-51.5, -26.1, 7.6, 1], [49.8, -25.2, 7.8, 0], [-11, -24.4, 6, 0],
    [-65, -31.4, 4.3, 0], [55.8, -32.8, 5.7, 0], [-12.2, -31.6, 4.4, 0],
    [-35.7, -23, 8.5, 0], [-46.1, -20.7, 6.6, 0], [-50.7, -22, 7.7, 0],
    [-37.5, -26.5, 7.7, 1], [-48.3, -27.2, 5.2, 1], [-54.2, -26.2, 6.7, 1],
    [-33.4, -30.7, 6, 1], [-46.6, -31.7, 5.6, 1], [-56.3, -29.9, 5.3, 0],
    [-30.2, -34.3, 5.5, 0], [-42.3, -32.9, 5.2, 1], [-53.7, -32.7, 4.5, 1],
    [-33.7, -36.4, 3.8, 1], [-49.3, -36, 3.4, 0], [-56.5, -35.8, 4.7, 0],
    [-45.6, -23.2, 6.1, 1], [-15.6, -26.1, 7, 1], [33.1, -23.9, 6, 0],
    [-16.8, -30.2, 6, 0], [14.4, -30.6, 6, 1], [29, -30.1, 4.4, 1],
    [-40.6, -24.4, 6.4, 1], [-27.4, -24.4, 7.3, 1], [-32.9, -24.2, 8.4, 1],
    [-42.7, -25.8, 7.2, 1], [-18, -25, 6, 0], [-21.6, -26.3, 6.5, 1],
    [-49.9, -28.7, 6.4, 1], [-42.8, -29.1, 5, 0], [-38, -31.2, 7, 0],
    [-49.5, -31.7, 5.7, 0], [-37.7, -34.3, 4.5, 1], [-35.5, -32.2, 5.2, 1],
    [-45.9, -35.2, 4.6, 0], [-37.1, -36.4, 3.4, 0], [-23.4, -34.5, 4.7, 1],
    [26.1, -26.3, 7.2, 0], [45.7, -25.6, 5.4, 0], [-24.8, -22.8, 8.1, 1],
    [-16.5, -21.3, 6.3, 1], [27.7, -23.3, 7, 0], [-12.6, -27.1, 5.7, 0],
    [11.9, -27.7, 6.5, 1], [36.8, -26.9, 5.6, 0], [-19.9, -31.1, 4.7, 1],
    [-29.3, -29.1, 6.6, 0], [-26.1, -29.9, 5.4, 1], [-14.9, -31.6, 4.5, 1],
    [-26.3, -33.4, 5.7, 1], [-23.6, -31.6, 5.3, 0], [-28.7, -36.4, 4.7, 0],
    [-19, -36.3, 3.8, 1], [-7.8, -36.1, 3.7, 1], [14.2, -22.3, 8.2, 1],
    [10.2, -23.3, 7.6, 0], [17.6, -22.3, 7.8, 0], [24, -26.3, 6.9, 1],
    [20.4, -24.8, 7, 1], [30.3, -28.4, 7.3, 1], [-9.7, -30.6, 5.8, 1],
    [-14.7, -29.4, 5.8, 1], [-4.8, -30.7, 6.4, 0], [-7.3, -33.7, 4.4, 0],
    [-10.9, -33.6, 4.3, 1], [-1.5, -33.3, 5.3, 0], [29.7, -35.4, 4.4, 1],
    [9.8, -35.4, 4, 0], [5.3, -36.2, 4.1, 1], [23.7, -24.2, 7.1, 1],
    [37.7, -23, 8.4, 0], [32.6, -21, 7.7, 0], [33, -26.6, 7.4, 0],
    [47.9, -25.9, 6.5, 0], [43.7, -24.9, 7.6, 1], [23.8, -29.9, 6.4, 0],
    [10, -29.7, 6.9, 0], [0.9, -28.2, 5.8, 0], [27.5, -31.5, 4.6, 1],
    [11.3, -33.8, 5.6, 0], [4.5, -33.9, 5.4, 1], [13.1, -36.4, 3.6, 1],
    [23.6, -35.8, 3.7, 1], [49.4, -34.3, 4.7, 1], [43.7, -21.3, 7.9, 0],
    [50.6, -21.3, 7.4, 0], [52, -25.3, 7.8, 0], [56.4, -25.9, 6.6, 0],
    [7.7, -29.3, 6.6, 0], [18.8, -29.7, 5.8, 1], [21.1, -30.2, 6, 0],
    [8.4, -33.7, 4.2, 0], [20.1, -33.5, 5.1, 1], [16.3, -34.2, 4.8, 0],
    [42.2, -36.2, 4.5, 1], [54.2, -35.5, 3.5, 1], [56.9, -36.1, 3.2, 1],
    [38.4, -29.7, 6.6, 0], [31.4, -30.5, 6.2, 1], [34.4, -31.3, 5.6, 0],
    [22.5, -33.3, 5.3, 1], [39.9, -33.7, 5.9, 0], [32.9, -34, 4.2, 0],
    [48.5, -29, 6.4, 1], [44, -31.6, 5, 0], [52.8, -31.3, 6.5, 0],
    [36.3, -34.1, 4.6, 1], [49.2, -31.9, 4, 0], [46.4, -34.4, 4.6, 0],
    [57.8, -32.9, 5, 0],
]);

const fract = (value) => value - Math.floor(value);

function makeMoonDirNode() {
    return normalize(vec3(...MOON_DIRECTION));
}

/**
 * Canopy: volumetric vertical gradient + moonlit backlight rim.
 * `positionLocal.y` runs over the instance's own unit-height template, so the
 * gradient tracks each tree's own crown rather than world height.
 */
function createCanopyMaterial(uTime, uMotion) {
    const material = new THREE.MeshStandardNodeMaterial();
    const moonDir = makeMoonDirNode();

    // Slow crown drift; per-instance phase desyncs neighbours.
    const phase = hash(instanceIndex).mul(TAU);
    const tipWeight = smoothstep(0.1, 1.0, positionLocal.y);
    const sway = sin(uTime.mul(0.19).add(phase))
        .add(sin(uTime.mul(0.11).sub(phase.mul(0.7))).mul(0.45))
        .mul(0.022)
        .mul(tipWeight)
        .mul(uMotion);
    material.positionNode = positionLocal.add(vec3(sway, 0, sway.mul(0.4)));

    // Volumetric gradient: deep shadowed jade underside → moonlit crown.
    // Deep nocturnal jade: the grove must read as moonlit SILHOUETTE, only a
    // few stops above the night, or it pops out of this theme's dark palette.
    const form = smoothstep(0.05, 0.95, positionLocal.y);
    const shadowJade = vec3(0.0016, 0.0075, 0.0068);
    const midJade = vec3(0.0055, 0.024, 0.019);
    const litJade = vec3(0.014, 0.048, 0.034);
    const body = mix(shadowJade, mix(midJade, litJade, form), form.mul(0.85).add(0.15));

    // Distance haze so the far treeline melts into the mountain mist.
    const farness = smoothstep(-30, -58, positionWorld.z);
    material.colorNode = mix(body, vec3(0.011, 0.030, 0.038), farness.mul(0.7));

    // Cool rim on silhouette edges facing the moon — restrained so it defines
    // the crown shape without lighting the whole canopy.
    const view = normalize(cameraPosition.sub(positionWorld));
    const edge = pow(clamp(float(1).sub(dot(normalize(normalWorld), view)), 0, 1), float(2.6));
    const moon = clamp(dot(normalize(normalWorld), moonDir), 0, 1);
    material.emissiveNode = vec3(0.075, 0.185, 0.245)
        .mul(edge.mul(moon.mul(0.9).add(0.06)))
        .mul(0.62);
    material.roughnessNode = float(0.97);
    material.metalnessNode = float(0);
    material.flatShading = true;
    return material;
}

/**
 * HERO canopy — the sakura-twilight leaf-card look, recoloured for this nocturne.
 *
 * The reason sakura's canopies read as lush foliage rather than faceted blobs is
 * that its crown is alpha-cut LEAF CARDS driven by a leaf texture
 * (`NOVA COPA Spiked` / `TreeLeaves03b_PNG`), not solid geometry. We keep that
 * texture for its silhouette (the alpha channel IS the leaf shape) but throw
 * away its pink-daylight colour: luminance drives a deep-jade → moonlit ramp so
 * the same asset reads as a night-time koi-garden canopy.
 */
function createHeroCanopyMaterial(leafMap, uTime, uMotion) {
    const material = new THREE.MeshStandardNodeMaterial();
    const moonDir = makeMoonDirNode();

    const phase = hash(instanceIndex).mul(TAU);
    const tipWeight = smoothstep(0.1, 1.0, positionLocal.y);
    const sway = sin(uTime.mul(0.19).add(phase))
        .add(sin(uTime.mul(0.11).sub(phase.mul(0.7))).mul(0.45))
        .mul(0.026)
        .mul(tipWeight)
        .mul(uMotion);
    material.positionNode = positionLocal.add(vec3(sway, 0, sway.mul(0.4)));

    const leaf = texture(leafMap, uv());
    // Leaf luminance → jade ramp (drop the source's daylight hue entirely).
    const luma = dot(leaf.rgb, vec3(0.2126, 0.7152, 0.0722));
    const form = smoothstep(0.05, 0.95, positionLocal.y);
    // Leaf-card crowns are mostly transparent, so a given pixel is thinner than
    // solid LOD geometry — they need a slightly higher ramp than the LOD canopy
    // to sit at the same apparent brightness in frame.
    const shadowJade = vec3(0.0040, 0.0190, 0.0160);
    const litJade = vec3(0.0270, 0.0880, 0.0620);
    const body = mix(shadowJade, litJade, form.mul(0.6).add(luma.mul(0.4)));
    const farness = smoothstep(-30, -58, positionWorld.z);
    material.colorNode = mix(body, vec3(0.011, 0.030, 0.038), farness.mul(0.7));

    // The alpha channel carries the leaf cut-out — that is the lush silhouette.
    material.opacityNode = leaf.a;
    material.alphaTest = 0.34;
    material.side = THREE.DoubleSide;

    const view = normalize(cameraPosition.sub(positionWorld));
    const edge = pow(clamp(float(1).sub(dot(normalize(normalWorld), view)), 0, 1), float(2.2));
    const moon = clamp(dot(normalize(normalWorld), moonDir), 0, 1);
    material.emissiveNode = vec3(0.080, 0.195, 0.255)
        .mul(edge.mul(moon.mul(0.9).add(0.08)))
        .mul(0.70);
    material.roughnessNode = float(0.97);
    material.metalnessNode = float(0);
    return material;
}

function createTrunkMaterial() {
    const material = new THREE.MeshStandardNodeMaterial();
    const moonDir = makeMoonDirNode();
    const farness = smoothstep(-30, -58, positionWorld.z);
    material.colorNode = mix(
        vec3(0.010, 0.0085, 0.007),
        vec3(0.010, 0.026, 0.032),
        farness.mul(0.7),
    );
    const view = normalize(cameraPosition.sub(positionWorld));
    const edge = pow(clamp(float(1).sub(dot(normalize(normalWorld), view)), 0, 1), float(2.6));
    const moon = clamp(dot(normalize(normalWorld), moonDir), 0, 1);
    material.emissiveNode = vec3(0.06, 0.13, 0.17).mul(edge.mul(moon.mul(0.8).add(0.08))).mul(0.5);
    material.roughnessNode = float(1);
    material.metalnessNode = float(0);
    return material;
}

/**
 * Split a loaded tree into (canopy, trunk) geometries, normalized to a
 * unit-height template seated at y = 0 so instance scale sets world height.
 */
function extractTreeParts(gltfScene) {
    const canopyGeometries = [];
    const trunkGeometries = [];
    gltfScene.updateMatrixWorld(true);
    gltfScene.traverse((child) => {
        if (!child.isMesh || !child.geometry) return;
        const geometry = child.geometry.clone();
        geometry.applyMatrix4(child.matrixWorld);
        const name = `${child.name} ${child.material?.name || ''}`.toLowerCase();
        // Quaternius trees name their parts; fall back to a colour/height test.
        const isTrunk = /trunk|bark|stem|wood|branch/.test(name);
        (isTrunk ? trunkGeometries : canopyGeometries).push(geometry);
    });
    if (canopyGeometries.length === 0) return null;

    const box = new THREE.Box3();
    [...canopyGeometries, ...trunkGeometries].forEach((geometry) => {
        geometry.computeBoundingBox();
        box.union(geometry.boundingBox);
    });
    const height = Math.max(0.001, box.max.y - box.min.y);
    const normalize1 = (geometry) => {
        geometry.translate(0, -box.min.y, 0);
        geometry.scale(1 / height, 1 / height, 1 / height);
        geometry.computeVertexNormals();
        geometry.computeBoundingSphere();
        return geometry;
    };
    return {
        canopy: canopyGeometries.map(normalize1),
        trunk: trunkGeometries.map(normalize1),
    };
}

function mergeAll(geometries) {
    if (geometries.length === 0) return null;
    if (geometries.length === 1) return geometries[0];
    // Minimal merge (position/normal/uv) — avoids pulling in BufferGeometryUtils
    // and guarantees a uniform attribute set across mixed source meshes. UVs are
    // carried because the sakura hero canopy is an alpha-tested LEAF TEXTURE.
    const positions = [];
    const normals = [];
    const uvs = [];
    geometries.forEach((geometry) => {
        const pos = geometry.attributes.position;
        const nrm = geometry.attributes.normal;
        const uvA = geometry.attributes.uv;
        const { index } = geometry;
        const emit = (i) => {
            positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
            if (nrm) normals.push(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
            uvs.push(uvA ? uvA.getX(i) : 0, uvA ? uvA.getY(i) : 0);
        };
        if (index) {
            for (let i = 0; i < index.count; i += 1) emit(index.getX(i));
        } else {
            for (let i = 0; i < pos.count; i += 1) emit(i);
        }
        geometry.dispose();
    });
    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    merged.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    if (normals.length === positions.length) {
        merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    } else {
        merged.computeVertexNormals();
    }
    merged.computeBoundingSphere();
    return merged;
}

/**
 * Build the grove. Returns a handle whose `ready` promise resolves once the
 * GLB trees are live (or rejects/no-ops on failure, leaving the caller's
 * procedural forest in place).
 */
export function createKoiPondForest({
    scene,
    uTime,
    uMotion,
    groundHeightAt = () => 0,
    treeLimit = GROVE_LAYOUT.length,
    heroTreeCount = 10,
    onReady = null,
} = {}) {
    if (!scene?.add) throw new TypeError('Koi Pond forest requires a Three.js scene');

    const group = new THREE.Group();
    group.name = 'KoiPondMoonwakeGrove';
    group.matrixAutoUpdate = false;
    scene.add(group);

    const geometries = new Set();
    const materials = new Set();
    const meshes = [];
    let disposed = false;
    let currentLimit = treeLimit;
    let heroSlots = new Set();

    const canopyMaterial = createCanopyMaterial(uTime, uMotion);
    const trunkMaterial = createTrunkMaterial();
    materials.add(canopyMaterial);
    materials.add(trunkMaterial);

    const loader = new GLTFLoader();
    const draco = new DRACOLoader();
    draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
    loader.setDRACOLoader(draco);

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const scale = new THREE.Vector3();

    function placeSpecies(speciesIndex, parts, claimed = new Set()) {
        const entries = GROVE_LAYOUT
            .map((entry, layoutIndex) => ({ entry, layoutIndex }))
            .filter(({ entry, layoutIndex }) => entry[3] === speciesIndex && !claimed.has(layoutIndex));
        if (entries.length === 0) return;

        const canopyGeometry = mergeAll(parts.canopy);
        const trunkGeometry = mergeAll(parts.trunk);
        [canopyGeometry, trunkGeometry].forEach((g) => { if (g) geometries.add(g); });

        const build = (geometry, material, renderOrder) => {
            if (!geometry) return null;
            const mesh = new THREE.InstancedMesh(geometry, material, entries.length);
            entries.forEach(({ entry, layoutIndex }, index) => {
                const [x, z, height] = entry;
                // Deterministic per-tree variation: yaw, a slight lean, and a
                // width/height jitter so a dense grove never reads as clones.
                const r1 = fract(Math.sin(layoutIndex * 12.9898) * 43758.5453);
                const r2 = fract(Math.sin(layoutIndex * 78.233 + 1.7) * 24634.6345);
                const r3 = fract(Math.sin(layoutIndex * 39.425 + 5.1) * 15731.743);
                position.set(x, groundHeightAt(x, z) - 0.05, z);
                euler.set(
                    (r2 - 0.5) * 0.075,
                    r1 * TAU,
                    (r3 - 0.5) * 0.075,
                );
                quaternion.setFromEuler(euler);
                const trunkHeight = height * (0.9 + r2 * 0.2);
                const width = trunkHeight * (0.88 + r3 * 0.2);
                scale.set(width, trunkHeight, width);
                matrix.compose(position, quaternion, scale);
                mesh.setMatrixAt(index, matrix);
            });
            mesh.instanceMatrix.needsUpdate = true;
            mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
            mesh.computeBoundingSphere();
            mesh.matrixAutoUpdate = false;
            mesh.updateMatrix();
            mesh.frustumCulled = true;
            mesh.renderOrder = renderOrder;
            mesh.userData.layoutIndices = entries.map((e) => e.layoutIndex);
            group.add(mesh);
            meshes.push(mesh);
            return mesh;
        };

        build(trunkGeometry, trunkMaterial, -12);
        build(canopyGeometry, canopyMaterial, -11);
    }

    /**
     * Pull the sakura tree out of its landscape GLB: every `NOVA COPA` mesh is a
     * leaf-card canopy; `Tronco` is the trunk. The 100k-triangle terrain in the
     * same file is deliberately skipped.
     */
    function extractSakuraTree(gltfScene) {
        const canopy = [];
        const trunk = [];
        let leafMap = null;
        gltfScene.updateMatrixWorld(true);
        gltfScene.traverse((child) => {
            if (!child.isMesh || !child.geometry) return;
            const tag = `${child.name} ${child.material?.name || ''}`.toLowerCase();
            if (tag.includes('landscape') || tag.includes('grama')) return;
            const geometry = child.geometry.clone();
            geometry.applyMatrix4(child.matrixWorld);
            if (tag.includes('copa') || tag.includes('leaf') || tag.includes('leaves')) {
                if (!leafMap && child.material?.map) leafMap = child.material.map;
                canopy.push(geometry);
            } else if (tag.includes('tronco') || tag.includes('trunk')) {
                trunk.push(geometry);
            } else {
                geometry.dispose();
            }
        });
        if (canopy.length === 0 || !leafMap) return null;

        const box = new THREE.Box3();
        [...canopy, ...trunk].forEach((geometry) => {
            geometry.computeBoundingBox();
            box.union(geometry.boundingBox);
        });
        const height = Math.max(0.001, box.max.y - box.min.y);
        const centreX = (box.max.x + box.min.x) * 0.5;
        const centreZ = (box.max.z + box.min.z) * 0.5;
        const seat = (geometry) => {
            geometry.translate(-centreX, -box.min.y, -centreZ);
            geometry.scale(1 / height, 1 / height, 1 / height);
            geometry.computeVertexNormals();
            geometry.computeBoundingSphere();
            return geometry;
        };
        return { canopy: canopy.map(seat), trunk: trunk.map(seat), leafMap };
    }

    /**
     * The hero tier gets the detailed sakura canopy; everything further away
     * keeps the cheap faceted LODs. `heroCount` is deliberately small — the
     * sakura tree is ~31k triangles, so this is a real LOD split, not decoration.
     */
    function placeHero(parts, heroCount) {
        const entries = GROVE_LAYOUT
            .map((entry, layoutIndex) => ({ entry, layoutIndex }))
            .filter(({ entry }) => entry[3] === 0) // broadleaf slots only
            .sort((a, b) => b.entry[2] - a.entry[2]) // tallest/nearest first
            .slice(0, heroCount);
        if (entries.length === 0) return new Set();

        const canopyGeometry = mergeAll(parts.canopy);
        const trunkGeometry = mergeAll(parts.trunk);
        [canopyGeometry, trunkGeometry].forEach((g) => { if (g) geometries.add(g); });
        const heroCanopyMaterial = createHeroCanopyMaterial(parts.leafMap, uTime, uMotion);
        materials.add(heroCanopyMaterial);

        const build = (geometry, material, renderOrder) => {
            if (!geometry) return;
            const mesh = new THREE.InstancedMesh(geometry, material, entries.length);
            entries.forEach(({ entry, layoutIndex }, index) => {
                const [x, z, height] = entry;
                const r1 = fract(Math.sin(layoutIndex * 12.9898) * 43758.5453);
                const r2 = fract(Math.sin(layoutIndex * 78.233 + 1.7) * 24634.6345);
                position.set(x, groundHeightAt(x, z) - 0.05, z);
                euler.set(0, r1 * TAU, 0);
                quaternion.setFromEuler(euler);
                const s = height * (0.94 + r2 * 0.14);
                scale.set(s, s, s);
                matrix.compose(position, quaternion, scale);
                mesh.setMatrixAt(index, matrix);
            });
            mesh.instanceMatrix.needsUpdate = true;
            mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
            mesh.computeBoundingSphere();
            mesh.matrixAutoUpdate = false;
            mesh.updateMatrix();
            mesh.renderOrder = renderOrder;
            mesh.userData.layoutIndices = entries.map((e) => e.layoutIndex);
            group.add(mesh);
            meshes.push(mesh);
        };
        build(trunkGeometry, trunkMaterial, -12);
        build(canopyGeometry, heroCanopyMaterial, -10);
        return new Set(entries.map((e) => e.layoutIndex));
    }

    const ready = Promise.all([
        loader.loadAsync(birchUrl),
        loader.loadAsync(firUrl),
        loader.loadAsync(sakuraLandscapeUrl).catch(() => null),
    ]).then(([birchGltf, firGltf, sakuraGltf]) => {
        if (disposed) return false;
        const birch = extractTreeParts(birchGltf.scene);
        const fir = extractTreeParts(firGltf.scene);
        if (!birch || !fir) throw new Error('Koi Pond forest: unusable tree geometry');
        const hero = sakuraGltf ? extractSakuraTree(sakuraGltf.scene) : null;
        heroSlots = hero ? placeHero(hero, heroTreeCount) : new Set();
        placeSpecies(0, birch, heroSlots);
        placeSpecies(1, fir, heroSlots);
        applyLimit(currentLimit);
        onReady?.();
        return true;
    }).catch((error) => {
        console.warn('[KoiPond] Grove load failed; keeping procedural forest:', error);
        return false;
    });

    function applyLimit(limit) {
        currentLimit = Math.max(0, Math.min(GROVE_LAYOUT.length, Math.floor(limit)));
        meshes.forEach((mesh) => {
            const indices = mesh.userData.layoutIndices || [];
            let visible = 0;
            for (let i = 0; i < indices.length; i += 1) {
                if (indices[i] < currentLimit) visible += 1;
            }
            mesh.count = visible;
        });
    }

    return {
        group,
        ready,
        setTreeLimit: applyLimit,
        getDiagnostics: () => ({
            loaded: meshes.length > 0,
            draws: meshes.length,
            trees: currentLimit,
            heroTrees: heroSlots.size,
            layoutSize: GROVE_LAYOUT.length,
        }),
        dispose() {
            if (disposed) return;
            disposed = true;
            scene.remove(group);
            group.clear();
            geometries.forEach((geometry) => geometry.dispose());
            materials.forEach((material) => material.dispose());
            draco.dispose?.();
        },
    };
}

export { GROVE_LAYOUT };
export default createKoiPondForest;
