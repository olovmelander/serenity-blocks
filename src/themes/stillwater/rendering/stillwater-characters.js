/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
    attribute,
    cameraPosition,
    cameraProjectionMatrix,
    clamp,
    cos,
    dot,
    float,
    length,
    max,
    mix,
    modelViewMatrix,
    normalWorld,
    normalize,
    positionLocal,
    positionWorld,
    pow,
    sin,
    smoothstep,
    uniform,
    uv,
    vec2,
    vec3,
    vec4,
    vertexColor,
} from 'three/tsl';

import spiritUrl from '../assets/spirit.glb?url';
import trollLod0Url from '../assets/troll-lod0.glb?url';
import trollLod1Url from '../assets/troll-lod1.glb?url';
import trollLod2Url from '../assets/troll-lod2.glb?url';
import trollLod3Url from '../assets/troll-lod3.glb?url';
import { createStillwaterCharacterState } from '../sim/stillwater-character-state.js';

// Height of the lake's contoured bank at the troll's stance. The terrain used
// to be a flat plate below the waterline, so a troll at y=0 stood clear of it;
// the authored bank now rises here and the character has to sit on top of it.
const TROLL_GROUND_Y = 0.52;

// Lathe profile for the spirit's robe, as [radius, height] from hem to neck.
// It keeps the vertical envelope of the ellipsoid it replaced so the authored
// spirit positions in the character state machine remain correct.
const SPIRIT_ROBE_PROFILE = Object.freeze([
    [0.02, -2.20], [0.60, -2.13], [0.80, -1.84], [0.75, -1.38],
    [0.64, -0.94], [0.55, -0.50], [0.48, -0.04], [0.43, 0.40],
    [0.37, 0.80], [0.28, 1.06], [0.19, 1.20], [0.04, 1.28],
].map(([radius, height]) => new THREE.Vector2(radius, height)));

const SPIRIT_HEAD_Y = 1.52;

// Motes orbiting the spirit. One draw, evaluated entirely on the GPU.
const SPIRIT_MOTE_COUNT = 54;

// World units per second at which the authored Walk clip plays at 1x. Tuned so
// the peripheral reveal path reads as a deliberate, heavy step.
const TROLL_REFERENCE_SPEED = 1.5;
const TROLL_IDLE_ANIMATION_SCALE = 0.06;

// Hung on the troll's bank, just inland of the waterline so its reflection
// falls across the lake. Exported so the lake can site its warm spill.
export const LANTERN_WORLD = Object.freeze({ x: 19.4, y: 2.05, z: -17.4 });

const TROLL_LOD_URLS = Object.freeze({
    ultra: trollLod0Url,
    high: trollLod1Url,
    medium: trollLod2Url,
    low: trollLod3Url,
});

const TROLL_LOD_TRIANGLES = Object.freeze({
    ultra: 32_378,
    high: 17_081,
    medium: 9_765,
    low: 3_690,
});

function readTelemetryTime() {
    if (typeof globalThis.performance?.now === 'function') {
        return globalThis.performance.now();
    }
    return Date.now();
}

function enableReflectionLayer(object, layer) {
    object.traverse((child) => child.layers.enable(layer));
}

function disposeMaterial(material, disposedTextures) {
    if (!material) return;
    for (const value of Object.values(material)) {
        if (value?.isTexture && !disposedTextures.has(value)) {
            disposedTextures.add(value);
            value.dispose?.();
        }
    }
    material.dispose?.();
}

export function disposeStillwaterCharacterRoot(root) {
    if (!root) return;
    const geometries = new Set();
    const materials = new Set();
    const skeletons = new Set();
    const textures = new Set();
    root.traverse((child) => {
        if (child.geometry) geometries.add(child.geometry);
        if (Array.isArray(child.material)) child.material.forEach((entry) => materials.add(entry));
        else if (child.material) materials.add(child.material);
        if (child.skeleton) skeletons.add(child.skeleton);
    });
    geometries.forEach((geometry) => geometry.dispose?.());
    materials.forEach((material) => disposeMaterial(material, textures));
    skeletons.forEach((skeleton) => skeleton.dispose?.());
    root.removeFromParent();
}

function createTrollNodeMaterial(uSpiritBounce, uLevelWarmth, materialConfigurator) {
    const material = new THREE.MeshStandardNodeMaterial();
    const viewDirection = normalize(cameraPosition.sub(positionWorld));
    const facing = max(dot(normalize(normalWorld), normalize(vec3(-0.28, 0.72, 0.52))), 0);
    const rim = pow(float(1).sub(max(dot(normalize(normalWorld), viewDirection), 0)), 2.35);
    const mossFill = vertexColor()
        .mul(vec3(0.32, 0.45, 0.28))
        .mul(mix(float(0.70), float(1.08), facing));
    const moonRim = vec3(0.24, 0.56, 0.54).mul(rim.mul(0.34));
    const spiritBounce = vec3(0.82, 0.40, 0.10)
        .mul(uSpiritBounce.mul(normalWorld.y.mul(0.5).add(0.5)).mul(0.18));
    const levelWarmth = vec3(0.18, 0.075, 0.018)
        .mul(uLevelWarmth.mul(facing.mul(0.35).add(0.12)));
    material.colorNode = mossFill.add(moonRim).add(spiritBounce).add(levelWarmth);
    material.roughnessNode = float(0.86);
    material.metalnessNode = float(0);
    material.transparent = true;
    material.opacity = 1;
    materialConfigurator?.(material, null);
    return material;
}

function normalizeTrollRoot(
    gltfRoot,
    uSpiritBounce,
    uLevelWarmth,
    materialConfigurator,
) {
    const originalMaterials = new Set();
    const originalTextures = new Set();
    gltfRoot.traverse((child) => {
        if (!child.isMesh) return;
        if (Array.isArray(child.material)) child.material.forEach((entry) => originalMaterials.add(entry));
        else if (child.material) originalMaterials.add(child.material);
        const material = createTrollNodeMaterial(
            uSpiritBounce,
            uLevelWarmth,
            materialConfigurator,
        );
        child.material = material;
        // The troll is a skinned mesh: its geometry bounds describe the bind
        // pose at the GLB origin, not where the skeleton actually puts it, so
        // frustum culling silently dropped the hero character from every frame.
        // It is one model — culling it saves nothing worth this failure mode.
        child.frustumCulled = false;
        child.geometry?.computeBoundingBox?.();
        child.geometry?.computeBoundingSphere?.();
    });
    originalMaterials.forEach((material) => disposeMaterial(material, originalTextures));

    gltfRoot.updateMatrixWorld(true);
    const initialBox = new THREE.Box3().setFromObject(gltfRoot);
    // Retained in the root's own local units so eye lights can be placed from
    // the model's proportions rather than from hand-guessed offsets that would
    // drift between LODs.
    gltfRoot.userData.stillwaterLocalBox = initialBox.clone();
    const height = Math.max(0.001, initialBox.max.y - initialBox.min.y);
    const scale = 7.2 / height;
    gltfRoot.scale.setScalar(scale);
    gltfRoot.updateMatrixWorld(true);
    const scaledBox = new THREE.Box3().setFromObject(gltfRoot);
    gltfRoot.position.y -= scaledBox.min.y;
    gltfRoot.rotation.y = -0.52;
    gltfRoot.updateMatrixWorld(true);
    return gltfRoot;
}

/**
 * Shared Wave 5 character builder used by both isolated pilots and production.
 */
export function createStillwaterCharacters({
    root,
    profile,
    reflectionLayer = 2,
    mode = 'all',
    loader = new GLTFLoader(),
    materialConfigurator = null,
    telemetryEnabled = false,
}) {
    const characterGroup = new THREE.Group();
    characterGroup.name = 'stillwater-characters';
    root.add(characterGroup);

    const stateMachine = createStillwaterCharacterState();
    const ownedGeometries = new Set();
    const ownedMaterials = new Set();
    const loadedRoots = new Set();
    const mixers = new Set();
    const uTime = uniform(0);
    const uSpiritEnergy = uniform(0.15);
    const uSpiritBounce = uniform(0.2);
    const uLevelWarmth = uniform(0);
    // Scene time for the spirit's GPU-evaluated mote orbits.
    const uSpiritTime = uniform(0);
    // Rises when the troll reacts, so the foxfire eyes flare on a cue.
    const uTrollEyePulse = uniform(0);
    const spiritLightBase = new THREE.Color(0xffd69a);
    const spiritLightWarm = new THREE.Color(0xffbd72);
    const leanTier = profile?.name === 'Minimal'
        || profile?.name === 'Low'
        || profile?.name === 'Medium';
    let reducedMotion = false;
    let disposed = false;
    let currentTrollRoot = null;
    let incomingTrollRoot = null;
    let trollFade = 1;
    let authoredSpiritReady = false;
    let trollStride = 0;
    let targetReady = mode === 'spirit';
    let criticalReady = mode === 'spirit';
    const gltfLoadTimings = telemetryEnabled ? Object.create(null) : null;

    const ownGeometry = (geometry) => {
        ownedGeometries.add(geometry);
        return geometry;
    };
    const ownMaterial = (material) => {
        ownedMaterials.add(material);
        return material;
    };

    let spiritGroup = null;
    let spiritLight = null;
    let spiritCore = null;
    let spiritBody = null;
    let spiritAura = null;
    let filaments = null;
    let spiritMotes = null;

    if (mode !== 'troll') {
        spiritGroup = new THREE.Group();
        spiritGroup.name = 'stillwater-spirit';

        const coreMaterial = ownMaterial(new THREE.MeshStandardNodeMaterial());
        const corePulse = sin(uTime.mul(0.78)).mul(0.5).add(0.5);
        coreMaterial.colorNode = vec3(0.88, 0.78, 0.55);
        coreMaterial.emissiveNode = vec3(1.0, 0.72, 0.34)
            .mul(
                float(1.05)
                    .add(corePulse.mul(0.32))
                    .add(uSpiritEnergy.mul(0.75))
                    .add(uLevelWarmth.mul(0.22)),
            );
        coreMaterial.roughnessNode = float(0.62);
        materialConfigurator?.(coreMaterial, coreMaterial.emissiveNode);
        // The core is the figure's head plus the light held at its chest, merged
        // into one draw. Previously this was a single sphere, which is what made
        // the spirit read as a glowing ball rather than someone standing there.
        // Head only. A second glow at the chest turned the figure back into two
        // stacked orbs, which is the exact read this change exists to remove.
        const headGeometry = new THREE.SphereGeometry(0.34, 20, 14);
        headGeometry.scale(0.92, 1.08, 0.90);
        headGeometry.translate(0, SPIRIT_HEAD_Y, 0);
        spiritCore = new THREE.Mesh(ownGeometry(headGeometry), coreMaterial);

        const bodyMaterial = ownMaterial(new THREE.MeshPhysicalNodeMaterial());
        const bodyFresnel = pow(
            float(1).sub(max(dot(normalize(normalWorld), normalize(cameraPosition.sub(positionWorld))), 0)),
            1.7,
        );
        bodyMaterial.colorNode = mix(
            vec3(0.40, 0.54, 0.42),
            vec3(0.92, 0.78, 0.48),
            bodyFresnel
                .mul(0.56)
                .add(uSpiritEnergy.mul(0.14))
                .add(uLevelWarmth.mul(0.08)),
        );
        bodyMaterial.opacityNode = clamp(
            float(0.48).add(bodyFresnel.mul(0.30)).add(uSpiritEnergy.mul(0.08)),
            0.40,
            0.86,
        );
        bodyMaterial.roughnessNode = float(0.34);
        bodyMaterial.transparent = true;
        bodyMaterial.depthWrite = false;
        // The authored robe carries single-sided hair ribbons.
        bodyMaterial.side = THREE.DoubleSide;
        materialConfigurator?.(bodyMaterial, null);
        // A lathed robe: closed at the hem, flaring below the waist, tapering to
        // shoulders and a neck. It occupies the same vertical envelope the old
        // ellipsoid did, so the character state machine's authored Y positions
        // and the reflector both stay valid.
        spiritBody = new THREE.Mesh(
            ownGeometry(new THREE.LatheGeometry(SPIRIT_ROBE_PROFILE, 28)),
            bodyMaterial,
        );
        spiritBody.scale.set(1, 1, 0.82);

        if (!leanTier) {
            const auraMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial());
            const auraFresnel = pow(
                float(1).sub(max(dot(
                    normalize(normalWorld),
                    normalize(cameraPosition.sub(positionWorld)),
                ), 0)),
                2.1,
            );
            auraMaterial.colorNode = vec3(0.72, 0.58, 0.31);
            auraMaterial.opacityNode = auraFresnel
                .mul(float(0.045).add(uSpiritEnergy.mul(0.035)));
            auraMaterial.transparent = true;
            auraMaterial.depthWrite = false;
            auraMaterial.side = THREE.BackSide;
            materialConfigurator?.(auraMaterial, null);
            spiritAura = new THREE.Mesh(
                ownGeometry(new THREE.SphereGeometry(1.85, 24, 16)),
                auraMaterial,
            );
            spiritAura.scale.set(0.66, 1.30, 0.62);
        }

        if (!leanTier) {
            const filamentPaths = [
                [
                    [0.05, 1.85, 0.00],
                    [-0.38, 1.18, 0.10],
                    [-0.78, 0.35, 0.18],
                    [-0.35, -0.55, 0.28],
                    [-0.84, -1.62, 0.05],
                ],
                [
                    [-0.12, 1.72, -0.12],
                    [0.35, 1.03, -0.23],
                    [0.16, 0.15, -0.36],
                    [0.62, -0.72, -0.18],
                    [0.28, -1.72, 0.12],
                ],
                [
                    [0.18, 1.55, 0.12],
                    [-0.20, 0.85, 0.30],
                    [0.35, 0.02, 0.24],
                    [-0.12, -0.88, 0.34],
                    [-0.02, -1.85, 0.14],
                ],
            ];
            const filamentRadii = [0.055, 0.047, 0.040];
            const filamentParts = filamentPaths.map((path, index) => (
                new THREE.TubeGeometry(
                    new THREE.CatmullRomCurve3(
                        path.map((point) => new THREE.Vector3(
                            point[0] * 1.45,
                            point[1] * 1.35,
                            point[2],
                        )),
                        false,
                        'centripetal',
                    ),
                    18,
                    filamentRadii[index],
                    5,
                    false,
                )
            ));
            const filamentGeometry = mergeGeometries(filamentParts, false);
            filamentParts.forEach((geometry) => geometry.dispose());

            const filamentMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial());
            const filamentAlong = uv().x;
            const filamentEndFade = clamp(
                sin(filamentAlong.mul(Math.PI)),
                0,
                1,
            ).pow(0.62);
            const filamentFlow = sin(
                uTime.mul(1.15).sub(filamentAlong.mul(11)),
            ).mul(0.5).add(0.5);
            const filamentEmission = mix(
                vec3(1.0, 0.72, 0.38),
                vec3(0.50, 0.90, 0.70),
                filamentFlow.mul(0.22),
            ).mul(float(0.68).add(uSpiritEnergy.mul(0.55)))
                .mul(filamentEndFade);
            filamentMaterial.colorNode = filamentEmission.mul(0.78);
            filamentMaterial.opacityNode = filamentEndFade
                .mul(profile?.bloom ? 0.36 : 0.44)
                .mul(float(0.76).add(filamentFlow.mul(0.24)));
            filamentMaterial.transparent = true;
            filamentMaterial.depthWrite = false;
            filamentMaterial.blending = THREE.AdditiveBlending;
            materialConfigurator?.(filamentMaterial, filamentEmission);
            filaments = new THREE.Mesh(
                ownGeometry(filamentGeometry),
                filamentMaterial,
            );
            filaments.name = 'stillwater-spirit-flowing-veil';
            filaments.renderOrder = 4;
        }

        // Orbiting motes. One instanced draw, bloom-capable tiers only, and the
        // orbit is evaluated entirely on the GPU from a per-instance seed so no
        // CPU work or allocation is added to the frame. This is what sells the
        // spirit as something alive rather than a lit billboard.
        if (!leanTier) {
            // One non-instanced quad buffer: N motes x 4 corners. Avoids relying
            // on InstancedMesh matrices we would never populate, and keeps the
            // whole swarm to a single draw.
            const seeds = new Float32Array(SPIRIT_MOTE_COUNT * 4);
            const corners = new Float32Array(SPIRIT_MOTE_COUNT * 4 * 2);
            const moteUv = new Float32Array(SPIRIT_MOTE_COUNT * 4 * 2);
            const moteIndices = [];
            const CORNER = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
            for (let mote = 0; mote < SPIRIT_MOTE_COUNT; mote += 1) {
                // Golden-angle stride keeps the seeds evenly decorrelated.
                const seed = (mote * 2.3999632) % (Math.PI * 2);
                const scale = 0.10 + ((mote * 7) % 5) * 0.024;
                for (let corner = 0; corner < 4; corner += 1) {
                    const vertexIndex = mote * 4 + corner;
                    seeds[vertexIndex] = seed;
                    corners[vertexIndex * 2] = CORNER[corner][0] * scale;
                    corners[vertexIndex * 2 + 1] = CORNER[corner][1] * scale;
                    moteUv[vertexIndex * 2] = (CORNER[corner][0] + 1) * 0.5;
                    moteUv[vertexIndex * 2 + 1] = (CORNER[corner][1] + 1) * 0.5;
                }
                const base = mote * 4;
                moteIndices.push(base, base + 1, base + 2, base, base + 2, base + 3);
            }
            const moteGeometry = ownGeometry(new THREE.BufferGeometry());
            moteGeometry.setAttribute(
                'position',
                new THREE.BufferAttribute(new Float32Array(SPIRIT_MOTE_COUNT * 4 * 3), 3),
            );
            // The material never shades from it, but r181's node pipeline still
            // resolves `normal` and warns when a geometry omits it.
            const moteNormals = new Float32Array(SPIRIT_MOTE_COUNT * 4 * 3);
            for (let n = 2; n < moteNormals.length; n += 3) moteNormals[n] = 1;
            moteGeometry.setAttribute('normal', new THREE.BufferAttribute(moteNormals, 3));
            moteGeometry.setAttribute('aMoteSeed', new THREE.BufferAttribute(seeds, 1));
            moteGeometry.setAttribute('aMoteCorner', new THREE.BufferAttribute(corners, 2));
            moteGeometry.setAttribute('uv', new THREE.BufferAttribute(moteUv, 2));
            moteGeometry.setIndex(moteIndices);
            moteGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 4);

            const moteMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial());
            const seed = attribute('aMoteSeed', 'float');
            const corner = attribute('aMoteCorner', 'vec2');
            // Each mote rides its own slow inclined orbit; the radius breathes so
            // the swarm never settles into a readable ring.
            const spin = uSpiritTime.mul(0.34).add(seed.mul(3.1));
            const radius = float(1.05)
                .add(sin(uSpiritTime.mul(0.21).add(seed.mul(1.7))).mul(0.52))
                .add(uSpiritEnergy.mul(0.46));
            const orbit = vec3(
                cos(spin).mul(radius),
                sin(uSpiritTime.mul(0.27).add(seed.mul(2.3))).mul(1.25)
                    .add(sin(seed.mul(5.1)).mul(1.15)),
                sin(spin).mul(radius).mul(0.72),
            );
            // Billboard: take the orbit centre into view space, then offset by
            // the quad corner, which is already camera-aligned there.
            const viewCenter = modelViewMatrix.mul(vec4(orbit, 1));
            moteMaterial.vertexNode = cameraProjectionMatrix.mul(vec4(
                viewCenter.xyz.add(vec3(corner, 0)),
                1,
            ));
            const moteFade = float(0.55)
                .add(sin(uSpiritTime.mul(1.9).add(seed.mul(4.7))).mul(0.45));
            const moteEmission = vec3(1.0, 0.94, 0.76)
                .mul(moteFade.mul(float(1.25).add(uSpiritEnergy.mul(0.9))));
            moteMaterial.colorNode = moteEmission;
            moteMaterial.opacityNode = smoothstep(0, 1, length(uv().sub(vec2(0.5))).mul(2))
                .oneMinus()
                .pow(2.0)
                .mul(moteFade)
                .mul(0.85);
            moteMaterial.transparent = true;
            moteMaterial.depthWrite = false;
            moteMaterial.blending = THREE.AdditiveBlending;
            materialConfigurator?.(moteMaterial, moteEmission);

            spiritMotes = new THREE.Mesh(moteGeometry, moteMaterial);
            spiritMotes.name = 'stillwater-spirit-motes';
            spiritMotes.frustumCulled = false;
            spiritMotes.renderOrder = 5;
        }

        spiritGroup.add(spiritBody, spiritCore);
        if (spiritAura) spiritGroup.add(spiritAura);
        if (filaments) spiritGroup.add(filaments);
        if (spiritMotes) spiritGroup.add(spiritMotes);
        spiritGroup.position.set(-18.6, 4.9, -8.0);
        // Larger as well as nearer: together these take her from ~1.5% to ~2.7% of
        // frame height, which is the difference between a detail and a subject.
        spiritGroup.scale.setScalar(1.95);
        // The reflector gets the readable spirit core only. The larger aura and
        // filament veil are transparent accents and would multiply reflection
        // overdraw without improving the silhouette.
        // The robe reflects alongside the head: mirroring only the core gave the
        // lake a floating orb with no figure under it.
        // Upgrade the procedural silhouette to the authored Blender figure when
        // it arrives. Only the geometry is swapped, so materials, reflection
        // layers, render order, and the spirit group's child count are all
        // preserved — and a failed load simply keeps the lathe fallback.
        loadAuthoredSpirit();

        enableReflectionLayer(spiritCore, reflectionLayer);
        // Lean tiers keep the single-silhouette reflection contract; they also
        // run reflectionScale 0, so the robe would cost overdraw for nothing.
        if (!leanTier) enableReflectionLayer(spiritBody, reflectionLayer);
        characterGroup.add(spiritGroup);

        spiritLight = new THREE.PointLight(0xffd69a, 1.05, 18, 1.7);
        spiritLight.position.copy(spiritGroup.position);
        spiritLight.position.y += 0.5;
        characterGroup.add(spiritLight);
    }

    const trollGroup = new THREE.Group();
    trollGroup.name = 'stillwater-hero-troll';
    trollGroup.position.set(22.2, TROLL_GROUND_Y, -19.2);
    characterGroup.add(trollGroup);

    // A hung foxfire lantern on the troll's bank. This is the scene's anchor
    // warm practical: the concept art reads as teal-and-amber, and without a
    // discrete amber source everything collapses back to one hue.
    let lantern = null;
    if (mode !== 'spirit' && !leanTier) {
        const lanternGeometry = ownGeometry(new THREE.SphereGeometry(0.34, 12, 10));
        const lanternMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial());
        // Slow irregular flicker from two detuned sines so it never reads as a
        // clean sine pulse.
        const flicker = float(0.86)
            .add(sin(uTime.mul(2.7)).mul(0.09))
            .add(sin(uTime.mul(6.1).add(1.7)).mul(0.05));
        const lanternEmission = vec3(1.0, 0.63, 0.26).mul(flicker.mul(0.72));
        lanternMaterial.colorNode = lanternEmission;
        lanternMaterial.transparent = true;
        lanternMaterial.depthWrite = false;
        lanternMaterial.blending = THREE.AdditiveBlending;
        materialConfigurator?.(lanternMaterial, lanternEmission);
        lantern = new THREE.Mesh(lanternGeometry, lanternMaterial);
        lantern.name = 'stillwater-troll-lantern';
        lantern.position.set(LANTERN_WORLD.x, LANTERN_WORLD.y, LANTERN_WORLD.z);
        lantern.frustumCulled = false;
        lantern.renderOrder = 4;
        characterGroup.add(lantern);
        enableReflectionLayer(lantern, reflectionLayer);
    }

    let contactDisc = null;
    if (mode !== 'spirit' && !leanTier) {
        const contactMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial());
        // Disc-LOCAL radius, so the falloff travels with the mesh. It used to be
        // a world-space distance from the hardcoded point (18.2, -19.2) — roughly
        // under his old `water` beat — so once the waypoints moved outboard the
        // shadow sat about four units from a three-unit falloff: fully detached
        // at every beat, and silently wrong before that whenever he walked.
        // Non-instanced geometry, so positionLocal is safe here.
        const contactRadius = positionLocal.xy.length();
        contactMaterial.colorNode = vec3(0.004, 0.012, 0.009);
        contactMaterial.opacityNode = float(0.32)
            .mul(float(1).sub(clamp(contactRadius.div(3.0), 0, 1)));
        contactMaterial.transparent = true;
        contactMaterial.depthWrite = false;
        materialConfigurator?.(contactMaterial, null);
        contactDisc = new THREE.Mesh(
            ownGeometry(new THREE.CircleGeometry(3.1, 32)),
            contactMaterial,
        );
        contactDisc.rotation.x = -Math.PI / 2;
        // The disc sits nearer the waterline than the troll, where the bank has
        // barely lifted off the surface.
        contactDisc.position.set(trollGroup.position.x, 0.06, trollGroup.position.z);
        contactDisc.scale.set(1.2, 0.54, 1);
        characterGroup.add(contactDisc);
    }

    let rootOpacityValue = 1;
    function applyRootOpacity(child) {
        const { material } = child;
        if (!material) return;
        if (Array.isArray(material)) {
            for (let index = 0; index < material.length; index += 1) {
                material[index].opacity = rootOpacityValue;
                material[index].transparent = rootOpacityValue < 0.999;
            }
            return;
        }
        material.opacity = rootOpacityValue;
        material.transparent = rootOpacityValue < 0.999;
    }

    function setRootOpacity(modelRoot, value) {
        rootOpacityValue = value;
        modelRoot?.traverse(applyRootOpacity);
    }

    /**
     * Swap in the authored spirit GLB. `SpiritRobe` carries the robe and hair,
     * `SpiritCore` the head; each is baked into world space before replacing the
     * matching procedural geometry.
     */
    async function loadAuthoredSpirit() {
        try {
            const gltf = await loader.loadAsync(spiritUrl);
            if (disposed || !spiritBody || !spiritCore) {
                disposeStillwaterCharacterRoot(gltf.scene);
                return;
            }
            gltf.scene.updateMatrixWorld(true);
            const swap = (sourceName, target) => {
                const source = gltf.scene.getObjectByName(sourceName);
                if (!source?.geometry) return false;
                const geometry = source.geometry.clone();
                geometry.applyMatrix4(source.matrixWorld);
                geometry.computeVertexNormals();
                geometry.computeBoundingSphere();
                const previous = target.geometry;
                target.geometry = ownGeometry(geometry);
                ownedGeometries.delete(previous);
                previous.dispose();
                return true;
            };
            const robeSwapped = swap('SpiritRobe', spiritBody);
            const coreSwapped = swap('SpiritCore', spiritCore);
            if (robeSwapped) {
                // The authored robe already carries its own proportions.
                spiritBody.scale.set(1, 1, 1);
            }
            authoredSpiritReady = robeSwapped && coreSwapped;
            disposeStillwaterCharacterRoot(gltf.scene);
        } catch {
            // Keeping the procedural lathe is a valid outcome, not a failure.
            authoredSpiritReady = false;
        }
    }

    function attachLoadedTroll(gltf, lodName, initialOpacity) {
        if (disposed) {
            disposeStillwaterCharacterRoot(gltf.scene);
            return null;
        }
        const modelRoot = normalizeTrollRoot(
            gltf.scene,
            uSpiritBounce,
            uLevelWarmth,
            materialConfigurator,
        );
        modelRoot.userData.stillwaterLod = lodName;
        // Foxfire eyes. The concept art's whole warm/cool tension hangs off two
        // amber points inside a dark mossy mass, and the source GLB has no eye
        // geometry to target, so they are added as their own emissive pair sized
        // from the model's local bounding box.
        if (!leanTier) {
            const localBox = modelRoot.userData.stillwaterLocalBox;
            if (localBox) {
                const size = localBox.getSize(new THREE.Vector3());
                const centre = localBox.getCenter(new THREE.Vector3());
                const eyeRadius = Math.max(0.001, size.y * 0.012);
                const eyeGeometries = [-1, 1].map((side) => {
                    const sphere = new THREE.SphereGeometry(eyeRadius, 8, 6);
                    sphere.translate(
                        centre.x + side * size.x * 0.085,
                        localBox.min.y + size.y * 0.855,
                        localBox.max.z - size.z * 0.14,
                    );
                    return sphere;
                });
                const eyeGeometry = ownGeometry(mergeGeometries(eyeGeometries));
                eyeGeometries.forEach((geometry) => geometry.dispose());
                const eyeMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial());
                const eyeEmission = vec3(1.0, 0.60, 0.20)
                    .mul(float(0.42).add(uTrollEyePulse.mul(0.55)));
                eyeMaterial.colorNode = eyeEmission;
                eyeMaterial.transparent = true;
                eyeMaterial.depthWrite = false;
                eyeMaterial.blending = THREE.AdditiveBlending;
                materialConfigurator?.(eyeMaterial, eyeEmission);
                const eyes = new THREE.Mesh(eyeGeometry, eyeMaterial);
                eyes.name = 'stillwater-troll-foxfire-eyes';
                eyes.frustumCulled = false;
                eyes.renderOrder = 5;
                modelRoot.add(eyes);
            }
        }
        setRootOpacity(modelRoot, initialOpacity);
        trollGroup.add(modelRoot);
        loadedRoots.add(modelRoot);
        enableReflectionLayer(modelRoot, reflectionLayer);

        if (gltf.animations?.length) {
            const mixer = new THREE.AnimationMixer(modelRoot);
            const action = mixer.clipAction(gltf.animations[0]);
            action.setEffectiveTimeScale(0.34);
            action.play();
            mixers.add(mixer);
            modelRoot.userData.stillwaterMixer = mixer;
        }
        return modelRoot;
    }

    async function loadLod(url, lodName, opacity) {
        const startedAtMs = telemetryEnabled ? readTelemetryTime() : null;
        try {
            const gltf = await loader.loadAsync(url);
            const loadedRoot = attachLoadedTroll(gltf, lodName, opacity);
            if (telemetryEnabled) {
                const completedAtMs = readTelemetryTime();
                gltfLoadTimings[lodName] = {
                    status: loadedRoot ? 'ready' : 'disposed-before-attach',
                    startedAtMs,
                    completedAtMs,
                    combinedLoadParseAttachMs: Math.max(
                        0,
                        completedAtMs - startedAtMs,
                    ),
                };
            }
            return loadedRoot;
        } catch (error) {
            if (telemetryEnabled) {
                const completedAtMs = readTelemetryTime();
                gltfLoadTimings[lodName] = {
                    status: 'failed',
                    startedAtMs,
                    completedAtMs,
                    combinedLoadParseAttachMs: Math.max(
                        0,
                        completedAtMs - startedAtMs,
                    ),
                };
            }
            if (!disposed) console.warn(`[Stillwater] Failed to load troll ${lodName} LOD:`, error);
            return null;
        }
    }

    let criticalReadyPromise = Promise.resolve(true);
    let readyPromise = Promise.resolve(true);
    if (mode !== 'spirit') {
        const targetLod = profile?.trollLod || 'high';
        criticalReadyPromise = loadLod(TROLL_LOD_URLS.low, 'low', 1)
            .then((criticalRoot) => {
                if (!criticalRoot) return false;
                currentTrollRoot = criticalRoot;
                criticalReady = true;
                return true;
            });
        readyPromise = criticalReadyPromise.then(async (isCriticalReady) => {
            if (!isCriticalReady) return false;
            if (targetLod === 'low' || disposed) {
                targetReady = true;
                return true;
            }
            const targetRoot = await loadLod(TROLL_LOD_URLS[targetLod], targetLod, 0);
            if (!targetRoot) return false;
            incomingTrollRoot = targetRoot;
            trollFade = 0;
            targetReady = true;
            return true;
        });
    }

    function completeTrollTransition() {
        if (!incomingTrollRoot) return false;
        setRootOpacity(incomingTrollRoot, 1);
        setRootOpacity(currentTrollRoot, 0);
        const outgoing = currentTrollRoot;
        currentTrollRoot = incomingTrollRoot;
        incomingTrollRoot = null;
        trollFade = 1;
        const outgoingMixer = outgoing?.userData.stillwaterMixer;
        if (outgoingMixer) {
            outgoingMixer.stopAllAction();
            outgoingMixer.uncacheRoot(outgoing);
            mixers.delete(outgoingMixer);
        }
        loadedRoots.delete(outgoing);
        disposeStillwaterCharacterRoot(outgoing);
        return true;
    }

    function update(time, delta) {
        const dt = Math.min(0.1, Math.max(0, Number.isFinite(delta) ? delta : 0));
        uTime.value = time;
        uSpiritTime.value = time;
        const state = stateMachine.update(dt, reducedMotion);
        // Foxfire eyes flare when the troll notices something.
        uTrollEyePulse.value = Math.min(1, state.troll.glance * 0.7
            + state.troll.wary
            + state.troll.delight * 0.8
            + state.troll.reveal * 0.25);
        uSpiritEnergy.value += (
            Math.max(state.spirit.attention, state.spirit.response) - uSpiritEnergy.value
        ) * (1 - Math.exp(-4.2 * dt));
        uSpiritBounce.value += (
            Math.max(0.18, state.spirit.attention * 0.72) - uSpiritBounce.value
        ) * (1 - Math.exp(-2.8 * dt));

        if (spiritGroup) {
            const bob = reducedMotion ? 0 : Math.sin(time * 0.52) * 0.18;
            spiritGroup.position.set(
                state.spirit.x,
                state.spirit.y + bob,
                state.spirit.z,
            );
            spiritGroup.rotation.y = reducedMotion ? 0 : Math.sin(time * 0.16) * 0.12;
            spiritLight?.position.copy(spiritGroup.position);
            if (spiritLight) {
                spiritLight.position.y += 0.5;
                spiritLight.intensity = 0.82
                    + uSpiritEnergy.value * 0.55
                    + uLevelWarmth.value * 0.16;
                spiritLight.color
                    .copy(spiritLightBase)
                    .lerp(spiritLightWarm, uLevelWarmth.value);
            }
        }

        trollGroup.position.x = state.troll.x;
        // Lock the Walk cycle to real ground speed so the feet plant instead of
        // skating. The state machine publishes speed directly; differencing the
        // group position here would read zero under fixed-time capture and stall
        // the skeleton entirely.
        const trollSpeed = Number.isFinite(state.troll.speed) ? state.troll.speed : 0;
        trollStride += (trollSpeed - trollStride) * Math.min(1, dt * 8);
        const strideRate = Math.min(1.7, trollStride / TROLL_REFERENCE_SPEED);

        // Gesture offsets are relative to the bank height, not to zero. This
        // line previously reset y outright, which silently re-buried the troll
        // in the shoreline every frame.
        trollGroup.position.y = TROLL_GROUND_Y
            + state.troll.delight * 0.12
            - state.troll.bow * 0.06;
        // Z now comes from the 2D path rather than a fixed line.
        trollGroup.position.z = (Number.isFinite(state.troll.z) ? state.troll.z : -19.2)
            + state.troll.turn * 0.10;
        // The contact shadow tracks him on the ground plane; its own height is
        // fixed at the waterline, so it must not inherit his gesture bob.
        if (contactDisc) {
            contactDisc.position.x = trollGroup.position.x;
            contactDisc.position.z = trollGroup.position.z;
        }
        trollGroup.rotation.x = state.troll.bow * 0.12 - state.troll.lookUp * 0.085;
        // Facing: while walking he faces where he is going; when he stops, he
        // turns toward her. Blending on stride rather than switching avoids the
        // snap that would betray the state machine underneath.
        const walkHeading = Number.isFinite(state.troll.heading) ? state.troll.heading : -0.52;
        const spiritDx = state.spirit.x - trollGroup.position.x;
        const spiritDz = state.spirit.z - trollGroup.position.z;
        const towardSpirit = Math.atan2(spiritDx, -spiritDz);
        let towardDelta = towardSpirit - walkHeading;
        while (towardDelta > Math.PI) towardDelta -= Math.PI * 2;
        while (towardDelta < -Math.PI) towardDelta += Math.PI * 2;
        // Attention rises when he is still AND she is present — the noticing is
        // what the whole relationship is made of, so it gets the clean read.
        const attention = Math.min(1, (1 - Math.min(1, strideRate)) * state.troll.reveal);
        trollGroup.rotation.y = walkHeading
            + towardDelta * attention * 0.55
            + state.troll.look * 0.08
            - state.troll.glance * 0.13
            + state.troll.turn * 0.16;
        // Procedural life on top of the clip: a slow breath and a weight rock
        // that persist when the Walk cycle is near rest.
        const settle = 1 - Math.min(1, strideRate);
        const breath = reducedMotion
            ? 0
            : Math.sin(time * 0.78) * 0.045 * settle * state.troll.reveal;
        trollGroup.position.y += breath;
        const idleSway = reducedMotion
            ? 0
            : (Math.sin(time * 0.64) * 0.012 * state.troll.reveal)
                + Math.sin(time * 0.41) * 0.020 * settle * state.troll.reveal;
        trollGroup.rotation.z = idleSway
            - state.troll.wary * 0.028
            + state.troll.delight * 0.022;
        const animationScale = (reducedMotion ? 0.25 : 1)
            * (1 - Math.min(0.82, state.troll.pause * 0.82))
            // A floor keeps the skeleton alive while standing — settling weight,
            // shifting arms — rather than freezing mid-stride.
            * (TROLL_IDLE_ANIMATION_SCALE + strideRate);
        // `mixers` is a Set: it has no `.length` and no numeric indices, so the
        // former indexed for-loop evaluated `0 < undefined` and never ran even
        // once. The troll's skeleton was never advanced by anything, which is
        // why it slid along its path with its legs and arms locked in bind pose.
        mixers.forEach((mixer) => mixer.update(dt * animationScale));

        if (incomingTrollRoot) {
            trollFade = Math.min(1, trollFade + dt / 0.72);
            setRootOpacity(incomingTrollRoot, trollFade);
            setRootOpacity(currentTrollRoot, 1 - trollFade);
            if (trollFade >= 1) {
                completeTrollTransition();
            }
        }
    }

    function pulse(kind, strength = 1) {
        stateMachine.cue(kind, strength);
    }

    function pulseSpirit(kind, strength = 1) {
        stateMachine.cueSpirit(kind, strength);
    }

    function pulseTroll(kind, strength = 1) {
        stateMachine.cueTroll(kind, strength);
    }

    function setReducedMotion(value) {
        reducedMotion = Boolean(value);
    }

    function setLevelEnrichment(value) {
        uLevelWarmth.value = Math.max(
            0,
            Math.min(1, Number.isFinite(value) ? Number(value) : 0),
        );
    }

    function getDiagnostics() {
        // Head only on lean tiers; head plus robe where the reflector runs.
        let spiritReflectionDraws = 0;
        if (mode !== 'troll') spiritReflectionDraws = leanTier ? 1 : 2;
        let spiritDrawEstimate = 0;
        let trollDrawEstimate = 0;
        // Bloom-capable tiers add the orbiting mote swarm as one further draw.
        if (mode !== 'troll') spiritDrawEstimate = leanTier ? 2 : 5;
        // Non-lean tiers add the foxfire eyes and the hung lantern.
        if (mode !== 'spirit') trollDrawEstimate = leanTier ? 1 : 4;
        return {
            mode,
            spiritState: stateMachine.state.spirit.name,
            trollState: stateMachine.state.troll.name,
            trollGesture: stateMachine.state.troll.gesture,
            trollPose: {
                glance: stateMachine.state.troll.glance,
                turn: stateMachine.state.troll.turn,
                pause: stateMachine.state.troll.pause,
                delight: stateMachine.state.troll.delight,
                wary: stateMachine.state.troll.wary,
                bow: stateMachine.state.troll.bow,
                lookUp: stateMachine.state.troll.lookUp,
            },
            spiritX: stateMachine.state.spirit.x,
            trollX: stateMachine.state.troll.x,
            levelWarmth: uLevelWarmth.value,
            boardSafe: stateMachine.state.spirit.x <= -14
                && stateMachine.state.troll.x >= 17,
            criticalReady,
            targetReady,
            targetLod: profile?.trollLod || 'high',
            targetTriangles: TROLL_LOD_TRIANGLES[profile?.trollLod || 'high'],
            realLights: spiritLight ? 1 : 0,
            directDrawEstimate: spiritDrawEstimate + trollDrawEstimate,
            reflectionDrawEstimate: spiritReflectionDraws
                + (mode === 'spirit' ? 0 : 1),
            authoredSpiritReady,
            leanTier,
            gltfTimings: telemetryEnabled
                ? {
                    measurement: 'combined GLTF load + parse/attach',
                    gpuUploadMeasured: false,
                    clock: typeof globalThis.performance?.now === 'function'
                        ? 'performance.now'
                        : 'Date.now',
                    loads: Object.fromEntries(
                        Object.entries(gltfLoadTimings).map(([lod, timing]) => [
                            lod,
                            { ...timing },
                        ]),
                    ),
                }
                : null,
        };
    }

    function getResourceState() {
        return {
            ownedGeometries: ownedGeometries.size,
            ownedMaterials: ownedMaterials.size,
            loadedRoots: loadedRoots.size,
            mixers: mixers.size,
            criticalReady,
            targetReady,
        };
    }

    function dispose() {
        if (disposed) return;
        disposed = true;
        mixers.forEach((mixer) => {
            mixer.stopAllAction();
            loadedRoots.forEach((loadedRoot) => mixer.uncacheRoot(loadedRoot));
        });
        mixers.clear();
        loadedRoots.forEach((loadedRoot) => disposeStillwaterCharacterRoot(loadedRoot));
        loadedRoots.clear();
        root.remove(characterGroup);
        ownedGeometries.forEach((geometry) => geometry.dispose());
        ownedMaterials.forEach((material) => material.dispose());
        // Break the detached static hierarchy after renderer-facing resources
        // have dispatched their dispose events. If an r181 callback temporarily
        // retains one former render object, its parent chain can no longer keep
        // every spirit/contact sibling alive with it.
        spiritGroup?.clear();
        trollGroup.clear();
        characterGroup.clear();
        spiritGroup = null;
        spiritLight = null;
        spiritCore = null;
        spiritBody = null;
        spiritAura = null;
        filaments = null;
        spiritMotes = null;
        contactDisc = null;
        lantern = null;
        currentTrollRoot = null;
        incomingTrollRoot = null;
        ownedGeometries.clear();
        ownedMaterials.clear();
    }

    /**
     * Current spirit world position and emitted energy, so unlit surfaces
     * elsewhere in the scene can fake its practical light spill.
     */
    function getSpiritGlow() {
        if (!spiritGroup) return null;
        return {
            x: spiritGroup.position.x,
            y: spiritGroup.position.y,
            z: spiritGroup.position.z,
            energy: 0.82 + uSpiritEnergy.value * 0.55 + uLevelWarmth.value * 0.16,
        };
    }

    return Object.freeze({
        criticalReady: criticalReadyPromise,
        ready: readyPromise,
        getSpiritGlow,
        update,
        pulse,
        pulseSpirit,
        pulseTroll,
        settleLodTransition: completeTrollTransition,
        setReducedMotion,
        setLevelEnrichment,
        getDiagnostics,
        getResourceState,
        dispose,
    });
}

export const STILLWATER_TROLL_LOD_TRIANGLES = TROLL_LOD_TRIANGLES;
