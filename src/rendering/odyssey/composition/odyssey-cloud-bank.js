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
    clamp,
    float,
    mix,
    positionLocal,
    smoothstep,
    uniform,
    vec3,
} from 'three/tsl';
import { fbm3 } from '../chapter-environments/shared/odyssey-tsl-noise.js';
import { SEAM_56_AURORA_BRIDGE } from '../chapter-environments/shared/seam-bridges.js';

/** World radius of the bank (before the Y squash). The journey's largest transition. */
export const CLOUD_BANK_RADIUS = 150;
/** Vertical squash — a stratus lens, not a sphere. */
export const CLOUD_BANK_Y_SCALE = 0.35;
/**
 * Fraction of the window's triangular ramp that the bank spends at ZERO density before it
 * begins to appear. See `update` — without it the bank is faintly present across its whole
 * window and paints noise over a clean sky long before it reads as anything.
 */
export const BANK_APPROACH_DEAD_BAND = 0.30;

/** Entry side: Ch5's bright cloud-cathedral daylight. */
const BANK_DAYLIT = new THREE.Color(0xdfeaf6);
/** The authored handoff tone — the bank's midpoint IS the bridge fog colour. */
const BANK_BRIDGE = new THREE.Color(SEAM_56_AURORA_BRIDGE.fogColor);
/** Exit side: ch6's near-black vacuum. */
const BANK_VOID = new THREE.Color(0x05060f);
/** Aurora lift on the bright billows in the dense half (the bridge's ambient teal). */
const BANK_AURORA = new THREE.Color(SEAM_56_AURORA_BRIDGE.ambientLight);

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

    // Frequency set by the radius (the quench's lesson: 0.028 at r=110 was three cells of
    // flat blur across the whole volume). r=150 -> 0.07 gives ~10 cells across the view.
    // The mesh's Y squash stretches this field horizontally into strata for free.
    const p = positionLocal.mul(0.07);
    const slow = fbm3(p.add(vec3(0.0, uTime.mul(0.02), 0.0)), 4);
    const fast = fbm3(p.mul(3.1).add(vec3(uTime.mul(0.06), 0.0, uTime.mul(0.045))), 3);
    const billowRaw = clamp(slow.mul(0.72).add(fast.mul(0.42)), 0.0, 1.0);
    const billow = smoothstep(0.22, 0.78, billowRaw);
    const veil = smoothstep(0.28, 0.86, billow);

    // Alpha: billow-shaped only while thin; fully opaque at peak. Structure lives in colour.
    const d = clamp(uDensity, 0.0, 1.0);
    const alphaShape = mix(veil, float(1.0), d);
    const opacity = clamp(alphaShape.mul(d).mul(1.25), 0.0, 1.0);

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
    const toBridge = smoothstep(0.35, 0.78, a);
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
    const auroraAmt = billow.mul(d).mul(smoothstep(0.15, 0.6, a).mul(smoothstep(1.0, 0.6, a))).mul(0.55);
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
    const colour = mix(base, uAurora, auroraAmt).mul(posterised);

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = colour;
    material.opacityNode = opacity;
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.BackSide;
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
            // ⚠️ THE WINDOW IS DELIBERATELY LEFT SYMMETRIC, and density is NOT the remaining
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
            const rising = t <= 0.5;
            const shaped = rising
                ? Math.max(0, (tri - BANK_APPROACH_DEAD_BAND) / (1 - BANK_APPROACH_DEAD_BAND))
                : tri;
            uDensity.value = rising ? shaped * shaped : shaped;
            uAltitude.value = t;
        },
        dispose() {
            mesh.geometry.dispose();
            material.dispose();
        },
    };
}
