/**
 * @fileoverview Ch6 nebula field — six authored masses, rendered as LUMINOUS GAS.
 *
 * HISTORY. Wave 3 (2026-08-15) retired the additive FBM sprite tiers for SIX authored masses
 * sculpted by the shipped Act II cloud-field sculptor and painted OPAQUE (2-band wrap lighting,
 * ember crevices, drawn edge, dithered dissolve). In-game that paint read as plasticine: lit
 * purple/cyan lumps with yellow crests and hard silhouettes floating on black — a cumulus
 * language that belongs to the sky chapters, not to interstellar gas.
 *
 * NOW (masterpiece pass, 2026-10): the same six placements and the same two draws (one per
 * paint role), but each mass is a small cluster of soft ELLIPSOIDAL GAS VOLUMES, and the mesh
 * that carries them is only a COVERAGE PROXY (an icosphere hull just outside each volume):
 *
 * - THICKNESS, NOT SURFACE. Each fragment intersects its view ray with its volume's ellipsoid
 *   and reads the normalised half-chord — 1 through the core, 0 at the rim. That is the
 *   projected density of a soft volume, so nothing reads as a lit surface, and because the
 *   hull sits outside the ellipsoid its own silhouette is always empty.
 * - STRUCTURE FROM THE MID-CHORD. The noise is sampled where the ray passes closest to the
 *   volume centre (blended a little toward the hull point for internal parallax): domain-
 *   warped fbm erodes the rim into wisps, ridged crests become filaments, and a low-frequency
 *   ridged field cuts DARK DUST LANES through the glow.
 * - VALUE LADDER. Hot heart → body hue → cool transparent rim; one dominant hue per mass with
 *   a complementary accent riding the filaments (palette per mass below).
 *
 * Blending is ADDITIVE (order-independent — the two draws and every other additive layer in
 * the chapter composite correctly in any order). FrontSide on closed hulls keeps the overdraw
 * to one layer per volume; satellites overlapping their primary is where a mass is densest.
 *
 * REVEAL: still deliberately NOT in the chapter's `entryContinuity` buckets — those write
 * `material.opacity`, which an opacityNode overrides (r181+). The field group exposes ONE
 * shared `uReveal`, ticked by the chapter's update() from the staging product (nebulaReveal
 * × spaceReveal × chapterOpacity); both meshes fade on it, and update() hides the group
 * outright below 0.002 so a hidden field costs nothing.
 */

import * as THREE from 'three/webgpu';
import {
    attribute, cameraPosition, clamp, dot, float, fract, int, mix, modelWorldMatrixInverse,
    normalWorld, normalize, oneMinus, positionWorld, pow, smoothstep, sqrt, uniform,
    uniformArray, varying, vec3, vec4,
} from 'three/tsl';
import { cloudFieldSdf } from '../world/odyssey-cloud-field.js';
import { fbm3, ridged3 } from './shared/odyssey-tsl-noise.js';
import {
    NEBULA_FIELD_CLEARANCE,
    ODYSSEY_NEBULA_FIELD_SPECS,
} from './odyssey-nebula-field-specs.js';

// Per-mass gas palette (linear-ish authored hexes; colour verdicts are taken through the
// game's ACES + master grade, never flat). `body` is the dominant hue, `core` the hot heart,
// `accent` the complementary hue the filaments carry, `glow` the mass's overall emission
// (rule 6: the colossal hero veil is DIM and soft, the small witnesses crisp and bright),
// `dust` how hard the dark lanes carve it.
//
// The chapter's register is cool (indigo grade) with gilded accents, so the palette walks
// blue-violet → magenta → rose with gold/amber as the accent — never a rainbow.
const GAS_PALETTE = Object.freeze({
    'S1-witness-near': {
        body: 0xc85a86, core: 0xffe2c0, accent: 0x6ad0d8, glow: 0.90, dust: 0.70,
    },
    'S2-witness-mid': {
        body: 0x3a9cc0, core: 0xe0fbff, accent: 0xffa8c8, glow: 0.85, dust: 0.70,
    },
    'N1-reef-left': {
        body: 0x7a46b8, core: 0xffb0d8, accent: 0xffc878, glow: 0.85, dust: 0.85,
    },
    'N2-reef-right': {
        body: 0x4658c8, core: 0xd0d0ff, accent: 0xffb868, glow: 0.80, dust: 0.85,
    },
    'N5-pillar': {
        body: 0xb04a78, core: 0xffe6c0, accent: 0x7090ff, glow: 0.85, dust: 0.95,
    },
    'N4-hero-veil': {
        body: 0x2a74a0, core: 0xc0f0ff, accent: 0xe08ab8, glow: 0.70, dust: 0.80,
    },
});
const GAS_PALETTE_FALLBACK = Object.freeze({
    warm: {
        body: 0xb8306a, core: 0xffd2a8, accent: 0x6a8cff, glow: 0.8, dust: 0.8,
    },
    cool: {
        body: 0x1f6a9a, core: 0xa8e8ff, accent: 0xd06aa8, glow: 0.6, dust: 0.8,
    },
});

// ── GAS VOLUMES ──────────────────────────────────────────────────────────────────────
// Each authored mass becomes a small CLUSTER of soft ellipsoids — a primary plus satellites
// seeded from the spec — so the silhouettes are irregular without a sculpt. The spec's
// placement table (x / base / z / w / h / yaw / seed) still owns the composition; these
// factors only say how much gas each role carries around that placement.
const GAS_SCALE = Object.freeze({
    witness: 1.2, reef: 1.24, pillar: 1.2, hero: 1.55, default: 1.2,
});
// Depth of a mass as a fraction of its width (the sculpt grammar's ~0.3w lobe spread).
const GAS_DEPTH = 0.62;
// The coverage hull sits this much outside the gas ellipsoid, so the hull's own silhouette
// is always empty space (thickness reaches 0 inside it).
export const NEBULA_PROXY_MARGIN = 1.08;
// Icosphere detail of each proxy (detail 3 = 320 faces — round enough at any size the
// chapter frames it, since it only bounds the gas and is never itself seen).
const PROXY_DETAIL = 3;

function seededRng(seed) {
    let state = (Math.floor(seed * 9973) ^ 0x9e3779b9) >>> 0;
    return () => {
        state = Math.imul(state ^ (state >>> 15), 0x2c1b3c6d) >>> 0;
        state = (state + 0x6d2b79f5) >>> 0;
        return ((state ^ (state >>> 13)) >>> 0) / 4294967296;
    };
}

/**
 * The gas ellipsoids for one spec (corridor-local, axis-aligned), primary first.
 * @returns {Array<{cx:number, cy:number, cz:number, rx:number, ry:number, rz:number}>}
 */
export function resolveNebulaGasVolumes(spec) {
    const k = GAS_SCALE[spec.role] ?? GAS_SCALE.default;
    const rng = seededRng(spec.seed);
    const cx = spec.x;
    const cy = spec.base + (spec.h * 0.5);
    const cz = spec.z;
    const rx = spec.w * 0.5 * k;
    const ry = spec.h * 0.5 * k;
    const rz = spec.w * 0.5 * GAS_DEPTH * k;
    const volumes = [{
        cx, cy, cz, rx, ry, rz,
    }];
    const tall = spec.h > spec.w * 1.6;
    const cosY = Math.cos(spec.yaw || 0);
    const sinY = Math.sin(spec.yaw || 0);
    for (let i = 0; i < 2; i += 1) {
        const side = i === 0 ? -1 : 1;
        const s = 0.52 + (rng() * 0.2);
        // A tall mass (the pillar) stacks its satellites up its axis; a wide one spreads them
        // along its yawed long axis.
        const along = tall ? (rng() - 0.5) * 0.4 * rx : side * (0.38 + (rng() * 0.18)) * rx;
        const lift = tall ? side * (0.42 + (rng() * 0.12)) * ry : (rng() - 0.4) * 0.45 * ry;
        const depth = (rng() - 0.5) * 0.5 * rz;
        volumes.push({
            cx: cx + (along * cosY) - (depth * sinY),
            cy: cy + lift,
            cz: cz + (along * sinY) + (depth * cosY),
            rx: rx * s,
            ry: ry * s * (tall ? 0.7 : 0.9),
            rz: rz * s,
        });
    }
    return volumes;
}

/**
 * Signed distance (approximate) from a point to the nearest gas HULL — the surface the camera
 * must never cross, because back-face culling would make the gas vanish the instant it did.
 */
export function nebulaGasHullDistance(specs, x, y, z) {
    let d = Infinity;
    specs.forEach((spec) => {
        resolveNebulaGasVolumes(spec).forEach((v) => {
            const rx = v.rx * NEBULA_PROXY_MARGIN;
            const ry = v.ry * NEBULA_PROXY_MARGIN;
            const rz = v.rz * NEBULA_PROXY_MARGIN;
            // Quilez's ellipsoid bound: k0 (k0 - 1) / k1 — exact on the surface and far more
            // honest than (k0 - 1) * minRadius, which under-reads elongated hulls by ~40%.
            const px = x - v.cx;
            const py = y - v.cy;
            const pz = z - v.cz;
            const k0 = Math.hypot(px / rx, py / ry, pz / rz);
            const k1 = Math.hypot(px / (rx * rx), py / (ry * ry), pz / (rz * rz)) || 1e-9;
            d = Math.min(d, (k0 * (k0 - 1)) / k1);
        });
    });
    return d;
}

export function validateNebulaFieldClearance(
    specs = ODYSSEY_NEBULA_FIELD_SPECS,
    clearance = NEBULA_FIELD_CLEARANCE,
) {
    const { zFrom, zTo, step } = clearance.travelWindow;
    const violations = [];
    for (let z = zFrom; z >= zTo; z -= step) {
        // The authored placement rule (the sculpt SDF) AND the hull the gas is actually drawn
        // on: both must leave the corridor axis its free field.
        const d = Math.min(cloudFieldSdf(specs, 0, 0, z), nebulaGasHullDistance(specs, 0, 0, z));
        if (d < clearance.axis) {
            violations.push({ z, sdf: Number(d.toFixed(1)) });
        }
    }
    return violations;
}

/**
 * Merge every gas volume of `specs` into ONE geometry of proxy hulls. Per vertex:
 * `aGasCentre` (the volume's centre) and `aGasShape` (its radii xyz + the spec's GLOBAL index
 * in w, for the palette lookup).
 */
function buildGasGeometry(specs, specIndexById) {
    const unit = new THREE.IcosahedronGeometry(1, PROXY_DETAIL);
    const unitPos = unit.getAttribute('position');
    const perVolume = unitPos.count;
    const volumes = [];
    specs.forEach((spec) => {
        resolveNebulaGasVolumes(spec).forEach((v) => volumes.push({ ...v, index: specIndexById.get(spec.id) ?? 0 }));
    });
    const n = volumes.length * perVolume;
    const position = new Float32Array(n * 3);
    const normal = new Float32Array(n * 3);
    const centre = new Float32Array(n * 3);
    const shape = new Float32Array(n * 4);
    let o = 0;
    volumes.forEach((v) => {
        const hx = v.rx * NEBULA_PROXY_MARGIN;
        const hy = v.ry * NEBULA_PROXY_MARGIN;
        const hz = v.rz * NEBULA_PROXY_MARGIN;
        for (let i = 0; i < perVolume; i += 1) {
            const ux = unitPos.getX(i);
            const uy = unitPos.getY(i);
            const uz = unitPos.getZ(i);
            position[o * 3] = v.cx + (ux * hx);
            position[(o * 3) + 1] = v.cy + (uy * hy);
            position[(o * 3) + 2] = v.cz + (uz * hz);
            // Ellipsoid normal: the unit normal pulled through the inverse-transpose scale.
            const nx = ux / hx;
            const ny = uy / hy;
            const nz = uz / hz;
            const nl = Math.hypot(nx, ny, nz) || 1;
            normal[o * 3] = nx / nl;
            normal[(o * 3) + 1] = ny / nl;
            normal[(o * 3) + 2] = nz / nl;
            centre[o * 3] = v.cx;
            centre[(o * 3) + 1] = v.cy;
            centre[(o * 3) + 2] = v.cz;
            shape[o * 4] = v.rx;
            shape[(o * 4) + 1] = v.ry;
            shape[(o * 4) + 2] = v.rz;
            shape[(o * 4) + 3] = v.index;
            o += 1;
        }
    });
    unit.dispose();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
    geometry.setAttribute('aGasCentre', new THREE.BufferAttribute(centre, 3));
    geometry.setAttribute('aGasShape', new THREE.BufferAttribute(shape, 4));
    geometry.computeBoundingSphere();
    return { geometry, triangles: n / 3, volumes: volumes.length };
}

function paletteArrays(specs) {
    const toV4 = (hex, w) => {
        const c = new THREE.Color(hex);
        return new THREE.Vector4(c.r, c.g, c.b, w);
    };
    const body = [];
    const core = [];
    const accent = [];
    specs.forEach((spec) => {
        const p = GAS_PALETTE[spec.id] ?? GAS_PALETTE_FALLBACK[spec.paint] ?? GAS_PALETTE_FALLBACK.warm;
        body.push(toV4(p.body, p.glow));
        core.push(toV4(p.core, p.dust));
        accent.push(toV4(p.accent, 0));
    });
    return {
        uBody: uniformArray(body, 'vec4'),
        uCore: uniformArray(core, 'vec4'),
        uAccent: uniformArray(accent, 'vec4'),
    };
}

function buildGasMaterial(uReveal, uTime, palette) {
    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.FrontSide });
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;

    const shape = attribute('aGasShape', 'vec4');
    const R = shape.xyz;
    const C = attribute('aGasCentre', 'vec3');
    // Per-volume noise seed from its centre — every volume of a mass gets its own structure.
    const seed = fract(dot(C, vec3(0.0123, 0.0071, 0.0057)));

    // Palette resolved per VERTEX and carried as varyings — every vertex of a mass holds the
    // same index, so the interpolated values are that mass's palette exactly.
    const index = int(shape.w.add(0.5));
    const body = varying(palette.uBody.element(index));
    const core = varying(palette.uCore.element(index));
    const accent = varying(palette.uAccent.element(index));

    // ── THICKNESS: the view ray through the volume's ellipsoid (corridor-local frame) ──
    const camL = modelWorldMatrixInverse.mul(vec4(cameraPosition, 1.0)).xyz;
    const pL = modelWorldMatrixInverse.mul(vec4(positionWorld, 1.0)).xyz;
    const o = camL.sub(C).div(R);
    const dn = normalize(pL.sub(camL).div(R));
    const b = dot(o, dn);
    const closest2 = dot(o, o).sub(b.mul(b));
    const thick = sqrt(clamp(float(1.0).sub(closest2), 0.0, 1.0));
    const mid = o.sub(dn.mul(b));
    const surface = pL.sub(C).div(R);

    // ── STRUCTURE: domain-warped body, ridged filaments, low-frequency dust lanes ──
    const t = uTime.mul(0.010);
    const q = mix(mid, surface, 0.25).mul(1.6).add(vec3(seed.mul(17.0), seed.mul(-9.0), t));
    const warp = vec3(
        fbm3(q.mul(0.6), 2),
        fbm3(q.mul(0.6).add(vec3(5.2, 1.3, 2.7)), 2),
        fbm3(q.mul(0.6).add(vec3(2.1, 7.7, 4.4)), 2),
    ).sub(0.5).mul(1.2);
    const qw = q.add(warp);
    const gas = smoothstep(0.28, 0.72, fbm3(qw, 4));
    const fil = ridged3(qw.mul(1.4).add(11.0), 3);
    const lane = ridged3(qw.mul(0.5).add(23.0), 2);

    // EROSION, bounded by the ellipsoid: the rim only reaches out where the noise is dense,
    // and nothing survives outside the ellipsoid (thick = 0 ⇒ d < 0).
    const d = thick.sub(oneMinus(gas).mul(0.8));
    const density = smoothstep(0.0, 0.45, d);
    // The hot heart follows the VOLUME (thickness), only lightly broken by the noise — a
    // glowing interior, not bright veins.
    const heart = pow(smoothstep(0.50, 1.0, thick), 2.0).mul(gas.mul(0.5).add(0.5)).mul(density);
    const filaments = smoothstep(0.56, 0.76, fil).mul(density).mul(oneMinus(heart));
    // Broad dark lanes: the ridged field's crest BANDS (not its hairlines), strongest through
    // the thick middle where a real dust lane is seen against the most glow.
    const dust = smoothstep(0.30, 0.52, lane).mul(smoothstep(0.20, 0.70, thick)).mul(core.w);

    // Rim → body → core value ladder. The rim keeps the body's hue, darker and a touch cooler
    // (a strong hue shift drew a blue outline round every mass); the body brightens toward the
    // thick middle so each mass glows from inside.
    const rim = body.xyz.mul(vec3(0.42, 0.45, 0.58));
    let emission = mix(rim, body.xyz, density).mul(density.mul(thick.mul(0.18).add(0.08)));
    emission = emission.add(core.xyz.mul(heart).mul(0.20));
    emission = emission.add(accent.xyz.mul(filaments).mul(0.12));
    emission = emission.mul(float(1.0).sub(dust.mul(0.92)));

    // Backstop fade on the hull itself (it is already empty there by construction).
    const V = normalize(cameraPosition.sub(positionWorld));
    const facing = clamp(dot(normalize(normalWorld), V), 0.0, 1.0);
    const proxyFade = smoothstep(0.0, 0.55, facing);

    material.colorNode = emission.mul(body.w).mul(proxyFade);
    material.opacityNode = uReveal;
    return material;
}

export function createNebulaFieldTSL({ uTime = null } = {}) {
    const uReveal = uniform(0);
    const time = uTime ?? uniform(0);
    const group = new THREE.Group();
    group.name = 'nebula-field';

    const specIndexById = new Map(ODYSSEY_NEBULA_FIELD_SPECS.map((s, i) => [s.id, i]));
    const palette = paletteArrays(ODYSSEY_NEBULA_FIELD_SPECS);

    let triangles = 0;
    let masses = 0;
    const parts = [];
    ['warm', 'cool'].forEach((paint) => {
        const specs = ODYSSEY_NEBULA_FIELD_SPECS.filter((s) => s.paint === paint);
        if (!specs.length) return;
        const built = buildGasGeometry(specs, specIndexById);
        const material = buildGasMaterial(uReveal, time, palette);
        const mesh = new THREE.Mesh(built.geometry, material);
        mesh.name = `nebula-field-${paint}`;
        // Merged meshes spanning the corridor: the camera lives inside their bounds
        // for most of the chapter — culling them would pop.
        mesh.frustumCulled = false;
        group.add(mesh);
        parts.push({ mesh, material, geometry: built.geometry });
        triangles += built.triangles;
        masses += specs.length;
    });

    group.userData.uReveal = uReveal;
    group.userData.triangles = triangles;
    group.userData.masses = masses;
    return {
        mesh: group, group, parts, uReveal, triangles, masses,
    };
}
