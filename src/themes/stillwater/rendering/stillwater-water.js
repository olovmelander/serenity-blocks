/**
 * Stillwater's production-owned "The Pool Remembers" water runtime.
 *
 * `reflection=auto|off` is the parameter contract (`1|0` are accepted aliases).
 * High/auto constructs the reduced-resolution reflector. Low/auto constructs the
 * analytic sky/character reflection. Off constructs neither reflection graph.
 * `responses=off` removes the Wave 3 graph before material construction for A/B.
 */
import * as THREE from 'three/webgpu';
import {
    abs,
    attribute,
    cameraPosition,
    clamp,
    cos,
    dot,
    float,
    Fn,
    If,
    length,
    max,
    mix,
    mx_noise_vec3 as materialXNoiseVec3,
    mx_worley_noise_float as materialXWorley,
    normalize,
    normalWorld,
    pass,
    positionGeometry,
    positionLocal,
    positionWorld,
    pow,
    reflector,
    renderOutput,
    screenUV,
    sin,
    smoothstep,
    struct,
    toneMapping,
    uniform,
    uniformArray,
    uv,
    viewportSharedTexture,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    createStillwaterWaterResponseState,
    STILLWATER_RESPONSE_KIND,
} from '../sim/stillwater-water-response.js';
import {
    getStillwaterQualityProfile,
} from '../stillwater-quality.js';

const WATER_RUNTIME_ID = 'stillwater-water';
const REFLECTION_LAYER = 2;
const WATER_Y = 0;
const BOARD_WATER_CENTER = Object.freeze({ x: 0, z: -7 });
// Kept beside the moon mesh transform so the water's moon path stays aligned
// with the disc the viewer can actually see.
const MOON_WORLD = Object.freeze({ x: 32, y: 17.5, z: -86 });
const TETRIS_DEPTH_WAKE_OFFSETS = Object.freeze([-4.5, -1.5, 1.5, 4.5]);
const TETRIS_DEPTH_WAKE_SPACING = (
    TETRIS_DEPTH_WAKE_OFFSETS[1] - TETRIS_DEPTH_WAKE_OFFSETS[0]
);
const TETRIS_DEPTH_WAKE_HALF_EXTENT = Math.max(
    ...TETRIS_DEPTH_WAKE_OFFSETS.map((offset) => Math.abs(offset)),
);

function responseModeName(mode) {
    if (mode === STILLWATER_RESPONSE_KIND.lock) return 'lock';
    if (mode === STILLWATER_RESPONSE_KIND.tetris) return 'tetris';
    if (mode === STILLWATER_RESPONSE_KIND.tspin) return 'tspin';
    return 'idle';
}

// Authored shoreline. The lake is an OPEN channel: it runs off the bottom of
// frame and narrows into the fog, so neither the near nor the far bank is ever
// a visible closed edge. A closed pond outline reads as a diorama puddle and
// was the single largest departure from the concept art.
//
// Columns are [z, halfWidth, bend]. `bend` slides the channel centre to carve
// the shallow S that leads the eye from the lower corners toward the spirit.
// Control-point z spacing is deliberately tight near the camera so the shared
// lake grid tessellates densely where gameplay wakes land.
// Widths are tuned against the solo camera: the bottom edge of frame meets the
// water plane at z~18 with a horizontal half-extent of ~20 world units, so the
// near half-width must stay under that or the banks fall outside the frame and
// the lower third becomes an undifferentiated slab of water.
const SHORE_CONTROL = Object.freeze([
    [54, 30, 0],
    [30, 23, 1],
    [12, 19, 3],
    [-6, 17, 4],
    [-22, 14, 2],
    [-40, 11, -2],
    [-62, 9, -5],
    [-92, 7, -4],
    [-126, 5, -2],
    [-172, 3, 0],
]);

function catmullRom(p0, p1, p2, p3, s) {
    const s2 = s * s;
    const s3 = s2 * s;
    return 0.5 * (
        2 * p1
        + (-p0 + p2) * s
        + (2 * p0 - 5 * p1 + 4 * p2 - p3) * s2
        + (-p0 + 3 * p1 - 3 * p2 + p3) * s3
    );
}

/**
 * Sample the authored shoreline. `t` runs 0 (nearest, behind the camera) to 1
 * (farthest, dissolved in fog).
 *
 * Exported because the forest owns the shoreline dressing — reeds, lilies,
 * mushroom clusters — and it must be planted against the waterline the lake
 * actually draws. Keeping two independent shore curves is what stranded the
 * flora on dry land.
 *
 * @param {number} t
 * @returns {{ z: number, halfWidth: number, bend: number }}
 */
export function sampleShore(t) {
    const span = SHORE_CONTROL.length - 1;
    const scaled = THREE.MathUtils.clamp(t, 0, 1) * span;
    const index = Math.min(span - 1, Math.floor(scaled));
    const s = scaled - index;
    const pick = (i) => SHORE_CONTROL[THREE.MathUtils.clamp(i, 0, span)];
    const p0 = pick(index - 1);
    const p1 = pick(index);
    const p2 = pick(index + 1);
    const p3 = pick(index + 2);
    return {
        z: catmullRom(p0[0], p1[0], p2[0], p3[0], s),
        halfWidth: Math.max(1.5, catmullRom(p0[1], p1[1], p2[1], p3[1], s)),
        bend: catmullRom(p0[2], p1[2], p2[2], p3[2], s),
    };
}

const RESPONSE_PRESETS = Object.freeze({
    idle: Object.freeze({
        x: BOARD_WATER_CENTER.x,
        z: BOARD_WATER_CENTER.z,
        age: 0,
        canonicalSequence: Object.freeze([]),
    }),
    lock: Object.freeze({
        x: -3.2,
        z: -5.8,
        age: 0.20,
        canonicalSequence: Object.freeze(['pieceLock']),
    }),
    tetris: Object.freeze({
        x: 0,
        z: -10.5,
        age: 0.42,
        canonicalSequence: Object.freeze(['pieceLock', 'lineClear:4']),
    }),
    tspin: Object.freeze({
        x: 2.2,
        z: -11.5,
        age: 0.34,
        canonicalSequence: Object.freeze(['pieceLock:T', 'lineClear:2', 'tspin:2']),
    }),
});

function readQuality(params) {
    return getStillwaterQualityProfile(params?.get?.('quality') || 'High');
}

function readToggle(params, key, fallback = true) {
    const value = params?.get?.(key);
    if (value == null) return fallback;
    return !['0', 'off', 'false', 'no'].includes(String(value).toLowerCase());
}

function readReflectionRequest(params) {
    if (params?.has?.('noReflect')) return 'off';
    const raw = String(params?.get?.('reflection') || 'auto').toLowerCase();
    return ['0', 'off', 'false', 'no'].includes(raw) ? 'off' : 'auto';
}

/**
 * `?reflectScale=<0..1>` overrides the reflector's resolution scale and
 * `?reflectSmear=0` collapses the three-tap vertical smear to one tap. Both
 * exist so the cost of the 2026-07-28 mirror work is MEASURABLE rather than
 * asserted: the four cells (0.48|0.60) x (1|3 taps) attribute frame time to the
 * resolution bump and the extra fetches separately. Defaults are the shipped
 * values, so neither flag changes production behaviour.
 */
function readReflectScale(params, fallback) {
    const raw = params?.get?.('reflectScale');
    if (raw == null) return fallback;
    const parsed = Number.parseFloat(raw);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(1, Math.max(0, parsed));
}

function readGrade(params) {
    return String(params?.get?.('grade') || 'full').toLowerCase() === 'aces'
        ? 'aces'
        : 'full';
}

function readResponseEvent(params) {
    const requested = String(params?.get?.('event') || 'idle').toLowerCase();
    return Object.hasOwn(RESPONSE_PRESETS, requested) ? requested : 'idle';
}

function readFiniteParam(params, key, fallback, minimum = -Infinity, maximum = Infinity) {
    const raw = params?.get?.(key);
    if (raw == null || raw === '') return fallback;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return fallback;
    return THREE.MathUtils.clamp(parsed, minimum, maximum);
}

const LAKE_COLUMN_COUNT = 48;

/**
 * The shared lake surface/bed grid, built along the open shore channel.
 *
 * Two vertex attributes travel with it so every downstream mask is exact for
 * the authored shape instead of re-deriving an approximate ellipse in world
 * space: `aCross` is signed cross-channel position (-1 shore .. 0 centre ..
 * +1 shore) and `aAlong` is 0..1 distance into the fog.
 */
function makeLakeGeometry(ringCount) {
    const rows = Math.max(10, Math.round(ringCount * 2));
    const columns = LAKE_COLUMN_COUNT;
    const positions = [];
    const cross = [];
    const along = [];
    const indices = [];

    for (let row = 0; row <= rows; row += 1) {
        const t = row / rows;
        const { z, halfWidth, bend } = sampleShore(t);
        for (let column = 0; column <= columns; column += 1) {
            const c = (column / columns) * 2 - 1;
            positions.push(bend + c * halfWidth, 0, z);
            cross.push(c);
            along.push(t);
        }
    }

    const stride = columns + 1;
    for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
            const a = row * stride + column;
            const b = a + 1;
            const c = a + stride;
            const d = c + 1;
            // z decreases as `row` grows, so this winding faces +Y.
            indices.push(a, b, c, b, d, c);
        }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('aCross', new THREE.Float32BufferAttribute(cross, 1));
    geometry.setAttribute('aAlong', new THREE.Float32BufferAttribute(along, 1));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    geometry.userData.stillwaterRingCount = ringCount;
    return geometry;
}

// Bank cross-section, sampled per shoreline row. Each entry is
// [outwardOffset, height] measured from the waterline outward. The near rows
// carry the tall dark mass that frames the lower corners; the far rows settle
// into low hills that the height fog lifts into mist.
function bankSection(t) {
    const near = 1 - THREE.MathUtils.smoothstep(t, 0.06, 0.42);
    const lift = (base, nearGain) => base + nearGain * near;
    // Bands must climb steeply. Shallow bands seen edge-on from this low camera
    // read as thin horizontal ribbons strung across the trees rather than land.
    // Deliberately gentle out to ~30 units from the waterline: that is where the
    // forest stands, and a steep near bank leaves the trees floating above it.
    // Only the outermost band climbs, to close the frame edges behind them.
    return [
        [0, -0.35],
        [THREE.MathUtils.lerp(4.0, 2.0, t), lift(0.30, 0.45)],
        [THREE.MathUtils.lerp(12, 6.5, t), lift(0.85, 1.10)],
        [THREE.MathUtils.lerp(30, 17, t), lift(2.0, 2.6)],
        [THREE.MathUtils.lerp(62, 34, t), lift(8.0, 14.0)],
    ];
}

/**
 * Contoured banks on both sides of the channel, replacing the former flat
 * `ShapeGeometry` plate. The plate rendered as one large untextured value block
 * across the bottom fifth of frame; real elevation gives the shoreline a
 * silhouette and lets the fog separate near from far.
 */
/**
 * Height of the bank at `outward` units inland from the waterline, for the
 * shoreline position `t`. Exported so shoreline dressing plants on the ground
 * the terrain actually builds instead of a flat guess, which left grass tufts
 * hovering above the bank near the water and buried further inland.
 *
 * @param {number} t shoreline parameter, 0 (near) .. 1 (far)
 * @param {number} outward distance inland from the waterline, world units
 * @returns {number} world-space Y of the bank surface
 */
export function bankHeightAt(t, outward) {
    const section = bankSection(t);
    if (outward <= section[0][0]) return section[0][1];
    for (let index = 0; index < section.length - 1; index += 1) {
        const [innerOut, innerY] = section[index];
        const [outerOut, outerY] = section[index + 1];
        if (outward <= outerOut) {
            const span = Math.max(1e-5, outerOut - innerOut);
            return THREE.MathUtils.lerp(innerY, outerY, (outward - innerOut) / span);
        }
    }
    return section[section.length - 1][1];
}

function makeTerrainGeometry() {
    const rows = 64;
    const positions = [];
    const indices = [];
    const bands = bankSection(0).length;

    [-1, 1].forEach((side) => {
        const vertexOffset = positions.length / 3;
        for (let row = 0; row <= rows; row += 1) {
            const t = row / rows;
            const { z, halfWidth, bend } = sampleShore(t);
            const section = bankSection(t);
            const edge = bend + side * halfWidth;
            section.forEach(([outward, height], band) => {
                // Break the ridge lines so the banks never read as extrusions.
                const jitter = Math.sin(row * 0.83 + band * 2.1 + side * 1.7) * (0.35 + band * 0.42);
                const sway = Math.sin(row * 0.41 + band * 1.3) * outward * 0.06;
                positions.push(
                    edge + side * (outward + sway),
                    height + jitter * (band === 0 ? 0.12 : 1),
                    z + Math.cos(row * 0.57 + band) * (band === 0 ? 0 : 1.1),
                );
            });
        }
        for (let row = 0; row < rows; row += 1) {
            for (let band = 0; band < bands - 1; band += 1) {
                const a = vertexOffset + row * bands + band;
                const b = a + 1;
                const c = a + bands;
                const d = c + 1;
                if (side < 0) indices.push(a, b, c, b, d, c);
                else indices.push(a, c, b, b, c, d);
            }
        }
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
}

/**
 * A narrow damp strip hugging the waterline. It reads as wet mud that anchors
 * the water to the bank; it is deliberately darker than the bank so it never
 * becomes the bright outlining rim that betrayed the old closed pond.
 */
function makeLakeCollarGeometry(scale = 1.075) {
    const rows = 64;
    const width = Math.max(0.4, (scale - 1) * 26 + 1.1);
    const positions = [];
    const indices = [];

    [-1, 1].forEach((side) => {
        const vertexOffset = positions.length / 3;
        for (let row = 0; row <= rows; row += 1) {
            const t = row / rows;
            const { z, halfWidth, bend } = sampleShore(t);
            const edge = bend + side * halfWidth;
            const band = width * THREE.MathUtils.lerp(1.4, 0.45, t);
            positions.push(edge - side * band * 0.5, 0, z);
            positions.push(edge + side * band, 0, z);
        }
        for (let row = 0; row < rows; row += 1) {
            const a = vertexOffset + row * 2;
            const b = a + 1;
            const c = a + 2;
            const d = a + 3;
            if (side < 0) indices.push(a, b, c, b, d, c);
            else indices.push(a, c, b, b, c, d);
        }
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
}

function includeInReflection(object) {
    object.traverse((child) => child.layers.enable(REFLECTION_LAYER));
    return object;
}

function setInstances(mesh, entries) {
    const object = new THREE.Object3D();
    entries.forEach(([x, y, z, sx, sy, sz, yaw = 0], index) => {
        object.position.set(x, y, z);
        object.scale.set(sx, sy, sz);
        object.rotation.set(0, yaw, 0);
        object.updateMatrix();
        mesh.setMatrixAt(index, object.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
}

function rendererCounters(renderer) {
    const render = renderer.info?.render || {};
    const memory = renderer.info?.memory || {};
    return {
        drawCalls: render.drawCalls ?? render.calls ?? 0,
        triangles: render.triangles ?? 0,
        geometries: memory.geometries ?? 0,
        textures: memory.textures ?? 0,
        programs: renderer.info?.programs ? renderer.info.programs.length : null,
    };
}

export function createStillwaterWater({
    scene, camera, renderer, params, includeLights = true,
}) {
    const qualityProfile = readQuality(params);
    const qualityName = qualityProfile.name;
    const leanTier = qualityName === 'Minimal' || qualityName === 'Low';
    const premiumFlow = qualityProfile.bloom === true;
    // The periodic four-wake formulation preserves the same converging-row
    // composition at every tier while avoiding four full-lake response branches
    // in each vertex/fragment evaluation. Premium tiers spend their budget on
    // reflection, bloom, and richer flow instead of duplicating this equation.
    const leanResponseGraph = qualityProfile.wakeSlots > 0;
    let flowModel = 'layered-analytic-sine';
    if (premiumFlow) {
        flowModel = qualityProfile.noiseOctaves <= 2
            ? 'materialx-broad-analytic-warp'
            : 'materialx-domain-warp';
    }
    const quality = {
        detailFlow: qualityProfile.detailFlow,
        secondCaustic: qualityProfile.secondCaustic,
        reflectorScale: readReflectScale(params, qualityProfile.reflectionScale),
        responseSlots: Math.max(4, qualityProfile.wakeSlots),
        lakeRings: qualityProfile.waterRings,
    };
    const reflectionRequest = readReflectionRequest(params);
    const gradeMode = readGrade(params);
    let reflectionMode = 'off';
    if (reflectionRequest !== 'off') {
        reflectionMode = quality.reflectorScale > 0 ? 'reflector' : 'analytic';
    }
    const boardGuideEnabled = readToggle(params, 'boardGuide', false);
    const layout = params?.get?.('layout') || 'solo';
    const responsesEnabled = qualityProfile.wakeSlots > 0
        && readToggle(params, 'responses', true);
    const proxiesEnabled = readToggle(params, 'proxies', true);
    const postEnabled = readToggle(params, 'post', true);
    const responseEvent = readResponseEvent(params);
    const responsePreset = RESPONSE_PRESETS[responseEvent];
    const captureTime = readFiniteParam(params, 't', 0, 0, 10_000);
    const responseAge = readFiniteParam(params, 'fxAge', responsePreset.age, 0, 10);
    const responseCenterX = readFiniteParam(params, 'fxX', responsePreset.x, -30, 30);
    const responseCenterZ = readFiniteParam(params, 'fxZ', responsePreset.z, -42, 12);

    const root = new THREE.Group();
    root.name = 'stillwater-water-wave3';
    scene.add(root);

    const geometries = new Set();
    const materials = new Set();
    const ownGeometry = (geometry) => { geometries.add(geometry); return geometry; };
    const ownMaterial = (material) => { materials.add(material); return material; };
    const add = (object) => { root.add(object); return object; };

    const previous = {
        background: scene.background,
        fog: scene.fog,
        fov: camera.fov,
        near: camera.near,
        far: camera.far,
        position: camera.position.clone(),
        quaternion: camera.quaternion.clone(),
    };

    scene.background = new THREE.Color(0x020907);
    scene.fog = new THREE.FogExp2(0x0b211d, 0.0085);

    const uTime = uniform(0);
    // The scene is almost entirely unlit node materials, so the spirit's real
    // PointLight contributes nothing to banks or water. This uniform carries its
    // world position and energy so surfaces can fake the practical light spill
    // the concept art is built around. xyz = world position, w = energy.
    const uSpiritGlow = uniform(new THREE.Vector4(-18.4, 5.2, -20.5, 1));
    // The troll's hung lantern. Amber against the scene's teal is the whole
    // colour idea of the concept art, and it needs a discrete source.
    const uLanternGlow = uniform(new THREE.Vector4(19.4, 2.05, -17.4, 1));
    const SPIRIT_WARM = vec3(1.0, 0.855, 0.60);
    const LANTERN_AMBER = vec3(1.0, 0.60, 0.235);

    /** Ground-hugging pool of practical light, flattened in Y so it spreads. */
    function practicalPoolAt(source, radius, exponent) {
        const delta = positionWorld.sub(source.xyz);
        const distance = length(vec3(delta.x, delta.y.mul(0.55), delta.z));
        return pow(smoothstep(0, radius, distance).oneMinus(), exponent)
            .mul(source.w);
    }

    /** Long reflected column of a practical, stretched along the view axis. */
    function practicalColumnAt(source, radius, squash, exponent) {
        const delta = positionWorld.sub(source.xyz);
        return pow(
            smoothstep(0, radius, length(vec2(delta.x, delta.z.mul(squash)))).oneMinus(),
            exponent,
        ).mul(source.w);
    }
    let currentTime = 0;
    const responseState = responsesEnabled
        ? createStillwaterWaterResponseState({ capacity: quality.responseSlots })
        : null;
    const responseBindings = responseState?.bindings || null;
    const uResponseState = responseBindings
        ? uniformArray(responseBindings.stateValues, 'vec4')
        : null;
    const uResponseShape = responseBindings
        ? uniformArray(responseBindings.shapeValues, 'vec4')
        : null;
    const uResponseActivity = responseBindings ? uniform(0) : null;
    const uResponseMode = responseBindings
        ? uniform(STILLWATER_RESPONSE_KIND.idle)
        : null;
    const syncResponseActivity = (time = currentTime) => {
        if (!responseState || !uResponseActivity || !uResponseMode) {
            return STILLWATER_RESPONSE_KIND.idle;
        }
        const activeMode = responseState.getActiveMode(time);
        uResponseMode.value = activeMode;
        uResponseActivity.value = activeMode === STILLWATER_RESPONSE_KIND.idle ? 0 : 1;
        return activeMode;
    };

    if (responseState && responseEvent !== 'idle') {
        responseState.triggerReaction(responseEvent, {
            time: Math.max(0.0001, captureTime - responseAge),
            x: responseCenterX,
            z: responseCenterZ,
        });
    }
    syncResponseActivity();

    // A graded sky dome gives both the main camera and the reflector a coherent
    // moon-cyan horizon without an HDR asset or a second material path.
    const skyMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial());
    const skyDirection = normalize(positionLocal);
    const skyHeight = smoothstep(-0.08, 0.68, skyDirection.y);
    const horizonBand = smoothstep(0.02, 0.34, abs(skyDirection.y)).oneMinus();
    skyMaterial.colorNode = mix(
        vec3(0.018, 0.055, 0.050),
        vec3(0.001, 0.006, 0.006),
        skyHeight,
    ).add(vec3(0.07, 0.15, 0.15).mul(horizonBand.mul(0.12)));
    skyMaterial.side = THREE.BackSide;
    skyMaterial.depthWrite = false;
    skyMaterial.fog = false;
    const sky = includeInReflection(add(new THREE.Mesh(
        ownGeometry(new THREE.SphereGeometry(260, 40, 20)),
        skyMaterial,
    )));
    sky.frustumCulled = false;

    const moonMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial());
    const moonRadius = length(uv().sub(vec2(0.5))).mul(2);
    const moonGrain = materialXNoiseVec3(positionWorld.mul(0.72), 0.48)
        .x
        .mul(0.5)
        .add(0.5);
    const moonLimb = smoothstep(0.56, 1, moonRadius);
    moonMaterial.colorNode = mix(
        vec3(0.92, 0.80, 0.58),
        vec3(0.60, 0.82, 0.78),
        moonGrain.mul(0.34).add(moonLimb.mul(0.22)),
    // The moon reads as the light SOURCE; the spirit has to read as the
    // subject. With both at the top of the range the eye had two equal poles and
    // settled on neither. Ceding the very top of the value range to her costs
    // the moon nothing — it is still the brightest thing in the sky, and its
    // lane on the water is a separate specular term that is untouched.
    ).mul(mix(float(0.98), float(0.62), moonLimb));
    moonMaterial.depthWrite = false;
    moonMaterial.depthTest = false;
    moonMaterial.fog = false;
    const moon = add(new THREE.Mesh(
        ownGeometry(new THREE.CircleGeometry(3.45, 64)),
        moonMaterial,
    ));
    moon.position.set(MOON_WORLD.x, MOON_WORLD.y, MOON_WORLD.z);
    moon.lookAt(0, 14.5, 39);
    moon.renderOrder = 2;

    let moonHalo = null;
    if (!leanTier) {
        const moonHaloMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial());
        const haloRadius = length(uv().sub(vec2(0.5))).mul(2);
        moonHaloMaterial.colorNode = vec3(0.32, 0.68, 0.62);
        moonHaloMaterial.opacityNode = smoothstep(0.08, 1, haloRadius)
            .oneMinus()
            .pow(2.25)
            .mul(0.13);
        moonHaloMaterial.transparent = true;
        moonHaloMaterial.depthWrite = false;
        moonHaloMaterial.depthTest = false;
        moonHaloMaterial.blending = THREE.AdditiveBlending;
        moonHaloMaterial.fog = false;
        moonHalo = add(new THREE.Mesh(
            ownGeometry(new THREE.CircleGeometry(6.8, 64)),
            moonHaloMaterial,
        ));
        moonHalo.position.copy(moon.position);
        moonHalo.position.z -= 0.18;
        moonHalo.quaternion.copy(moon.quaternion);
        moonHalo.renderOrder = 1;
    }

    // Terrain and a low moss collar make shore-depth readable without adding a
    // second transparent shell. The lake bed receives restrained MaterialX veins.
    const groundMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial());
    const groundGrain = materialXNoiseVec3(positionWorld.mul(0.085), 0.5).x.mul(0.5).add(0.5);
    // Aerial perspective lives in the bank material itself: near banks stay a
    // near-black mossy teal so they read as repoussoir, far banks lift toward
    // the pale blue-grey mist band that the height fog finishes.
    const groundDepth = smoothstep(-150, 10, positionWorld.z);
    // Orientation-independent: flat ground catches the moon, steep faces fall
    // away. Using |n.y| keeps the read correct on a double-sided bank shell.
    const groundLit = clamp(abs(normalWorld.y), 0, 1);
    // The near bank must sit far below the water in value or the picture reads
    // as a canal cut through a lit lawn. Only the far bank lifts, into mist.
    const groundNear = mix(vec3(0.001, 0.004, 0.003), vec3(0.007, 0.018, 0.012), groundGrain);
    const groundFar = vec3(0.088, 0.150, 0.156);
    // A second, tighter grain band plus a damp moss skirt at the waterline keep
    // the banks from reading as one smooth gradient ramp.
    // Multi-scale detail. One frequency reads as a single repeating pattern; three
    // octaves at different scales read as ground.
    const groundDetail = materialXNoiseVec3(positionWorld.mul(0.42), 0.5).y.mul(0.5).add(0.5);
    const groundFine = materialXNoiseVec3(positionWorld.mul(1.7), 0.5).z.mul(0.5).add(0.5);
    const groundCoarse = materialXNoiseVec3(positionWorld.mul(0.11), 0.5).x.mul(0.5).add(0.5);
    // Moss by SLOPE, not by world height. The previous term was a height band,
    // which is a horizontal contour crossing the bank's geometry bands — that is
    // the shading seam, and no amount of softening fixes a mask whose domain is
    // wrong. Slope is a property of the surface, so it cannot cross it.
    const groundSlope = clamp(abs(normalWorld.y), 0, 1);
    const mossSkirt = smoothstep(0.62, 0.97, groundSlope)
        .mul(mix(float(0.55), float(1.25), groundCoarse));
    groundMaterial.colorNode = mix(groundFar, groundNear, groundDepth)
        .mul(mix(float(0.55), float(1.05), groundLit))
        .mul(mix(float(0.78), float(1.20), groundDetail))
        .mul(mix(float(0.88), float(1.10), groundFine))
        .add(vec3(0.005, 0.013, 0.008).mul(mossSkirt.mul(groundDepth)))
        // Warm practical spill: the moss and roots around the spirit are lit by
        // it, which is what makes the figure read as a light source rather than
        // a bright sticker pasted on the bank.
        .add(SPIRIT_WARM.mul(practicalPoolAt(uSpiritGlow, 13, 3.2).mul(0.11)))
        .add(LANTERN_AMBER.mul(practicalPoolAt(uLanternGlow, 11, 3.0).mul(0.16)));
    // Banks are a shell, not a closed solid: double-siding removes any winding
    // risk that would leave one shore invisible except for edge-on slivers.
    groundMaterial.side = THREE.DoubleSide;
    const ground = add(new THREE.Mesh(
        ownGeometry(makeTerrainGeometry()),
        groundMaterial,
    ));
    // The bank section already carries its own elevation from -0.35 upward, so
    // it only needs to sit fractionally under the waterline.
    ground.position.set(0, -0.05, 0);

    const lakeGeometry = ownGeometry(makeLakeGeometry(quality.lakeRings));
    const collarMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial());
    const collarGrain = materialXNoiseVec3(positionWorld.mul(0.22), 0.58).x.mul(0.5).add(0.5);
    collarMaterial.side = THREE.DoubleSide;
    collarMaterial.colorNode = mix(vec3(0.006, 0.022, 0.014), vec3(0.022, 0.055, 0.028), collarGrain);
    const collar = add(new THREE.Mesh(ownGeometry(makeLakeCollarGeometry(1.018)), collarMaterial));
    collar.position.y = -0.06;
    collar.visible = !leanTier;

    const bedMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial());
    const bedPosition = positionWorld.xz;
    const causticA = materialXWorley(vec3(bedPosition.mul(0.105), uTime.mul(0.030)), 0.78)
        .oneMinus().pow(5.0);
    let caustics = causticA;
    if (quality.secondCaustic) {
        const causticB = materialXWorley(
            vec3(bedPosition.mul(0.16).add(vec2(7.2, -3.4)), uTime.mul(-0.024)),
            0.68,
        ).oneMinus().pow(6.0);
        caustics = causticA.mul(0.72).add(causticB.mul(0.38));
    }
    const bedDepth = smoothstep(0.22, 0.93, abs(attribute('aCross', 'float'))).oneMinus();
    const bedBase = mix(vec3(0.035, 0.082, 0.052), vec3(0.003, 0.018, 0.017), bedDepth);
    bedMaterial.colorNode = bedBase.add(vec3(0.23, 0.44, 0.25).mul(caustics.mul(0.38)));
    const bed = add(new THREE.Mesh(lakeGeometry, bedMaterial));
    bed.position.y = -1.05;

    // Submerged stones remain real silhouettes under the transparent water.
    const stoneLayout = [
        [-19, -0.48, 1, 2.7, 0.82, 1.8, 0.2], [-15, -0.58, -3, 1.8, 0.68, 1.2, -0.4],
        [18, -0.52, -9, 2.2, 0.76, 1.5, 0.6], [21, -0.62, -15, 1.4, 0.58, 1.0, -0.2],
        [-10, -0.68, -33, 1.8, 0.64, 1.3, 0.3],
    ];
    let stones = null;
    if (!leanTier) {
        const stoneGeometry = ownGeometry(new THREE.IcosahedronGeometry(1, 1));
        const stoneMaterial = ownMaterial(new THREE.MeshStandardNodeMaterial());
        const stoneLift = normalWorld.y.mul(0.5).add(0.5);
        stoneMaterial.colorNode = mix(
            vec3(0.030, 0.052, 0.045),
            vec3(0.12, 0.18, 0.13),
            stoneLift,
        );
        stoneMaterial.roughnessNode = float(0.92);
        stones = add(new THREE.InstancedMesh(
            stoneGeometry,
            stoneMaterial,
            stoneLayout.length,
        ));
        setInstances(stones, stoneLayout);
    }

    // Wave 2/3 keeps compact story proxies for its isolated comparison contract.
    // The integrated masterpiece disables them and mounts the screenshot-proven
    // forest and character builders on the same reflection layer.
    let troll = null;
    let spirit = null;
    if (proxiesEnabled) {
        const treeEntries = [
            [-31, 7, -29, 1.5, 13, 1.5, 0.1], [-25, 8, -39, 1.8, 16, 1.8, -0.2],
            [-15, 7, -46, 1.6, 14, 1.6, 0.3], [19, 8, -45, 1.7, 16, 1.7, -0.1],
            [28, 7, -37, 1.5, 14, 1.5, 0.2], [33, 6, -25, 1.3, 12, 1.3, -0.3],
        ];
        const trunkMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial({ color: 0x16362d }));
        const trunks = includeInReflection(add(new THREE.InstancedMesh(
            ownGeometry(new THREE.CylinderGeometry(0.55, 0.85, 2, 7)),
            trunkMaterial,
            treeEntries.length,
        )));
        setInstances(trunks, treeEntries);

        const canopyMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial({ color: 0x103128 }));
        const canopyEntries = treeEntries.map(([x, y, z, sx, sy, sz, yaw]) => [
            x, y + sy + 3.5, z, sx * 4.2, sy * 0.34, sz * 3.8, yaw,
        ]);
        const canopies = includeInReflection(add(new THREE.InstancedMesh(
            ownGeometry(new THREE.IcosahedronGeometry(1, 1)),
            canopyMaterial,
            canopyEntries.length,
        )));
        setInstances(canopies, canopyEntries);

        const rootMaterial = ownMaterial(new THREE.MeshStandardNodeMaterial({
            color: 0x24392c,
            roughness: 0.94,
        }));
        const shoreRoot = add(new THREE.Mesh(
            ownGeometry(new THREE.CylinderGeometry(0.48, 0.86, 8.5, 10)),
            rootMaterial,
        ));
        shoreRoot.position.set(-20, 0.12, -1);
        shoreRoot.rotation.z = Math.PI * 0.48;
        shoreRoot.rotation.y = -0.22;

        const lilyMaterial = ownMaterial(new THREE.MeshStandardNodeMaterial({
            color: 0x315b35,
            roughness: 0.82,
        }));
        const lilyLayout = [
            [13, 0.13, -5, 1.8, 0.10, 1.35, 0.2],
            [16, 0.12, -8, 1.25, 0.09, 0.95, -0.5],
            [-13, 0.12, -19, 1.4, 0.09, 1.05, 0.7],
        ];
        const lilies = add(new THREE.InstancedMesh(
            ownGeometry(new THREE.CylinderGeometry(1, 1.05, 1, 24)),
            lilyMaterial,
            lilyLayout.length,
        ));
        setInstances(lilies, lilyLayout);

        troll = new THREE.Group();
        troll.name = 'troll-reflection-proxy';
        const trollMaterial = ownMaterial(new THREE.MeshStandardNodeMaterial());
        const trollFacing = clamp(
            dot(normalize(normalWorld), normalize(vec3(-0.3, 0.55, 0.76))),
            0,
            1,
        );
        trollMaterial.colorNode = vec3(0.055, 0.080, 0.050)
            .add(vec3(0.095, 0.125, 0.070).mul(trollFacing.mul(0.62)));
        trollMaterial.roughnessNode = float(0.96);
        const trollBody = new THREE.Mesh(
            ownGeometry(new THREE.SphereGeometry(2.2, 18, 12)),
            trollMaterial,
        );
        trollBody.scale.set(1.0, 1.35, 0.72);
        const trollHead = new THREE.Mesh(
            ownGeometry(new THREE.SphereGeometry(1.35, 16, 10)),
            trollMaterial,
        );
        trollHead.position.set(-0.45, 3.2, 0);
        const eyeMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial());
        eyeMaterial.colorNode = vec3(0.95, 0.25, 0.035).mul(1.15);
        const trollEyes = new THREE.InstancedMesh(
            ownGeometry(new THREE.SphereGeometry(0.12, 10, 7)),
            eyeMaterial,
            2,
        );
        setInstances(trollEyes, [
            [-0.88, 3.35, 1.15, 1, 1, 1],
            [-0.06, 3.35, 1.15, 1, 1, 1],
        ]);
        troll.add(trollBody, trollHead, trollEyes);
        troll.position.set(18.5, 2.25, -19);
        troll.rotation.y = -0.48;
        includeInReflection(trollBody);
        includeInReflection(trollHead);
        add(troll);

        spirit = new THREE.Group();
        spirit.name = 'spirit-reflection-proxy';
        const spiritMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial());
        const spiritPulse = sin(uTime.mul(0.72)).mul(0.5).add(0.5);
        spiritMaterial.colorNode = mix(
            vec3(0.25, 0.42, 0.30),
            vec3(0.90, 0.38, 0.05),
            spiritPulse,
        ).mul(0.88);
        const spiritBody = new THREE.Mesh(
            ownGeometry(new THREE.SphereGeometry(1.4, 24, 16)),
            spiritMaterial,
        );
        spiritBody.scale.set(0.78, 1.48, 0.68);
        const spiritTail = new THREE.Mesh(
            ownGeometry(new THREE.ConeGeometry(0.78, 3.0, 18)),
            spiritMaterial,
        );
        spiritTail.position.y = -2.1;
        spirit.add(spiritBody, spiritTail);
        spirit.position.set(-18, 5.1, -20);
        includeInReflection(spiritBody);
        add(spirit);
    }

    let hemisphere = null;
    let moonKey = null;
    if (includeLights) {
        hemisphere = includeInReflection(add(
            new THREE.HemisphereLight(0x9ccfd0, 0x071713, 1.05),
        ));
        moonKey = includeInReflection(add(
            new THREE.DirectionalLight(0xbfe4df, 1.45),
        ));
        moonKey.position.set(-18, 32, 16);
        hemisphere.name = 'stillwater-hemi';
        moonKey.name = 'stillwater-moon-key';
    }

    /**
     * One graph serves vertex displacement, optical slope, and crest light. The
     * expensive Tetris/T-spin language is evaluated once from reserved slot 0;
     * remaining slots contain only the quiet lock-dimple equation.
     */
    const makeResponseTerms = (samplePosition, includeHeight, sharedGates = null) => {
        let localCalm = sharedGates?.localCalm || null;
        let shoreGate = sharedGates?.shoreGate || null;
        if (!localCalm) {
            const boardDistance = length(vec2(
                samplePosition.x.sub(BOARD_WATER_CENTER.x).div(10.5),
                samplePosition.y.sub(BOARD_WATER_CENTER.z).div(14.5),
            ));
            localCalm = smoothstep(0.72, 1.16, boardDistance).oneMinus();
        }
        if (!shoreGate) {
            const centerDrift = sin(samplePosition.y.add(13).mul(0.11)).mul(2.8);
            const lakeRadius = length(vec2(
                samplePosition.x.sub(centerDrift).div(29),
                samplePosition.y.add(13).div(27),
            ));
            shoreGate = smoothstep(0.025, 0.17, float(1).sub(lakeRadius));
        }

        const height = float(0).toVar();
        const slope = vec2(0).toVar();
        const ivory = float(0).toVar();
        const cyan = float(0).toVar();
        const violet = float(0).toVar();

        const addRoutineResponse = () => {
            for (let index = 1; index < quality.responseSlots; index += 1) {
                const state = uResponseState.element(index);
                If(state.w.equal(STILLWATER_RESPONSE_KIND.lock), () => {
                    const shape = uResponseShape.element(index);
                    const age = uTime.sub(state.z);
                    const lifeRemaining = shape.y.sub(age);
                    const alive = smoothstep(0, 0.045, age)
                        .mul(smoothstep(0, 0.15, lifeRemaining));

                    If(alive.greaterThan(0), () => {
                        const progress = clamp(age.div(max(shape.y, 0.001)), 0, 1);
                        const delta = samplePosition.sub(state.xy);
                        const radius = max(length(delta), 0.001);
                        const radial = delta.div(radius);
                        const ringRadius = float(0.22)
                            .add(progress.mul(5.8).mul(shape.z));
                        const ringDelta = radius.sub(ringRadius);
                        const ring = smoothstep(
                            0.12,
                            0.72,
                            abs(ringDelta),
                        ).oneMinus();
                        const signedEdge = clamp(ringDelta.div(0.58), -1, 1);
                        const centerGate = float(1).sub(localCalm.mul(0.82));
                        const energy = alive
                            .mul(shape.x)
                            .mul(shoreGate)
                            .mul(centerGate);

                        if (includeHeight) {
                            height.addAssign(
                                cos(ringDelta.mul(4.6))
                                    .mul(ring)
                                    .mul(energy)
                                    .mul(0.085),
                            );
                        }
                        slope.addAssign(
                            radial.mul(
                                signedEdge.mul(ring).mul(energy).mul(0.072),
                            ),
                        );
                        ivory.addAssign(ring.mul(energy));
                    });
                });
            }
        };

        const specialState = uResponseState.element(0);
        const specialShape = uResponseShape.element(0);
        const specialAge = uTime.sub(specialState.z);
        const specialRemaining = specialShape.y.sub(specialAge);
        const specialAlive = smoothstep(0, 0.055, specialAge)
            .mul(smoothstep(0, 0.20, specialRemaining));
        const specialProgress = clamp(
            specialAge.div(max(specialShape.y, 0.001)),
            0,
            1,
        );
        const specialGate = shoreGate.mul(float(1).sub(localCalm.mul(0.62)));

        const addTetrisResponse = () => {
            If(specialAlive.greaterThan(0), () => {
                // The Lake Opens: four row/depth wakes migrate toward the shared
                // center, then resolve into one slow mirror swell.
                const rowHeight = includeHeight ? float(0).toVar() : null;
                const rowSlope = float(0).toVar();
                const rowLight = float(0).toVar();
                // One lake-scale bend and filament field serve all four wakes.
                const sharedBend = sin(
                    samplePosition.x.mul(0.29)
                        .add(specialAge.mul(0.82)),
                ).mul(0.54);
                const sharedBreakup = sin(
                    samplePosition.x.mul(1.14)
                        .sub(specialAge.mul(0.94)),
                ).mul(0.5).add(0.5);
                const convergence = smoothstep(0, 0.72, specialProgress);
                if (leanResponseGraph) {
                    // All response-enabled tiers encode four converging rows as one periodic
                    // signed-distance field. This retains the four ivory
                    // filaments while replacing four full-lake band/lateral
                    // evaluations with one construction-time-selected graph.
                    const contraction = float(1).sub(specialProgress.mul(0.86));
                    const rowSpacing = max(
                        float(TETRIS_DEPTH_WAKE_SPACING).mul(contraction),
                        float(0.42),
                    );
                    const preBendDelta = samplePosition.y.sub(specialState.y);
                    const rowSide = smoothstep(-0.02, 0.02, preBendDelta)
                        .mul(2)
                        .sub(1);
                    const rowDelta = preBendDelta.sub(
                        sharedBend.mul(rowSide).mul(contraction),
                    );
                    const rowCoordinate = rowDelta.div(rowSpacing);
                    const periodicWake = abs(sin(rowCoordinate.mul(Math.PI)));
                    const rowEnvelope = smoothstep(
                        rowSpacing.mul(TETRIS_DEPTH_WAKE_HALF_EXTENT
                            / TETRIS_DEPTH_WAKE_SPACING),
                        rowSpacing.mul(
                            (TETRIS_DEPTH_WAKE_HALF_EXTENT
                                / TETRIS_DEPTH_WAKE_SPACING) + 0.52,
                        ),
                        abs(rowDelta),
                    ).oneMinus();
                    const wakeHalfWidth = mix(float(6.4), float(11.8), convergence);
                    const wakeCenterX = mix(
                        specialState.x.add(rowSide.mul(8.5)),
                        specialState.x,
                        convergence,
                    );
                    const lateral = smoothstep(
                        wakeHalfWidth.mul(0.58),
                        wakeHalfWidth,
                        abs(samplePosition.x.sub(wakeCenterX)),
                    ).oneMinus();
                    const rowParity = sin(rowCoordinate.mul(Math.PI))
                        .mul(0.5)
                        .add(0.5);
                    const rowPhase = mix(
                        sharedBreakup.oneMinus(),
                        sharedBreakup,
                        rowParity,
                    );
                    const filament = smoothstep(0.12, 0.82, rowPhase)
                        .mul(0.48)
                        .add(0.48);
                    const band = smoothstep(0.68, 0.96, periodicWake)
                        .mul(rowEnvelope)
                        .mul(lateral)
                        .mul(filament);
                    if (includeHeight) {
                        rowHeight.assign(
                            cos(rowCoordinate.mul(Math.PI * 2)).mul(band),
                        );
                    }
                    rowSlope.assign(
                        sin(rowCoordinate.mul(Math.PI * 2)).mul(band),
                    );
                    rowLight.assign(band);
                } else {
                    TETRIS_DEPTH_WAKE_OFFSETS.forEach((rowOffset) => {
                        const shoreSide = rowOffset < 0 ? -1 : 1;
                        const convergedOffset = float(rowOffset)
                            .mul(float(1).sub(specialProgress.mul(0.86)));
                        const rowZ = specialState.y
                            .add(convergedOffset.mul(specialShape.z));
                        const wakeCenterX = mix(
                            specialState.x.add(shoreSide * 8.5),
                            specialState.x,
                            convergence,
                        );
                        const wakeHalfWidth = mix(float(5.6), float(11.8), convergence);
                        const rowPhase = rowOffset === -4.5 || rowOffset === 1.5
                            ? sharedBreakup
                            : sharedBreakup.oneMinus();
                        const bend = sharedBend
                            .mul(shoreSide)
                            .add(rowOffset * 0.035);
                        const rowDelta = samplePosition.y.sub(rowZ.add(bend));
                        const rowBand = smoothstep(
                            0.12,
                            0.72,
                            abs(rowDelta),
                        ).oneMinus();
                        const lateral = smoothstep(
                            wakeHalfWidth.mul(0.58),
                            wakeHalfWidth,
                            abs(samplePosition.x.sub(wakeCenterX)),
                        ).oneMinus();
                        const filament = smoothstep(0.12, 0.82, rowPhase)
                            .mul(0.52)
                            .add(0.42);
                        const band = rowBand.mul(lateral).mul(filament);
                        if (includeHeight) {
                            rowHeight.addAssign(cos(rowDelta.mul(3.9)).mul(band));
                        }
                        rowSlope.addAssign(
                            clamp(rowDelta.div(0.62), -1, 1).mul(band),
                        );
                        rowLight.addAssign(band);
                    });
                }

                const specialDelta = samplePosition.sub(specialState.xy);
                const specialRadius = max(length(specialDelta), 0.001);
                const specialRadial = specialDelta.div(specialRadius);
                const tetrisEnergy = specialAlive
                    .mul(specialShape.x)
                    .mul(specialGate);
                const mirrorArrival = smoothstep(0.30, 0.62, specialProgress);
                const mirrorDisk = smoothstep(1.1, 8.8, specialRadius).oneMinus();
                const mirrorPulse = sin(
                    clamp(
                        specialProgress.sub(0.20).div(0.80),
                        0,
                        1,
                    ).mul(Math.PI),
                );
                const mirrorEdge = smoothstep(
                    0.4,
                    1.5,
                    abs(specialRadius.sub(
                        mix(float(1.2), float(7.8), specialProgress),
                    )),
                ).oneMinus();

                if (includeHeight) {
                    height.addAssign(
                        clamp(rowHeight, -2, 2).mul(tetrisEnergy).mul(0.105)
                            .add(
                                mirrorDisk
                                    .mul(mirrorPulse)
                                    .mul(mirrorArrival)
                                    .mul(tetrisEnergy)
                                    .mul(0.12),
                            ),
                    );
                }
                slope.addAssign(vec2(
                    specialRadial.x.mul(mirrorEdge).mul(mirrorArrival).mul(0.075),
                    clamp(rowSlope, -2, 2).mul(0.085)
                        .add(
                            specialRadial.y
                                .mul(mirrorEdge)
                                .mul(mirrorArrival)
                                .mul(0.075),
                        ),
                ).mul(tetrisEnergy));
                ivory.addAssign(
                    clamp(rowLight, 0, 1.8).mul(tetrisEnergy).mul(0.78),
                );
                cyan.addAssign(
                    mirrorDisk
                        .mul(mirrorPulse)
                        .mul(mirrorArrival)
                        .mul(tetrisEnergy)
                        .mul(0.92),
                );
            });
        };

        // Näck's Turn: two opposing rotating directions curve with radius. This
        // produces paired spiral arms without fragment atan and contracts inward.
        const addTspinResponse = () => {
            If(specialAlive.greaterThan(0), () => {
                const specialDelta = samplePosition.sub(specialState.xy);
                const specialRadius = max(length(specialDelta), 0.001);
                const specialRadial = specialDelta.div(specialRadius);
                const tspinEnergy = specialAlive
                    .mul(specialShape.x)
                    .mul(specialGate);
                const phaseA = specialAge.mul(3.8).add(specialRadius.mul(0.72));
                const phaseB = specialAge.mul(-3.35)
                    .sub(specialRadius.mul(0.64))
                    .add(Math.PI);
                const directionA = vec2(cos(phaseA), sin(phaseA));
                const directionB = vec2(cos(phaseB), sin(phaseB));
                const armA = pow(max(dot(specialRadial, directionA), 0), 11);
                const armB = pow(max(dot(specialRadial, directionB), 0), 11);
                const spinWindow = smoothstep(0.45, 1.6, specialRadius)
                    .mul(smoothstep(6.2, 10.2, specialRadius).oneMinus());
                const turnRadius = mix(float(8.4), float(1.6), specialProgress);
                const turnRingDelta = specialRadius.sub(turnRadius);
                const turnRing = smoothstep(
                    0.18,
                    0.92,
                    abs(turnRingDelta),
                ).oneMinus();
                const tangent = vec2(specialRadial.y.negate(), specialRadial.x);
                const signedArms = armA.sub(armB).mul(spinWindow);

                if (includeHeight) {
                    height.addAssign(
                        armA
                            .add(armB)
                            .mul(spinWindow)
                            .mul(tspinEnergy)
                            .mul(0.075)
                            .add(
                                cos(turnRingDelta.mul(3.8))
                                    .mul(turnRing)
                                    .mul(tspinEnergy)
                                    .mul(0.14),
                            ),
                    );
                }
                slope.addAssign(
                    tangent
                        .mul(signedArms)
                        .mul(tspinEnergy)
                        .mul(0.105)
                        .add(
                            specialRadial
                                .mul(clamp(turnRingDelta.div(0.72), -1, 1))
                                .mul(turnRing)
                                .mul(tspinEnergy)
                                .mul(0.082),
                        ),
                );
                cyan.addAssign(
                    armA
                        .mul(1.28)
                        .add(turnRing.mul(0.06))
                        .mul(spinWindow)
                        .mul(tspinEnergy),
                );
                violet.addAssign(
                    armB
                        .mul(1.28)
                        .add(turnRing.mul(0.06))
                        .mul(spinWindow)
                        .mul(tspinEnergy),
                );
            });
        };

        If(
            uResponseMode.equal(STILLWATER_RESPONSE_KIND.lock),
            addRoutineResponse,
        ).ElseIf(
            uResponseMode.equal(STILLWATER_RESPONSE_KIND.tetris),
            addTetrisResponse,
        ).ElseIf(
            uResponseMode.equal(STILLWATER_RESPONSE_KIND.tspin),
            addTspinResponse,
        );

        return {
            height: clamp(height, -0.24, 0.24),
            slope: clamp(slope, -0.14, 0.14),
            ivory: clamp(ivory, 0, 1.4),
            cyan: clamp(cyan, 0, 1.3),
            violet: clamp(violet, 0, 1.3),
        };
    };

    const WaterResponseField = struct({
        height: 'float',
        slope: 'vec2',
        ivory: 'float',
        cyan: 'float',
        violet: 'float',
    });

    /**
     * Response activity is frame-uniform. Real TSL control flow keeps the
     * complete Wave 3 language available while skipping every response
     * equation on the overwhelmingly common idle frames.
     */
    const makeOpticalResponseField = Fn(([
        samplePosition,
        sharedLocalCalm,
        sharedShoreGate,
    ]) => {
        const height = float(0).toVar();
        const slope = vec2(0).toVar();
        const ivory = float(0).toVar();
        const cyan = float(0).toVar();
        const violet = float(0).toVar();

        If(uResponseActivity.greaterThan(0), () => {
            const response = makeResponseTerms(samplePosition, false, {
                localCalm: sharedLocalCalm,
                shoreGate: sharedShoreGate,
            });
            slope.assign(response.slope);
            ivory.assign(response.ivory);
            cyan.assign(response.cyan);
            violet.assign(response.violet);
        });

        return WaterResponseField({
            height,
            slope,
            ivory,
            cyan,
            violet,
        });
    });
    // A scalar vertex Fn avoids emitting the fragment response struct into the
    // WebGL2 vertex stage (r181's GLSL backend cannot always order that struct
    // declaration) and keeps displacement work out of the optical shader.
    const makeDisplacementResponseHeight = Fn(([samplePosition]) => {
        const height = float(0).toVar();
        If(uResponseActivity.greaterThan(0), () => {
            const response = makeResponseTerms(samplePosition, true);
            height.assign(response.height);
        });
        return height;
    });

    // The optical normal is consumed directly by Fresnel/reflection distortion:
    // MeshBasicNodeMaterial ignores normalNode in r181. Non-bloom tiers construct
    // a compact layered sine field; High+ retain the premium MaterialX domain warp.
    const waterPosition = positionWorld.xz;
    // Exact cross-channel shore distance from the authored grid, rather than an
    // ellipse fitted to the old closed pond.
    const inward = clamp(float(1).sub(abs(attribute('aCross', 'float'))), 0, 1);
    const shoreDepth = smoothstep(0.012, 0.18, inward);
    const responseShoreGate = smoothstep(0.025, 0.17, inward);
    const shoreBand = smoothstep(0.0, 0.075, inward).oneMinus();

    const boardDistance = length(vec2(
        waterPosition.x.sub(BOARD_WATER_CENTER.x).div(10.5),
        waterPosition.y.sub(BOARD_WATER_CENTER.z).div(14.5),
    ));
    const calmMask = smoothstep(0.72, 1.16, boardDistance).oneMinus();

    let domainWarp;
    let flowField;
    if (premiumFlow) {
        if (qualityProfile.noiseOctaves <= 2) {
            // High keeps a premium MaterialX broad-flow field while using an
            // analytic warp. Ultra/Extreme retain the extra full-surface noise
            // octave; the leaner High graph is materially cheaper on target iGPUs.
            domainWarp = vec2(
                sin(
                    waterPosition.x.mul(0.041)
                        .add(waterPosition.y.mul(0.027))
                        .add(uTime.mul(0.09)),
                ),
                cos(
                    waterPosition.y.mul(0.038)
                        .sub(waterPosition.x.mul(0.023))
                        .sub(uTime.mul(0.07)),
                ),
            ).mul(0.72);
        } else {
            const warpCoord = vec3(waterPosition.mul(0.035), uTime.mul(0.022));
            domainWarp = materialXNoiseVec3(warpCoord, 0.82).xy;
        }
        const broadFlow = materialXNoiseVec3(
            vec3(
                waterPosition.mul(0.072).add(domainWarp.mul(0.68)),
                uTime.mul(-0.036),
            ),
            1.0,
        ).xy;
        flowField = broadFlow;
        if (quality.detailFlow) {
            const detailFlow = materialXNoiseVec3(
                vec3(
                    waterPosition.mul(0.145).sub(domainWarp.mul(0.31)),
                    uTime.mul(0.052),
                ),
                0.46,
            ).xy;
            flowField = broadFlow.mul(0.78).add(detailFlow.mul(0.34));
        }
    } else {
        const flowPhaseA = waterPosition.x.mul(0.115)
            .add(waterPosition.y.mul(0.061))
            .add(uTime.mul(0.22));
        const flowPhaseB = waterPosition.y.mul(0.103)
            .sub(waterPosition.x.mul(0.047))
            .sub(uTime.mul(0.17));
        const crossPhase = waterPosition.x.add(waterPosition.y)
            .mul(0.043)
            .add(uTime.mul(0.08));
        const counterPhase = waterPosition.x.sub(waterPosition.y)
            .mul(0.057)
            .sub(uTime.mul(0.11));
        const flowA = sin(flowPhaseA);
        const flowB = cos(flowPhaseB);
        const crossFlow = sin(crossPhase);
        const counterFlow = cos(counterPhase);
        domainWarp = vec2(
            flowA.add(crossFlow.mul(0.32)),
            flowB.add(counterFlow.mul(0.28)),
        ).mul(0.72);
        flowField = vec2(
            flowA.add(counterFlow.mul(0.24)),
            flowB.add(crossFlow.mul(0.22)),
        ).mul(0.78);
    }
    const fragmentResponse = responseState
        ? makeOpticalResponseField(waterPosition, calmMask, responseShoreGate)
        : null;
    // Distance ramp on the surface detail. Far water must resolve to a single
    // flat value: at range the ripple is below a pixel, so keeping it alive
    // produces shimmer rather than detail — and a flat far plane is also what
    // the Bauer read wants, since every mid-frequency gradient we leave in the
    // distance fights the depth plates.
    const surfaceViewDistance = length(positionWorld.sub(cameraPosition));
    const detailNear = smoothstep(12, 46, surfaceViewDistance).oneMinus();
    const opticalStrength = mix(float(0.125), float(0.014), calmMask)
        .mul(float(0.18).add(detailNear.mul(0.82)));
    const opticalSlope = clamp(
        flowField
            .mul(opticalStrength)
            .add(fragmentResponse?.get('slope') || vec2(0)),
        -0.18,
        0.18,
    );
    const opticalNormal = normalize(vec3(opticalSlope.x, 1, opticalSlope.y));

    const viewDirection = normalize(cameraPosition.sub(positionWorld));
    const nDotV = max(dot(opticalNormal, viewDirection), float(0));
    const fresnel = float(0.0204).add(
        float(0.9796).mul(pow(float(1).sub(nDotV), float(5))),
    );

    const shallowColor = vec3(0.010, 0.070, 0.072);
    const deepColor = vec3(0.004, 0.022, 0.028);
    let waterColor = mix(shallowColor, deepColor, pow(shoreDepth, 0.74));
    const ripplePhaseA = waterPosition.x.mul(1.08)
        .add(waterPosition.y.mul(0.52))
        .add(domainWarp.x.mul(7.2))
        .add(uTime.mul(0.62));
    const ripplePhaseB = waterPosition.y.mul(0.91)
        .sub(waterPosition.x.mul(0.34))
        .add(domainWarp.y.mul(5.6))
        .sub(uTime.mul(0.37));
    const rippleCrests = pow(sin(ripplePhaseA).mul(0.5).add(0.5), float(24))
        .mul(pow(sin(ripplePhaseB).mul(0.5).add(0.5), float(10)).mul(0.90).add(0.05));
    const activeRipple = rippleCrests
        .mul(float(1).sub(calmMask.mul(0.90)))
        .mul(smoothstep(0.08, 0.78, shoreDepth));
    waterColor = waterColor.add(vec3(0.16, 0.36, 0.31).mul(activeRipple.mul(0.17)));

    // Shore-weighted refraction. viewportSharedTexture is r181's screen-colour
    // source; without a depth prepass it can bleed foreground silhouettes, so
    // the offset stays small and the weight decays fast with depth.
    //
    // Premium tiers only. This costs a framebuffer copy and splits the pass, and
    // it was running on all six tiers — including the three that have no
    // reflector at all precisely because their GPUs cannot afford one. It only
    // ever shows in the shallow band at the shoreline, so the lean tiers lose a
    // detail they were never going to be looked at closely for.
    if (qualityProfile.bloom === true) {
        const refractionDepth = clamp(shoreDepth.mul(6), 0, 6);
        const refractionWeight = pow(float(2.718), refractionDepth.mul(-0.9)).mul(0.55);
        const refractionOffset = flowField.mul(0.022).mul(refractionWeight);
        const refracted = viewportSharedTexture(
            screenUV.add(refractionOffset).clamp(vec2(0.002), vec2(0.998)),
        ).rgb;
        waterColor = mix(
            waterColor,
            waterColor.mul(0.55).add(refracted.mul(0.45)),
            refractionWeight,
        );
    }

    // Practical reflections. A still lake returns a light source as a long
    // column stretched along the view axis, broken up by the surface ripple —
    // not as a round blob. Both the spirit and the moon get one, which is the
    // scene's only real warm/cool contrast.
    const spiritColumn = practicalColumnAt(uSpiritGlow, 15, 0.34, 2.8);
    const lanternColumn = practicalColumnAt(uLanternGlow, 13, 0.30, 2.6);
    const moonDelta = positionWorld.xz.sub(vec2(MOON_WORLD.x, MOON_WORLD.z));
    const moonColumn = pow(
        smoothstep(0, 21, length(vec2(moonDelta.x, moonDelta.y.mul(0.20)))).oneMinus(),
        2.3,
    );
    // Physical specular. Two lobes off the moon's half-vector: a broad sheen
    // that models the surface, and a tight sparkle that scintillates on the
    // ripple crests. Fresnel alone gave the lake a flat, matte plastic read.
    const moonDirection = normalize(vec3(MOON_WORLD.x, MOON_WORLD.y + 26, MOON_WORLD.z).sub(positionWorld));
    const halfVector = normalize(viewDirection.add(moonDirection));
    const specularAngle = max(dot(opticalNormal, halfVector), float(0));
    const broadSpecular = pow(specularAngle, float(38));
    const sparkleSpecular = pow(specularAngle, float(150));
    // Detuned high-frequency mask so sparkles pop individually rather than as
    // one continuous sheet.
    const glintBreakup = pow(abs(sin(
        positionWorld.x.mul(0.47)
            .add(positionWorld.z.mul(0.88))
            .sub(uTime.mul(0.29)),
    )), float(9));
    // Constrain the highlight to the moon's reflection lane. On water this calm
    // the optical normal barely varies, so an unmasked half-vector lobe spreads
    // into a broad white sheet across the whole surface instead of a path. The
    // lane is the XZ line from the camera through the mirrored moon.
    const laneDistance = abs(
        positionWorld.x.mul(-125)
            .sub(positionWorld.z.mul(32))
            .add(39 * 32),
    ).div(129.0);
    const moonLane = smoothstep(2.0, 11.5, laneDistance).oneMinus();
    const specularTrack = broadSpecular.mul(0.09)
        .add(sparkleSpecular.mul(glintBreakup.mul(0.85).add(0.15)))
        .mul(smoothstep(0.06, 0.62, shoreDepth))
        .mul(moonLane);
    waterColor = waterColor.add(
        vec3(0.58, 0.76, 0.82).mul(specularTrack.mul(0.085)),
    );

    // Depth extinction: deep water absorbs warm wavelengths first, so the body
    // slides toward blue-green with depth instead of merely getting darker.
    const extinction = mix(
        vec3(1.0, 1.0, 1.0),
        vec3(0.30, 0.78, 0.92),
        pow(shoreDepth, 0.85),
    );
    waterColor = waterColor.mul(extinction);

    // Ripple breakup dominates: a still-lake reflection is a chain of glints,
    // so the flat base term stays low or the column reads as painted haze.
    const columnBreak = float(0.16).add(activeRipple.mul(3.2)).add(fresnel.mul(0.42));
    // Shoreline foam. Two bands: a tight intersection line where the water meets
    // the bank, and a broader swash behind it. Never white — foam at night is a
    // pale sage, and a white line would become a second bright note competing
    // with the spirit.
    const foamNoise = materialXNoiseVec3(vec3(waterPosition.mul(1.6), uTime.mul(0.08)), 0.5)
        .x.mul(0.5).add(0.5);
    const shoreProximity = inward.oneMinus();
    const intersection = smoothstep(0.86, 0.995, shoreProximity);
    const swash = smoothstep(0.62, 0.90, shoreProximity)
        .mul(smoothstep(0.90, 0.995, shoreProximity).oneMinus());
    const foam = intersection.mul(0.55).add(swash.mul(0.30))
        .mul(mix(float(0.45), float(1.0), foamNoise));
    waterColor = waterColor.add(vec3(0.34, 0.42, 0.36).mul(foam.mul(0.42)));

    waterColor = waterColor
        .add(SPIRIT_WARM.mul(spiritColumn.mul(columnBreak).mul(0.30)))
        .add(LANTERN_AMBER.mul(lanternColumn.mul(columnBreak).mul(0.34)))
        .add(vec3(0.62, 0.78, 0.86).mul(moonColumn.mul(columnBreak).mul(0.14)));

    // The former hand-placed lane sat at x=-13 while the moon hangs at x=+32, so
    // it was a bright streak with no light source behind it. The moon path is
    // now derived from the moon's real position above, and this only adds the
    // crest scatter along that same lane.
    waterColor = waterColor.add(
        vec3(0.34, 0.58, 0.52).mul(
            moonLane.mul(rippleCrests).mul(float(1).sub(calmMask.mul(0.82))).mul(0.30),
        ),
    );

    const contactAnchors = [
        [-18, -1, 3.6, 0.44], [13, -5, 2.4, 0.30], [16, -8, 1.9, 0.24],
        [-13, -19, 2.1, 0.24], [18.5, -19, 4.2, 0.48],
    ];
    let contactDarkening = float(0);
    contactAnchors.forEach(([x, z, radius, strength]) => {
        const distance = length(waterPosition.sub(vec2(x, z)));
        contactDarkening = contactDarkening.add(
            smoothstep(0, radius, distance).oneMinus().mul(strength),
        );
    });
    contactDarkening = clamp(contactDarkening, 0, 0.58);
    waterColor = waterColor.mul(float(1).sub(contactDarkening));

    let reflectionNode = null;
    let reflectionDefaultTexture = null;
    let reflectionDefaultDisposeListeners = null;
    if (reflectionMode === 'reflector') {
        reflectionNode = reflector({
            resolutionScale: quality.reflectorScale,
            generateMipmaps: true,
            bounces: false,
            samples: 0,
        });
        // r181's reflector starts from one module-global placeholder texture.
        // NodeSampler bindings add dispose listeners to that immortal texture
        // while the graph is compiled. Record the pre-build listener set so
        // teardown can detach only this reflector's bindings.
        reflectionDefaultTexture = reflectionNode.value;
        reflectionDefaultDisposeListeners = new Set(
            reflectionDefaultTexture?._listeners?.dispose || [],
        );
        reflectionNode.target.rotateX(-Math.PI / 2);
        reflectionNode.target.position.y = WATER_Y;
        add(reflectionNode.target);

        const reflectionCamera = reflectionNode.reflector.getVirtualCamera(camera);
        reflectionCamera.layers.set(REFLECTION_LAYER);
        // Node materials participating in selective MRT also render through
        // this single-target reflector. Name its texture so their material MRT
        // can retain the ordinary color output and discard unmatched channels.
        reflectionNode.reflector.getRenderTarget(reflectionCamera).texture.name = 'output';

        const reflectionUv = screenUV.flipX().add(opticalSlope.mul(0.017));
        const reflectionBlur = clamp(
            mix(float(0.078), float(0.012), smoothstep(0.02, 0.72, fresnel))
                .add(calmMask.mul(0.018)),
            0.01,
            0.10,
        );
        // Vertical smear. A single tap reflects the spirit's head as a hard
        // octagonal disc — the reflector's own resolution made legible, floating
        // on the lake with no figure under it. Water does not do that: a bright
        // source on rippled water elongates into a shimmering column. Two extra
        // taps along screen-Y both fix the artefact and give the mirror the one
        // motion cue it was missing, for the price of two fetches.
        const smearOffset = vec2(0, 0.019);
        const smearBlur = reflectionBlur.mul(2.4);
        const smearEnabled = readToggle(params, 'reflectSmear', true);
        const reflectedRaw = smearEnabled
            ? reflectionNode.sample(reflectionUv).blur(reflectionBlur).rgb
                .mul(0.52)
                .add(reflectionNode.sample(reflectionUv.add(smearOffset))
                    .blur(smearBlur).rgb.mul(0.24))
                .add(reflectionNode.sample(reflectionUv.sub(smearOffset))
                    .blur(smearBlur).rgb.mul(0.24))
            : reflectionNode.sample(reflectionUv).blur(reflectionBlur).rgb;
        // Highlight knee. The spirit's head is the brightest object in the scene
        // by an order of magnitude, and an unclamped mirror hands the lake a
        // second one — a hot white lozenge that reads as a lantern floating on
        // the water rather than as her light in it. Compressing only the top of
        // the reflected range leaves the treeline untouched; the moon lane is a
        // separate specular term and is not affected.
        const reflectedHot = smoothstep(0.30, 1.30, dot(reflectedRaw, vec3(0.2126, 0.7152, 0.0722)));
        const reflectedTamed = reflectedRaw.mul(mix(float(1), float(0.38), reflectedHot));
        // Painted-mirror transform: pull toward luminance, darken, and lift the
        // toe so the reflection reads as pigment sitting in dark water rather
        // than as a second copy of the world.
        const reflectedLuma = dot(reflectedTamed, vec3(0.2126, 0.7152, 0.0722));
        // Painted, but PRESENT. The previous 0.62 luminance pull and 0.66
        // multiply were tuned to stop the lake reading as a mirror and
        // overshot into it reading as nothing — the treeline disappeared from
        // the largest single area of the frame. Keep the desaturation and the
        // toe lift; give back the value.
        const reflected = mix(
            reflectedLuma.mul(vec3(0.62, 0.86, 0.82)),
            reflectedTamed,
            0.88,
        ).mul(1.02).add(vec3(0.006, 0.013, 0.015));
        // Fresnel alone bottoms the near field out at ~6% reflection, because the
        // camera looks almost straight down at the water closest to it. That is
        // physically reasonable for a perfect dielectric but it made the troll
        // and spirit reflections mathematically present and visually invisible.
        // A raised floor keeps the characters readable in the mirror without
        // flattening the grazing-angle falloff that sells the far water.
        const reflectionWeight = clamp(fresnel.mul(0.95).add(0.42), 0.42, 0.94)
            .mul(float(1).sub(shoreBand.mul(0.28)));
        waterColor = mix(waterColor, reflected.mul(vec3(0.86, 0.96, 0.92)), reflectionWeight);
    } else if (reflectionMode === 'analytic') {
        // Low-tier silhouettes are narrow broken lanes, never circular color blobs.
        const skyReflection = mix(vec3(0.018, 0.062, 0.058), vec3(0.11, 0.24, 0.22), fresnel);
        const brokenLane = (x, z, width, reach, phase) => {
            const bend = sin(waterPosition.y.mul(0.46).add(uTime.mul(0.18)).add(phase)).mul(0.36);
            const across = abs(waterPosition.x.sub(x).sub(bend));
            const along = abs(waterPosition.y.sub(z).sub(reach * 0.35));
            const lane = smoothstep(width * 0.28, width, across).oneMinus();
            const falloff = smoothstep(reach * 0.12, reach, along).oneMinus();
            const breakup = smoothstep(
                0.30,
                0.76,
                sin(waterPosition.y.mul(1.7).add(phase)).mul(0.5).add(0.5),
            );
            return lane.mul(falloff).mul(breakup.mul(0.62).add(0.18));
        };
        const spiritLane = brokenLane(-18, -20, 1.35, 13, 1.2);
        const trollLane = brokenLane(18.5, -19, 2.8, 10, 3.7);
        let analyticReflection = skyReflection
            .add(vec3(0.74, 0.64, 0.36).mul(spiritLane.mul(0.44)))
            .sub(vec3(0.016, 0.030, 0.025).mul(trollLane.mul(0.72)));
        analyticReflection = analyticReflection.mul(mix(float(0.76), float(0.94), fresnel));
        const analyticWeight = clamp(fresnel.mul(0.72).add(0.055), 0.04, 0.58);
        waterColor = mix(waterColor, analyticReflection, analyticWeight);
    }

    // A calm-water glint band. The broad/sparkle specular above is anchored to
    // the moon's real world position; this only adds the agitation-dependent
    // scatter outside the board's calm pocket.
    const agitationGlint = pow(
        max(dot(opticalNormal, halfVector), float(0)),
        float(48),
    ).mul(smoothstep(0.15, 0.9, calmMask).oneMinus().mul(0.48).add(0.08));
    waterColor = waterColor.add(vec3(0.52, 0.80, 0.75).mul(agitationGlint.mul(0.44)));

    const waterMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial());
    waterMaterial.colorNode = waterColor;
    waterMaterial.opacityNode = mix(float(0.64), float(0.88), shoreDepth);
    if (fragmentResponse) {
        const responseLight = vec3(0.72, 0.60, 0.38)
            .mul(fragmentResponse.get('ivory').mul(0.26))
            .add(vec3(0.18, 0.66, 0.67).mul(
                fragmentResponse.get('cyan').mul(0.30),
            ))
            .add(vec3(0.48, 0.30, 0.67).mul(
                fragmentResponse.get('violet').mul(0.34),
            ));
        const vertexHeight = makeDisplacementResponseHeight(positionGeometry.xz);
        waterMaterial.emissiveNode = responseLight;
        waterMaterial.positionNode = positionLocal.add(vec3(
            0,
            vertexHeight,
            0,
        ));
    }
    waterMaterial.transparent = true;
    waterMaterial.depthWrite = false;
    // The lake has upward-facing winding and is always viewed from above. FrontSide
    // avoids r181's second transparent DoubleSide pass across the full hero surface.
    waterMaterial.side = THREE.FrontSide;
    waterMaterial.fog = true;
    const water = add(new THREE.Mesh(lakeGeometry, waterMaterial));
    water.position.y = WATER_Y;
    water.renderOrder = 20;

    // Optional board-safe guide visualizes the calm optical sanctuary. It stays
    // on layer 0 and therefore never contaminates the High reflector pass.
    let boardGuide = null;
    if (boardGuideEnabled) {
        boardGuide = new THREE.Group();
        boardGuide.name = 'stillwater-board-guide';
        const guideMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial());
        guideMaterial.colorNode = vec3(0.58, 0.78, 0.72).mul(0.28);
        guideMaterial.transparent = true;
        guideMaterial.opacity = 0.26;
        guideMaterial.depthWrite = false;
        const horizontal = ownGeometry(new THREE.BoxGeometry(13.2, 0.08, 0.08));
        const vertical = ownGeometry(new THREE.BoxGeometry(0.08, 21.2, 0.08));
        [[0, -10.6, horizontal], [0, 10.6, horizontal], [-6.6, 0, vertical], [6.6, 0, vertical]]
            .forEach(([x, y, geometry]) => {
                const edge = new THREE.Mesh(geometry, guideMaterial);
                edge.position.set(x, y, 0);
                boardGuide.add(edge);
            });
        boardGuide.position.set(0, 10.8, -2.2);
        boardGuide.renderOrder = 50;
        add(boardGuide);
    }

    // The water-only pilot owns its compact grade. The integrated candidate sets
    // `post=off` and mounts the Wave 6 selective-emissive pipeline exactly once.
    let scenePass = null;
    let post = null;
    if (postEnabled) {
        scenePass = pass(scene, camera);
        const sceneColor = scenePass.getTextureNode('output');
        const aces = toneMapping(THREE.ACESFilmicToneMapping, 1.0, sceneColor);
        const luminance = dot(aces.rgb, vec3(0.2126, 0.7152, 0.0722));
        const shadowMask = smoothstep(0.08, 0.44, luminance).oneMinus();
        const highlightMask = smoothstep(0.52, 0.92, luminance);
        const tealShadow = mix(
            vec3(1),
            vec3(0.90, 1.035, 0.985),
            shadowMask.mul(0.24),
        );
        const warmHighlight = vec3(0.060, 0.024, 0.004).mul(highlightMask.mul(0.48));
        const screenCenter = screenUV.sub(0.5);
        const vignette = clamp(
            float(1).sub(dot(screenCenter, screenCenter).mul(0.42)),
            0.86,
            1,
        );
        const graded = aces.rgb.mul(tealShadow).add(warmHighlight).mul(vignette);
        const finalColor = gradeMode === 'aces' ? aces.rgb : graded;
        post = new THREE.PostProcessing(renderer);
        post.outputColorTransform = false;
        post.outputNode = renderOutput(
            vec4(finalColor, aces.a),
            THREE.NoToneMapping,
        );
    }

    const lakeVertexCount = lakeGeometry.getAttribute('position').count;
    const lakeTriangleCount = lakeGeometry.index.count / 3;
    let responseGraphModel = 'disabled';
    if (responsesEnabled) {
        responseGraphModel = leanResponseGraph
            ? 'lean-four-wake'
            : 'cinematic-four-wake';
    }
    const diagnostics = {
        id: WATER_RUNTIME_ID,
        wave: 3,
        quality: qualityName,
        layout,
        backend: renderer.backend?.isWebGPUBackend ? 'WebGPU' : 'WebGL2',
        reflectionRequest,
        reflectionMode,
        reflectionScale: reflectionMode === 'reflector' ? quality.reflectorScale : 0,
        reflectionLayer: reflectionMode === 'reflector' ? REFLECTION_LAYER : null,
        flowModel,
        materialXFlow: premiumFlow,
        detailFlow: quality.detailFlow,
        calmMask: true,
        shoreDepth: true,
        contactDarkening: true,
        submergedShapes: stones ? stoneLayout.length : 0,
        causticLayers: quality.secondCaustic ? 2 : 1,
        responsesEnabled,
        responseGraphModel,
        responseEvent,
        wakeSlots: responsesEnabled ? quality.responseSlots : 0,
        responseSlotBytes: responsesEnabled ? quality.responseSlots * 2 * 4 * 4 : 0,
        reservedSpecialSlot: responsesEnabled ? 0 : null,
        tetrisDepthWakes: responsesEnabled
            ? TETRIS_DEPTH_WAKE_OFFSETS.length
            : 0,
        lakeRings: quality.lakeRings,
        lakeVertices: lakeVertexCount,
        lakeTriangles: lakeTriangleCount,
        physicalDisplacement: responsesEnabled,
        opticalResponse: responsesEnabled,
        emissiveResponse: responsesEnabled,
        computeFeedback: false,
        proxies: proxiesEnabled,
        moonHalo: moonHalo !== null,
        lights: includeLights ? 2 : 0,
        post: postEnabled,
        boardGuide: boardGuideEnabled,
        grade: gradeMode === 'aces' ? 'ACES-1.0-only' : 'ACES-1.0-teal-shadow-warm-highlight',
    };
    const getResponseState = () => responseState?.getSnapshot(currentTime) || {
        capacity: 0,
        activeSlots: 0,
        peakActiveSlots: 0,
        eventWrites: 0,
        lastEvent: 'disabled',
    };
    const getDiagnostics = () => {
        const responseSnapshot = getResponseState();
        return {
            ...diagnostics,
            activeResponseSlots: responseSnapshot.activeSlots,
            peakResponseSlots: responseSnapshot.peakActiveSlots,
            responseEventWrites: responseSnapshot.eventWrites,
            responseOverwrites: responseSnapshot.overwriteCount || 0,
            suppressedLocks: responseSnapshot.suppressedLocks || 0,
            responseGraphActive: uResponseActivity?.value > 0,
            responseGraphMode: responseModeName(uResponseMode?.value),
            waterMaterialVersion: waterMaterial.version,
        };
    };
    const getCaptureMeta = () => ({
        event: responseEvent,
        fxAge: responseAge,
        captureTime,
        birthTime: responseEvent === 'idle'
            ? null
            : Math.max(0.0001, captureTime - responseAge),
        center: { x: responseCenterX, z: responseCenterZ },
        canonicalSequence: [...responsePreset.canonicalSequence],
    });
    const getResourceState = () => {
        let objectCount = 0;
        root.traverse(() => { objectCount += 1; });
        return {
            ...rendererCounters(renderer),
            rootObjects: objectCount,
            ownedGeometries: geometries.size,
            ownedMaterials: materials.size,
            waterMaterialVersion: waterMaterial.version,
            lakeVertices: lakeVertexCount,
            lakeTriangles: lakeTriangleCount,
            responseStateValues: responseBindings?.stateValues || null,
            responseShapeValues: responseBindings?.shapeValues || null,
        };
    };
    const runtimeApi = Object.freeze({
        getDiagnostics,
        getRendererCounters: () => rendererCounters(renderer),
        getResourceState,
        getCaptureMeta,
        getResponseState,
        triggerReaction: (type, options) => {
            const triggered = responseState?.triggerReaction(type, options) || false;
            if (triggered) syncResponseActivity();
            return triggered;
        },
        clearReactions: () => {
            responseState?.clearReactions();
            syncResponseActivity();
        },
    });
    return {
        ...runtimeApi,
        root,
        /**
         * Track the spirit so its practical spill on the banks and its reflected
         * column on the lake follow the figure instead of a fixed anchor.
         */
        setSpiritGlow(x, y, z, energy = 1) {
            uSpiritGlow.value.set(x, y, z, Math.max(0, energy));
        },
        /** Site the troll's lantern so its amber spill matches the mesh. */
        setLanternGlow(x, y, z, energy = 1) {
            uLanternGlow.value.set(x, y, z, Math.max(0, energy));
        },
        camera(_time, activeCamera) {
            activeCamera.position.set(0, 14.5, 39);
            activeCamera.lookAt(0, 3.8, -15);
            activeCamera.fov = 46;
            activeCamera.near = 0.1;
            activeCamera.far = 520;
            activeCamera.updateProjectionMatrix();
        },
        update(time) {
            currentTime = time;
            uTime.value = time;
            syncResponseActivity(time);
            if (spirit) {
                spirit.position.y = 5.1 + Math.sin(time * 0.52) * 0.22;
                spirit.rotation.y = Math.sin(time * 0.18) * 0.14;
            }
            if (troll) troll.rotation.y = -0.48 + Math.sin(time * 0.09) * 0.05;
        },
        render: () => (post ? post.render() : renderer.render(scene, camera)),
        renderAsync: async () => (post ? post.render() : renderer.render(scene, camera)),
        dispose() {
            scene.remove(root);
            const reflectorBase = reflectionNode?.reflector;
            // r181's reflector owns a strong camera -> RenderTarget map. Dispose
            // each target explicitly before severing that map so a reused
            // renderer observes the color/depth texture disposal immediately.
            reflectorBase?.renderTargets?.forEach?.((target) => target.dispose?.());
            reflectionNode?.dispose?.();
            const defaultDisposeListeners = [
                ...(reflectionDefaultTexture?._listeners?.dispose || []),
            ];
            const rendererTextureDisposeListener = renderer._textures
                ?.get?.(reflectionDefaultTexture)
                ?.onDispose;
            defaultDisposeListeners.forEach((listener) => {
                if (
                    !reflectionDefaultDisposeListeners?.has(listener)
                    && listener !== rendererTextureDisposeListener
                ) {
                    reflectionDefaultTexture?.removeEventListener?.('dispose', listener);
                }
            });
            reflectorBase?.renderTargets?.clear?.();
            if (reflectorBase?.virtualCameras) {
                reflectorBase.virtualCameras = new WeakMap();
            }
            if (reflectorBase) {
                reflectorBase.textureNode = null;
                reflectorBase.target = null;
            }
            if (reflectionNode) {
                reflectionNode.value = null;
                reflectionNode._reflectorBaseNode = null;
            }
            scenePass?.dispose?.();
            post?.dispose?.();
            geometries.forEach((geometry) => geometry.dispose());
            materials.forEach((material) => material.dispose());
            root.clear();
            geometries.clear();
            materials.clear();
            reflectionNode = null;
            reflectionDefaultTexture = null;
            reflectionDefaultDisposeListeners = null;
            scenePass = null;
            post = null;
            scene.background = previous.background;
            scene.fog = previous.fog;
            camera.fov = previous.fov;
            camera.near = previous.near;
            camera.far = previous.far;
            camera.position.copy(previous.position);
            camera.quaternion.copy(previous.quaternion);
            camera.updateProjectionMatrix();
        },
    };
}

export default createStillwaterWater;
