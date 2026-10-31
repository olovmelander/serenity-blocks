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
 * STREAMERS (2026-10-25, Act II pass, step 2: "the wind on top of the mountain"). The round sheets
 * read as more cloud beside the banner, not as a gale: each is now drawn out along the wind as it
 * crosses the view (`stretch`, `thin`), its grain runs along it, and there are more of them, faster,
 * born along the summit crest (the sculpted horn, odysseySummitSculpt), so the summit smokes.
 *
 * ZERO-HITCH: built at board construction (compiled with the presentation group); afterwards only
 * the clock and the reveal uniform change. BISECT LEVER (board): `?odysseyNoSpindrift=1`.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, cameraPosition, cameraProjectionMatrix, cameraViewMatrix, clamp, cos, dot, exp, float, fract, hash,
    instanceIndex, length, mix, normalize, positionGeometry, sin, smoothstep, sqrt, uniform, varying, vec2, vec3,
    vec4,
} from 'three/tsl';
import { noise2 } from '../chapter-environments/shared/odyssey-tsl-noise.js';

/** The plume. `wind` is the direction the snow travels (unit-ish; west-north-west, lifting). */
export const ODYSSEY_SPINDRIFT = Object.freeze({
    count: 140,
    wind: Object.freeze([-0.92, 0.07, -0.37]),
    /** How far a sheet rides before it is born again (world units), and how long that takes. */
    run: 330,
    life: 5.2,
    /** Sheet radius at birth and at the end of its run (world units). */
    size: Object.freeze([7, 34]),
    /** How far a sheet is drawn out along the wind, and how thin across it (x its radius). */
    stretch: 2.6,
    thin: 0.30,
    /** The crest the snow leaves: spread round the summit point (horizontal, down). */
    crest: Object.freeze([30, 28]),
    /** Peak alpha of one sheet. */
    alpha: 0.42,
    /** [fade in from, fully in by, fade out from, gone by] in JOURNEY progress. */
    window: Object.freeze([0.140, 0.160, 0.662, 0.692]),
});

/**
 * THE BANNER PLUME (round three, 2026-10-31). Olov, at the summit: "i am not sure about the top
 * peak wind, that must be possible to make more impressive? the wind at the top of the mountain."
 * The streamers above read as a short smear on the tip, and the banner cloud the field parked in
 * the summit's lee (two sculpted masses) read as two ordinary clouds beside it. A summit in a gale
 * flies a BANNER: cloud condensing in the lee of the tip and torn away downwind in a continuous
 * plume, dense where it leaves the peak, billowing and spreading as it goes, thinning to wisps
 * hundreds of metres off (Everest, the Matterhorn). Soft billows, born a steady stream at the tip
 * and carried off at gale speed; each grows, rolls in its own eddy and frays, sunlit white on its
 * top and a cool sky-lit slate under it, as the field's Witness paint does.
 */
export const ODYSSEY_SUMMIT_PLUME = Object.freeze({
    count: 230,
    /** Life of one billow (s) and how far it travels in it (u): a gale of ~55 u/s. */
    life: 17,
    run: 940,
    /** Radius at birth and at the end (u). */
    size: Object.freeze([12, 92]),
    /** Born in the tip's lee: how far downwind, how far round, how far below the tip (u). */
    lee: Object.freeze([10, 16, 26]),
    /** The plume's own spread at the end of its run: sideways and up/down (u). */
    spread: Object.freeze([95, 55]),
    /** The lee's sink over the run (u) and the lift just off the tip (u). */
    sink: 70,
    lift: 26,
    /** Peak alpha of one billow, and over which part of its life it thins away. */
    alpha: 0.72,
    fade: Object.freeze([0.28, 0.92]),
    /** How far a billow is drawn out along the wind (x its radius). */
    stretch: 1.05,
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
        // A streamer: drawn out along the wind as it crosses the view, thin across it.
        const windView = cameraViewMatrix.mul(vec4(wind.x, wind.y, wind.z, 0.0)).xy;
        const along2 = normalize(windView.add(vec2(1e-4, 0)));
        const across2 = vec2(along2.y.negate(), along2.x);
        const corner = along2.mul(positionGeometry.x.mul(radius.mul(2.0 * C.stretch)))
            .add(across2.mul(positionGeometry.y.mul(radius.mul(2.0 * C.thin))));
        const lifted = view.add(vec4(corner, 0.0, 0.0));
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
        // (the grain runs along the streamer: finer across it than along it)
        const n = noise2(q.mul(vec2(1.2, 2.6)).add(vec2(seed, vSheet.x.mul(2.3))))
            .mul(0.6)
            .add(noise2(q.mul(vec2(2.2, 7.5)).add(vec2(seed.mul(1.3), vSheet.x.mul(4.1)))).mul(0.4));
        const disc = exp(r2.mul(-2.2));
        const torn = smoothstep(0.30, 0.78, n.add(disc.mul(0.45)));
        const cover = clamp(disc.mul(torn), 0.0, 1.0);
        const heart = smoothstep(0.35, 0.85, cover).mul(vSheet.w);
        const lit = mix(sun.mul(0.92), sky.mul(0.75), heart.mul(0.35));
        return vec4(lit, cover.mul(vSheet.z));
    })();

    const streamers = new THREE.Mesh(geometry, material);
    streamers.name = 'odyssey-summit-spindrift-streamers';
    streamers.frustumCulled = false;
    streamers.renderOrder = 12;

    // ── THE BANNER PLUME (see ODYSSEY_SUMMIT_PLUME) ─────────────────────────────────────────
    const P = ODYSSEY_SUMMIT_PLUME;
    const plumeGeometry = new THREE.InstancedBufferGeometry();
    plumeGeometry.index = plane.index;
    plumeGeometry.setAttribute('position', plane.getAttribute('position'));
    plumeGeometry.setAttribute('uv', plane.getAttribute('uv'));
    plumeGeometry.instanceCount = P.count;
    const plumeMaterial = new THREE.MeshBasicNodeMaterial();
    plumeMaterial.name = 'OdysseySummitPlume';
    plumeMaterial.transparent = true;
    plumeMaterial.depthWrite = false;
    plumeMaterial.fog = false;
    const vBillow = varying(vec4(0.0), 'plumeBillow'); // x age, y seed, z alpha, w up across the sprite
    plumeMaterial.vertexNode = Fn(() => {
        const i = instanceIndex.toFloat();
        const h1 = hash(i.add(41.5)).toVar();
        const h2 = hash(i.add(733.5)).toVar();
        const h3 = hash(i.add(1777.5)).toVar();
        const h4 = hash(i.add(2903.5)).toVar();
        const age = fract(uTime.div(P.life).add(i.add(h1.mul(0.9)).div(P.count))).toVar();
        const side = vec3(-wind.z, 0, wind.x);
        // Born in the tip's lee, a little below it, round the downwind side.
        const birth = vec3(top.x, top.y, top.z)
            .add(vec3(wind.x, 0, wind.z).mul(P.lee[0]))
            .add(side.mul(h2.sub(0.5).mul(2 * P.lee[1])))
            .add(vec3(0, h3.mul(P.lee[2]).negate(), 0));
        // Torn off fast, then carried at the wind's pace; lifting just off the tip, then sinking
        // into the lee; the plume spreading as it goes, each billow rolling in its own eddy.
        const along = age.pow(0.82).mul(P.run);
        const rise = age.mul(float(1).sub(age)).mul(4 * P.lift).sub(age.mul(age).mul(P.sink));
        const eddyT = age.mul(7.0).add(h4.mul(6.2831));
        const spreadS = h2.sub(0.5).mul(2).mul(age.pow(0.8)).mul(P.spread[0])
            .add(cos(eddyT).mul(age).mul(14.0));
        const spreadY = h3.sub(0.5).mul(2).mul(age.pow(0.8)).mul(P.spread[1])
            .add(sin(eddyT).mul(age).mul(10.0));
        const centre = birth
            .add(vec3(wind.x, 0, wind.z).mul(along))
            .add(vec3(0, rise.add(spreadY), 0))
            .add(side.mul(spreadS))
            .toVar();
        const radius = mix(float(P.size[0]), float(P.size[1]), age.pow(0.7)).mul(mix(float(0.7), float(1.3), h4));
        const view = cameraViewMatrix.mul(vec4(centre, 1.0));
        const windView = cameraViewMatrix.mul(vec4(wind.x, wind.y, wind.z, 0.0)).xy;
        const along2 = normalize(windView.add(vec2(1e-4, 0)));
        const across2 = vec2(along2.y.negate(), along2.x);
        const corner = along2.mul(positionGeometry.x.mul(radius.mul(2.0 * P.stretch)))
            .add(across2.mul(positionGeometry.y.mul(radius.mul(2.0))));
        const lifted = view.add(vec4(corner, 0.0, 0.0));
        const toEye = length(centre.sub(cameraPosition));
        const life = smoothstep(0.0, 0.04, age).mul(float(1).sub(smoothstep(P.fade[0], P.fade[1], age)));
        const near = smoothstep(radius.mul(1.1), radius.mul(2.6), toEye);
        const alpha = life.mul(near).mul(uReveal).mul(P.alpha);
        // The world's up, in the view, against the sprite's across axis: which way is "top".
        const upView = normalize(cameraViewMatrix.mul(vec4(0.0, 1.0, 0.0, 0.0)).xy.add(vec2(0, 1e-4)));
        vBillow.assign(vec4(age, h1, alpha, dot(upView, across2)));
        return alpha.greaterThan(0.002).select(cameraProjectionMatrix.mul(lifted), vec4(0.0, 0.0, -2.0, 1.0));
    })();
    // A billow: a soft lobed disc, torn at its rim by drifting value noise (more as it ages, so the
    // tail frays into wisps), lit from its top: sunlit white above, a cool slate below.
    plumeMaterial.colorNode = Fn(() => {
        const q = positionGeometry.xy.mul(2.0);
        const r2 = dot(q, q);
        const seed = vBillow.y.mul(53.0);
        const n = noise2(q.mul(1.6).add(vec2(seed, vBillow.x.mul(3.1))))
            .mul(0.62)
            .add(noise2(q.mul(3.7).add(vec2(seed.mul(1.7), vBillow.x.mul(5.3)))).mul(0.38));
        const disc = exp(r2.mul(-2.4));
        const fray = mix(float(0.34), float(0.58), vBillow.x);
        const torn = smoothstep(fray, fray.add(0.16), n.add(disc.mul(0.55)));
        const cover = clamp(disc.mul(torn), 0.0, 1.0);
        const up = q.y.mul(vBillow.w).add(q.x.mul(float(1).sub(vBillow.w.abs())).mul(0.3));
        const sunlit = smoothstep(-0.30, 0.38, up.add(n.sub(0.5).mul(0.5)));
        const slate = mix(sky.mul(0.86), vec3(0.80, 0.84, 0.90), 0.45);
        const lit = mix(slate, sun.mul(0.98).add(vec3(0.04)), sunlit);
        return vec4(lit, cover.mul(vBillow.z));
    })();
    const plume = new THREE.Mesh(plumeGeometry, plumeMaterial);
    plume.name = 'odyssey-summit-plume';
    plume.frustumCulled = false;
    // Under the streamers: the fast snow is torn across the face of the banner.
    plume.renderOrder = 11;

    const mesh = new THREE.Group();
    mesh.name = 'odyssey-summit-spindrift';
    mesh.add(plume);
    mesh.add(streamers);
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
            plumeGeometry.dispose();
            plane.dispose();
            material.dispose();
            plumeMaterial.dispose();
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
