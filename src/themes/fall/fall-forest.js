/**
 * Fall — the amber grove.
 *
 * Owned, deterministic scenery shared by native WebGPU and its WebGL2 backend.
 * Maple leaves are geometry, not opaque canopy balls: their lobed silhouettes,
 * veins, warm undersides and small asynchronous wind motion remain legible.
 * Static trees are one baked mesh; crowns/ground litter/plants/rocks are instanced.
 */
import * as THREE from 'three/webgpu';
import {
    color, float, uniform, vec3, mix, sin, cos, smoothstep, abs, hash,
    positionGeometry, positionLocal, positionWorld, normalWorld, uv, instanceIndex,
} from 'three/tsl';

export const FALL_FOREST_BUDGETS = Object.freeze({
    Extreme: {
        trees: 38, clusters: 30, clusterLeaves: 34, litter: 3600, grass: 2600, ferns: 105, rocks: 100,
    },
    Ultra: {
        trees: 34, clusters: 27, clusterLeaves: 30, litter: 3100, grass: 2250, ferns: 90, rocks: 88,
    },
    High: {
        trees: 30, clusters: 25, clusterLeaves: 28, litter: 2500, grass: 1800, ferns: 75, rocks: 75,
    },
    Medium: {
        trees: 26, clusters: 22, clusterLeaves: 24, litter: 1650, grass: 1150, ferns: 48, rocks: 54,
    },
    Low: {
        trees: 22, clusters: 18, clusterLeaves: 22, litter: 850, grass: 650, ferns: 28, rocks: 36,
    },
    Minimal: {
        trees: 18, clusters: 15, clusterLeaves: 18, litter: 450, grass: 320, ferns: 16, rocks: 24,
    },
});

const LEAF_PALETTE = [0xf4bd4f, 0xb84738, 0xd98039, 0xe8b759, 0x963d42, 0xf2b157, 0xc75c32];
const FOG_COLOR = new THREE.Color(0x7b8988);
const UP = new THREE.Vector3(0, 1, 0);
const TAU = Math.PI * 2;

function seededRandom(seed = 0x8a29f04d) {
    let state = seed >>> 0;
    return () => {
        state += 0x6d2b79f5;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** The same functions are used for geometry and the analytic material path. */
function pathX(z) {
    return Math.sin(z * 0.065 + 0.5) * 3.5 + Math.sin(z * 0.14) * 0.9;
}

function terrainY(x, z) {
    const bank = Math.min(Math.abs(x - pathX(z)) / 14, 1);
    return -2.45 + Math.sin(z * 0.077) * 0.22
        + Math.sin(x * 0.14 + z * 0.043) * 0.38 * bank
        + Math.cos(x * 0.24 - z * 0.071) * 0.13 * bank;
}

function freeze(mesh) {
    mesh.updateMatrix();
    mesh.matrixAutoUpdate = false;
    return mesh;
}

function makeGeometry(positions, normals, uvs, colors) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    if (colors) geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeBoundingSphere();
    return geometry;
}

function appendTriangle(arrays, points, texcoords, tint = null) {
    const n = new THREE.Vector3().subVectors(points[1], points[0])
        .cross(new THREE.Vector3().subVectors(points[2], points[0])).normalize();
    for (let i = 0; i < 3; i++) {
        arrays.p.push(points[i].x, points[i].y, points[i].z);
        arrays.n.push(n.x, n.y, n.z);
        arrays.uv.push(texcoords[i][0], texcoords[i][1]);
        if (tint) arrays.c.push(tint.r, tint.g, tint.b);
    }
}

/** Lobed maple fan, gently folded around its centre vein. */
function appendLeaf(arrays, center, rotation, scale, rng) {
    const outline = [
        [0, 0.98], [0.19, 0.48], [0.5, 0.68], [0.43, 0.29], [0.83, 0.26],
        [0.59, -0.08], [0.72, -0.26], [0.28, -0.34], [0.09, -0.71],
        [0, -0.89], [-0.09, -0.71], [-0.28, -0.34], [-0.72, -0.26],
        [-0.59, -0.08], [-0.83, 0.26], [-0.43, 0.29], [-0.5, 0.68], [-0.19, 0.48],
    ];
    const points = outline.map(([x, y]) => new THREE.Vector3(
        x * scale,
        y * scale,
        (Math.abs(x) * 0.14 + y * y * 0.085) * scale,
    ).applyQuaternion(rotation).add(center));
    const pivot = new THREE.Vector3(0, -0.06 * scale, -0.025 * scale).applyQuaternion(rotation).add(center);
    for (let i = 0; i < points.length; i++) {
        const j = (i + 1) % points.length;
        appendTriangle(arrays, [pivot, points[i], points[j]], [
            [0.5, 0.48], [outline[i][0] * 0.56 + 0.5, outline[i][1] * 0.52 + 0.48],
            [outline[j][0] * 0.56 + 0.5, outline[j][1] * 0.52 + 0.48],
        ]);
    }
    // A narrow geometric stem makes the nearest silhouettes recognisably leaves.
    if (rng() > 0.35) {
        const a = new THREE.Vector3(-0.015, -0.68, 0).multiplyScalar(scale).applyQuaternion(rotation).add(center);
        const b = new THREE.Vector3(0.015, -0.68, 0).multiplyScalar(scale).applyQuaternion(rotation).add(center);
        const c = new THREE.Vector3(0, -1.1, 0).multiplyScalar(scale).applyQuaternion(rotation).add(center);
        appendTriangle(arrays, [a, b, c], [[0.48, 0.09], [0.52, 0.09], [0.5, 0.01]]);
    }
}

function makeLeafGeometry(count, rng, scatter = true) {
    const arrays = { p: [], n: [], uv: [] };
    for (let i = 0; i < count; i++) {
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(
            scatter ? rng() * TAU : 0,
            scatter ? rng() * TAU : 0,
            rng() * TAU,
        ));
        let center = new THREE.Vector3();
        if (scatter) {
            const yaw = rng() * TAU;
            const height = rng() * 2 - 1;
            const radius = Math.sqrt(1 - height * height) * (0.25 + Math.sqrt(rng()) * 0.8);
            center = new THREE.Vector3(Math.cos(yaw) * radius, height * 0.7, Math.sin(yaw) * radius);
        }
        appendLeaf(arrays, center, q, scatter ? 0.28 + rng() * 0.19 : 1, rng);
    }
    return makeGeometry(arrays.p, arrays.n, arrays.uv);
}

/** A tapered, asymmetric tube for trunks, roots and branching limbs. */
function appendBranch(arrays, curve, radiusStart, radiusEnd, tint, rng, rings = 7, sides = 8) {
    const vertices = [];
    for (let ring = 0; ring <= rings; ring++) {
        const t = ring / rings;
        const point = curve.getPoint(t);
        const tangent = curve.getTangent(t).normalize();
        const reference = Math.abs(tangent.y) > 0.94 ? new THREE.Vector3(1, 0, 0) : UP;
        const right = new THREE.Vector3().crossVectors(tangent, reference).normalize();
        const forward = new THREE.Vector3().crossVectors(right, tangent).normalize();
        const radius = radiusStart * (1 - t) ** 0.85 + radiusEnd * t;
        const row = [];
        for (let side = 0; side < sides; side++) {
            const angle = (side / sides) * TAU;
            const r = radius * (1 + Math.sin(side * 2.7 + ring * 0.27) * 0.075);
            row.push(point.clone().addScaledVector(right, Math.cos(angle) * r)
                .addScaledVector(forward, Math.sin(angle) * r));
        }
        vertices.push(row);
    }
    const shifted = tint.clone().multiplyScalar(0.92 + rng() * 0.12);
    for (let ring = 0; ring < rings; ring++) {
        for (let side = 0; side < sides; side++) {
            const next = (side + 1) % sides;
            const u0 = side / sides;
            const u1 = (side + 1) / sides;
            const v0 = (ring / rings) * 3;
            const v1 = ((ring + 1) / rings) * 3;
            appendTriangle(
                arrays,
                [vertices[ring][side], vertices[ring + 1][side], vertices[ring][next]],
                [[u0, v0], [u0, v1], [u1, v0]],
                shifted,
            );
            appendTriangle(
                arrays,
                [vertices[ring][next], vertices[ring + 1][side], vertices[ring + 1][next]],
                [[u1, v0], [u0, v1], [u1, v1]],
                shifted,
            );
        }
    }
}

function makeGrassGeometry(rng) {
    const arrays = { p: [], n: [], uv: [] };
    for (let blade = 0; blade < 5; blade++) {
        const angle = (blade / 5) * TAU + rng() * 0.35;
        const height = 0.38 + rng() * 0.55;
        const width = 0.028 + rng() * 0.027;
        const axis = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
        const across = new THREE.Vector3(-Math.sin(angle), 0, Math.cos(angle));
        const centers = [new THREE.Vector3(), axis.clone().multiplyScalar(height * 0.12).setY(height * 0.52),
            axis.clone().multiplyScalar(height * 0.4).setY(height)];
        for (let segment = 0; segment < 2; segment++) {
            const t0 = segment / 2;
            const t1 = (segment + 1) / 2;
            const a = centers[segment].clone().addScaledVector(across, width * (1 - t0));
            const b = centers[segment].clone().addScaledVector(across, -width * (1 - t0));
            const c = centers[segment + 1].clone().addScaledVector(across, width * (1 - t1));
            const d = centers[segment + 1].clone().addScaledVector(across, -width * (1 - t1));
            appendTriangle(arrays, [a, b, c], [[0, t0], [1, t0], [0, t1]]);
            if (segment === 0) appendTriangle(arrays, [b, d, c], [[1, t0], [1, t1], [0, t1]]);
        }
    }
    return makeGeometry(arrays.p, arrays.n, arrays.uv);
}

function makeFernGeometry() {
    const arrays = { p: [], n: [], uv: [] };
    for (let frond = 0; frond < 6; frond++) {
        const yaw = (frond / 6) * TAU;
        const rotate = (p) => p.applyAxisAngle(UP, yaw);
        for (let i = 1; i < 9; i++) {
            const t = i / 9;
            const extent = Math.sin(t * Math.PI) * 0.24;
            const center = new THREE.Vector3(t * 0.85, Math.sin(t * Math.PI * 0.78) * 0.65, 0);
            for (const side of [-1, 1]) {
                const a = rotate(center.clone().add(new THREE.Vector3(-0.03, -0.025, 0)));
                const b = rotate(center.clone().add(new THREE.Vector3(0.12, 0.012, side * extent)));
                const c = rotate(center.clone().add(new THREE.Vector3(0.048, 0.026, side * extent * 0.55)));
                appendTriangle(arrays, [a, b, c], [[0.5, t], [side > 0 ? 1 : 0, t], [0.5, t + 0.05]]);
            }
        }
    }
    return makeGeometry(arrays.p, arrays.n, arrays.uv);
}

export class FallForest {
    constructor({ scene, quality = 'High', rng = seededRandom() }) {
        this.scene = scene;
        this.quality = quality;
        this.budget = FALL_FOREST_BUDGETS[quality] || FALL_FOREST_BUDGETS.High;
        this.rng = rng;
        this.group = new THREE.Group();
        this.group.name = 'FallAmberGrove';
        this.owned = new Set();
        this.uTime = uniform(0);
        this.uWarmth = uniform(0);
        this.uGust = uniform(0);
        this.uShafts = uniform(0);
        this.built = false;
    }

    own(resource) {
        this.owned.add(resource);
        return resource;
    }

    /** Cool depth preserves the warm foreground and clears the central board. */
    aerial(base, amount = 0.72) {
        const depth = smoothstep(24, 105, positionWorld.z.negate()).mul(amount);
        return mix(base, color(FOG_COLOR), depth);
    }

    makeLeavesMaterial({ carpet = false } = {}) {
        const material = this.own(new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide }));
        material.name = carpet ? 'FallGroundMapleMaterial' : 'FallCanopyMapleMaterial';
        const st = uv();
        const centreVein = smoothstep(0.004, 0.022, abs(st.x.sub(0.5))).oneMinus();
        const branchVeins = abs(sin(st.y.mul(27).add(abs(st.x.sub(0.5)).mul(29))));
        const vein = centreVein.mul(0.12).add(smoothstep(0.02, 0.12, branchVeins).oneMinus().mul(0.055));
        const directional = normalWorld.dot(vec3(-0.45, 0.66, -0.6)).mul(0.42).add(0.64);
        const warm = this.uWarmth.mul(0.18).add(this.uShafts.mul(0.085));
        // Instance colours are multiplied by NodeMaterial after this node.
        material.colorNode = float(1).sub(vein).mul(directional.add(warm)).mul(color(1.05, 0.96, 0.79));
        material.emissiveNode = color(0xffcb70).mul(warm.mul(carpet ? 0.075 : 0.12));
        if (!carpet) {
            const phase = hash(instanceIndex).mul(TAU);
            const bend = sin(this.uTime.mul(0.85).add(phase).add(positionLocal.z.mul(0.08)))
                .mul(this.uGust.mul(0.15).add(0.055));
            const flutter = sin(this.uTime.mul(2.3).add(phase).add(positionGeometry.x.mul(8)))
                .mul(0.022).mul(positionGeometry.y.abs().add(0.2));
            // r186: positionLocal already carries instance transforms; raw masks
            // come from positionGeometry so leaf clusters never lose placement.
            material.positionNode = positionLocal.add(vec3(bend.add(flutter), flutter.mul(0.35), bend.mul(0.38)));
        }
        return material;
    }

    build() {
        if (this.built) return this;
        this.built = true;
        this.buildGround();
        this.buildDistantBoundary();
        this.buildTrees();
        this.buildUnderstory();
        this.scene.add(this.group);
        return this;
    }

    buildGround() {
        const geometry = this.own(new THREE.PlaneGeometry(180, 150, 72, 68));
        geometry.rotateX(-Math.PI / 2);
        const positions = geometry.attributes.position;
        for (let i = 0; i < positions.count; i++) {
            const x = positions.getX(i);
            const z = positions.getZ(i) - 55;
            positions.setXYZ(i, x, terrainY(x, z), z);
        }
        geometry.computeVertexNormals();
        geometry.computeBoundingSphere();
        const material = this.own(new THREE.MeshBasicNodeMaterial());
        material.name = 'FallLeafCarpetAndWindingPath';
        const { x } = positionWorld;
        const { z } = positionWorld;
        const path = sin(z.mul(0.065).add(0.5)).mul(3.5).add(sin(z.mul(0.14)).mul(0.9));
        const lane = smoothstep(1.35, 3.2, x.sub(path).abs()).oneMinus();
        const fleck = sin(x.mul(2.1).add(sin(z.mul(1.3)).mul(2.1)))
            .mul(cos(z.mul(1.75).add(x.mul(0.62)))).mul(0.5).add(0.5);
        const softDapple = sin(x.mul(0.68).add(z.mul(0.17))).mul(sin(z.mul(0.39).sub(x.mul(0.27))))
            .mul(0.5).add(0.5);
        const carpet = mix(color(0x694b3a), color(0x9d7146), fleck.mul(0.2).add(softDapple.mul(0.45)));
        const litLane = mix(color(0xb58c59), color(0xd7b783), softDapple.mul(0.45).add(fleck.mul(0.08)));
        const clearing = smoothstep(21, 4, x.sub(2).abs())
            .mul(smoothstep(19, 4, z.add(53).abs()));
        const base = mix(carpet, litLane, lane.mul(0.8)).mul(clearing.mul(0.28).add(1));
        material.colorNode = this.aerial(base.mul(this.uWarmth.mul(0.09).add(1)), 0.55);
        material.emissiveNode = color(0xffc780).mul(clearing.mul(this.uShafts.mul(0.045)));
        this.group.add(freeze(new THREE.Mesh(geometry, material)));
    }

    /** Quiet, irregular woodland silhouettes eliminate the artificial far edge. */
    buildDistantBoundary() {
        const { rng } = this;
        const arrays = {
            p: [], n: [], uv: [], c: [],
        };
        for (let layer = 0; layer < 3; layer++) {
            const z = -108 - layer * 18;
            const tint = new THREE.Color([0x53565d, 0x586a6a, 0x697277][layer]);
            for (let i = 0; i < 60; i++) {
                const x0 = -180 + i * 6;
                const x1 = x0 + 6;
                // Fill the hazy understory continuously up to the crowns:
                // a low ridge exposed bright sky between the distant trunks.
                const y0 = 6.0 + Math.sin(x0 * 0.035 + layer) * 2.4 + Math.sin(x0 * 0.087) * 0.9;
                const y1 = 6.0 + Math.sin(x1 * 0.035 + layer) * 2.4 + Math.sin(x1 * 0.087) * 0.9;
                const points = [new THREE.Vector3(x0, -8, z), new THREE.Vector3(x1, -8, z),
                    new THREE.Vector3(x0, y0, z), new THREE.Vector3(x1, y1, z)];
                appendTriangle(arrays, [points[0], points[1], points[2]], [[0, 0], [1, 0], [0, 1]], tint);
                appendTriangle(arrays, [points[1], points[3], points[2]], [[1, 0], [1, 1], [0, 1]], tint);
            }
            const count = this.quality === 'Minimal' ? 28 : 50;
            for (let tree = 0; tree < count; tree++) {
                const x = -100 + (tree / count) * 200 + (rng() - 0.5) * 2;
                const base = Math.sin(x * 0.035 + layer) * 2.4;
                const height = 7.5 + rng() * 6;
                const radius = 2.3 + rng() * 2.5;
                const treeTint = tint.clone().multiplyScalar(0.82 + rng() * 0.14);
                appendTriangle(arrays, [new THREE.Vector3(x - 0.16, base - 2, z + 0.1),
                    new THREE.Vector3(x + 0.16, base - 2, z + 0.1),
                    new THREE.Vector3(x, base + height, z + 0.1)], [[0, 0], [1, 0], [0.5, 1]], treeTint);
                const center = new THREE.Vector3(x, base + height - 1, z + 0.1);
                for (let lobe = 0; lobe < 16; lobe++) {
                    const a = (lobe / 16) * TAU;
                    const b = ((lobe + 1) / 16) * TAU;
                    const r0 = radius * (0.87 + rng() * 0.23);
                    const r1 = radius * (0.87 + rng() * 0.23);
                    const p0 = center.clone().add(new THREE.Vector3(Math.cos(a) * r0, Math.sin(a) * r0 * 0.7, 0));
                    const p1 = center.clone().add(new THREE.Vector3(Math.cos(b) * r1, Math.sin(b) * r1 * 0.7, 0));
                    appendTriangle(arrays, [center, p0, p1], [[0.5, 0.5], [0, 0], [1, 1]], treeTint);
                }
            }
        }
        const geometry = this.own(makeGeometry(arrays.p, arrays.n, arrays.uv, arrays.c));
        const material = this.own(new THREE.MeshBasicNodeMaterial({ vertexColors: true, side: THREE.DoubleSide }));
        material.name = 'FallLayeredDistantWoodland';
        const mesh = freeze(new THREE.Mesh(geometry, material));
        mesh.name = 'FallWoodlandHorizon';
        this.group.add(mesh);
    }

    buildTrees() {
        const { rng } = this;
        const arrays = {
            p: [], n: [], uv: [], c: [],
        };
        const trees = [];
        const addTree = (x, z, height, radius, hero = false) => {
            trees.push({
                x, z, height, radius, hero, y: terrainY(x, z),
            });
        };
        // Deliberate framing: four nearby pillars, then a widening/deepening grove.
        addTree(-7.4, 3.5, 18.5, 0.94, true);
        addTree(7.8, 2.2, 19.6, 0.9, true);
        addTree(-25.8, -18, 19.3, 0.95, true);
        addTree(27.1, -22, 20.2, 0.85, true);
        addTree(-11.8, -31, 17.6, 0.58);
        addTree(12.4, -35, 18.3, 0.61);
        addTree(-20.8, -44, 18.8, 0.53);
        addTree(22.7, -49, 19.6, 0.59);
        for (let i = trees.length; i < this.budget.trees; i++) {
            const side = i % 2 === 0 ? -1 : 1;
            const z = -24 - rng() * 88;
            let x = side * (7 + rng() * 48);
            if (z > -44) x = side * (15 + rng() * 35);
            addTree(x, z, 13 + rng() * 12, 0.25 + rng() * 0.4);
        }
        const clusters = [];
        for (let index = 0; index < trees.length; index++) {
            const tree = trees[index];
            const side = Math.sign(tree.x);
            const origin = new THREE.Vector3(tree.x, tree.y, tree.z);
            const lean = -side * (tree.hero ? 1.35 : 0.7);
            const top = origin.clone().add(new THREE.Vector3(lean, tree.height, 0.9));
            const trunkCurve = new THREE.CatmullRomCurve3([
                origin, origin.clone().add(new THREE.Vector3(-lean * 0.16, tree.height * 0.35, 0.2)),
                origin.clone().add(new THREE.Vector3(lean * 0.6, tree.height * 0.7, -0.45)), top,
            ]);
            const barkTint = new THREE.Color(tree.hero ? 0x473b39 : 0x4e4642);
            barkTint.lerp(FOG_COLOR, Math.max(0, Math.min(0.8, (-tree.z - 26) / 115)));
            appendBranch(arrays, trunkCurve, tree.radius, tree.radius * 0.1, barkTint, rng, 10, tree.hero ? 11 : 8);
            // Root buttresses tie each hero trunk into the terrain, avoiding poles.
            if (tree.hero) {
                for (let root = 0; root < 5; root++) {
                    const angle = (root / 5) * TAU + rng() * 0.35;
                    const end = origin.clone().add(new THREE.Vector3(
                        Math.cos(angle) * tree.radius * 3.7,
                        0.08,
                        Math.sin(angle) * tree.radius * 3.7,
                    ));
                    const start = origin.clone().add(new THREE.Vector3(0, tree.radius * 1.2, 0));
                    appendBranch(
                        arrays,
                        new THREE.CatmullRomCurve3([start,
                            start.clone().lerp(end, 0.52).add(new THREE.Vector3(0, -0.15, 0)), end]),
                        tree.radius * 0.47,
                        0.035,
                        barkTint,
                        rng,
                        4,
                        6,
                    );
                }
            }
            const tips = [top];
            for (let branch = 0; branch < 9; branch++) {
                const t = 0.45 + (branch / 9) * 0.45;
                const start = trunkCurve.getPoint(t);
                const angle = branch * 2.399 + index * 0.81;
                const reach = (tree.hero ? 5.6 : 4.5) * (0.65 + rng() * 0.48);
                const end = start.clone().add(new THREE.Vector3(
                    Math.cos(angle) * reach,
                    2.4 + rng() * 3,
                    Math.sin(angle) * reach * 0.8,
                ));
                // Keep near lower boughs away from the calm central play corridor.
                if (tree.z > -40 && Math.abs(end.x) < 4.2 && end.y < 11) end.x = side * 4.2;
                const mid = start.clone().lerp(end, 0.45).add(new THREE.Vector3(0, 0.8, 0));
                appendBranch(
                    arrays,
                    new THREE.CatmullRomCurve3([start, mid, end]),
                    tree.radius * (0.32 - t * 0.18),
                    0.025,
                    barkTint,
                    rng,
                    5,
                    6,
                );
                tips.push(end);
                if (tree.hero || branch % 2 === 0) {
                    const twig = end.clone().add(new THREE.Vector3(Math.sin(angle) * 1.6, 1.2, Math.cos(angle) * 1.4));
                    appendBranch(
                        arrays,
                        new THREE.CatmullRomCurve3([mid, end, twig]),
                        tree.radius * 0.095,
                        0.016,
                        barkTint,
                        rng,
                        3,
                        5,
                    );
                    tips.push(twig);
                }
            }
            const canopyColor = new THREE.Color(LEAF_PALETTE[index % LEAF_PALETTE.length]);
            const clusterCount = this.budget.clusters * (tree.hero ? 2 : 1);
            for (let c = 0; c < clusterCount; c++) {
                const tip = tips[c % tips.length];
                const position = tip.clone().add(new THREE.Vector3(
                    (rng() - 0.5) * 3.5,
                    (rng() - 0.3) * 2.25,
                    (rng() - 0.5) * 3.2,
                ));
                const variedColor = new THREE.Color(LEAF_PALETTE[Math.floor(rng() * LEAF_PALETTE.length)]);
                const tint = canopyColor.clone().lerp(variedColor, tree.hero ? 0.14 : 0.32);
                tint.multiplyScalar(0.88 + rng() * 0.28);
                tint.lerp(FOG_COLOR, Math.max(0, Math.min(0.66, (-tree.z - 27) / 125)));
                clusters.push({
                    position, tint, scale: (tree.hero ? 1.9 : 1.45) * (0.8 + rng() * 0.45), yaw: rng() * TAU,
                });
            }
        }
        // Low, leaf-laden boughs bridge the portrait framing overhead; no trunk
        // crosses the clearing or the central play area below the leaf arch.
        for (let side = -1; side <= 1; side += 2) {
            const start = new THREE.Vector3(side * 7.2, 12.1, 3);
            const end = new THREE.Vector3(-side * 1.9, 15.2, 0.3);
            const curve = new THREE.CatmullRomCurve3([start,
                new THREE.Vector3(side * 3.8, 14.8, 2), end]);
            appendBranch(arrays, curve, 0.18, 0.025, new THREE.Color(0x46382f), rng, 8, 6);
            const overheadCount = this.budget.clusters + 8;
            for (let c = 0; c < overheadCount; c++) {
                const t = c / overheadCount;
                const position = curve.getPoint(t).add(new THREE.Vector3(
                    (rng() - 0.5) * 2.8,
                    0.6 + rng() * 2.1,
                    (rng() - 0.5) * 3.4,
                ));
                const tint = new THREE.Color(LEAF_PALETTE[side < 0 ? c % 3 : 1 + (c % 4)])
                    .multiplyScalar(0.85 + rng() * 0.2);
                clusters.push({
                    position, tint, scale: 1.85 + rng() * 0.55, yaw: rng() * TAU,
                });
            }
        }
        const barkMaterial = this.own(new THREE.MeshBasicNodeMaterial({ vertexColors: true }));
        barkMaterial.name = 'FallSculptedBark';
        const barkRidges = sin(uv().x.mul(68).add(sin(uv().y.mul(7.4)).mul(0.45))).mul(0.12).add(0.86);
        const facing = normalWorld.dot(vec3(-0.55, 0.34, -0.76)).mul(0.24).add(0.96);
        barkMaterial.colorNode = vec3(barkRidges.mul(facing)).mul(color(1.04, 0.93, 0.85));
        const barkGeometry = this.own(makeGeometry(arrays.p, arrays.n, arrays.uv, arrays.c));
        this.group.add(freeze(new THREE.Mesh(barkGeometry, barkMaterial)));
        const crowns = new THREE.InstancedMesh(
            this.own(makeLeafGeometry(this.budget.clusterLeaves, rng)),
            this.makeLeavesMaterial(),
            clusters.length,
        );
        crowns.name = 'FallDenseMapleCrowns';
        const dummy = new THREE.Object3D();
        for (let i = 0; i < clusters.length; i++) {
            const cluster = clusters[i];
            dummy.position.copy(cluster.position);
            dummy.rotation.set(0, cluster.yaw, (rng() - 0.5) * 0.24);
            dummy.scale.set(cluster.scale * 1.2, cluster.scale, cluster.scale);
            dummy.updateMatrix();
            crowns.setMatrixAt(i, dummy.matrix);
            crowns.setColorAt(i, cluster.tint);
        }
        crowns.instanceMatrix.needsUpdate = true;
        crowns.instanceColor.needsUpdate = true;
        crowns.computeBoundingSphere();
        this.group.add(freeze(crowns));
    }

    buildUnderstory() {
        const { rng } = this;
        const dummy = new THREE.Object3D();
        const makeInstances = (name, geometry, material, count, place) => {
            const mesh = new THREE.InstancedMesh(this.own(geometry), material, count);
            mesh.name = name;
            for (let i = 0; i < count; i++) {
                dummy.position.set(0, 0, 0);
                dummy.rotation.set(0, 0, 0);
                dummy.scale.setScalar(1);
                const tint = place(dummy, i);
                dummy.updateMatrix();
                mesh.setMatrixAt(i, dummy.matrix);
                mesh.setColorAt(i, tint);
            }
            mesh.instanceMatrix.needsUpdate = true;
            mesh.instanceColor.needsUpdate = true;
            mesh.computeBoundingSphere();
            this.group.add(freeze(mesh));
            return mesh;
        };
        makeInstances(
            'FallScatteredLeafCarpet',
            makeLeafGeometry(1, rng, false),
            this.makeLeavesMaterial({ carpet: true }),
            this.budget.litter,
            (object, i) => {
                const z = 12 - rng() ** 1.7 * 78;
                const x = (rng() - 0.5) * (38 + (-z + 12) * 0.44);
                object.position.set(x, terrainY(x, z) + 0.035 + rng() * 0.02, z);
                object.rotation.set(-Math.PI / 2 + (rng() - 0.5) * 0.13, 0, rng() * TAU);
                const size = 0.11 + rng() * 0.17;
                object.scale.set(size, size * (0.8 + rng() * 0.5), size);
                return new THREE.Color(LEAF_PALETTE[i % LEAF_PALETTE.length]).multiplyScalar(0.62 + rng() * 0.54);
            },
        );
        const plantMaterial = this.own(new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide }));
        plantMaterial.name = 'FallWindSweptUnderstory';
        plantMaterial.colorNode = mix(color(0x837245), color(0xdaa561), smoothstep(0, 0.85, positionGeometry.y));
        const sway = sin(this.uTime.mul(0.9).add(hash(instanceIndex).mul(TAU)).add(positionLocal.z.mul(0.08)))
            .mul(this.uGust.mul(0.11).add(0.025)).mul(positionGeometry.y.pow(2));
        plantMaterial.positionNode = positionLocal.add(vec3(sway, 0, sway.mul(0.25)));
        makeInstances('FallGoldenGrassTufts', makeGrassGeometry(rng), plantMaterial, this.budget.grass, (object) => {
            const z = 13 - rng() ** 1.9 * 79;
            let x = (rng() - 0.5) * (40 + Math.max(0, -z) * 0.25);
            if (Math.abs(x - pathX(z)) < 2.9) x += Math.sign(x - pathX(z) || 1) * 3.3;
            object.position.set(x, terrainY(x, z), z);
            object.rotation.y = rng() * TAU;
            object.scale.setScalar(0.6 + rng() * 1.05);
            return new THREE.Color(0xffffff).lerp(new THREE.Color(0x98864d), rng() * 0.35);
        });
        makeInstances('FallCopperFernFronds', makeFernGeometry(), plantMaterial, this.budget.ferns, (object) => {
            const z = 6 - rng() * 57;
            const x = (rng() < 0.5 ? -1 : 1) * (5 + rng() * 19);
            object.position.set(x, terrainY(x, z) + 0.02, z);
            object.rotation.y = rng() * TAU;
            object.scale.setScalar(0.9 + rng() * 0.85);
            return new THREE.Color(0xb59e73);
        });
        const rockMaterial = this.own(new THREE.MeshBasicNodeMaterial());
        rockMaterial.name = 'FallMossAndSlateStones';
        const top = smoothstep(-0.2, 0.8, normalWorld.y);
        rockMaterial.colorNode = mix(color(0x645e63), color(0x757759), top)
            .mul(normalWorld.dot(vec3(-0.4, 0.8, -0.3)).mul(0.2).add(0.86));
        const rockGeometry = new THREE.IcosahedronGeometry(1, 1);
        const positions = rockGeometry.attributes.position;
        for (let i = 0; i < positions.count; i++) {
            const x = positions.getX(i);
            const y = positions.getY(i);
            const z = positions.getZ(i);
            const ridge = 1 + Math.sin(x * 5.3 + y * 3.7 + z * 4.2) * 0.11;
            positions.setXYZ(i, x * ridge, y * ridge, z * ridge);
        }
        rockGeometry.computeVertexNormals();
        makeInstances('FallMossCoveredStones', rockGeometry, rockMaterial, this.budget.rocks, (object) => {
            const z = 10 - rng() * 75;
            const x = (rng() < 0.5 ? -1 : 1) * (6 + rng() * 29);
            const size = 0.23 + rng() * 0.55;
            object.position.set(x, terrainY(x, z) - size * 0.3, z);
            object.rotation.set(rng() * 0.2, rng() * TAU, rng() * 0.18);
            object.scale.set(size * 1.2, size * 0.55, size);
            return new THREE.Color(0xffffff).multiplyScalar(0.75 + rng() * 0.3);
        });
    }

    update(time, dt, frame = {}) {
        this.uTime.value = Number.isFinite(time) ? time : this.uTime.value + Math.min(dt || 0, 0.1);
        this.uWarmth.value = Math.max(0, Math.min(2, frame.warmth || 0));
        this.uGust.value = Math.max(0, Math.min(2, frame.gust || 0));
        this.uShafts.value = Math.max(0, Math.min(2, frame.shafts || 0));
    }

    dispose() {
        this.group.removeFromParent();
        this.group.traverse((object) => {
            if (object.isInstancedMesh) object.dispose();
        });
        for (const resource of this.owned) resource.dispose();
        this.owned.clear();
        this.group.clear();
        this.built = false;
    }
}
