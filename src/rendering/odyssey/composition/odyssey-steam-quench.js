/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * THE STEAM QUENCH — the Chapter 1 -> Act II occlusion moment.
 *
 * The plan asks for the two surviving act edges to become OCCLUSION moments rather than alpha
 * crossfades: "fog as a traversable object, not a post effect". This is the ch1->ch2 one, and
 * the journey already argues for it in two independent places. The chapter profile authors the
 * transition as `stinger: 'steam-quench'` with a deliberately widened seam so "the ember->steam
 * veils and the orange->cyan transformation play across multiple frames instead of popping".
 * And the geometry agrees: Earth Core is a molten cavern, while the rail enters Act II at
 * y~128 against a sea level of 287 — the traveller plunges from fire into deep water. Steam is
 * what that collision produces, so the occluder is diegetic rather than a wipe.
 *
 * WHY A BACKSIDE SPHERE. An occlusion moment has to actually OCCLUDE — that is the whole
 * difference from the crossfade it replaces. A camera-facing billboard cannot, because you can
 * always see past its edges; a volume you are INSIDE can. The camera flies through this sphere,
 * and while it is inside, the shell covers the frame completely at peak density. Outside it,
 * the same shell reads as a distant billowing bank you are approaching.
 *
 * Cheap on purpose: one draw, one material, no depth texture, no post pass. The softening that
 * would normally need a depth prepass is bought instead with a wide radial feather plus the
 * fact that peak density happens while the camera is inside, where there is no silhouette to
 * harden against.
 */
import * as THREE from 'three/webgpu';
import {
    cameraPosition,
    clamp,
    float,
    mix,
    normalize,
    oneMinus,
    positionLocal,
    positionWorld,
    smoothstep,
    uniform,
    vec2,
    vec3,
} from 'three/tsl';
import { fbm3, noise2 } from '../chapter-environments/shared/odyssey-tsl-noise.js';
import { sampleColourScript } from '../odyssey-colour-script.js';
import { ONE_WORLD_ACT_MARGIN } from '../world/odyssey-world-act-gate.js';

/** World radius of the steam volume. Wide enough to envelop the corridor at the boundary. */
export const STEAM_QUENCH_RADIUS = 110;

/**
 * APPROACH half-width of the occlusion window, in progress units. Deliberately 2x the
 * authored transition seamWidth (0.03): the steam exists to HIDE the content handoff, and an
 * occluder narrower than the thing it occludes just frames it. (The ch5->ch6 cloud bank
 * shares this number for BOTH its halves.) Owned here, beside the volume it windows, so the
 * board and the seam-12-dive playground drive the same quench by construction — they
 * disagreed by 0.03 of exit window until 2026-08-13.
 */
export const STEAM_QUENCH_HALF_WIDTH = 0.06;
/**
 * THE CH1 APPROACH — rescaled 2026-10-01, and the reason the middle of Earth Core was cream.
 *
 * STEAM_QUENCH_HALF_WIDTH above was authored as "106 u" when the journey was 1767 u long and
 * chapter 1 spanned p 0 -> 0.093. The layout has since grown to ~2533 u and chapter 1 now
 * spans p 0 -> 0.0649, so the same 0.06 opened the veil at chapter-local 0.075: measured in
 * capture, the cathedral was 21 % veiled at local 0.3 and 50 % at 0.5 — the "beige noise
 * ceiling" the player looked at for most of the chapter. (The cloud bank at 5->6, inside a
 * chapter four times longer, keeps 0.06.)
 *
 * 0.034 opens the veil at chapter-local ~0.48 — the cathedral's first half is clear — while
 * the approach curve below still has the volume ~0.9 dense at boundary - ONE_WORLD_ACT_MARGIN,
 * the moment the continuous world starts drawing behind it (ADR-0017: occlusion, never
 * crossfade). Must stay wider than chapter 1's seamWidth (pinned by the quench test).
 */
export const STEAM_QUENCH_APPROACH_HALF_WIDTH = 0.034;
/**
 * ...but the EXIT half-width cannot be that same number, and this is where the long-standing
 * "cloud deck renders underwater" ghost lived. The geometry: ±0.06 of progress is ±106 u
 * against a 110 u BackSide sphere — the eye never leaves the shell on the way out, so the
 * veil was a full-screen wash over the first half of chapter 2, still ~18% opaque at
 * p=0.130. The exit only has to outlast the CO-PRESENCE window, which is chapter 1's
 * authored `transition.seamWidth` = 0.03. NOTE this is not the plan's §7.2 decision
 * (plateau vs three beats) — that reshapes the curve AT the crossing and is the owner's;
 * this only stops the tail veiling half an act after the crossing is over.
 */
// Scaled 0.03 -> 0.0222 with every other seam (chapter-profile.js: x0.7384 when the ascent
// lengthened the curve); it still covers the co-presence window, which is that same 0.0222.
export const STEAM_QUENCH_EXIT_HALF_WIDTH = 0.0222;

/**
 * Where the approach curve must be dense: the fraction of the approach half at which the
 * world's act gate opens. Density there is ~0.93 (smoothstep at 1/1.2 of its span).
 */
const APPROACH_GATE_FRACTION = Math.max(0.05, 1 - (ONE_WORLD_ACT_MARGIN / STEAM_QUENCH_APPROACH_HALF_WIDTH));

/**
 * Journey progress -> the quench's seamT, BOUNDARY-TRUE: 0 at the approach edge, exactly 0.5
 * at the 1->2 boundary, 1 at the exit edge.
 *
 * The board used to map progress LINEARLY across the asymmetric window, while update() assumes
 * the boundary sits at 0.5 — with the old 0.06/0.03 widths that put peak density and the
 * warm->cool flip 0.015 of progress BEFORE the crossing the volume exists to hide. Piecewise
 * keeps the colour flip on the handoff whatever the two half-widths are.
 * @param {number} progress camera progress
 * @param {number} boundary the 1->2 chapter boundary
 * @returns {number}
 */
export function steamQuenchSeamT(progress, boundary) {
    if (!Number.isFinite(progress) || !Number.isFinite(boundary)) return 0;
    if (progress <= boundary) {
        const lo = boundary - STEAM_QUENCH_APPROACH_HALF_WIDTH;
        return 0.5 * Math.max(0, Math.min(1, (progress - lo) / STEAM_QUENCH_APPROACH_HALF_WIDTH));
    }
    return 0.5 + (0.5 * Math.max(0, Math.min(1, (progress - boundary) / STEAM_QUENCH_EXIT_HALF_WIDTH)));
}

/**
 * Density as a pure function of seamT, so the curve is testable without a renderer.
 * Approach: a smoothstep that stays clear through the cathedral and closes fast — ~0.93 dense
 * where the world's act gate opens. Exit: the old squared triangle, leaving the weather quickly.
 * @param {number} seamT 0..1, 0.5 at the boundary
 * @returns {number} 0..1
 */
export function steamQuenchDensity(seamT) {
    const t = Math.max(0, Math.min(1, Number.isFinite(seamT) ? seamT : 0));
    if (t <= 0.5) {
        const x = Math.min(1, (t * 2) / (APPROACH_GATE_FRACTION * 1.2));
        return x * x * (3 - (2 * x));
    }
    const tri = 1 - ((t * 2) - 1);
    return tri * tri;
}

/** Ember-lit steam on the Chapter 1 side; the fire is still behind you. */
const STEAM_WARM = new THREE.Color(0xffb079);
/** Cold vapour on the Act II side — the orange->cyan the profile asks for. */
const STEAM_COOL = new THREE.Color(0xcfe6ff);
/**
 * What the exit tail converges to once the traveller is under water. 0xcfe6ff is near-WHITE,
 * and a near-white veil billow-modulated over open water reads as a cumulus sky — captured at
 * p=0.115, where the "underwater atmosphere" was this constant, not the water. The tail now
 * converges onto the water column's own mid colour (the same script sample the world's mid
 * water plate wears at these stations), so what remains of the veil reads as quench
 * turbidity IN the water rather than as weather behind it. The white-out at the crossing is
 * untouched — the ease below only takes hold well past the boundary.
 */
const STEAM_COOL_SUBMERGED = new THREE.Color(...sampleColourScript(0.06).skyHorizon);

/**
 * @param {object} [opts]
 * @param {number} [opts.radius] world radius of the volume
 * @returns {{ mesh: THREE.Mesh, update: (t:number, seamT:number) => void, dispose: () => void }}
 *   `seamT` is 0 approaching the boundary, 0.5 at it, 1 leaving it.
 */
export function createSteamQuench({ radius = STEAM_QUENCH_RADIUS } = {}) {
    const uTime = uniform(0);
    // 0 outside the seam, 1 at the boundary. Drives density AND colour together so the
    // ember->vapour shift and the occlusion peak are the same event.
    const uDensity = uniform(0);
    const uWarmth = uniform(1);
    const uWarm = uniform(STEAM_WARM);
    // Cloned: update() lerps this toward STEAM_COOL_SUBMERGED on the exit, and a uniform
    // holds its value BY REFERENCE — lerping the shared constant would compound frame over
    // frame until the approach side was submerged-blue too.
    const uCool = uniform(STEAM_COOL.clone());
    // 0 until the crossing, -> 1 as the exit runs: the vapour stops being weather and becomes
    // TURBIDITY settling out of the water (see the exit note in the colour chain).
    const uExit = uniform(0);

    // Billowing, in LOCAL space so the volume churns with itself rather than with the camera.
    // Two octave-sets at different rates: the slow one is the body, the fast one the edge boil.
    // FREQUENCY IS SET BY THE RADIUS, not by taste. positionLocal spans +/-radius (110), so a
    // 0.028 scale put barely three noise cells across the entire sphere and every capture read
    // as flat blur no matter what the contrast did. 0.095 gives ~10 cells across the view,
    // which is the scale at which fbm starts looking like vapour instead of a gradient.
    const p = positionLocal.mul(0.095);
    // RISING VAPOUR (2026-10-01). The field used to be isotropic and drifted sideways, which
    // read as a flat noise sheet — the "beige ceiling". Steam over a lava shaft streams UP: the
    // slow body is stretched vertically (x0.38 on y -> columns) and its domain scrolls down so
    // the features climb; the fast boil keeps its scale and climbs faster still.
    const slow = fbm3(p.mul(vec3(1.0, 0.38, 1.0)).add(vec3(0.0, uTime.mul(-0.11), 0.0)), 4);
    const fast = fbm3(p.mul(3.4).add(vec3(uTime.mul(0.10), uTime.mul(-0.32), uTime.mul(0.075))), 3);
    // Contrast the sum rather than averaging it: averaging two fbm fields regresses toward
    // 0.5 everywhere, which is what made the first capture read as uniform blur instead of
    // vapour. The smoothstep pushes the field back out to real lights and darks.
    const billowRaw = clamp(slow.mul(0.72).add(fast.mul(0.42)), 0.0, 1.0);
    const billow = smoothstep(0.22, 0.78, billowRaw);

    // Radial feather. The shell is a sphere, so `positionLocal.length()` is ~radius everywhere;
    // the feather that matters is against the BILLOW, not against geometry — a hard-edged
    // constant would read as a coloured ball rather than vapour.
    // Soft on purpose (2026-10-01): the old double smoothstep (billow -> veil) gave the THIN
    // approach veil hard-edged holes, which over the dark cavern read as camouflage, not wisps.
    const veil = smoothstep(0.08, 0.92, billowRaw);

    // Master opacity. Squaring the density makes the approach stay clear for longer and then
    // close quickly, which is what makes it read as passing INTO something rather than as a
    // fade-up. clamp before the multiply so no negative ever reaches a pow-like term (this
    // repo has a logged NaN from pow(negative, n)).
    const d = clamp(uDensity, 0.0, 1.0);
    // ALPHA AND BRIGHTNESS ARE DECOUPLED, and that is the whole trick.
    // Driving alpha from the billow at peak punched HOLES in the volume — the ocean showed
    // straight through and it read as a torn curtain rather than dense vapour, which defeats
    // the one thing an occlusion moment has to do. So the billow shapes alpha only while the
    // volume is thin (approach and exit, where wisps are correct); as density rises the alpha
    // lerps to fully opaque, and all the interior structure moves into the COLOUR term below.
    // On the way OUT the veil must not keep its billow-shaped holes: thin wisps over open water
    // read as cumulus — a sky under the sea (captured at p 0.075). Exiting, it fades as a whole.
    const alphaShape = mix(mix(veil, float(1.0), d), float(1.0), uExit);
    const opacity = clamp(alphaShape.mul(d).mul(1.25), 0.0, 1.0);

    // COLOUR: warm -> BRIGHT WHITE -> cool, never warm -> grey -> cool.
    // A straight lerp between an ember orange and a cold blue passes through desaturated mud
    // at exactly the moment the volume fills the frame, which is the worst possible time. This
    // repo has the lesson already: Wave 0.3 deleted a fog bridge for routing through a midpoint
    // that "forced the fog through a 3.0x luminance dip — a dip to nowhere". The fix there was
    // to delete the midpoint; here the midpoint is right but must be BRIGHTER, not greyer,
    // because that is what a quench actually looks like — flashing to white where fire meets
    // water. `flash` peaks at the crossover and lifts both chroma and value.
    const w = clamp(uWarmth, 0.0, 1.0);
    const flash = float(1.0).sub(w.sub(0.5).abs().mul(2.0)); // 0 at the ends, 1 at the crossover
    const tint = mix(uCool, uWarm, w);
    // LIGHT HAS A DIRECTION IN HERE (2026-10-01). The camera looks straight up the shaft for
    // most of the act, so the frame is the volume's TOP: a uniform tint made it a flat sheet.
    // Two directional terms from the view ray (camera-relative, so they hold wherever on the
    // rail the eye is): the fire BELOW lights the vapour's underside while the cavern is still
    // behind you, and the crack ABOVE is a cool-white aperture the vapour streams toward —
    // a destination to climb into rather than a wall to hit.
    const viewUp = normalize(positionWorld.sub(cameraPosition)).y;
    const aperture = smoothstep(0.5, 0.97, viewUp);
    const under = oneMinus(smoothstep(-0.65, 0.2, viewUp));
    // VALUE STRUCTURE: the gaps between billows are SMOKE (ember-dark on the fire side,
    // sea-dark on the water side) and the billows are LIT vapour. The old multiply-by-billow
    // kept everything in the cream band - a low-contrast white-out with no form in it.
    // Interior form lives HERE now that alpha is uniform at peak; kept below 1.0 (a first
    // pass ran to 1.40 and clipped the billow to flat white where the volume fills the frame).
    // Gaps are shadowed VAPOUR, not smoke (a hard dark/bright split read as camouflage):
    // a cool or warm grey ~half the lit value, blended across the whole billow range.
    const shadowVapour = mix(vec3(0.20, 0.25, 0.29), vec3(0.30, 0.22, 0.18), w);
    // Lit vapour sits below white so the rays and the aperture are the brightest thing.
    const litVapour = mix(tint, vec3(1.0, 0.97, 0.94), flash.mul(0.42)).mul(0.78);
    // LIGHT SHAFTS FROM THE CRACK. Looking up the shaft, rays fan out from the zenith: noise
    // sampled on the view azimuth (on a circle, so there is no atan seam), streaming slowly,
    // strongest near the aperture and fading toward the edges of the view. They make the
    // white-out a climb toward light instead of a fog.
    const viewDir = normalize(positionWorld.sub(cameraPosition));
    const azimuth = normalize(viewDir.xz.add(vec2(1e-4, 0.0)));
    const rayNoise = noise2(azimuth.mul(4.2).add(vec2(uTime.mul(0.05), uTime.mul(-0.035))));
    const rays = smoothstep(0.48, 0.86, rayNoise).mul(smoothstep(0.35, 0.92, viewUp));
    const colour = mix(shadowVapour, litVapour, smoothstep(0.0, 1.0, billow))
        .add(vec3(0.95, 0.93, 0.86).mul(rays).mul(float(0.10).add(d.mul(0.22))))
        .add(uWarm.mul(under).mul(w).mul(float(0.5).add(billow.mul(0.5))).mul(0.26))
        .add(vec3(0.80, 0.90, 1.0).mul(aperture.mul(aperture))
            .mul(float(0.18).add(oneMinus(w).mul(0.5)))
            .mul(float(0.55).add(fast.mul(0.45))))
        // A LUMINOUS TUNNEL, not a white-out: the eye looks up the shaft, so the light lives
        // at the centre of the view (the aperture, the rays) and the periphery falls into
        // shadowed vapour. Without it the peak was an even field of white.
        .mul(mix(float(0.52), float(1.0), smoothstep(0.25, 0.95, viewUp)))
        .min(vec3(0.96, 0.96, 0.96));
    // EXIT: the same volume becomes murk in the water's own colour, brightest toward the surface
    // light above, with only a soft breath of the billow left — water clearing, not cloud lifting.
    const murk = uCool.mul(float(0.82).add(billow.mul(0.22))).mul(float(0.75).add(aperture.mul(0.45)));
    const exitColour = mix(colour, murk, uExit);

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = exitColour;
    material.opacityNode = opacity;
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.BackSide;
    // The board rewrites scene.fog every frame from the chapter profile, and this volume sits
    // at the boundary where that fog is mid-lerp. It carries its own colour ramp, so fogging it
    // would paint the seam in the outgoing chapter's fog — the trap this repo has paid for four
    // times (see the scene.fog note in docs/ + memory).
    material.fog = false;
    material.toneMapped = true;

    const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 24), material);
    mesh.name = 'odyssey-steam-quench';
    // The camera passes through it, so it must not vanish when its origin leaves the frustum.
    mesh.frustumCulled = false;
    mesh.renderOrder = 12; // after opaque chapter content, before UI-ish additive overlays

    return {
        mesh,
        /**
         * @param {number} time seconds
         * @param {number} seamT 0 approaching -> 0.5 at the boundary -> 1 leaving
         */
        update(time, seamT) {
            uTime.value = time;
            const t = Math.max(0, Math.min(1, seamT));
            // Triangular in seamT, then SQUARED. The raw triangle ramps linearly and had the
            // bank already opaque a fifth of the way into the window, which reads as flying
            // into a wall rather than into weather. Squaring keeps the approach clear for
            // longer and then closes quickly — the easing lives here rather than in the
            // shader so it cannot fight the alpha/brightness split above.
            // ASYMMETRIC ON PURPOSE. Approach: clear through the cathedral, then closing fast
            // so it is dense before Act II starts drawing (see steamQuenchDensity). Exit: the
            // square — leaving the weather quickly into open water is what the breach wants.
            uDensity.value = steamQuenchDensity(t);
            // Warm while the cavern is still behind you, cold once the water owns the frame.
            uWarmth.value = 1 - t;
            uExit.value = Math.max(0, Math.min(1, (t - 0.5) / 0.12));
            // Exit only (t>0.5, i.e. under water): converge the cool constant onto the water
            // column's colour. ^1.5 keeps the first stretch past the boundary near-white so
            // the quench's white-out beat survives; by the window's end the veil is fully in
            // the water family and its vanish is a non-event instead of a sky switching off.
            const submergeEase = Math.max(0, (t - 0.5) * 2) ** 1.5;
            uCool.value.copy(STEAM_COOL).lerp(STEAM_COOL_SUBMERGED, submergeEase);
        },
        dispose() {
            mesh.geometry.dispose();
            material.dispose();
        },
    };
}
