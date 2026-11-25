/**
 * Fall — the mushrooms of the grove.
 *
 * Four kinds, as an October wood has them, in the clusters each grows in:
 *
 *   fly agarics   scarlet caps flecked white on a white stem with a skirt, in twos and threes and
 *                 one fairy ring
 *   bonnets       troops of small pale bells on hair-thin stems: the lantern caps. Their gills
 *                 glow sea-green from dusk into the night, and when play calls the lights out
 *   honey tufts   honey-brown caps crowded on curving stems at the root flares of the old trees
 *   brackets      banded shelves stepping up the two great trunks, seated on the bark itself
 *
 * All of them are ONE instanced draw: the four shapes are laid in one geometry, each vertex marked
 * with its kind, and an instance folds the three shapes it is not to a point. So the grove's caps
 * cost one pipeline, as the pale discs they replace did. Their places come from a generator of
 * their own (the grove's random draws stay as they were).
 *
 * Drawn 3 times life (as the leaves and the squirrel are): a cap reads at fifteen metres.
 */
import * as THREE from 'three/webgpu';
import {
    abs, atan, attribute, color, cross, float, floor, fract, hash, instancedBufferAttribute, length, mix,
    normalGeometry, normalize, positionGeometry, positionLocal, saturate, sin, smoothstep, step, uv, varying,
    vec2,
} from 'three/tsl';

const TAU = Math.PI * 2;
export const FALL_CAP_KINDS = Object.freeze(['agaric', 'bonnet', 'honey', 'bracket']);
/** The share of a tier's caps each kind takes (brackets are a fixed few per great tree). */
const KIND_SHARE = Object.freeze({ agaric: 0.28, bonnet: 0.36, honey: 0.36 });
const ZONE = Object.freeze({ stem: 0, cap: 1, gill: 2 });
/** The near foreground the squirrel's log and stump stand in: no cluster is planted there. */
const KEPT_CLEAR = Object.freeze({
    minZ: 6.4, maxZ: 12, minX: 1.5, maxX: 7.6,
});

/** A small seeded generator (mulberry32) for the caps' own places. */
function seeded(seed) {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6D2B79F5) >>> 0;
        let t = Math.imul(state ^ (state >>> 15), state | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Turn a profile round its axis. A profile point is [radius, height, zone, radial, shade]: `radial`
 * runs 0 at a cap's middle to 1 at its rim (up a stem: 0 at the foot, 1 at the top). `bend(y)` leans
 * the whole ring sideways (a curving stem).
 */
function lathe(arrays, kind, profile, segments, bend = null) {
    const first = arrays.position.length / 3;
    const rings = profile.length;
    for (let ring = 0; ring < rings; ring += 1) {
        const [radius, y, zone, radial, shade] = profile[ring];
        const before = profile[Math.max(0, ring - 1)];
        const after = profile[Math.min(rings - 1, ring + 1)];
        // The profile's own normal (it runs foot to crown, anticlockwise seen from +x).
        let nr = after[1] - before[1];
        let ny = before[0] - after[0];
        const size = Math.hypot(nr, ny) || 1;
        nr /= size;
        ny /= size;
        const lean = bend ? bend(y) : 0;
        for (let column = 0; column <= segments; column += 1) {
            const angle = (column / segments) * TAU;
            const c = Math.cos(angle);
            const s = Math.sin(angle);
            arrays.position.push(radius * c + lean, y, radius * s);
            arrays.normal.push(nr * c, ny, nr * s);
            arrays.part.push(kind, zone, radial, shade);
        }
    }
    for (let ring = 0; ring < rings - 1; ring += 1) {
        for (let column = 0; column < segments; column += 1) {
            const a = first + ring * (segments + 1) + column;
            const b = a + 1;
            const c = a + segments + 1;
            const d = c + 1;
            arrays.index.push(a, c, b, b, c, d);
        }
    }
}

/** A fly agaric: a bulb, a stem with a skirt, pale gills, a broad cap gone nearly flat. */
function agaric(arrays) {
    lathe(arrays, 0, [
        [0.0, 0.0, ZONE.stem, 0, 0.5], [0.062, 0.0, ZONE.stem, 0, 0.55], [0.07, 0.035, ZONE.stem, 0.1, 0.7],
        [0.045, 0.085, ZONE.stem, 0.3, 0.85], [0.036, 0.19, ZONE.stem, 0.6, 0.9],
        // The skirt.
        [0.036, 0.205, ZONE.stem, 0.7, 0.9], [0.066, 0.186, ZONE.stem, 0.72, 0.8], [0.036, 0.215, ZONE.stem, 0.75, 0.7],
        [0.032, 0.265, ZONE.stem, 1, 0.55],
        // Gills out to the rim, then the cap over them.
        [0.032, 0.266, ZONE.gill, 0.1, 0.5], [0.12, 0.258, ZONE.gill, 0.6, 0.75], [0.212, 0.262, ZONE.gill, 1, 1],
        [0.22, 0.268, ZONE.cap, 1, 1], [0.214, 0.296, ZONE.cap, 0.94, 1], [0.17, 0.33, ZONE.cap, 0.75, 1],
        [0.095, 0.352, ZONE.cap, 0.42, 1], [0.0, 0.36, ZONE.cap, 0, 1],
    ], 14);
}

/** A bonnet: a hair-thin stem and a small bell, striate at the rim. */
function bonnet(arrays) {
    const lean = (y) => 0.03 * (y / 0.3) ** 2;
    lathe(arrays, 1, [
        [0.0, 0.0, ZONE.stem, 0, 0.5], [0.012, 0.0, ZONE.stem, 0, 0.6], [0.009, 0.15, ZONE.stem, 0.5, 0.85],
        [0.008, 0.292, ZONE.stem, 1, 0.6],
        [0.008, 0.293, ZONE.gill, 0.1, 0.55], [0.07, 0.268, ZONE.gill, 1, 1],
        [0.074, 0.27, ZONE.cap, 1, 1], [0.066, 0.3, ZONE.cap, 0.8, 1], [0.045, 0.335, ZONE.cap, 0.5, 1],
        [0.018, 0.356, ZONE.cap, 0.2, 1], [0.0, 0.362, ZONE.cap, 0, 1],
    ], 9, lean);
}

/** One of a honey tuft: a stem that curves out from the tuft's foot, a rounded cap with a boss. */
function honey(arrays) {
    const lean = (y) => 0.22 * (Math.min(y, 0.26) / 0.26) ** 1.7;
    lathe(arrays, 2, [
        [0.0, 0.0, ZONE.stem, 0, 0.35], [0.022, 0.0, ZONE.stem, 0, 0.4], [0.02, 0.12, ZONE.stem, 0.5, 0.7],
        [0.022, 0.235, ZONE.stem, 1, 0.55],
        [0.022, 0.236, ZONE.gill, 0.1, 0.5], [0.098, 0.226, ZONE.gill, 1, 1],
        [0.104, 0.23, ZONE.cap, 1, 1], [0.098, 0.255, ZONE.cap, 0.85, 1], [0.066, 0.288, ZONE.cap, 0.55, 1],
        [0.026, 0.302, ZONE.cap, 0.22, 1], [0.0, 0.31, ZONE.cap, 0, 1],
    ], 10, lean);
}

/**
 * A bracket: a half shelf that grows out of the bark along +z, its back edge in the plane z = 0. The
 * top is domed and banded, the underside pale and flat.
 */
function bracket(arrays) {
    const first = arrays.position.length / 3;
    const fan = 12;
    const rows = 4;
    const half = 0.26;
    const reach = 0.24;
    const vertex = (x, y, z, ny, zone, radial, shade, ox, oz) => {
        const n = new THREE.Vector3(ox * 0.5, ny, oz * 0.5).normalize();
        arrays.position.push(x, y, z);
        arrays.normal.push(n.x, n.y, n.z);
        arrays.part.push(3, zone, radial, shade);
    };
    // Top (rows from the bark out to the rim), then the underside the same way.
    for (const [zone, sign] of [[ZONE.cap, 1], [ZONE.gill, -1]]) {
        for (let row = 0; row <= rows; row += 1) {
            const radial = row / rows;
            for (let column = 0; column <= fan; column += 1) {
                const angle = (column / fan) * Math.PI;
                const ox = Math.cos(angle);
                const oz = Math.sin(angle);
                // Thick where it leaves the bark, thinning to the rim.
                const thick = 0.1 * (1 - radial) ** 1.3 + 0.012;
                const y = sign > 0 ? thick + 0.012 * Math.sin(radial * Math.PI) : -0.02 * (1 - radial);
                vertex(
                    ox * half * radial,
                    y,
                    oz * reach * radial,
                    sign * (0.55 + 0.45 * (1 - radial)),
                    zone,
                    radial,
                    sign > 0 ? 1 : 0.6,
                    ox * radial,
                    oz * radial,
                );
            }
        }
    }
    for (let sheet = 0; sheet < 2; sheet += 1) {
        const base = first + sheet * (rows + 1) * (fan + 1);
        for (let row = 0; row < rows; row += 1) {
            for (let column = 0; column < fan; column += 1) {
                const a = base + row * (fan + 1) + column;
                const b = a + 1;
                const c = a + fan + 1;
                const d = c + 1;
                arrays.index.push(a, b, c, b, d, c);
            }
        }
    }
}

/** The four shapes in one geometry; `aPart` is (kind, zone, radial, shade) for every vertex. */
export function fallMushroomGeometry() {
    const arrays = {
        position: [], normal: [], part: [], index: [],
    };
    agaric(arrays);
    bonnet(arrays);
    honey(arrays);
    bracket(arrays);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(arrays.position, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(arrays.normal, 3));
    geometry.setAttribute('aPart', new THREE.Float32BufferAttribute(arrays.part, 4));
    geometry.setIndex(arrays.index);
    geometry.computeBoundingSphere();
    geometry.name = 'FallMushrooms';
    return geometry;
}

/**
 * Where a horizontal ray toward a tree's axis at a height meets its bark: the point and the bark's
 * outward normal there (both in the tree's own space), or null. A plain walk over the triangles
 * whose heights span the ray's (a few thousand of a trunk's forty thousand).
 */
export function barkHit(positions, index, height, angle, limit = index.length) {
    const ox = Math.cos(angle) * 6;
    const oz = Math.sin(angle) * 6;
    const dx = -Math.cos(angle);
    const dz = -Math.sin(angle);
    let best = Infinity;
    let hit = null;
    for (let i = 0; i + 2 < limit; i += 3) {
        const a = index[i] * 3;
        const b = index[i + 1] * 3;
        const c = index[i + 2] * 3;
        const ay = positions[a + 1];
        const by = positions[b + 1];
        const cy = positions[c + 1];
        if ((ay < height && by < height && cy < height) || (ay > height && by > height && cy > height)) continue;
        // Moeller-Trumbore, the ray in the plane y = height.
        const e1x = positions[b] - positions[a];
        const e1y = by - ay;
        const e1z = positions[b + 2] - positions[a + 2];
        const e2x = positions[c] - positions[a];
        const e2y = cy - ay;
        const e2z = positions[c + 2] - positions[a + 2];
        const px = -dz * e2y;
        const py = dz * e2x - dx * e2z;
        const pz = dx * e2y;
        const det = e1x * px + e1y * py + e1z * pz;
        if (Math.abs(det) < 1e-9) continue;
        const inv = 1 / det;
        const tx = ox - positions[a];
        const ty = height - ay;
        const tz = oz - positions[a + 2];
        const u = (tx * px + ty * py + tz * pz) * inv;
        if (u < 0 || u > 1) continue;
        const qx = ty * e1z - tz * e1y;
        const qy = tz * e1x - tx * e1z;
        const qz = tx * e1y - ty * e1x;
        const v = (dx * qx + dz * qz) * inv;
        if (v < 0 || u + v > 1) continue;
        const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
        if (t > 0.01 && t < best) {
            best = t;
            let nx = e1y * e2z - e1z * e2y;
            let ny = e1z * e2x - e1x * e2z;
            let nz = e1x * e2y - e1y * e2x;
            const size = Math.hypot(nx, ny, nz) || 1;
            nx /= size;
            ny /= size;
            nz /= size;
            // (Outward: against the ray.)
            if (nx * dx + nz * dz > 0) {
                nx = -nx;
                ny = -ny;
                nz = -nz;
            }
            hit = { point: [ox + dx * t, height, oz + dz * t], normal: [nx, ny, nz] };
        }
    }
    return hit;
}

/**
 * Where every cap stands. Returns rows of { kind, x, y, z, scale, quaternion, tone, phase, glow }
 * and the pools of light the lantern troops and tufts lay on the floor at night.
 *
 * @param {object} o
 * @param {number} o.count            caps in all (brackets come on top: a fixed few a great tree)
 * @param {{x:number,z:number,yaw:number,scale:number,asset:string}[]} o.hosts   the two great trees
 * @param {Record<string, any>} [o.trees]    the tree assets (bark geometry and trunk radius), for the brackets
 * @param {(x:number,z:number)=>number} o.groundHeight
 * @param {(x:number,z:number)=>number} o.pathDistance
 * @param {number[]} [o.eye]          the game's eye (x, y, z): caps keep to the side of a trunk it sees
 * @param {number} [o.seed]
 */
export function layoutFallMushrooms({
    count, hosts, trees = null, groundHeight, pathDistance, eye = [0, 2.6, 15], seed = 0x5eed,
}) {
    const random = seeded(seed);
    const range = (lo, hi) => lo + (hi - lo) * random();
    const caps = [];
    const pools = [];
    const q = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const clear = (x, z) => !(z > KEPT_CLEAR.minZ && z < KEPT_CLEAR.maxZ
        && Math.abs(x) > KEPT_CLEAR.minX && Math.abs(x) < KEPT_CLEAR.maxX);
    const stand = (kind, x, z, scale, yaw, tilt = 0.12, glow = 1) => {
        euler.set((random() - 0.5) * tilt * 2, yaw, (random() - 0.5) * tilt * 2, 'YXZ');
        q.setFromEuler(euler);
        caps.push({
            kind: FALL_CAP_KINDS.indexOf(kind),
            x,
            y: groundHeight(x, z) - 0.012 * scale,
            z,
            scale,
            quaternion: [q.x, q.y, q.z, q.w],
            tone: random(),
            phase: random(),
            glow,
        });
    };
    /** A troop of bonnets: a loose drift of small bells. */
    const troop = (cx, cz, size) => {
        const lean = random() * TAU;
        for (let i = 0; i < size; i += 1) {
            const angle = random() * TAU;
            const radius = 0.12 + random() ** 0.7 * 0.75;
            stand(
                'bonnet',
                cx + Math.cos(angle) * radius * 1.5,
                cz + Math.sin(angle) * radius,
                range(0.75, 1.55),
                lean + range(-0.9, 0.9),
                0.2,
            );
        }
        pools.push({
            x: cx, z: cz, radius: 1.5, kind: 1,
        });
    };
    /** A tuft of honey fungus: stems fanning from one foot. */
    const tuft = (cx, cz, size, toward) => {
        for (let i = 0; i < size; i += 1) {
            const fan = toward + range(-1.5, 1.5);
            const out = range(0.0, 0.1);
            // (The stem's bend is along its own +x: turn that the way the stem leans.)
            stand('honey', cx + Math.cos(fan) * out, cz + Math.sin(fan) * out, range(0.9, 1.7), -fan, 0.16);
        }
        pools.push({
            x: cx + Math.cos(toward) * 0.3, z: cz + Math.sin(toward) * 0.3, radius: 1.3, kind: 2,
        });
    };
    /** Agarics in twos and threes: one grown, the others younger. */
    const clump = (cx, cz, size) => {
        for (let i = 0; i < size; i += 1) {
            const angle = random() * TAU;
            const radius = i === 0 ? 0 : range(0.3, 0.8);
            stand(
                'agaric',
                cx + Math.cos(angle) * radius,
                cz + Math.sin(angle) * radius,
                i === 0 ? range(1.25, 1.75) : range(0.7, 1.2),
                random() * TAU,
                0.14,
                0.5,
            );
        }
    };

    const budget = {
        agaric: Math.max(2, Math.round(count * KIND_SHARE.agaric)),
        bonnet: Math.max(3, Math.round(count * KIND_SHARE.bonnet)),
        honey: Math.max(3, Math.round(count * KIND_SHARE.honey)),
    };
    const used = () => caps.length;

    // At the feet of the two great trees, on the side the eye sees: honey tufts tight against the
    // root flares, agarics a step out, a troop of bonnets in the moss between.
    let start = used();
    hosts.forEach((host, index) => {
        const face = Math.atan2(eye[2] - host.z, eye[0] - host.x);
        const tufts = Math.max(1, Math.round(budget.honey / (hosts.length * 7)));
        for (let i = 0; i < tufts; i += 1) {
            const angle = face + (i - (tufts - 1) / 2) * 0.62 + range(-0.12, 0.12);
            const reach = 1.55 + range(0, 0.45);
            const size = Math.min(7, Math.max(3, Math.round(budget.honey / (hosts.length * tufts))));
            tuft(host.x + Math.cos(angle) * reach, host.z + Math.sin(angle) * reach, size, angle);
        }
        const side = index === 0 ? 1 : -1;
        clump(host.x + Math.cos(face + side * 0.9) * 3.1, host.z + Math.sin(face + side * 0.9) * 3.1, 3);
        troop(
            host.x + Math.cos(face - side * 0.7) * 2.7,
            host.z + Math.sin(face - side * 0.7) * 2.7,
            Math.max(4, Math.round(budget.bonnet / 9)),
        );
    });
    // A fairy ring left of the path, where the floor opens (it reads as a ring from the eye's height).
    const ring = Math.min(11, Math.max(0, budget.agaric - 6));
    for (let i = 0; i < ring; i += 1) {
        const angle = (i / ring) * TAU + range(-0.12, 0.12);
        const radius = 2.3 + range(-0.15, 0.15);
        stand(
            'agaric',
            -15.5 + Math.cos(angle) * radius,
            -1.5 + Math.sin(angle) * radius * 0.92,
            range(0.85, 1.4),
            random() * TAU,
            0.14,
            0.5,
        );
    }
    // The rest over the near floor on both sides of the board, off the path and out of the squirrel's
    // foreground.
    const scatter = (kind, left, make) => {
        for (let attempt = 0; left() > 0 && attempt < 200; attempt += 1) {
            const sideSign = random() < 0.5 ? -1 : 1;
            const z = 5.5 - random() ** 1.3 * 22;
            const x = sideSign * (3.2 + random() * (11 + Math.max(0, -z) * 0.5));
            if (pathDistance(x, z) < 2.6 || !clear(x, z)) continue;
            make(x, z);
        }
    };
    start = used();
    const count0 = { agaric: caps.filter((c) => c.kind === 0).length };
    scatter(
        'agaric',
        () => budget.agaric - (count0.agaric + caps.slice(start).filter((c) => c.kind === 0).length),
        (x, z) => clump(x, z, 1 + Math.floor(random() * 3)),
    );
    start = used();
    const bonnets0 = caps.filter((c) => c.kind === 1).length;
    scatter(
        'bonnet',
        () => budget.bonnet - (bonnets0 + caps.slice(start).length),
        (x, z) => troop(x, z, 5 + Math.floor(random() * 5)),
    );
    start = used();
    const honey0 = caps.filter((c) => c.kind === 2).length;
    scatter(
        'honey',
        () => budget.honey - (honey0 + caps.slice(start).length),
        (x, z) => tuft(x, z, 4 + Math.floor(random() * 4), random() * TAU),
    );

    // Brackets stepping up the two great trunks, on the side toward the eye and away from the board
    // (the squirrel keeps to the board's side of each trunk).
    if (trees) {
        const matrix = new THREE.Matrix4();
        const inverse = new THREE.Matrix4();
        const point = new THREE.Vector3();
        const normal = new THREE.Vector3();
        const across = new THREE.Vector3();
        const up = new THREE.Vector3(0, 1, 0);
        const basis = new THREE.Matrix4();
        hosts.forEach((host) => {
            const asset = trees[host.asset];
            const bark = asset?.bark;
            if (!bark?.index) return;
            const base = groundHeight(host.x, host.z);
            matrix.compose(
                new THREE.Vector3(host.x, base, host.z),
                new THREE.Quaternion().setFromAxisAngle(up, host.yaw),
                new THREE.Vector3(1, 1, 1).multiplyScalar(host.scale),
            );
            inverse.copy(matrix).invert();
            // The direction to the eye, turned outward from the board, in the tree's own space.
            const away = host.x < 0 ? 1 : -1;
            const toEye = Math.atan2(eye[2] - host.z, eye[0] - host.x) + away * 0.55;
            const local = toEye + host.yaw;
            const limit = asset.barkCoreIndices > 0 ? asset.barkCoreIndices : bark.index.count;
            for (let i = 0; i < 5; i += 1) {
                const height = (0.75 + i * 0.42 + range(-0.08, 0.08)) / host.scale;
                const angle = local + (i % 2 ? 0.16 : -0.14) + range(-0.1, 0.1);
                const hit = barkHit(bark.attributes.position.array, bark.index.array, height, angle, limit);
                if (!hit) continue;
                point.fromArray(hit.point).applyMatrix4(matrix);
                normal.fromArray(hit.normal).transformDirection(matrix);
                normal.y = 0;
                if (normal.lengthSq() < 1e-6) continue;
                normal.normalize();
                across.crossVectors(up, normal).normalize();
                basis.makeBasis(across, up, normal);
                q.setFromRotationMatrix(basis);
                // A little droop, and seated a finger deep in the bark.
                q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), range(0.05, 0.22)));
                caps.push({
                    kind: 3,
                    x: point.x - normal.x * 0.03,
                    y: point.y,
                    z: point.z - normal.z * 0.03,
                    scale: range(0.7, 1.25) * (1 - i * 0.07),
                    quaternion: [q.x, q.y, q.z, q.w],
                    tone: random(),
                    phase: random(),
                    glow: 0.25,
                });
            }
        });
    }
    return { caps, pools };
}

/** Rotate a vector by a unit quaternion (TSL). */
function rotate(vector, quaternion) {
    const axis = quaternion.xyz;
    return vector.add(cross(axis, cross(axis, vector).add(vector.mul(quaternion.w))).mul(2));
}

/**
 * The caps' material and mesh. `shade(albedo, normal, { translucent })` is the understory's own
 * lighting; `light` gives the glimmer (uGlim) the lantern gills burn with.
 */
export function createFallMushrooms({ light, shade, layout }) {
    const { caps } = layout;
    const count = Math.max(1, caps.length);
    const geometry = fallMushroomGeometry();
    const placeData = new Float32Array(count * 4);
    const turnData = new Float32Array(count * 4);
    const lookData = new Float32Array(count * 4);
    caps.forEach((cap, i) => {
        placeData.set([cap.x, cap.y, cap.z, cap.scale], i * 4);
        turnData.set(cap.quaternion, i * 4);
        lookData.set([cap.kind, cap.tone, cap.phase, cap.glow], i * 4);
    });
    const place = instancedBufferAttribute(new THREE.InstancedBufferAttribute(placeData, 4));
    const turn = instancedBufferAttribute(new THREE.InstancedBufferAttribute(turnData, 4));
    const look = instancedBufferAttribute(new THREE.InstancedBufferAttribute(lookData, 4));
    const part = attribute('aPart', 'vec4');
    const material = new THREE.MeshBasicNodeMaterial({ fog: false, side: THREE.DoubleSide });
    material.name = 'FallLanternCaps';
    // An instance keeps its own kind's shape and folds the others to its foot.
    const keep = float(1).sub(step(0.5, abs(part.x.sub(look.x))));
    material.positionNode = positionLocal.sub(positionGeometry)
        .add(rotate(positionGeometry.mul(place.w).mul(keep), turn)).add(place.xyz);
    const normal = normalize(varying(rotate(normalGeometry, turn)));

    const kind = varying(look.x);
    const tone = varying(look.y);
    const isBonnet = step(0.5, kind).mul(float(1).sub(step(1.5, kind)));
    const isHoney = step(1.5, kind).mul(float(1).sub(step(2.5, kind)));
    const isBracket = step(2.5, kind);
    const zone = part.y;
    const isCap = step(0.5, zone).mul(float(1).sub(step(1.5, zone)));
    const isGill = step(1.5, zone);
    const radial = saturate(part.z);
    const local = positionGeometry;
    const round = atan(local.z, local.x);

    // Fly agaric: scarlet, paler and more orange to the rim, flecked with the white warts of its veil.
    const cells = local.xz.mul(21).add(64);
    const cell = floor(cells);
    const id = cell.x.mul(57).add(cell.y.mul(113));
    const speck = fract(cells).sub(0.5).sub(vec2(hash(id), hash(id.add(7))).sub(0.5).mul(0.42));
    const wart = float(1).sub(smoothstep(0.13, 0.25, length(speck))).mul(step(0.4, hash(id.add(3))))
        .mul(float(1).sub(radial.mul(radial).mul(0.55)));
    const scarlet = mix(color(0xa30d08), color(0xd8420c), radial.mul(radial).mul(0.8).add(tone.mul(0.2)));
    const agaricCap = mix(scarlet, color(0xf3ead6), wart.mul(0.92));
    // Bonnet: a pale bell, darker at its crown, lined toward the rim.
    const lines = sin(round.mul(22)).mul(0.5).add(0.5).mul(smoothstep(0.35, 1, radial));
    const bonnetCap = mix(color(0x9a8364), color(0xdccfb2), smoothstep(0.05, 0.7, radial)).mul(lines.mul(-0.22).add(1));
    // Honey fungus: honey to tawny, a darker boss, fine scales.
    const scales = sin(round.mul(13).add(radial.mul(31))).mul(0.5).add(0.5).mul(float(1).sub(radial));
    const honeyCap = mix(color(0x6f3f12), color(0xc48a2e), smoothstep(0.1, 0.8, radial).mul(0.85).add(tone.mul(0.15)))
        .mul(scales.mul(-0.2).add(1));
    // Bracket: banded like a turkey's tail, a pale growing rim.
    const bands = sin(radial.mul(19).add(tone.mul(5))).mul(0.5).add(0.5);
    const bracketCap = mix(
        mix(color(0x33200f), color(0x86603a), bands),
        color(0xbfa97c),
        smoothstep(0.86, 0.99, radial),
    );
    const cap = mix(mix(mix(agaricCap, bonnetCap, isBonnet), honeyCap, isHoney), bracketCap, isBracket);
    const stem = mix(
        mix(color(0x8a7558), color(0xe6dcc6), smoothstep(0, 0.35, radial)),
        color(0x9a7a4c),
        isHoney.mul(0.6),
    );
    const gills = mix(mix(color(0xe9dfc6), color(0xd2c4a2), isHoney), color(0xa8966f), isBracket);
    const albedo = mix(mix(stem, cap, isCap), gills, isGill).mul(part.w);
    // The low sun shines through a thin cap toward its rim (a bonnet all over).
    const thin = isCap.mul(mix(radial.mul(radial).mul(0.5), float(0.9), isBonnet)).add(isGill.mul(0.4));
    // The lantern light: sea-green under the bonnets (and through their bells), amber under the
    // honey tufts, a trace under the rest. Out by day; it comes with the dusk, the night and play.
    const pulse = sin(light.uTime.mul(0.9).add(varying(look.z).mul(TAU))).mul(0.16).add(0.84);
    const lamp = mix(mix(color(0xffc27a), color(0x58e6ae), isBonnet), color(0xffb44e), isHoney);
    const burning = isGill.add(isCap.mul(isBonnet).mul(radial.mul(0.5).add(0.25)))
        .mul(varying(look.w)).mul(pulse).mul(light.uGlim)
        .mul(1.9);
    material.colorNode = shade(albedo, normal, { translucent: thin }).add(lamp.mul(burning));
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.name = 'FallLanternCaps';
    mesh.count = caps.length;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    return { mesh, geometry, material };
}

/**
 * The pools of light the troops and tufts lay on the floor: one soft additive disc a cluster, drawn
 * only while the small lights are out (the caller hides the mesh by day).
 */
export function createFallCapGlow({ light, pools, groundHeight }) {
    const count = Math.max(1, pools.length);
    const data = new Float32Array(count * 4);
    const tint = new Float32Array(count * 4);
    pools.forEach((pool, i) => {
        data.set([pool.x, groundHeight(pool.x, pool.z) + 0.05, pool.z, pool.radius], i * 4);
        tint.set([pool.kind, (i * 0.618) % 1, 0, 0], i * 4);
    });
    const place = instancedBufferAttribute(new THREE.InstancedBufferAttribute(data, 4));
    const look = instancedBufferAttribute(new THREE.InstancedBufferAttribute(tint, 4));
    const geometry = new THREE.PlaneGeometry(2, 2);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
    });
    material.name = 'FallCapGlow';
    material.positionNode = positionLocal.sub(positionGeometry).add(positionGeometry.mul(place.w)).add(place.xyz);
    const away = length(uv().sub(0.5)).mul(2);
    const soft = saturate(float(1).sub(away));
    const pulse = sin(light.uTime.mul(0.9).add(varying(look.y).mul(TAU))).mul(0.14).add(0.86);
    const lamp = mix(color(0x58e6ae), color(0xffb44e), step(1.5, varying(look.x)));
    material.colorNode = lamp;
    material.opacityNode = soft.mul(soft).mul(pulse).mul(light.uGlim).mul(0.42);
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.name = 'FallCapGlow';
    mesh.count = pools.length;
    mesh.renderOrder = 6;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.visible = false;
    return { mesh, geometry, material };
}
