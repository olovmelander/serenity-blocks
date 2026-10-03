/**
 * @fileoverview Ch6 nebula field — the authored masses (four since the 2026-10-03
 * re-composition, see odyssey-nebula-field-specs.js), rendered as LUMINOUS GAS.
 *
 * HISTORY. Wave 3 (2026-08-15) retired the additive FBM sprite tiers for SIX authored masses
 * sculpted by the shipped Act II cloud-field sculptor and painted OPAQUE (2-band wrap lighting,
 * ember crevices, drawn edge, dithered dissolve). In-game that paint read as plasticine: lit
 * purple/cyan lumps with yellow crests and hard silhouettes floating on black — a cumulus
 * language that belongs to the sky chapters, not to interstellar gas.
 *
 * NOW (masterpiece pass, 2026-10): the same six placements, but each mass is a small cluster of
 * soft ELLIPSOIDAL GAS VOLUMES, and the mesh that carries them is only a COVERAGE PROXY (an
 * icosphere hull just outside each volume). Seamless pass (2026-10): ONE draw for all six
 * masses (the two paint-role meshes compiled the identical graph twice), hulls hugging their
 * gas (margin 1.08 -> 1.03), the noise read from the baked lattice (one texture fetch per
 * octave instead of eight hashes) and the octave budget gated by quality tier:
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
 * Blending is ADDITIVE (order-independent — the draw and every other additive layer in the
 * chapter composite correctly in any order). FrontSide on closed hulls keeps the overdraw to
 * one layer per volume; satellites overlapping their primary is where a mass is densest.
 *
 * STAGING (2026-10-03). Each mass fades in on its own BEAT of the chapter (`aGasBeat` x
 * `uBeat`), every mass is lit from the black hole's side (`uKey`), and in the chapter's last
 * beat — the pull — the fine structure streams toward the hole and warms (`uPull`,
 * `uPullPhase`). All uniforms: nothing here recompiles a pipeline.
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
    normalWorld, normalize, oneMinus, positionLocal, positionWorld, pow, smoothstep, sqrt, uniform,
    uniformArray, varying, vec3, vec4,
} from 'three/tsl';
import { cloudFieldSdf } from '../world/odyssey-cloud-field.js';
import { fbm3, noise3, ridged3 } from './shared/odyssey-tsl-noise.js';
import { latticeNoise3 } from './shared/odyssey-lattice-noise.js';
import { resolveQualityTier } from './shared/odyssey-quality-tier.js';
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
// RE-PALETTED 2026-10-03: ONE family — indigo, violet, rose — with amber only as the accent the
// black hole's light puts on the filaments. Six hues (rose, cyan, purple, blue, magenta, teal)
// read as a rainbow of stickers; lower chroma and one family read as one sky.
const GAS_PALETTE = Object.freeze({
    'S1-witness-near': {
        body: 0x94508e, core: 0xffe0d0, accent: 0xffb070, glow: 0.80, dust: 0.70,
    },
    'N1-reef-left': {
        body: 0x6a44a8, core: 0xdcc4f4, accent: 0xffc078, glow: 0.64, dust: 0.85,
    },
    'N2-reef-right': {
        body: 0x3f4eae, core: 0xc8d2ff, accent: 0xe8a0c8, glow: 0.70, dust: 0.85,
    },
    'N4-hero-veil': {
        body: 0x3a56a6, core: 0xc4d4ff, accent: 0xffa468, glow: 0.78, dust: 0.90,
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
// is always empty space (thickness reaches 0 inside it). Seamless pass: 1.08 -> 1.03. The
// detail-3 icosphere's flattest facet dips to ~0.988 of its vertex radius, so 1.03 still
// clears the ellipsoid (>= 1.017) while every hull rasterises ~9% fewer additive fragments
// that could only ever shade to zero.
export const NEBULA_PROXY_MARGIN = 1.03;
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
    // A CURVED, TAPERED SPINE (2026-10-03): an inner pair and a smaller, flatter outer pair of
    // satellites strung along the mass's long axis on a gentle arc. Primary + two satellites
    // gave every mass the same convex cotton-ball silhouette; the outer pair draws it out into
    // a streaming shape with thin ends.
    const arc = (rng() - 0.5) * 0.9;
    for (let i = 0; i < 4; i += 1) {
        const side = i % 2 === 0 ? -1 : 1;
        const outer = i >= 2;
        const s = outer ? 0.34 + (rng() * 0.12) : 0.54 + (rng() * 0.18);
        const reach = outer ? 0.9 + (rng() * 0.22) : 0.4 + (rng() * 0.16);
        // A tall mass stacks its satellites up its axis; a wide one strings them along its
        // yawed long axis.
        const along = tall ? (rng() - 0.5) * 0.4 * rx : side * reach * rx;
        const lift = tall
            ? side * (outer ? 0.85 : 0.45) * ry
            : (((rng() - 0.4) * 0.35) + (arc * reach * reach)) * ry;
        const depth = (rng() - 0.5) * 0.5 * rz;
        volumes.push({
            cx: cx + (along * cosY) - (depth * sinY),
            cy: cy + lift,
            cz: cz + (along * sinY) + (depth * cosY),
            rx: rx * s * (outer ? 1.3 : 1),
            ry: ry * s * (tall ? 0.7 : 0.9) * (outer ? 0.72 : 1),
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
        resolveNebulaGasVolumes(spec).forEach((v) => volumes.push({
            ...v,
            index: specIndexById.get(spec.id) ?? 0,
            beat: spec.beat ?? [0, 0.001],
        }));
    });
    const n = volumes.length * perVolume;
    const position = new Float32Array(n * 3);
    const normal = new Float32Array(n * 3);
    const centre = new Float32Array(n * 3);
    const shape = new Float32Array(n * 4);
    const beat = new Float32Array(n * 2);
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
            beat[o * 2] = v.beat[0];
            beat[(o * 2) + 1] = v.beat[1];
            o += 1;
        }
    });
    unit.dispose();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
    geometry.setAttribute('aGasCentre', new THREE.BufferAttribute(centre, 3));
    geometry.setAttribute('aGasShape', new THREE.BufferAttribute(shape, 4));
    // Each mass's reveal window, in chapter-local progress (the spec's `beat`).
    geometry.setAttribute('aGasBeat', new THREE.BufferAttribute(beat, 2));
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

/**
 * Octave budget per quality tier, for the two FRAGMENT-rate fields (the low-frequency warp and
 * dust lanes run per vertex — see buildGasMaterial). `high` keeps the masterpiece-pass detail:
 * a 3-octave body and 2-octave filaments (1 analytic noise + 4 lattice fetches per fragment).
 * `medium` (Lane B, the iGPU) and `low` drop the body's third octave and the filaments' second
 * — the finest wisps and hairline crests, a few pixels wide at the masses' framed size.
 */
export const NEBULA_OCTAVES = Object.freeze({
    high: Object.freeze({ gas: 3, filaments: 2 }),
    medium: Object.freeze({ gas: 2, filaments: 1 }),
    low: Object.freeze({ gas: 2, filaments: 1 }),
});

// fbm3/ridged3 are NOT normalised: amplitude sums for 1-4 octaves are 0.5/0.75/0.875/0.9375.
const OCTAVE_SUM = [0, 0.5, 0.75, 0.875, 0.9375];

function buildGasMaterial(uReveal, uTime, palette, tier = 'high', drive = {}) {
    // The chapter's beat (chapter-local progress) and the KEY: the black hole's position in the
    // corridor frame — the one light every mass is painted by.
    const uBeat = drive.uBeat ?? uniform(1);
    const uKey = drive.uKey ?? uniform(new THREE.Vector3(-300, 300, -1200));
    // THE PULL (the chapter's last beat): `uPull` 0..1 warms the lit gas toward the disk's amber;
    // `uPullPhase` is how far the gas's FINE structure has streamed toward the hole (accumulated
    // by the chapter, so easing the pull in never jumps the pattern).
    const uPull = drive.uPull ?? uniform(0);
    const uPullPhase = drive.uPullPhase ?? uniform(0);
    const octaves = NEBULA_OCTAVES[tier] ?? NEBULA_OCTAVES.high;
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
    // PER-MASS BEAT: each mass fades in across its own window of the chapter.
    const gasBeat = attribute('aGasBeat', 'vec2');
    const beatReveal = varying(smoothstep(gasBeat.x, gasBeat.y, uBeat), 'vNebulaBeat');
    // Direction from this volume to the key (corridor-local), per vertex.
    const keyDir = varying(normalize(uKey.sub(C)), 'vNebulaKey');

    // ── THICKNESS: the view ray through the volume's ellipsoid (corridor-local frame) ──
    // `positionLocal` IS the corridor-local hull point (the mesh carries no transform of its
    // own beyond the corridor's); in the fragment stage it arrives as a varying, which saves
    // the per-fragment inverse-matrix multiply the world round trip used to cost.
    const camL = modelWorldMatrixInverse.mul(vec4(cameraPosition, 1.0)).xyz;
    const pL = positionLocal;
    const o = camL.sub(C).div(R);
    const dn = normalize(pL.sub(camL).div(R));
    const b = dot(o, dn);
    const closest2 = dot(o, o).sub(b.mul(b));
    const thick = sqrt(clamp(float(1.0).sub(closest2), 0.0, 1.0));
    const mid = o.sub(dn.mul(b));
    const surface = pL.sub(C).div(R);

    // ── STRUCTURE: domain-warped body, ridged filaments, low-frequency dust lanes ──
    // NOISE BUDGET (pre-merge review: 15 -> 9 octaves; seamless pass: 9 analytic octaves per
    // fragment -> 1 analytic + 2-4 baked-lattice fetches). The warp only needs low-frequency
    // drift (1 octave each); the gas body keeps 3, the filaments 2, the broad dust lanes 1 — the
    // octaves cut were sub-feature detail the smoothstep thresholds below flatten anyway. Each
    // field is rescaled by the ratio of amplitude sums (OCTAVE_SUM) to keep the value range
    // every threshold below was tuned against — which also lets the tier drop octaves freely.
    //
    // VERTEX-RATE LOW FREQUENCIES (seamless pass). The sample point, its three-axis warp and
    // the dust-lane field all vary by about one lattice cell across a whole volume (q * 0.6,
    // q * 0.5), while a hull triangle spans ~1/20 of it — so they are evaluated once per
    // VERTEX (162 per hull) and interpolated, instead of once per fragment (~10^5 per hull).
    // At that rate they keep the ANALYTIC noise (8 hashes per vertex is free), so the masses'
    // shapes are exactly the masterpiece pass's. The thickness stays per fragment: it is what
    // draws the soft rim, and sqrt(1 - c^2) is the one term here that is not smooth across a
    // triangle. So does the lanes' ridge FOLD: only the smooth noise value is interpolated and
    // the crease (1 - |2n - 1|)^2 is taken per fragment, so a lane's crest stays sharp.
    //
    // WHICH OCTAVES MAY BE BAKED. Each mass spans only ~3 lattice cells, so its silhouette and
    // brightness ARE the particular random values of the gas's first octave — the masses were
    // composed against analytic noise3's values, and a re-seeded first octave re-dealt them
    // (measured: -24 % frame luma, chunkier lobes). So the first gas octave stays analytic
    // (one noise3 per fragment) and only the detail octaves — finer than a mass's shape, where
    // any random deal reads the same — come from the lattice (shared/odyssey-lattice-noise.js:
    // one texture fetch per octave instead of eight hashes).
    const t = uTime.mul(0.010);
    const q = mix(mid, surface, 0.25).mul(1.6).add(vec3(seed.mul(17.0), seed.mul(-9.0), t));
    const warp = vec3(
        fbm3(q.mul(0.6), 1).mul(1.5),
        fbm3(q.mul(0.6).add(vec3(5.2, 1.3, 2.7)), 1).mul(1.5),
        fbm3(q.mul(0.6).add(vec3(2.1, 7.7, 4.4)), 1).mul(1.5),
    ).sub(0.5).mul(1.2);
    const qwVertex = q.add(warp);
    const qw = varying(qwVertex, 'vNebulaQw');
    // ridged3(x, 1) * 1.5 == 0.75 * (1 - |2 n(x) - 1|)^2 — written out so the fold is per fragment.
    const laneNoise = varying(noise3(qwVertex.mul(0.5).add(23.0)), 'vNebulaLane');
    const laneFold = float(1.0).sub(laneNoise.mul(2.0).sub(1.0).abs());
    const lane = laneFold.mul(laneFold).mul(0.75);
    // fbm3's octave walk written out: octave 1 analytic, octaves 2+ from the lattice.
    // THE PULL streams only the DETAIL octaves and the filaments toward the key: a mass's
    // silhouette is its first octave's particular values (see above), so that one stays put and
    // the wisps flow across it — gas being drawn off the cloud, not the cloud re-dealt.
    const qFlow = qw.sub(keyDir.mul(uPullPhase));
    let gasField = noise3(qw).mul(0.5);
    for (let octave = 1; octave < octaves.gas; octave += 1) {
        gasField = gasField.add(latticeNoise3(qFlow.mul(2.03 ** octave)).mul(0.5 ** (octave + 1)));
    }
    const gas = smoothstep(0.28, 0.72, gasField.mul(0.9375 / OCTAVE_SUM[octaves.gas]));
    const fil = ridged3(qFlow.mul(1.4).add(11.0), octaves.filaments, latticeNoise3)
        .mul(0.875 / OCTAVE_SUM[octaves.filaments]);

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

    // PAINTED BY ONE LIGHT (2026-10-03). The glow used to follow THICKNESS — every mass
    // brightest in its middle, like a lit cotton ball — and that, with six hues, is what read
    // as stickers. Now each mass is lit from the black hole's side: `lit` is how far the point
    // of the ray nearest the mass's centre leans toward the key. The lit face carries the pale
    // core tone and the amber filaments; the far side falls to the dim, cooler rim tone and the
    // dust lanes bite hardest there. A small heart remains so the thick middle still glows.
    const lit = smoothstep(-0.55, 0.75, dot(normalize(mid.add(surface.mul(0.35))), keyDir));
    const rim = body.xyz.mul(vec3(0.42, 0.45, 0.58));
    let emission = mix(rim, body.xyz, density).mul(density.mul(thick.mul(0.10).add(0.05)));
    // In the pull the lit face warms toward the accretion disk's amber and the filaments —
    // the gas being drawn off — brighten.
    const litTone = mix(mix(body.xyz, core.xyz, 0.5), vec3(1.0, 0.62, 0.32), uPull.mul(0.4));
    emission = emission.add(litTone.mul(density).mul(lit).mul(thick.mul(0.6).add(0.4)).mul(0.17));
    emission = emission.add(core.xyz.mul(heart).mul(0.06));
    emission = emission.add(accent.xyz.mul(filaments).mul(lit.mul(0.8).add(0.2))
        .mul(uPull.mul(0.08).add(0.13)));
    emission = emission.mul(float(1.0).sub(dust.mul(mix(float(0.95), float(0.6), lit))));

    // Backstop fade on the hull itself (it is already empty there by construction). Its ramp
    // has to end INSIDE the facing range where hull rays still miss the gas: a ray grazing the
    // ellipsoid meets a hull of margin m at facing sqrt(1 - 1/m^2) (0.24 at m = 1.03), so the
    // old 0.55 ramp — sized for the 1.08 hull — would now dim every mass's real rim.
    const V = normalize(cameraPosition.sub(positionWorld));
    const facing = clamp(dot(normalize(normalWorld), V), 0.0, 1.0);
    const proxyFade = smoothstep(0.0, 0.2, facing);

    material.colorNode = emission.mul(body.w).mul(proxyFade);
    material.opacityNode = uReveal.mul(beatReveal);
    return material;
}

export function createNebulaFieldTSL({ uTime = null, qualityTier = 'high' } = {}) {
    const uReveal = uniform(0);
    const time = uTime ?? uniform(0);
    const group = new THREE.Group();
    group.name = 'nebula-field';

    const specs = ODYSSEY_NEBULA_FIELD_SPECS;
    const specIndexById = new Map(specs.map((s, i) => [s.id, i]));
    const palette = paletteArrays(specs);

    // ONE DRAW (seamless pass). The warm/cool split bought nothing: both meshes compiled the
    // identical graph (the palette is indexed per spec, not per paint role) and, being
    // additive, composite in any order — so every volume of every mass is one geometry on
    // one material. `paint` still picks each mass's palette fallback.
    const built = buildGasGeometry(specs, specIndexById);
    const uBeat = uniform(1);
    const uKey = uniform(new THREE.Vector3(-300, 300, -1200));
    const uPull = uniform(0);
    const uPullPhase = uniform(0);
    const material = buildGasMaterial(uReveal, time, palette, resolveQualityTier(qualityTier), {
        uBeat, uKey, uPull, uPullPhase,
    });
    const mesh = new THREE.Mesh(built.geometry, material);
    mesh.name = 'nebula-field-gas';
    // A merged mesh spanning the corridor: the camera lives inside its bounds for most of
    // the chapter — culling it would pop.
    mesh.frustumCulled = false;
    group.add(mesh);
    const parts = [{ mesh, material, geometry: built.geometry }];
    const { triangles } = built;
    const masses = specs.length;

    group.userData.uReveal = uReveal;
    // The chapter ticks these: `uBeat` = chapter-local progress (per-mass reveal windows read
    // it), `uKey` = the black hole's position in the corridor frame (the light the gas takes).
    group.userData.uBeat = uBeat;
    group.userData.uKey = uKey;
    // The pull (the chapter's last beat): strength 0..1 and the accumulated stream distance.
    group.userData.uPull = uPull;
    group.userData.uPullPhase = uPullPhase;
    group.userData.triangles = triangles;
    group.userData.masses = masses;
    return {
        mesh: group, group, parts, uReveal, triangles, masses,
    };
}
