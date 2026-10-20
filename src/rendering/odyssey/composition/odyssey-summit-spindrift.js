/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * THE SUMMIT'S SPINDRIFT — snow torn off the hero summit by the wind aloft, streaming west into
 * the banner cloud (chapters 3-5).
 *
 * The massif is the subject of every parked view in chapters 3-4 and the wall of chapter 5, and
 * its summit was a still cone: the banner cloud (the cloud field's `banner` masses, west-north-west
 * of the peak, on the side the rail never visits) hung beside it with nothing joining the two. A
 * plume of torn snow now leaves the crest and runs downwind into the banner — the one sign at a
 * kilometre's range that the summit is in a gale, and what makes the banner read as a banner.
 *
 * One mesh of camera-facing sheets (no instance data: each sheet's place, size and age follow
 * from its index and the clock in the vertex stage). Each is born on the crest, rides the wind
 * aloft for `run` world units while it grows and thins, and is born again; the ages are spread
 * so the plume is continuous. Front-lit (the act's sun is behind the camera): the snow is white
 * with a cool shade in its thick heart, torn at its edges by value noise. Normal alpha blending,
 * no depth write; sheets near the eye fade (no big quads at the lens).
 *
 * ZERO-HITCH: built at board construction (compiled with the presentation group); afterwards only
 * the clock and the reveal uniform change. BISECT LEVER (board): `?odysseyNoSpindrift=1`.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, cameraPosition, cameraProjectionMatrix, cameraViewMatrix, clamp, dot, exp, float, fract, hash,
    instanceIndex, length, mix, positionGeometry, smoothstep, sqrt, uniform, varying, vec2, vec3, vec4,
} from 'three/tsl';
import { noise2 } from '../chapter-environments/shared/odyssey-tsl-noise.js';

/** The plume. `wind` is the direction the snow travels (unit-ish; west-north-west, lifting). */
export const ODYSSEY_SPINDRIFT = Object.freeze({
    count: 56,
    wind: Object.freeze([-0.92, 0.07, -0.37]),
    /** How far a sheet rides before it is born again (world units), and how long that takes. */
    run: 175,
    life: 11,
    /** Sheet radius at birth and at the end of its run (world units). */
    size: Object.freeze([9, 44]),
    /** The crest the snow leaves: spread round the summit point (horizontal, down). */
    crest: Object.freeze([22, 16]),
    /** Peak alpha of one sheet. */
    alpha: 0.42,
    /** [fade in from, fully in by, fade out from, gone by] in JOURNEY progress. */
    window: Object.freeze([0.140, 0.160, 0.662, 0.692]),
});

const win = (w, p) => THREE.MathUtils.smoothstep(p, w[0], w[1]) * (1 - THREE.MathUtils.smoothstep(p, w[2], w[3]));

/** Reveal (0..1) at journey progress `p`. */
export function spindriftRevealAt(p, cfg = ODYSSEY_SPINDRIFT) {
    return win(cfg.window, p);
}

/**
 * @param {object} opts
 * @param {{x:number,y:number,z:number}} opts.summit the summit point (world) — the CPU height
 *   mirror's highest sample at the hero massif
 * @param {object} [opts.sunColour] TSL vec3 node: the world's sun colour
 * @param {object} [opts.hazeColour] TSL vec3 node: the world's horizon (the shade's sky light)
 */
export function createSummitSpindrift({ summit, sunColour = null, hazeColour = null } = {}) {
    const C = ODYSSEY_SPINDRIFT;
    const plane = new THREE.PlaneGeometry(1, 1);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = plane.index;
    geometry.setAttribute('position', plane.getAttribute('position'));
    geometry.setAttribute('uv', plane.getAttribute('uv'));
    geometry.instanceCount = C.count;

    const uTime = uniform(0);
    const uReveal = uniform(0);
    const top = summit || { x: -182.7, y: 1017, z: -1059.3 };
    const wind = new THREE.Vector3(...C.wind).normalize();
    const sun = sunColour ?? vec3(1.0, 0.96, 0.88);
    const sky = hazeColour ?? vec3(0.72, 0.82, 0.93);

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'OdysseySummitSpindrift';
    material.transparent = true;
    material.depthWrite = false;
    material.fog = false;
    const vSheet = varying(vec4(0.0), 'spdSheet'); // x age, y seed, z alpha, w thickness
    material.vertexNode = Fn(() => {
        const i = instanceIndex.toFloat();
        const h1 = hash(i.add(11.5)).toVar();
        const h2 = hash(i.add(911.5)).toVar();
        const h3 = hash(i.add(2213.5)).toVar();
        const h4 = hash(i.add(3307.5)).toVar();
        // Age 0..1 along the run; the sheets' births are spread evenly (jittered) over a life.
        const age = fract(uTime.div(C.life).add(i.add(h1.mul(0.8)).div(C.count))).toVar();
        const birth = vec3(
            h2.sub(0.5).mul(2 * C.crest[0]),
            h3.mul(C.crest[1]).negate(),
            h4.sub(0.5).mul(2 * C.crest[0]),
        ).add(vec3(top.x, top.y, top.z));
        // Downwind, easing out (the gust tears it fast off the crest, then it drifts), lifting a
        // little then sinking into the lee; a slow sideways wander per sheet.
        const along = age.mul(float(2).sub(age)).mul(C.run);
        const lift = age.mul(float(1).sub(age)).mul(18.0).sub(age.mul(age).mul(10.0));
        const side = vec3(-wind.z, 0, wind.x);
        const wander = h1.sub(0.5).mul(age).mul(46.0);
        const centre = birth
            .add(vec3(wind.x, wind.y, wind.z).mul(along))
            .add(vec3(0, lift, 0))
            .add(side.mul(wander))
            .toVar();
        const radius = mix(float(C.size[0]), float(C.size[1]), sqrt(age)).mul(mix(float(0.75), float(1.25), h3));
        const view = cameraViewMatrix.mul(vec4(centre, 1.0));
        const lifted = view.add(vec4(positionGeometry.xy.mul(radius.mul(2.0)), 0.0, 0.0));
        // Fade in off the crest, out at the end of its run; away from the lens.
        const toEye = length(centre.sub(cameraPosition));
        const life = smoothstep(0.0, 0.10, age).mul(float(1).sub(smoothstep(0.55, 1.0, age)));
        const near = smoothstep(radius.mul(1.2), radius.mul(3.0), toEye);
        const alpha = life.mul(near).mul(uReveal).mul(C.alpha);
        vSheet.assign(vec4(age, h2, alpha, float(1).sub(age).mul(0.6).add(0.4)));
        return alpha.greaterThan(0.002).select(cameraProjectionMatrix.mul(lifted), vec4(0.0, 0.0, -2.0, 1.0));
    })();
    // A torn sheet: a soft disc broken by two octaves of value noise that drift through it, white
    // where the sun lights it, a cool sky-lit shade in its thicker heart.
    material.colorNode = Fn(() => {
        const q = positionGeometry.xy.mul(2.0);
        const r2 = dot(q, q);
        const seed = vSheet.y.mul(37.0);
        const n = noise2(q.mul(1.7).add(vec2(seed, vSheet.x.mul(2.3))))
            .mul(0.65)
            .add(noise2(q.mul(3.9).add(vec2(seed.mul(1.3), vSheet.x.mul(4.1)))).mul(0.35));
        const disc = exp(r2.mul(-2.2));
        const torn = smoothstep(0.30, 0.78, n.add(disc.mul(0.45)));
        const cover = clamp(disc.mul(torn), 0.0, 1.0);
        const heart = smoothstep(0.35, 0.85, cover).mul(vSheet.w);
        const lit = mix(sun.mul(0.92), sky.mul(0.75), heart.mul(0.35));
        return vec4(lit, cover.mul(vSheet.z));
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'odyssey-summit-spindrift';
    mesh.frustumCulled = false;
    mesh.renderOrder = 12;
    mesh.visible = false;

    return {
        mesh,
        uniforms: { uTime, uReveal },
        /**
         * @param {number} time board clock (s)
         * @param {number} progress journey progress
         */
        update(time, progress) {
            const r = spindriftRevealAt(progress);
            uReveal.value = r;
            uTime.value = time;
            mesh.visible = r > 0.002;
        },
        dispose() {
            geometry.dispose();
            plane.dispose();
            material.dispose();
            mesh.removeFromParent();
        },
    };
}

/** The summit point on the CPU height mirror: the highest sample near the hero massif's axis. */
export function findHeroSummit(heightAt, hero) {
    let best = { x: hero.x, y: -Infinity, z: hero.z };
    for (let dx = -60; dx <= 60; dx += 4) {
        for (let dz = -60; dz <= 60; dz += 4) {
            const y = heightAt(hero.x + dx, hero.z + dz);
            if (y > best.y) best = { x: hero.x + dx, y, z: hero.z + dz };
        }
    }
    return best;
}
