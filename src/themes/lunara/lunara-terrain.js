/**
 * Lunara — the ground: the banks of the mirror flats and the two ranges behind them.
 *
 * Everything is cut like crystal: the normal is the triangle's own (screen-space derivatives of
 * the world position), so each facet takes the great moon's light as one flat plane, and a few of
 * them flash as the camera drifts. The banks come from the plan's heightmap (the water reads the
 * same map for its depth); the ranges are strips built from the plan's skylines.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    cameraPosition,
    cross,
    dFdx,
    dFdy,
    dot,
    float,
    max,
    mix,
    normalize,
    positionWorld,
    pow,
    reflect,
    smoothstep,
    vec3,
} from 'three/tsl';
import {
    TERRAIN, luAtmosphere, luClearLight, luLockLight, luMoonDiscs, luPart, luSkyBase, mulberry32,
} from './lunara-tsl.js';

/**
 * The facet shading the banks and both ranges share. `rock` and `frost` are the two albedos;
 * `frostLine` is the height above which facets turn to pale crystal.
 */
function facetColor(u, { frostLine, glints = true }) {
    return Fn(() => {
        const p = positionWorld;
        const toCam = normalize(cameraPosition.sub(p)).toVar();
        const face = normalize(cross(dFdx(p), dFdy(p))).toVar();
        // The mirror's camera flips the winding: keep the facet facing whoever looks at it.
        const N = face.mul(dot(face, toCam).sign()).toVar();

        const n = u.noise(p.xz.mul(0.013)).toVar();
        const frost = smoothstep(frostLine * 0.55, frostLine * 1.25, p.y.add(n.r.sub(0.5).mul(frostLine * 0.8)))
            .mul(smoothstep(0.25, 0.75, N.y));
        const rock = mix(vec3(0.012, 0.009, 0.026), vec3(0.03, 0.018, 0.055), n.g);
        const albedo = mix(rock, vec3(0.2, 0.16, 0.34), frost).toVar();

        // The great moon is the key, its companion a rose kicker, the sky fills from above.
        const key = max(dot(N, u.moonDir), 0.0);
        const kick = max(dot(N, u.companionDir), 0.0);
        const fill = luSkyBase(u, vec3(N.x, max(N.y, 0.0).mul(0.6).add(0.4), N.z));
        const sun = max(dot(N, u.sunDir), 0.0);
        const light = u.moonCol.mul(key.mul(1.25))
            .add(u.companionCol.mul(kick.mul(0.3)))
            .add(vec3(0.62, 0.72, 1.0).mul(sun.mul(0.3)))
            .add(fill.mul(1.6))
            .mul(u.breath);
        const col = albedo.mul(light).toVar();

        // Facets that face the moon's mirror image flash; so do the frosted ones a little.
        const R = reflect(toCam.negate(), N);
        if (glints) {
            const sheen = pow(max(dot(R, u.moonDir), 0.0), 24.0);
            col.addAssign(u.moonCol.mul(sheen).mul(frost.mul(0.5).add(0.06)).mul(u.breath));
        }
        // Grazing facets pick up the sky (wet stone at night).
        const fres = pow(float(1.0).sub(max(dot(N, toCam), 0.0)), 4.0);
        col.addAssign(luSkyBase(u, R).add(luMoonDiscs(u, R).mul(0.12)).mul(fres).mul(0.35));

        // Gameplay light travelling over the ground.
        If(u.ringsLive.greaterThan(0.5), () => {
            col.addAssign(luLockLight(u, p).mul(albedo.mul(2.0).add(0.03)).mul(1.6));
        });
        If(u.clearLive.greaterThan(0.5), () => {
            const clear = luClearLight(u, p);
            col.addAssign(clear.rgb.mul(albedo.mul(2.0).add(0.04)).mul(1.4));
            col.addAssign(u.bed.mul(clear.w).mul(albedo).mul(0.5));
        });
        return luAtmosphere(u, col, p);
    })();
}

/** The banks: one grid over the plan's heightmap. */
export function createBanks(u, plan) {
    const {
        size, halfWidth, zMin, zMax,
    } = TERRAIN;
    const { heights } = plan;
    const positions = new Float32Array(size * size * 3);
    const rand = mulberry32(plan.seed ^ 0x7e22);
    const cellX = (halfWidth * 2) / size;
    const cellZ = (zMax - zMin) / size;
    for (let j = 0; j < size; j++) {
        for (let i = 0; i < size; i++) {
            const o = (j * size + i) * 3;
            // Jitter inside the cell so the facets are not a visible grid.
            const edge = i === 0 || j === 0 || i === size - 1 || j === size - 1;
            const jx = edge ? 0 : (rand() - 0.5) * 0.7;
            const jz = edge ? 0 : (rand() - 0.5) * 0.7;
            positions[o] = -halfWidth + (i + 0.5 + jx) * cellX;
            positions[o + 1] = heights[j * size + i];
            positions[o + 2] = zMin + (j + 0.5 + jz) * cellZ;
        }
    }
    const index = [];
    for (let j = 0; j < size - 1; j++) {
        for (let i = 0; i < size - 1; i++) {
            const a = j * size + i;
            const b = a + 1;
            const c = a + size;
            const d = c + 1;
            // Skip cells that are wholly under the flats: the water covers them.
            if (Math.max(heights[a], heights[b], heights[c], heights[d]) < -0.5) continue;
            if ((i + j) % 2 === 0) index.push(a, c, b, b, c, d);
            else index.push(a, c, d, a, d, b);
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(index);
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'LunaraBanks';
    material.fog = false;
    material.side = THREE.DoubleSide;
    material.colorNode = facetColor(u, { frostLine: 9 });
    const part = luPart('LunaraBanks', geometry, material, -28);
    part.triangles = index.length / 3;
    return part;
}

/**
 * The ranges: each a strip of crystalline facets round the far shore, its crest following the
 * plan's skyline.
 */
export function createRanges(u, plan) {
    const positions = [];
    const index = [];
    const rand = mulberry32(plan.seed ^ 0x51ab);
    const ROWS = 7;
    plan.ridges.forEach((ridge) => {
        const base = positions.length / 3;
        const { columns, skyline } = ridge;
        for (let j = 0; j <= ROWS; j++) {
            // Row 0 is the foot facing the valley, the crest sits two thirds of the way back.
            const v = j / ROWS;
            const profile = v < 0.66 ? (v / 0.66) ** 0.8 : 1 - ((v - 0.66) / 0.34) ** 1.4 * 0.7;
            for (let i = 0; i <= columns; i++) {
                const inner = i > 0 && i < columns && j > 0 && j < ROWS;
                const t = (i + (inner ? (rand() - 0.5) * 0.7 : 0)) / columns;
                const theta = (t - 0.5) * 2 * ridge.arc;
                const r = ridge.radius + (v - 0.66 + (inner ? (rand() - 0.5) * 0.08 : 0)) * ridge.depth;
                const crest = skyline[Math.max(0, Math.min(columns, Math.round(t * columns)))];
                const rough = inner ? 1 + (rand() - 0.5) * 0.36 * (1 - Math.abs(v - 0.66)) : 1;
                positions.push(
                    Math.sin(theta) * r,
                    ridge.floor + (crest - ridge.floor) * profile * rough,
                    -Math.cos(theta) * r,
                );
            }
        }
        const stride = columns + 1;
        for (let j = 0; j < ROWS; j++) {
            for (let i = 0; i < columns; i++) {
                const a = base + j * stride + i;
                const b = a + 1;
                const c = a + stride;
                const d = c + 1;
                if ((i + j) % 2 === 0) index.push(a, b, c, b, d, c);
                else index.push(a, d, c, a, b, d);
            }
        }
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(index);
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'LunaraRanges';
    material.fog = false;
    material.side = THREE.DoubleSide;
    material.colorNode = facetColor(u, { frostLine: 46 });
    const part = luPart('LunaraRanges', geometry, material, -24);
    part.triangles = index.length / 3;
    return part;
}
