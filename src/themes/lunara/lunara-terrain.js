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
    sin,
    smoothstep,
    vec2,
    vec3,
    pow4,
} from 'three/tsl';
import {
    TERRAIN, luAtmosphere, luClearLight, luLockLight, luMoonDiscs, luPart, luSeams, luSkyBase, mulberry32,
} from './lunara-tsl.js';

/**
 * The facet shading the banks and both ranges share. `rock` and `frost` are the two albedos;
 * `frostLine` is the height above which facets turn to pale crystal.
 */
function facetColor(u, { frostLine, glints = true, veins = 0 }) {
    return Fn(() => {
        const p = positionWorld;
        const toCam = normalize(cameraPosition.sub(p)).toVar();
        const face = normalize(cross(dFdx(p), dFdy(p))).toVar();
        // The mirror's camera flips the winding: keep the facet facing whoever looks at it.
        const N = face.mul(dot(face, toCam).sign()).toVar();

        const n = u.noise(p.xz.mul(0.013)).toVar();
        const frost = smoothstep(frostLine * 0.55, frostLine * 1.25, p.y.add(n.r.sub(0.5).mul(frostLine * 0.8)))
            .mul(smoothstep(0.25, 0.75, N.y));
        // The same folded strata cross neighbouring triangles. They give a ridge a geological
        // direction all the way from the scree to the moonlit ice on its upper faces.
        const strata = sin(p.y.mul(0.54).add(p.x.mul(0.13)).add(p.z.mul(0.19)).add(n.g.mul(9))).mul(0.5).add(0.5);
        const rock = mix(vec3(0.013, 0.018, 0.048), vec3(0.074, 0.045, 0.098), n.g.mul(0.62).add(strata.mul(0.38)));
        const snow = mix(vec3(0.17, 0.21, 0.36), vec3(0.47, 0.50, 0.64), n.b.mul(0.63).add(strata.mul(0.37)));
        const albedo = mix(rock, snow, frost).toVar();

        // The great moon is the key, its companion a rose kicker, the sky fills from above.
        const key = max(dot(N, u.moonDir), 0.0);
        const kick = max(dot(N, u.companionDir), 0.0);
        const fill = luSkyBase(u, vec3(N.x, max(N.y, 0.0).mul(0.6).add(0.4), N.z));
        const sun = max(dot(N, u.sunDir), 0.0);
        // The moon is a hard key against a dim fill: each facet reads as a plane turned to it.
        const light = u.moonCol.mul(key.mul(1.9))
            .add(u.companionCol.mul(kick.mul(0.3)))
            .add(vec3(0.62, 0.72, 1.0).mul(sun.mul(0.3)))
            .add(fill.mul(1.2))
            .mul(u.breath);
        const col = albedo.mul(light).toVar();

        // Facets that face the moon's mirror image flash; so do the frosted ones a little.
        const R = reflect(toCam.negate(), N);
        if (glints) {
            const sheen = pow(max(dot(R, u.moonDir), 0.0), 24.0);
            col.addAssign(u.moonCol.mul(sheen).mul(frost.mul(0.5).add(0.06)).mul(u.breath));
        }
        // Grazing facets pick up the sky (wet stone at night).
        const fres = pow4(float(1.0).sub(max(dot(N, toCam), 0.0)));
        col.addAssign(luSkyBase(u, R).add(luMoonDiscs(u, R).mul(0.12)).mul(fres).mul(0.12));

        // Crystal veins in the bare rock: thin seams of the palette's light, as in a split geode.
        // They wake with the valley's charge and burn bright as a clear's wave runs past.
        if (veins) {
            const rockUV = p.xz.add(vec2(p.y.mul(0.9), p.y.mul(-0.4))).mul(veins);
            const vn = u.noise(rockUV).toVar();
            const seams = luSeams(vn, n).toVar();
            const pulse = sin(u.auroraDrift.mul(1.6).sub(p.y.mul(0.074)).add(vn.b.mul(7))).mul(0.5).add(0.5);
            const ore = mix(u.crystal, u.bed, smoothstep(0.33, 0.67, vn.a));
            const bare = float(1).sub(frost.mul(0.82));
            col.addAssign(ore.mul(seams.x.mul(0.78).add(seams.y.mul(0.11))).mul(pulse.mul(pulse).mul(0.75).add(0.25))
                .mul(bare).mul(u.power.mul(0.58).add(0.31))
                .mul(u.breath));
        }

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
    // Fallen plates surround the near mineral beds. They share the banks' material, depth
    // and reflection, and give the emergence of a tall gem a scale at the waterline.
    const talus = [];
    for (const crystal of plan.crystals) {
        if (!crystal.main || crystal.cluster < 0 || crystal.z < -65) continue;
        const count = crystal.hero ? 11 : 5;
        for (let k = 0; k < count; k++) {
            const bearing = rand() * Math.PI * 2;
            const scatter = crystal.radius * (0.66 + rand() * 3.0);
            const x = crystal.x + Math.cos(bearing) * scatter;
            const z = crystal.z + Math.sin(bearing) * scatter;
            const ground = plan.heightAt(x, z);
            const radius = crystal.radius * (0.28 + rand() * 0.75);
            const rise = radius * (0.32 + rand() * 0.48);
            const base = (positions.length + talus.length) / 3;
            for (let side = 0; side < 5; side++) {
                const angle = bearing + (side + rand() * 0.23) * ((2 * Math.PI) / 5);
                const dx = Math.cos(angle) * radius;
                const dz = Math.sin(angle) * radius * 0.77;
                talus.push(
                    x + dx,
                    ground - rise * 0.38,
                    z + dz,
                    x + dx * 0.64 + radius * 0.17,
                    ground + rise * (0.62 + rand() * 0.4),
                    z + dz * 0.66,
                );
            }
            for (let side = 0; side < 5; side++) {
                const a = base + side * 2;
                const b = base + ((side + 1) % 5) * 2;
                index.push(a, a + 1, b, b, a + 1, b + 1);
                if (side > 0 && side < 4) index.push(base + 1, b + 1, a + 1);
            }
        }
    }
    const bankPositions = new Float32Array(positions.length + talus.length);
    bankPositions.set(positions);
    bankPositions.set(talus, positions.length);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(bankPositions, 3));
    geometry.setIndex(index);
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'LunaraBanks';
    material.fog = false;
    material.side = THREE.DoubleSide;
    material.colorNode = facetColor(u, { frostLine: 9, veins: 0.045 });
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
    material.colorNode = facetColor(u, { frostLine: 46, veins: 0.011 });
    const part = luPart('LunaraRanges', geometry, material, -24);
    part.triangles = index.length / 3;
    return part;
}
