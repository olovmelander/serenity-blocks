/**
 * Wolfhour's spruce: snow-laden conifers standing along the lower ridges. Each belt is one opaque
 * draw parented to its range (it moves with that range), built once on the CPU: every tree is a
 * stack of drooping tiers, each tier a dark triangle with a sliver of moonlit snow along its upper
 * edges (brighter on the moon's side). Trees stand on and just below the crest, so most of them
 * are silhouettes against the mist behind; those lower down fade into the same valley air as the
 * rock (wolfhourAir). A vertex correction keeps each tree's own width when the terrain stretches
 * with the aspect, while its foot stays where it stands.
 */
import * as THREE from 'three/webgpu';
import {
    attribute, mix, positionGeometry, positionLocal, uniform, vec3,
} from 'three/tsl';
import { wolfhourAir } from './wolfhour-landscape.js';

/**
 * The belts: which range, how closely trees stand, their heights and how far below the crest
 * they may stand, how much air is in front of them, and the stretches kept clear (terrain x):
 * the pack and the answering wolf on the spurs, the hut's window, and the scout's path on the
 * foreground ridge.
 */
export const FOREST_BELTS = Object.freeze([
    Object.freeze({
        range: 2,
        spacing: 7,
        height: [15, 30],
        below: [0, 24],
        // In front of the rock's relief just below the crest, behind the hut and the mist bank.
        depth: 60,
        haze: 0.1,
        keepOut: Object.freeze([[520, 800], [-835, -712], [-610, -515]]),
        density: 0.52,
        seed: 11,
        minTier: 1,
    }),
    Object.freeze({
        range: 3,
        spacing: 8,
        height: [24, 52],
        below: [0, 28],
        depth: 50,
        haze: 0,
        keepOut: Object.freeze([[455, 1130]]),
        density: 0.56,
        seed: 29,
        minTier: 0,
        // Tall spruce framing the foreground at both edges of the frame; the scout walks in from
        // behind the right-hand ones.
        giants: Object.freeze([[-836, 112], [-796, 86], [-762, 66], [838, 92], [880, 124], [922, 82]]),
    }),
]);

const TIERS = Object.freeze({
    Minimal: -1, Low: 0, Medium: 1, High: 1, Ultra: 1, Extreme: 1,
});
/** Only this much of each ridge is ever on screen (terrain x, any aspect, with parallax). */
const REACH = 1060;

const NEEDLES = Object.freeze([0.0055, 0.0075, 0.012]);
const SNOW_LIT = Object.freeze([0.07, 0.09, 0.135]);
const SNOW_SHADE = Object.freeze([0.02, 0.028, 0.048]);

function random(seed) {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

/** Smooth 1D value noise for clumping (0..1). */
function clump(x, seed) {
    const hash = (i) => {
        let h = Math.imul(i, 374761393) + Math.imul(seed, 668265263);
        h = Math.imul(h ^ (h >>> 13), 1274126177);
        return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
    };
    const i = Math.floor(x);
    const f = x - i;
    const u = f * f * (3 - 2 * f);
    return hash(i) + (hash(i + 1) - hash(i)) * u;
}

/**
 * One spruce as triangles appended to `out`: positions (foot at base), tints, its air, and each
 * vertex's x offset from the trunk (for the aspect correction).
 */
function addSpruce(out, base, height, fog, rand) {
    const tiers = 7 + Math.floor(rand() * 4);
    const width = height * (0.5 + rand() * 0.14);
    const lean = (rand() - 0.5) * 0.06;
    const vertex = (x, y, tint) => {
        out.positions.push(base[0] + x + lean * y, base[1] + y, base[2]);
        out.tints.push(...tint);
        out.fog.push(fog);
        out.offsets.push(x + lean * y);
    };
    const tri = (a, b, c) => {
        vertex(...a);
        vertex(...b);
        vertex(...c);
    };
    // A short trunk below the lowest tier.
    const trunk = height * 0.05;
    tri([-trunk, 0, NEEDLES], [trunk, 0, NEEDLES], [trunk, height * 0.14, NEEDLES]);
    tri([-trunk, 0, NEEDLES], [trunk, height * 0.14, NEEDLES], [-trunk, height * 0.14, NEEDLES]);
    for (let i = 0; i < tiers; i++) {
        const t0 = i / tiers;
        const t1 = (i + 1) / tiers;
        const top = height * (1 - t0 * 0.9) + (i === 0 ? height * 0.06 : 0);
        const tierHeight = (height * 0.9) / tiers;
        const bottom = height * (1 - t1 * 0.9) - tierHeight * (0.35 + rand() * 0.25);
        const half = width * 0.5 * (0.14 + 0.86 * t1 ** 0.85) * (0.85 + rand() * 0.3);
        const droopL = tierHeight * (0.15 + rand() * 0.35);
        const droopR = tierHeight * (0.15 + rand() * 0.35);
        const apex = [0, top];
        const left = [-half * (0.9 + rand() * 0.2), bottom - droopL];
        const right = [half * (0.9 + rand() * 0.2), bottom - droopR];
        tri([...apex, NEEDLES], [...left, NEEDLES], [...right, NEEDLES]);
        // Snow lying along the tier's upper edges: a thin sliver.
        const sink = tierHeight * 0.17;
        const leftIn = [left[0] * 0.72, left[1] + sink * 0.55];
        const rightIn = [right[0] * 0.72, right[1] + sink * 0.55];
        const apexIn = [0, top - sink];
        const lit = SNOW_LIT;
        const mid = SNOW_LIT.map((v, k) => (v + SNOW_SHADE[k]) * 0.5);
        tri([...apex, lit], [...left, lit], [...leftIn, lit]);
        tri([...apex, lit], [...leftIn, lit], [...apexIn, mid]);
        tri([...apex, mid], [...apexIn, mid], [...rightIn, SNOW_SHADE]);
        tri([...apex, mid], [...rightIn, SNOW_SHADE], [...right, SNOW_SHADE]);
    }
}

/**
 * Build one belt's trees from its range's crest: `crestAt(x)` gives { y, z } of the crest at
 * terrain x. Returns the arrays (pure: no three objects).
 */
export function plantBelt(belt, crestAt) {
    const rand = random(belt.seed * 7919 + 17);
    const out = {
        positions: [], tints: [], fog: [], offsets: [], trees: 0,
    };
    for (let x = -REACH; x <= REACH; x += belt.spacing * (0.6 + rand() * 0.8)) {
        const kept = belt.keepOut.some(([a, b]) => x > a && x < b);
        const cluster = clump(x * 0.012, belt.seed);
        const roll = rand();
        if (kept || roll > belt.density * (0.35 + cluster * 1.3)) continue;
        const crest = crestAt(x);
        const below = belt.below[0] + (belt.below[1] - belt.below[0]) * rand() ** 2;
        const height = (belt.height[0] + (belt.height[1] - belt.height[0]) * rand() ** 1.4)
            * (0.78 + cluster * 0.4) * (1 - (below / belt.below[1]) * 0.25);
        const y = crest.y - below;
        // Trees lower on the slope stand deeper in the valley air.
        const fog = Math.min(0.9, belt.haze + (below / Math.max(1, belt.below[1])) * 0.22
            + Math.max(0, Math.min(1, (-160 - y) / 310)) * 0.18);
        addSpruce(out, [x, y, crest.z + belt.depth + rand() * 6], height, fog, rand);
        out.trees += 1;
    }
    for (const [x, height] of belt.giants ?? []) {
        const crest = crestAt(x);
        // In front of the scout's path (its depth is 12), so it can step out from behind them.
        addSpruce(out, [x, crest.y - 6, crest.z + belt.depth + 20], height, 0, rand);
        out.trees += 1;
    }
    return out;
}

/** Creates the spruce belts for a tier. Stand them with `stand(landscape)`; refit on resize. */
export function createWolfhourForest({ quality = 'High' } = {}) {
    const tier = TIERS[quality] ?? 1;
    const uInvStretch = uniform(1);
    const material = new THREE.MeshBasicNodeMaterial({
        name: 'Wolfhour spruce', side: THREE.DoubleSide,
    });
    const offset = attribute('aOffsetX', 'float');
    material.positionNode = positionLocal.add(vec3(offset.mul(uInvStretch.sub(1)), 0, 0));
    material.colorNode = mix(
        attribute('aTint', 'vec3'),
        wolfhourAir(positionGeometry.x, positionGeometry.y),
        attribute('aFog', 'float'),
    );
    const meshes = [];
    let trees = 0;
    return {
        meshes,
        get trees() { return trees; },
        /** Plant each belt on its range of `landscape` (once). */
        stand(landscape) {
            for (const belt of FOREST_BELTS) {
                if (belt.minTier > tier) continue;
                const planted = plantBelt(belt, (x) => landscape.crestPoint(belt.range, x));
                const geometry = new THREE.BufferGeometry();
                geometry.setAttribute('position', new THREE.Float32BufferAttribute(planted.positions, 3));
                geometry.setAttribute('aTint', new THREE.Float32BufferAttribute(planted.tints, 3));
                geometry.setAttribute('aFog', new THREE.Float32BufferAttribute(planted.fog, 1));
                geometry.setAttribute('aOffsetX', new THREE.Float32BufferAttribute(planted.offsets, 1));
                geometry.computeBoundingSphere();
                const mesh = new THREE.Mesh(geometry, material);
                mesh.name = `Wolfhour spruce (range ${belt.range})`;
                mesh.frustumCulled = false;
                landscape.group.children[belt.range].add(mesh);
                meshes.push(mesh);
                trees += planted.trees;
            }
        },
        /** Keep each tree's own width while the terrain stretches by `stretch`. */
        fit(stretch) {
            uInvStretch.value = Number.isFinite(stretch) && stretch > 0 ? 1 / stretch : 1;
        },
        dispose() {
            for (const mesh of meshes) {
                mesh.removeFromParent();
                mesh.geometry.dispose();
            }
            material.dispose();
            meshes.length = 0;
        },
    };
}
