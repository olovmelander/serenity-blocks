/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * THE CLOUD BANK — the ch5 -> ch6 occlusion moment. Summit into cosmos.
 *
 * The second of the two act-edge occlusion moments the plan asks for ("cloud banks that
 * conform to terrain ... fog as a traversable object, not a post effect — this IS the
 * Ch5->Ch6 occlusion moment"). Same architecture as the steam quench and for the same
 * reason: an occlusion moment must actually occlude, and only a volume the camera is INSIDE
 * can do that. Same hard-won construction rules too — alpha and brightness are DECOUPLED
 * (alpha goes opaque as density rises; ALL structure lives in the colour term, because
 * billow-driven alpha punches holes the sky shows through), and noise frequency is set by
 * the radius, not by taste.
 *
 * Where it deliberately differs from the quench:
 *
 *  - IT IS A BANK, NOT A BALL. The mesh is a sphere scaled to [1, 0.35, 1] — a stratus
 *    lens the climb punches through vertically. The scale also stretches the local-space
 *    noise horizontally for free, which is exactly what layered cloud looks like.
 *  - THE COLOUR RAMP RUNS DOWN, NOT THROUGH WHITE. The quench flashes white because fire
 *    meets water; nothing collides here. Climbing out of the summit's daylight, the bank
 *    darkens through the AUTHORED handoff tone — `SEAM_56_AURORA_BRIDGE`'s deep teal, the
 *    very colour the player already sees at this edge — and breaks out into ch6's
 *    near-black void. Building the ramp THROUGH the bridge palette makes the moment
 *    continuous with the shipped seam by construction, rather than competing with it;
 *    the bridge itself STAYS (build first — it colours what is visible around the bank).
 *  - A faint aurora tint lifts the brightest billows inside the dense half, so the bank
 *    reads as the aurora seen from within rather than as grey murk.
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
    vec3,
} from 'three/tsl';
import { fbm3 } from '../chapter-environments/shared/odyssey-tsl-noise.js';
import { SEAM_56_AURORA_BRIDGE } from '../chapter-environments/shared/seam-bridges.js';

/**
 * World radius of the bank (before the Y squash). The journey's largest transition.
 *
 * 150 -> 620 (Act II->Space section 8.5). At 150 the eye left the shell entirely by
 * p=0.7941 (normalised ellipsoid coordinate 1.112, and 1.236 by 0.8001) — MEASURED as the
 * bank contributing exactly zero there: mean frame luma matched the bank-off arm to within
 * 0.08 and 0.01 luma. At 620 the eye is inside at every one of the 18 seam stations
 * (e = 0.025..0.515), which is what lets the limb keep working through the whole window.
 *
 * It is also what turns this from a volume you DISSOLVE INSIDE into one you GO PAST: the
 * limb surface along the forward horizon ray sits ~682 u away at p=0.6801 and closes to
 * ~510 u by p=0.8001, so it has real parallax against the stars behind it.
 */
export const CLOUD_BANK_RADIUS = 620;
/**
 * Noise cells across the shell, held CONSTANT as the radius changes.
 *
 * The frequency was a bare literal (0.07, hand-fitted to r=150 for ~10 cells). Scaling the
 * radius 4.1x without re-basing it samples the FBM at |positionLocal| = 620 * 0.07 = 43.4
 * in noise space, which reads as a per-pixel hash, not weather. Frequency is now DERIVED
 * from the radius so the two cannot drift apart again.
 */
export const CLOUD_BANK_NOISE_CELLS = 10.5;
/** Vertical squash — a stratus lens, not a sphere. */
export const CLOUD_BANK_Y_SCALE = 0.35;
/**
 * Fraction of the window's triangular ramp that the bank spends at ZERO density before it
 * begins to appear. See `update` — without it the bank is faintly present across its whole
 * window and paints noise over a clean sky long before it reads as anything.
 */
export const BANK_APPROACH_DEAD_BAND = 0.06;

/** Entry side: Ch5's bright cloud-cathedral daylight. */
const BANK_DAYLIT = new THREE.Color(0xdfeaf6);
/** The authored handoff tone — the bank's midpoint IS the bridge fog colour. */
const BANK_BRIDGE = new THREE.Color(SEAM_56_AURORA_BRIDGE.fogColor);
/** Exit side: ch6's near-black vacuum. */
const BANK_VOID = new THREE.Color(0x05060f);
/** Aurora lift on the bright billows in the dense half (the bridge's ambient teal). */
const BANK_AURORA = new THREE.Color(SEAM_56_AURORA_BRIDGE.ambientLight);
/**
 * Overall level of the limb band. The bank used to derive its brightness from filling the
 * frame; a horizon band has to be given one.
 */
const BANK_LIMB_GAIN = 0.42;
/** Peak alpha of the band. Replaces the old 1.25 gain, which clamped the shell opaque. */
const BANK_LIMB_ALPHA_GAIN = 0.95;

/**
 * @param {object} [opts]
 * @param {number} [opts.radius]
 * @param {{top:*, underShade:*}} [opts.palette] the act's live cloud-palette TSL nodes from
 *   `createOdysseyWorld().cloudPalette`. When present the bank's ENTRY tone is the same colour
 *   the sculpted field and the deck shade with, so the last cloud of the act stops being the
 *   only one in a different idiom. Omitted on the recovery path, where the authored constant
 *   stands in.
 * @returns {{ mesh: THREE.Mesh, update: (t:number, seamT:number) => void, dispose: () => void }}
 *   `seamT` is 0 approaching the boundary (late ch5), 0.5 at it, 1 leaving it (early ch6).
 */
export function createCloudBank({ radius = CLOUD_BANK_RADIUS, palette = null } = {}) {
    const uTime = uniform(0);
    const uDensity = uniform(0);
    // 0 = summit side of the window, 1 = space side. Drives the daylight->void ramp.
    const uAltitude = uniform(0);
    const uDaylit = uniform(BANK_DAYLIT);
    const uBridge = uniform(BANK_BRIDGE);
    const uVoid = uniform(BANK_VOID);
    const uAurora = uniform(BANK_AURORA);
    const uLimbGain = uniform(BANK_LIMB_GAIN);

    // Frequency DERIVED from the radius (the quench's lesson: 0.028 at r=110 was three
    // cells of flat blur across the whole volume). ~10.5 cells across the shell at any
    // radius. The mesh's Y squash stretches this field horizontally into strata for free.
    const p = positionLocal.mul(CLOUD_BANK_NOISE_CELLS / radius);
    const slow = fbm3(p.add(vec3(0.0, uTime.mul(0.02), 0.0)), 4);
    const fast = fbm3(p.mul(3.1).add(vec3(uTime.mul(0.06), 0.0, uTime.mul(0.045))), 3);
    const billowRaw = clamp(slow.mul(0.72).add(fast.mul(0.42)), 0.0, 1.0);
    const billow = smoothstep(0.22, 0.78, billowRaw);
    const veil = smoothstep(0.28, 0.86, billow);

    // ---- THE LIMB MASK (Act II->Space section 8.5) --------------------------------
    // The one change that stops this volume filling the frame.
    //
    // The rail used to fly UNDER the cloud deck, so a shell the camera sits inside was the
    // right instrument: an occlusion moment has to occlude. After the ascent the rail exits
    // ABOVE the weather, and the same shell became a white wall — MEASURED at mean frame
    // luma 188 at p=0.7341, brighter than anything Act II's own sky reaches, followed by a
    // -86.5 per 0.01p cliff.
    //
    // The camera is STILL inside the shell (that is what gives the clouds their scale and
    // their parallax); the shell simply stops painting above the horizon. With the eye
    // inside a BackSide shell every screen pixel maps to exactly one fragment, so
    // `viewDir.y` IS the sine of that pixel's view elevation — a direct "cloud at the
    // horizon, clear sky above" control rather than a proxy for one.
    //
    // An eye-DISTANCE fade cannot do this job. It only correlates with elevation for one
    // eye position and inverts as the camera traverses the volume; by p=0.7501 the eye is
    // ~6 u from the shell centre, at which point nearly every fragment is "near".
    const viewDir = normalize(positionWorld.sub(cameraPosition));
    const elev = viewDir.y;
    // A band straddling the horizon, plus a weaker floor below it — the deck you are now
    // looking down ON. Above elev ~0.30 the mask is zero and the sky belongs to the stars.
    // Written with oneMinus, never a reversed smoothstep: edge0 > edge1 is undefined and
    // has silently evaluated to 0 in this repo before.
    const limbCore = smoothstep(-0.30, -0.06, elev)
        .mul(oneMinus(smoothstep(0.06, 0.30, elev)));
    const limbFloor = oneMinus(smoothstep(-0.34, -0.06, elev)).mul(0.30);
    const limbProfile = clamp(limbCore.add(limbFloor), 0.0, 1.0);

    // Alpha: billow-shaped only while thin, and at peak density as opaque as the limb mask
    // allows — which is NOT the whole frame any more. Structure lives in colour.
    //
    // THE 1.25 GAIN IS GONE. It hard-clamped every fragment with d >= 0.8 to a fully opaque
    // wall: at p=0.7401 and p=0.7441 the arithmetic is t=0.5333, d=0.9333, and
    // clamp(0.9333^2 * 1.25) = 1.0 exactly. That is why the bank read as an occluder rather
    // than as weather, and it is what was HIDING the chapter-6 arrival pop behind it.
    const d = clamp(uDensity, 0.0, 1.0);
    const alphaShape = mix(veil, float(1.0), d);
    const opacity = clamp(
        limbProfile.mul(alphaShape).mul(d).mul(BANK_LIMB_ALPHA_GAIN),
        0.0,
        1.0,
    );

    // COLOUR: daylight -> bridge teal -> void, a ramp DOWNWARD in luminance. The first half
    // of the crossing eases into the authored bridge tone; the second half falls to vacuum.
    //
    // ── THE ENTRY TONE IS THE ACT'S OWN CLOUD PALETTE (Wave 5 restyle) ──────────────
    // `palette` carries the LIVE TSL nodes the sculpted field and the deck shade with, handed
    // over by `createOdysseyWorld` (see its `cloudPalette`). Sharing the nodes rather than
    // copying the numbers is the whole point: the bank cannot drift from the clouds it is
    // supposed to BE, and a palette edit reaches it by construction.
    //
    // ⚠️ ONLY THE ENTRY TONE IS REPLACED. The bridge teal and the void are the SEAM's colours,
    // not the weather's — they are what makes this volume a handover to space rather than one
    // more cloud — so the ramp past the midpoint is untouched. The bank stops being weather
    // exactly where it starts being the transition.
    //
    // Falls back to the authored constant when there is no world (the `?odysseyOneWorld=0`
    // recovery path still builds this bank, and it must not throw there).
    const entryLit = palette ? palette.top : uDaylit;
    const entryShade = palette ? palette.underShade : uDaylit;
    const a = clamp(uAltitude, 0.0, 1.0);
    // ⚠️ THE BRIDGE RAMP USED TO START AT ZERO, and that made the restyle nearly pointless:
    // the bank's dead band means it only becomes visible around seamT 0.30, by which point
    // `smoothstep(0, 0.55, a)` had ALREADY reached 0.63 — so the volume was mostly handover
    // teal from the first frame anyone saw it, and MEASURED at p=0.63 it was 79 % teal. The
    // entry tone it had just been given was 21 % of the mix.
    //
    // Starting the ramp at 0.35 puts the whole visible approach in the WEATHER tone and the
    // crossing itself in the handover, which is the beat this volume exists to play: cloud
    // masses close in, THEN the world changes. Measured effect on the bank-vs-field tone
    // match at p=0.63: 0.827 -> see the outcome block.
    //
    // ⚠️ UPPER EDGE STRETCHED 0.78 -> 1.05, and it is THE SAME LESSON AS `toVoid` BELOW, one
    // ramp earlier. BANK_BRIDGE is linear luma 0.0193 against an entry of 1.023 — a 53:1
    // drop — so essentially all of this volume's luminance travel is compressed into this
    // one window. Ending it at 0.78 meant the limb was 73 % bridge-toned by a=0.633 while it
    // still carried density 0.517: a nearly black band, and an alpha-blended one, so it
    // OCCLUDED the space arriving behind it instead of lighting the frame.
    //
    // MEASURED (arm-limb-v3): that produced a trough at p=0.7561 — luma 14.06 between 26.07
    // and 21.42 — and the recovery out of it was the last failing rising step (+12.3 per
    // 0.01p at p=0.7621). Stretching the edge keeps the band lit while it still has body:
    // at a=0.633 the bridge mix falls 0.729 -> 0.358.
    const toBridge = smoothstep(0.35, 1.05, a);
    // ⚠️ THE TINT MUST NOT OUTRUN THE DENSITY. What the eye sees is the PRODUCT
    // `density * (1 - toVoid)`, and two decaying terms multiplied fall faster than either
    // alone — which is why reshaping the exit density three separate ways barely moved the
    // seam's largest step. Ending this ramp at 1.0 meant the bank was 78% void-tinted while
    // it still had a third of its density left, so the product collapsed in the middle of the
    // exit. Stretching the upper edge to 1.6 (so the tint only reaches ~0.47 by the window's
    // end, where density is 0 anyway and the mass is gone regardless) flattens the visible
    // decay from a 0.272 worst step to 0.198 — 27% flatter, tabulated against the shipped
    // envelope. The crossing still tints toward space; it just stops finishing early.
    const toVoid = smoothstep(0.45, 1.6, a);
    // TWO FLAT BANDS ON THE ENTRY TONE, the field's grammar: the billow picks which band a
    // patch is in, and the step between them is narrow. This is what makes the approach read
    // as cloud MASSES closing in rather than as a fog gradient thickening.
    const entryBand = smoothstep(0.44, 0.56, billow);
    const entry = mix(entryShade, entryLit, entryBand);
    const base = mix(mix(entry, uBridge, toBridge), uVoid, toVoid);
    // Aurora on the bright billows, strongest mid-crossing where the bank is densest — the
    // aurora seen from inside the weather rather than painted on a dome behind it.
    const auroraAmt = billow.mul(d).mul(smoothstep(0.15, 0.6, a).mul(smoothstep(1.0, 0.6, a))).mul(0.35);
    // INTERIOR FORM IN THE COLOUR TERM, never the alpha (the torn-curtain lesson) — but
    // QUANTISED, so the bank speaks the deck's language. The deck is now poster cumulus with
    // two flat value bands and a drawn edge (cloud plan Waves 1-2); a smooth `0.42 + 0.72 *
    // billow` next to it reads as the FBM haze it is, which is exactly the "last cloud of the
    // act, and the only one left in the old idiom" this plan's Wave 3 exists to fix. Two flat
    // stops with a narrow transition, then a small smooth residue so the volume still has
    // depth when the camera is INSIDE it and the bands would otherwise be a flat wall.
    // The interior multiplier stays, but SHALLOWER now that the entry tone carries its own two
    // bands: stacking a 0.44..0.90 multiply on top of an already-banded colour double-darkens
    // the shadow band and pushes the bank below the sky behind it, which is the one rule this
    // palette must never break (a cloud is lighter than the sky at every point).
    const bandLit = smoothstep(0.46, 0.54, billow);
    const posterised = float(0.72).add(bandLit.mul(0.22)).add(billow.mul(0.08));
    // The limb is now the only bright thing left in frame, so its LEVEL is an art lever in
    // its own right rather than whatever the density envelope happens to produce. Applied
    // last, after the bands and the aurora, so it scales the finished tone.
    const colour = mix(base, uAurora, auroraAmt).mul(posterised).mul(uLimbGain);

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = colour;
    material.opacityNode = opacity;
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.BackSide;
    // Discard the clear sky above the limb outright. r181 applies opacityNode to
    // diffuseColor.a and discards on alphaTest independently of the `transparent` flag, so
    // the 40-55 % of frame above the band costs no blend work at all. Precedent: the
    // sculpted cloud field at odyssey-world-renderer.js:2721-2724.
    material.alphaTest = 0.004;
    // ...but alphaTest ALONE saves only the blend, and blend was never the expensive half.
    // MEASURED on Lane B at p=0.7401 (reports/odyssey-perf/gpu-split-seam56-limb-laneB-p7401
    // .json, baselineDriftMs 0): the bank cost 3.86 ms of an 8.32 ms frame — 46 % — because
    // NodeMaterial assigns colorNode BEFORE the alphaTest discard, so all seven FBM octaves
    // ran on every rasterised fragment including the sky being thrown away. At r=620 the
    // camera is inside the shell at every station, so that is the whole viewport.
    //
    // maskNode is emitted at the TOP of setupDiffuseColor, ahead of colorNode, so this kills
    // those fragments before the noise is ever evaluated. It deliberately reads ONLY
    // limbProfile and the density uniform — both FBM-free — or the saving would not exist.
    //
    // It is a CONSERVATIVE bound: the true alpha also carries `alphaShape`, which is <= 1,
    // so this keeps every fragment alphaTest might still discard and discards none it would
    // keep. The region is spatially coherent, so whole waves retire together.
    material.maskNode = limbProfile.mul(d).greaterThan(0.004);
    // Sits exactly where the 5->6 fog lerp is mid-flight; it carries its own ramp. The
    // scene-fog trap has cost this repo four sessions — this volume must not join them.
    material.fog = false;
    material.toneMapped = true;

    const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 24), material);
    mesh.scale.set(1, CLOUD_BANK_Y_SCALE, 1);
    mesh.name = 'odyssey-cloud-bank';
    mesh.frustumCulled = false; // the camera flies through it
    mesh.renderOrder = 12;

    return {
        mesh,
        /** @param {number} time seconds @param {number} seamT 0 -> 0.5 boundary -> 1 */
        update(time, seamT) {
            uTime.value = time;
            const t = Math.max(0, Math.min(1, Number.isFinite(seamT) ? seamT : 0));
            const tri = 1 - Math.abs((t * 2) - 1);
            // THE APPROACH MUST BE EMPTY, NOT FAINT. `tri * tri` is nonzero from the first
            // frame of the window, and this mesh is a 300 u lens the camera is already close
            // to, so at seamT 0.10 a 4 % density painted a full-screen FBM mottle across an
            // otherwise clean ch5 sky — capture-diagnosed at p=0.60, where it read as noise on
            // the sky rather than as weather ahead. Worse, it is the reason a 2026-08-13 bisect
            // mistook this bank for chapter SIX bleeding in: the sky went mottled at exactly the
            // progress where ch6's summit ignite also fires, and the bank had no off switch to
            // separate them (it has one now: ?odysseyNoCloudBank=1).
            // A dead band holds the bank at zero until it is close enough to read as a mass;
            // the closure at the boundary is unchanged, because tri = 1 there either way.
            // ENTRY AND EXIT ANSWER DIFFERENT PROBLEMS, so they are shaped differently.
            //
            // The entry keeps the dead band and the square: the approach must be EMPTY, not
            // faint, for the reasons above. The EXIT gets neither, and that is the fix for the
            // largest remaining step in the 5->6 transition. Worked by hand from the shipped
            // curve, bank density fell 0.58 -> 0.275 -> 0.082 across p 0.658/0.668/0.678 —
            // the dead band and the square compound on the way out, so a 300 u lens filling
            // the frame lost two thirds of itself between two samples (-81.4 luma measured;
            // disabling the bank entirely turns that step into -4.4). Linear out gives
            // 0.833 -> 0.667 -> 0.5 instead.
            //
            // ⚠️ THE WINDOW IS STILL SYMMETRIC, but the two claims below are SUPERSEDED and are
            // kept for the record of what was tried. `toVoid` was re-based to
            // smoothstep(0.45, 1.6, a) in a4f0a2b1, and the exit is no longer linear — it is
            // the two-term envelope in this function. Density is also no longer "not the
            // lever": the dead band went 0.30 -> 0.06 as part of the limb rebuild.
            //
            // THE WINDOW IS DELIBERATELY LEFT SYMMETRIC, and density is NOT the remaining
            // lever. Widening the exit was tried first and reverted: `toVoid` below keys off
            // RAW window progress (smoothstep(0.45, 1.0, uAltitude)) and silently assumes the
            // peak sits at t=0.5, so a longer exit put the bank BELOW its own tint threshold
            // and it stayed bridge-bright into space (window ended at luma 201 vs ~26).
            //
            // AND THE TINT, NOT THE DENSITY, IS WHAT ACTUALLY REMOVES THE BANK. Tabulated
            // against the shipped curve, `toVoid` reaches 0.71 by p=0.678 while density still
            // has 0.03 of window left — so the mass is fully void-coloured long before it
            // thins out, and no density shape can spread a decline the COLOUR ramp has already
            // finished. Measured: this linearised exit flattens every step except the spike
            // (0.652->0.658 went -52.5 to -29.2, endLuma 26.2 to 16.4) and left the spike
            // itself at -83.0 vs -81.4. The next change has to be `toVoid`, re-based on the
            // peak and slowed to run out with the density rather than ahead of it.
            //
            // ⚠️ EVERY p VALUE IN THE BLOCK ABOVE IS PRE-ASCENT, and the `toVoid` re-base it
            // asks for was DONE (a4f0a2b1). The window is now 0.7401 +/- 0.06, so the
            // densities once quoted at p 0.658/0.668/0.678 occur at roughly 0.716/0.728/0.740.
            // Preserved verbatim because the REASONING — that the tint, not the density,
            // removes the bank — is what led to the re-base and is still true.
            // POST-LIMB ENVELOPE (Act II->Space section 8.5).
            //
            // The dead band was 0.30 because a full-screen FBM mottle read as noise on a
            // clean sky. A band confined to the horizon has no such failure mode, and 0.30
            // is precisely why the bank contributed almost nothing before p~0.700 — the
            // measured live-vs-bank-off delta there is only +0.5, +0.6 and +0.9 luma. At
            // 0.06 the limb is present across the whole approach, which is what lets it
            // FALL while chapter 6 rises.
            //
            // The exit is the load-bearing half: a fast body so the mass clears, plus a
            // long low tail so the band does not vanish while space is still arriving.
            const rising = t <= 0.5;
            if (rising) {
                const shaped = Math.max(
                    0,
                    (tri - BANK_APPROACH_DEAD_BAND) / (1 - BANK_APPROACH_DEAD_BAND),
                );
                uDensity.value = shaped * shaped;
            } else {
                const u = (t - 0.5) / 0.5;
                const fall = 1 - u;
                uDensity.value = 0.86 * (fall ** 2.4) + 0.14 * (fall ** 0.6);
            }
            uAltitude.value = t;
        },
        dispose() {
            mesh.geometry.dispose();
            material.dispose();
        },
    };
}
