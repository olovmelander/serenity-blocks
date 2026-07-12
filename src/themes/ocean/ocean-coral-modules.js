/* eslint-disable import/no-extraneous-dependencies, import/no-unresolved */
/**
 * Ocean Theme - Chunky modular coral geometry and deterministic composition.
 *
 * Geometry ownership:
 * - createCoralModuleLibrary() owns the six source BufferGeometries it returns.
 * - BatchedMesh.addGeometry() copies source data into the batch, so callers may
 *   dispose the library immediately after createCoralBatch() when it will not be
 *   reused.
 * - BatchedMesh.dispose() releases the copied geometry and internal textures;
 *   the externally supplied material remains caller-owned.
 */

import * as THREE from 'three/webgpu';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

const UP = new THREE.Vector3(0, 1, 0);
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const MAX_CORAL_COLONIES = 72;

const TIER_COUNTS = Object.freeze({
    Minimal: 0,
    Low: 14,
    Medium: 24,
    High: 38,
    Ultra: 54,
    Extreme: 72,
});

const MODULE_IDS = Object.freeze([
    'staghorn-crown',
    'table-stack',
    'fan-bouquet',
    'sponge-grove',
    'brain-boulder',
    'carpet-rosette',
]);

const DEFAULT_GARDENS = Object.freeze([
    Object.freeze({
        x: -58,
        z: 48,
        radius: 24,
        warmth: 0.95,
    }),
    Object.freeze({
        x: 62,
        z: 42,
        radius: 26,
        warmth: 1.0,
    }),
    Object.freeze({
        x: -82,
        z: -42,
        radius: 34,
        warmth: 0.72,
    }),
    Object.freeze({
        x: 88,
        z: -56,
        radius: 36,
        warmth: 0.78,
    }),
    Object.freeze({
        x: -118,
        z: -112,
        radius: 44,
        warmth: 0.48,
    }),
    Object.freeze({
        x: 120,
        z: -118,
        radius: 44,
        warmth: 0.5,
    }),
]);

const DEFAULT_READABILITY_ZONE = Object.freeze({
    halfWidth: 28,
    zMin: -42,
    zMax: 70,
});

const WARM_PALETTE = Object.freeze([0xf18a78, 0xf3ad6f, 0xdf7d9a, 0xb987c9, 0xe9ca78]);

const MID_PALETTE = Object.freeze([0xd77970, 0xd99569, 0x9a7db3, 0x62a79d, 0xc887a3]);

const COOL_PALETTE = Object.freeze([0x638ba7, 0x5b9ca4, 0x7e78a0, 0x579289, 0x917d97]);

const ROLE_MODULE_POOLS = Object.freeze({
    foreground: Object.freeze([
        'staghorn-crown',
        'sponge-grove',
        'fan-bouquet',
        'staghorn-crown',
        'table-stack',
        'sponge-grove',
        'carpet-rosette',
    ]),
    midground: Object.freeze([
        'table-stack',
        'brain-boulder',
        'carpet-rosette',
        'sponge-grove',
        'table-stack',
        'staghorn-crown',
        'fan-bouquet',
    ]),
    far: Object.freeze([
        'brain-boulder',
        'table-stack',
        'staghorn-crown',
        'carpet-rosette',
        'brain-boulder',
    ]),
});

const DETAIL_SETTINGS = Object.freeze({
    low: Object.freeze({
        radial: 6,
        fanSegments: 7,
        branchCount: 5,
        carpetNubs: 10,
    }),
    medium: Object.freeze({
        radial: 7,
        fanSegments: 8,
        branchCount: 6,
        carpetNubs: 12,
    }),
    high: Object.freeze({
        radial: 8,
        fanSegments: 10,
        branchCount: 7,
        carpetNubs: 14,
    }),
});

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function normalizeTier(tier) {
    const name = String(tier || 'High').toLowerCase();
    const match = Object.keys(TIER_COUNTS).find((candidate) => candidate.toLowerCase() === name);
    return match || 'High';
}

function normalizeDetail(detail) {
    const name = String(detail || 'high').toLowerCase();
    if (name === 'low' || name === 'minimal') return 'low';
    if (name === 'medium') return 'medium';
    return 'high';
}

function mulberry32(seed) {
    let state = seed >>> 0;
    return () => {
        state += 0x6d2b79f5;
        let value = state;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
}

function toNonIndexedSurface(geometry) {
    const surface = geometry.index ? geometry.toNonIndexed() : geometry;
    if (surface !== geometry) geometry.dispose();

    Object.keys(surface.attributes).forEach((name) => {
        if (name !== 'position' && name !== 'normal') surface.deleteAttribute(name);
    });
    surface.computeVertexNormals();
    return surface;
}

function transformSurface(
    geometry,
    { position = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1] } = {},
) {
    const surface = toNonIndexedSurface(geometry);
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(rotation[0], rotation[1], rotation[2], 'XYZ'),
    );
    matrix.compose(
        new THREE.Vector3(position[0], position[1], position[2]),
        quaternion,
        new THREE.Vector3(scale[0], scale[1], scale[2]),
    );
    surface.applyMatrix4(matrix);
    return surface;
}

function cylinderBetween(start, end, radiusBottom, radiusTop, radialSegments, openEnded = false) {
    const from = new THREE.Vector3(start[0], start[1], start[2]);
    const to = new THREE.Vector3(end[0], end[1], end[2]);
    const direction = to.clone().sub(from);
    const length = Math.max(0.001, direction.length());
    direction.multiplyScalar(1 / length);

    const geometry = new THREE.CylinderGeometry(
        radiusTop,
        radiusBottom,
        length,
        radialSegments,
        1,
        openEnded,
    );
    const quaternion = new THREE.Quaternion().setFromUnitVectors(UP, direction);
    const matrix = new THREE.Matrix4().compose(
        from.clone().add(to).multiplyScalar(0.5),
        quaternion,
        new THREE.Vector3(1, 1, 1),
    );
    const surface = toNonIndexedSurface(geometry);
    surface.applyMatrix4(matrix);
    return surface;
}

function mergeModuleParts(parts, { flexStart = 1, flexAmount = 0 } = {}) {
    const merged = BufferGeometryUtils.mergeGeometries(parts, false);
    parts.forEach((part) => part.dispose());
    if (!merged) throw new Error('Ocean coral module geometry merge failed.');

    merged.computeVertexNormals();
    merged.computeBoundingBox();
    const position = merged.getAttribute('position');
    const flex = new Float32Array(position.count);
    const minY = merged.boundingBox?.min.y ?? 0;
    const maxY = merged.boundingBox?.max.y ?? 1;
    const height = Math.max(0.001, maxY - minY);
    const start = clamp(flexStart, 0, 0.999);

    for (let i = 0; i < position.count; i += 1) {
        const normalizedY = clamp((position.getY(i) - minY) / height, 0, 1);
        const linear = clamp((normalizedY - start) / (1 - start), 0, 1);
        const eased = linear * linear * (3 - 2 * linear);
        flex[i] = eased * flexAmount;
    }

    merged.setAttribute('aFlex', new THREE.BufferAttribute(flex, 1));
    merged.computeBoundingSphere();
    if (merged.boundingSphere) merged.boundingSphere.radius += flexAmount * 1.25;
    return merged;
}

function createFanBlade(width, height, segments, thickness) {
    const vertices = [];
    const indices = [];
    const arc = [];

    for (let i = 0; i <= segments; i += 1) {
        const t = -Math.PI * 0.5 + (i / segments) * Math.PI;
        arc.push([Math.sin(t) * width, height * (0.22 + Math.cos(t) * 0.78)]);
    }

    const frontBase = vertices.length / 3;
    vertices.push(0, 0, thickness * 0.5);
    const frontStart = vertices.length / 3;
    arc.forEach(([x, y]) => vertices.push(x, y, thickness * 0.5));

    const backBase = vertices.length / 3;
    vertices.push(0, 0, -thickness * 0.5);
    const backStart = vertices.length / 3;
    arc.forEach(([x, y]) => vertices.push(x, y, -thickness * 0.5));

    for (let i = 0; i < segments; i += 1) {
        indices.push(frontBase, frontStart + i, frontStart + i + 1);
        indices.push(backBase, backStart + i + 1, backStart + i);
        indices.push(frontStart + i, backStart + i, frontStart + i + 1);
        indices.push(frontStart + i + 1, backStart + i, backStart + i + 1);
    }

    indices.push(frontBase, backBase, frontStart);
    indices.push(frontStart, backBase, backStart);
    indices.push(frontStart + segments, backStart + segments, frontBase);
    indices.push(frontBase, backStart + segments, backBase);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
}

function createStaghornCrown(settings) {
    const parts = [];
    const { radial } = settings;
    parts.push(cylinderBetween([0, 0, 0], [0, 2.35, 0], 0.72, 0.42, radial));
    parts.push(cylinderBetween([0, 2.1, 0], [0.06, 3.45, 0.02], 0.42, 0.2, radial));

    for (let i = 0; i < settings.branchCount; i += 1) {
        const angle = (i / settings.branchCount) * Math.PI * 2 + (i % 2) * 0.18;
        const startY = 1.25 + (i % 3) * 0.38;
        const reach = 1.15 + (i % 2) * 0.34;
        const end = [
            Math.cos(angle) * reach,
            startY + 1.18 + (i % 3) * 0.16,
            Math.sin(angle) * reach,
        ];
        const start = [0, startY, 0];
        parts.push(cylinderBetween(start, end, 0.3, 0.13, radial));

        const forkAngle = angle + (i % 2 === 0 ? 0.42 : -0.42);
        const forkEnd = [
            end[0] + Math.cos(forkAngle) * 0.58,
            end[1] + 0.72,
            end[2] + Math.sin(forkAngle) * 0.58,
        ];
        parts.push(cylinderBetween(end, forkEnd, 0.15, 0.075, Math.max(5, radial - 1)));
    }

    return mergeModuleParts(parts, { flexStart: 0.42, flexAmount: 1 });
}

function createTableStack(settings) {
    const parts = [];
    const radial = Math.max(10, settings.radial + 4);
    parts.push(cylinderBetween([0, 0, 0], [0, 2.15, 0], 0.58, 0.28, settings.radial));

    const shelves = [
        {
            y: 1.0,
            radius: 1.18,
            x: -0.18,
            z: 0.08,
            rz: -0.04,
        },
        {
            y: 1.65,
            radius: 1.42,
            x: 0.22,
            z: -0.12,
            rz: 0.055,
        },
        {
            y: 2.28,
            radius: 1.02,
            x: -0.08,
            z: 0.16,
            rz: -0.035,
        },
    ];
    shelves.forEach((shelf, index) => {
        parts.push(
            transformSurface(
                new THREE.CylinderGeometry(
                    shelf.radius,
                    shelf.radius * 0.76,
                    0.17 + index * 0.015,
                    radial,
                ),
                {
                    position: [shelf.x, shelf.y, shelf.z],
                    rotation: [0.04 * (index - 1), index * 0.72, shelf.rz],
                    scale: [1, 1, 0.72 + index * 0.06],
                },
            ),
        );
    });
    return mergeModuleParts(parts, { flexStart: 0.78, flexAmount: 0.08 });
}

function createFanBouquet(settings) {
    const parts = [];
    const fans = [
        { position: [-0.34, 0.8, 0], rotation: [0, -0.46, -0.12], scale: [1.1, 1.12, 1] },
        { position: [0.26, 0.72, -0.12], rotation: [0.04, 0.42, 0.1], scale: [0.94, 1.0, 1] },
        { position: [0.05, 1.12, 0.16], rotation: [-0.02, 0.05, 0.02], scale: [0.82, 0.88, 1] },
    ];

    fans.forEach((fan, index) => {
        parts.push(
            cylinderBetween(
                [fan.position[0] * 0.34, 0, fan.position[2] * 0.34],
                [fan.position[0], fan.position[1] + 0.18, fan.position[2]],
                0.18,
                0.09,
                Math.max(5, settings.radial - 1),
            ),
        );
        parts.push(
            transformSurface(createFanBlade(1.25, 2.25, settings.fanSegments, 0.075), {
                position: fan.position,
                rotation: fan.rotation,
                scale: fan.scale,
            }),
        );
        if (index === 0) {
            parts.push(
                transformSurface(new THREE.IcosahedronGeometry(0.48, 1), {
                    position: [0, 0.34, 0],
                    scale: [1.3, 0.72, 1.0],
                }),
            );
        }
    });
    return mergeModuleParts(parts, { flexStart: 0.28, flexAmount: 1 });
}

function createSpongeGrove(settings) {
    const parts = [];
    const radial = Math.max(6, settings.radial);
    const tubes = [
        [-0.58, -0.12, 2.15, 0.36],
        [0.0, 0.08, 2.8, 0.44],
        [0.58, -0.18, 1.78, 0.32],
        [-0.2, 0.55, 1.48, 0.29],
        [0.5, 0.48, 1.2, 0.25],
        [-0.68, 0.44, 1.08, 0.23],
    ];

    parts.push(
        transformSurface(new THREE.IcosahedronGeometry(0.88, 1), {
            position: [0, 0.28, 0.05],
            scale: [1.35, 0.46, 1.02],
        }),
    );
    tubes.forEach(([x, z, height, radius], index) => {
        parts.push(
            transformSurface(
                new THREE.CylinderGeometry(radius, radius * 1.24, height, radial, 1, true),
                {
                    position: [x, height * 0.5 + 0.22, z],
                    rotation: [0.04 * (index % 2), index * 0.37, (index - 2.5) * 0.018],
                },
            ),
        );
        parts.push(
            transformSurface(
                new THREE.TorusGeometry(radius, Math.max(0.035, radius * 0.13), 4, radial),
                {
                    position: [x, height + 0.22, z],
                    rotation: [Math.PI * 0.5, 0, 0],
                },
            ),
        );
    });
    return mergeModuleParts(parts, { flexStart: 0.72, flexAmount: 0.14 });
}

function createBrainBoulder() {
    const parts = [
        transformSurface(new THREE.IcosahedronGeometry(1, 1), {
            position: [-0.55, 0.62, 0.05],
            scale: [1.18, 0.72, 1.0],
        }),
        transformSurface(new THREE.IcosahedronGeometry(1, 1), {
            position: [0.48, 0.58, -0.12],
            scale: [1.08, 0.66, 0.9],
        }),
        transformSurface(new THREE.IcosahedronGeometry(0.78, 1), {
            position: [0.0, 1.12, 0.18],
            scale: [1.0, 0.72, 0.92],
        }),
    ];
    return mergeModuleParts(parts, { flexStart: 1, flexAmount: 0 });
}

function createCarpetRosette(settings) {
    const parts = [
        transformSurface(new THREE.IcosahedronGeometry(1, 1), {
            position: [0, 0.18, 0],
            scale: [1.55, 0.28, 1.08],
        }),
    ];

    for (let i = 0; i < settings.carpetNubs; i += 1) {
        const angle = i * GOLDEN_ANGLE;
        const normalized = Math.sqrt((i + 0.5) / settings.carpetNubs);
        const radius = normalized * 1.32;
        const height = 0.3 + (i % 4) * 0.08;
        parts.push(
            transformSurface(
                new THREE.ConeGeometry(
                    0.13 + (i % 3) * 0.025,
                    height,
                    Math.max(5, settings.radial - 2),
                ),
                {
                    position: [
                        Math.cos(angle) * radius,
                        0.22 + height * 0.5,
                        Math.sin(angle) * radius * 0.72,
                    ],
                    rotation: [0.06 * Math.sin(angle), angle, 0.06 * Math.cos(angle)],
                },
            ),
        );
    }

    for (let i = 0; i < 4; i += 1) {
        const angle = i * Math.PI * 0.5 + 0.38;
        parts.push(
            transformSurface(
                new THREE.CylinderGeometry(0.42, 0.3, 0.08, Math.max(8, settings.radial + 2)),
                {
                    position: [Math.cos(angle) * 0.82, 0.34 + i * 0.025, Math.sin(angle) * 0.54],
                    rotation: [0.05 * Math.sin(angle), angle, 0.08 * Math.cos(angle)],
                    scale: [1.0 + (i % 2) * 0.18, 1, 0.68],
                },
            ),
        );
    }
    return mergeModuleParts(parts, { flexStart: 0.5, flexAmount: 0.2 });
}

function moduleMetrics(id, geometry) {
    const vertexCount = geometry.getAttribute('position')?.count ?? 0;
    const indexCount = geometry.getIndex()?.count ?? 0;
    const triangleCount = indexCount > 0 ? indexCount / 3 : vertexCount / 3;
    return {
        id,
        geometry,
        vertexCount,
        indexCount,
        triangleCount,
    };
}

/**
 * Builds the six source geometries. Call library.dispose() when the source
 * geometries are no longer needed. BatchedMesh stores its own copy.
 */
export function createCoralModuleLibrary({ detail = 'high' } = {}) {
    const resolvedDetail = normalizeDetail(detail);
    const settings = DETAIL_SETTINGS[resolvedDetail];
    const modules = [
        moduleMetrics('staghorn-crown', createStaghornCrown(settings)),
        moduleMetrics('table-stack', createTableStack(settings)),
        moduleMetrics('fan-bouquet', createFanBouquet(settings)),
        moduleMetrics('sponge-grove', createSpongeGrove(settings)),
        moduleMetrics('brain-boulder', createBrainBoulder(settings)),
        moduleMetrics('carpet-rosette', createCarpetRosette(settings)),
    ];
    const byId = new Map(modules.map((module) => [module.id, module]));
    const library = {
        detail: resolvedDetail,
        modules,
        byId,
        totalVertexCount: modules.reduce((sum, module) => sum + module.vertexCount, 0),
        totalIndexCount: modules.reduce((sum, module) => sum + module.indexCount, 0),
        totalUniqueTriangles: modules.reduce((sum, module) => sum + module.triangleCount, 0),
        disposed: false,
        dispose() {
            if (this.disposed) return;
            this.modules.forEach((module) => module.geometry?.dispose?.());
            this.disposed = true;
        },
    };
    return library;
}

function makeBedPattern(gardenCount) {
    if (gardenCount >= 6) return [0, 1, 2, 3, 0, 1, 4, 5, 0, 1, 2, 3];
    const pattern = [];
    for (let i = 0; i < gardenCount; i += 1) pattern.push(i);
    if (gardenCount >= 2) pattern.push(0, 1);
    return pattern.length ? pattern : [0];
}

function getGardenRole(garden) {
    if (garden.z > 10) return 'foreground';
    if (garden.z > -82) return 'midground';
    return 'far';
}

function paletteForGarden(garden) {
    const warmth = Number.isFinite(garden.warmth)
        ? garden.warmth
        : clamp((garden.z + 140) / 190, 0, 1);
    if (warmth >= 0.84) return WARM_PALETTE;
    if (warmth >= 0.62) return MID_PALETTE;
    return COOL_PALETTE;
}

/**
 * Creates a deterministic maximum plan, then returns its tier/count prefix.
 * Calling with Low, Medium, High, Ultra, and Extreme therefore never moves an
 * existing colony; higher tiers only append colonies around the garden edges.
 */
export function createCoralPlacementPlan({
    count,
    tier = 'High',
    seed = 0x0cea5eed,
    gardens = DEFAULT_GARDENS,
    readabilityZone = DEFAULT_READABILITY_ZONE,
    getSeabedHeight = () => 0,
} = {}) {
    const resolvedTier = normalizeTier(tier);
    const requestedCount = Number.isFinite(count) ? Math.floor(count) : TIER_COUNTS[resolvedTier];
    const activeCount = clamp(requestedCount, 0, MAX_CORAL_COLONIES);
    if (activeCount === 0) return [];

    const usableGardens = Array.isArray(gardens) && gardens.length ? gardens : DEFAULT_GARDENS;
    const pattern = makeBedPattern(usableGardens.length);
    const fullBedIndices = new Uint8Array(MAX_CORAL_COLONIES);
    const bedTotals = new Uint16Array(usableGardens.length);
    for (let i = 0; i < MAX_CORAL_COLONIES; i += 1) {
        const bedIndex = pattern[i % pattern.length] % usableGardens.length;
        fullBedIndices[i] = bedIndex;
        bedTotals[bedIndex] += 1;
    }

    const random = mulberry32(seed);
    const bedAngles = new Float32Array(usableGardens.length);
    for (let i = 0; i < bedAngles.length; i += 1) bedAngles[i] = random() * Math.PI * 2;
    const bedOrdinals = new Uint16Array(usableGardens.length);
    const placements = [];

    for (let i = 0; i < activeCount; i += 1) {
        const bedIndex = fullBedIndices[i];
        const garden = usableGardens[bedIndex];
        const role = getGardenRole(garden);
        const ordinal = bedOrdinals[bedIndex];
        bedOrdinals[bedIndex] += 1;
        const radiusProgress = Math.sqrt((ordinal + 0.5) / Math.max(1, bedTotals[bedIndex]));
        const angle = bedAngles[bedIndex] + ordinal * GOLDEN_ANGLE + (random() - 0.5) * 0.3;
        const radial = radiusProgress * (garden.radius ?? 24) * (0.72 + random() * 0.14);
        let x = garden.x + Math.cos(angle) * radial;
        const z = garden.z + Math.sin(angle) * radial * 0.72;

        if (
            Math.abs(x) < readabilityZone.halfWidth
            && z >= readabilityZone.zMin
            && z <= readabilityZone.zMax
        ) {
            const side = garden.x < 0 ? -1 : 1;
            x = side * (readabilityZone.halfWidth + 8 + random() * 10);
        }

        const modulePool = ROLE_MODULE_POOLS[role];
        const moduleId = i < MODULE_IDS.length
            ? MODULE_IDS[i]
            : modulePool[Math.floor(random() * modulePool.length)];
        let baseScale = 1.0 + random() * 0.42;
        if (role === 'foreground') baseScale = 1.45 + random() * 0.62;
        else if (role === 'midground') baseScale = 1.28 + random() * 0.62;
        const verticalBias = moduleId === 'staghorn-crown' || moduleId === 'fan-bouquet'
            ? 1.08 + random() * 0.18
            : 0.9 + random() * 0.17;
        const palette = paletteForGarden(garden);

        placements.push({
            id: `coral-${String(i).padStart(3, '0')}`,
            index: i,
            moduleId,
            bedIndex,
            role,
            position: [x, getSeabedHeight(x, z), z],
            rotation: [(random() - 0.5) * 0.1, random() * Math.PI * 2, (random() - 0.5) * 0.08],
            scale: [
                baseScale * (0.9 + random() * 0.18),
                baseScale * verticalBias,
                baseScale * (0.86 + random() * 0.2),
            ],
            color: palette[Math.floor(random() * palette.length)],
            footprintRadius:
                baseScale
                * (moduleId === 'table-stack' || moduleId === 'carpet-rosette' ? 2.2 : 1.55),
        });
    }

    return placements;
}

/**
 * Copies a module library into one static BatchedMesh and populates it.
 * The material is external and remains caller-owned. Set
 * disposeSourceGeometries=true when this is the library's only consumer.
 */
export function createCoralBatch({
    library,
    placements = [],
    material,
    disposeSourceGeometries = false,
} = {}) {
    if (!library || !Array.isArray(library.modules) || !(library.byId instanceof Map)) {
        throw new TypeError('createCoralBatch requires a coral module library.');
    }
    if (library.disposed) throw new Error('Cannot batch a disposed coral module library.');
    if (!material) throw new TypeError('createCoralBatch requires an externally supplied material.');

    const maxInstances = Math.max(1, placements.length);
    const batch = new THREE.BatchedMesh(
        maxInstances,
        Math.max(1, library.totalVertexCount),
        Math.max(0, library.totalIndexCount),
        material,
    );
    batch.name = 'OceanChunkyCoralBatch';
    batch.perObjectFrustumCulled = true;
    batch.sortObjects = true;
    batch.frustumCulled = true;

    const geometryIds = new Map();
    library.modules.forEach((module) => {
        geometryIds.set(module.id, batch.addGeometry(module.geometry));
    });

    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    const instanceIds = new Map();
    let submittedTriangles = 0;

    placements.forEach((placement) => {
        const module = library.byId.get(placement.moduleId);
        const geometryId = geometryIds.get(placement.moduleId);
        if (!module || geometryId === undefined) {
            throw new Error(`Unknown coral module: ${placement.moduleId}`);
        }

        const instanceId = batch.addInstance(geometryId);
        dummy.position.fromArray(placement.position);
        dummy.rotation.set(placement.rotation[0], placement.rotation[1], placement.rotation[2]);
        dummy.scale.fromArray(placement.scale);
        dummy.updateMatrix();
        batch.setMatrixAt(instanceId, dummy.matrix);
        batch.setColorAt(instanceId, color.setHex(placement.color));
        instanceIds.set(placement.id, instanceId);
        submittedTriangles += module.triangleCount;
    });

    batch.optimize();
    batch.computeBoundingBox();
    batch.computeBoundingSphere();
    batch.matrixAutoUpdate = false;
    batch.updateMatrix();
    batch.userData.isOceanCoralBatch = true;
    batch.userData.geometryIds = geometryIds;
    batch.userData.instanceIds = instanceIds;
    batch.userData.metrics = {
        colonyCount: placements.length,
        drawCount: 1,
        uniqueGeometryTriangles: library.totalUniqueTriangles,
        submittedTriangles,
        sourceDetail: library.detail,
    };
    batch.userData.sourceGeometryOwnership = disposeSourceGeometries
        ? 'disposed-after-copy'
        : 'retained-by-library';

    if (disposeSourceGeometries) library.dispose();
    return batch;
}
