/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Sacred Geometry's crystal: three nested solids of light — a dodecahedron holding an
 * icosahedron holding a star tetrahedron — turning at their own paces around one core.
 *
 * Each solid is drawn three times, all additive: a thin edge tube that burns white-hot along its
 * axis and takes the solid's tint toward its rim, a wider glow tube that fades to nothing at its
 * silhouette (so the edges glow on tiers with no bloom), and faint glass faces whose thin-film
 * colours shift with the viewing angle. Nearer edges burn brighter, so the cage reads in depth.
 *
 * The obsidian floor's reflection is a second copy of the whole hierarchy, mirrored about the
 * floor line, with its own (dimmer, cooler) materials that fade with distance below the floor.
 * Sizes here are for a gate of half-size REFERENCE_GATE; the world scales the whole crystal.
 */
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
    Fn, abs, clamp, cos, dot, exp, float, max, mix, normalView, normalize, positionLocal, positionViewDirection,
    positionWorld, sin, smoothstep, vec3,
} from 'three/tsl';
import { fadeOut } from '../stage/breath-tsl.js';

const TAU = Math.PI * 2;
/** The gate half-size the crystal below is drawn for. */
export const REFERENCE_GATE = 0.7;
const WHITE_GOLD = vec3(1.0, 0.9, 0.74);
/** The reflection drifts toward the void's violet: obsidian is a cool, dark mirror. */
const MIRROR_TINT = vec3(0.62, 0.55, 1.0);

/**
 * The three solids, outer to inner. radius: circumradius; core/glow: tube radii; tint: edge
 * colour; halo: glow colour; gain: brightness; film: thin-film hue offset of the glass faces;
 * scale: [empty lungs, full lungs] — the inner star unfolds the most.
 */
const SOLIDS = [
    {
        make: (r) => new THREE.DodecahedronGeometry(r, 0),
        radius: 0.52,
        core: 0.006,
        glow: 0.023,
        tint: [0.66, 0.5, 1.0],
        halo: [0.42, 0.24, 1.0],
        gain: 0.95,
        film: 0.62,
        faces: 0.75,
        scale: [0.8, 1.05],
    },
    {
        make: (r) => new THREE.IcosahedronGeometry(r, 0),
        radius: 0.42,
        core: 0.0066,
        glow: 0.024,
        tint: [1.0, 0.72, 0.36],
        halo: [1.0, 0.52, 0.18],
        gain: 1.3,
        film: 0.1,
        faces: 0.9,
        scale: [0.84, 1.04],
    },
    {
        make: (r) => new THREE.TetrahedronGeometry(r, 0),
        radius: 0.28,
        core: 0.0062,
        glow: 0.022,
        tint: [1.0, 0.7, 0.8],
        halo: [1.0, 0.42, 0.6],
        gain: 1.45,
        film: 0.35,
        faces: 1.0,
        scale: [0.72, 1.14],
    },
];

/**
 * A solid's edges as one mesh: open tubes along every edge and a smooth bead on every corner.
 * (The stage's edgeTubes uses faceted beads; a glow tube needs round ones, or its corners
 * show facets.)
 */
function crystalEdges(source, radius, segments, bead) {
    const edges = new THREE.EdgesGeometry(source, 1);
    const { position } = edges.attributes;
    const parts = [];
    const corners = new Map();
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const direction = new THREE.Vector3();
    const turn = new THREE.Quaternion();
    for (let i = 0; i < position.count; i += 2) {
        a.fromBufferAttribute(position, i);
        b.fromBufferAttribute(position, i + 1);
        direction.subVectors(b, a);
        const tube = new THREE.CylinderGeometry(radius, radius, direction.length(), segments, 1, true);
        tube.applyQuaternion(turn.setFromUnitVectors(up, direction.normalize()));
        tube.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
        parts.push(tube.toNonIndexed());
        tube.dispose();
        [a, b].forEach((corner) => {
            const key = `${corner.x.toFixed(3)},${corner.y.toFixed(3)},${corner.z.toFixed(3)}`;
            if (!corners.has(key)) corners.set(key, corner.clone());
        });
    }
    corners.forEach((corner) => {
        const sphere = new THREE.SphereGeometry(radius * bead, segments + 2, Math.max(4, segments - 1));
        sphere.translate(corner.x, corner.y, corner.z);
        parts.push(sphere.toNonIndexed());
        sphere.dispose();
    });
    const merged = mergeGeometries(parts);
    parts.forEach((part) => part.dispose());
    edges.dispose();
    return merged;
}

/** How squarely a fragment faces the lens: 1 on a tube's axis, 0 at its silhouette. */
const facingNode = () => clamp(abs(dot(normalize(normalView), positionViewDirection)), 0, 1);

/**
 * The reflection: dimmer, cooler, and fading with depth below the floor line (`floorY`, a
 * uniform node) — and nothing above it, should a solid ever dip that far.
 */
function mirrorOf(colour, floorY) {
    const under = floorY.sub(positionWorld.y).max(0);
    const fade = exp(under.mul(-1.7)).mul(fadeOut(floorY.sub(0.012), floorY, positionWorld.y));
    return mix(colour, colour.mul(MIRROR_TINT), 0.45).mul(fade).mul(0.42);
}

function additive(side = THREE.FrontSide) {
    return new THREE.MeshBasicNodeMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side,
    });
}

/**
 * Light running along the edges: slow planar pulses sweeping through the solid's own space, so
 * as it turns, beads of light travel each edge. They wake in the full hold (`hold` 0..1).
 */
function shimmer(u, hold, seed) {
    const q = positionLocal.mul(8.5);
    const wave = sin(q.x.add(q.y.mul(1.31)).sub(q.z.mul(0.73)).add(u.time.mul(0.9)).add(seed)).mul(0.5).add(0.5);
    const w2 = wave.mul(wave);
    const w4 = w2.mul(w2);
    return w4.mul(w4).mul(hold.mul(0.75).add(0.15));
}

/** Nearer edges burn brighter: the cage reads as a solid, not a flat drawing. */
const nearness = () => smoothstep(-0.5, 0.5, positionWorld.z).mul(0.68).add(0.32);

/** The breath's light: dim at empty lungs, bright at full. */
const breathLight = (u) => u.breathSoft.mul(0.72).add(0.42);

function coreMaterial(u, look, hold, seed, floorY) {
    const material = additive();
    material.colorNode = Fn(() => {
        const facing = facingNode().toVar();
        const f2 = facing.mul(facing);
        const axis = f2.mul(f2).toVar();
        const tint = mix(vec3(...look.tint), WHITE_GOLD, axis);
        const light = axis.mul(1.25).add(0.16).mul(nearness()).mul(breathLight(u))
            .mul(look.gain)
            .mul(shimmer(u, hold, seed).add(1));
        const colour = tint.mul(light);
        return floorY === null ? colour : mirrorOf(colour, floorY);
    })();
    return material;
}

function glowMaterial(u, look, hold, seed, floorY) {
    const material = additive();
    material.colorNode = Fn(() => {
        const facing = facingNode().toVar();
        // Falls to zero at the silhouette: a soft halo with no visible tube wall.
        const soft = facing.mul(facing).mul(facing);
        const light = soft.mul(0.18).mul(nearness()).mul(breathLight(u)).mul(look.gain)
            .mul(shimmer(u, hold, seed).mul(0.6).add(1));
        const colour = vec3(...look.halo).mul(light);
        return floorY === null ? colour : mirrorOf(colour, floorY);
    })();
    return material;
}

/**
 * Glass faces: almost clear head-on, a thin-film sheen at grazing angles. The film's thickness
 * varies across each facet and with the angle, so colour slides over the faces as they turn.
 */
function faceMaterial(u, look, floorY) {
    const material = additive(THREE.DoubleSide);
    material.colorNode = Fn(() => {
        const facing = facingNode().toVar();
        const graze = float(1).sub(facing).toVar();
        const g2 = graze.mul(graze);
        const sheen = g2.mul(g2).toVar();
        const thickness = dot(positionLocal, vec3(1.6, -1.05, 0.8)).mul(0.85).add(graze.mul(1.5)).add(look.film)
            .add(u.time.mul(0.025));
        const film = cos(vec3(0.0, 0.33, 0.67).add(thickness).mul(TAU)).mul(0.5).add(0.5).toVar();
        // Lean the rainbow toward the temple's gold, violet and rose.
        const tinted = mix(film, film.mul(vec3(1.0, 0.72, 0.95)), 0.35);
        const light = sheen.mul(0.22).add(0.018).mul(breathLight(u)).mul(look.faces);
        const colour = max(tinted, 0).mul(light);
        return floorY === null ? colour : mirrorOf(colour, floorY);
    })();
    return material;
}

/**
 * One full hierarchy of the three solids. `floorY` null: the solids themselves; a uniform node:
 * their reflection's materials (the caller mirrors the group).
 */
function buildHierarchy(u, hold, geometry, floorY) {
    const root = new THREE.Group();
    const parts = SOLIDS.map((look, index) => {
        const pivot = new THREE.Group();
        const seed = index * 2.1;
        const core = coreMaterial(u, look, hold, seed, floorY);
        const glow = glowMaterial(u, look, hold, seed, floorY);
        const faces = faceMaterial(u, look, floorY);
        const meshes = (copies) => copies.map((turnZ) => {
            const holder = new THREE.Group();
            holder.rotation.z = turnZ;
            [[geometry[index].core, core], [geometry[index].glow, glow], [geometry[index].faces, faces]]
                .forEach(([shape, material]) => {
                    const mesh = new THREE.Mesh(shape, material);
                    mesh.frustumCulled = false;
                    holder.add(mesh);
                });
            pivot.add(holder);
            return holder;
        });
        // The star tetrahedron is a tetrahedron and its dual: the same solid turned a quarter about z.
        const holders = meshes(index === 2 ? [0, Math.PI / 2] : [0]);
        root.add(pivot);
        return { pivot, holders };
    });
    return { root, parts };
}

/**
 * @param {object} u breath uniforms
 * @param {object} options
 * @param {object} options.hold uniform 0..1: how deep into the full hold the breath is
 * @param {object} options.floorY uniform: the floor line in hero units (the mirror plane)
 */
export function createSacredSolids(u, { hold, floorY }) {
    const geometry = SOLIDS.map((look) => {
        const source = look.make(look.radius);
        return {
            core: crystalEdges(source, look.core, 6, 2.0),
            glow: crystalEdges(source, look.glow, 8, 1.35),
            faces: source,
        };
    });
    const solids = buildHierarchy(u, hold, geometry, null);
    const mirror = buildHierarchy(u, hold, geometry, floorY);

    /**
     * Closed-form pose (no integration), so a seeked frame is the same frame every time.
     * `centre`: the crystal's height; `scale`: its size against REFERENCE_GATE; `floor`: the
     * mirror line. Returns the core's height (the crystal floats in a slow bob).
     */
    function pose(time, open, { centre, scale, floor }) {
        const turns = [
            [time * 0.043 + open * 0.2, time * 0.067, time * 0.019],
            [-time * 0.056, time * 0.041 - open * 0.32, time * 0.028],
            [time * 0.078, -time * 0.094 + open * 0.55, open * 0.12],
        ];
        const core = centre + (Math.sin(time * 0.37) * 0.012 + open * 0.02) * scale;
        solids.root.position.set(0, core, 0);
        solids.root.scale.setScalar(scale);
        // Mirror about the floor line: y -> 2 floor - y.
        mirror.root.position.set(0, 2 * floor - core, 0);
        mirror.root.scale.set(scale, -scale, scale);
        [solids, mirror].forEach(({ parts }) => {
            parts.forEach(({ pivot, holders }, index) => {
                const [lo, hi] = SOLIDS[index].scale;
                pivot.scale.setScalar(lo + (hi - lo) * open);
                pivot.rotation.set(...turns[index]);
                // The star unfolds: its two tetrahedra twist apart as the lungs fill.
                if (holders.length === 2) {
                    holders[0].rotation.y = open * 0.3;
                    holders[1].rotation.y = -open * 0.3;
                }
            });
        });
        return core;
    }

    return {
        group: solids.root,
        mirror: mirror.root,
        pose,
    };
}
