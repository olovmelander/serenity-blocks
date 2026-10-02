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
    clamp, cos, dot, float, mix, oneMinus, pow, sin, smoothstep, uniform, uv, vec3,
} from 'three/tsl';
import { AURORA_PALETTE } from './odyssey-planet-aurora.js';

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
    fallTo: 0.2,
    // The crimson fringe outlives the green by this fraction of the fall.
    crimsonLead: 0.6,
    // Overall emission trim and chroma (1 = full palette saturation).
    level: 0.55,
    chroma: 0.62,
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
 * The curtain band. Returns a Mesh whose `userData` carries the uniforms the chapter ticks
 * (`uGrow`, `uGlow`, `uCrimson`) and `bandCentreY` (the local y offset of the band's centre
 * above the eye — the chapter re-seats the mesh on the camera every frame).
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
    const az = coords.x.mul(TWO_PI);
    // Wavy lower edge: the curtain's foot rides a slow fold in azimuth, so the band reads as
    // hanging sheets, not a ruled stripe. Kept small next to the band height (~5 %).
    const foldA = sin(az.mul(7.0).add(time.mul(0.07)));
    const foldB = sin(az.mul(19.0).sub(time.mul(0.045)).add(1.7));
    const h = coords.y.sub(foldA.mul(0.035).add(foldB.mul(0.015)).add(0.02));

    // RAYS: the striations live INSIDE a continuous sheet (first capture: hard, evenly spaced
    // spikes read as a picket fence on the horizon). The comb runs on a FOLDED azimuth, so the
    // rays bunch where the sheet turns toward the eye and thin where it turns away, and two
    // incommensurate frequencies at low contrast only texture the sheet. Every term is periodic
    // in azimuth, so the cylinder's seam column joins exactly.
    const azFold = az.add(sin(az.mul(4.0).add(time.mul(0.03))).mul(0.22))
        .add(sin(az.mul(11.0).sub(time.mul(0.05)).add(0.4)).mul(0.07));
    const rayFine = pow(sin(azFold.mul(97.0).add(time.mul(0.05))).mul(0.5).add(0.5), 1.5);
    const rayWide = pow(sin(azFold.mul(37.0).sub(time.mul(0.03)).add(0.6)).mul(0.5).add(0.5), 1.2);
    const rays = rayFine.mul(0.6).add(rayWide.mul(0.4)).mul(0.55).add(0.45);
    // CLUMPS: brightness travels along the oval; the gaps are what make the bright arcs read.
    const clumpA = sin(az.mul(3.0).sub(time.mul(0.05)).add(1.3)).mul(0.5).add(0.5);
    const clumpB = cos(az.mul(5.0).add(time.mul(0.035))).mul(0.5).add(0.5);
    const clump = pow(clumpA.mul(clumpB), 0.7).mul(0.9).add(0.1);

    // Vertical: soft out of the airglow line, bright low, dissolving upward; and only the part
    // the curtains have GROWN into is lit (the rise is literal: they climb out of the line).
    const foot = smoothstep(0.0, 0.06, h);
    // The bright lower border every aurora curtain has, riding the wavy foot.
    const border = h.sub(0.05).div(0.05);
    const rim = border.mul(border).negate().exp().mul(0.6);
    const fade = pow(oneMinus(clamp(h, 0.0, 1.0)), 1.9).add(rim);
    const grown = smoothstep(h, h.add(0.14), uGrow.mul(1.14));

    // Colour: the airglow's own green at the very foot, the emerald body, a short crimson /
    // pink fringe at the top — and across the fall the whole curtain walks to crimson.
    const airglow = vec3(0.20, 0.78, 0.46);
    const green = mix(vec3(...AURORA_PALETTE.greenWarm), vec3(...AURORA_PALETTE.greenCool), clumpA);
    const fringe = mix(vec3(...AURORA_PALETTE.crimson), vec3(...AURORA_PALETTE.pink), smoothstep(0.82, 0.96, h));
    let colour = mix(airglow, green, smoothstep(0.0, 0.12, h));
    colour = mix(colour, fringe, smoothstep(0.52, 0.72, h));
    colour = mix(colour, fringe, uCrimson.mul(0.85));
    const graded = mix(vec3(dot(colour, vec3(0.2126, 0.7152, 0.0722))), colour, float(B.chroma)).mul(B.level);

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = graded;
    // During the fall the green body thins faster than the fringe (`crimson` lifts the floor
    // of the vertical ramp), so what remains last is high red wisps.
    const fallLift = mix(float(1.0), smoothstep(0.35, 0.8, h), uCrimson.mul(0.7));
    const shape = foot.mul(fade).mul(rays).mul(clump)
        .mul(grown)
        .mul(fallLift);
    material.opacityNode = clamp(shape, 0.0, 1.0).mul(uGlow);
    material.transparent = true;
    material.depthWrite = false;
    // The eye is always inside the band.
    material.side = THREE.BackSide;
    material.blending = THREE.AdditiveBlending;
    material.fog = false;
    material.userData.emitsBloom = true;

    const geometry = new THREE.CylinderGeometry(B.radius, B.radius, topY - footY, 192, 1, true);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'aurora-airglow-bridge';
    mesh.renderOrder = -9;
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.userData.uGrow = uGrow;
    mesh.userData.uGlow = uGlow;
    mesh.userData.uCrimson = uCrimson;
    mesh.userData.bandCentreY = (footY + topY) / 2;
    return mesh;
}
