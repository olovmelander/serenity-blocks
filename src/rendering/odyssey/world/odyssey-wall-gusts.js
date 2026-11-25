/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * THE WALL'S GUSTS — spindrift torn off the massif's shoulder and blown across the face, where
 * the climb begins (the 4->5 seam; the sky pass, round two, 2026-11-17).
 *
 * The chapter boundary sits at the foot of the wall (p 0.349, the eye ~100 u over the sea): the
 * summit and its banner are 600 u overhead, so "arriving in the sky" had nothing of its own
 * there. What a climber meets where a wall begins is its wind. Streamers of snow now come off
 * the massif's eastern shoulder and cross the face on the gale, between the eye and the wall and
 * past the eye itself, sparkling where the low sun catches their crystals. They are the seam's
 * own event: nothing in chapter 4, coming up across the glide to L27, thinning out again as the
 * climb leaves the foot of the wall for the open face.
 *
 * In the world, not on the lens: each streamer is born in a fixed box upwind of the rail's first
 * stretch up the wall, rides the summit's wind for `run` units and is born again; the eye rises
 * through them. One instanced draw of view-facing sheets (the summit spindrift's own language:
 * drawn out along the wind, torn by drifting value noise), normal blending, no depth write.
 * Sheets fade as they come within a few radii of the eye, so none ever fills the frame.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, cameraPosition, cameraProjectionMatrix, cameraViewMatrix, clamp, dot, exp, float, floor, fract, hash,
    instanceIndex, length, mix, normalize, positionGeometry, smoothstep, sqrt, uniform, varying, vec2, vec3, vec4,
} from 'three/tsl';
import { hash21, noise2 } from '../chapter-environments/shared/odyssey-tsl-noise.js';

export const ODYSSEY_WALL_GUSTS = Object.freeze({
    count: Object.freeze({ high: 96, low: 52 }),
    /** The gale: its direction (the summit's wind, toward west-north-west, lifting a little). */
    wind: Object.freeze([-0.926, 0.06, -0.372]),
    /** How far a streamer rides before it is born again (u), and how long that takes (s). */
    run: 640,
    life: 6.8,
    /** Radius at birth and at the end of its run (u); how far it is drawn out along the wind and
     * how thin across it (x its radius). */
    size: Object.freeze([8, 38]),
    stretch: 2.5,
    thin: 0.26,
    /**
     * Where they are born: a box upwind (east) of the rail's first stretch up the wall (L27 at
     * (-216, 390, -480) to L28 at (-211, 512, -527)), so their runs cross it mid-life. `centre`
     * (world), then half-extents: across the wind, up, along it.
     */
    centre: Object.freeze([70, 440, -395]),
    spread: Object.freeze([230, 105, 130]),
    /** Peak alpha of a streamer, and of the crystals' sparkle in it. */
    alpha: 0.19,
    sparkle: 0.3,
    /** THE GALE COMES IN GUSTS: a front crosses the box every `gust` seconds; between fronts the
     * air holds a `lull` share of the snow, so the sky behind is clear more than it is veiled. */
    gust: 7.5,
    lull: 0.22,
    /** [in from, full by, out from, gone by] in JOURNEY progress: nothing in chapter 4, whole at
     * L27, thinning over the foot of the wall, gone before L29. */
    window: Object.freeze([0.337, 0.349, 0.385, 0.445]),
});

const ramp = (a, b, x) => {
    const u = Math.min(Math.max((x - a) / (b - a), 0), 1);
    return u * u * (3 - (2 * u));
};

/** The gusts' strength (0..1) at journey progress `p` (pure). */
export function wallGustsRevealAt(p, cfg = ODYSSEY_WALL_GUSTS) {
    if (!Number.isFinite(p)) return 0;
    const w = cfg.window;
    return ramp(w[0], w[1], p) * (1 - ramp(w[2], w[3], p));
}

/**
 * @param {object} [opts]
 * @param {object} [opts.sunColour] TSL vec3 node: the world's sun colour (the evening's gold)
 * @param {object} [opts.hazeColour] TSL vec3 node: the world's horizon (the shade's sky light)
 * @param {'high'|'low'} [opts.quality]
 */
export function createOdysseyWallGusts({ sunColour = null, hazeColour = null, quality = 'high' } = {}) {
    const C = ODYSSEY_WALL_GUSTS;
    const count = quality === 'high' ? C.count.high : C.count.low;
    const plane = new THREE.PlaneGeometry(1, 1);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = plane.index;
    geometry.setAttribute('position', plane.getAttribute('position'));
    geometry.setAttribute('uv', plane.getAttribute('uv'));
    geometry.instanceCount = count;

    const uTime = uniform(0);
    const uReveal = uniform(0);
    const wind = new THREE.Vector3(...C.wind).normalize();
    const across = new THREE.Vector3(-wind.z, 0, wind.x).normalize();
    const sun = sunColour ?? vec3(1.0, 0.86, 0.62);
    const sky = hazeColour ?? vec3(0.85, 0.86, 0.90);

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'OdysseyWallGusts';
    material.transparent = true;
    material.depthWrite = false;
    material.fog = false;
    const vSheet = varying(vec4(0.0), 'gustSheet'); // x age, y seed, z alpha, w thickness
    material.vertexNode = Fn(() => {
        const i = instanceIndex.toFloat();
        const h1 = hash(i.add(17.5)).toVar();
        const h2 = hash(i.add(613.5)).toVar();
        const h3 = hash(i.add(1907.5)).toVar();
        const h4 = hash(i.add(3511.5)).toVar();
        // Age 0..1 along the run; births spread evenly (jittered) over a life.
        const age = fract(uTime.div(C.life).add(i.add(h1.mul(0.8)).div(count))).toVar();
        const birth = vec3(...C.centre)
            .add(vec3(across.x, 0, across.z).mul(h2.sub(0.5).mul(2 * C.spread[0])))
            .add(vec3(0, h3.sub(0.5).mul(2 * C.spread[1]), 0))
            .add(vec3(wind.x, 0, wind.z).mul(h4.sub(0.5).mul(2 * C.spread[2])));
        // Torn off fast, then carried; lifting a little over the run, wandering sideways.
        const along = age.mul(float(2).sub(age)).mul(C.run);
        const lift = age.mul(float(1).sub(age)).mul(34.0);
        const wander = h1.sub(0.5).mul(age).mul(52.0);
        const centre = birth
            .add(vec3(wind.x, wind.y, wind.z).mul(along))
            .add(vec3(0, lift, 0))
            .add(vec3(across.x, 0, across.z).mul(wander))
            .toVar();
        const radius = mix(float(C.size[0]), float(C.size[1]), sqrt(age)).mul(mix(float(0.7), float(1.3), h3));
        const view = cameraViewMatrix.mul(vec4(centre, 1.0));
        // A streamer: drawn out along the wind as it crosses the view, thin across it.
        const windView = cameraViewMatrix.mul(vec4(wind.x, wind.y, wind.z, 0.0)).xy;
        const along2 = normalize(windView.add(vec2(1e-4, 0)));
        const across2 = vec2(along2.y.negate(), along2.x);
        const corner = along2.mul(positionGeometry.x.mul(radius.mul(2.0 * C.stretch)))
            .add(across2.mul(positionGeometry.y.mul(radius.mul(2.0 * C.thin))));
        const lifted = view.add(vec4(corner, 0.0, 0.0));
        // In off its birth, out at the end of its run; soft as it nears the eye (never a wall).
        const toEye = length(centre.sub(cameraPosition));
        const life = smoothstep(0.0, 0.12, age).mul(float(1).sub(smoothstep(0.60, 1.0, age)));
        const near = smoothstep(radius.mul(0.9), radius.mul(3.2), toEye);
        // The gust front: a wave running downwind through the box; a streamer is whole while
        // the front is on it and thin in the lull behind.
        const front = fract(uTime.div(C.gust).sub(along.div(C.run * 1.6)).add(h2.mul(0.18)));
        const gust = smoothstep(0.0, 0.16, front).mul(float(1).sub(smoothstep(0.34, 0.72, front)))
            .mul(1 - C.lull).add(C.lull);
        const alpha = life.mul(near).mul(gust).mul(uReveal).mul(C.alpha);
        vSheet.assign(vec4(age, h2, alpha, float(1).sub(age).mul(0.6).add(0.4)));
        return alpha.greaterThan(0.002).select(cameraProjectionMatrix.mul(lifted), vec4(0.0, 0.0, -2.0, 1.0));
    })();
    // A torn sheet of blown snow, gold where the low sun lights it, with its crystals' sparkle:
    // a few bright specks that light and go as the sheet streams (cells of the sheet, re-drawn a
    // dozen times a second, each lit only now and then).
    material.colorNode = Fn(() => {
        const q = positionGeometry.xy.mul(2.0).toVar();
        const r2 = dot(q, q);
        const seed = vSheet.y.mul(41.0).toVar();
        const n = noise2(q.mul(vec2(1.1, 2.8)).add(vec2(seed, vSheet.x.mul(2.6))))
            .mul(0.6)
            .add(noise2(q.mul(vec2(2.4, 8.0)).add(vec2(seed.mul(1.3), vSheet.x.mul(4.6)))).mul(0.4));
        const disc = exp(r2.mul(-2.2));
        const torn = smoothstep(0.32, 0.80, n.add(disc.mul(0.45)));
        const cover = clamp(disc.mul(torn), 0.0, 1.0).toVar();
        const heart = smoothstep(0.35, 0.85, cover).mul(vSheet.w);
        // The snow's light (2026-11-25, the mountain's audit M16: at L27 the gusts in the sun's own gold
        // read as a road with lane markings across the face): the sun's value, little of its hue, as the
        // summit's banner is lit (odyssey-summit-spindrift.js).
        const sunLuma = dot(sun, vec3(0.2126, 0.7152, 0.0722));
        const lit = mix(mix(vec3(sunLuma), sun, 0.35).mul(0.84).add(vec3(0.03)), sky.mul(0.80), heart.mul(0.38));
        const cell = floor(q.mul(vec2(46.0, 12.0)).add(vec2(seed, 0.0)));
        const tick = floor(uTime.mul(11.0).add(seed));
        const glint = smoothstep(0.972, 0.995, hash21(cell.add(vec2(tick.mul(0.37), tick.mul(0.61)))))
            .mul(disc)
            .mul(C.sparkle);
        return vec4(lit.add(sun.mul(glint.mul(1.6))), clamp(cover.add(glint), 0.0, 1.0).mul(vSheet.z));
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'odyssey-world-wall-gusts';
    mesh.frustumCulled = false;
    mesh.renderOrder = 12;
    mesh.visible = false;

    return {
        mesh,
        uniforms: { uTime, uReveal },
        /**
         * @param {number} time seconds
         * @param {number} reveal 0..1 (`wallGustsRevealAt` of the journey's progress)
         * @param {boolean} shown whether the world lets it draw
         */
        update(time, reveal, shown) {
            // Wrapped at a whole number of lives and of gusts, so the float stays small and no
            // sheet or front jumps.
            uTime.value = (Number.isFinite(time) ? time : 0) % (C.life * C.gust * 100);
            const r = Math.min(Math.max(Number.isFinite(reveal) ? reveal : 0, 0), 1);
            uReveal.value = r;
            mesh.visible = !!shown && r > 0.002;
        },
        dispose() {
            geometry.dispose();
            plane.dispose();
            material.dispose();
            mesh.removeFromParent();
        },
    };
}
