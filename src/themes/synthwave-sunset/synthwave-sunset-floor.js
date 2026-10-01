/**
 * Synthwave Sunset — the neon grid floor.
 *
 * One opaque quad running to the horizon (the old grid stopped 80 units out and faded into a
 * wall of fog). Lines are "pristine grid" anti-aliased, so they stay crisp near the camera and
 * converge to their true average at the horizon instead of crawling into moiré. The floor is a
 * dark, glossy surface: it mirrors the sun (the actual disc colours, reflected about the
 * horizon, stretched into a glossy column, rippled and broken into bars) and the warm horizon
 * haze. Line clears send a sonar ring racing in from the horizon.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    cameraPosition,
    clamp,
    dot,
    exp,
    float,
    fract,
    fwidth,
    length,
    max,
    mix,
    normalize,
    positionWorld,
    sin,
    smoothstep,
    vec2,
    vec3,
} from 'three/tsl';
import {
    GRID_SPACING,
    rgb,
    swHazeColor,
    swLineAA,
    swSunAlign,
} from './synthwave-sunset-tsl.js';
import { swSunColor } from './synthwave-sunset-sky.js';

/** Fog density along the ground (shared with the skyline so they recede alike). */
export const FLOOR_FOG_DENSITY = 0.0021;

/** A gaussian ring at `dist` for pulse slot P = (radius, 1/width, energy, 0). */
const ringTerm = (dist, P) => {
    const d = dist.sub(P.x).mul(P.y);
    return exp(d.mul(d).negate()).mul(P.z);
};

/**
 * @param {object} u  shared world uniforms
 * @param {object} [opts]
 * @param {boolean} [opts.reflection=true]  the glossy sun reflection (Low and up)
 */
export function createFloor(u, opts = {}) {
    const withReflection = opts.reflection !== false;
    const S = float(GRID_SPACING);

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'SynthwaveFloor';
    material.fog = false;

    material.colorNode = Fn(() => {
        const p = positionWorld;
        const rel = p.sub(cameraPosition).toVar();
        const dist = length(vec2(rel.x, rel.z)).toVar();

        // ── Grid lines: x = const lines run to the sun, z = const lines scroll toward us ──
        const gx = p.x.div(S);
        const gz = p.z.sub(u.scroll).div(S);
        const fx = fwidth(gx);
        const fz = fwidth(gz);
        const dx = fract(gx.add(0.5)).sub(0.5);
        const dz = fract(gz.add(0.5)).sub(0.5);
        const hw = float(0.013);
        const line = max(swLineAA(dx, hw, fx), swLineAA(dz, hw, fz)).toVar();
        // A soft halo around each line near the camera; far away it is replaced by its average
        // (the same energy, without the moiré a sub-pixel exponential would alias into).
        const haloNear = max(exp(abs(dx).mul(-13.0)), exp(abs(dz).mul(-13.0)));
        const haloMix = smoothstep(0.06, 0.32, max(fx, fz));
        const halo = mix(haloNear, float(0.2), haloMix).mul(0.2);

        // ── Line-clear rings: from the horizon toward the camera ──
        const ring = ringTerm(dist, u.ring0).add(ringTerm(dist, u.ring1)).toVar();

        // Combos shift the grid to cyan through a saturated violet (a straight magenta→cyan mix
        // washes out to lavender halfway).
        const shift = u.comboShift;
        const lineCol = mix(
            mix(rgb(0xff2a94), rgb(0x8a3cff), smoothstep(0.0, 0.5, shift)),
            rgb(0x2ee6ff),
            smoothstep(0.5, 1.0, shift),
        ).mul(2.3);
        const energy = line.add(halo).mul(float(1.0).add(ring.mul(2.6)));
        const col = rgb(0x0a0416).add(lineCol.mul(energy)).add(lineCol.mul(ring.mul(0.05))).toVar();

        // Fog into the horizon haze (the same colour the sky starts from). Gaussian in distance:
        // the mid floor stays dark and contrasty, then the haze closes in fast toward the
        // horizon, reaching the sky's colour exactly where the two meet.
        const fk = dist.mul(0.0031);
        const fog = float(1.0).sub(exp(fk.mul(fk).negate()));
        const sa = swSunAlign(rel.z.div(max(dist, 1e-3)));
        col.assign(mix(col, swHazeColor(sa), fog));

        if (withReflection) {
            // ── Glossy sun reflection ──
            const V = normalize(rel);
            // Ripples: shift the reflected azimuth a little, varying with depth and time.
            const ripple = sin(p.z.mul(0.55).add(u.time.mul(1.4)).add(sin(p.x.mul(0.07)).mul(1.8)))
                .add(sin(p.z.mul(1.31).sub(u.time.mul(0.8))).mul(0.6))
                .mul(0.0065);
            const R = normalize(vec3(V.x.add(ripple), V.y.negate(), V.z));
            const rlx = dot(R, u.sunRight).div(u.sunRadius);
            const rly = dot(R, u.sunUp).div(u.sunRadius);
            // The mirrored disc, stretched downward (glossy), in a soft-edged column.
            const colX = abs(rlx).div(0.92);
            const column = exp(colX.mul(colX).mul(colX).mul(colX).negate());
            const window = float(1.0).sub(smoothstep(0.55, 1.9, rly));
            // Horizontal bars (ripple crests); their contrast fades before they could alias.
            const barPhase = rly.mul(56.0).add(u.time.mul(1.3)).add(sin(p.x.mul(0.35).add(u.time.mul(0.5))).mul(0.8));
            const barContrast = float(1.0).sub(smoothstep(0.3, 1.0, fwidth(barPhase)));
            const bars = mix(float(0.55), sin(barPhase).mul(0.5).add(0.5), barContrast.mul(0.7));
            // Warm tones only: the pale-gold top of the disc turns muddy over the magenta floor.
            const disc = swSunColor(clamp(rly, -1.0, -0.05)).mul(column).mul(window).mul(bars)
                .mul(0.16);
            const glow = rgb(0xff3f78).mul(exp(length(vec2(rlx.mul(0.8), rly.mul(0.3))).mul(-1.1)))
                .mul(float(0.1).add(u.sunPulse.mul(0.2)));
            const fres = float(0.3).add(float(0.7).mul(clamp(float(1.0).sub(R.y.mul(3.0)), 0.0, 1.0)));
            // Reflections sit ON the haze (a wet floor still shows the sun through the mist).
            col.addAssign(disc.add(glow).mul(fres).mul(exp(dist.mul(-0.00035))));
        }

        return col;
    })();

    // z from +60 (behind the camera) to −3340: the far edge is ~0.1° below the horizon.
    const geometry = new THREE.PlaneGeometry(8000, 3400, 1, 1);
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(0, 0, -1640);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'SynthwaveFloor';
    mesh.frustumCulled = false;
    mesh.renderOrder = -10;
    return mesh;
}
