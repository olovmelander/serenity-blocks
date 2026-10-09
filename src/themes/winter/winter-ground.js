/**
 * Winter — the snow, the lake's ice and the fells: one fan of ground, one material.
 *
 *  - Snow is lit by the moon from ahead and to the right, so every drift shows its lee side and
 *    the trees' shadows come toward the viewer, blue with the sky's light; the twilight along
 *    the horizon puts rose on whatever is turned to it.
 *  - It sparkles. The sparkle is laid out on a grid that is even ON SCREEN (bearing × the
 *    reciprocal of distance, measured from the resting eye), so a glint is a few pixels at any
 *    range, yet it is fixed to the ground. Most of it lies in the moon's path.
 *  - Where the wind has swept the lake clean the ice shows: dark, and a mirror for the sky, the
 *    moon's glitter and the fires. Snow snakes run over it when the wind rises.
 *  - Rings of lifted powder from a locking piece run over it and fire the sparkle as they pass.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    cameraPosition,
    clamp,
    dot,
    exp,
    float,
    floor,
    fract,
    length,
    max,
    mix,
    normalLocal,
    normalize,
    positionLocal,
    reflect,
    smoothstep,
    step,
    varying,
    vec2,
    vec3,
} from 'three/tsl';
import {
    EYE, wAir, wAurora, wGust, wHash23, wMoonShadow, wPart, wPow4, wRingLight, wSky, wSolidMaterial, wSq,
} from './winter-tsl.js';
import { buildGroundFan } from './winter-field.js';

/**
 * The sparkle's cell for a world point: vec3(cell id x, cell id y, distance from the glint's
 * centre in cells). The grid is bearing × height-over-distance from the resting eye.
 */
export const glintCell = (P, density) => {
    const flat = max(length(P.xz.sub(vec2(EYE.x, EYE.z))), 0.5);
    const gp = vec2(P.x.sub(EYE.x).div(max(float(EYE.z).sub(P.z), 0.5)), float(EYE.y).sub(P.y).div(flat)).mul(density);
    return gp;
};

/**
 * Sparkle at a point: how bright a glint is here (0 where there is none). `lobe` is how nearly
 * the surface mirrors the moon to the eye (0..1); `extra` forces more glints alight (a ring
 * passing). Returns vec2(glint, its random 0..1).
 */
export const snowGlint = (u, P, lobe, extra) => {
    const gp = glintCell(P, u.glintGrid);
    const cell = floor(gp);
    const h = wHash23(cell);
    const d = length(fract(gp).sub(0.5).sub(h.xy.sub(0.5).mul(0.55)));
    // Each crystal turns a face to the light for a moment of its own cycle.
    const beat = fract(h.z.mul(17.0).add(u.time.mul(h.x.mul(0.7).add(0.25))));
    const lit = smoothstep(0.0, 0.07, beat).mul(float(1.0).sub(smoothstep(0.1, 0.24, beat)));
    const chosen = step(h.y, lobe.mul(0.55).add(0.035).add(extra));
    const spot = smoothstep(0.3, 0.06, d);
    return vec2(spot.mul(lit).mul(chosen), h.x);
};

/**
 * @param {object} u
 * @param {object} o
 * @param {[number, number]} o.ground  [rings, columns]
 * @param {boolean} o.glints
 * @param {boolean} o.mirror   the ice mirrors the fires
 * @param {object} [o.fan]     a fan already built (buildGroundFan), to spare building it here
 */
export function createGround(u, {
    ground = [230, 200], glints = true, mirror = true, fan: built = null,
} = {}) {
    const fan = built || buildGroundFan(ground);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(fan.positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(fan.normals, 3));
    geometry.setAttribute('aGround', new THREE.BufferAttribute(fan.ground, 4));
    geometry.setIndex(new THREE.BufferAttribute(fan.indices, 1));

    const material = wSolidMaterial('WinterGround');
    const vGround = varying(attribute('aGround', 'vec4'), 'wGround');
    const vNormal = varying(normalLocal, 'wGroundN');
    material.colorNode = Fn(() => {
        const P = positionLocal.toVar();
        const toEye = cameraPosition.sub(P);
        const dist = length(toEye);
        const V = toEye.div(max(dist, 1e-3)).toVar();
        const lake = clamp(vGround.x, 0.0, 1.0);
        const wood = clamp(vGround.y, 0.0, 1.0);
        const N0 = normalize(vNormal).toVar();

        // ── The wind's work: long sastrugi across the wind, and the grain on them ──
        const drift = u.noise(vec2(P.x.mul(0.043), P.z.mul(0.17)));
        const grain = u.noise(P.xz.mul(0.83));
        const near = float(1.0).sub(smoothstep(60.0, 320.0, dist));
        const bump = vec3(
            drift.g.mul(0.5).add(grain.g.mul(0.2)),
            0.0,
            drift.b.mul(1.5).add(grain.b.mul(0.2)),
        ).mul(near);
        const N = normalize(N0.sub(bump)).toVar();

        // ── Light ──
        const shadow = wMoonShadow(u, P.xz).toVar();
        const ndl = dot(N, u.moonDir);
        const moonLit = u.moonCol.mul(max(ndl, 0.0).mul(1.25).add(0.04)).mul(shadow).mul(0.95);
        const skyFill = u.shade.mul(N.y.mul(0.25).add(0.6)).add(u.zenith.mul(max(N.y, 0.0)).mul(0.45)).add(u.band.mul(0.1));
        const toGlow = normalize(vec3(u.glowDir.x, 0.3, u.glowDir.y));
        const rose = u.glow.mul(max(dot(N, toGlow), 0.0).mul(0.46).add(0.07));
        // The fires light the snow from above, in their own colour.
        const burning = u.curtains.x.add(u.curtains.y).add(u.curtains.z).add(u.curtains.w);
        const fireLight = mix(u.fire, u.crown, 0.2).mul(burning.mul(0.035)).mul(max(N.y, 0.0)).mul(u.breath);
        const albedo = vec3(0.9, 0.93, 1.0);
        const snow = albedo.mul(moonLit.add(skyFill).add(rose).add(fireLight)).toVar();

        // The moon's path: snow turned to mirror it glows, and that is where it sparkles.
        const R = reflect(V.negate(), N);
        const mirrored = max(dot(R, u.moonDir), 0.0);
        const lobe = wPow4(mirrored);
        snow.addAssign(u.moonCol.mul(wPow4(lobe).mul(0.5).add(lobe.mul(0.07))).mul(shadow));

        // ── Rock and wood on the fells ──
        const steep = float(1.0).sub(smoothstep(0.72, 0.9, N0.y));
        const rock = vec3(0.04, 0.05, 0.075).add(u.shade.mul(0.1)).add(u.moonCol.mul(max(ndl, 0.0)).mul(0.04));
        const far = smoothstep(150.0, 500.0, dist);
        const outcrop = steep.mul(smoothstep(0.42, 0.62, u.noise(P.xz.mul(0.0031)).r)).mul(far);
        const trees = u.noise(P.xz.mul(0.021));
        const stand = smoothstep(0.44, 0.62, trees.a.mul(wood.mul(0.9).add(0.25))).mul(wood).mul(far);
        const woodCol = vec3(0.03, 0.05, 0.06).add(u.shade.mul(0.2)).add(snow.mul(0.3));
        snow.assign(mix(mix(snow, rock, outcrop.mul(0.75)), woodCol, stand.mul(0.72)));

        // ── The lake's ice, where the wind has swept it ──
        const swept = u.noise(vec2(P.x.mul(0.0052), P.z.mul(0.015)).add(vec2(0.3, 0.7))).r;
        // (Most of all along the moon's bearing, so its path lies on ice.)
        const moonPath = exp(wSq(P.x.sub(P.z.negate().mul(u.moonDir.x.div(u.moonDir.z.negate()))).div(46.0)).negate());
        const ice = lake.mul(smoothstep(0.36, 0.5, swept.add(drift.r.sub(0.5).mul(0.22)).add(moonPath.mul(0.16)))).toVar();
        const iceN = normalize(vec3(grain.g.mul(0.035), 1.0, grain.b.mul(0.035)));
        const Ri = reflect(V.negate(), iceN);
        // The ice smears what it mirrors upward: a low sun of fires stands in it as a column.
        const lifted = normalize(vec3(Ri.x, Ri.y.mul(3.4).add(0.035), Ri.z));
        const grazing = float(1.0).sub(clamp(V.y, 0.0, 1.0));
        const fresnel = wSq(wSq(grazing)).mul(grazing).mul(0.94).add(0.06);
        const mirrorSky = wSky(u, lifted).toVar();
        if (mirror) mirrorSky.addAssign(wAurora(u, lifted, { count: 2, fine: false }).mul(0.85));
        // Low on the far ice stands the dark of the wood on the far shore, mirrored.
        const shore = smoothstep(0.07, 0.016, Ri.y);
        mirrorSky.assign(mix(mirrorSky, vec3(0.02, 0.035, 0.055).add(u.shade.mul(0.3)), shore.mul(0.78)));
        const moonGlitter = wPow4(wPow4(max(dot(reflect(V.negate(), normalize(vec3(grain.g.mul(0.2), 1.0, grain.b.mul(0.2)))), u.moonDir), 0.0)));
        const cracks = smoothstep(0.016, 0.0, abs(u.noise(P.xz.mul(0.027)).r.sub(0.5)))
            .add(smoothstep(0.02, 0.0, abs(u.noise(P.xz.mul(0.083).add(0.4)).a.sub(0.5))).mul(0.5));
        const deep = vec3(0.008, 0.03, 0.055).add(u.shade.mul(0.12)).add(vec3(0.5, 0.7, 0.9).mul(cracks.mul(0.1)));
        const iceCol = mix(deep, mirrorSky, fresnel.mul(0.66))
            .add(u.moonCol.mul(moonGlitter.mul(2.2)).mul(shadow));

        // ── Snow on the move: snakes of spindrift, and the gusts that drive them ──
        const gust = wGust(u, P);
        const run = P.xz.sub(u.windRun.mul(1.0)).sub(gust.xy.mul(2.0));
        const snake = u.noise(vec2(run.x.mul(0.016), run.y.mul(0.1))).r;
        const fray = u.noise(vec2(run.x.mul(0.05).add(0.3), run.y.mul(0.27))).a;
        const moving = smoothstep(0.5, 0.72, snake).mul(fray.mul(0.8).add(0.3))
            .mul(clamp(u.gale.mul(0.55).add(gust.z.mul(1.1)), 0.0, 1.2)).mul(near);
        const powder = albedo.mul(u.moonCol.mul(0.34).mul(shadow.mul(0.7).add(0.3)).add(skyFill).add(rose));
        const col = mix(mix(snow, iceCol, ice), powder, clamp(moving, 0.0, 0.85)).toVar();

        // ── Rings of lifted powder, and the fox's own light ──
        const ringNow = wRingLight(u, P);
        col.addAssign(ringNow.rgb.mul(float(1.0).sub(ice.mul(0.5))).mul(0.8));
        // The fox stands on the snow: the moon lays its shadow toward the viewer.
        const underFox = P.xz.sub(u.foxPos.xz).add(u.moonDir.xz.mul(0.55));
        col.mulAssign(float(1.0).sub(exp(wSq(length(underFox).div(0.62)).negate()).mul(0.42)));
        const foxFar = length(P.sub(u.foxPos));
        col.addAssign(mix(u.fire, vec3(1.0), 0.15).mul(u.foxGlow).mul(exp(wSq(foxFar.div(1.5)).negate())).mul(0.5));

        // ── Sparkle ──
        if (glints) {
            const glint = snowGlint(u, P, lobe, ringNow.a.mul(0.45));
            const fired = mix(u.moonCol, ringNow.rgb.div(max(ringNow.a, 0.05)).mul(1.4), clamp(ringNow.a.mul(1.6), 0.0, 1.0));
            col.addAssign(fired.mul(glint.x).mul(glint.y.mul(9.0).add(3.0))
                .mul(shadow.mul(0.85).add(0.15).add(ringNow.a)).mul(float(1.0).sub(ice.mul(0.7)))
                .mul(u.breath));
        }
        return wAir(u, col, P);
    })();
    const part = wPart('WinterGround', geometry, material, 2);
    part.vertices = fan.positions.length / 3;
    return part;
}
