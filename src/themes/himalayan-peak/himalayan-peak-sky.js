/**
 * Himalayan Peak — the sky.
 *
 * One dome, shaded per view direction and drawn after everything solid, so it costs only where
 * sky shows: the gradient and the sun's scatter (hpSky, the function every other surface fades
 * into), the disc itself with its corona — the headwall hides it until the chain has raised it —
 * the last stars of the night, the Milky Way at moonrise, and streaks of cirrus that catch the
 * sun long before the ground does.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    cameraPosition,
    clamp,
    dot,
    exp,
    float,
    floor,
    fract,
    max,
    mix,
    normalize,
    positionWorld,
    sin,
    smoothstep,
    sqrt,
    step,
    vec2,
    vec3,
} from 'three/tsl';
import {
    hpHash33, hpPart, hpPow4, hpSky, hpSq,
} from './himalayan-peak-tsl.js';

export const SKY_RADIUS = 46000;
/** The sun's disc as drawn: larger than life, as a long lens over a ridge shows it. */
export const SUN_RADIUS = 0.021;

const MILKY_NORMAL = new THREE.Vector3(0.52, 0.5, 0.69).normalize();

/**
 * @param {object} u  shared uniforms
 * @param {object} opts
 * @param {boolean} [opts.cirrus=true]
 */
export function createSky(u, { cirrus = true } = {}) {
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'HimalayanPeakSky';
    material.fog = false;
    material.side = THREE.BackSide;
    material.depthWrite = false;
    material.depthTest = true;

    material.colorNode = Fn(() => {
        const seen = normalize(positionWorld.sub(cameraPosition));
        // The direction in the amphitheatre as it was planned (upright screens draw it narrower).
        const dir = normalize(vec3(seen.x.div(u.squeeze), seen.y, seen.z)).toVar();
        const up = clamp(dir.y, 0.0, 1.0);
        const col = hpSky(u, dir).toVar();
        const cs = dot(dir, u.sunDir);
        // Angle from the sun, squared (small angles): no acos, no cancellation at the disc.
        const a2 = max(float(1.0).sub(cs).mul(2.0), 0.0);
        const r2 = SUN_RADIUS * SUN_RADIUS;

        // ── Stars: two layers of hashed cells; the day puts them out ──
        const veil = hpSq(max(cs, 0.0));
        const night = u.stars.mul(smoothstep(0.02, 0.3, up)).mul(float(1.0).sub(veil.mul(0.8)));
        const layer = (scale, cut, size) => {
            const g = dir.mul(scale);
            const h = hpHash33(floor(g));
            const f = fract(g).sub(0.5).sub(h.sub(0.5).mul(0.6));
            const twinkle = sin(u.time.mul(h.z.mul(3.0).add(1.2)).add(h.x.mul(40.0))).mul(0.25).add(0.75);
            const tint = mix(vec3(1.0, 0.82, 0.66), vec3(0.72, 0.84, 1.0), h.y);
            return tint.mul(exp(dot(f, f).mul(-size)).mul(step(cut, h.x)).mul(twinkle));
        };
        const band = exp(hpSq(dot(dir, vec3(MILKY_NORMAL.x, MILKY_NORMAL.y, MILKY_NORMAL.z)).div(0.2)).negate());
        const dust = u.noise(dir.xz.mul(1.7).add(dir.y)).x;
        const deep = smoothstep(0.55, 1.0, u.stars);
        const stars = layer(150.0, 0.9, 130.0).mul(1.6)
            .add(layer(310.0, float(0.93).sub(band.mul(deep).mul(0.25)), 150.0).mul(0.8));
        col.addAssign(stars.mul(night));
        col.addAssign(vec3(0.16, 0.2, 0.34).mul(band.mul(deep).mul(night).mul(smoothstep(0.32, 0.72, dust)).mul(0.4)));

        // ── Cirrus: streaks drawn out along the wind, lit from below at dawn ──
        if (cirrus) {
            const plane = dir.xz.div(max(dir.y, 0.0).add(0.17)).mul(0.1).add(vec2(u.windRun.mul(1.6e-6), 0.0));
            const n1 = u.noise(plane.mul(vec2(1.0, 2.7)));
            const n2 = u.noise(plane.mul(vec2(2.6, 7.3)).add(0.41));
            const streak = smoothstep(0.5, 0.8, n1.x.mul(0.6).add(n2.w.mul(0.4)).add(0.03));
            const fade = smoothstep(0.015, 0.2, dir.y).mul(float(1.0).sub(smoothstep(0.6, 1.0, dir.y).mul(0.6)));
            // Six thousand metres over the summits: the sun reaches them first.
            const high = smoothstep(-0.24, -0.04, u.sunTan);
            const forward = hpPow4(max(cs, 0.0));
            const lit = u.sunCol.mul(forward.mul(0.9).add(0.24)).mul(high);
            const cloud = u.shade.mul(1.2).add(u.horizon.mul(0.8)).add(u.zenith.mul(0.6)).add(lit);
            // (Thinner once the day is up: high cloud burns off.)
            const cover = streak.mul(fade).mul(float(0.66).sub(u.power.mul(0.2)));
            col.assign(mix(col, cloud.mul(u.breath.mul(0.65).add(0.35)), cover));
        }

        // ── The sun: a limb-darkened disc in a corona ──
        const edge = smoothstep(r2 * 1.12, r2 * 0.86, a2);
        const limb = float(1.0).sub(a2.div(r2).mul(0.32));
        const disc = u.sunCol.mul(edge.mul(limb).mul(9.0));
        const corona = u.sunCol.mul(exp(a2.div(-r2 * 7.0)).mul(0.6).add(exp(sqrt(a2).mul(-13.0)).mul(0.14)));
        // (Nothing of it below the horizon: the cloud sea is not always opaque down there.)
        col.addAssign(disc.add(corona).mul(u.breath).mul(smoothstep(-0.03, 0.0, dir.y)));
        // Twenty-two degrees out, the ring that ice in the air draws round a low sun: red on
        // its inner edge, fading outward. Four lines call it up; a board cleared whole, fully.
        const out = sqrt(a2).sub(0.384);
        const ring = exp(hpSq(out.div(0.011)).negate()).add(exp(max(out, 0.0).mul(-34.0)).mul(step(0.0, out)).mul(0.45));
        const tint = mix(vec3(1.0, 0.5, 0.3), vec3(0.75, 0.9, 1.0), smoothstep(-0.012, 0.03, out));
        col.addAssign(u.sunCol.mul(tint).mul(ring.mul(u.halo).mul(0.16)).mul(smoothstep(0.0, 0.08, dir.y)));
        return col;
    })();

    const geometry = new THREE.SphereGeometry(SKY_RADIUS, 48, 24);
    return hpPart('HimalayanPeakSky', geometry, material, 20);
}
