/**
 * Chapter 2's open water: what stands in the blue around the luminous column.
 *
 * The chapter is one vertical climb — the rail rises straight up ~190 u of water from the deep
 * bowl to the breach — and every other direction was empty: horizontal rays converge on one
 * water colour, so a look sideways, back or down (an orb close-up, the arrival orbit, a glide)
 * showed a flat teal field (Odyssey audit 2026-10-18). Two families now give every direction a
 * shape, both seated on the CPU height mirror the drawn bed displaces to:
 *  - ROCK SPIRES rise from the deep bowl around the column. Their tops stop well under the
 *    surface, and the water's per-channel extinction turns them into stacked silhouettes — the
 *    depth layering a painted film's plates are built from.
 *  - KELP climbs the shelf where the bowl rises toward the island, swaying toward the light.
 * Nothing is placed inside the rail's corridor, so the path, the orbs and their close-ups stay
 * clear. Placement is deterministic (seeded) and pure; the world renderer owns the materials.
 */

import * as THREE from 'three/webgpu';

export const OCEAN_FORMS = Object.freeze({
    /** No form within this horizontal distance (u) of the submerged rail. */
    corridor: 52,
    /** The ring around the column that forms may stand in (u). */
    ringMin: 58,
    ringMax: 250,
    /** Spires need a deep bed; their tops stay at least `spireHeadroom` under the surface. */
    spireMinDepth: 120,
    spireHeadroom: 34,
    spires: 16,
    /** Kelp grows on the shelf: between these depths (u below the surface). */
    kelpMinDepth: 18,
    kelpMaxDepth: 150,
    kelpClusters: 26,
    kelpPerCluster: [7, 13],
    /** The low tier keeps this share of each family. */
    lowShare: 0.5,
});

/** mulberry32: a small seeded generator, so the same world is planted every time. */
function makeRng(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Where the spires and kelp stand.
 * @param {{ heightAt: (x: number, z: number) => number, rail: {x: number, y: number, z: number}[],
 *   seaLevel: number, quality?: string, seed?: number }} options
 *   heightAt: the drawn bed's CPU mirror; rail: the open-water rail points (under the surface,
 *   above the bed)
 * @returns {{ spires: {x: number, y: number, z: number, height: number, radius: number,
 *   yaw: number, leanX: number, leanZ: number}[],
 *   kelp: {x: number, y: number, z: number, height: number, width: number, yaw: number,
 *   phase: number}[] }}
 */
export function planOceanForms({
    heightAt, rail, seaLevel, quality = 'high', seed = 2026,
}) {
    const out = { spires: [], kelp: [] };
    if (!rail?.length || typeof heightAt !== 'function') return out;
    const rnd = makeRng(seed);
    const share = quality === 'low' ? OCEAN_FORMS.lowShare : 1;
    // The column's axis: the mean of the rail's open-water footprint.
    const cx = rail.reduce((s, p) => s + p.x, 0) / rail.length;
    const cz = rail.reduce((s, p) => s + p.z, 0) / rail.length;
    const clearOfRail = (x, z, margin) => rail.every((p) => Math.hypot(p.x - x, p.z - z) > margin);
    const ringPoint = () => {
        const a = rnd() * Math.PI * 2;
        // sqrt: area-uniform across the ring, so the far edge is not starved.
        const r = OCEAN_FORMS.ringMin + ((OCEAN_FORMS.ringMax - OCEAN_FORMS.ringMin) * Math.sqrt(rnd()));
        return { x: cx + (Math.cos(a) * r), z: cz + (Math.sin(a) * r) };
    };

    const spireTarget = Math.round(OCEAN_FORMS.spires * share);
    for (let tries = 0; out.spires.length < spireTarget && tries < spireTarget * 40; tries += 1) {
        const { x, z } = ringPoint();
        const bed = heightAt(x, z);
        const depth = seaLevel - bed;
        if (!Number.isFinite(bed) || depth < OCEAN_FORMS.spireMinDepth) continue;
        const radius = 5 + (rnd() * 11);
        if (!clearOfRail(x, z, OCEAN_FORMS.corridor + radius)) continue;
        if (out.spires.some((s) => Math.hypot(s.x - x, s.z - z) < (s.radius + radius) * 2.2)) continue;
        const height = Math.min(depth - OCEAN_FORMS.spireHeadroom, 45 + (rnd() * 115));
        if (height < 24) continue;
        out.spires.push({
            // Sunk a little into the bed so no base edge shows on a slope.
            x,
            y: bed - 4,
            z,
            height: height + 4,
            radius,
            yaw: rnd() * Math.PI * 2,
            leanX: (rnd() - 0.5) * 0.16,
            leanZ: (rnd() - 0.5) * 0.16,
        });
    }

    const clusterTarget = Math.round(OCEAN_FORMS.kelpClusters * share);
    let clusters = 0;
    for (let tries = 0; clusters < clusterTarget && tries < clusterTarget * 60; tries += 1) {
        const { x, z } = ringPoint();
        const bed = heightAt(x, z);
        const depth = seaLevel - bed;
        if (!Number.isFinite(bed) || depth < OCEAN_FORMS.kelpMinDepth || depth > OCEAN_FORMS.kelpMaxDepth) continue;
        if (!clearOfRail(x, z, OCEAN_FORMS.corridor + 10)) continue;
        clusters += 1;
        const [lo, hi] = OCEAN_FORMS.kelpPerCluster;
        const fronds = lo + Math.floor(rnd() * (hi - lo + 1));
        for (let f = 0; f < fronds; f += 1) {
            const a = rnd() * Math.PI * 2;
            const r = rnd() * 10;
            const fx = x + (Math.cos(a) * r);
            const fz = z + (Math.sin(a) * r);
            const fBed = heightAt(fx, fz);
            const fDepth = seaLevel - fBed;
            if (!Number.isFinite(fBed) || fDepth < OCEAN_FORMS.kelpMinDepth) continue;
            // Tall stands reach most of the way up; their tips stop a few metres under the surface.
            const height = Math.min(fDepth - 5, fDepth * (0.45 + (rnd() * 0.45)));
            if (height < 10) continue;
            out.kelp.push({
                x: fx,
                y: fBed - 1,
                z: fz,
                height,
                width: 2.4 + (rnd() * 1.4),
                yaw: rnd() * Math.PI * 2,
                phase: rnd() * Math.PI * 2,
            });
        }
    }
    return out;
}

/**
 * A unit rock spire: base ring at y 0, rounded crown at y 1, radius ~1 at the base, tapering.
 * Faceted (non-indexed) so it reads as carved rock in the flat-lit painterly language, with a
 * seeded wobble so no two rings are round.
 * @param {number} [seed]
 * @returns {THREE.BufferGeometry}
 */
export function buildSpireGeometry(seed = 7) {
    const rnd = makeRng(seed);
    const RINGS = 9;
    const SIDES = 11;
    const positions = [];
    const ring = [];
    for (let j = 0; j <= RINGS; j += 1) {
        const y = j / RINGS;
        // Taper with a bulge low down and a narrower neck: a sea stack, not a cone.
        const profile = (1 - (0.62 * (y ** 0.85))) * (1 + (0.18 * Math.sin(y * Math.PI * 1.3)));
        const row = [];
        for (let i = 0; i < SIDES; i += 1) {
            const a = (i / SIDES) * Math.PI * 2;
            const wobble = 1 + ((rnd() - 0.5) * 0.34);
            row.push([Math.cos(a) * profile * wobble, y, Math.sin(a) * profile * wobble]);
        }
        ring.push(row);
    }
    const apex = [0, 1.08, 0];
    const tri = (a, b, c) => positions.push(...a, ...b, ...c);
    for (let j = 0; j < RINGS; j += 1) {
        for (let i = 0; i < SIDES; i += 1) {
            const a = ring[j][i];
            const b = ring[j][(i + 1) % SIDES];
            const c = ring[j + 1][i];
            const d = ring[j + 1][(i + 1) % SIDES];
            tri(a, c, b);
            tri(b, c, d);
        }
    }
    for (let i = 0; i < SIDES; i += 1) tri(ring[RINGS][i], apex, ring[RINGS][(i + 1) % SIDES]);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    return geometry;
}

/**
 * A unit kelp frond (2026-11-25; it was one tapering ribbon, and a stand of them read as planks
 * leaning in the water): a thin stalk that leans and wanders as it rises, and blades off it, one
 * each side by turns, each reaching out and up and turned out of the stalk's plane, so the frond
 * has a body from every side and its outline is a fringe, not an edge.
 *
 * Unit space as before: x across (-0.5..0.5, the instance's width), y up (0..1, its height). z is
 * left at the instance's scale of 1, so the lean and the blades' turn are in world units.
 * @returns {THREE.BufferGeometry}
 */
export function buildKelpGeometry() {
    const ROWS = 16;
    const positions = [];
    const tri = (a, b, c) => positions.push(...a, ...b, ...c);
    // The stalk's axis: a slow wander across, a lean (world units) that grows toward the top.
    const axis = (y) => [0.07 * Math.sin(y * Math.PI * 1.15), y, 2.6 * (y ** 1.6)];
    // The stalk: two crossed ribbons, so it is never seen edge-on.
    for (let j = 0; j < ROWS; j += 1) {
        const y0 = j / ROWS;
        const y1 = (j + 1) / ROWS;
        const a = axis(y0);
        const b = axis(y1);
        const w0 = 0.05 * (1 - (0.6 * y0));
        const w1 = 0.05 * (1 - (0.6 * y1));
        const d0 = 0.16 * (1 - (0.6 * y0));
        const d1 = 0.16 * (1 - (0.6 * y1));
        tri([a[0] - w0, y0, a[2]], [b[0] - w1, y1, b[2]], [a[0] + w0, y0, a[2]]);
        tri([a[0] + w0, y0, a[2]], [b[0] - w1, y1, b[2]], [b[0] + w1, y1, b[2]]);
        tri([a[0], y0, a[2] - d0], [b[0], y1, b[2] - d1], [a[0], y0, a[2] + d0]);
        tri([a[0], y0, a[2] + d0], [b[0], y1, b[2] - d1], [b[0], y1, b[2] + d1]);
    }
    // The blades: from low on the stalk to its tip, shorter toward the top, a leaf each (root, two
    // shoulders, tip), its tip lifted and turned out of the plane by its own amount.
    const BLADES = 17;
    for (let k = 0; k < BLADES; k += 1) {
        const y = 0.1 + ((k / (BLADES - 1)) * 0.84);
        const side = k % 2 === 0 ? 1 : -1;
        const root = axis(y);
        const reach = 0.5 * (1 - (0.32 * y)) * (0.86 + (0.14 * Math.sin(k * 2.3)));
        const turn = side * (0.9 + (0.7 * Math.sin((k * 1.7) + 0.4)));
        const lift = 0.035 + (0.02 * Math.cos(k * 1.3));
        const tip = [root[0] + (side * reach), y + lift, root[2] + turn];
        const mid = [root[0] + (side * reach * 0.48), y + (lift * 0.55), root[2] + (turn * 0.45)];
        const half = 0.011 * (1 - (0.4 * y));
        const m0 = [mid[0], mid[1] - half, mid[2] - 0.22];
        const m1 = [mid[0], mid[1] + half, mid[2] + 0.22];
        const r = [root[0], y, root[2]];
        tri(r, m0, m1);
        tri(m0, tip, m1);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    return geometry;
}
