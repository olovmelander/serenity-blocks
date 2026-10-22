/**
 * Halcyon Apex — the land round the lagoon.
 *
 *  - The far ranges: three ridges of faceted peaks, each a strip cut into flat triangles, lit by
 *    the same sun and sky as everything else and then given to the air, which is what tells
 *    them apart. They stand low under the sun and behind the pyramid, so both keep the sky.
 *  - The islets: low banks of sand and rock with grass on their backs.
 *  - What grows and lies on them: flat-crowned trees and boulders, cut as plainly as the rest.
 *
 * Everything is seeded and built once. The islets' outlines are handed to the lagoon, which
 * shelves and foams on them as it does on the masonry.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    attribute,
    cameraPosition,
    clamp,
    dot,
    exp,
    float,
    length,
    max,
    mix,
    normalWorld,
    normalize,
    positionWorld,
    smoothstep,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    DEG,
    TAU,
    haAtmosphere,
    haClearLightLive,
    haFogAmount,
    haPart,
    haSkyFog,
    haSkyLight,
    mulberry32,
    siteToWorld,
    smooth,
} from './halcyon-apex-tsl.js';

/** What a triangle of the land is (the material shades by it). */
const LAND = Object.freeze({
    range: 0, sand: 1, rock: 2, grass: 3, bark: 4, leaf: 5,
});

/** Flat triangles with a colour and a kind per vertex. */
class LandBuilder {
    constructor() {
        this.positions = [];
        this.normals = [];
        this.colors = [];
    }

    tri(a, b, c, color, kind) {
        const ux = b[0] - a[0];
        const uy = b[1] - a[1];
        const uz = b[2] - a[2];
        const vx = c[0] - a[0];
        const vy = c[1] - a[1];
        const vz = c[2] - a[2];
        let nx = uy * vz - uz * vy;
        let ny = uz * vx - ux * vz;
        let nz = ux * vy - uy * vx;
        const l = Math.hypot(nx, ny, nz) || 1;
        nx /= l;
        ny /= l;
        nz /= l;
        [a, b, c].forEach((p) => {
            this.positions.push(p[0], p[1], p[2]);
            this.normals.push(nx, ny, nz);
            this.colors.push(color[0], color[1], color[2], kind);
        });
    }

    /** Append a three.js geometry, transformed, as flat triangles of one colour. */
    solid(geometry, matrix, color, kind, jitter = 0, rand = null) {
        const g = geometry.index ? geometry.toNonIndexed() : geometry;
        const pos = g.getAttribute('position');
        const v = new THREE.Vector3();
        const pts = [];
        // The same corner must move the same way in every triangle that shares it.
        const moved = new Map();
        for (let i = 0; i < pos.count; i++) {
            v.fromBufferAttribute(pos, i);
            if (jitter > 0 && rand) {
                const key = `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
                let k = moved.get(key);
                if (!k) {
                    k = 1 + (rand() - 0.5) * 2 * jitter;
                    moved.set(key, k);
                }
                v.multiplyScalar(k);
            }
            v.applyMatrix4(matrix);
            pts.push([v.x, v.y, v.z]);
        }
        for (let i = 0; i < pts.length; i += 3) {
            const shade = rand ? 0.86 + rand() * 0.28 : 1;
            this.tri(pts[i], pts[i + 1], pts[i + 2], [color[0] * shade, color[1] * shade, color[2] * shade], kind);
        }
        if (g !== geometry) g.dispose();
    }

    geometry() {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
        geometry.setAttribute('aLand', new THREE.Float32BufferAttribute(this.colors, 4));
        return geometry;
    }

    get triangles() {
        return this.positions.length / 9;
    }
}

/** Where the islets lie: [x, z, radius at the waterline, height, trees, rocks]. */
export function isletPlan() {
    const left = siteToWorld(-36, 120);
    const islet = (x, z, radius, height, trees, rocks) => ({
        x, z, radius, height, trees, rocks,
    });
    return [
        islet(left[0], left[1], 15, 3.0, 2, 4),
        islet(37, -52, 8.5, 2.0, 1, 3),
        islet(-12, -305, 30, 6.5, 4, 6),
        islet(190, -350, 34, 8, 4, 5),
        islet(-40, -30, 3.4, 1.1, 0, 3),
    ];
}

function buildRanges(land, segments, rand) {
    // Each ridge: [distance, peak height, how far its foot stands in front of its crest].
    const ridges = [[2700, 420, 520], [1750, 250, 360], [1120, 150, 250]];
    const tones = [[0.36, 0.4, 0.5], [0.4, 0.4, 0.44], [0.46, 0.41, 0.38]];
    const span = 250 * DEG;
    /** Rows of facets from the crest down to the foot: enough to carve spurs and gullies. */
    const ROWS = 6;
    // The slopes' carving draws from its own stream: the crests below take exactly the numbers
    // they always took from `rand`, so the skyline, and the islets and trees seeded after it,
    // stand where they always stood.
    const carveRand = mulberry32(0x5eed + segments);
    ridges.forEach(([distance, peak, foot], layer) => {
        const n = Math.max(12, Math.round(segments * (1 - layer * 0.18)));
        // A ridge is a walk of peaks and saddles.
        const heights = [];
        let h = 0.5;
        for (let i = 0; i <= n; i++) {
            h = Math.max(0.12, Math.min(1, h + (rand() - 0.5) * 0.62));
            const sharp = rand() < 0.3 ? 1.25 : 1;
            heights.push(Math.min(1, h * sharp));
        }
        const crest = [];
        for (let i = 0; i <= n; i++) {
            const az = -span / 2 + (i / n) * span;
            // Low under the sun (to the right) and behind the pyramid (to the left).
            const underSun = 1 - 0.72 * smooth(34 * DEG, 8 * DEG, Math.abs(az - 30 * DEG));
            const behind = 1 - 0.5 * smooth(26 * DEG, 6 * DEG, Math.abs(az + 25 * DEG));
            const y = peak * heights[i] * underSun * behind * (0.75 + rand() * 0.3);
            const jitter = 1 + (rand() - 0.5) * 0.06;
            // (The old shoulder's three numbers, still drawn so the stream stays in step.)
            rand(); rand(); rand();
            crest.push({ az, y, r: distance * jitter });
        }
        for (let i = 0; i < n * 4; i++) rand();
        // Spurs run down from the peaks and gullies between them: every other column of the
        // slope stands out a little, every other sinks.
        const grid = crest.map(({ az, y, r: top }, i) => {
            const spur = (i % 2 === 0 ? 1 : -1) * (0.5 + carveRand() * 0.5);
            const column = [];
            for (let k = 0; k <= ROWS; k++) {
                const t = k / ROWS;
                const r = top - foot * (t ** 0.9) * (k === 0 ? 0 : 0.92 + carveRand() * 0.16);
                // The slope falls steeply under the crest and flattens toward the foot.
                const fall = (1 - t) ** 1.55;
                const inner = k > 0 && k < ROWS;
                const carve = inner ? spur * peak * 0.05 * Math.sin(Math.PI * t) * (0.6 + carveRand() * 0.8) : 0;
                const yy = k === ROWS ? -2 : Math.max(-1, y * fall + carve + (inner ? (carveRand() - 0.5) * y * 0.06 * (1 - t) : 0));
                const azk = az + (inner ? (carveRand() - 0.5) * (span / n) * 0.55 : 0);
                column.push([Math.sin(azk) * r, yy, -Math.cos(azk) * r]);
            }
            return column;
        });
        const tone = tones[layer];
        const shade = () => {
            const k = 0.9 + carveRand() * 0.2;
            return [tone[0] * k, tone[1] * k, tone[2] * k];
        };
        for (let i = 0; i < n; i++) {
            for (let k = 0; k < ROWS; k++) {
                const a = grid[i][k];
                const b = grid[i + 1][k];
                const c = grid[i][k + 1];
                const d = grid[i + 1][k + 1];
                // Alternate the diagonal so the facets do not all lean one way.
                if ((i + k) % 2 === 0) {
                    land.tri(a, c, b, shade(), LAND.range);
                    land.tri(b, c, d, shade(), LAND.range);
                } else {
                    land.tri(a, c, d, shade(), LAND.range);
                    land.tri(a, d, b, shade(), LAND.range);
                }
            }
        }
    });
}

function buildIslet(land, islet, rand) {
    const rings = 5;
    const sectors = Math.max(9, Math.round(islet.radius * 1.1));
    const wobble = [];
    for (let s = 0; s < sectors; s++) wobble.push(0.78 + rand() * 0.42);
    const grid = [];
    for (let r = 0; r <= rings; r++) {
        const row = [];
        const k = r / rings;
        for (let s = 0; s < sectors; s++) {
            const angle = (s / sectors) * TAU + (r % 2) * (Math.PI / sectors);
            const reach = islet.radius * 1.3 * k * wobble[s] * (r === rings ? 1 : 0.9 + rand() * 0.2);
            // A bank: steep at the water, flat on its back.
            const profile = 1 - k ** 1.6;
            const y = r === rings ? -1.6 : islet.height * profile * (0.72 + rand() * 0.5) - 0.3 * k;
            row.push([islet.x + Math.cos(angle) * reach, y, islet.z + Math.sin(angle) * reach]);
        }
        grid.push(row);
    }
    const tint = (p, q, r) => {
        const y = (p[1] + q[1] + r[1]) / 3;
        const k = 0.88 + rand() * 0.24;
        if (y < 0.42) return [[0.8 * k, 0.72 * k, 0.52 * k], LAND.sand];
        if (y > islet.height * 0.5) return [[0.34 * k, 0.4 * k, 0.13 * k], LAND.grass];
        return [[0.42 * k, 0.38 * k, 0.31 * k], LAND.rock];
    };
    const face = (a, b, c) => {
        const [color, kind] = tint(a, b, c);
        land.tri(a, b, c, color, kind);
    };
    const top = [islet.x, islet.height * 1.02, islet.z];
    for (let s = 0; s < sectors; s++) {
        const next = (s + 1) % sectors;
        face(top, grid[1][next], grid[1][s]);
        for (let r = 1; r < rings; r++) {
            const a = grid[r][s];
            const b = grid[r][next];
            const c = grid[r + 1][s];
            const d = grid[r + 1][next];
            face(a, b, c);
            face(b, d, c);
        }
    }
}

const ROCK = new THREE.IcosahedronGeometry(1, 0);
const PAD = new THREE.IcosahedronGeometry(1, 1);

function buildRock(land, x, y, z, size, rand) {
    const m = new THREE.Matrix4().compose(
        new THREE.Vector3(x, y, z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(rand() * TAU, rand() * TAU, rand() * TAU)),
        new THREE.Vector3(size * (0.8 + rand() * 0.6), size * (0.55 + rand() * 0.4), size * (0.8 + rand() * 0.6)),
    );
    const k = 0.8 + rand() * 0.3;
    land.solid(ROCK, m, [0.4 * k, 0.37 * k, 0.33 * k], LAND.rock, 0.22, rand);
}

function buildTree(land, x, y, z, height, rand) {
    // A leaning trunk that forks into three boughs, each under a flat crown.
    const lean = (rand() - 0.5) * 0.5;
    const turn = rand() * TAU;
    const up = new THREE.Vector3(Math.sin(turn) * lean, 1, Math.cos(turn) * lean).normalize();
    const fork = new THREE.Vector3(x, y, z).addScaledVector(up, height * 0.56);
    const bark = [0.2, 0.13, 0.085];
    const limb = (from, to, r0, r1) => {
        const dir = new THREE.Vector3().subVectors(to, from);
        const len = dir.length();
        const g = new THREE.CylinderGeometry(r1, r0, len, 5, 1, true);
        const m = new THREE.Matrix4().compose(
            new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5),
            new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()),
            new THREE.Vector3(1, 1, 1),
        );
        land.solid(g, m, bark, LAND.bark, 0, rand);
        g.dispose();
    };
    limb(new THREE.Vector3(x, y - 0.4, z), fork, height * 0.05, height * 0.034);
    const boughs = 3;
    for (let i = 0; i < boughs; i++) {
        const a = turn + (i / boughs) * TAU + rand() * 0.7;
        const spread = height * (0.3 + rand() * 0.16);
        const tip = new THREE.Vector3(fork.x + Math.cos(a) * spread, fork.y + height * (0.3 + rand() * 0.14), fork.z + Math.sin(a) * spread);
        limb(fork, tip, height * 0.03, height * 0.012);
        const pads = 2 + Math.floor(rand() * 2);
        for (let j = 0; j < pads; j++) {
            const r = height * (0.24 + rand() * 0.13);
            const off = j === 0 ? 0 : r * 0.9;
            const pa = rand() * TAU;
            const m = new THREE.Matrix4().compose(
                new THREE.Vector3(tip.x + Math.cos(pa) * off, tip.y + (rand() - 0.3) * r * 0.2, tip.z + Math.sin(pa) * off),
                new THREE.Quaternion().setFromEuler(new THREE.Euler((rand() - 0.5) * 0.24, rand() * TAU, (rand() - 0.5) * 0.24)),
                new THREE.Vector3(r, r * 0.27, r),
            );
            const g = 0.85 + rand() * 0.3;
            land.solid(PAD, m, [0.17 * g, 0.27 * g, 0.075 * g], LAND.leaf, 0.14, rand);
        }
    }
}

/** The land's material: flat facets under the sanctuary's sun, sky and air. */
function createLandMaterial(u, { caster }) {
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'HalcyonApexLand';
    material.fog = false;
    material.fragmentNode = Fn(() => {
        const p = positionWorld;
        const n = normalize(normalWorld).toVar();
        const land = attribute('aLand', 'vec4');
        const kind = land.w.add(0.5).floor();
        const isLeaf = float(1.0).sub(kind.sub(LAND.leaf).abs().clamp(0.0, 1.0));
        const isRange = float(1.0).sub(kind.clamp(0.0, 1.0));
        const grain = u.noise(p.xz.mul(0.09).add(vec2(p.y.mul(0.07), 0.0))).r;
        const albedo = vec3(land.rgb).mul(grain.mul(0.3).add(0.85)).toVar();
        // Wet at the waterline.
        const wet = float(1.0).sub(smoothstep(0.0, 0.5, p.y)).mul(float(1.0).sub(isRange));
        albedo.mulAssign(mix(vec3(1.0), vec3(0.52, 0.56, 0.5), wet));
        // The lagoon breaks white on the islets.
        const lap = float(1.0).sub(smoothstep(0.02, 0.13, p.y.add(grain.mul(0.08)))).mul(float(1.0).sub(isRange));
        albedo.assign(mix(albedo, vec3(0.86, 0.9, 0.88), lap.mul(0.7)));
        const facing = max(dot(n, u.sunDir), 0.0);
        const lit = caster ? u.sunLit : float(1.0);
        const sun = u.sun.mul(facing).mul(lit);
        const sky = haSkyLight(u, n);
        const bounce = u.shallow.mul(float(1.0).sub(n.y).mul(0.5)).mul(exp(max(p.y, 0.0).mul(-0.12))).mul(float(1.0).sub(isRange));
        const col = sun.add(sky.mul(0.9)).add(bounce.mul(1.2)).mul(albedo).toVar();
        // A crown seen against the sun lets its light through.
        const V = normalize(p.sub(cameraPosition));
        const through = max(dot(V, u.sunDir), 0.0);
        col.addAssign(u.sun.mul(albedo).mul(through.mul(through).mul(through)).mul(isLeaf).mul(lit)
            .mul(0.3));
        const clear = haClearLightLive(u, p);
        col.addAssign(clear.rgb.mul(albedo).mul(1.2));
        if (!caster) {
            // ── The far ranges: snow on the high faces that look up, mist in the valleys ──
            const snowLine = float(165.0).add(grain.sub(0.5).mul(40.0));
            const snow = smoothstep(snowLine, snowLine.add(45.0), p.y).mul(smoothstep(0.3, 0.6, n.y)).mul(isRange);
            const snowLit = u.sun.mul(facing.mul(1.15)).add(sky.mul(1.05)).mul(vec3(0.92, 0.93, 0.98));
            col.assign(mix(col, snowLit, snow.mul(0.85)));
            // Rock faces that look up hold a little scree; the steep ones stay dark.
            col.mulAssign(mix(float(0.86), float(1.1), smoothstep(0.15, 0.7, n.y)).mul(isRange).add(float(1.0).sub(isRange)));
            // The air, once: its colour along this ray and how much of it lies in between. Mist
            // lies in the valleys at the foot of each range, and thickens the air there.
            const rel = p.sub(cameraPosition);
            const dist = length(rel);
            const dir = rel.div(max(dist, 1e-3));
            const fogCol = haSkyFog(u, vec3(dir.x, max(dir.y, 0.015), dir.z));
            const mist = exp(max(p.y, 0.0).mul(-1 / 30)).mul(0.3);
            const fade = haFogAmount(dist, p.y);
            return vec4(mix(col, fogCol, clamp(fade.add(mist.mul(float(1.0).sub(fade))), 0.0, 1.0)), 1.0);
        }
        return vec4(haAtmosphere(u, col, p), 1.0);
    })();
    return material;
}

/**
 * @param {object} u     shared sanctuary uniforms
 * @param {object} plan
 * @param {object} [opts]
 * @param {number} [opts.segments=96]  how finely the far ranges are cut
 * @param {number} [opts.seed]
 */
export function createTerrain(u, plan, opts = {}) {
    const rand = mulberry32((opts.seed ?? plan.seed ?? 1) + 0x77);
    const far = new LandBuilder();
    buildRanges(far, opts.segments ?? 96, rand);
    const ranges = haPart('HalcyonApexRanges', far.geometry(), createLandMaterial(u, { caster: false }), -22);

    const islets = isletPlan();
    const ground = new LandBuilder();
    const growth = new LandBuilder();
    islets.forEach((islet) => {
        buildIslet(ground, islet, rand);
        for (let i = 0; i < islet.rocks; i++) {
            const a = rand() * TAU;
            const r = islet.radius * (0.35 + rand() * 0.75);
            const size = 0.5 + rand() * (0.6 + islet.radius * 0.07);
            buildRock(ground, islet.x + Math.cos(a) * r, Math.max(0.1, islet.height * (1 - r / islet.radius) * 0.7), islet.z + Math.sin(a) * r, size, rand);
        }
        for (let i = 0; i < islet.trees; i++) {
            const a = rand() * TAU;
            const r = islet.radius * rand() * 0.34;
            buildTree(growth, islet.x + Math.cos(a) * r, islet.height * 0.8, islet.z + Math.sin(a) * r, 5 + rand() * 2.5 + islet.radius * 0.1, rand);
        }
    });
    const landMaterial = createLandMaterial(u, { caster: true });
    const isletPart = haPart('HalcyonApexIslets', ground.geometry(), landMaterial, -34);
    const flora = haPart('HalcyonApexFlora', growth.geometry(), landMaterial, -33);
    flora.material = null; // shared with the islets: disposed once
    isletPart.mesh.castShadow = true;
    flora.mesh.castShadow = true;
    return {
        ranges,
        islets: isletPart,
        flora,
        /** The islets' outlines at the waterline, for the lagoon: [x, z, radius]. */
        shore: islets.map((i) => [i.x, i.z, i.radius * 1.02]),
        triangles: far.triangles + ground.triangles + growth.triangles,
    };
}
