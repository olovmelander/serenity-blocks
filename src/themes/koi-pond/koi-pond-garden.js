/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Koi Pond — the garden round the water: stones, the snow-viewing lantern, the old maple that
 * leans out over the left reach, the younger one behind the lantern, and iris at the water's
 * edge.
 *
 * Everything is grown here from numbers (no asset files): lumpy stones from a displaced
 * icosphere, the lantern from lathes and prisms, the maples from a few hand-set limbs that
 * throw twigs and real seven-lobed leaves — tens of thousands of triangles of leaf, one small
 * mesh drawn once per leaf, so their shadows on the bed are the shadows of leaves.
 *
 * planGarden() is plain data (and decides which stones stand in the water, which the waves and
 * the koi must go round); the create* functions turn it into meshes.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, abs, attribute, cameraPosition, clamp, cos, dot, float, max, mix, normalWorld, normalize, positionGeometry,
    positionWorld, pow, sin, smoothstep, step, uniform, uv, varying, vec3, vec4,
} from 'three/tsl';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import {
    TAU, groundHeight, hash2, mulberry32, shoreZ, waterDepth,
} from './koi-pond-core.js';
import { buildMapleLeafGeometry } from './koi-pond-flora.js';

// ── The plan ────────────────────────────────────────────────────────────────────────────────

/** Where the lantern stands (its foot), on the right bank. */
export const LANTERN_AT = Object.freeze({ x: 4.9, back: 0.3 });

/** The two maples: limbs as polylines [x, y, z, radius]. Tone band 0 = crimson, 1 = green-gold. */
const MAPLES = [
    {
        band: 0,
        share: 0.72,
        limbs: [
            [[-7.5, 0.3, -3.7, 0.19], [-7.05, 0.85, -3.3, 0.16], [-6.45, 1.3, -2.75, 0.13]],
            [[-6.45, 1.3, -2.75, 0.1], [-5.5, 1.55, -2.0, 0.075], [-4.4, 1.66, -1.2, 0.05], [-3.25, 1.55, -0.35, 0.026]],
            [[-6.45, 1.3, -2.75, 0.095], [-6.55, 1.85, -1.75, 0.07], [-6.2, 2.08, -0.7, 0.048], [-5.5, 2.06, 0.45, 0.024]],
            [[-6.2, 2.08, -0.7, 0.04], [-7.0, 2.2, 0.1, 0.03], [-7.5, 2.12, 1.1, 0.018]],
            [[-6.8, 1.1, -3.0, 0.085], [-7.9, 1.7, -2.4, 0.062], [-8.9, 1.98, -1.5, 0.042], [-9.7, 2.02, -0.4, 0.022]],
            [[-6.6, 1.2, -2.9, 0.08], [-5.7, 2.05, -3.5, 0.058], [-4.5, 2.4, -3.95, 0.038], [-3.1, 2.42, -4.2, 0.02]],
            [[-5.5, 1.55, -2.0, 0.05], [-4.9, 1.95, -2.6, 0.034], [-3.9, 2.05, -2.9, 0.018]],
        ],
    },
    {
        band: 1,
        share: 0.28,
        limbs: [
            [[8.4, 0.5, -2.9, 0.13], [8.0, 1.0, -2.5, 0.105], [7.5, 1.4, -2.05, 0.085]],
            [[7.5, 1.4, -2.05, 0.07], [6.8, 1.7, -1.4, 0.05], [6.0, 1.82, -0.75, 0.03], [5.3, 1.78, -0.15, 0.018]],
            [[7.5, 1.4, -2.05, 0.065], [8.2, 1.85, -1.2, 0.045], [8.6, 2.0, -0.2, 0.022]],
            [[7.8, 1.2, -2.3, 0.06], [6.9, 1.9, -2.7, 0.04], [5.8, 2.15, -3.1, 0.02]],
        ],
    },
];

/**
 * Decide where everything in the garden stands. Pure data.
 * @returns {{ rocks: Array, standing: Array, lantern: {x:number,y:number,z:number,flame:number[]}, iris: Array }}
 */
export function planGarden(seed = 1873) {
    const rand = mulberry32(seed);
    const rocks = [];
    const add = (x, z, radius, sink, squash = 0.62, moss = 0.6) => {
        const y = groundHeight(x, z) - radius * squash * sink;
        rocks.push({
            x, y, z, radius, squash, turn: rand() * TAU, tone: rand(), moss, shape: Math.floor(rand() * 3),
        });
    };
    // A broken line of stones along the waterline.
    for (let x = -11.2; x < 11.2; x += 0.55 + rand() * 0.75) {
        const radius = 0.16 + rand() ** 1.7 * 0.42;
        const z = shoreZ(x) + (rand() - 0.6) * 0.5;
        if (Math.abs(x - LANTERN_AT.x) < 0.75) continue;
        add(x, z, radius, 0.35 + rand() * 0.3, 0.5 + rand() * 0.3, 0.3 + rand() * 0.7);
    }
    // Boulders up the bank.
    [[-4.0, 1.5, 0.82], [-1.2, 1.9, 0.6], [2.3, 1.45, 0.72], [7.2, 1.4, 0.85], [-9.4, 1.6, 0.9], [9.9, 1.7, 0.8], [0.6, 2.9, 0.95],
        [-2.6, 3.1, 0.7], [4.2, 2.6, 0.75]].forEach(([x, back, radius]) => {
        add(x, shoreZ(x) - back, radius, 0.3, 0.62, 0.9);
    });
    // Stones standing in the water: the koi go round them, the rings break on them.
    const standing = [];
    [[-7.15, -0.55, 0.5], [-7.75, -0.05, 0.3], [6.75, 1.25, 0.44], [2.05, -2.65, 0.34], [-2.15, -2.45, 0.3], [8.0, 1.0, 0.4]]
        .forEach(([x, z, radius]) => {
            const depth = waterDepth(x, z);
            if (depth < 0.12) return; // (a standing stone stands in water)
            // The stone sits on the bed and shows a quarter of itself.
            const squash = 0.7;
            const y = radius * squash * 0.36 - 0.0;
            rocks.push({
                x,
                y: Math.max(y, -depth + radius * squash * 0.5),
                z,
                radius,
                squash,
                turn: rand() * TAU,
                tone: rand(),
                moss: 0.75,
                shape: Math.floor(rand() * 3),
            });
            standing.push({ x, z, radius: radius * 0.92 });
        });

    // The lantern stands at the very edge of the water, on a flat stone of its own.
    const lx = LANTERN_AT.x;
    const lz = shoreZ(lx) - LANTERN_AT.back;
    rocks.push({
        x: lx, y: groundHeight(lx, lz) - 0.12, z: lz, radius: 0.58, squash: 0.4, turn: 0.7, tone: 0.55, moss: 0.5, shape: 1,
    });
    const ly = groundHeight(lx, lz) + 0.07;
    const lantern = {
        x: lx, y: ly, z: lz, flame: [lx, ly + 0.6, lz],
    };

    // Iris and rush in clumps where the bank meets the water.
    const iris = [];
    for (let x = -10.8; x < 10.8; x += 0.5 + rand() * 1.1) {
        if (Math.abs(x - lx) < 0.6 || rand() < 0.3) continue;
        const z = shoreZ(x) + (rand() - 0.35) * 0.5;
        iris.push({
            x, z, y: Math.max(groundHeight(x, z), -0.08), blades: 5 + Math.floor(rand() * 7), height: 0.42 + rand() * 0.5, seed: rand(),
        });
    }
    return {
        rocks, standing, lantern, iris,
    };
}

// ── Stone: rocks and the lantern in one mesh ────────────────────────────────────────────────

function lattice3(seed) {
    return (x, y, z) => {
        const xi = Math.floor(x);
        const yi = Math.floor(y);
        const zi = Math.floor(z);
        const fx = x - xi;
        const fy = y - yi;
        const fz = z - zi;
        const sx = fx * fx * (3 - 2 * fx);
        const sy = fy * fy * (3 - 2 * fy);
        const sz = fz * fz * (3 - 2 * fz);
        const h = (i, j, k) => hash2(i * 157 + k * 31 + seed, j * 113 + k * 71);
        const lerp = (a, b, t) => a + (b - a) * t;
        return lerp(
            lerp(lerp(h(xi, yi, zi), h(xi + 1, yi, zi), sx), lerp(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), sx), sy),
            lerp(lerp(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), sx), lerp(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), sx), sy),
            sz,
        );
    };
}

/** A lumpy unit stone (indexed, smooth normals). */
function buildRockShape(variant) {
    const noise = lattice3(variant * 977 + 13);
    const geometry = mergeVertices(new THREE.IcosahedronGeometry(1, 3));
    const pos = geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i += 1) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const z = pos.getZ(i);
        const lump = 1 + 0.42 * (noise(x * 1.15 + 5, y * 1.15 + 5, z * 1.15 + 5) - 0.5)
            + 0.2 * (noise(x * 2.7 + 9, y * 2.7 + 9, z * 2.7 + 9) - 0.5)
            + 0.07 * (noise(x * 6.5 + 3, y * 6.5 + 3, z * 6.5 + 3) - 0.5);
        // Flatter underneath than on top.
        const settle = y < 0 ? 0.72 : 1;
        pos.setXYZ(i, x * lump, y * lump * settle, z * lump);
    }
    geometry.computeVertexNormals();
    return geometry;
}

/** The snow-viewing lantern's stone, as pieces to merge: [geometry, matrix]. */
function buildLanternPieces(lantern) {
    const pieces = [];
    const at = new THREE.Matrix4().makeTranslation(lantern.x, lantern.y, lantern.z);
    const piece = (geometry, x, y, z, rx = 0, ry = 0, rz = 0) => {
        const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz))
            .setPosition(x, y, z).premultiply(at);
        pieces.push([geometry, m]);
    };
    // Four splayed legs.
    for (let k = 0; k < 4; k += 1) {
        const a = (k / 4) * TAU + 0.4;
        const leg = new THREE.CylinderGeometry(0.045, 0.07, 0.4, 6);
        piece(leg, Math.cos(a) * 0.24, 0.19, Math.sin(a) * 0.24, Math.sin(a) * 0.42, 0, -Math.cos(a) * 0.42);
    }
    piece(new THREE.CylinderGeometry(0.3, 0.33, 0.07, 6), 0, 0.42, 0);
    // The light box: six posts and a lintel; the windows between them are drawn separately.
    for (let k = 0; k < 6; k += 1) {
        const a = (k / 6) * TAU;
        piece(new THREE.BoxGeometry(0.045, 0.24, 0.045), Math.cos(a) * 0.19, 0.575, Math.sin(a) * 0.19, 0, -a, 0);
    }
    piece(new THREE.CylinderGeometry(0.23, 0.22, 0.04, 6), 0, 0.715, 0);
    // The roof: a wide shallow umbrella that turns up at the eaves.
    // (A lathe faces outward when its profile climbs: underside first, then up to the peak.)
    const roof = [new THREE.Vector2(0.2, -0.02), new THREE.Vector2(0.6, -0.02)];
    for (let i = 8; i >= 0; i -= 1) {
        const t = i / 8;
        roof.push(new THREE.Vector2(0.02 + t * 0.6, 0.2 * (1 - t) ** 1.7 + 0.035 * t * t * t));
    }
    piece(new THREE.LatheGeometry(roof, 6), 0, 0.745, 0, 0, TAU / 12, 0);
    piece(new THREE.SphereGeometry(0.06, 8, 6), 0, 0.985, 0);
    return pieces;
}

export function createStones(light, plan) {
    const { u } = light;
    const shapes = [0, 1, 2].map(buildRockShape);
    const positions = [];
    const normals = [];
    const tones = [];
    const indices = [];
    const v = new THREE.Vector3();
    const n = new THREE.Vector3();
    const normalMatrix = new THREE.Matrix3();
    const append = (geometry, matrix, tone, moss, flat = 0) => {
        const offset = positions.length / 3;
        const pos = geometry.getAttribute('position');
        const nor = geometry.getAttribute('normal');
        normalMatrix.getNormalMatrix(matrix);
        for (let i = 0; i < pos.count; i += 1) {
            v.fromBufferAttribute(pos, i).applyMatrix4(matrix);
            n.fromBufferAttribute(nor, i).applyMatrix3(normalMatrix).normalize();
            positions.push(v.x, v.y, v.z);
            normals.push(n.x, n.y, n.z);
            tones.push(tone, moss, flat);
        }
        const index = geometry.getIndex();
        if (index) for (let i = 0; i < index.count; i += 1) indices.push(offset + index.getX(i));
        else for (let i = 0; i < pos.count; i += 1) indices.push(offset + i);
    };
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    plan.rocks.forEach((rock) => {
        q.setFromEuler(new THREE.Euler((rock.tone - 0.5) * 0.4, rock.turn, (rock.moss - 0.5) * 0.3));
        m.compose(new THREE.Vector3(rock.x, rock.y, rock.z), q, new THREE.Vector3(
            rock.radius * (0.9 + rock.tone * 0.3),
            rock.radius * rock.squash,
            rock.radius * (1.1 - rock.tone * 0.25),
        ));
        append(shapes[rock.shape], m, rock.tone, rock.moss);
    });
    const lanternPieces = buildLanternPieces(plan.lantern);
    lanternPieces.forEach(([geometry, matrix]) => append(geometry, matrix, 0.72, 0.45, 1));

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normals), 3));
    geometry.setAttribute('aStone', new THREE.BufferAttribute(new Float32Array(tones), 3));
    geometry.setIndex(indices);
    const vStone = varying(attribute('aStone', 'vec3'), 'vStone');

    const paint = Fn(() => {
        const point = positionWorld.toVar();
        const normal = normalize(normalWorld).toVar();
        const view = normalize(cameraPosition.sub(point)).toVar();
        const under = smoothstep(0.012, -0.012, point.y).toVar();
        const depth = max(point.y.negate(), 0.0).toVar();
        const grain = light.noise.sample(point.xz.mul(0.55).add(point.y.mul(0.37))).toVar();
        const speck = light.noise.sample(point.xz.mul(2.3).add(point.y.mul(1.9)));
        // Granite greys, a few warmer and a few nearly black.
        const stone = mix(vec3(0.06, 0.065, 0.072), vec3(0.17, 0.16, 0.145), vStone.x)
            .mul(grain.g.mul(0.6).add(0.7)).mul(speck.a.mul(0.3).add(0.85)).toVar();
        // Moss lies on what faces the sky, above the splash line; lichen spots the rest.
        const upward = smoothstep(0.1, 0.7, normal.y.add(grain.r.sub(0.5).mul(0.6)));
        const mossy = upward.mul(smoothstep(0.03, 0.16, point.y)).mul(vStone.y.mul(0.5).add(0.5))
            .mul(smoothstep(0.12, 0.4, grain.b.add(vStone.y.mul(0.45))));
        const moss = mix(vec3(0.03, 0.085, 0.022), vec3(0.085, 0.17, 0.035), speck.r);
        const dry = mix(stone, moss, mossy.mul(0.92));
        // Wet and dark where the water has been; green-brown below it.
        const wet = smoothstep(0.1, 0.0, point.y).mul(under.oneMinus());
        const above = dry.mul(mix(1.0, 0.5, wet));
        const sunk = stone.mul(vec3(0.5, 0.7, 0.52));
        const skin = mix(above, sunk, under);

        const lit = light.moonlight().toVar();
        const toMoon = normalize(mix(u.moonDir, normalize(vec3(u.underSlope.x, 1.0, u.underSlope.y)), under));
        const ndl = clamp(dot(normal, toMoon), 0.0, 1.0);
        const gathered = mix(float(1.0), light.caustic(point), under);
        const moon = u.moonColor.mul(ndl).mul(gathered).mul(lit).mul(light.downwelling(depth))
            .mul(u.breath.mul(0.8).add(0.2));
        const ambient = mix(u.skyAmbient, u.waterAmbient, under).mul(normal.y.mul(0.4).add(0.6));
        // The moss's nap and the wet stone each give a little of the moon back.
        const half = normalize(toMoon.add(view));
        const gloss = pow(clamp(dot(normal, half), 0.0, 1.0), 26.0).mul(wet.mul(0.9).add(0.06)).mul(under.oneMinus());
        const fuzz = pow(float(1.0).sub(clamp(dot(normal, view), 0.0, 1.0)), 3.0).mul(mossy).mul(0.07);
        const colour = skin.mul(moon.add(ambient).add(light.lantern(point, normal).mul(1.7)).add(light.ringLight(point.xz).mul(0.6)))
            .add(u.moonColor.mul(gloss.add(fuzz)).mul(lit));
        return vec4(colour, 1.0);
    });

    const material = new THREE.MeshBasicNodeMaterial({ fog: false });
    material.name = 'Koi Pond — stone';
    material.fragmentNode = paint();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'Koi Pond — stones and lantern';
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrixWorld(true);
    return {
        mesh,
        geometry,
        material,
        dispose() {
            shapes.forEach((s) => s.dispose());
            lanternPieces.forEach(([g]) => g.dispose());
        },
    };
}

/** The lantern's paper windows: the one warm light in the garden. */
export function createLanternGlow(light, plan) {
    const { u } = light;
    const { lantern } = plan;
    const geometry = new THREE.CylinderGeometry(0.17, 0.17, 0.2, 6, 1, true);
    const flicker = uniform(1);
    const material = new THREE.MeshBasicNodeMaterial({ fog: false, side: THREE.DoubleSide });
    material.name = 'Koi Pond — lantern windows';
    material.fragmentNode = Fn(() => {
        // Brightest at the flame's height, with the paper's weave across it.
        const v = uv().y;
        const core = float(1.0).sub(abs(v.sub(0.42)).mul(1.5)).max(0.2);
        const weave = sin(uv().x.mul(180.0)).mul(0.06).add(0.94);
        return vec4(u.lanternColor.mul(core.mul(weave).mul(flicker).mul(5.2)).mul(u.breath.mul(0.7).add(0.3)), 1.0);
    })();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'Koi Pond — lantern windows';
    mesh.position.set(lantern.x, lantern.y + 0.575, lantern.z);
    mesh.castShadow = false;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.updateMatrixWorld(true);
    return {
        mesh, geometry, material, flicker,
    };
}

// ── Maples ──────────────────────────────────────────────────────────────────────────────────

const catmull = (p0, p1, p2, p3, t) => {
    const t2 = t * t;
    const t3 = t2 * t;
    return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
};

/** Points [x, y, z, radius] along a limb's control polyline. */
function sampleLimb(control, perSpan = 5) {
    const out = [];
    const at = (i) => control[Math.max(0, Math.min(control.length - 1, i))];
    for (let s = 0; s < control.length - 1; s += 1) {
        for (let k = 0; k < perSpan; k += 1) {
            const t = k / perSpan;
            out.push([0, 1, 2, 3].map((c) => catmull(at(s - 1)[c], at(s)[c], at(s + 1)[c], at(s + 2)[c], t)));
        }
    }
    out.push([...control[control.length - 1]]);
    return out;
}

/**
 * Grow the maples: tubes of wood, and a list of leaves (8 floats each: x, y, z, size, yaw,
 * pitch, roll, tone — tone's whole part is the tree's colour band).
 */
export function growMaples(leafBudget, seed = 613) {
    const rand = mulberry32(seed);
    const wood = { positions: [], normals: [], indices: [] };
    const candidates = [];
    const up = new THREE.Vector3(0, 1, 0);
    const tangent = new THREE.Vector3();
    const side = new THREE.Vector3();
    const lift = new THREE.Vector3();
    const tube = (points, sides) => {
        const start = wood.positions.length / 3;
        for (let i = 0; i < points.length; i += 1) {
            const a = points[Math.max(0, i - 1)];
            const b = points[Math.min(points.length - 1, i + 1)];
            tangent.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
            side.crossVectors(tangent, up);
            if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
            side.normalize();
            lift.crossVectors(side, tangent).normalize();
            const p = points[i];
            for (let k = 0; k < sides; k += 1) {
                const ang = (k / sides) * TAU;
                const nx = side.x * Math.cos(ang) + lift.x * Math.sin(ang);
                const ny = side.y * Math.cos(ang) + lift.y * Math.sin(ang);
                const nz = side.z * Math.cos(ang) + lift.z * Math.sin(ang);
                wood.positions.push(p[0] + nx * p[3], p[1] + ny * p[3], p[2] + nz * p[3]);
                wood.normals.push(nx, ny, nz);
            }
        }
        for (let i = 0; i < points.length - 1; i += 1) {
            for (let k = 0; k < sides; k += 1) {
                const a = start + i * sides + k;
                const b = start + i * sides + ((k + 1) % sides);
                const c = a + sides;
                const d = b + sides;
                wood.indices.push(a, b, c, b, d, c);
            }
        }
    };
    /** A spray of leaves about a point on a twig, lying more or less level. */
    const spray = (x, y, z, heading, band, weight) => {
        const n = 3 + Math.floor(rand() * 3);
        for (let k = 0; k < n; k += 1) {
            const yaw = heading + (rand() - 0.5) * 2.4;
            const size = 0.082 + rand() * 0.062;
            candidates.push([
                x + (rand() - 0.5) * 0.05, y + (rand() - 0.5) * 0.06, z + (rand() - 0.5) * 0.05, size,
                yaw, (rand() - 0.5) * 0.6 - 0.08, (rand() - 0.5) * 0.7, band + Math.min(0.999, rand() ** (band ? 1 : 1.4)),
                weight,
            ]);
        }
    };

    MAPLES.forEach((tree) => {
        tree.limbs.forEach((control, limbIndex) => {
            const points = sampleLimb(control, 5);
            tube(points, limbIndex === 0 ? 8 : 6);
            if (limbIndex === 0) return; // the trunk bears no leaves
            // Twigs leave the limb alternately left and right, shorter toward its tip.
            let length = 0;
            for (let i = 1; i < points.length; i += 1) {
                length += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1], points[i][2] - points[i - 1][2]);
            }
            const twigs = Math.max(5, Math.round(length / 0.17));
            for (let t = 0; t < twigs; t += 1) {
                const f = 0.16 + (0.84 * (t + rand() * 0.6)) / twigs;
                const at = Math.min(points.length - 2, Math.floor(f * (points.length - 1)));
                const p = points[at];
                const q = points[at + 1];
                const heading = Math.atan2(q[2] - p[2], q[0] - p[0]) + (t % 2 ? 1 : -1) * (0.55 + rand() * 0.75);
                const reach = (0.5 + rand() * 0.75) * (1.15 - f * 0.5);
                const rise = (rand() - 0.45) * 0.3;
                const twig = [];
                const steps = 5;
                for (let s = 0; s <= steps; s += 1) {
                    const d = (s / steps) * reach;
                    // A twig bows down under its own leaves.
                    const droop = -0.09 * (s / steps) ** 2 * reach;
                    twig.push([
                        p[0] + Math.cos(heading) * d, p[1] + rise * (s / steps) + droop, p[2] + Math.sin(heading) * d,
                        Math.max(0.004, p[3] * 0.34 * (1 - (s / steps) * 0.8)),
                    ]);
                }
                tube(twig, 3);
                for (let s = 1; s <= steps; s += 1) {
                    const a = twig[s - 1];
                    const b = twig[s];
                    const along = 4;
                    for (let k = 0; k < along; k += 1) {
                        const w = (k + rand()) / along;
                        spray(a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w + 0.02, a[2] + (b[2] - a[2]) * w, heading, tree.band, tree.share);
                    }
                }
            }
            // And leaves along the outer half of the limb itself.
            for (let i = Math.floor(points.length * 0.45); i < points.length; i += 1) {
                const p = points[i];
                spray(p[0], p[1] + 0.03, p[2], rand() * TAU, tree.band, tree.share);
                spray(p[0], p[1] + 0.03, p[2], rand() * TAU, tree.band, tree.share);
            }
        });
    });

    // Thin the candidates evenly down to the budget (each tree keeps its share).
    const keepEvery = Math.max(1, candidates.length / Math.max(1, leafBudget));
    const leaves = [];
    let carry = 0;
    for (let i = 0; i < candidates.length; i += 1) {
        carry += 1;
        if (carry >= keepEvery) {
            carry -= keepEvery;
            leaves.push(...candidates[i].slice(0, 8));
        }
    }
    return {
        wood, leaves: new Float32Array(leaves), count: leaves.length / 8, grown: candidates.length,
    };
}

export function createMaples(light, grown) {
    const { u } = light;
    /** The breeze in the boughs: 1 at rest, more in a gust. */
    const gust = uniform(1);

    // ── Wood ──
    const woodGeometry = new THREE.BufferGeometry();
    woodGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(grown.wood.positions), 3));
    woodGeometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(grown.wood.normals), 3));
    woodGeometry.setIndex(grown.wood.indices);
    const woodMaterial = new THREE.MeshBasicNodeMaterial({ fog: false });
    woodMaterial.name = 'Koi Pond — maple wood';
    woodMaterial.fragmentNode = Fn(() => {
        const point = positionWorld.toVar();
        const normal = normalize(normalWorld).toVar();
        const grain = light.noise.sample(vec3(point.x.add(point.z), point.y.mul(3.0), 0).xy.mul(0.9));
        const bark = mix(vec3(0.03, 0.022, 0.018), vec3(0.085, 0.06, 0.045), grain.b);
        const moss = vec3(0.04, 0.09, 0.025).mul(smoothstep(0.2, 0.8, normal.y)).mul(grain.r);
        const lit = light.moonlight();
        const ndl = clamp(dot(normal, u.moonDir), 0.0, 1.0);
        const view = normalize(cameraPosition.sub(point));
        const rim = pow(float(1.0).sub(clamp(dot(normal, view), 0.0, 1.0)), 3.0).mul(0.05);
        const colour = bark.add(moss).mul(u.moonColor.mul(ndl.mul(lit)).mul(u.breath.mul(0.8).add(0.2)).add(u.skyAmbient)
            .add(light.lantern(point, normal).mul(1.6))).add(u.moonColor.mul(rim).mul(lit));
        return vec4(colour, 1.0);
    })();
    const wood = new THREE.Mesh(woodGeometry, woodMaterial);
    wood.name = 'Koi Pond — maple wood';
    wood.frustumCulled = false;
    wood.castShadow = true;
    wood.receiveShadow = true;
    wood.matrixAutoUpdate = false;
    wood.updateMatrixWorld(true);

    // ── Leaves ──
    const base = buildMapleLeafGeometry();
    const leafGeometry = new THREE.InstancedBufferGeometry();
    leafGeometry.setIndex(base.getIndex());
    ['position', 'normal', 'uv'].forEach((name) => leafGeometry.setAttribute(name, base.getAttribute(name)));
    leafGeometry.instanceCount = grown.count;
    const buffer = new THREE.InstancedInterleavedBuffer(grown.leaves, 8);
    leafGeometry.setAttribute('aLeaf', new THREE.InterleavedBufferAttribute(buffer, 4, 0));
    leafGeometry.setAttribute('aLeafTurn', new THREE.InterleavedBufferAttribute(buffer, 4, 4));
    const aLeaf = attribute('aLeaf', 'vec4');
    const aTurn = attribute('aLeafTurn', 'vec4');

    const turn = (v, flutter) => {
        const roll = aTurn.z.add(flutter);
        const pitch = aTurn.y;
        const yaw = aTurn.x;
        const y1 = v.y.mul(cos(roll)).sub(v.z.mul(sin(roll)));
        const z1 = v.y.mul(sin(roll)).add(v.z.mul(cos(roll)));
        const x2 = v.x.mul(cos(pitch)).sub(y1.mul(sin(pitch)));
        const y2 = v.x.mul(sin(pitch)).add(y1.mul(cos(pitch)));
        return vec3(x2.mul(cos(yaw)).sub(z1.mul(sin(yaw))), y2, x2.mul(sin(yaw)).add(z1.mul(cos(yaw))));
    };
    const seedOf = () => aLeaf.x.mul(1.7).add(aLeaf.z.mul(2.3));
    const flutterOf = () => sin(u.time.mul(3.4).add(seedOf().mul(5.0))).mul(0.16)
        .add(sin(u.time.mul(1.3).add(seedOf())).mul(0.1)).mul(gust);
    const place = Fn(() => {
        // The bough sways as a whole; each leaf shivers on its stalk.
        const sway = sin(u.time.mul(0.7).add(aLeaf.x.mul(0.5)).add(aLeaf.z.mul(0.4))).mul(0.018).mul(gust);
        return turn(positionGeometry.mul(aLeaf.w), flutterOf()).add(aLeaf.xyz).add(vec3(sway, sway.mul(0.4), sway.mul(0.6)));
    })();
    const vNormal = varying(Fn(() => normalize(turn(attribute('normal', 'vec3'), flutterOf())))(), 'vLeafNormal');
    const vTone = varying(aTurn.w, 'vLeafTone');

    const leafMaterial = new THREE.MeshBasicNodeMaterial({ fog: false, side: THREE.DoubleSide });
    leafMaterial.name = 'Koi Pond — maple leaves';
    leafMaterial.positionNode = place;
    leafMaterial.fragmentNode = Fn(() => {
        const point = positionWorld.toVar();
        const edge = uv().x;
        const band = step(1.0, vTone);
        const tone = vTone.sub(band);
        const crimson = mix(
            mix(vec3(0.13, 0.004, 0.006), vec3(0.46, 0.014, 0.01), smoothstep(0.0, 0.6, tone)),
            vec3(0.72, 0.12, 0.012),
            smoothstep(0.62, 1.0, tone),
        );
        const gold = mix(
            mix(vec3(0.05, 0.11, 0.015), vec3(0.3, 0.3, 0.025), smoothstep(0.0, 0.55, tone)),
            vec3(0.72, 0.4, 0.03),
            smoothstep(0.55, 1.0, tone),
        );
        const leaf = mix(crimson, gold, band).mul(edge.mul(0.35).add(0.72)).toVar();
        const normal = normalize(vNormal).toVar();
        const view = normalize(cameraPosition.sub(point)).toVar();
        const ndl = dot(normal, u.moonDir).toVar();
        const ndv = dot(normal, view).toVar();
        // Seen from the lit side a leaf shines; seen against the moon it glows through.
        const sameSide = step(0.0, ndl.mul(ndv));
        const lit = light.moonlight().toVar();
        const front = abs(ndl).mul(sameSide);
        const through = abs(ndl).mul(sameSide.oneMinus()).mul(0.85);
        const facing = normal.mul(ndv.sign());
        const gloss = pow(clamp(dot(facing, normalize(u.moonDir.add(view))), 0.0, 1.0), 26.0).mul(sameSide).mul(0.2);
        // (Warmer than the moon on stone: blue light on a red leaf would only grey it.)
        const key = mix(u.moonColor, vec3(1.0, 0.86, 0.8), 0.6);
        const moon = key.mul(front.add(through)).mul(lit).mul(0.95).mul(u.breath.mul(0.8).add(0.2));
        const glowThrough = leaf.mul(leaf.add(0.2)).mul(through).mul(lit).mul(key)
            .mul(1.2);
        // The lantern lights the undersides of the boughs near it.
        const lamp = light.lantern(point, facing).mul(2.2);
        const colour = leaf.mul(moon.add(u.skyAmbient.mul(1.25)).add(lamp)).add(glowThrough)
            .add(mix(u.moonColor, leaf.mul(4.0), 0.55).mul(gloss).mul(lit))
            .add(leaf.mul(u.glow.mul(0.12)));
        return vec4(colour, 1.0);
    })();
    const leaves = new THREE.Mesh(leafGeometry, leafMaterial);
    leaves.name = 'Koi Pond — maple leaves';
    leaves.frustumCulled = false;
    leaves.castShadow = true;
    leaves.receiveShadow = true;
    leaves.matrixAutoUpdate = false;
    leaves.updateMatrixWorld(true);

    return {
        wood: { mesh: wood, geometry: woodGeometry, material: woodMaterial },
        leaves: {
            mesh: leaves, geometry: leafGeometry, material: leafMaterial, count: grown.count, dispose: () => base.dispose(),
        },
        gust,
    };
}

// ── Iris ────────────────────────────────────────────────────────────────────────────────────

export function createIris(light, plan, seed = 87) {
    const { u } = light;
    const rand = mulberry32(seed);
    // One blade: a strip along +y, one unit tall, bowed by the vertex shader.
    const segments = 5;
    const positions = [];
    const uvs = [];
    const indices = [];
    for (let j = 0; j <= segments; j += 1) {
        const t = j / segments;
        const half = 0.5 * (1 - t ** 1.6);
        positions.push(-half, t, 0, half, t, 0);
        uvs.push(0, t, 1, t);
    }
    for (let j = 0; j < segments; j += 1) {
        const a = j * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const base = new THREE.BufferGeometry();
    base.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    base.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
    base.setIndex(indices);

    const blades = [];
    plan.iris.forEach((clump) => {
        for (let k = 0; k < clump.blades; k += 1) {
            const a = rand() * TAU;
            const d = rand() * 0.16;
            blades.push(
                clump.x + Math.cos(a) * d,
                clump.y,
                clump.z + Math.sin(a) * d,
                clump.height * (0.6 + rand() * 0.5),
                rand() * TAU,
                0.15 + rand() * 0.5,
                0.028 + rand() * 0.022,
                rand(),
            );
        }
    });
    const count = blades.length / 8;
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex(base.getIndex());
    ['position', 'uv'].forEach((name) => geometry.setAttribute(name, base.getAttribute(name)));
    geometry.instanceCount = count;
    const buffer = new THREE.InstancedInterleavedBuffer(new Float32Array(blades.length ? blades : 8), 8);
    geometry.setAttribute('aBlade', new THREE.InterleavedBufferAttribute(buffer, 4, 0));
    geometry.setAttribute('aBladeLook', new THREE.InterleavedBufferAttribute(buffer, 4, 4));
    const aBlade = attribute('aBlade', 'vec4');
    const aLook = attribute('aBladeLook', 'vec4');
    const gust = uniform(1);

    const place = Fn(() => {
        const t = positionGeometry.y;
        const yaw = aLook.x;
        // It arches outward along its own heading, more toward the tip, and nods in the air.
        const nod = sin(u.time.mul(1.1).add(aBlade.x.mul(1.3)).add(aLook.w.mul(6.0))).mul(0.06).mul(gust);
        const lean = t.mul(t).mul(aLook.y.add(nod)).mul(aBlade.w);
        const across = positionGeometry.x.mul(aLook.z);
        return vec3(
            aBlade.x.add(cos(yaw).mul(lean)).sub(sin(yaw).mul(across)),
            aBlade.y.add(t.mul(aBlade.w).mul(float(1.0).sub(t.mul(aLook.y).mul(0.35)))),
            aBlade.z.add(sin(yaw).mul(lean)).add(cos(yaw).mul(across)),
        );
    })();

    const material = new THREE.MeshBasicNodeMaterial({ fog: false, side: THREE.DoubleSide });
    material.name = 'Koi Pond — iris';
    material.positionNode = place;
    material.fragmentNode = Fn(() => {
        const point = positionWorld.toVar();
        const t = uv().y;
        const blade = mix(vec3(0.018, 0.06, 0.02), vec3(0.06, 0.15, 0.03), t).mul(aLook.w.mul(0.4).add(0.8));
        const lit = light.moonlight();
        const rib = float(1.0).sub(abs(uv().x.sub(0.5)).mul(0.7));
        // A blade is a ribbon: the moon rims it whichever way it turns.
        const moon = u.moonColor.mul(lit).mul(t.mul(0.6).add(0.3)).mul(u.breath.mul(0.8).add(0.2));
        const colour = blade.mul(rib).mul(moon.add(u.skyAmbient.mul(1.2)).add(light.lantern(point, vec3(0, 1, 0)).mul(1.8)));
        return vec4(colour, 1.0);
    })();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'Koi Pond — iris';
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return {
        mesh, geometry, material, count, gust, dispose: () => base.dispose(),
    };
}
