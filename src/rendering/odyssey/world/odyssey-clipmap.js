import * as THREE from 'three/webgpu';

/**
 * NESTED-RING GEOMETRY CLIPMAP — the ground mesh for the Odyssey One World rebuild.
 *
 * See docs/ODYSSEY_ONE_WORLD_PLAN_2026-08.md §3.1. One static mesh, one draw call, zero CPU
 * rebuild and zero per-frame upload. The vertex buffer contains NO POSITIONS — only
 * `(gridIndex, ringLevel, gridIndex)` — and the vertex stage turns that into a world position
 * every frame. Nothing here is ever touched again after build.
 *
 * Kept as a pure builder with no material and no scene coupling, so the invariants below can
 * be unit-tested without a GPU. Two of them fail SILENTLY at runtime, which is exactly why
 * they are worth a test rather than a comment.
 */

/** Morph band, in normalised Chebyshev position within a ring. */
export const MORPH_START = 0.70;
export const MORPH_END = 0.86;

/**
 * The morph must COMPLETE before the ring overlap band begins, or consecutive rings open
 * cracks — with no error, no warning, and nothing in the console. Derived from the reference's
 * constants; documented nowhere in it.
 */
export function morphEndCeiling(gridN, holeShrink) {
    return 1 - ((4 * holeShrink) / gridN);
}

/**
 * Base spacing that holds a given world reach as the lattice gets coarser or finer, so a
 * quality tier can trade triangles for detail without also moving the horizon.
 */
export function spacingForReach(reach, gridN, levels) {
    return reach / ((gridN / 2) * (2 ** (levels - 1)));
}

/**
 * Build the clipmap.
 *
 * @param {object} opts
 * @param {number} opts.gridN quads per side per ring; must be divisible by 4
 * @param {number} opts.levels number of nested rings
 * @param {number} opts.baseSpacing world units between level-0 vertices
 * @param {number} opts.holeShrink how many cells smaller each ring's hole is than the ring
 *   it surrounds. Larger means more overlap and less chance of a gap, but it lowers the
 *   morph ceiling.
 * @param {number} [opts.verticalPadding] world units of height the bounding volume must
 *   allow for, since the real extent is decided in the vertex shader.
 */
export function buildOdysseyClipmap({
    gridN, levels, baseSpacing, holeShrink, verticalPadding = 1200,
}) {
    if (!Number.isInteger(gridN) || gridN % 4 !== 0) {
        throw new Error(`[odyssey-clipmap] gridN must be a multiple of 4, got ${gridN}`);
    }
    if (!Number.isInteger(levels) || levels < 1) {
        throw new Error(`[odyssey-clipmap] levels must be a positive integer, got ${levels}`);
    }
    const ceiling = morphEndCeiling(gridN, holeShrink);
    if (MORPH_END > ceiling) {
        throw new Error(
            `[odyssey-clipmap] morphEnd ${MORPH_END} exceeds ceiling ${ceiling.toFixed(4)} for `
            + `gridN=${gridN}, holeShrink=${holeShrink} — the rings would crack silently.`,
        );
    }

    const half = gridN / 2;
    const perLevel = (gridN + 1) * (gridN + 1);
    const positions = new Float32Array(levels * perLevel * 3);
    const indices = [];
    const holeHalf = (half / 2) - holeShrink;

    for (let level = 0; level < levels; level += 1) {
        const base = level * perLevel;
        for (let j = 0; j <= gridN; j += 1) {
            for (let i = 0; i <= gridN; i += 1) {
                const v = (base + (j * (gridN + 1)) + i) * 3;
                positions[v] = i - half;
                positions[v + 1] = level;
                positions[v + 2] = j - half;
            }
        }
        for (let j = 0; j < gridN; j += 1) {
            for (let i = 0; i < gridN; i += 1) {
                const gi = i - half;
                const gj = j - half;
                // Skip quads entirely inside the hole this ring surrounds. The hole is cut
                // holeShrink cells SMALLER than the ring inside it, so consecutive rings always
                // overlap and cannot open a gap when their independently-snapped origins drift.
                const inHole = Math.max(Math.abs(gi), Math.abs(gi + 1), Math.abs(gj), Math.abs(gj + 1)) <= holeHalf;
                if (level > 0 && inHole) continue;

                const a = base + (j * (gridN + 1)) + i;
                const b = a + 1;
                const c = a + (gridN + 1);
                const d = c + 1;
                // Alternate the diagonal per quad: a uniform diagonal leaves a faint corduroy
                // of shading seams all running the same way.
                if (((i + j) & 1) === 0) indices.push(a, c, b, b, c, d);
                else indices.push(a, c, d, a, d, b);
            }
        }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));

    const reach = half * baseSpacing * (2 ** (levels - 1));
    // three would otherwise compute bounds from the FAKE (i, level, j) attribute values — a
    // radius of ~113 "grid units" — and use that nonsense for shadow-map culling.
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), (reach * Math.SQRT2) + verticalPadding);
    geometry.boundingBox = new THREE.Box3(
        new THREE.Vector3(-reach, -verticalPadding, -reach),
        new THREE.Vector3(reach, verticalPadding, reach),
    );

    return {
        geometry,
        reach,
        triangles: indices.length / 3,
        vertices: levels * perLevel,
        gridN,
        levels,
        baseSpacing,
        holeShrink,
        morphEndCeiling: ceiling,
    };
}
