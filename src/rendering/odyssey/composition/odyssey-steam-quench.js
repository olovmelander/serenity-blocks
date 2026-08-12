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
    clamp,
    float,
    mix,
    positionLocal,
    smoothstep,
    uniform,
    vec3,
} from 'three/tsl';
import { fbm3 } from '../chapter-environments/shared/odyssey-tsl-noise.js';

/** World radius of the steam volume. Wide enough to envelop the corridor at the boundary. */
export const STEAM_QUENCH_RADIUS = 110;

/** Ember-lit steam on the Chapter 1 side; the fire is still behind you. */
const STEAM_WARM = new THREE.Color(0xffb079);
/** Cold vapour on the Act II side — the orange->cyan the profile asks for. */
const STEAM_COOL = new THREE.Color(0xcfe6ff);

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
    const uCool = uniform(STEAM_COOL);

    // Billowing, in LOCAL space so the volume churns with itself rather than with the camera.
    // Two octave-sets at different rates: the slow one is the body, the fast one the edge boil.
    // FREQUENCY IS SET BY THE RADIUS, not by taste. positionLocal spans +/-radius (110), so a
    // 0.028 scale put barely three noise cells across the entire sphere and every capture read
    // as flat blur no matter what the contrast did. 0.095 gives ~10 cells across the view,
    // which is the scale at which fbm starts looking like vapour instead of a gradient.
    const p = positionLocal.mul(0.095);
    const slow = fbm3(p.add(vec3(0.0, uTime.mul(0.035), 0.0)), 4);
    const fast = fbm3(p.mul(3.4).add(vec3(uTime.mul(0.10), 0.0, uTime.mul(0.075))), 3);
    // Contrast the sum rather than averaging it: averaging two fbm fields regresses toward
    // 0.5 everywhere, which is what made the first capture read as uniform blur instead of
    // vapour. The smoothstep pushes the field back out to real lights and darks.
    const billowRaw = clamp(slow.mul(0.72).add(fast.mul(0.42)), 0.0, 1.0);
    const billow = smoothstep(0.22, 0.78, billowRaw);

    // Radial feather. The shell is a sphere, so `positionLocal.length()` is ~radius everywhere;
    // the feather that matters is against the BILLOW, not against geometry — a hard-edged
    // constant would read as a coloured ball rather than vapour.
    const veil = smoothstep(0.28, 0.86, billow);

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
    const alphaShape = mix(veil, float(1.0), d);
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
    const colour = mix(tint, vec3(1.0, 0.97, 0.94), flash.mul(0.42))
        // Interior form lives HERE now that alpha is uniform at peak. Kept below 1.0 at the
        // top end: the first pass ran to 1.40 and clipped large areas to flat white, which
        // loses the billow exactly where the volume fills the frame.
        .mul(float(0.34).add(billow.mul(0.76)));

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = colour;
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
            const tri = 1 - Math.abs((t * 2) - 1);
            uDensity.value = tri * tri;
            // Warm while the cavern is still behind you, cold once the water owns the frame.
            uWarmth.value = 1 - t;
        },
        dispose() {
            mesh.geometry.dispose();
            material.dispose();
        },
    };
}
