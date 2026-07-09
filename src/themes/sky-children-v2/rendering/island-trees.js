/* eslint-disable import/no-unresolved */
/**
 * Sky Children V2 AAA — Island Trees
 *
 * The theme's biggest missing element: stylized trees on the grass islands. Built
 * PROCEDURALLY (not photoscanned GLBs — those clash with the flat painterly look,
 * the same lesson winter learned with its framing spruces): a tapered trunk under
 * two rounded canopy blobs, merged into ONE geometry per scene, anchored to the
 * EXACT terrain via the shared `heightFieldTSL`, alpha-discarded below the cloud,
 * and shaded by the painterly lib reading the shared `u` block.
 *
 * Reuses island-props.js's finishProp (anchor + above-cloud gate + material).
 */
import * as THREE from 'three';
import { ISLAND_REGIONS } from './valley-terrain.js';
import { finishProp } from './island-props.js';

const TRUNK = [0.30, 0.21, 0.14]; // warm bark
const CANOPY_LO = [0.18, 0.38, 0.18]; // shadow canopy green
const CANOPY_HI = [0.36, 0.56, 0.26]; // sunlit canopy green

export function createIslandTrees(u, opts = {}) {
    const total = Math.max(6, Math.floor(opts.count ?? 40));
    const cloudY = opts.cloudY ?? 10;

    // Templates → NON-indexed triangle soup (so we can append verts directly and
    // flat-shade the merge, matching the bushes).
    const trunkGeo = new THREE.CylinderGeometry(0.16, 0.30, 2.4, 6, 1).toNonIndexed();
    trunkGeo.translate(0, 1.2, 0); // base at y=0
    const canopyGeo = new THREE.IcosahedronGeometry(1, 1).toNonIndexed();
    const tp = trunkGeo.attributes.position.array;
    const cp = canopyGeo.attributes.position.array;
    trunkGeo.dispose();
    canopyGeo.dispose();

    const positions = [];
    const anchors = [];
    const colors = [];

    // Two stacked canopy blobs (local Y in trunk-height units, radius factor, green mix).
    const blobs = [
        { y: 2.55, r: 1.30, t: 0.25 },
        { y: 3.45, r: 0.98, t: 0.7 },
    ];

    const sumR2 = ISLAND_REGIONS.reduce((s, isl) => s + isl.r * isl.r, 0);
    for (let r = 0; r < ISLAND_REGIONS.length; r += 1) {
        const isl = ISLAND_REGIONS[r];
        const n = Math.max(1, Math.round(total * ((isl.r * isl.r) / sumR2)));
        for (let i = 0; i < n; i += 1) {
            const a = Math.random() * Math.PI * 2;
            const rr = Math.sqrt(Math.random()) * isl.r * 0.78;
            const x = isl.x + Math.cos(a) * rr;
            const z = isl.z + Math.sin(a) * rr;
            const s = 2.2 + Math.random() * 1.7; // overall tree scale (~taller than bushes)

            // Trunk (slim it on XZ, full height on Y).
            for (let k = 0; k < tp.length; k += 3) {
                positions.push(tp[k] * s * 0.5, tp[k + 1] * s, tp[k + 2] * s * 0.5);
                anchors.push(x, z);
                colors.push(TRUNK[0], TRUNK[1], TRUNK[2]);
            }

            // Canopy blobs.
            for (let b = 0; b < blobs.length; b += 1) {
                const blob = blobs[b];
                const tint = blob.t * (0.7 + Math.random() * 0.5);
                const col = [
                    CANOPY_LO[0] + (CANOPY_HI[0] - CANOPY_LO[0]) * tint,
                    CANOPY_LO[1] + (CANOPY_HI[1] - CANOPY_LO[1]) * tint,
                    CANOPY_LO[2] + (CANOPY_HI[2] - CANOPY_LO[2]) * tint,
                ];
                const cr = s * blob.r * 0.6;
                const cy = s * blob.y;
                for (let k = 0; k < cp.length; k += 3) {
                    positions.push(cp[k] * cr, cp[k + 1] * cr + cy, cp[k + 2] * cr);
                    anchors.push(x, z);
                    colors.push(col[0], col[1], col[2]);
                }
            }
        }
    }

    return finishProp(u, {
        positions, anchors, colors, indices: null, cloudY, renderOrder: 2, doubleSide: false, rimStrength: 0.4,
    });
}
