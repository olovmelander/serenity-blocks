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
    createBoughs, createCrownGeometry, createCrowns, createTrunkGeometry, createTrunks, crownCard, planBoughs,
    planCrowns, trunkCentre, trunkRadius,
} from '../../src/themes/stillwater/stillwater-trees.js';
import { createBoulderGeometry, createBoulders, createGround } from '../../src/themes/stillwater/stillwater-land.js';
import {
    createCapGeometry, createFernGeometry, createLilyGeometry, createPadGeometry, createSaplingGeometry,
} from '../../src/themes/stillwater/stillwater-flora.js';
import { createSky } from '../../src/themes/stillwater/stillwater-sky.js';
import { createWater } from '../../src/themes/stillwater/stillwater-water.js';
import {
    STAGE, azimuthOf, crownFloor, groundHeight, planBoulders, planTrunks, rangeOf, shoreDistance,
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

    // Once hung from the near trunks too, pointing every way: seen steeply from below, a bough
    // there read as a shelf or a hoop on its trunk.
    it('hangs the wood\'s boughs from trunks some way off, across the line of sight', () => {
        for (const quality of QUALITY_NAMES) {
            const tier = QUALITY[quality];
            const trunks = planTrunks(tier.trunks);
            const rest = planBoughs(trunks, tier.boughs).filter((bough) => !bough.fringe);
            expect(rest.length, quality).toBeGreaterThan(0);
            for (const bough of rest) {
                const { trunk } = ownerOf(bough, trunks);
                const range = rangeOf(trunk.x, trunk.z);
                const label = `${quality}: the bough at (${bough.x.toFixed(1)}, ${bough.z.toFixed(1)})`;
                expect(range, label).toBeGreaterThanOrEqual(16);
                expect(range, label).toBeLessThan(44);
                const sight = [(trunk.x - EYE.x) / range, (trunk.z - EYE.z) / range];
                const along = Math.cos(bough.yaw) * sight[0] + Math.sin(bough.yaw) * sight[1];
                expect(Math.abs(along), label).toBeLessThan(Math.sin(20 * (Math.PI / 180)));
            }
        }
    });
});

describe('stillwater meshes: the crowns', () => {
    const DEG = Math.PI / 180;
    const EYE_AT = [EYE.x, EYE.y, EYE.z];
    /** Each tree that has a crown, with its crown (the plan keeps the trunks' order). */
    const crowned = (quality) => {
        const trunks = planTrunks(QUALITY[quality].trunks);
        const crowns = planCrowns(trunks);
        const own = trunks.filter((t) => !(t.hero && rangeOf(t.x, t.z) < 9));
        return own.map((trunk, i) => ({ trunk, crown: crowns[i] }));
    };
    /** Does a sight line from the rest eye cross any crown's card (stage drawn in by `squeeze`)? */
    const crosses = (crowns, azimuth, elevation, squeeze = 1) => {
        const ray = new THREE.Ray(new THREE.Vector3(...EYE_AT), new THREE.Vector3(...skyDirection(azimuth, elevation)));
        const hit = new THREE.Vector3();
        return crowns.some((k) => {
            const card = crownCard(k, EYE_AT, squeeze).map((p) => new THREE.Vector3(...p));
            return Boolean(ray.intersectTriangle(card[0], card[1], card[2], false, hit)
                || ray.intersectTriangle(card[2], card[1], card[3], false, hit));
        });
    };

    it('gives every tree but the two giants a crown, the same every time', () => {
        for (const quality of QUALITY_NAMES) {
            const trunks = planTrunks(QUALITY[quality].trunks);
            const crowns = planCrowns(trunks);
            expect(crowns, quality).toHaveLength(trunks.length - 2);
            expect(planCrowns(trunks), quality).toEqual(crowns);
            for (const k of crowns) expect(Object.values(k).flat().every(Number.isFinite), quality).toBe(true);
        }
        expect(planCrowns([])).toEqual([]);
        // One tree's crown never moves another's: a shorter list of trunks crowns its trees alike.
        const trunks = planTrunks(QUALITY.High.trunks);
        expect(planCrowns(trunks.slice(0, 20))).toEqual(planCrowns(trunks).slice(0, 18));
    });

    it('stands each crown on its own trunk: its foot on the trunk, its tip over the trunk\'s top', () => {
        for (const quality of QUALITY_NAMES) {
            for (const { trunk: t, crown: k } of crowned(quality)) {
                const label = `${quality}: the crown at (${t.x.toFixed(1)}, ${t.z.toFixed(1)})`;
                const line = trunkCentre(t, k.y - t.y);
                expect(Math.hypot(k.x - line[0], k.z - line[2]), label).toBeLessThan(1e-9);
                // Its lowest whorl well above the moss; its tip, the leader, over the trunk's top.
                expect(k.y - groundHeight(t.x, t.z), label).toBeGreaterThan(1.5);
                expect(k.y + k.length, label).toBeGreaterThan(t.y + t.height);
                expect(k.length, label).toBeGreaterThanOrEqual(3 - 1e-9);
                expect(k.width, label).toBeGreaterThanOrEqual(1);
                expect(k.width, label).toBeLessThanOrEqual(3.6);
                // Whorls a little under a metre apart, at least four of them.
                expect(k.spacing, label).toBeGreaterThan(0.45);
                expect(k.spacing, label).toBeLessThan(1.3);
                expect(Math.round(k.length / k.spacing), label).toBeGreaterThanOrEqual(4);
                // The card stands in front of the trunk, so the needles hide it.
                expect(k.push, label).toBeGreaterThan(trunkRadius(t, k.y - t.y, 0));
            }
        }
    });

    it('lets the trees at the water keep their low branches', () => {
        /** How far up its trunk a crown starts, on average. */
        const share = (list) => list
            .reduce((sum, { trunk: t, crown: k }) => sum + (k.y - t.y) / t.height, 0) / list.length;
        const open = crowned('High').filter(({ trunk: t, crown: k }) => crownFloor(t.x, t.z, k.width * 1.2) === null);
        const shore = open.filter(({ trunk: t }) => shoreDistance(t.x, t.z) < 4);
        const inland = open.filter(({ trunk: t }) => shoreDistance(t.x, t.z) > 10);
        expect(shore.length).toBeGreaterThan(3);
        expect(inland.length).toBeGreaterThan(3);
        expect(share(shore)).toBeLessThan(share(inland) - 0.1);
    });

    it('starts a crown above any window it would reach into', () => {
        expect(crownFloor(0, -60, 2)).toBeNull();
        // The spirit's side (the moon above her at any range), and the troll's.
        expect(crownFloor(-12, -18, 2)).toBeGreaterThanOrEqual(15 * DEG);
        expect(crownFloor(-40, -100, 2)).toBeGreaterThanOrEqual(15 * DEG);
        expect(crownFloor(9.5, -14, 2)).toBeGreaterThanOrEqual(9 * DEG);
        for (const quality of QUALITY_NAMES) {
            for (const { trunk: t, crown: k } of crowned(quality)) {
                const floor = crownFloor(t.x, t.z, k.width * 1.2);
                if (floor === null || k.length <= 3 + 1e-9) continue;
                const foot = Math.atan2(k.y - EYE.y, rangeOf(t.x, t.z));
                const label = `${quality}: the crown at (${t.x.toFixed(1)}, ${t.z.toFixed(1)})`;
                expect(foot, label).toBeGreaterThanOrEqual(floor - 1e-9);
            }
        }
    });

    it('builds four corners per crown at its foot, spread into a card that faces the eye', () => {
        const crowns = crowned('High').map((p) => p.crown);
        const geometry = createCrownGeometry(crowns);
        expectSound(geometry, 'crowns');
        const position = geometry.getAttribute('position');
        expect(position.count).toBe(crowns.length * 4);
        for (let i = 0; i < position.count; i++) {
            const k = crowns[Math.floor(i / 4)];
            // (Stored as 32-bit floats.)
            expect(position.getX(i)).toBeCloseTo(k.x, 4);
            expect(position.getY(i)).toBeCloseTo(k.y, 4);
            expect(position.getZ(i)).toBeCloseTo(k.z, 4);
        }
        for (const k of crowns) {
            const card = crownCard(k, EYE_AT);
            const across = new THREE.Vector3(...card[1]).sub(new THREE.Vector3(...card[0]));
            const sight = new THREE.Vector3(k.x - EYE.x, 0, k.z - EYE.z).normalize();
            // Square to the line of sight, as wide as the crown, upright, and stood in front of its trunk.
            expect(Math.abs(across.dot(sight))).toBeLessThan(1e-9);
            expect(across.length()).toBeCloseTo(k.width * 2 * 1.2, 9);
            expect(card[2][1] - card[0][1]).toBeCloseTo(k.length + 0.3 + 0.9, 9);
            const middle = new THREE.Vector3(...card[0]).add(new THREE.Vector3(...card[1])).multiplyScalar(0.5);
            expect(Math.hypot(middle.x - EYE.x, middle.z - EYE.z)).toBeLessThan(Math.hypot(k.x - EYE.x, k.z - EYE.z));
        }
        // The cut-out's edge is laid down by coverage over a multisampled pass, all or nothing otherwise.
        const fine = createCrowns(uniforms(), crowns, { samples: 4 });
        expect(fine.material.alphaToCoverage).toBe(true);
        expect(fine.material.side).toBe(THREE.DoubleSide);
        expect(fine.count).toBe(crowns.length);
        expect(fine.plan).toBe(crowns);
        expect(createCrowns(uniforms(), crowns).material.alphaToCoverage).toBe(false);
    });

    it('crowns the wood across the top of a wide frame, and hangs none across the moon on any frame', () => {
        const crowns = crowned('High').map((p) => p.crown);
        // The cards are where the picture has them: most sight lines across the top of the frame,
        // away from the moon, meet a crown.
        let met = 0;
        let cast = 0;
        for (let az = -32; az <= 32; az += 2) {
            if (az > -30 && az < -12) continue;
            cast += 1;
            if (crosses(crowns, az * DEG, 14 * DEG)) met += 1;
        }
        expect(met / cast).toBeGreaterThan(0.5);
        for (const quality of QUALITY_NAMES) {
            const own = crowned(quality).map((p) => p.crown);
            const frames = [[3440, 1440], [1600, 900], [1280, 1024], [1000, 1000], [820, 1180], [430, 932], [390, 844]];
            for (const [width, height] of frames) {
                const aspect = width / height;
                const squeeze = squeezeFor(aspect);
                const moon = moonFor(aspect);
                const lines = [[moon.azimuth, moon.elevation]];
                for (let n = 0; n < 8; n++) {
                    const turn = (n * Math.PI) / 4;
                    const rim = [Math.cos(turn) * MOON.radius, Math.sin(turn) * MOON.radius];
                    lines.push([moon.azimuth + rim[0], moon.elevation + rim[1]]);
                }
                const crossed = lines.filter(([a, e]) => crosses(own, a, e, squeeze)).length;
                expect(crossed, `${quality} at ${width} × ${height}`).toBe(0);
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
