/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * @fileoverview THE AURORA BRIDGE — the 5->6 carry: the world's airglow grows into an aurora
 * and dissolves into space (seamless pass, 2026-10).
 *
 * WHAT IT REPLACED. Three flat additive planes hung in the chapter-6 corridor, gated by the
 * chapter's post-boundary `spaceReveal`. They could only ARRIVE after the boundary — a +15.1
 * luma-per-0.01p rise at p 0.7643 that failed the 5->6 seam gate — and they arrived as a big
 * green smear overhead with nothing to do with the thin green airglow line the world had been
 * showing on the horizon for the whole climb. They also kept drawing, at zero alpha, for most
 * of the chapter.
 *
 * NOW. One open cylinder band around the eye (one draw, BackSide — the camera is always
 * inside it), its FOOT seated exactly on the world's airglow line — the One World sky draws
 * that line at sin(elevation) = 0.075 (odyssey-world-renderer.js `airglowBand`), so the band's
 * foot sits at the same elevation in the same world-up frame, whatever the camera does. The
 * curtains then GROW UP OUT OF THE AIRGLOW across the final climb, peak just before the
 * boundary, and only ever FALL after it: the green dies first and the crimson upper fringe
 * lingers a beat longer, so the air becomes interstellar gas. Every term is driven by global
 * progress; nothing waits for `spaceReveal`.
 *
 * Paint follows the planet crown (odyssey-planet-aurora.js): the photo-verified emerald
 * palette, rays from two incommensurate combs, brightness that travels along the oval in
 * clumps (sway at clump level, never boiling rays), a green body with a short crimson fringe
 * — plus a wavy lower edge, which is what makes a curtain read as a curtain. Chroma is held
 * down (the old bridge measured 99-100 % saturation over 44 % of the lit frame).
 */

import * as THREE from 'three/webgpu';
import {
    abs, clamp, cos, dot, float, mix, oneMinus, sin, smoothstep, uniform, uv, vec3,
} from 'three/tsl';
import { AURORA_PALETTE } from './odyssey-planet-aurora.js';
import { LATTICE_NOISE_PERIOD, latticeNoise3 } from './shared/odyssey-lattice-noise.js';

const TWO_PI = Math.PI * 2;

export const AURORA_BRIDGE = Object.freeze({
    // Band radius around the eye (world units): far beyond everything the departure draws
    // near the camera, well inside the 9000 u far plane.
    radius: 1600,
    // Elevations as sin(angle above the world horizontal). The foot is the world's airglow
    // line (odyssey-world-renderer.js DEPART airglowBand centre); the tip fades out ~24 deg up.
    footSin: 0.075,
    topSin: 0.42,
    // Schedule, as fractions of the Space span (ch6 -> ch7) around the 5->6 boundary:
    // the curtains grow across [b - riseFrom, b - riseTo], hold to the boundary, and fall
    // across [b, b + fallTo] — gone just as the One World switches off.
    riseFrom: 0.34,
    riseTo: 0.05,
    // 0.2 -> 0.3 (2026-10-02): the curtains now glow over the night-side cloud bank (which stays
    // until boundary + 152 u = p ~0.814), not on the world's airglow line, so they no longer have
    // to be gone at the One World switch-off. The longer fall dissolves the aurora INTO the
    // arriving nebulae instead of leaving a dark gap before them (the 5->6 gate measured a dip to
    // luma 18.6 at p 0.77 and a +3.6 recovery with the 0.2 fall).
    fallTo: 0.3,
    // The crimson fringe outlives the green by this fraction of the fall.
    crimsonLead: 0.6,
    // Overall emission trim and chroma (1 = full palette saturation).
    level: 0.85,
    chroma: 0.8,
});

function smoothstep01(x) {
    const t = Math.min(1, Math.max(0, x));
    return t * t * (3 - 2 * t);
}

/**
 * The bridge's envelope at global progress `p`.
 * @param {number} p global path progress
 * @param {number} ch6Start the 5->6 boundary
 * @param {number} ch7Start the 6->7 boundary (sets the Space span the schedule is authored in)
 * @returns {{grow: number, glow: number, crimson: number}} grow = how far up the curtains
 *   reach (0..1), glow = brightness (0..1, monotone non-increasing after the boundary),
 *   crimson = how far the hue has walked from green to the crimson fringe (0..1)
 */
export function resolveAuroraBridgeEnvelope(p, ch6Start, ch7Start) {
    if (!Number.isFinite(p) || !Number.isFinite(ch6Start)) return { grow: 0, glow: 0, crimson: 0 };
    const span = (Number.isFinite(ch7Start) && ch7Start > ch6Start) ? ch7Start - ch6Start : 0.1166;
    const B = AURORA_BRIDGE;
    const riseStart = ch6Start - span * B.riseFrom;
    const riseEnd = ch6Start - span * B.riseTo;
    const fallEnd = ch6Start + span * B.fallTo;
    const grow = smoothstep01((p - riseStart) / (riseEnd - riseStart));
    const fall = p <= ch6Start ? 1 : 1 - smoothstep01((p - ch6Start) / (fallEnd - ch6Start));
    const crimson = p <= ch6Start
        ? 0
        : smoothstep01((p - ch6Start) / ((fallEnd - ch6Start) * B.crimsonLead));
    return { grow, glow: grow * fall, crimson };
}

/**
 * Per-sheet parameters of the curtain (front -> back). Seen from orbit a farther curtain sits
 * LOWER (nearer the limb), shorter and dimmer; each folds on its own phase, so the sheets weave
 * and cross instead of stacking into parallel stripes (first in-game capture).
 */
const CURTAIN_SHEETS = Object.freeze([
    Object.freeze({
        foot: 0.10, height: 0.78, gain: 1.0, phase: 0.0, fineRays: true,
    }),
    Object.freeze({
        foot: 0.07, height: 0.56, gain: 0.7, phase: 2.1, fineRays: false,
    }),
    Object.freeze({
        foot: 0.045, height: 0.38, gain: 0.45, phase: 4.4, fineRays: false,
    }),
]);

/**
 * The curtain band. Returns a Mesh whose `userData` carries the uniforms the chapter ticks
 * (`uGrow`, `uGlow`, `uCrimson`) and `bandCentreY` (the local y offset of the band's centre
 * above the eye — the chapter re-seats the mesh on the camera every frame).
 *
 * THE AURORA, AS IT IS SEEN FROM ORBIT (2026-10-02; owner: "a visually stunning aurora — now it
 * almost feels like we have two different auroras"). The old band was ONE sine-built sheet: a
 * dense smear on one side and a picket comb of rays on the other, with no depth, and the cloud
 * bank drew over its lower half. Now THREE folded sheets stand on the limb, each:
 *   - FOLDED: its lower edge meanders (three periodic folds + baked-lattice wander), so it
 *     reads as hanging drapery, and it is BRIGHTER where the sheet turns toward the eye (seen
 *     edge-on there, the glowing gas is deeper along the line of sight);
 *   - a SHARP, bright green-white lower border (every real curtain has one), a green body that
 *     dies upward, and a crimson upper glow (the 630 nm oxygen line) above it;
 *   - RAYED: vertical striations from a lattice field stretched up the curtain, sampled on the
 *     FOLDED azimuth so they crowd where the sheet turns and drift slowly sideways;
 *   - ALIVE: bright and dark stretches travel along the curtain (activity), so it dances
 *     instead of sitting still.
 * Every azimuthal term is periodic (sines with integer frequency, lattice cells in multiples of
 * the 64-period texture), so the cylinder's seam column joins exactly. Drawn AFTER the cloud
 * bank (renderOrder 13 > 12): the curtains glow over the night-side cloud sea, as in orbital
 * photographs, instead of being washed grey by it.
 */
export function createAuroraBridgeBand(uTime) {
    const B = AURORA_BRIDGE;
    const time = uTime ?? uniform(0);
    const uGrow = uniform(0);
    const uGlow = uniform(0);
    const uCrimson = uniform(0);

    const footY = B.radius * (B.footSin / Math.sqrt(1 - B.footSin * B.footSin));
    const topY = B.radius * (B.topSin / Math.sqrt(1 - B.topSin * B.topSin));

    const coords = uv();
    const az = coords.x;
    const h = coords.y;
    const A = az.mul(TWO_PI);
    const N = LATTICE_NOISE_PERIOD;

    const greenWarm = vec3(...AURORA_PALETTE.greenWarm);
    const greenCool = vec3(...AURORA_PALETTE.greenCool);
    const crimson = vec3(...AURORA_PALETTE.crimson);
    const violet = vec3(0.42, 0.10, 0.62);
    const border = vec3(0.62, 1.0, 0.78); // the green-white lower edge

    // Activity: bright and dark stretches travelling along the oval (shared by the sheets, so
    // a surge reads as one event moving through the whole display).
    const activityField = latticeNoise3(vec3(az.mul(N), 3.3, time.mul(0.05)));
    const activity = smoothstep(0.28, 0.78, activityField).mul(0.88).add(0.12);

    let colour = vec3(0.0);
    CURTAIN_SHEETS.forEach((sheet, i) => {
        // The fold: three periodic sines, and their slope (how sharply the sheet turns).
        const a1 = A.mul(3.0).add(time.mul(0.031)).add(sheet.phase);
        const a2 = A.mul(7.0).sub(time.mul(0.047)).add(sheet.phase * 1.7);
        const a3 = A.mul(13.0).add(time.mul(0.083)).add(sheet.phase * 2.3);
        const fold = sin(a1).mul(0.5).add(sin(a2).mul(0.3)).add(sin(a3).mul(0.2));
        const slope = cos(a1).mul(1.5).add(cos(a2).mul(2.1)).add(cos(a3).mul(2.6))
            .div(6.2);
        const wander = latticeNoise3(vec3(az.mul(N * 2), 7.1 + i * 5.3, time.mul(0.04))).sub(0.5);
        const foldAmp = Math.min(0.085, sheet.foot * 0.75);
        const footLine = float(sheet.foot).add(fold.mul(foldAmp)).add(wander.mul(foldAmp * 0.6));
        const height = float(sheet.height).mul(sin(A.mul(2.0).add(sheet.phase)).mul(0.18).add(0.82));
        const d = h.sub(footLine);
        // Sharp lower edge, a bright border riding it, a green body dying upward, a crimson
        // glow high above — all measured from THIS sheet's own meandering foot.
        const lower = smoothstep(-0.012, 0.004, d);
        const borderLine = d.div(0.02);
        const rim = borderLine.mul(borderLine).negate().exp();
        const up = clamp(d.div(height), 0.0, 1.0);
        const body = up.mul(-1.9).exp();
        const high = smoothstep(0.35, 0.7, up).mul(oneMinus(smoothstep(0.78, 1.0, up)));
        // Rays on the FOLDED azimuth (they crowd where the sheet turns), stretched up the sheet,
        // drifting slowly sideways; the front sheet gets a second, finer octave.
        const rayAz = az.mul(N * 6).add(fold.mul(2.4));
        let rayField = latticeNoise3(vec3(rayAz, d.mul(1.2), time.mul(0.22).add(i * 11.0)));
        if (sheet.fineRays) {
            const fine = latticeNoise3(vec3(rayAz.mul(2.3), d.mul(2.0), time.mul(0.35).add(5.0)));
            rayField = rayField.mul(0.65).add(fine.mul(0.35));
        }
        // Low on the sheet the rays only texture a continuous glow; higher up they ARE the curtain.
        const rayFloor = mix(float(0.5), float(0.12), smoothstep(0.05, 0.5, up));
        const rays = smoothstep(0.3, 0.8, rayField).mul(oneMinus(rayFloor)).add(rayFloor);
        // Where the sheet turns toward the eye it is seen edge-on: brighter.
        const turn = abs(slope).mul(0.9).add(0.55);
        // The curtains climb out of the airglow as they grow (uGrow), literally.
        const grown = smoothstep(d, d.add(0.12), uGrow.mul(float(sheet.height).add(0.08)));
        const presence = lower.mul(activity).mul(turn).mul(grown).mul(sheet.gain);
        const green = mix(greenWarm, greenCool, activityField).mul(body.mul(rays))
            .add(border.mul(rim).mul(rays.mul(0.4).add(0.6)).mul(0.6));
        // The 630 nm oxygen glow: a FAINT high haze over the green, not a second red curtain.
        const red = mix(crimson, violet, smoothstep(0.6, 1.0, up)).mul(high).mul(rays.mul(0.2).add(0.8)).mul(0.13);
        colour = colour.add(green.mul(presence).mul(oneMinus(uCrimson.mul(0.85))))
            .add(red.mul(presence));
    });
    // The band itself fades out before its top edge, so no curtain is ever cut by geometry.
    const topFade = oneMinus(smoothstep(0.86, 1.0, h));
    const graded = mix(vec3(dot(colour, vec3(0.2126, 0.7152, 0.0722))), colour, float(B.chroma))
        .mul(B.level)
        .mul(topFade);

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = graded;
    material.opacityNode = uGlow;
    material.transparent = true;
    material.depthWrite = false;
    // The eye is always inside the band.
    material.side = THREE.BackSide;
    material.blending = THREE.AdditiveBlending;
    material.fog = false;
    material.userData.emitsBloom = true;

    const geometry = new THREE.CylinderGeometry(B.radius, B.radius, topY - footY, 256, 1, true);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'aurora-airglow-bridge';
    // After the cloud bank (12): the curtains glow over the night-side cloud sea.
    mesh.renderOrder = 13;
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.userData.uGrow = uGrow;
    mesh.userData.uGlow = uGlow;
    mesh.userData.uCrimson = uCrimson;
    mesh.userData.bandCentreY = (footY + topY) / 2;
    return mesh;
}
