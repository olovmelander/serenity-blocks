/**
 * Parhelion materials: the shared uniform bag and every drawable's node material (spec §5).
 *
 * All materials are MeshBasicNodeMaterial (no lights, no PMREM, no MRT). Every shared helper
 * is a layout'd Fn from parhelion-optics.js; noise is ONLY the setLayout'd value noise from
 * odyssey-tsl-noise.js (never mx_*). The graph shape depends on the quality tier, so a tier
 * change rebuilds the materials (§9).
 *
 * Visual pass 2026-10-20: the Vigil Stone is a weathered, backlit standing stone (bedding
 * ledges with snow lines, rime, a gold rim nearest the hidden sun); the snow carries analytic
 * drifts lit against the 9.5° sun (blue camera-facing slopes, gold crests), the far stones'
 * long shadows and the lower halo glinting in it; the dome draws two backlit mountain ranges
 * on the horizon; the far stones (createFarStoneMaterial) give the scene its scale.
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
    cos,
    cross,
    dFdx,
    dFdy,
    dot,
    exp,
    float,
    floor,
    fract,
    fwidth,
    inverseSqrt,
    length,
    max,
    min,
    mix,
    normalWorld,
    normalize,
    positionLocal,
    positionWorld,
    pow,
    reflect,
    saturate,
    screenUV,
    select,
    sign,
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
    CAM_REST, DEFAULT_LAYOUT, DOG_AZ, FAR_STONES, R22, S, STONE, TAN_V, U,
} from './parhelion-composition.js';
import {
    linearColor,
    phArcGlow,
    phCalmBox,
    phCrown,
    phDogs,
    phFarShadow,
    phFog,
    phFogFar,
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
        // Far stones (x, z, halfWidth, height): static, read by the snow's shadow loop.
        uFarStones: uniformArray(FAR_STONES.map(([x, z, hw, h]) => new THREE.Vector4(x, z, hw, h)), 'vec4'),
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
            // Fibrous cirrostratus: the second read is stretched across a slanting fibre direction.
            const fibreU = az.add(el.mul(0.6)).mul(2.4).sub(u.uVeilPhase.mul(1.5));
            const fibreUv = vec2(fibreU, el.sub(az.mul(0.3)).mul(30.0));
            const veilB = noise2(fibreUv);
            veil = veilA.mul(0.65).add(veilB.mul(0.35));
        }
        if (tier.skyEvals >= 4) {
            const veilC = noise2(vec2(az.mul(15.3).add(u.uVeilPhase.mul(2.0)), el.mul(44.0)));
            veil = veil.mul(0.8).add(veilC.mul(0.2));
        }
        const v = veil.toVar();

        // ── Sky: bright outside the ring, a hard step into the dusky lens inside it. The thin
        //    cirrostratus sheet (the halo's own cloud) shows as faint fibres, lit by forward
        //    scattering toward the hidden sun, continuous across the ring.
        const fib = smoothstep(0.42, 0.88, v).mul(float(1.0).sub(up.mul(0.45)));
        const veilGlow = fib.mul(exp(a.div(0.5).negate()).mul(0.28).add(0.055));
        const veilSheen = mix(linearColor(0xE6EDF8), linearColor(0xFFF0D8), sunward).mul(veilGlow).toVar();
        const outSky = phSkyOut(d, sunward, up, u.uWarmth).add(veilSheen);
        const inner = smoothstep(LENS_IN, LENS_OUT, a);
        const lens = phLens(a, u.uWarmth, u.uBreath).add(veilSheen.mul(0.6));
        const haze = phHaze(d, sunward, u.uWarmth).toVar();
        const skyCore = select(d.y.lessThan(0.0), haze, mix(lens, outSky, inner));

        // ── Two backlit mountain ranges on the horizon, higher on the left (hash noise, no reads).
        const laneW = phLaneW(screenUV, u.uCalmUnion);
        const rid = phRidge(az, el, sunward, laneW, haze, u.uPixAng, u.uVeilPhase);
        // ── Ice fog lying on the far plain: veils the mountains' feet, glows toward the sun.
        const fog = phFog(az, el, sunward, u.uWarmth, u.uVeilPhase);
        // ph_ridge is premultiplied (its snow banners add light over the open sky).
        const sky = mix(skyCore.mul(float(1.0).sub(rid.a)).add(rid.rgb), fog.rgb, fog.a);

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
// Vigil Stone (§5.1): a weathered standing stone in contre-jour
// ---------------------------------------------------------------------------------------

/**
 * The Vigil Stone in contre-jour: the sun stands right behind it, so the face the camera sees
 * is in its own shadow, lit by the cobalt sky above and a faint warm bounce off the sunlit snow
 * below. Rock is a cool dark granite with a bedding grain; snow lies on every up-facing shelf
 * and on the crown (gold where the low sun grazes it from behind, sky-blue where it does not),
 * rime feathers the windward (left) flank, and the silhouette burns gold nearest the hidden sun.
 * All of the detail is OUTSIDE the card: behind it the face settles to the calm stone value
 * over a wide feather, so no dark rectangle shows round the card's edges.
 */
export function createStoneMaterial(u, tierIn) {
    const tier = resolveParhelionTier(tierIn);
    const minimal = !tier.post;
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'parhelion-stone';
    material.fog = false;

    material.colorNode = Fn(() => {
        const p = positionWorld.toVar();
        const n0 = normalize(normalWorld).toVar();
        const view = normalize(cameraPosition.sub(p)).toVar();
        const calmU = phCalmBox(screenUV, u.uCalmUnion, 0.05, u.uAspect).toVar();
        const open = float(1.0).sub(calmU).toVar();
        const hN = p.y.div(u.uStoneHW.w).toVar();

        // Bedding grain: one value-noise read, stretched along the (leaning) bedding.
        const g = (minimal ? float(0.5) : noise2(vec2(p.x.mul(0.07).add(p.z.mul(0.04)), p.y.mul(0.19)))).toVar();

        // A gentle bump from the grain (surface-gradient form): a few decimetres of relief, so
        // the light breaks up across a face without turning it to putty.
        const dpx = dFdx(p);
        const dpy = dFdy(p);
        const hgt = g.mul(0.55);
        const r1 = cross(dpy, n0);
        const r2 = cross(n0, dpx);
        const det = dot(dpx, r1);
        const grad = r1.mul(dFdx(hgt)).add(r2.mul(dFdy(hgt))).mul(sign(det));
        const n = normalize(n0.mul(abs(det)).sub(grad.mul(open))).toVar();

        // Contre-jour fill: faces turned toward either side see the bright horizon sky and the
        // sunlit snow there; faces toward the camera see the darker sky behind it and the snow in
        // the stone's own shadow; up-facing ones catch the cobalt zenith. The foot, over the
        // stone's own shadow, is darkest.
        const side = abs(n.x);
        const foot = smoothstep(0.0, 0.55, hN);
        const light = saturate(side.mul(side).mul(0.72).add(max(n.y, 0.0).mul(0.4)).add(0.06)
            .add(g.sub(0.5).mul(0.3))
            .mul(foot.mul(0.45).add(0.55))).toVar();
        let rock = mix(linearColor(0x070A12), linearColor(0x37446F), light);
        let glaze = float(0.0);
        if (tier.rime) {
            // Weathering: dark rain streaks running down from the ledges, pale lichen crust in
            // the grain's high patches (two more value-noise reads, High tiers only).
            const streak = noise2(vec2(p.x.mul(0.45).add(p.z.mul(0.3)), p.y.mul(0.035))).toVar();
            // Rotated off the axes, so the value-noise lattice never shows as squares.
            const fineUv = vec2(p.x.mul(0.62).add(p.y.mul(0.41)).sub(p.z.mul(0.5)), p.y.mul(0.62).sub(p.x.mul(0.41)));
            const fineN = noise2(fineUv);
            const lichen = smoothstep(0.66, 0.9, fineN).mul(smoothstep(0.45, 0.7, g));
            rock = rock.mul(float(1.0).sub(smoothstep(0.55, 0.85, streak).mul(0.45)))
                .mul(fineN.sub(0.5).mul(0.22).add(1.0));
            rock = mix(rock, linearColor(0x56607A).mul(light.add(0.35)), lichen.mul(0.18));
            // Verglas: the brightest streaks are clear meltwater ice, a glossy film over the rock,
            // broken by the grain into irregular runs (never a row of even stripes), highest up.
            glaze = smoothstep(0.7, 0.9, streak).mul(smoothstep(0.38, 0.7, g)).mul(smoothstep(0.2, 0.6, hN));
        }
        const warmSide = linearColor(0x4A3A2A).mul(smoothstep(0.6, 0.97, side).mul(0.6));
        const bounce = linearColor(0x22201C).mul(smoothstep(0.05, -0.7, n.y).mul(0.6));
        let col = rock.add(warmSide).add(bounce);

        // Bedding ledges (aLedge: unit height above each ledge line; aLedgeW: where each ledge
        // exists): a shadow under the lip and a line of snow on the shelf above it.
        const ledge = attribute('aLedge', 'vec4');
        const ledgeW = attribute('aLedgeW', 'vec4');
        const onShelf = smoothstep(0.0, 0.003, ledge).mul(float(1.0).sub(smoothstep(0.008, 0.02, ledge)))
            .mul(ledgeW);
        const underLip = smoothstep(-0.03, -0.004, ledge).mul(float(1.0).sub(smoothstep(-0.004, 0.0, ledge)))
            .mul(ledgeW);
        const shelfSnow = max(max(onShelf.x, onShelf.y), max(onShelf.z, onShelf.w)).mul(smoothstep(0.25, 0.45, g));
        const lip = max(max(underLip.x, underLip.y), max(underLip.z, underLip.w));
        col = col.mul(float(1.0).sub(lip.mul(0.6).mul(open)));

        // Snow on the shelves and patchily over the crown; gold where the sun grazes it.
        const sunLit = saturate(dot(n, vec3(...S_VEC)));
        const cap = smoothstep(0.85, 0.97, hN).mul(smoothstep(0.12, 0.45, n0.y.add(g.sub(0.5).mul(0.6))));
        const snowM = saturate(shelfSnow.add(cap)).mul(open).toVar();
        const snowShade = mix(linearColor(0x4A5C92), linearColor(0x91A4D6), smoothstep(-0.2, 0.8, n.y));
        const snowCol = mix(snowShade, linearColor(0xFFDDA0).mul(1.2), smoothstep(0.0, 0.2, sunLit));
        col = mix(col, snowCol, snowM);

        if (tier.rime) {
            // Rime feathers on the windward (left) flank.
            const flank = smoothstep(0.35, 0.8, n.x.negate()).mul(smoothstep(0.08, 0.35, hN));
            const rime = flank.mul(smoothstep(0.45, 0.7, g).mul(0.6).add(0.1)).mul(open).mul(float(1.0).sub(snowM));
            col = mix(col, linearColor(0x6A7EB0), saturate(rime).mul(0.45));
        }

        if (tier.rime) {
            // The ice glaze mirrors the sky: faces turned sideways catch the bright horizon,
            // faces toward the camera the darker cobalt behind it (Schlick fresnel, 5th power).
            const refl = reflect(view.negate(), n);
            const nv = float(1.0).sub(saturate(dot(n, view)));
            const fres = nv.mul(nv).mul(nv).mul(nv).mul(nv)
                .mul(0.8)
                .add(0.035);
            const skyRefl = mix(linearColor(0x2C4580), linearColor(0xCAD8EE), smoothstep(0.55, 0.0, abs(refl.y)));
            col = col.add(skyRefl.mul(glaze.mul(fres)).mul(open).mul(float(1.0).sub(snowM)));
        }

        // Contre-jour rim on the true silhouette (geometry normal): it burns gold to white-gold
        // nearest the hidden sun (blooming there), and snow at the edge glows more.
        const toSunA = acos(clamp(dot(view.negate(), vec3(...S_VEC)), -1.0, 1.0));
        const prox = exp(toSunA.div(0.19).negate()).mul(4.0).add(0.15).toVar();
        const edge = float(1.0).sub(saturate(dot(n0, view)));
        const rimF = edge.mul(edge).toVar();
        const rim = rimF.mul(rimF).mul(prox).mul(snowM.mul(1.5).add(1.0)).mul(u.uRim)
            .mul(open);
        // Lower Sun (uWarmth climbs with the level): the rim deepens toward amber.
        const rimWarm = mix(linearColor(0xFFB55E), linearColor(0xFF9440), u.uWarmth.mul(0.8));
        const rimCol = mix(rimWarm, linearColor(0xFFF0D0), smoothstep(0.8, 2.4, prox));
        col = col.add(rimCol.mul(rim.mul(0.85)));

        if (!minimal) {
            // Hoarfrost: pin-point crystals twinkling on the snowy ledges and crown, about one
            // pixel each (sized from the screen footprint), gold where they face the hidden sun.
            const q = p.mul(1.6);
            const cq = floor(q);
            const hq = hash21(vec2(cq.x.add(cq.z.mul(7.13)), cq.y));
            const pxW = max(length(fwidth(p)), 1e-4);
            const spotG = float(1.0).sub(smoothstep(pxW.mul(0.6), pxW.mul(1.7), length(fract(q).sub(0.5)).div(1.6)));
            const twG = pow(sin(u.uDustClock.mul(hq.mul(5.0).add(2.0)).add(hq.mul(40.0))).mul(0.5).add(0.5), 8.0);
            const frost = step(0.93, hq).mul(spotG).mul(twG).mul(snowM)
                .mul(prox.mul(0.5).add(0.5));
            const frostCol = mix(linearColor(0xEAF2FF), linearColor(0xFFE2A8), smoothstep(0.5, 2.0, prox));
            col = col.add(frostCol.mul(frost.mul(1.4)));
        }

        // Behind the card: the board backdrop value (#151B2C, L ≈ .011 — under the idle board-rect
        // mean ≤ .013 once the attenuated bloom is added), its light flattened to ±3 %.
        const calmFace = linearColor(0x151B2C).mul(light.sub(0.5).mul(0.06).add(1.0));
        col = mix(col, calmFace, calmU);

        // A wind-packed snow bank buries the base, higher on the windward left; in the stone's
        // own shadow it is sky-blue snow, its crest catching a little light.
        const bank = sin(p.x.mul(0.11).add(1.3)).mul(0.9).add(sin(p.x.mul(0.29).add(0.4)).mul(0.45));
        const driftH = bank.add(4.2).sub(p.x.mul(0.035));
        const buried = smoothstep(driftH.add(2.2), driftH.sub(1.0), p.y);
        const driftLit = mix(linearColor(0x4A5C94), linearColor(0x7F93C6), smoothstep(-3.0, 1.5, p.y.sub(driftH)));
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
        const sunProx = exp(acos(clamp(toSun, -1.0, 1.0)).div(0.12).negate());
        const calmU = phCalmBox(screenUV, u.uCalmUnion, 0.02, u.uAspect);
        // Fades into the snow bank at the base.
        const lift = smoothstep(4.0, 14.0, positionWorld.y);
        const outside = float(1.0).sub(calmU).mul(lift);
        const gain = sunProx.mul(6.0).add(0.01).mul(u.uRim).mul(outside);
        return linearColor(0xFFCF7A).mul(gain.mul(0.9));
    })();
    material.opacityNode = float(1.0);
    return material;
}

// ---------------------------------------------------------------------------------------
// Far stones: the small standing stones out on the plain (scale for the Vigil Stone)
// ---------------------------------------------------------------------------------------

/**
 * The far stones in contre-jour, like the Vigil Stone but small and far: dark rock lit by the
 * sky from above and the sides, a snow cap, a gold rim that burns toward the hidden sun, and
 * aerial perspective into the horizon haze. No calm logic: they stand in the side lanes.
 */
export function createFarStoneMaterial(u, tierIn) {
    const tier = resolveParhelionTier(tierIn);
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'parhelion-far-stones';
    material.fog = false;
    material.colorNode = Fn(() => {
        const p = positionWorld.toVar();
        const n = normalize(normalWorld).toVar();
        const toP = p.sub(cameraPosition);
        const dist = length(toP).toVar();
        const dir = toP.div(dist).toVar();
        const side = abs(n.x);
        const light = saturate(side.mul(side).mul(0.9).add(max(n.y, 0.0).mul(0.45)).add(0.08));
        let col = mix(linearColor(0x0B0F1A), linearColor(0x3A4874), light);
        col = mix(col, linearColor(0x7F93C8), smoothstep(0.5, 0.8, n.y).mul(0.85));
        const cA = dot(dir, vec3(...S_VEC)).toVar();
        const prox = exp(acos(clamp(cA, -1.0, 1.0)).div(0.25).negate()).mul(2.5).add(0.2);
        const edge = float(1.0).sub(saturate(dot(n, dir.negate())));
        col = col.add(linearColor(0xFFC978).mul(edge.mul(edge).mul(edge).mul(prox).mul(0.9)));
        // Aerial perspective into the horizon air (ph_fog over ph_haze, as the snow and the dome).
        const sw = pow(max(cA, 0.0), 4.0);
        const air = phFogFar(phHaze(dir, sw, u.uWarmth), sw, u.uWarmth);
        col = mix(col, air, smoothstep(200.0, 2600.0, dist).mul(0.75));
        return tier.post ? col : phTone(col);
    })();
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

        // Drifts: three oblique swells whose crests run ACROSS the view, so their slopes face the
        // camera (turned from the 9.5° sun: sky-blue shade) or the sun (lit, gold-white). The
        // slopes are analytic; each swell fades by its own screen frequency (k · footprint), so
        // the far field never shimmers and the plain flattens toward the horizon.
        const warp = macro.mul(2.0);
        // Drift height varies across the plain (wind-scoured flats between heavier drifts) and
        // along each crest, so the swells break into segments instead of long stripes.
        const crestRun = sin(dot(p.xz, vec2(0.96, -0.28)).mul(0.035).add(macro.mul(4.0))).mul(0.5).add(0.5);
        const drifty = field.mul(0.8).add(0.35).mul(mix(0.35, 1.25, crestRun));
        const w1 = dot(p.xz, vec2(0.26, 0.966)).mul(0.11).add(warp.mul(2.5));
        const w2 = dot(p.xz, vec2(-0.42, 0.907)).mul(0.19).add(warp.mul(1.5)).add(1.7);
        const w3 = dot(p.xz, vec2(0.09, 0.996)).mul(0.045).add(warp).add(0.6);
        const s1 = cos(w1).mul(float(1.0).sub(smoothstep(0.3, 1.0, fp.mul(0.11)))).mul(1.3 * 0.11).mul(drifty);
        const s2 = cos(w2).mul(float(1.0).sub(smoothstep(0.3, 1.0, fp.mul(0.19)))).mul(0.55 * 0.19).mul(drifty);
        const s3 = cos(w3).mul(float(1.0).sub(smoothstep(0.3, 1.0, fp.mul(0.045)))).mul(2.6 * 0.045);
        const dHdx = s1.mul(0.26).sub(s2.mul(0.42)).add(s3.mul(0.09));
        const dHdz = s1.mul(0.966).add(s2.mul(0.907)).add(s3.mul(0.996));
        const nS = normalize(vec3(dHdx.negate(), 1.0, dHdz.negate()));
        // Sun on the slope relative to flat snow (1 on the flat, 0 on a camera-facing slope
        // steeper than the sun), cut by the sastrugi lee shadows.
        const sunK = clamp(dot(nS, vec3(...S_VEC)).div(0.16505), 0.0, 1.7).mul(float(1.0).sub(lee.mul(0.9))).toVar();

        // Analytic stone shadow toward the camera (0 noise).
        const t = p.z.add(124.0).div(0.986286);
        const yq = t.mul(0.165047);
        const soft = t.mul(0.006).add(0.8);
        const hw = mix(u.uStoneHW.x, u.uStoneHW.z, clamp(yq.div(u.uStoneHW.w), 0.0, 1.0));
        const acrossShadow = float(1.0).sub(smoothstep(hw.sub(soft), hw.add(soft), abs(p.x)));
        const underTop = float(1.0).sub(smoothstep(u.uStoneHW.w.sub(soft), u.uStoneHW.w.add(soft), yq));
        const inShadow = acrossShadow.mul(underTop).mul(step(-124.0, p.z)).toVar();
        // The far stones' long shadows (one loop over the static row).
        const farShadow = float(0.0).toVar();
        Loop(FAR_STONES.length, ({ i }) => {
            farShadow.assign(max(farShadow, phFarShadow(p.xz, u.uFarStones.element(i), pixH)));
        });
        const sunHere = sunK.mul(float(1.0).sub(inShadow)).mul(float(1.0).sub(farShadow.mul(0.92))).toVar();

        // Lit snow: white, warming toward the sun's azimuth; forward-scatter glare near it.
        const flat = mix(linearColor(0xEDF1F8), linearColor(0xFFF2DE), sunward.mul(0.8));
        // Lower Sun: as the levels climb, the low light warms and spreads wider from the sun.
        const goldK = pow(toSun, mix(7.0, 3.5, u.uWarmth)).mul(u.uWarmth.mul(0.5).add(0.55));
        const golden = mix(flat, mix(linearColor(0xFFE0AE), linearColor(0xFFC890), u.uWarmth), goldK);
        const lit = golden.mul(macro.mul(0.1).add(0.95)).mul(stoss.mul(0.08).add(1.0));
        // Shade: sky-lit blue snow (the stone's shadow is the same snow, not a painted band).
        // Shade is sky-lit: it leans toward violet as the light lowers (Lower Sun).
        const shade = mix(linearColor(0x5C77B6), linearColor(0x7C93CC), macro.mul(0.6).add(stoss.mul(0.4)))
            .mul(mix(vec3(1.0), vec3(1.07, 0.94, 1.03), u.uWarmth));
        const snowCol = mix(shade, lit, min(sunHere, 1.0)).add(lit.mul(max(sunHere.sub(1.0), 0.0).mul(0.12)));
        const gold = linearColor(0xFFD39A).mul(crest.mul(fwd.mul(1.6).add(0.9)).mul(min(sunHere, 1.0)));
        const surf = phSoftCap(snowCol.add(gold), 0.85);
        const calmU = phCalmBox(screenUV, u.uCalmUnion, 0.02, u.uAspect);
        let col = mix(surf, linearColor(0x171D2F), calmU.mul(inShadow));

        // 3 — blowing snow: long thin streamers running with the wind, lifted off the surface, so
        //     they catch the low sun even over the shaded drift troughs (gold-white toward the sun,
        //     faint white away from it); only the Vigil Stone's own shadow puts them out.
        if (tier.snowEvals >= 2) {
            const wisp = noise2(vec2(along.mul(0.02).sub(u.uDriftPhase), across.mul(0.22).add(macro.mul(1.5))));
            const streamer = smoothstep(0.5, 0.92, wisp).mul(smoothstep(950.0, 140.0, dist));
            const backlit = pow(toSun, 8.0).mul(0.7).add(0.15);
            const blowCol = mix(linearColor(0xE2EAF8), linearColor(0xFFE6C2), pow(toSun, 6.0));
            col = col.add(blowCol.mul(streamer.mul(backlit).mul(float(1.0).sub(inShadow.mul(0.85)))));
        }

        // Aerial perspective into the horizon air — the ice fog over the shared haze, exactly the
        // dome's colour just under the horizon, so the seam never shows; a darker foreground strip.
        const sw = pow(toSun, 4.0);
        const air = phFogFar(phHaze(dir, sw, u.uWarmth), sw, u.uWarmth);
        col = mix(col, air, smoothstep(450.0, 2600.0, dist).mul(0.9).add(smoothstep(2600.0, 5000.0, dist).mul(0.1)));
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
            const visible = smoothstep(0.3, 0.8, sunHere).mul(float(1.0).sub(calmU));
            const glit = step(0.986, g).mul(spot).mul(tw.mul(near)).mul(visible);
            const aRing = acos(clamp(dot(dir, vec3(...S_VEC)), -1.0, 1.0)).sub(R22S).toVar();
            // The lower halo in the diamond dust over the snow: crystals glint along the 22° ring
            // below the horizon, red inside → white → ice-blue outside, closing the circle round
            // the stone. Its glints live on a grid in the RESTING eye's projected coordinates
            // (x / −z, eye height / −z), ≈ 3 buffer pixels a cell at any range yet fixed to the
            // ground, so they neither shimmer far out nor swim as the camera breathes.
            const gz = max(p.z.negate(), 1.0);
            const gq = vec2(p.x.div(gz), float(25.0).div(gz)).div(u.uPixAng.mul(3.0));
            const gc = floor(gq);
            const gh = hash21(gc.add(91.7));
            const gOff = vec2(hash21(gc.add(13.1)), hash21(gc.add(47.3))).mul(0.6).add(0.2);
            const gSpot = float(1.0).sub(smoothstep(0.25, 0.9, length(fract(gq).sub(gOff).mul(3.0))));
            const ringBand = exp(aRing.mul(aRing).div(0.00008).negate());
            const gTw = pow(sin(u.uDustClock.mul(gh.mul(4.0).add(1.5)).add(gh.mul(30.0))).mul(0.5).add(0.5), 4.0);
            const ringGlit = step(float(1.0).sub(ringBand.mul(0.55)), gh).mul(gSpot).mul(gTw.mul(0.8).add(0.2))
                .mul(ringBand)
                .mul(float(1.0).sub(calmU))
                .mul(smoothstep(0.1, 0.6, sunHere).mul(0.7).add(0.3));
            const ringCol = mix(
                mix(linearColor(0xFF7A55), linearColor(0xFFF4DC), smoothstep(-0.008, 0.0, aRing)),
                linearColor(0xA8CCF4),
                smoothstep(0.004, 0.012, aRing),
            );
            col = col.add(ringCol.mul(ringGlit.mul(2.6)));
            // Below-horizon ring flash (reactions; 0 at rest): the prism arc through the glitter.
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
