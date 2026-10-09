/**
 * Stillwater — the meshes built in code face the right way and stand where the plan says.
 *
 * Every surface of the tarn shades itself from its own normal: a tube wound the wrong way is lit
 * from behind, and nothing fails loudly when that happens (the Koi Pond's backs were dark for
 * most of its development before a close-up showed it). So the facing of each mesh is pinned
 * here, with what else the picture takes for granted about them: the trunks follow their own
 * centre lines, the stones lie in the ground, the boughs hang clear of the moon.
 *
 * Where a test says what a mesh "once" did, it pins a fault that was found here and has been put
 * right.
 */
import {
    describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';

import {
    createBoughs, createTrunkGeometry, createTrunks, planBoughs, trunkCentre, trunkRadius,
} from '../../src/themes/stillwater/stillwater-trees.js';
import { createBoulderGeometry, createBoulders, createGround } from '../../src/themes/stillwater/stillwater-land.js';
import {
    createCapGeometry, createFernGeometry, createLilyGeometry, createPadGeometry, createSaplingGeometry,
} from '../../src/themes/stillwater/stillwater-flora.js';
import { createSpiritGeometry } from '../../src/themes/stillwater/stillwater-figures.js';
import { createSky } from '../../src/themes/stillwater/stillwater-sky.js';
import { createWater } from '../../src/themes/stillwater/stillwater-water.js';
import {
    STAGE, azimuthOf, groundHeight, planBoulders, planTrunks, rangeOf, shoreDistance,
} from '../../src/themes/stillwater/stillwater-plan.js';
import {
    EYE, MOON, SPIRIT, createStillwaterUniforms, moonFor, skyDirection, squeezeFor,
} from '../../src/themes/stillwater/stillwater-tsl.js';
import { QUALITY, QUALITY_NAMES } from '../../src/themes/stillwater/stillwater-quality.js';

// Whole plans are built and walked triangle by triangle, on a machine that may be busy.
vi.setConfig({ testTimeout: 30000 });

/** The shared uniforms, with stand-ins for the baked textures (nothing here is drawn). */
function uniforms() {
    const noise = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
    const shore = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
    return createStillwaterUniforms({ noise, shore });
}

/** Every triangle of an indexed geometry: its corners, its centre, its area, the normal its winding gives it. */
function trianglesOf(geometry) {
    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    const index = geometry.getIndex();
    const count = index ? index.count : position.count;
    const at = (i) => (index ? index.getX(i) : i);
    const out = [];
    for (let i = 0; i < count; i += 3) {
        const corners = [0, 1, 2].map((k) => new THREE.Vector3().fromBufferAttribute(position, at(i + k)));
        const face = new THREE.Vector3().subVectors(corners[1], corners[0])
            .cross(new THREE.Vector3().subVectors(corners[2], corners[0]));
        const area = face.length() / 2;
        let stored = null;
        if (normal) {
            stored = new THREE.Vector3();
            for (let k = 0; k < 3; k++) stored.add(new THREE.Vector3().fromBufferAttribute(normal, at(i + k)));
            if (stored.lengthSq() > 0) stored.normalize();
        }
        out.push({
            first: i,
            corners,
            centre: new THREE.Vector3().add(corners[0]).add(corners[1]).add(corners[2])
                .divideScalar(3),
            area,
            face: area > 0 ? face.normalize() : face,
            stored,
        });
    }
    return out;
}

/**
 * The separate pieces of an indexed geometry (vertices joined by triangles), in the order they
 * were built: each { vertices: [index…], triangles: [first index of each triangle…] }.
 */
function piecesOf(geometry) {
    const index = geometry.getIndex();
    const { count } = geometry.getAttribute('position');
    const parent = Array.from({ length: count }, (_, i) => i);
    const find = (i) => {
        let root = i;
        while (parent[root] !== root) root = parent[root];
        let walk = i;
        while (parent[walk] !== root) {
            const next = parent[walk];
            parent[walk] = root;
            walk = next;
        }
        return root;
    };
    for (let i = 0; i < index.count; i += 3) {
        const a = find(index.getX(i));
        parent[find(index.getX(i + 1))] = a;
        parent[find(index.getX(i + 2))] = a;
    }
    const pieces = new Map();
    for (let i = 0; i < count; i++) {
        const root = find(i);
        if (!pieces.has(root)) pieces.set(root, { vertices: [], triangles: [] });
        pieces.get(root).vertices.push(i);
    }
    for (let i = 0; i < index.count; i += 3) pieces.get(find(index.getX(i))).triangles.push(i);
    return [...pieces.values()].sort((a, b) => a.vertices[0] - b.vertices[0]);
}

/** Lowest and highest y of a piece. */
function heightsOf(geometry, piece) {
    const position = geometry.getAttribute('position');
    let low = Infinity;
    let high = -Infinity;
    for (const i of piece.vertices) {
        low = Math.min(low, position.getY(i));
        high = Math.max(high, position.getY(i));
    }
    return { low, high };
}

/**
 * The rings of a tube built ring by ring (each ring's vertices in a row): the middle of each.
 * `ring` = vertices in a ring, `closing` = true when the ring's last vertex repeats its first.
 */
function ringCentres(geometry, piece, ring, closing) {
    const position = geometry.getAttribute('position');
    const first = piece.vertices[0];
    const own = closing ? ring - 1 : ring;
    const centres = [];
    for (let r = 0; r < piece.vertices.length / ring; r++) {
        const centre = new THREE.Vector3();
        for (let a = 0; a < own; a++) {
            centre.add(new THREE.Vector3().fromBufferAttribute(position, first + r * ring + a));
        }
        centres.push(centre.divideScalar(own));
    }
    return centres;
}

/** The point of a line through `centres` nearest to `point`. */
function nearestOnLine(centres, point) {
    let best = centres[0];
    let least = Infinity;
    const line = new THREE.Line3();
    const on = new THREE.Vector3();
    for (let r = 0; r < centres.length - 1; r++) {
        line.set(centres[r], centres[r + 1]).closestPointToPoint(point, true, on);
        const d = on.distanceTo(point);
        if (d < least) {
            least = d;
            best = on.clone();
        }
    }
    return best;
}

/** Every number of every attribute is finite, and the index stays inside the vertices. */
function expectSound(geometry, label) {
    const position = geometry.getAttribute('position');
    for (const name of Object.keys(geometry.attributes)) {
        const attribute = geometry.getAttribute(name);
        expect(attribute.count, `${label}.${name}`).toBe(position.count);
        expect(Array.from(attribute.array).every(Number.isFinite), `${label}.${name}`).toBe(true);
    }
    const index = geometry.getIndex();
    if (!index) return;
    expect(index.count % 3, label).toBe(0);
    expect(index.count, label).toBeGreaterThan(0);
    let highest = -1;
    let lowest = Infinity;
    for (let i = 0; i < index.count; i++) {
        highest = Math.max(highest, index.getX(i));
        lowest = Math.min(lowest, index.getX(i));
    }
    expect(lowest, label).toBe(0);
    expect(highest, label).toBe(position.count - 1); // no vertex is left unused either
}

const unitNormals = (geometry) => {
    const normal = geometry.getAttribute('normal');
    for (let i = 0; i < normal.count; i++) {
        if (Math.abs(Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i)) - 1) > 1e-5) return false;
    }
    return true;
};

describe('stillwater meshes: the trunks', () => {
    const plan = planTrunks(20);
    const geometry = createTrunkGeometry(plan);
    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    const pieces = piecesOf(geometry);
    /** A trunk's own column is tens of metres tall; a dead stub is a metre or two long. */
    const columns = pieces.filter((piece) => {
        const { low, high } = heightsOf(geometry, piece);
        return high - low > 10;
    });
    const stubs = pieces.filter((piece) => !columns.includes(piece));
    /** How many vertices make one ring of a tube: the seam vertex repeats the ring's first. */
    const ringOf = (piece) => {
        const first = piece.vertices[0];
        for (let j = 1; j < piece.vertices.length; j++) {
            const same = ['getX', 'getY', 'getZ'].every((get) => position[get](first + j) === position[get](first));
            if (same) return j + 1;
        }
        return 0;
    };

    it('builds one column for every tree of the plan, in the plan\'s order, and stubs on the near ones', () => {
        expectSound(geometry, 'trunks');
        expect(unitNormals(geometry)).toBe(true);
        expect(columns).toHaveLength(plan.length);
        expect(stubs.length).toBeGreaterThan(0);
        // Each piece is a run of vertices of its own, a whole number of rings long.
        for (const piece of pieces) {
            expect(piece.vertices.at(-1) - piece.vertices[0] + 1).toBe(piece.vertices.length);
            const ring = ringOf(piece);
            expect(ring).toBeGreaterThanOrEqual(4);
            expect(piece.vertices.length % ring).toBe(0);
        }
        columns.forEach((column, k) => {
            const t = plan[k];
            const { low, high } = heightsOf(geometry, column);
            // Rooted below its own foot (which the plan sinks under the ground), and as tall as planned.
            expect(low, `trunk ${k}`).toBeLessThan(t.y);
            expect(low, `trunk ${k}`).toBeLessThan(groundHeight(t.x, t.z));
            expect(high, `trunk ${k}`).toBeCloseTo(t.y + t.height, 4);
            // Every ring is centred on the trunk's own centre line.
            const ring = ringOf(column);
            const centres = ringCentres(geometry, column, ring, true);
            const line = [0, 0, 0];
            for (const centre of centres) {
                trunkCentre(t, centre.y - t.y, line);
                const off = Math.hypot(centre.x - line[0], centre.z - line[2]);
                expect(off, `trunk ${k} at ${centre.y.toFixed(1)} m`).toBeLessThan(trunkRadius(t, centre.y - t.y, 0));
            }
        });
        // The same wood every time.
        expect(Array.from(createTrunkGeometry(planTrunks(20)).getAttribute('position').array))
            .toEqual(Array.from(position.array));
    });

    it('turns every column\'s bark away from its centre line', () => {
        const line = [0, 0, 0];
        const inward = [];
        let seen = 0;
        columns.forEach((column, k) => {
            const t = plan[k];
            for (const i of column.vertices) {
                trunkCentre(t, position.getY(i) - t.y, line);
                const rx = position.getX(i) - line[0];
                const rz = position.getZ(i) - line[2];
                const away = (normal.getX(i) * rx + normal.getZ(i) * rz) / Math.hypot(rx, rz);
                seen += 1;
                // Outward, and mostly sideways: a trunk's flank, not a ledge.
                if (!(away > 0.3)) inward.push(`trunk ${k}, vertex ${i}: ${away.toFixed(2)}`);
            }
        });
        expect(seen).toBeGreaterThan(1000);
        expect(inward).toEqual([]);
    });

    it('turns every stub\'s bark away from the stub\'s own axis', () => {
        const inward = [];
        let seen = 0;
        const away = new THREE.Vector3();
        stubs.forEach((stub, k) => {
            const ring = ringOf(stub);
            const centres = ringCentres(geometry, stub, ring, true);
            stub.vertices.forEach((i, n) => {
                away.fromBufferAttribute(position, i).sub(centres[Math.floor(n / ring)]).normalize();
                const facing = away.x * normal.getX(i) + away.y * normal.getY(i) + away.z * normal.getZ(i);
                seen += 1;
                if (!(facing > 0.3)) inward.push(`stub ${k}, vertex ${i}: ${facing.toFixed(2)}`);
            });
            // It grows out of its trunk: its first ring is inside the trunk's bark, its last outside.
            const fromRoot = (t) => Math.hypot(t.x - centres[0].x, t.z - centres[0].z);
            const owner = plan.reduce((best, t) => (fromRoot(t) < fromRoot(best) ? t : best));
            const line = trunkCentre(owner, centres[0].y - owner.y);
            const from = (centre) => Math.hypot(centre.x - line[0], centre.z - line[2]);
            expect(from(centres[0]), `stub ${k}`).toBeLessThan(owner.radius * 1.6);
            expect(from(centres.at(-1)), `stub ${k}`).toBeGreaterThan(from(centres[0]));
        });
        expect(seen).toBeGreaterThan(200);
        expect(inward).toEqual([]);
    });

    it('winds every triangle the way its normals face', () => {
        const triangles = trianglesOf(geometry);
        const wrong = triangles.filter((t) => t.area > 1e-12 && t.face.dot(t.stored) <= 0);
        expect(triangles.length).toBeGreaterThan(5000);
        expect(wrong.map((t) => t.first)).toEqual([]);
        // No triangle is a sliver with no area: every one is drawn.
        expect(triangles.filter((t) => !(t.area > 1e-12))).toHaveLength(0);
        // The fuller wood of the High tier is wound the same way.
        const high = trianglesOf(createTrunkGeometry(planTrunks(QUALITY.High.trunks)));
        expect(high.filter((t) => t.area > 1e-12 && t.face.dot(t.stored) <= 0)).toHaveLength(0);
    });

    it('wraps the bark once round each tube, and carries each tree\'s own seed', () => {
        const uv = geometry.getAttribute('uv');
        const seed = geometry.getAttribute('aSeed');
        columns.forEach((column, k) => {
            const ring = ringOf(column);
            const first = column.vertices[0];
            // Round the trunk the texture runs from 0 to exactly 1 (it meets itself at the seam).
            expect(uv.getX(first)).toBe(0);
            expect(uv.getX(first + ring - 1)).toBe(1);
            for (let a = 1; a < ring; a++) expect(uv.getX(first + a)).toBeGreaterThan(uv.getX(first + a - 1));
            for (const i of column.vertices) {
                expect(seed.getX(i)).toBeCloseTo(plan[k].seed, 4);
                // Up the trunk it is metres above the foot (the moss and the lichen are drawn by it).
                expect(uv.getY(i)).toBeCloseTo(position.getY(i) - plan[k].y, 3);
            }
        });
    });

    it('spreads a trunk at its foot and tapers it toward its top', () => {
        for (const t of plan) {
            let foot = 0;
            let breast = 0;
            let top = 0;
            for (let k = 0; k < 32; k++) {
                const angle = (k / 32) * Math.PI * 2;
                for (const y of [-0.5, 0, 2, t.height * 0.5, t.height]) {
                    expect(trunkRadius(t, y, angle)).toBeGreaterThan(0);
                }
                foot += trunkRadius(t, 0, angle) / 32;
                breast += trunkRadius(t, 4, angle) / 32;
                top += trunkRadius(t, t.height, angle) / 32;
            }
            expect(foot).toBeGreaterThan(breast);
            expect(breast).toBeGreaterThan(top);
            expect(breast).toBeLessThan(t.radius * 1.3);
            expect(breast).toBeGreaterThan(t.radius * 0.7);
            // Its centre line starts at its place in the plan and never strays far from its lean.
            const out = [0, 0, 0];
            expect(trunkCentre(t, 0, out)).toBe(out);
            expect(Math.hypot(out[0] - t.x, out[2] - t.z)).toBeLessThan(t.radius);
            expect(out[1]).toBe(t.y);
            trunkCentre(t, t.height, out);
            const lean = Math.hypot(t.lean[0], t.lean[1]) * t.height;
            expect(Math.hypot(out[0] - t.x, out[2] - t.z)).toBeLessThan(lean + t.radius);
        }
    });

    it('is drawn single-sided as one mesh that counts its trees', () => {
        const part = createTrunks(uniforms(), plan);
        expect(part.count).toBe(plan.length);
        expect(part.mesh.isMesh).toBe(true);
        expect(part.mesh.isInstancedMesh).not.toBe(true);
        expect(part.material.isNodeMaterial).toBe(true);
        // Wound outward, so the back faces can be culled.
        expect(part.material.side).toBe(THREE.FrontSide);
        expect(part.mesh.frustumCulled).toBe(false);
    });
});

describe('stillwater meshes: the boughs', () => {
    /** The trunk a bough hangs from: the one whose centre line its foot lies on. */
    const ownerOf = (bough, trunks) => {
        let best = null;
        let least = Infinity;
        const line = [0, 0, 0];
        for (const t of trunks) {
            trunkCentre(t, bough.y - t.y, line);
            const d = Math.hypot(bough.x - line[0], bough.z - line[2]);
            if (d < least) {
                least = d;
                best = t;
            }
        }
        return { trunk: best, off: least };
    };

    it('plans the same boughs every time, and no more than it is asked for', () => {
        const trunks = planTrunks(QUALITY.High.trunks);
        for (const count of [0, 1, 5, 14, 46, 64, 400]) {
            const boughs = planBoughs(trunks, count);
            expect(boughs.length, `boughs(${count})`).toBeLessThanOrEqual(count);
            expect(planBoughs(trunks, count), `boughs(${count})`).toEqual(boughs);
            for (const b of boughs) {
                expect(Object.values(b).every((v) => typeof v === 'boolean' || Number.isFinite(v))).toBe(true);
            }
        }
        expect(planBoughs(trunks, 0)).toEqual([]);
        expect(planBoughs([], 20)).toEqual([]);
        expect(planBoughs(trunks)).toEqual(planBoughs(trunks));
        expect(planBoughs(trunks, 30, 77)).not.toEqual(planBoughs(trunks, 30));
        // Every tier gets the boughs it pays for.
        for (const quality of QUALITY_NAMES) {
            const tier = QUALITY[quality];
            expect(planBoughs(planTrunks(tier.trunks), tier.boughs), quality).toHaveLength(tier.boughs);
        }
    });

    it('hangs every bough from a trunk, above head height, none from below two metres', () => {
        for (const quality of QUALITY_NAMES) {
            const tier = QUALITY[quality];
            const trunks = planTrunks(tier.trunks);
            for (const bough of planBoughs(trunks, tier.boughs)) {
                const { trunk, off } = ownerOf(bough, trunks);
                const at = [bough.x, bough.y, bough.z].map((v) => v.toFixed(1)).join(', ');
                const label = `${quality}: the bough at (${at})`;
                expect(off, label).toBeLessThan(1e-9);
                expect(bough.y - trunk.y, label).toBeGreaterThanOrEqual(2);
                expect(bough.y - groundHeight(trunk.x, trunk.z), label).toBeGreaterThan(1.7);
                // Not from the trunk's bare top either.
                expect(bough.y - trunk.y, label).toBeLessThan(trunk.height);
                expect(bough.length, label).toBeGreaterThan(0);
                expect(bough.curtain, label).toBeGreaterThan(0);
                // It reaches out and droops; it does not stand up.
                expect(bough.rise, label).toBeLessThan(0.5);
                // Where it will show: in front of the viewer.
                expect(Math.abs(azimuthOf(trunk.x, trunk.z)), label).toBeLessThan(Math.PI / 2);
            }
        }
    });

    it('gives both giants their boughs at every tier, to fringe the top of the picture', () => {
        for (const quality of QUALITY_NAMES) {
            const tier = QUALITY[quality];
            const trunks = planTrunks(tier.trunks);
            const giants = trunks.filter((t) => t.hero && rangeOf(t.x, t.z) < 9);
            expect(giants).toHaveLength(2);
            const boughs = planBoughs(trunks, tier.boughs);
            for (const giant of giants) {
                const own = boughs.filter((b) => ownerOf(b, trunks).trunk === giant);
                const label = `${quality}: the giant at (${giant.x}, ${giant.z})`;
                expect(own.length, label).toBeGreaterThanOrEqual(2);
                for (const bough of own) {
                    // Above the eye, so it fringes the frame from the top.
                    expect(bough.y, label).toBeGreaterThan(EYE.y + 1);
                    // It reaches in over the water, toward the middle of the view.
                    const tip = bough.x + Math.cos(bough.yaw) * bough.length;
                    expect(Math.abs(tip), label).toBeLessThan(Math.abs(bough.x));
                }
            }
        }
    });

    /** How many of nine sight lines through the moon's disc (its middle and its rim) a bough crosses. */
    function moonCrossings(part, aspect) {
        const position = part.geometry.getAttribute('position');
        const index = part.geometry.getIndex();
        const squeeze = squeezeFor(aspect);
        const moon = moonFor(aspect);
        const lines = [[moon.azimuth, moon.elevation]];
        for (let k = 0; k < 8; k++) {
            const turn = (k * Math.PI) / 4;
            lines.push([moon.azimuth + Math.cos(turn) * MOON.radius, moon.elevation + Math.sin(turn) * MOON.radius]);
        }
        const eye = new THREE.Vector3(EYE.x, EYE.y, EYE.z);
        const corners = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
        const hit = new THREE.Vector3();
        let crossed = 0;
        for (const [azimuth, elevation] of lines) {
            const ray = new THREE.Ray(eye, new THREE.Vector3(...skyDirection(azimuth, elevation)));
            for (let i = 0; i < index.count; i += 3) {
                // (The boughs hang in the stage group: drawn in with the banks on a narrow frame.)
                corners.forEach((corner, k) => {
                    corner.fromBufferAttribute(position, index.getX(i + k));
                    corner.x *= squeeze;
                });
                if (ray.intersectTriangle(corners[0], corners[1], corners[2], false, hit)) {
                    crossed += 1;
                    break;
                }
            }
        }
        return crossed;
    }

    const boughsOf = (quality) => {
        const tier = QUALITY[quality];
        return createBoughs(uniforms(), planBoughs(planTrunks(tier.trunks), tier.boughs));
    };

    it('hangs no bough across the moon on a wide frame', () => {
        for (const quality of QUALITY_NAMES) {
            const part = boughsOf(quality);
            expectSound(part.geometry, `${quality} boughs`);
            expect(part.count).toBe(QUALITY[quality].boughs);
            // A curtain of twigs is seen from both sides.
            expect(part.material.side).toBe(THREE.DoubleSide);
            for (const aspect of [3440 / 1440, 16 / 9, 16 / 10, 4 / 3]) {
                expect(moonCrossings(part, aspect), `${quality} at ${aspect.toFixed(2)}`).toBe(0);
            }
        }
    });

    // On a narrow frame the moon climbs (moonFor) to the height the giants' boughs hang at, and
    // drawn in with the banks they would hang across it: the plan marks them (`fringe`) and the
    // world leaves them out there (stillwater-world.test.js casts the same sight lines through the
    // world as it is really drawn). What is left must be clear of the moon on any frame.
    it('hangs no bough but the giants\' fringe across the moon on an upright frame', () => {
        for (const quality of QUALITY_NAMES) {
            const tier = QUALITY[quality];
            const trunks = planTrunks(tier.trunks);
            const boughs = planBoughs(trunks, tier.boughs);
            const giants = trunks.filter((t) => t.hero && rangeOf(t.x, t.z) < 9);
            // The fringe is the giants' own boughs, and all of them.
            for (const bough of boughs) {
                expect(Boolean(bough.fringe), quality).toBe(giants.includes(ownerOf(bough, trunks).trunk));
            }
            const rest = createBoughs(uniforms(), boughs.filter((bough) => !bough.fringe));
            for (const [width, height] of [[1000, 1000], [820, 1180], [430, 932], [390, 844]]) {
                expect(moonCrossings(rest, width / height), `${quality} at ${width} × ${height}`).toBe(0);
            }
        }
    });
});

describe('stillwater meshes: the stones', () => {
    it('is one lumpy stone about a unit across, its skin facing outward', () => {
        const geometry = createBoulderGeometry();
        const position = geometry.getAttribute('position');
        const normal = geometry.getAttribute('normal');
        expectSound(geometry, 'boulder');
        expect(unitNormals(geometry)).toBe(true);
        let outward = 0;
        let low = Infinity;
        let high = -Infinity;
        for (let i = 0; i < position.count; i++) {
            const facing = position.getX(i) * normal.getX(i) + position.getY(i) * normal.getY(i)
                + position.getZ(i) * normal.getZ(i);
            if (facing > 0) outward += 1;
            const r = Math.hypot(position.getX(i), position.getY(i), position.getZ(i));
            // A stone, not a ball and not a star: every point between half a unit and a little over one from its middle.
            expect(r).toBeGreaterThan(0.45);
            expect(r).toBeLessThan(1.25);
            low = Math.min(low, position.getY(i));
            high = Math.max(high, position.getY(i));
        }
        expect(outward / position.count).toBeGreaterThanOrEqual(0.97);
        // Its underside is flattened, so it sits.
        expect(-low).toBeLessThan(high);
        // Every triangle is wound the way its normals face.
        const triangles = trianglesOf(geometry);
        expect(triangles.filter((t) => t.face.dot(t.stored) <= 0)).toHaveLength(0);
        // The same stone every time; another seed is another stone.
        expect(Array.from(createBoulderGeometry().getAttribute('position').array)).toEqual(Array.from(position.array));
        expect(Array.from(createBoulderGeometry(3, 99).getAttribute('position').array))
            .not.toEqual(Array.from(position.array));
    });

    /** Where each stone of a plan really lies: its vertices, through its own instance matrix. */
    function stonesOf(plan) {
        const part = createBoulders(uniforms(), plan);
        const position = part.geometry.getAttribute('position');
        const matrix = new THREE.Matrix4();
        return plan.map((planned, i) => {
            part.mesh.getMatrixAt(i, matrix);
            const points = [];
            for (let k = 0; k < position.count; k++) {
                points.push(new THREE.Vector3().fromBufferAttribute(position, k).applyMatrix4(matrix));
            }
            const top = points.reduce((best, p) => (p.y > best.y ? p : best));
            const bottom = points.reduce((best, p) => (p.y < best.y ? p : best));
            /** The ground, or the water where the ground is under it. */
            const floor = (p) => Math.max(groundHeight(p.x, p.z), 0);
            return {
                planned,
                matrix: matrix.clone(),
                points,
                top,
                bottom,
                floor,
                /** The share of the stone that stands out of the ground and the water. */
                shown: points.filter((p) => p.y > floor(p)).length / points.length,
            };
        });
    }

    it('lays one instance where the plan puts each stone, at the plan\'s size, a little turned', () => {
        for (const quality of QUALITY_NAMES) {
            const plan = planBoulders(QUALITY[quality].boulders);
            const part = createBoulders(uniforms(), plan);
            expect(part.count).toBe(plan.length);
            expect(part.mesh.isInstancedMesh).toBe(true);
            expect(part.mesh.count).toBe(plan.length);
            expect(part.material.side).toBe(THREE.FrontSide);
            const at = new THREE.Vector3();
            const turn = new THREE.Quaternion();
            const scale = new THREE.Vector3();
            const matrix = new THREE.Matrix4();
            plan.forEach((b, i) => {
                part.mesh.getMatrixAt(i, matrix);
                matrix.decompose(at, turn, scale);
                expect(at.toArray()).toEqual([b.x, b.y, b.z].map((v) => expect.closeTo(v, 5)));
                expect(scale.x).toBeCloseTo(b.size[0], 5);
                expect(scale.z).toBeCloseTo(b.size[2], 5);
                expect(scale.y).toBeLessThanOrEqual(b.size[1] + 1e-6);
                expect(scale.y).toBeGreaterThan(b.size[1] * 0.7);
                // It keeps its flat side down: tipped by a few degrees, not rolled over.
                const up = new THREE.Vector3(0, 1, 0).applyQuaternion(turn);
                expect(up.y).toBeGreaterThan(0.95);
            });
        }
    });

    it('lies every stone in the ground or in the water: none stands on a point, none is hidden in the bank', () => {
        const stones = stonesOf(planBoulders(QUALITY_NAMES.map((q) => QUALITY[q].boulders).sort((a, b) => b - a)[0]));
        stones.forEach((stone, i) => {
            const label = `stone ${i} at (${stone.planned.x.toFixed(1)}, ${stone.planned.z.toFixed(1)})`;
            // A good part of it is in the ground or under the water...
            expect(stone.shown, label).toBeLessThan(0.95);
            // ...and a stone on the bank shows above it.
            const onBank = shoreDistance(stone.planned.x, stone.planned.z) > 0;
            if (onBank) expect(stone.shown, label).toBeGreaterThan(0.2);
        });
    });

    // The plan lays the spirit's stone by a number for where the lumpy mesh's top is (STONE_TOP);
    // this is the mesh itself. (The stone was once planned as if it were a unit sphere: its real
    // top lay nine centimetres under her feet and under the turf, and 1 % of it showed.)
    it('lays the spirit\'s stone where it can be seen, its top under her feet', () => {
        const [stone] = stonesOf(planBoulders(0));
        expect(Math.abs(stone.top.y - SPIRIT.home[1])).toBeLessThan(0.03);
        expect(stone.top.y).toBeGreaterThan(groundHeight(SPIRIT.home[0], SPIRIT.home[2]));
        expect(stone.shown).toBeGreaterThan(0.2);
    });

    // Every stone is bedded: its lowest point is in the ground or under the water. (A stone laid
    // by hand 4.4 m from the viewer once hovered 4.5 cm over the turf.)
    it('leaves no stone hovering: the lowest point of each is in the ground or under the water', () => {
        for (const quality of QUALITY_NAMES) {
            const hovering = stonesOf(planBoulders(QUALITY[quality].boulders))
                .filter((stone) => stone.bottom.y > stone.floor(stone.bottom))
                .map((stone) => [stone.planned.x, stone.planned.z, stone.bottom.y - stone.floor(stone.bottom)]);
            expect(hovering, quality).toEqual([]);
        }
    });
});

describe('stillwater meshes: the ground, the water and the sky', () => {
    it('lays the ground over the plan\'s heights, every triangle facing up', () => {
        for (const cell of [QUALITY.Minimal.cell, QUALITY.High.cell]) {
            const part = createGround(uniforms(), { cell });
            const { geometry } = part;
            const position = geometry.getAttribute('position');
            const shore = geometry.getAttribute('aShore');
            expect(Array.from(position.array).every(Number.isFinite)).toBe(true);
            expect(unitNormals(geometry)).toBe(true);
            for (let i = 0; i < position.count; i += 37) {
                expect(position.getY(i)).toBeCloseTo(groundHeight(position.getX(i), position.getZ(i)), 4);
                expect(shore.getX(i)).toBeCloseTo(shoreDistance(position.getX(i), position.getZ(i)), 3);
            }
            const triangles = trianglesOf(geometry);
            expect(triangles.length).toBeGreaterThan(1000);
            expect(triangles.filter((t) => !(t.face.y > 0))).toHaveLength(0);
            expect(triangles.filter((t) => !(t.face.dot(t.stored) > 0.5))).toHaveLength(0);
            // It covers the whole stage...
            const box = new THREE.Box3().setFromBufferAttribute(position);
            expect(box.min.x).toBeCloseTo(STAGE.x0, 6);
            expect(box.max.x).toBeCloseTo(STAGE.x1, 6);
            expect(box.min.z).toBeCloseTo(STAGE.z0, 6);
            expect(box.max.z).toBeCloseTo(STAGE.z1, 6);
            // ...but for the deep bed, which the opaque water hides: every triangle drawn has land or shallows in its cell.
            const deepest = Math.min(...triangles.map((t) => Math.max(...t.corners.map((c) => c.y))));
            expect(deepest).toBeGreaterThan(-2);
            // No hole in the bank: every triangle-sized patch of land is there. (Area of the land drawn ≈ area of the land.)
            let land = 0;
            for (const t of triangles) {
                if (Math.min(...t.corners.map((c) => shoreDistance(c.x, c.z))) > 0) land += t.area * t.face.y;
            }
            let expected = 0;
            const step = 0.5;
            for (let x = STAGE.x0 + step / 2; x < STAGE.x1; x += step) {
                for (let z = STAGE.z0 + step / 2; z < STAGE.z1; z += step) {
                    if (shoreDistance(x, z) > 0) expected += step * step;
                }
            }
            expect(land / expected).toBeGreaterThan(0.93);
            expect(land / expected).toBeLessThan(1.01);
        }
    });

    it('lays the water flat at y = 0, facing up, wider than the stage', () => {
        const part = createWater(uniforms(), { mirrorScale: 0 });
        const position = part.geometry.getAttribute('position');
        const normal = part.geometry.getAttribute('normal');
        for (let i = 0; i < position.count; i++) {
            expect(Math.abs(position.getY(i))).toBeLessThan(1e-9);
            expect(normal.getY(i)).toBeCloseTo(1, 9);
        }
        const triangles = trianglesOf(part.geometry);
        expect(triangles.every((t) => t.face.y > 0.999)).toBe(true);
        const box = new THREE.Box3().setFromBufferAttribute(position);
        expect(box.min.x).toBeLessThan(STAGE.x0);
        expect(box.max.x).toBeGreaterThan(STAGE.x1);
        expect(box.min.z).toBeLessThan(STAGE.z0);
        expect(box.max.z).toBeGreaterThan(EYE.z);
        // No mirror pass was asked for: none is made.
        expect(part.reflection).toBeNull();
        expect(part.reflectorTarget).toBeNull();
        // With one, the pass mirrors about the water's own plane.
        const mirrored = createWater(uniforms(), { mirrorScale: 0.5 });
        expect(mirrored.reflection).toBeTruthy();
        expect(mirrored.reflectorTarget).toBe(mirrored.reflection.target);
        const up = new THREE.Vector3(0, 0, 1).applyQuaternion(mirrored.reflectorTarget.quaternion);
        expect(up.y).toBeCloseTo(1, 9);
        expect(mirrored.reflectorTarget.position.y).toBe(0);
    });

    it('hangs the sky inside the camera\'s far plane, seen from within', () => {
        const part = createSky(uniforms());
        expect(part.material.side).toBe(THREE.BackSide);
        expect(part.material.depthWrite).toBe(false);
        part.geometry.computeBoundingSphere();
        const reach = part.geometry.boundingSphere.radius + Math.hypot(EYE.x, EYE.y, EYE.z);
        expect(reach).toBeLessThan(EYE.far);
        // And beyond everything that stands in the scene.
        const stage = Math.hypot(STAGE.x1 - STAGE.x0, STAGE.z1 - STAGE.z0);
        expect(part.geometry.boundingSphere.radius).toBeGreaterThan(stage);
    });
});

describe('stillwater meshes: what grows', () => {
    /** Triangles with an area, each checked against its stored normals and against `facing(triangle)`. */
    function expectFacing(geometry, label, facing) {
        const triangles = trianglesOf(geometry).filter((t) => t.area > 1e-12);
        expect(triangles.length, label).toBeGreaterThan(10);
        const wrong = [];
        triangles.forEach((t, i) => {
            if (!(t.face.dot(t.stored) > 0)) wrong.push(`${label} triangle ${i}: wound against its normals`);
            else if (!facing(t)) wrong.push(`${label} triangle ${i} at height ${t.centre.y.toFixed(2)}: faces inward`);
        });
        expect(wrong).toEqual([]);
    }

    /** Outward from the y axis, or upward (a cap's crown, a cone's tip). */
    const outwardOrUp = (t) => t.face.x * t.centre.x + t.face.z * t.centre.z > 0 || t.face.y > 0.5;

    it('builds a young spruce one unit tall whose boughs face outward and up', () => {
        const geometry = createSaplingGeometry();
        expectSound(geometry, 'sapling');
        expect(unitNormals(geometry)).toBe(true);
        expectFacing(geometry, 'sapling', outwardOrUp);
        // Every bough sheds the light downward and outward: no triangle faces down.
        expect(trianglesOf(geometry).every((t) => t.face.y > 0)).toBe(true);
        const box = new THREE.Box3().setFromBufferAttribute(geometry.getAttribute('position'));
        expect(box.min.y).toBeCloseTo(0, 6);
        expect(box.max.y).toBeCloseTo(1, 6);
        // Slender: a spruce, not a bush.
        expect(Math.max(box.max.x, -box.min.x, box.max.z, -box.min.z)).toBeLessThan(0.35);
        // The stored normals lean outward from the stem everywhere but at the tips.
        const position = geometry.getAttribute('position');
        const normal = geometry.getAttribute('normal');
        for (let i = 0; i < position.count; i++) {
            const r = Math.hypot(position.getX(i), position.getZ(i));
            if (r < 1e-9) expect(normal.getY(i)).toBeCloseTo(1, 6);
            else expect(position.getX(i) * normal.getX(i) + position.getZ(i) * normal.getZ(i)).toBeGreaterThan(0);
        }
    });

    it('builds a cap one unit tall: a stem and a dome, both facing outward', () => {
        const geometry = createCapGeometry();
        expectSound(geometry, 'cap');
        expect(unitNormals(geometry)).toBe(true);
        expectFacing(geometry, 'cap', outwardOrUp);
        const position = geometry.getAttribute('position');
        const kind = geometry.getAttribute('aKind');
        const box = new THREE.Box3().setFromBufferAttribute(position);
        expect(box.min.y).toBeCloseTo(0, 6);
        expect(box.max.y).toBeCloseTo(1, 6);
        let stemWidest = 0;
        let capWidest = 0;
        let stemTop = 0;
        let capLowest = Infinity;
        for (let i = 0; i < position.count; i++) {
            const r = Math.hypot(position.getX(i), position.getZ(i));
            expect([0, 1]).toContain(kind.getX(i));
            if (kind.getX(i) === 0) {
                stemWidest = Math.max(stemWidest, r);
                stemTop = Math.max(stemTop, position.getY(i));
            } else {
                capWidest = Math.max(capWidest, r);
                capLowest = Math.min(capLowest, position.getY(i));
            }
        }
        // The cap is far wider than its stem, and the stem reaches up into it.
        expect(capWidest).toBeGreaterThan(stemWidest * 3);
        expect(stemTop).toBeGreaterThanOrEqual(capLowest);
    });

    it('builds a lily pad that lies flat and faces up, with a notch cut to its middle', () => {
        for (const segments of [undefined, 6, 24]) {
            const geometry = createPadGeometry(segments);
            expectSound(geometry, 'pad');
            const position = geometry.getAttribute('position');
            const uv = geometry.getAttribute('uv');
            const triangles = trianglesOf(geometry);
            expect(triangles.every((t) => t.area > 0 && t.face.y > 0.999)).toBe(true);
            let widest = 0;
            for (let i = 0; i < position.count; i++) {
                expect(position.getY(i)).toBe(0);
                const r = Math.hypot(position.getX(i), position.getZ(i));
                widest = Math.max(widest, r);
                expect(r).toBeLessThan(1.15);
                // The leaf's veins are drawn from its uv: the disc's own plan, the stalk at the middle.
                expect(uv.getX(i)).toBeCloseTo(0.5 + (position.getX(i) / (r > 0 ? r : 1)) * 0.5, 6);
                expect(uv.getX(i)).toBeGreaterThanOrEqual(0);
                expect(uv.getX(i)).toBeLessThanOrEqual(1);
                expect(uv.getY(i)).toBeGreaterThanOrEqual(0);
                expect(uv.getY(i)).toBeLessThanOrEqual(1);
            }
            expect(widest).toBeGreaterThan(0.9);
            // The rim does not close: its first and last points stand either side of the notch.
            const first = new THREE.Vector3().fromBufferAttribute(position, 1);
            const last = new THREE.Vector3().fromBufferAttribute(position, position.count - 1);
            expect(first.distanceTo(last)).toBeGreaterThan(0.2);
            expect(first.distanceTo(last)).toBeLessThan(0.8);
            // It covers all of the disc but the notch.
            const area = triangles.reduce((sum, t) => sum + t.area, 0);
            expect(area).toBeGreaterThan(Math.PI * 0.75);
            expect(area).toBeLessThan(Math.PI * 1.1);
        }
    });

    it('builds a fern as a crown of arching ribbons about a unit across', () => {
        const geometry = createFernGeometry();
        expectSound(geometry, 'fern');
        const position = geometry.getAttribute('position');
        const uv = geometry.getAttribute('uv');
        const box = new THREE.Box3().setFromBufferAttribute(position);
        expect(box.min.y).toBeGreaterThanOrEqual(-1e-6); // it grows up out of the moss, never into it
        expect(box.max.y).toBeGreaterThan(0.2);
        expect(box.max.y).toBeLessThan(1);
        for (const reach of [box.max.x, -box.min.x, box.max.z, -box.min.z]) {
            expect(reach).toBeGreaterThan(0.4);
            expect(reach).toBeLessThan(1.3);
        }
        // uv = (how far along the frond 0..1, which edge −1 | +1): the pinnae are cut out by it.
        const pieces = piecesOf(geometry);
        expect(pieces.length).toBeGreaterThanOrEqual(5);
        for (const frond of pieces) {
            let tip = 0;
            for (const i of frond.vertices) {
                expect(uv.getX(i)).toBeGreaterThanOrEqual(0);
                expect(uv.getX(i)).toBeLessThanOrEqual(1);
                expect(Math.abs(uv.getY(i))).toBe(1);
                tip = Math.max(tip, uv.getX(i));
            }
            expect(tip).toBe(1);
            expect(frond.vertices.filter((i) => uv.getY(i) < 0)).toHaveLength(frond.vertices.length / 2);
            // It starts at the crown and its far end is its tip.
            const root = frond.vertices.filter((i) => uv.getX(i) === 0)
                .map((i) => Math.hypot(position.getX(i), position.getZ(i)));
            const end = frond.vertices.filter((i) => uv.getX(i) === 1)
                .map((i) => Math.hypot(position.getX(i), position.getZ(i)));
            expect(Math.max(...root)).toBeLessThan(0.25);
            expect(Math.min(...end)).toBeGreaterThan(0.3);
        }
        // No ribbon is folded: every triangle of it has an area and faces up.
        expect(trianglesOf(geometry).every((t) => t.area > 1e-6 && t.face.y > 0)).toBe(true);
    });

    it('gives a water lily its petals as numbers for the vertex stage', () => {
        const geometry = createLilyGeometry();
        expectSound(geometry, 'lily');
        const position = geometry.getAttribute('position');
        const petal = geometry.getAttribute('aPetal');
        const tilt = geometry.getAttribute('aTilt');
        // Each vertex is placed by the shader: it starts at the flower's middle.
        expect(Array.from(position.array).every((v) => v === 0)).toBe(true);
        const petals = piecesOf(geometry);
        expect(petals.length).toBeGreaterThanOrEqual(8);
        const bearings = new Set();
        for (const one of petals) {
            // A petal: its root, its tip, and its two shoulders.
            expect(one.vertices).toHaveLength(4);
            expect(one.triangles).toHaveLength(2);
            const along = one.vertices.map((i) => petal.getY(i)).sort((a, b) => a - b);
            const across = one.vertices.map((i) => petal.getZ(i)).sort((a, b) => a - b);
            expect(along[0]).toBe(0);
            expect(along[3]).toBe(1);
            expect(across[0]).toBe(-1);
            expect(across[3]).toBe(1);
            expect(across[1] + across[2]).toBe(0);
            for (const i of one.vertices) {
                // (bearing, how far along 0..1, how far across −1..1, the petal's length)
                expect(petal.getX(i)).toBe(petal.getX(one.vertices[0]));
                expect(petal.getY(i)).toBeGreaterThanOrEqual(0);
                expect(petal.getY(i)).toBeLessThanOrEqual(1);
                expect(Math.abs(petal.getZ(i))).toBeLessThanOrEqual(1);
                expect(petal.getW(i)).toBeGreaterThan(0);
                expect(petal.getW(i)).toBeLessThanOrEqual(1);
                // (its tilt shut, its tilt open): shut it stands nearly upright, open it lies back.
                expect(tilt.getX(i)).toBeGreaterThan(tilt.getY(i));
                expect(tilt.getX(i)).toBeLessThanOrEqual(Math.PI / 2);
                expect(tilt.getY(i)).toBeGreaterThanOrEqual(0);
            }
            bearings.add(petal.getX(one.vertices[0]).toFixed(4));
        }
        // No two petals on one bearing: the whorls are turned against each other.
        expect(bearings.size).toBe(petals.length);
        // The inner whorls are shorter and stay more upright when open.
        const byLength = petals.map((one) => [petal.getW(one.vertices[0]), tilt.getY(one.vertices[0])])
            .sort((a, b) => a[0] - b[0]);
        expect(byLength[0][1]).toBeGreaterThan(byLength.at(-1)[1]);
    });
});

describe('stillwater meshes: the spirit', () => {
    const geometry = createSpiritGeometry();
    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    const body = geometry.getAttribute('aBody');
    const pieces = piecesOf(geometry);
    const kindsOf = (piece) => [...new Set(piece.vertices.map((i) => body.getX(i)))].sort();
    /** The gown with the head on it is the piece built first; the hair is the one piece of kind 1. */
    const gown = pieces[0];
    const hair = pieces.find((piece) => kindsOf(piece).includes(1));
    const arms = pieces.filter((piece) => piece !== gown && piece !== hair);

    /** Share of a list of vertices whose normal points away from the y axis (on the axis: upward). */
    const outwardShare = (vertices) => {
        let outward = 0;
        for (const i of vertices) {
            const r = Math.hypot(position.getX(i), position.getZ(i));
            const away = position.getX(i) * normal.getX(i) + position.getZ(i) * normal.getZ(i);
            if (r < 1e-9 ? normal.getY(i) > 0 : away > 0) outward += 1;
        }
        return outward / vertices.length;
    };

    it('is one figure a unit tall: a gown with a head, a mantle of hair, two arms', () => {
        expectSound(geometry, 'spirit');
        expect(unitNormals(geometry)).toBe(true);
        expect(pieces).toHaveLength(4);
        expect(kindsOf(gown)).toEqual([0, 2]);
        expect(kindsOf(hair)).toEqual([1]);
        expect(arms).toHaveLength(2);
        const box = new THREE.Box3().setFromBufferAttribute(position);
        expect(box.min.y).toBeCloseTo(0, 6);
        expect(box.max.y).toBeCloseTo(1, 6);
        for (let i = 0; i < position.count; i++) {
            // A slender figure: nothing further than a third of her height from her axis.
            expect(Math.hypot(position.getX(i), position.getZ(i))).toBeLessThan(0.33);
            // aBody = (what it is: 0 gown, 1 hair, 2 head and hands; how freely it moves 0..1).
            expect([0, 1, 2]).toContain(body.getX(i));
            expect(body.getY(i)).toBeGreaterThanOrEqual(0);
            expect(body.getY(i)).toBeLessThanOrEqual(1);
        }
        // The same figure every time.
        expect(Array.from(createSpiritGeometry().getAttribute('position').array)).toEqual(Array.from(position.array));
    });

    it('turns the gown and the head outward', () => {
        const cloth = gown.vertices.filter((i) => body.getX(i) === 0);
        const head = gown.vertices.filter((i) => body.getX(i) === 2);
        expect(cloth.length).toBeGreaterThan(100);
        expect(head.length).toBeGreaterThan(30);
        // The head and neck are marked by height: everything above her shoulders.
        const shoulder = Math.max(...cloth.map((i) => position.getY(i)));
        expect(Math.min(...head.map((i) => position.getY(i)))).toBeGreaterThan(shoulder);
        expect(shoulder).toBeGreaterThan(0.7);
        expect(outwardShare(cloth)).toBeGreaterThanOrEqual(0.95);
        expect(outwardShare(head)).toBeGreaterThanOrEqual(0.95);
        // And the triangles are wound the way the normals face.
        const triangles = trianglesOf(geometry).filter((t) => gown.triangles.includes(t.first) && t.area > 1e-12);
        expect(triangles.filter((t) => !(t.face.dot(t.stored) > 0))).toHaveLength(0);
        const inward = triangles.filter((t) => !(t.face.x * t.centre.x + t.face.z * t.centre.z > 0 || t.face.y > 0.5));
        expect(inward.length / triangles.length).toBeLessThan(0.02);
    });

    it('turns her hair outward, down her back', () => {
        expect(outwardShare(hair.vertices)).toBeGreaterThanOrEqual(0.95);
        // She faces +z: the mantle hangs behind her, from the crown down past her waist.
        const mean = hair.vertices.reduce((sum, i) => sum + position.getZ(i), 0) / hair.vertices.length;
        expect(mean).toBeLessThan(0);
        const heights = hair.vertices.map((i) => position.getY(i));
        expect(Math.max(...heights)).toBeGreaterThan(0.9);
        expect(Math.min(...heights)).toBeLessThan(0.5);
        // A mantle, not a hood: it is open at the front (no part of it before her face).
        expect(Math.max(...hair.vertices.map((i) => position.getZ(i)))).toBeLessThan(0.05);
        const triangles = trianglesOf(geometry).filter((t) => hair.triangles.includes(t.first));
        expect(triangles.filter((t) => t.area > 1e-12 && !(t.face.dot(t.stored) > 0))).toHaveLength(0);
    });

    it('turns each arm\'s skin away from the arm\'s own axis', () => {
        const index = geometry.getIndex();
        const sides = [];
        for (const arm of arms) {
            // The first two triangles of a tube span its first ring and the next: that gives the ring's length.
            const used = [...new Set([0, 1, 2, 3, 4, 5].map((k) => index.getX(arm.triangles[0] + k)))]
                .sort((a, b) => a - b);
            const ring = used[2] - used[0];
            expect(ring).toBeGreaterThanOrEqual(3);
            expect(arm.vertices.length % ring).toBe(0);
            const centres = ringCentres(geometry, arm, ring, false);
            expect(centres.length).toBeGreaterThanOrEqual(3);
            const triangles = trianglesOf(geometry).filter((t) => arm.triangles.includes(t.first) && t.area > 1e-14);
            expect(triangles.length).toBeGreaterThan(20);
            const outward = (t) => t.face.dot(t.centre.clone().sub(nearestOnLine(centres, t.centre))) > 0;
            const inward = triangles.filter((t) => !outward(t));
            expect(inward.map((t) => t.first)).toEqual([]);
            const point = new THREE.Vector3();
            const facing = new THREE.Vector3();
            for (const i of arm.vertices) {
                point.fromBufferAttribute(position, i);
                facing.fromBufferAttribute(normal, i);
                const away = point.clone().sub(nearestOnLine(centres, point));
                expect(facing.dot(away), `arm vertex ${i}`).toBeGreaterThan(0);
            }
            // From the shoulder down to the hand, which is folded before her (she faces +z).
            const shoulder = centres[0];
            const hand = centres.at(-1);
            expect(shoulder.y).toBeGreaterThan(hand.y);
            expect(hand.z).toBeGreaterThan(shoulder.z);
            expect(Math.abs(hand.x)).toBeLessThan(Math.abs(shoulder.x));
            sides.push(Math.sign(shoulder.x));
            // The hand is skin; the sleeve is the gown's cloth.
            expect(body.getX(arm.vertices.at(-1))).toBe(2);
            expect(body.getX(arm.vertices[0])).toBe(0);
        }
        expect(sides.sort()).toEqual([-1, 1]);
    });

    it('lets the hem and the hair move, and holds the head and the arms still', () => {
        const free = (i) => body.getY(i);
        const hem = gown.vertices.filter((i) => position.getY(i) < 0.05);
        const head = gown.vertices.filter((i) => body.getX(i) === 2);
        expect(Math.min(...hem.map(free))).toBeGreaterThan(0.7);
        expect(Math.max(...head.map(free))).toBe(0);
        for (const arm of arms) expect(Math.max(...arm.vertices.map(free))).toBe(0);
        // The gown moves the more the lower it hangs.
        const cloth = gown.vertices.filter((i) => body.getX(i) === 0)
            .sort((a, b) => position.getY(a) - position.getY(b));
        for (let k = 1; k < cloth.length; k++) expect(free(cloth[k])).toBeLessThanOrEqual(free(cloth[k - 1]) + 1e-6);
        // Her hair is held at the crown and free at its ends.
        const crown = hair.vertices.filter((i) => position.getY(i) > 0.9);
        const ends = hair.vertices.filter((i) => position.getY(i) < 0.35);
        expect(Math.max(...crown.map(free))).toBeLessThan(0.05);
        expect(Math.min(...ends.map(free))).toBeGreaterThan(0.5);
    });
});
