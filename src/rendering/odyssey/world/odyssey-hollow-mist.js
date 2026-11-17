/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * MIST IN THE HOLLOW — the weather you can see from the mountains' rail (masterpiece pass, round
 * two, 2026-11-17).
 *
 * The first round let the world's ground mist (GROUND_MIST in the world renderer) gather with the
 * hour, and the lead's review was fair: in a still it could not be seen. That mist is a haze laid
 * into every surface's colour, clear for 150 u round the eye, so the hollow the mountains' rail
 * crosses, the upper meadow's basin between the tarn and the massif's foot, held none of it. A
 * first try at bringing it nearer painted pale patches on the grass (a veil on the ground reads
 * as paint: the 2026-10 lesson, learnt again).
 *
 * So the hollow's mist is a THING: one soft sheet lying at the pool's own level in the basin, a
 * few units over the grass, where the valley-mist plate (odyssey-valley-mist.js) says the land is
 * a hollow. It is thick where the pool is deep and gone where the ground rises out of it, so it
 * has no edge against the land; the trees standing in it rise through it, trunks veiled and
 * crowns clear; and seen aslant it is thicker than seen from above, as mist is. It takes the low
 * sun's colour, and glows where the eye looks toward the sun through it.
 *
 * ALIVE. Banks drift across it downwind, so a part of the hollow clears and fills again in about
 * a minute, and the whole pool gathers and thins with the weather's clock (odyssey-weather-clock.js).
 * It is there only late in the day: none on the island's morning, gathering through the
 * mountains' afternoon (the colour script's `hour`).
 *
 * COST: one blended draw of ~10k triangles over the basin, two reads of the world's noise a pixel.
 * High tier only; hidden (no draw) while there is none.
 */
import * as THREE from 'three/webgpu';
import {
    abs, attribute, clamp, dot, exp, float, length, max, mix, normalize, smoothstep, texture, uniform, vec2,
    vec3,
} from 'three/tsl';
import { sampleValleyMist } from './odyssey-valley-mist.js';

export const ODYSSEY_HOLLOW_MIST = Object.freeze({
    /** The basin: the sheet's box (world x and z) and its cell (world units). */
    x: Object.freeze([-740, 340]),
    z: Object.freeze([-740, -270]),
    cell: 10,
    /** The sheet lies this share of the pool's depth over the ground (the plate's pools are 5-15 u
     * deep here), and never nearer the grass than `clear` (world units). */
    lift: 0.60,
    clear: 0.6,
    /** Optical depth per unit of pool depth, seen straight down; and the shallowest slant counted
     * (|dir.y|), so a grazing look cannot make it a wall. */
    density: 0.020,
    graze: 0.16,
    /** The most it veils. */
    alpha: 0.44,
    /** No mist where the pool is shallower than `depth[0]`; all of it from `depth[1]` (u). */
    depth: Object.freeze([2.5, 9]),
    /** It fades toward the sheet's own edge over this many units (the box is not a shape). */
    edge: 70,
    /**
     * CLEAR ROUND THE EYE: none nearer than `near[0]`, all of it from `near[1]` (world units).
     * Looked down on from close above, a thin mist is not seen; it shows where the eye looks along
     * it. Drawn under the rail it was a pale blanket over the meadow the chapter is about (the
     * first cut), so it lies in the middle distance, at the massif's foot, and the grass at the
     * eye's feet keeps its colour.
     */
    near: Object.freeze([130, 330]),
    /**
     * THE BANKS: two reads of the world's noise, their scales (world units a tile), the wind they
     * drift on (u/s), and the window the sum is cut at: [open, whole] at the weather's thinnest,
     * shifted down by `gather` at its thickest.
     */
    bank: Object.freeze({
        scale: Object.freeze([300, 108]),
        drift: Object.freeze([Object.freeze([4.6, -2.7]), Object.freeze([-2.2, -3.8])]),
        weight: Object.freeze([0.64, 0.36]),
        window: Object.freeze([0.52, 0.92]),
        gather: 0.14,
    }),
    /** Its colour: the sunlit white and its gain, the share of the sky's own air in it, and the
     * glow toward the sun (gain, and how tight). */
    white: Object.freeze([0.98, 0.975, 0.96]),
    bright: 1.42,
    /** How much of its white is the sun's colour (the rest stays white: mist is paler than sand). */
    sun: 0.72,
    air: 0.22,
    glow: 0.42,
    /** The hour (the colour script's) it begins to gather at, and is whole by. */
    hour: Object.freeze([0.12, 0.40]),
});

/**
 * How much of the hollow's mist there is (0..1), from the hour and the weather's pool signal
 * (pure; the pool multiplier runs ~0.35..1.7, 1 is the mean).
 * @returns {{amount:number, gather:number}} `gather` 0..1: how thick the banks stand
 */
export function hollowMistAt(hour, pool = 1, cfg = ODYSSEY_HOLLOW_MIST) {
    const h = Number.isFinite(hour) ? hour : 0;
    const u = Math.min(Math.max((h - cfg.hour[0]) / (cfg.hour[1] - cfg.hour[0]), 0), 1);
    const w = Math.min(Math.max(((Number.isFinite(pool) ? pool : 1) - 0.35) / 1.35, 0), 1);
    return { amount: u * u * (3 - (2 * u)), gather: w };
}

/**
 * The sheet's geometry: a grid over the basin, each vertex at its pool's own level over the
 * ground, carrying the pool's depth. Pure but for the BufferGeometry it returns.
 * @param {(x:number, z:number) => number} heightAt the island's height
 * @param {{data: Float32Array, res: number, extent: number}} plate the valley-mist plate
 */
export function buildHollowMistGeometry(heightAt, plate, cfg = ODYSSEY_HOLLOW_MIST) {
    const nx = Math.round((cfg.x[1] - cfg.x[0]) / cfg.cell);
    const nz = Math.round((cfg.z[1] - cfg.z[0]) / cfg.cell);
    const position = new Float32Array((nx + 1) * (nz + 1) * 3);
    const pool = new Float32Array((nx + 1) * (nz + 1));
    let deepest = 0;
    for (let j = 0; j <= nz; j += 1) {
        const z = cfg.z[0] + ((j / nz) * (cfg.z[1] - cfg.z[0]));
        for (let i = 0; i <= nx; i += 1) {
            const x = cfg.x[0] + ((i / nx) * (cfg.x[1] - cfg.x[0]));
            const at = (j * (nx + 1)) + i;
            const { depth } = sampleValleyMist(plate, x, z);
            position[at * 3] = x;
            position[(at * 3) + 1] = heightAt(x, z) + Math.max(depth * cfg.lift, cfg.clear);
            position[(at * 3) + 2] = z;
            pool[at] = depth;
            deepest = Math.max(deepest, depth);
        }
    }
    const index = new Uint32Array(nx * nz * 6);
    let k = 0;
    for (let j = 0; j < nz; j += 1) {
        for (let i = 0; i < nx; i += 1) {
            const a = (j * (nx + 1)) + i;
            const b = a + 1;
            const c = a + nx + 1;
            const d = c + 1;
            // Wound to face up.
            index[k] = a; index[k + 1] = c; index[k + 2] = b;
            index[k + 3] = b; index[k + 4] = c; index[k + 5] = d;
            k += 6;
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geometry.setAttribute('aPool', new THREE.BufferAttribute(pool, 1));
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    geometry.computeBoundingSphere();
    return { geometry, deepest, triangles: nx * nz * 2 };
}

/**
 * @param {object} p
 * @param {(x:number, z:number) => number} p.heightAt
 * @param {object} p.plate          the valley-mist plate (bakeValleyMist)
 * @param {object} p.positionWorld  vec3 node: the fragment's place, in the world's own frame
 * @param {object} p.cameraPosition vec3 node: the eye, in the same frame
 * @param {object} p.time           float node: the world's clock
 * @param {object} p.noise          the world's tiling noise texture (value noise in `.b`)
 * @param {object} p.sunColour      vec3 node
 * @param {object} p.sunDir         vec3 node (toward the sun)
 * @param {(dir: object) => object} p.skyAirAt  the world's air for a direction
 * @param {(colour: object, at: object) => object} p.toOutput  the world's haze and output stage
 */
export function createOdysseyHollowMist({
    heightAt, plate, positionWorld, cameraPosition, time, noise, sunColour, sunDir, skyAirAt, toOutput,
}, cfg = ODYSSEY_HOLLOW_MIST) {
    const built = buildHollowMistGeometry(heightAt, plate, cfg);
    /** (amount 0..1, gather 0..1). */
    const uMist = uniform(new THREE.Vector2(0, 0.5));

    const B = cfg.bank;
    const { xz } = positionWorld;
    const bankA = texture(noise, xz.sub(vec2(...B.drift[0]).mul(time)).div(B.scale[0])).b;
    const bankB = texture(noise, xz.sub(vec2(...B.drift[1]).mul(time)).div(B.scale[1]).add(vec2(0.31, 0.67))).b;
    const lower = uMist.y.mul(B.gather);
    const banks = smoothstep(
        float(B.window[0]).sub(lower),
        float(B.window[1]).sub(lower),
        bankA.mul(B.weight[0]).add(bankB.mul(B.weight[1])),
    );
    const poolDepth = attribute('aPool', 'float');
    const held = smoothstep(float(cfg.depth[0]), float(cfg.depth[1]), poolDepth);
    const toFrag = positionWorld.sub(cameraPosition);
    const dir = normalize(toFrag);
    const slant = max(abs(dir.y), float(cfg.graze));
    const tau = poolDepth.mul(cfg.density).mul(held).mul(banks).div(slant);
    const edge = smoothstep(float(0), float(cfg.edge), xz.x.sub(cfg.x[0]))
        .mul(smoothstep(float(0), float(cfg.edge), float(cfg.x[1]).sub(xz.x)))
        .mul(smoothstep(float(0), float(cfg.edge), xz.y.sub(cfg.z[0])))
        .mul(smoothstep(float(0), float(cfg.edge), float(cfg.z[1]).sub(xz.y)));
    const far = smoothstep(float(cfg.near[0]), float(cfg.near[1]), length(toFrag));
    const alpha = clamp(
        float(1).sub(exp(tau.negate())).mul(edge).mul(far)
            .mul(uMist.x)
            .mul(cfg.alpha),
        0,
        1,
    );
    // Sunlit white in the sun's colour, a little of the air it lies in, and the glow of looking
    // toward the sun through it (clamped: a dot of two unit vectors can round past 1).
    const toSun = clamp(dot(dir, sunDir), 0, 1);
    const glow = toSun.mul(toSun).mul(toSun).mul(cfg.glow);
    const colour = mix(
        vec3(...cfg.white).mul(mix(vec3(1, 1, 1), sunColour, float(cfg.sun))).mul(cfg.bright),
        skyAirAt(vec3(dir.x, max(dir.y, float(0.05)), dir.z)),
        float(cfg.air),
    ).add(sunColour.mul(glow));

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = toOutput(colour, positionWorld);
    material.opacityNode = alpha;
    material.transparent = true;
    material.depthWrite = false;
    material.fog = false;
    material.side = THREE.FrontSide;

    const mesh = new THREE.Mesh(built.geometry, material);
    mesh.name = 'odyssey-world-hollow-mist';
    mesh.frustumCulled = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    // After the world's opaque surfaces and the waters' films, with the other blended air.
    mesh.renderOrder = 6;
    mesh.visible = false;

    return {
        mesh,
        stats: { triangles: built.triangles, deepest: built.deepest },
        /**
         * @param {number} hour   the colour script's hour now
         * @param {number} pool   the weather's pool multiplier
         * @param {boolean} shown whether the world lets it draw (in the air, not hidden)
         */
        update(hour, pool, shown) {
            const now = hollowMistAt(hour, pool, cfg);
            uMist.value.set(now.amount, now.gather);
            mesh.visible = !!shown && now.amount > 0.004;
        },
        dispose() {
            built.geometry.dispose();
            material.dispose();
        },
    };
}
