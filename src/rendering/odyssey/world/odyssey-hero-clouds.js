/**
 * ⚠️ RETIRED 2026-08-14 — retained per the ADR-0015 pattern, opt-in via ?odysseyWorldHeroes=1.
 *
 * ACT II HERO CUMULUS — the geometry (cloud plan §7.1 slice 1).
 *
 * WHY GEOMETRY AND NOT A BILLBOARD. Three approaches were designed and judged against the
 * installed r181 sources. Billboards lose on three independent counts: r181's `billboarding()`
 * is MESH-level (it rebuilds clip space from `modelWorldMatrix`, `SpriteUtils.js:35/61`), so
 * under `InstancedMesh` — where `InstanceNode` has already reassigned `positionLocal`
 * (`InstanceNode.js:166`, run first by `NodeMaterial.js:799-808`) — the whole troupe rides the
 * camera instead of each cloud turning on its own anchor; a transparent card cannot interpenetrate
 * the mountains or sort correctly against the deck, because `renderOrder` strictly dominates depth
 * (`RenderList.js:12-31`); and a flat card has no vertical mass, which is the entire point of a
 * hero. This repo has the last failure written down in the owner's own words — a billboard whose
 * "plane boundary itself became the silhouette: a dead-straight vertical cut"
 * (`surface-world.tsl.js:2746-2752`).
 *
 * Real opaque lobes delete all three problems rather than managing them: no billboard basis, no
 * sorting scheme (hardware depth resolves every case per fragment), and a silhouette that is a
 * polygon edge, so it antialiases exactly like every mountain ridge already in frame.
 *
 * COST NOTE, measured this session: the deck's price is independent of how much cloud is on
 * screen, because sub-threshold fragments still run every tap. Opaque geometry inverts that — it
 * rasterises ONLY its own silhouette (a quad would rasterise its bounding rect, ~2x waste on a
 * lobed shape), `FrontSide` culling halves that again, the shader does ZERO texture fetches, and
 * the frame pays no blend read-modify-write at all (`WebGPUPipelineUtils.js:121-125` emits no
 * blend state for an opaque NormalBlending material).
 *
 * ⚠️ Heroes are NOT free by way of occluding the deck. That was the tempting argument and it is
 * false: from a camera BELOW an overhead sheet, every point above the sheet is behind it along
 * the ray, so an opaque hero above y=660 never occludes a deck fragment. Budget them as purely
 * additive.
 */
import * as THREE from 'three';
import { HERO_CLOUD_RULES } from './odyssey-hero-cloud-specs.js';

/** Deterministic per-hero RNG: the same sky every boot, and reproducible captures. */
function makeRng(seed) {
    let s = Math.floor((seed * 2654435761) % 2147483647) || 1;
    return () => {
        s = Math.imul(s ^ (s >>> 15), 2246822519);
        s = (s + 0x6d2b79f5) >>> 0;
        return ((s ^ (s >>> 13)) >>> 0) / 4294967296;
    };
}

/**
 * One lobe: a squashed icosphere placed in world space.
 *
 * `detail >= 1` is load-bearing — `PolyhedronGeometry` keeps SMOOTH RADIAL normals there, and
 * those are what make the terminator scallop around each lobe. `detail 0` is faceted, and
 * `computeVertexNormals()` on the merged result would flatten every lobe in exactly the same way
 * (the `moonlit-forest-master.effect.js:133` precedent does that and must not be copied here).
 * `applyMatrix4` transports normals through the normal matrix, so a non-uniform squash keeps
 * correct normals for free.
 */
function lobeGeometry(cx, cy, cz, radius, ySquash, detail) {
    const g = new THREE.IcosahedronGeometry(radius, detail);
    // Scale components stay POSITIVE: a negative one flips winding, and with FrontSide culling
    // the lobe would silently vanish.
    g.applyMatrix4(new THREE.Matrix4().makeScale(1, ySquash, 1));
    g.applyMatrix4(new THREE.Matrix4().makeTranslation(cx, cy, cz));
    return g;
}

/**
 * Build the merged, world-space hero cloud geometry.
 *
 * @param {ReadonlyArray<{id:string,x:number,base:number,z:number,w:number,h:number,yaw:number,seed:number}>} specs
 * @param {{ tertiaries?: boolean }} [opts] slice control — slice 1 ships without crown scallops
 * @returns {{ geometry: THREE.BufferGeometry, triangles: number, lobes: number }}
 */
export function buildHeroCloudGeometry(specs, opts = {}) {
    const withTertiaries = opts.tertiaries === true;
    const parts = [];
    let lobes = 0;

    specs.forEach((spec) => {
        const rnd = makeRng(spec.seed);
        const halfW = spec.w / 2;
        const cosY = Math.cos(spec.yaw);
        const sinY = Math.sin(spec.yaw);
        // Place in the hero's own frame, then yaw into world — so `yaw` re-orients a hero's
        // lobe arrangement without re-authoring its numbers.
        const place = (lx, ly, lz, r, sq, detail) => {
            const wx = spec.x + ((lx * cosY) - (lz * sinY));
            const wz = spec.z + ((lx * sinY) + (lz * cosY));
            parts.push(lobeGeometry(wx, ly, wz, r, sq, detail));
            lobes += 1;
        };

        // PRIMARIES — 2-3 lobes that carry the thumbnail read. All share one centre height, and
        // with a common y-scale their lower tangent plane is common too: THAT is what reads as
        // the flat condensation base. The vertices are never clamped to a plane — clamping
        // collapses the bottom cap to zero-area triangles and, under FrontSide, opens a hole.
        const nPrim = 2 + Math.floor(rnd() * 2);
        const primR = [];
        const primPos = [];
        const primSquash = 0.62 + (rnd() * 0.10);
        const primY = spec.base + (spec.h * 0.42);
        for (let i = 0; i < nPrim; i += 1) {
            const r = halfW * (0.30 + (rnd() * 0.12));
            const lx = (rnd() - 0.5) * spec.w * 0.40;
            const lz = (rnd() - 0.5) * spec.w * 0.22;
            primR.push(r);
            primPos.push([lx, lz]);
            place(lx, primY, lz, r, primSquash, 2);
        }

        // SECONDARIES — seated ON the primaries' rims, upper half only, so they read as lobes
        // riding the mass rather than a second cloud beside it. Sizes deliberately irregular:
        // evenly-sized lobes read as soap bubbles.
        const nSec = 4 + Math.floor(rnd() * 3);
        for (let i = 0; i < nSec; i += 1) {
            const host = i % nPrim;
            const [hx, hz] = primPos[host];
            const a = rnd() * Math.PI * 2;
            const seat = primR[host] * (0.55 + (rnd() * 0.35));
            const r = halfW * (0.14 + (rnd() * 0.08));
            place(
                hx + (Math.cos(a) * seat),
                primY + (spec.h * (0.10 + (rnd() * 0.22))),
                hz + (Math.sin(a) * seat * 0.7),
                r,
                0.75 + (rnd() * 0.15),
                1,
            );
        }

        // TERTIARIES — crown scallops ONLY, i.e. above base + 0.5h (slice 2).
        if (withTertiaries) {
            const nTer = 6 + Math.floor(rnd() * 4);
            for (let i = 0; i < nTer; i += 1) {
                const host = i % nPrim;
                const [hx, hz] = primPos[host];
                const a = rnd() * Math.PI * 2;
                const seat = primR[host] * (0.4 + (rnd() * 0.5));
                place(
                    hx + (Math.cos(a) * seat),
                    Math.max(spec.base + (spec.h * 0.52), primY + (spec.h * (0.28 + (rnd() * 0.2)))),
                    hz + (Math.sin(a) * seat * 0.7),
                    halfW * (0.06 + (rnd() * 0.05)),
                    0.85,
                    1,
                );
            }
        }
    });

    // Hand-merge: IcosahedronGeometry is already non-indexed, so position/normal concatenate
    // directly. Keeps this module's dependency surface to `three` alone.
    let vertCount = 0;
    parts.forEach((g) => { vertCount += g.attributes.position.count; });
    const position = new Float32Array(vertCount * 3);
    const normal = new Float32Array(vertCount * 3);
    let off = 0;
    parts.forEach((g) => {
        position.set(g.attributes.position.array, off);
        normal.set(g.attributes.normal.array, off);
        off += g.attributes.position.count * 3;
        g.dispose();
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
    geometry.computeBoundingSphere();
    return { geometry, triangles: vertCount / 3, lobes };
}

/**
 * Validate placements against the rules. Exported so the test re-derives them rather than
 * trusting a comment, and so a bad edit to the spec table fails the suite.
 *
 * @param {ReadonlyArray<object>} specs
 * @param {ReadonlyArray<{x:number,y:number,z:number}>} railSamples
 * @returns {Array<{id:string, problem:string}>} empty when every spec is legal
 */
export function validateHeroCloudPlacements(specs, railSamples) {
    const problems = [];
    specs.forEach((spec) => {
        if (spec.base < HERO_CLOUD_RULES.MIN_LOBE_Y) {
            problems.push({ id: spec.id, problem: `base ${spec.base} below MIN_LOBE_Y` });
        }
        let min = Infinity;
        railSamples.forEach((pt) => {
            const d = Math.hypot(spec.x - pt.x, spec.z - pt.z);
            if (d < min) min = d;
        });
        if (min < HERO_CLOUD_RULES.MIN_RAIL_DIST) {
            problems.push({ id: spec.id, problem: `rail distance ${min.toFixed(0)} < MIN_RAIL_DIST` });
        }
        if (min > HERO_CLOUD_RULES.MAX_RAIL_DIST) {
            problems.push({ id: spec.id, problem: `rail distance ${min.toFixed(0)} > MAX_RAIL_DIST` });
        }
    });
    return problems;
}
