/**
 * Parhelion materials: the shared uniform bag and every drawable's node material (spec §5).
 *
 * All materials are MeshBasicNodeMaterial (no lights, no PMREM, no MRT). Every shared helper
 * is a layout'd Fn from parhelion-optics.js; noise is ONLY the setLayout'd value noise from
 * odyssey-tsl-noise.js (never mx_*). The graph shape depends on the quality tier, so a tier
 * change rebuilds the materials (§9).
 *
 * Step status: the dome (§5.3, the hero) is final-shaped. The stone and snow materials follow
 * §5.1/§5.2 closely but are still PLACEHOLDERS for composition judging — the stone solver
 * geometry, sastrugi drift, glitter and the prism flash land in the next step.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    Loop,
    abs,
    acos,
    asin,
    atan,
    attribute,
    cameraPosition,
    clamp,
    cross,
    dFdx,
    dFdy,
    dot,
    exp,
    float,
    floor,
    fwidth,
    inverseSqrt,
    length,
    max,
    mix,
    normalWorld,
    normalize,
    positionLocal,
    positionWorld,
    pow,
    saturate,
    screenUV,
    select,
    sin,
    smoothstep,
    step,
    uniform,
    uniformArray,
    vec2,
    vec3,
} from 'three/tsl';
import { hash21, noise2 } from '../../rendering/odyssey/chapter-environments/shared/odyssey-tsl-noise.js';
import {
    CAM_REST, DEFAULT_LAYOUT, DOG_AZ, R22, S, STONE, TAN_V, U,
} from './parhelion-composition.js';
import {
    RIDGE_NOISE,
    linearColor,
    phArcGlow,
    phCalmBox,
    phCrown,
    phDogs,
    phHalo,
    phHaze,
    phLaneW,
    phLens,
    phLowitz,
    phParhelic,
    phRidge,
    phSkyOut,
    phSastrugi,
    phSoftCap,
    phSunPillar,
    phTone,
    phUta,
} from './parhelion-optics.js';

// ---------------------------------------------------------------------------------------
// Tiers (§9)
// ---------------------------------------------------------------------------------------

/**
 * Per-tier graph shape. `bloomD` is the `d` in `bloomNode.setResolutionScale(0.5 · d)`.
 * skyEvals: 1 = veil ×1 + sine ridges; 2 = veil ×1 + ridge noise; 3 = veil ×2 + ridge noise;
 * 4 = veil ×3 + ridge noise.
 */
export const PARHELION_TIERS = Object.freeze({
    Minimal: Object.freeze({
        name: 'Minimal',
        post: false,
        skyEvals: 1,
        snowEvals: 1,
        rime: false,
        crown: false,
        lowitz: false,
        bloomD: 0,
        bloomMips: 0,
        bloomStrength: 0,
        pixelRatioCap: 0.9,
    }),
    Low: Object.freeze({
        name: 'Low',
        post: true,
        skyEvals: 2,
        snowEvals: 2,
        rime: true,
        crown: false,
        lowitz: false,
        bloomD: 0.5,
        bloomMips: 3,
        bloomStrength: 0.30,
        pixelRatioCap: 1.0,
    }),
    Medium: Object.freeze({
        name: 'Medium',
        post: true,
        skyEvals: 3,
        snowEvals: 2,
        rime: true,
        crown: true,
        lowitz: false,
        bloomD: 0.6,
        bloomMips: 5,
        bloomStrength: 0.32,
        pixelRatioCap: 1.15,
    }),
    High: Object.freeze({
        name: 'High',
        post: true,
        skyEvals: 3,
        snowEvals: 2,
        rime: true,
        crown: true,
        lowitz: true,
        bloomD: 0.7,
        bloomMips: 5,
        bloomStrength: 0.34,
        pixelRatioCap: 1.25,
    }),
    Ultra: Object.freeze({
        name: 'Ultra',
        post: true,
        skyEvals: 4,
        snowEvals: 2,
        rime: true,
        crown: true,
        lowitz: true,
        bloomD: 0.85,
        bloomMips: 5,
        bloomStrength: 0.34,
        pixelRatioCap: 1.35,
    }),
    Extreme: Object.freeze({
        name: 'Extreme',
        post: true,
        skyEvals: 4,
        snowEvals: 2,
        rime: true,
        crown: true,
        lowitz: true,
        bloomD: 1.0,
        bloomMips: 5,
        bloomStrength: 0.36,
        pixelRatioCap: 1.5,
    }),
});

/** Accepts a tier object or a tier name (case-insensitive); defaults to High. */
export function resolveParhelionTier(tier) {
    if (tier && typeof tier === 'object' && tier.name) return tier;
    if (typeof tier === 'string') {
        const key = Object.keys(PARHELION_TIERS).find((name) => name.toLowerCase() === tier.toLowerCase());
        if (key) return PARHELION_TIERS[key];
    }
    return PARHELION_TIERS.High;
}

// ---------------------------------------------------------------------------------------
// Shared uniforms (§5.0)
// ---------------------------------------------------------------------------------------

/** Reaction arc slots: 0–3 beads/orbits, 4–5 lock stations, 6 count-wave, 7 echo. */
export const ARC_SLOTS = 8;

/** Hound pillar lanes: 0/1 dogs, 2/3 outer lanes, 4/5 echo spares (§5.6). */
export const PILLAR_LANES = 6;

/** Idle optics gains: uK0 = (halo, dogs, parhelic, uta), uK1 = (crown, sunPillar, lowitz, displayDim). */
export const IDLE_OPTICS = Object.freeze({
    k0: Object.freeze([1.0, 0.85, 0.22, 0.30]),
    k1: Object.freeze([0.0, 0.55, 0.0, 1.0]),
});

/** Resting stone rim gain (§5.1: peak ≤ 0.9 at rest, no bloom). */
export const REST_RIM = 1.0;

function rectVec4(r) {
    return new THREE.Vector4(r.x0, r.y0, r.x1, r.y1);
}

/**
 * Creates the shared uniform bag once; every material reads from it. The CPU side writes
 * values in place (deduped by the effect runtime); nothing here is re-created per frame.
 */
export function createSharedUniforms() {
    const arcSlots = Array.from({ length: ARC_SLOTS }, () => new THREE.Vector4(0, 0, 1, 0));
    // Hound pillars (§5.6): (birth, amp, beadStartV, life) and (worldX, worldZ, width, height).
    const pillarSlots = Array.from({ length: PILLAR_LANES }, () => new THREE.Vector4(-1e4, 0, 1.05, 1));
    const pillarPlaceSlots = Array.from({ length: PILLAR_LANES }, () => new THREE.Vector4(0, -180, 3.2, 260));
    const { aspect } = DEFAULT_LAYOUT;
    return {
        // Clocks (CPU-integrated so rate changes never jump; seek(t) sets them to t·rate).
        uTime: uniform(0),
        uDustClock: uniform(0),
        uVeilPhase: uniform(0),
        uDriftPhase: uniform(0),
        // Environment.
        uWarmth: uniform(0.1),
        uBreath: uniform(1),
        // Optics gains.
        uK0: uniform(new THREE.Vector4(...IDLE_OPTICS.k0)),
        uK1: uniform(new THREE.Vector4(...IDLE_OPTICS.k1)),
        // Sundogs and parhelic pulse.
        uDogFlare: uniform(new THREE.Vector2(0, 0)),
        uDogTail: uniform(1),
        uDogTint: uniform(0),
        uPc: uniform(new THREE.Vector2(DOG_AZ, 0)),
        // Arc slots: (phiCenter, amp, width, mode).
        arcSlots,
        uArcs: uniformArray(arcSlots, 'vec4'),
        uArcCount: uniform(0, 'int'),
        // Dust effects (consumed by the dust/glint materials next step).
        uRingFlash: uniform(0),
        uPrism: uniform(0),
        uShower: uniform(0),
        uSpoke: uniform(new THREE.Vector2(0, 0)),
        uCrossArm: uniform(0),
        uDustGain: uniform(1),
        uDensity: uniform(0.6),
        uRim: uniform(REST_RIM),
        // Calm rect and screen.
        uCalmUnion: uniform(rectVec4(DEFAULT_LAYOUT.card)),
        uAspect: uniform(aspect),
        uUnionDim: uniform(0),
        uPixAng: uniform((2 * TAN_V) / 1080),
        uDpr: uniform(1),
        uTanHV: uniform(new THREE.Vector2(TAN_V * aspect, TAN_V)),
        // Rest camera.
        uCamRest: uniform(new THREE.Vector3(CAM_REST.x, CAM_REST.y, CAM_REST.z)),
        // Stone (baseHW, midHW, topHW, shoulderH) — written from solveStone().
        uStoneHW: uniform(new THREE.Vector4(
            STONE.DEFAULT_SX * 1.1,
            STONE.DEFAULT_SX,
            STONE.DEFAULT_SX * 0.9,
            STONE.DEFAULT_SY * STONE.UNIT_SHOULDER,
        )),
        // Hound pillars.
        pillarSlots,
        pillarPlaceSlots,
        uPillars: uniformArray(pillarSlots, 'vec4'),
        uPillarPlace: uniformArray(pillarPlaceSlots, 'vec4'),
    };
}

// ---------------------------------------------------------------------------------------
// Shared per-fragment direction frame
// ---------------------------------------------------------------------------------------

const round6 = (x) => Math.round(x * 1e6) / 1e6;
const S_VEC = [S.x, S.y, S.z].map(round6);
const U_VEC = [U.x, U.y, U.z].map(round6);
/** Shader literals for the ring radius and the hard lens step. */
const R22S = Math.round(R22 * 1e5) / 1e5;
const LENS_IN = Math.round((R22 - 0.014) * 1e5) / 1e5;
const LENS_OUT = Math.round((R22 - 0.002) * 1e5) / 1e5;

// ---------------------------------------------------------------------------------------
// Sky dome + halo display (§5.3) — THE hero
// ---------------------------------------------------------------------------------------

/**
 * @param {ReturnType<typeof createSharedUniforms>} u shared uniforms
 * @param {object|string} [tierIn] tier object or name
 * @param {{ calmDebug?: boolean }} [options] calmDebug draws the calm-union outline (build-time)
 */
export function createDomeMaterial(u, tierIn, { calmDebug = false } = {}) {
    const tier = resolveParhelionTier(tierIn);
    const minimal = !tier.post;
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'parhelion-dome';
    material.side = THREE.BackSide;
    material.transparent = false;
    material.depthTest = true;
    material.depthWrite = false;
    material.fog = false;

    material.colorNode = Fn(() => {
        // ── Direction terms (§5.0). The dome is re-centred on the camera and never rotated,
        //    so the local position IS the view direction.
        const d = normalize(positionLocal).toVar();
        const cA = dot(d, vec3(...S_VEC)).toVar();
        const a = acos(clamp(cA, -1.0, 1.0)).toVar();
        const ly = dot(d, vec3(...U_VEC));
        const inv = inverseSqrt(d.x.mul(d.x).add(ly.mul(ly)).add(1e-8));
        const cphi = d.x.mul(inv).toVar();
        const sphi = ly.mul(inv).toVar();
        const cphi2 = cphi.mul(cphi).toVar();
        const alpha = a.mul(cphi).toVar();
        const beta = a.mul(sphi).toVar();
        const el = asin(clamp(d.y, -1.0, 1.0)).toVar();
        const az = atan(d.x, d.z.negate()).toVar();
        const xG = a.sub(R22S).toVar();
        const sunward = pow(max(cA, 0.0), 4.0).toVar();
        // Steeper than the spec's pow(ss(0, .6, d.y), .7): the corners must reach L .03–.06.
        const up = pow(smoothstep(0.0, 0.40, d.y), 0.75);

        // ── Cirrostratus veil (noise evals: 1 / 2 / 3 by tier).
        const veilA = noise2(vec2(az.mul(3.0).add(u.uVeilPhase), el.mul(9.0)));
        let veil = veilA;
        if (tier.skyEvals >= 3) {
            const veilB = noise2(vec2(az.mul(7.1).sub(u.uVeilPhase.mul(1.5)), el.mul(21.0)));
            veil = veilA.mul(0.65).add(veilB.mul(0.35));
        }
        if (tier.skyEvals >= 4) {
            const veilC = noise2(vec2(az.mul(15.3).add(u.uVeilPhase.mul(2.0)), el.mul(44.0)));
            veil = veil.mul(0.8).add(veilC.mul(0.2));
        }
        const v = veil.toVar();

        // ── Sky: bright outside the ring, a hard step into the dusky lens inside it.
        const veilLift = smoothstep(0.45, 0.85, v).mul(float(1.0).sub(up.mul(0.6)));
        const veilSheen = linearColor(0xE8EEF8).mul(veilLift.mul(0.06));
        const outSky = phSkyOut(d, sunward, up, u.uWarmth).add(veilSheen);
        const inner = smoothstep(LENS_IN, LENS_OUT, a);
        const lens = phLens(a, u.uWarmth, u.uBreath);
        const haze = phHaze(d, sunward, u.uWarmth).toVar();
        const skyCore = select(d.y.lessThan(0.0), haze, mix(lens, outSky, inner));

        // ── Distant ice ridges, higher on the left (1 noise eval; sine ridges at Minimal).
        const ridgeN = tier.skyEvals >= 2
            ? noise2(vec2(az.mul(RIDGE_NOISE.AZ_SCALE), RIDGE_NOISE.ROW))
            : sin(az.mul(RIDGE_NOISE.AZ_SCALE * 1.7).add(1.1)).mul(0.5).add(0.5);
        const laneW = phLaneW(screenUV, u.uCalmUnion);
        const rid = phRidge(az, el, sunward, laneW, ridgeN);
        const baseHaze = smoothstep(0.004, -0.006, el).mul(0.5).add(0.12);
        const ridCol = mix(rid.rgb, haze, baseHaze);
        const sky = mix(skyCore, ridCol, rid.a);

        // ── The halo display.
        const parhelic = linearColor(0xF5F1EA).mul(phParhelic(az, el, u.uPc.x, u.uPc.y, u.uK0.z));
        const pillar = linearColor(0xFFD98A).mul(phSunPillar(alpha, beta, u.uK1.y.mul(u.uBreath)));
        let optics = phHalo(a, cphi2, v, u.uK0.x)
            .add(phDogs(az, el, u.uDogFlare.x, u.uDogFlare.y, u.uDogTail, u.uDogTint, u.uK0.y))
            .add(parhelic)
            .add(phUta(alpha, beta, u.uK0.w))
            .add(pillar);
        if (tier.crown) optics = optics.add(linearColor(0xF4F2FF).mul(phCrown(a, cphi2, u.uK1.x)));
        if (tier.lowitz) optics = optics.add(linearColor(0xFFF6E6).mul(phLowitz(a, sphi, u.uK1.z)));
        const opt = optics.toVar();

        // Reaction arcs: ONE WGSL loop over the live slots; costs nothing when idle.
        If(u.uArcCount.greaterThan(0), () => {
            const phiM = atan(sphi, abs(cphi));
            const phiO = atan(sphi, cphi);
            Loop(u.uArcCount, ({ i }) => {
                opt.addAssign(phArcGlow(phiM, phiO, xG, u.uArcs.element(i)));
            });
        });

        // Optics dim over the calm union (the card) — the stone occludes most of it anyway.
        const calmU = phCalmBox(screenUV, u.uCalmUnion, 0.015, u.uAspect);
        let col = sky.add(opt.mul(mix(1.0, 0.2, calmU)).mul(u.uK1.w));
        if (minimal) col = phTone(col).mul(float(1.0).sub(u.uUnionDim.mul(calmU)));
        if (calmDebug) {
            const edge = phCalmBox(screenUV, u.uCalmUnion, 0.004, u.uAspect);
            const line = smoothstep(0.05, 0.35, edge).mul(smoothstep(0.95, 0.65, edge));
            col = mix(col, vec3(1.0, 0.0, 1.0), line);
        }
        return col;
    })();

    return material;
}

// ---------------------------------------------------------------------------------------
// Vigil Stone (§5.1): a faceted dark-basalt glacial erratic
// ---------------------------------------------------------------------------------------

/**
 * Needs the parhelion-geometry.js stone (`aFacet` per triangle, `aBary` per vertex, smooth
 * normals). Facets are flat (screen-derivative normal) with hash-varied tones in the dark
 * basalt range #121827–#2A3656; rime on the crown and the windward (left) flank, a few frost
 * cracks along facet edges, a drift burying the base, and a thin gold rim — all of it OUTSIDE
 * the card only: behind the card the face is flattened to the calm stone value.
 */
export function createStoneMaterial(u, tierIn) {
    const tier = resolveParhelionTier(tierIn);
    const minimal = !tier.post;
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'parhelion-stone';
    material.fog = false;

    material.colorNode = Fn(() => {
        const p = positionWorld.toVar();
        const nf = normalize(cross(dFdx(p), dFdy(p))).toVar();
        const view = normalize(cameraPosition.sub(p));
        const calmU = phCalmBox(screenUV, u.uCalmUnion, 0.02, u.uAspect).toVar();
        const open = float(1.0).sub(calmU).toVar();
        const hN = p.y.div(u.uStoneHW.w).toVar();
        const facet = attribute('aFacet', 'float');

        // Contre-jour skylight: the sun is behind the stone, so the face is lit by the cobalt sky
        // (up-facing facets) and faintly by the snow; windward-left facets catch a little more.
        const sky = saturate(nf.y.mul(0.5).add(0.42).sub(nf.x.mul(0.10)));
        const tone = facet.sub(0.5).mul(0.42);
        const fill = saturate(sky.mul(0.75).add(tone).add(0.08));
        // Behind the card: the board backdrop value (#151B2C, L ≈ .011 — under the idle board-rect
        // mean ≤ .013 once the attenuated bloom is added), facets flattened to ±3 %.
        const deep = linearColor(0x121827);
        const baseOpen = mix(deep, linearColor(0x2A3656), fill);
        const calmFace = linearColor(0x151B2C).mul(fill.sub(0.5).mul(0.06).add(1.0));
        const base = mix(baseOpen, calmFace, calmU);

        let col = base;
        if (tier.rime) {
            // Rime: crown cap + windward (left) flank streaks; never behind the card.
            // Rime cap on the crown, streaks down the windward (left) flank, frost on up-facing
            // ledges — never behind the card.
            const crownCap = smoothstep(0.7, 0.95, hN);
            const flank = smoothstep(0.35, 0.7, nf.x.negate()).mul(smoothstep(0.1, 0.4, hN)).mul(0.8);
            const ledges = smoothstep(0.6, 0.9, nf.y).mul(0.35);
            const streaks = smoothstep(0.55, 0.8, noise2(vec2(p.x.mul(0.11), p.y.mul(0.03))));
            const rime = streaks.mul(0.75).add(smoothstep(0.6, 0.92, nf.y).mul(0.35))
                .mul(crownCap.add(flank).add(ledges))
                .mul(open);
            col = mix(base, linearColor(0x7C90BE), saturate(rime).mul(0.65));
        }

        // A few frost cracks: one edge of ~1 facet in 5, drawn as a thin rime line (AA by fwidth).
        const bary = attribute('aBary', 'vec3');
        const edge = float(1.0).sub(smoothstep(0.0, fwidth(bary.x).mul(1.3), bary.x));
        const crack = edge.mul(step(0.8, facet)).mul(smoothstep(0.2, 0.5, hN)).mul(open);
        col = mix(col, linearColor(0x5E72A0), crack.mul(0.8));

        // Faint skylit sheen on facets turned edge-on to the view (the gold silhouette line itself
        // is the rim shell, createStoneRimMaterial — a fresnel rim on 11 facets lights whole facets).
        const edgeOn = pow(float(1.0).sub(saturate(dot(normalWorld, view))), 4.0);
        col = col.add(linearColor(0x2A3656).mul(edgeOn.mul(0.35).mul(open)));

        // A wind-packed snow bank buries the base, higher on the windward left; stone value behind the card.
        const bank = sin(p.x.mul(0.11).add(1.3)).mul(0.9).add(sin(p.x.mul(0.29).add(0.4)).mul(0.45));
        const driftH = bank.add(4.2).sub(p.x.mul(0.035));
        const buried = smoothstep(driftH.add(2.2), driftH.sub(1.0), p.y);
        const driftLit = mix(linearColor(0x2A365C), linearColor(0x3A4A78), smoothstep(-3.0, 1.5, p.y.sub(driftH)));
        const driftCol = mix(driftLit, linearColor(0x171D2F), calmU);
        let out = mix(col, driftCol, buried);
        if (minimal) out = phTone(out).mul(float(1.0).sub(u.uUnionDim.mul(calmU)));
        return out;
    })();

    return material;
}

/**
 * The stone's gold contre-jour rim as an inverted hull: the stone mesh drawn BACK-faces-only a
 * hair larger (see STONE_RIM_SCALE in parhelion.effect.js), additive, after the sky. The stone
 * occludes all of it except a few-pixel line along the true silhouette — a fresnel rim on an
 * 11-facet stone lights whole facets instead. Strongest nearest the hidden sun, ONLY outside
 * the card, and ≤ 0.9 at rest (uRim 1) so no bloom halo traces the card.
 */
export function createStoneRimMaterial(u) {
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'parhelion-stone-rim';
    material.side = THREE.BackSide;
    material.transparent = true;
    material.blending = THREE.AdditiveBlending;
    material.depthWrite = false;
    material.depthTest = true;
    material.fog = false;
    material.colorNode = Fn(() => {
        const toSun = dot(normalize(positionWorld.sub(cameraPosition)), vec3(...S_VEC));
        // Real contre-jour rims die off fast away from the sun: bright beside the hidden sun at
        // the stone's flanks (A ≈ .22), a whisper along the crown (A ≈ .35).
        const sunProx = exp(acos(clamp(toSun, -1.0, 1.0)).div(0.10).negate());
        const calmU = phCalmBox(screenUV, u.uCalmUnion, 0.02, u.uAspect);
        // Fades into the snow bank at the base.
        const lift = smoothstep(4.0, 14.0, positionWorld.y);
        const outside = float(1.0).sub(calmU).mul(lift);
        const gain = sunProx.mul(3.4).add(0.02).mul(u.uRim).mul(outside);
        return linearColor(0xFFCF7A).mul(gain.mul(0.9));
    })();
    material.opacityNode = float(1.0);
    return material;
}

// ---------------------------------------------------------------------------------------
// Snowfield (§5.2): wind-carved sastrugi in contre-jour
// ---------------------------------------------------------------------------------------

/**
 * Low sun (9.5°) behind the stone rakes the snow: the flat surface glows warm-white toward the
 * sun and cool-white away from it; wind-cut sastrugi are SHORT, ANGULAR, BROKEN blades
 * elongated along the wind (two jittered grids of ph_sastrugi), each with a crisp gold crest
 * and a long cobalt lee shadow cast toward the camera; a specular glitter field of pixel points
 * lies over the near strip. Three value-noise evals at High: macro drifts, the regional
 * sastrugi field, spindrift. Blades and glitter are hashes (no noise); everything fades by
 * its own screen frequency, so the horizon never shimmers.
 */
export function createSnowMaterial(u, tierIn) {
    const tier = resolveParhelionTier(tierIn);
    const minimal = !tier.post;
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'parhelion-snow';
    material.fog = false;

    material.colorNode = Fn(() => {
        const p = positionWorld.toVar();
        const toP = p.sub(cameraPosition);
        const dist = length(toP).toVar();
        const dir = toP.div(dist).toVar();
        const pixH = dist.mul(u.uPixAng).toVar();
        // Metres per pixel in depth (the ground footprint), for LOD (§5.2 Bluehour graft).
        const fp = pixH.div(max(abs(dir.y), 0.02)).toVar();
        const along = dot(p.xz, vec2(0.94, 0.34)).toVar();
        const across = dot(p.xz, vec2(-0.34, 0.94)).toVar();

        // 1 — macro drifts: low-contrast undulation (±8 %), never colour banding.
        const macro = noise2(vec2(along.mul(0.004), across.mul(0.02))).toVar();
        // 2 — regional sastrugi field: wind-scoured patches between smoother drifts.
        const field = tier.snowEvals >= 2
            ? smoothstep(0.28, 0.55, noise2(vec2(along.mul(0.012), across.mul(0.04))))
            : float(0.7);

        // Two jittered blade grids (≈ 26 × 8 m and 10 × 3.5 m, the second at a slightly
        // different wind angle), each LOD'd by its own screen frequency.
        const gA = vec2(along.div(26.0), across.div(8.0));
        const along2 = dot(p.xz, vec2(0.97, 0.24));
        const across2 = dot(p.xz, vec2(-0.24, 0.97));
        const gB = vec2(along2.div(10.0), across2.div(3.5)).add(vec2(0.37, 0.61));
        const faA = fwidth(gA.y);
        const faB = fwidth(gB.y);
        const bladeA = phSastrugi(gA, faA.mul(1.1).add(0.004), 0.0);
        const bladeB = phSastrugi(gB, faB.mul(1.1).add(0.004), 11.0);
        const lodA = float(1.0).sub(smoothstep(0.16, 0.42, faA)).mul(field);
        const lodB = float(1.0).sub(smoothstep(0.16, 0.42, faB)).mul(field);
        const lee = max(bladeA.x.mul(lodA), bladeB.x.mul(lodB)).toVar();
        const stoss = max(bladeA.y.mul(lodA), bladeB.y.mul(lodB));
        const crest = max(bladeA.z.mul(lodA), bladeB.z.mul(lodB));

        const toSun = max(dot(dir, vec3(...S_VEC)), 0.0).toVar();
        const fwd = pow(toSun, 12.0);
        const sunward = pow(toSun, 3.0);
        // Sunlit snow: warm-white toward the sun, cool-white away (never a lavender blend).
        const flat = mix(linearColor(0xE4E9F3), linearColor(0xFBF1E2), sunward.mul(0.7).add(0.3));
        // Golden contre-jour: forward scatter warms the snow toward the hidden sun's azimuth.
        const golden = mix(flat, linearColor(0xF6D7A6), pow(toSun, 7.0).mul(0.75));
        const lit = golden.mul(macro.mul(0.12).add(0.94)).mul(stoss.mul(0.1).add(1.0));
        const gold = linearColor(0xFFD39A).mul(crest.mul(fwd.mul(1.6).add(0.9)));
        const shadowed = mix(lit, linearColor(0x34488A), lee.mul(0.86));
        const surf = phSoftCap(shadowed.add(gold), 0.85);

        // Analytic stone shadow toward the camera (0 noise).
        const t = p.z.add(124.0).div(0.986286);
        const yq = t.mul(0.165047);
        const soft = t.mul(0.004).add(0.8);
        const hw = mix(u.uStoneHW.x, u.uStoneHW.z, clamp(yq.div(u.uStoneHW.w), 0.0, 1.0));
        const acrossShadow = float(1.0).sub(smoothstep(hw.sub(soft), hw.add(soft), abs(p.x)));
        const underTop = float(1.0).sub(smoothstep(u.uStoneHW.w.sub(soft), u.uStoneHW.w.add(soft), yq));
        const inShadow = acrossShadow.mul(underTop).mul(step(-124.0, p.z)).toVar();
        const calmU = phCalmBox(screenUV, u.uCalmUnion, 0.02, u.uAspect);
        const shadowOpen = mix(linearColor(0x2A365C), linearColor(0x3A4A78), macro);
        const shadowCol = mix(shadowOpen, linearColor(0x171D2F), calmU);
        let col = mix(surf, shadowCol, inShadow);

        // 3 — spindrift: soft wisps streaming left → right, strongest in the near field.
        if (tier.snowEvals >= 2) {
            const wisp = noise2(vec2(along.mul(0.03).sub(u.uDriftPhase), across.mul(0.12)));
            const drift = smoothstep(0.55, 0.95, wisp).mul(smoothstep(520.0, 110.0, dist)).mul(0.12);
            col = col.add(linearColor(0xDDE8F8).mul(drift.mul(float(1.0).sub(inShadow.mul(0.7)))));
        }

        // Aerial perspective into the shared horizon haze; a darker foreground strip.
        col = mix(col, phHaze(dir, pow(toSun, 4.0), u.uWarmth), smoothstep(300.0, 1900.0, dist));
        col = col.mul(mix(0.86, 1.0, smoothstep(110.0, 460.0, dist)));

        if (!minimal) {
            // Specular glitter: one 0.9 m cell in ~70 holds a pixel-point ice plate.
            const cell = floor(p.xz.div(0.9));
            const g = hash21(cell);
            const local = p.xz.sub(cell.add(0.5).mul(0.9));
            const px = vec2(local.x.div(pixH), local.y.div(fp));
            const spot = float(1.0).sub(smoothstep(0.35, 1.1, length(px)));
            const twPhase = u.uDustClock.mul(g.mul(5.0).add(2.0)).add(g.mul(40.0));
            const tw = pow(sin(twPhase).mul(0.5).add(0.5), 6.0).mul(0.75).add(0.25);
            const near = float(1.0).sub(smoothstep(0.8, 3.0, fp));
            const visible = float(1.0).sub(inShadow).mul(float(1.0).sub(calmU)).mul(float(1.0).sub(lee));
            const glit = step(0.986, g).mul(spot).mul(tw.mul(near)).mul(visible);
            // Below-horizon ring flash (reactions; 0 at rest): the prism arc through the glitter.
            const aRing = acos(clamp(dot(dir, vec3(...S_VEC)), -1.0, 1.0)).sub(R22S);
            const prism = u.uPrism.mul(exp(aRing.mul(aRing).div(0.0004).negate()));
            // Two-stop prism (red inside → ice-blue outside): the full ramp is not worth its bytes here.
            const prismT = clamp(aRing.add(0.01).div(0.03), 0.0, 1.0);
            const prismCol = mix(linearColor(0xFF6A4A), linearColor(0x9CC7F0), prismT).mul(prism.mul(3.0));
            col = col.add(linearColor(0xFFF3D6).mul(sunward.mul(0.8).add(1.6)).add(prismCol).mul(glit));
        } else {
            col = phTone(col).mul(float(1.0).sub(u.uUnionDim.mul(calmU)));
        }
        return col;
    })();

    return material;
}
