/**
 * Sunfall — the post stack: the light in the air, then bloom, tone and grade (one RenderPipeline).
 *
 * **The air** is one world-space integral per pixel along the eye's ray to the depth the
 * scene pass wrote (so the strands in front of the column cut it, and the column ends on the
 * canopy it lights):
 * - the chamber haze and the valley mist over the canopy in closed form (exponential height
 *   fog), lit by the cave's own light and, round the column, by its many-times-scattered glow;
 * - **the sunfall**: the column is the oculus projected along the sun, an oblique elliptic
 *   cylinder, so the ray's chord through it is a quadratic; the march runs inside the chord
 *   only (Simpson's rule on the lowest tiers), reading the same sun mask as every surface, so
 *   the ragged rim and the vine fringe draw the column's edge and its lengthwise streaks;
 * - **the cloud deck** under the vault in closed form at the ray's crossing of its slab, with
 *   the hole the sunfall burns through it and the gilded rim round the hole;
 * - the far doline's thin beam down the passage.
 * No screen-space rays: everything is integrated in the world.
 *
 * Then a knee bloom on the composite, the calm zones behind the card and HUD, exposure, a
 * hue-preserving filmic shoulder, a grade (teal in the shade, warm white in the light),
 * vignette, grain and dither, and the optional false-colour view.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    Loop,
    abs,
    clamp,
    convertToTexture,
    cross,
    dot,
    exp,
    float,
    floor,
    fract,
    getViewPosition,
    length,
    max,
    min,
    mix,
    pass,
    renderOutput,
    screenCoordinate,
    screenUV,
    select,
    sign,
    sin,
    smoothstep,
    sqrt,
    step,
    texture,
    uniform,
    uv,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { disposeBloomNodeDeep } from '../shared/bloom-dispose.js';
import { sceneSamples } from '../shared/scene-antialias.js';
import { resolveSunfallQuality } from './sunfall-quality.js';
import { flashScale } from '../../utils/photosensitivity.js';
import {
    CANOPY_LEVEL, DECK, FAR_DOLINE_CENTER, OCULUS_CENTER, OCULUS_RX, OCULUS_RZ, SUNFALL_LAYOUT,
} from './sunfall-core.js';
import {
    SUNFALL_LIGHT, sfCanopyHeight, sfNoise3, sfOculusCoord, sfPhase, sfSunMask,
} from './sunfall-tsl.js';

export const BLOOM_THRESHOLD = 1.1;
export const BLOOM_KNEE = 0.5;
export const CALM_RECTS_MAX = 5;

/** The air (starting values, tuned against playground captures). */
export const SUNFALL_AIR = Object.freeze({
    haze: 0.0010, // per metre, everywhere under the vault
    valley: 0.0036, // per metre at the canopy's top and below it, falling off upward
    valleyHeight: 24, // metres
    column: 0.0021, // the column's scattering density
    columnGain: 1.15, // art gain on the column's single scattering
    phaseG: 0.62,
    deckThickness: 0.035,
    farBeam: 0.0019,
});

/** The mist skin over the crowns at the column's foot (metres; density per metre at its heart). */
export const FOOT_MIST = Object.freeze({
    radius: 78, depth: 10, lift: 14, density: 0.0062, shade: 0.1,
});

/** The column's in-scatter tint over its light's colour: white-gold. */
const BEAM_WARM = vec3(1.0, 0.955, 0.86);

const sfMax3 = Fn(([v]) => max(v.x, max(v.y, v.z)));
const sfLuma = Fn(([v]) => dot(v, vec3(0.2126, 0.7152, 0.0722)));
const sfHash21 = Fn(([p]) => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453)));

const roundBoxSdf = Fn(([p, rect, radius]) => {
    const c = rect.xy.add(rect.zw).mul(0.5);
    const h = rect.zw.sub(rect.xy).mul(0.5);
    const q = abs(p.sub(c)).sub(h).add(radius);
    return length(max(q, vec2(0.0))).add(min(max(q.x, q.y), 0.0)).sub(radius);
});

/** Hue-preserving filmic shoulder on the largest channel, whitening only the hottest light. */
const sfFilmic = Fn(([cIn]) => {
    const c = max(cIn, vec3(0.0));
    const peak = max(sfMax3(c), 1e-5);
    const k = float(0.6);
    const shoulder = k.add(float(1.0).sub(k).mul(float(1.0).sub(exp(peak.sub(k).div(float(1.0).sub(k)).negate()))));
    const mapped = select(peak.greaterThan(k), shoulder, peak);
    const toned = c.mul(mapped.div(peak));
    const w = smoothstep(2.5, 9.0, peak).mul(0.8);
    return mix(toned, vec3(mapped, mapped, mapped), w);
});

export function resolveSunfallPostLook(quality = 'High') {
    const preset = resolveSunfallQuality(quality);
    return {
        tier: preset.tier,
        bloom: Boolean(preset.enableBloom),
        bloomStrength: preset.bloomStrength ?? 0.16,
        bloomRadius: preset.bloomRadius ?? 0.52,
        bloomResolution: preset.bloomDownsample ?? 0.5,
        fxaa: Boolean(preset.enableFXAA),
        msaa: sceneSamples(preset.tier),
        beamSamples: Math.max(0, Math.floor(preset.beamSamples ?? 8)),
    };
}

/**
 * The light in the air along each pixel's ray. Returns `{ node, uniforms }`: `node` builds
 * `vec4(in-scattered light, transmittance of what lies behind)` per pixel.
 */
export function createSunfallAir(u, depthNode, camera, { steps = 8 } = {}) {
    // The deck's march: six steps where the column is marched, four where it is not.
    const deckSteps = steps > 0 ? 6 : 4;
    const DECK_SWAY = 11.0;
    const projInv = uniform(camera.projectionMatrixInverse);
    const camWorld = uniform(camera.matrixWorld);
    const eye = uniform(u.eye || new THREE.Vector3());
    const on = { haze: uniform(1), beam: uniform(1), deck: uniform(1) };
    const OC = OCULUS_CENTER;
    const FD = FAR_DOLINE_CENTER;
    const FDR = SUNFALL_LAYOUT.farDoline.radii;

    /** The ray's chord through a skylight's oblique cylinder (radius `rho` in its radii). */
    const chord = (O, D, centre, radii, rho, limit) => {
        const S = u.sunDir;
        const sxz = S.xz.div(max(S.y, 0.15));
        const R = vec2(radii[0], radii[1]).mul(max(u.cloudHoleOpen, 0.2));
        const q0 = O.xz.add(sxz.mul(float(centre[1]).sub(O.y))).sub(vec2(centre[0], centre[2])).div(R);
        const q1 = D.xz.sub(sxz.mul(D.y)).div(R);
        const a = max(dot(q1, q1), 1e-8);
        const b = dot(q0, q1).mul(2.0);
        const c = dot(q0, q0).sub(rho * rho);
        const disc = b.mul(b).sub(a.mul(c).mul(4.0));
        const sq = sqrt(max(disc, 0.0));
        const t0 = max(b.negate().sub(sq).div(a.mul(2.0)), 0.0);
        const t1 = min(b.negate().add(sq).div(a.mul(2.0)), limit);
        const live = step(0.0, disc).mul(step(t0, t1));
        return { t0, t1, live };
    };

    /** The column's patchiness at `p`: humid air drifting through it (cells about 36 m). */
    const columnPatch = (p) => {
        const drift = vec3(u.time.mul(0.6), u.time.mul(-0.9), u.time.mul(0.35));
        return mix(0.45, 1.45, sfNoise3(u, p.add(drift).mul(0.028)).x);
    };

    /**
     * The column's scattering density at `p` (valley mist, humid air, patchiness). The deck's
     * crossing is integrated apart in closed form (`deckBand`): a 13 m layer sampled by steps
     * of 15–25 m drew a hard-edged, grainy band. No finer noise: the march cannot resolve it,
     * and sampled anyway it is a static grain over the whole column.
     */
    const columnDensity = (p) => {
        const valley = exp(max(p.y.sub(CANOPY_LEVEL - 4.0), 0.0).div(-30.0)).mul(3.0);
        // The column leaves the opening without a lid: its density fades in over the 30 m
        // below the oculus plane (seen from beneath, a cut there reads as a disc). Through the
        // gaps in the crowns it dies into the understory instead of lighting it white.
        const emerge = smoothstep(float(OC[1]), float(OC[1] - 30.0), p.y);
        const understory = smoothstep(float(CANOPY_LEVEL - 22.0), float(CANOPY_LEVEL + 6.0), p.y);
        return float(1.0).add(valley).mul(columnPatch(p))
            .mul(emerge)
            .mul(understory)
            .mul(u.mistScale);
    };

    /** The deck's two coarse billow scales at a plan point (features about 150 m and 50 m). */
    const deckDrift = () => vec2(u.time.mul(0.0011), u.time.mul(0.0007));
    const deckFields = (xz, lod = 1) => {
        const drift = deckDrift();
        const c1 = texture(u.fbmTex, xz.div(620.0).add(drift)).level(lod).x;
        // Pinned: the march reads it twice (shape and light); unpinned it is fetched twice.
        const c2 = texture(u.fbmTex, xz.div(210.0).sub(drift.mul(1.6))).level(lod).y.toVar();
        return { billow: c1.mul(0.58).add(c2.mul(0.42)), c2 };
    };

    /**
     * The deck's crossing of the column: ∫ exp(-((y(t) - mid) / σ)²) dt over the chord, in
     * closed form (Winitzki's erf), times what the column holds where the ray meets the deck.
     */
    const DECK_MID = (DECK.bottom + DECK.top) * 0.5;
    const DECK_SIGMA = 13.0;
    const erfApprox = (x) => {
        const x2 = x.mul(x);
        const g = x2.mul(float(4 / Math.PI).add(x2.mul(0.147))).div(x2.mul(0.147).add(1.0));
        return sign(x).mul(sqrt(max(float(1.0).sub(exp(g.negate())), 0.0)));
    };
    const deckBand = (O, D, t0, t1) => {
        const a0 = O.y.add(D.y.mul(t0)).sub(DECK_MID).div(DECK_SIGMA).toVar();
        const a1 = O.y.add(D.y.mul(t1)).sub(DECK_MID).div(DECK_SIGMA).toVar();
        const dy = select(abs(D.y).greaterThan(1e-6), D.y, float(1e-6));
        const steep = erfApprox(a1).sub(erfApprox(a0)).mul(DECK_SIGMA * 0.8862269).div(dy);
        const amid = a0.add(a1).mul(0.5);
        const level = t1.sub(t0).mul(exp(amid.mul(amid).negate()));
        return select(abs(a1.sub(a0)).greaterThan(0.02), max(steep, 0.0), level).mul(2.2);
    };

    const node = Fn(() => {
        const depth = depthNode.sample(screenUV).x;
        const viewPos = getViewPosition(screenUV, depth, projInv);
        const P = camWorld.mul(vec4(viewPos, 1.0)).xyz.toVar();
        const O = vec3(eye).toVar();
        const toP = P.sub(O);
        const tMax = max(length(toP), 0.1).toVar();
        const D = toP.div(tMax).toVar();

        // ── Haze and valley mist (closed form) ──
        // Haze everywhere under the vault; the valley mist is densest at the canopy's top and
        // stays at that density below it (exp(-max(y - yv, 0) / H)), integrated piecewise.
        const caveTop = float(OC[1] + 4.0);
        const tCave = select(D.y.greaterThan(1e-4), min(tMax, caveTop.sub(O.y).div(D.y)), tMax).toVar();
        const H = float(SUNFALL_AIR.valleyHeight);
        const yv = float(CANOPY_LEVEL - 2.0);
        const above = max(O.y.sub(yv), 0.0);
        const k = D.y.div(H).toVar();
        const e0 = exp(above.div(H).negate());
        const tCross = select(D.y.lessThan(-1e-4), above.div(D.y.negate()), float(1e6));
        const tA = min(tCross, tCave);
        const expPart = select(
            abs(k).greaterThan(1e-5),
            e0.mul(float(1.0).sub(exp(clamp(k.mul(tA), -40.0, 40.0).negate()))).div(k),
            e0.mul(tA),
        );
        const flatPart = max(tCave.sub(tCross), 0.0);
        // Above the canopy's top the mist is lit by the cave; under the crowns it is dark.
        const tauLit = float(SUNFALL_AIR.haze).mul(tCave).add(float(SUNFALL_AIR.valley).mul(max(expPart, 0.0)))
            .mul(u.mistScale)
            .mul(on.haze)
            .toVar();
        const tauDark = float(SUNFALL_AIR.valley).mul(flatPart).mul(u.mistScale).mul(on.haze)
            .toVar();
        const tau = tauLit.add(tauDark).toVar();
        const Tr = exp(tau.negate()).toVar();
        const TrLit = exp(tauLit.negate()).toVar();
        const sigmaAvg = tau.div(max(tMax, 1.0)).toVar();

        // The haze's own light: the cave's ambient, and the column's scattered glow round it.
        const S = u.sunDir;
        const A = vec3(OC[0], OC[1], OC[2]);
        const n = cross(D, S);
        const nl = max(length(n), 1e-4);
        const axisDist = abs(dot(A.sub(O), n)).div(nl);
        // The glow: haze lit round the column with a Gaussian profile about its axis, integrated
        // along the ray in closed form (sqrt(2π)·σ / sin θ through the axis), only in front of
        // what the ray hits and above the canopy's top.
        const SG = 38.0;
        const sinT = max(nl, 0.2);
        const w0 = O.sub(A);
        const b = dot(D, S);
        const tClose = b.mul(dot(S, w0)).sub(dot(D, w0)).div(max(float(1.0).sub(b.mul(b)), 1e-3));
        // Cut at the crowns' tops round the foot (the breakdown cone lifts them above the
        // valley's level): the glow never lights the dark under the canopy.
        const yCut = u.foot.y.add(18.0);
        const tCut = select(D.y.lessThan(-1e-4), max(O.y.sub(yCut), 0.0).div(D.y.negate()), float(1e6));
        const tEnd = min(min(tMax, tCross), tCut);
        const span = float(SG).div(sinT);
        const visible = smoothstep(-1.6, 1.6, tEnd.sub(tClose).div(span)).mul(smoothstep(-1.6, 1.6, tClose.div(span)));
        const profile = exp(axisDist.mul(axisDist).div(-2.0 * SG * SG));
        const glowOd = span.mul(2.5066 * SUNFALL_AIR.haze * 2.4).mul(profile).mul(visible).mul(u.mistScale);
        const glowIn = mix(u.beamScatter, u.poolSun, 0.12).mul(float(1.0).sub(exp(glowOd.negate())))
            .mul(u.sunGain).mul(1.25)
            .mul(on.haze);
        // The cave's own light in the haze, warmer within a few hundred metres of the column.
        // The air low in the chamber and down the passage holds the canopy's and the far
        // doline's light (luminous teal-green depth behind the card); toward the vault it is
        // dimmer, so the vault keeps its own light instead of a grey veil.
        // The valley mist over the crowns keeps a deep blue-green of its own (lit as brightly as
        // the chamber's air, it laid one flat grey veil over the whole forest).
        const farGlow = exp(axisDist.mul(axisDist).div(-2.0 * 280.0 * 280.0)).mul(u.sunGain);
        const lowAir = float(1.0).sub(smoothstep(-0.05, 0.32, D.y).mul(0.6));
        const mistLuma = sfLuma(u.mistTint).toVar();
        const tealAir = max(mix(vec3(mistLuma, mistLuma, mistLuma), u.mistTint, 1.55), vec3(0.0)).toVar();
        const airLight = tealAir.mul(0.11).mul(lowAir).mul(float(1.0).add(u.echoBoost.mul(0.2)))
            .add(mix(u.beamScatter, u.mistTint, 0.45).mul(farGlow.mul(0.075)));
        const valleyLight = tealAir.mul(vec3(0.030, 0.040, 0.042))
            .add(mix(u.beamScatter, u.mistTint, 0.45).mul(farGlow.mul(0.03)));
        const tauAir = float(SUNFALL_AIR.haze).mul(tCave).mul(u.mistScale).mul(on.haze);
        const airShare = clamp(tauAir.div(max(tauLit, 1e-6)), 0.0, 1.0);
        const hazeLight = mix(valleyLight, airLight, airShare);
        const hazeIn = hazeLight.mul(float(1.0).sub(TrLit).add(TrLit.sub(Tr).mul(0.12))).add(glowIn).toVar();

        // ── The cloud deck: banks under the vault, marched through its slab ──
        // Seen from the ledge the deck is a grazing slab: a ray runs up to 300 m through it. Only
        // the two coarse billow scales (features about 150 m and 50 m) are read per step, at a
        // fixed count per tier (a count that changed from pixel to pixel drew contour lines); the
        // fine scale is read once, where the ray enters, as light on the cloud's face. Read per
        // step at 65 m spacing, an 18 m scale combed every bank into horizontal brush strokes.
        // Each bank hangs at its own height (a slow field lifts the slab's middle by ±11 m), so
        // the banks' bases do not all sit on one ruled line.
        const deckAlpha = float(0.0).toVar();
        const deckLight = vec3(0.0).toVar();
        const tDeck = float(1e6).toVar();
        If(D.y.greaterThan(0.004).and(on.deck.greaterThan(0.5)), () => {
            const tb = float(DECK.bottom - DECK_SWAY).sub(O.y).div(D.y);
            const tt = float(DECK.top + DECK_SWAY).sub(O.y).div(D.y);
            const tIn = max(tb, 0.0).toVar();
            const tOut = min(min(tt, tMax), tIn.add(300.0)).toVar();
            If(tOut.greaterThan(tIn), () => {
                const pm = O.add(D.mul(tIn.add(tOut).mul(0.5))).toVar();
                tDeck.assign(tIn);
                const ch = SUNFALL_LAYOUT.chamber;
                const plan = length(pm.xz.sub(vec2(ch.center[0], ch.center[1])).div(vec2(ch.radii[0], ch.radii[1])));
                const hd = length(pm.xz.sub(O.xz));
                const region = smoothstep(150.0, 320.0, hd).mul(float(1.0).sub(smoothstep(0.7, 0.95, plan))).toVar();
                // The banks gather toward the oculus (the cave breathes out through it) and thin
                // away from it, so the vault shows over most of the chamber.
                const toOc = length(pm.xz.sub(vec2(OC[0], OC[2])));
                const drawn = mix(0.55, 1.12, exp(toOc.mul(toOc).div(-260.0 * 260.0)));
                const cover = clamp(
                    u.cloudOpacity.mul(u.cloudFloor).mul(drawn).add(u.overCloudClose.mul(0.6)),
                    0.12,
                    1.0,
                )
                    .toVar();
                // The hole the sunfall burns, and its gilded rim, at the slab's middle: a soft oval
                // a little wider than the column, its edge frayed by the deck's own billows. (Cut
                // with the sun mask, the rim's crumbs and the vines' spikes, read once per pixel
                // across a grazing slab, rippled into stacked contour lines.)
                const q = sfOculusCoord(u, pm);
                const rq = length(q.div(max(u.cloudHoleOpen, 0.2))).toVar();
                const fray = deckFields(pm.xz, 2.5).billow.sub(0.5).mul(0.3);
                const hole = float(1.0).sub(smoothstep(0.86, 1.3, rq.div(1.12).add(fray))).toVar();
                // The gold falls off smoothly outward from the hole's edge, where the column lights the cloud.
                const gilt = exp(max(rq.div(1.12).sub(1.0), 0.0).mul(-3.2)).mul(float(1.0).sub(hole)).toVar();
                const open = float(1.0).sub(hole.mul(float(1.0).sub(u.overCloudClose.mul(0.9)))).toVar();
                const toFoot = pm.xz.sub(u.foot.xz);
                const bounce = exp(dot(toFoot, toFoot).div(-300.0 * 300.0)).mul(u.sunGain).toVar();
                // The column's own light on the cloud round it (a line light: 1/d off its axis).
                const axisOff = length(q.mul(vec2(OCULUS_RX, OCULUS_RZ)));
                const colLit = float(70.0).div(max(axisOff, 70.0)).mul(u.sunGain).toVar();
                const drift = deckDrift();
                // The face's grain where the ray enters the slab: light only, blurred (read sharp
                // on a grazing plane it is squashed into stacked ripples).
                const pIn = O.add(D.mul(tIn));
                const face = texture(u.fbmTex, pIn.xz.div(74.0).add(drift.mul(2.3))).level(2).x.toVar();
                const ds = tOut.sub(tIn).div(deckSteps).toVar();
                const trans = float(1.0).toVar();
                Loop({
                    start: 0, end: deckSteps, type: 'int', condition: '<', name: 'dk',
                }, ({ dk }) => {
                    const p = O.add(D.mul(tIn.add(float(dk).add(0.5).mul(ds))));
                    const lift = texture(u.fbmTex, p.xz.div(900.0).sub(drift.mul(0.5))).level(2).z;
                    const mid = lift.sub(0.5).mul(DECK_SWAY * 2.0).add((DECK.bottom + DECK.top) * 0.5);
                    const half = (DECK.top - DECK.bottom) * 0.5;
                    const yy = p.y.sub(mid).div(half);
                    const slab = clamp(float(1.0).sub(yy.mul(yy)), 0.0, 1.0);
                    const fields = deckFields(p.xz);
                    const { c2 } = fields;
                    const billow = fields.billow.add(slab.sub(0.6).mul(0.22));
                    // Banks with gaps between them, so the vault shows through.
                    const dens = smoothstep(float(0.62).sub(cover.mul(0.3)), 0.9, billow)
                        .mul(slab).mul(region).mul(open);
                    const a = float(1.0).sub(exp(dens.mul(SUNFALL_AIR.deckThickness).mul(ds).negate()));
                    // Lit from below by the canopy's bounce and the column, pearl from the cave's
                    // light; the bases brightest (the light comes from under them), gold at the rim.
                    const height = clamp(yy.mul(0.5).add(0.5), 0.0, 1.0);
                    const warm = mix(u.poolSun, vec3(1.0, 0.86, 0.6), 0.55);
                    const under = warm.mul(bounce.mul(0.34).add(colLit.mul(0.26)))
                        .add(u.mistTint.mul(0.15)).add(vec3(0.06, 0.066, 0.068))
                        .mul(mix(1.12, 0.62, height))
                        .mul(mix(0.78, 1.18, c2))
                        .mul(mix(0.85, 1.15, face));
                    const gold = vec3(1.0, 0.8, 0.5)
                        .mul(gilt.mul(smoothstep(0.3, 0.8, billow)).mul(SUNFALL_LIGHT.sun * 0.13)).mul(u.sunGain);
                    deckLight.addAssign(under.add(gold).mul(a).mul(trans));
                    trans.mulAssign(float(1.0).sub(a));
                });
                deckAlpha.assign(float(1.0).sub(trans));
                deckLight.mulAssign(exp(sigmaAvg.mul(tIn).negate()));
            });
        });

        // ── The sunfall: the chord through the oblique cylinder, marched inside ──
        const climb = select(D.y.greaterThan(1e-4), float(OC[1] + 1.0).sub(O.y).div(D.y), float(1e6));
        const limit = min(tMax, climb);
        const col = chord(O, D, OC, [OCULUS_RX, OCULUS_RZ], 1.24, limit);
        const beam = vec3(0.0).toVar();
        const phase = sfPhase(dot(D, S), float(SUNFALL_AIR.phaseG)).toVar();
        const t0 = col.t0.toVar();
        const t1 = col.t1.toVar();
        If(col.live.mul(on.beam).greaterThan(0.5), () => {
            const L = t1.sub(t0).toVar();
            const sum = float(0.0).toVar();
            // The deck's crossing, in closed form, where the ray is nearest the deck's middle.
            const tc = select(
                abs(D.y).greaterThan(1e-4),
                clamp(float(DECK_MID).sub(O.y).div(D.y), t0, t1),
                t0.add(t1).mul(0.5),
            ).toVar();
            const pc = O.add(D.mul(tc)).toVar();
            const atDeck = select(tc.greaterThan(tDeck), float(1.0).sub(deckAlpha), float(1.0));
            // Inside the column the deck is burned to wisps: its own billows, lit (an even layer
            // there, seen from below through the column's oval, read as a flat glowing plate).
            // Read blurred: one point on a grazing plane per pixel squashes the billows into ripples.
            const wisps = mix(0.18, 1.7, smoothstep(0.36, 0.84, deckFields(pc.xz, 2.5).billow)).mul(on.deck);
            sum.assign(deckBand(O, D, t0, t1).mul(wisps).mul(sfSunMask(u, pc)).mul(columnPatch(pc))
                .mul(u.mistScale)
                .mul(exp(sigmaAvg.mul(tc).negate()))
                .mul(atDeck));
            if (steps > 0) {
                const tauC = float(0.0).toVar();
                const dt = L.div(steps).toVar();
                // The stretch of the sun mask one step covers (the ray is a line in the mask).
                const sxz = S.xz.div(max(S.y, 0.15));
                const dq = D.xz.sub(sxz.mul(D.y)).div(vec2(OCULUS_RX, OCULUS_RZ)).mul(dt).toVar();
                // Interleaved gradient noise: a static jitter of each pixel's first step.
                const ign = fract(dot(floor(screenCoordinate.xy), vec2(0.06711056, 0.00583715)));
                const jitter = fract(float(52.9829189).mul(ign));
                Loop({
                    start: 0, end: steps, type: 'int', condition: '<', name: 'bm',
                }, ({ bm }) => {
                    const t = t0.add(float(bm).add(jitter).mul(dt)).toVar();
                    const p = O.add(D.mul(t)).toVar();
                    // The crowns stop the sun: under the canopy's top the column is dark.
                    const below = smoothstep(-1.0, 3.0, sfCanopyHeight(u, p.xz).sub(p.y));
                    const dens = columnDensity(p).mul(sfSunMask(u, p, dq)).mul(float(1.0).sub(below.mul(0.92))).toVar();
                    const behindDeck = select(t.greaterThan(tDeck), float(1.0).sub(deckAlpha), float(1.0));
                    const trans = exp(sigmaAvg.mul(t).add(tauC).negate());
                    sum.addAssign(dens.mul(trans).mul(behindDeck).mul(dt));
                    tauC.addAssign(dens.mul(dt).mul(SUNFALL_AIR.column * 0.6));
                });
            } else {
                // Simpson's rule over the chord (three taps): the base of the column on every tier.
                const tap = (t) => {
                    const p = O.add(D.mul(t));
                    const below = smoothstep(-1.0, 3.0, sfCanopyHeight(u, p.xz).sub(p.y));
                    return sfSunMask(u, p).mul(columnDensity(p)).mul(exp(sigmaAvg.mul(t).negate()))
                        .mul(float(1.0).sub(below.mul(0.92)));
                };
                const tm = t0.add(t1).mul(0.5);
                sum.addAssign(tap(t0).add(tap(tm).mul(4.0)).add(tap(t1)).div(6.0)
                    .mul(L));
            }
            // Sunlight in humid air: white-gold, a touch warmer than the light it lands as.
            beam.assign(u.beamScatter.mul(BEAM_WARM).mul(sum).mul(SUNFALL_AIR.column * SUNFALL_AIR.columnGain)
                .mul(phase)
                .mul(SUNFALL_LIGHT.sun * 4.0 * Math.PI)
                .mul(u.sunGain));
        });

        // ── The pool's mist: a skin of valley mist over the sunlit crowns at the foot ──
        // An anisotropic Gaussian (about 80 m across, 10 m deep) integrated along the ray in
        // closed form up to what it hits: incandescent where the sun reaches it (read from the
        // same mask, so it is dappled by the same boughs), a soft glow round that.
        const F = u.foot.add(vec3(0.0, FOOT_MIST.lift, 0.0));
        const MS = vec3(1 / FOOT_MIST.radius, 1 / FOOT_MIST.depth, 1 / FOOT_MIST.radius);
        const o1 = O.sub(F).mul(MS);
        const d1 = D.mul(MS);
        const qa = max(dot(d1, d1), 1e-8);
        const qb = dot(o1, d1);
        const sa = sqrt(qa).toVar();
        const tm = qb.negate().div(qa).toVar();
        const peak = exp(min(qb.mul(qb).div(qa).sub(dot(o1, o1)), 0.0));
        const run = erfApprox(sa.mul(tMax.sub(tm))).sub(erfApprox(sa.mul(tm).negate())).mul(0.8862269).div(sa);
        const mistOd = max(peak.mul(run), 0.0).mul(FOOT_MIST.density).mul(on.beam).toVar();
        const footMist = vec3(0.0).toVar();
        // Only rays that pass through the mist read the sun mask (most of the frame does not).
        If(mistOd.greaterThan(1e-5), () => {
            const pMist = O.add(D.mul(clamp(tm, 0.0, tMax)));
            // In the sun white-gold; out of it, the faint green of the crowns' own bounce.
            const sunOn = sfSunMask(u, pMist).toVar();
            const lit = mix(u.poolSun, u.beamScatter.mul(BEAM_WARM), 0.62);
            const mistTone = mix(u.poolSun.mul(vec3(0.45, 0.8, 0.55)), lit, sunOn);
            footMist.assign(mistTone.mul(mistOd)
                .mul(mix(FOOT_MIST.shade, 1.0, sunOn))
                .mul(exp(sigmaAvg.mul(clamp(tm, 0.0, tMax)).negate()))
                .mul(phase.mul(SUNFALL_LIGHT.sun * 4.0 * Math.PI))
                .mul(u.sunGain)
                .mul(u.mistScale));
        });

        // ── The far doline's thin beam (closed form) ──
        // A Gaussian column about its axis (a broad body and a brighter heart), integrated
        // across the ray: √π·σ / sin θ. The chord through a hard cylinder drew a white rod.
        const FA = vec3(FD[0], FD[1], FD[2]);
        const farR = Math.min(FDR[0], FDR[1]) * 0.82;
        const wF = O.sub(FA);
        const tFar = b.mul(dot(S, wF)).sub(dot(D, wF)).div(max(float(1.0).sub(b.mul(b)), 1e-3)).toVar();
        const yFar = O.y.add(D.y.mul(tFar));
        const farOff = abs(dot(FA.sub(O), n)).div(nl).toVar();
        const farBody = exp(farOff.mul(farOff).div(-(farR * 0.8) * (farR * 0.8)));
        const farHeart = exp(farOff.mul(farOff).div(-(farR * 0.32) * (farR * 0.32)));
        const farPath = float(farR * 0.8 * 1.7725).div(sinT);
        // Only in front of what the ray meets, below the doline's roof and above the passage floor.
        const farSpan = smoothstep(-25.0, 25.0, tMax.sub(tFar))
            .mul(smoothstep(-160.0, 40.0, yFar))
            .mul(float(1.0).sub(smoothstep(float(FD[1] - 26.0), float(FD[1] + 4.0), yFar)));
        const farLight = u.beamCore.mul(BEAM_WARM)
            .mul(farBody.add(farHeart.mul(0.9)).mul(farPath).mul(SUNFALL_AIR.farBeam * 1.3))
            .mul(farSpan)
            .mul(exp(sigmaAvg.mul(max(tFar, 0.0)).negate()))
            .mul(phase.mul(4.0 * Math.PI).mul(SUNFALL_LIGHT.sun * 0.5).mul(float(1.0).add(u.echoBoost.mul(2.5))))
            .mul(on.beam);

        // What lies behind the deck is covered by it.
        const behind = select(tMax.greaterThan(tDeck), float(1.0).sub(deckAlpha), float(1.0));
        const inscatter = hazeIn.mul(behind).add(deckLight).add(beam).add(farLight)
            .add(footMist);
        return vec4(inscatter, Tr.mul(behind));
    });
    return {
        node,
        uniforms: {
            projInv, camWorld, eye, on,
        },
    };
}

export class SunfallPost {
    constructor(renderer, scene, camera, params = {}) {
        const look = params.look || resolveSunfallPostLook(params.quality || 'High');
        const { u } = params;
        this.renderer = renderer;
        this.camera = camera;
        this.look = look;
        this.u = u;
        this.samples = params.samples ?? look.msaa ?? 0;
        this.pipeline = new THREE.RenderPipeline(renderer);
        this.scenePass = pass(scene, camera, { samples: this.samples });
        const sceneColor = this.scenePass.getTextureNode('output');
        const sceneDepth = this.scenePass.getTextureNode('depth');

        this.uAspect = uniform(16 / 9);
        this.uSrcTexel = uniform(new THREE.Vector2(1 / 1920, 1 / 1080));
        this.uViewport = uniform(new THREE.Vector2(1920, 1080));
        this.uTime = uniform(0);
        this.uExposure = uniform(1.0);
        this.uBloomBoost = uniform(0);
        this.uFlash = uniform(0);
        this.uFlashColour = uniform(new THREE.Vector3(1.0, 0.95, 0.80));
        this.uSaturation = uniform(1.06);
        this.calmRects = Array.from({ length: CALM_RECTS_MAX }, () => new THREE.Vector4(0, 0, 0, 0));
        this.uCalm = this.calmRects.map((v) => uniform(v));
        this.uCalmStrength = uniform(0);

        // The scene and the light in the air, composited once into an HDR target.
        this.air = u ? createSunfallAir(u, sceneDepth, camera, { steps: params.steps ?? look.beamSamples }) : null;
        const airNode = this.air ? this.air.node() : null;
        const composite = Fn(() => {
            const lit = vec3(sceneColor.sample(screenUV).rgb);
            if (!airNode) return vec4(lit, 1.0);
            // Pinned once: two swizzles of an inline call would emit the whole integral twice.
            const air = airNode.toVar();
            return vec4(lit.mul(air.w).add(air.xyz), 1.0);
        });
        this.compositeNode = composite();
        this.hdr = convertToTexture(this.compositeNode);

        this.bloomNode = null;
        if (look.bloom && params.bloom !== false) {
            this.bloomNode = bloom(this.hdr, look.bloomStrength, look.bloomRadius, BLOOM_THRESHOLD);
            this.bloomNode.smoothWidth.value = BLOOM_KNEE;
            this.bloomNode.setResolutionScale(look.bloomResolution);
            const { uSrcTexel } = this;
            this.bloomNode.highPassFn = Fn(({ input, threshold, smoothWidth }) => {
                const st = uv();
                const o = uSrcTexel.mul(1.25);
                const tapB = (dx, dy) => {
                    const c = max(vec3(input.sample(st.add(vec2(o.x.mul(dx), o.y.mul(dy)))).rgb), vec3(0.0));
                    return c.mul(min(float(1.0), float(4.0).div(max(sfMax3(c), 1e-4))));
                };
                const c = tapB(1, 1).add(tapB(-1, 1)).add(tapB(1, -1)).add(tapB(-1, -1))
                    .mul(0.25);
                const br = sfMax3(c);
                const soft = clamp(br.sub(threshold).add(smoothWidth), 0.0, smoothWidth.mul(2.0));
                const w = max(soft.mul(soft).div(smoothWidth.mul(4.0).add(1e-4)), br.sub(threshold)).div(max(br, 1e-4));
                return vec4(c.mul(w), 1.0);
            });
        }

        const falseColor = params.falseColor === true;
        const outputFn = Fn(() => {
            const px = screenUV.mul(this.uViewport);
            const hScale = this.uViewport.y.div(1080.0);
            const calm = float(0.0).toVar();
            for (let i = 0; i < CALM_RECTS_MAX; i += 1) {
                const r = this.uCalm[i];
                const sdf = roundBoxSdf(px, r.mul(vec4(this.uViewport, this.uViewport)), hScale.mul(16.0));
                const inside = float(1.0).sub(smoothstep(-20.0, 6.0, sdf)).mul(step(0.001, r.z.sub(r.x)));
                calm.assign(max(calm, inside));
            }
            calm.mulAssign(this.uCalmStrength);

            const H0 = vec3(this.hdr.sample(screenUV).rgb).toVar();
            const m = max(sfMax3(H0), 1e-5);
            const clipped = H0.mul(min(m, min(float(0.22).add(m.mul(0.10)), 0.55)).div(m));
            H0.assign(mix(H0, clipped, calm.mul(0.82)));
            const glare = vec3(0.0).toVar();
            if (this.bloomNode) {
                const Bl = vec3(this.bloomNode.getTextureNode().sample(screenUV).rgb);
                glare.assign(Bl.mul(float(1.0).add(this.uBloomBoost.mul(0.75))));
            }
            glare.mulAssign(float(1.0).sub(calm.mul(0.85)));
            const H = H0.add(glare).toVar();
            // The event flash is mostly a lift of exposure (the light brightens, the dark stays
            // dark), with only a little added veil: a held zenith never greys the whole frame.
            const flashOn = this.uFlash.mul(float(1.0).sub(calm.mul(0.8)));
            const flash = this.uFlashColour.mul(flashOn.mul(0.05));
            const X = H.mul(this.uExposure.mul(flashOn.mul(0.9).add(1.0))).add(flash);
            const T = sfFilmic(X).toVar();

            // Grade: a little vibrance, teal shade, warm white light; contrast on 0..1 only.
            const sat = max(sfMax3(T).sub(min(T.x, min(T.y, T.z))), 0.0).div(max(sfMax3(T), 1e-4));
            const vib = mix(this.uSaturation, float(1.0), sat);
            T.assign(max(mix(vec3(sfLuma(T)), T, vib), vec3(0.0)));
            const lum = sfLuma(T);
            const shadeTint = mix(vec3(0.94, 1.02, 1.04), vec3(1.0), smoothstep(0.0, 0.25, lum));
            const lightTint = mix(vec3(1.0), vec3(1.03, 1.0, 0.95), smoothstep(0.45, 0.95, lum));
            T.assign(T.mul(shadeTint).mul(lightTint));
            const C = clamp(T, 0.0, 1.0);
            T.assign(mix(C, C.mul(C).mul(float(3.0).sub(C.mul(2.0))), 0.34));

            const cv = screenUV.sub(0.5).mul(vec2(this.uAspect.div(1.778), 1.0));
            const vig = smoothstep(0.55, 1.25, length(cv.mul(1.38)));
            T.mulAssign(float(1.0).sub(vig.mul(0.22)));

            const Dsp = vec3(renderOutput(vec4(clamp(T, 0.0, 1.0), 1.0), THREE.NoToneMapping).rgb).toVar();
            const pxi = floor(screenCoordinate);
            const frame = floor(this.uTime.mul(24.0));
            const grain = sfHash21(pxi.add(vec2(frame.mul(1.7), frame.mul(-2.3)))).sub(0.5);
            Dsp.addAssign(grain.mul(0.008).mul(float(1.0).sub(calm.mul(0.7))));
            const dth = sfHash21(pxi).add(sfHash21(pxi.add(vec2(17.17, 17.17)))).sub(1.0);
            Dsp.addAssign(dth.div(255.0));

            let out = vec4(clamp(Dsp, 0.0, 1.0), 1.0);
            if (falseColor) {
                const mx = sfMax3(H.mul(this.uExposure));
                const fc = select(mx.lessThan(0.1), vec3(0.05, 0.1, 0.6), select(
                    mx.lessThan(0.6),
                    vec3(0.1, 0.55, 0.15),
                    select(mx.lessThan(1.0), vec3(0.85, 0.8, 0.1), select(
                        mx.lessThan(2.5),
                        vec3(1.0, 0.45, 0.05),
                        vec3(0.95, 0.05, 0.05),
                    )),
                ));
                out = vec4(fc, 1.0);
            }
            return out;
        });

        this.pipeline.outputColorTransform = false;
        const smoothPass = look.fxaa && this.samples === 0 && params.antialias !== false && !falseColor;
        this.fxaaNode = smoothPass ? fxaa(outputFn()) : null;
        this.pipeline.outputNode = this.fxaaNode || outputFn();
        this.pipeline.needsUpdate = true;
        if (params.parts) this.setAirPartsFromList(params.parts);
    }

    /** The air's terms from a part list: the column with `beam`, the deck with `mist`, haze with either. */
    setAirPartsFromList(parts) {
        const list = Array.isArray(parts) ? parts : String(parts).split(',').map((p) => p.trim());
        this.setAirParts({
            haze: list.includes('mist') || list.includes('beam'),
            beam: list.includes('beam'),
            deck: list.includes('mist'),
        });
    }

    /** Which parts of the air to integrate (the playground's `parts=` filter). */
    setAirParts({ haze = true, beam = true, deck = true } = {}) {
        if (!this.air) return;
        this.air.uniforms.on.haze.value = haze ? 1 : 0;
        this.air.uniforms.on.beam.value = beam ? 1 : 0;
        this.air.uniforms.on.deck.value = deck ? 1 : 0;
    }

    update({
        exposure, bloomBoost, flash, flashColour, saturation, time,
    } = {}) {
        if (exposure !== undefined) this.uExposure.value = exposure;
        if (bloomBoost !== undefined) this.uBloomBoost.value = bloomBoost;
        if (flash !== undefined) this.uFlash.value = flash * flashScale();
        if (flashColour) this.uFlashColour.value.set(flashColour[0], flashColour[1], flashColour[2]);
        if (saturation !== undefined) this.uSaturation.value = saturation;
        if (time !== undefined) this.uTime.value = time;
        if (this.bloomNode && exposure !== undefined) {
            this.bloomNode.threshold.value = BLOOM_THRESHOLD / Math.max(0.2, exposure);
        }
    }

    setCalmRects(rects, strength) {
        for (let i = 0; i < CALM_RECTS_MAX; i += 1) {
            const r = rects?.[i];
            if (r) this.calmRects[i].set(r.x0, r.y0, r.x1, r.y1);
            else this.calmRects[i].set(0, 0, 0, 0);
        }
        this.uCalmStrength.value = strength;
    }

    setSize(width, height, bufferWidth = width, bufferHeight = height) {
        if (width > 0 && height > 0) this.uAspect.value = width / height;
        if (bufferWidth > 0 && bufferHeight > 0) {
            this.uSrcTexel.value.set(1 / bufferWidth, 1 / bufferHeight);
            this.uViewport.value.set(bufferWidth, bufferHeight);
        }
    }

    render() {
        this.pipeline.render();
    }

    dispose() {
        this.scenePass?.dispose();
        if (this.bloomNode) disposeBloomNodeDeep(this.bloomNode);
        this.hdr?.dispose?.();
        this.fxaaNode?.textureNode?.dispose?.();
        this.pipeline?.dispose();
        this.scenePass = null;
        this.bloomNode = null;
        this.fxaaNode = null;
        this.pipeline = null;
    }
}

export function createPassThroughPipeline(renderer, scene, camera) {
    const pipeline = new THREE.RenderPipeline(renderer);
    const scenePass = pass(scene, camera, { samples: 0 });
    pipeline.outputNode = scenePass;
    return {
        render: () => pipeline.render(),
        update() {},
        setCalmRects() {},
        setSize() {},
        setAirParts() {},
        dispose() {
            scenePass.dispose();
            pipeline.dispose();
        },
    };
}
