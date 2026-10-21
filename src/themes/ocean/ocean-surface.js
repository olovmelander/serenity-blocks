/**
 * Ocean — the surface seen from below, and the water behind everything.
 *
 * The surface is one flat sheet; its waves are slopes worked out per pixel. Looking up through
 * it the eye sees the sky bent into Snell's window: inside the window the hour's sky and the sun
 * (or the moon) smeared by the waves, outside it a rolling mirror of the deep. The backdrop is a
 * dome painted with the colour the water has along each direction; everything in the sea fades
 * into the same function, so nothing has an edge against it.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    cameraPosition,
    clamp,
    cos,
    dot,
    float,
    fwidth,
    length,
    max,
    mix,
    normalize,
    positionWorld,
    reflect,
    smoothstep,
    sqrt,
    texture,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    DEG, LIGHT_TILE, SURFACE, TAU, WINDOW_INDEX, ocBackdrop, ocBell, ocPart, ocPow4, ocPow8, ocThrough,
} from './ocean-tsl.js';

/** How far the skin's facets tilt across a thread of the light's net (slope per unit of the net). */
const CRINKLE = 0.075;
/** How much more (and less) the water bends blue (and red) than the window's own index. */
const DISPERSION = 0.012;

/** The swell's trains: (bearing in degrees, wavelength in metres, steepness, metres a second). */
const WAVES = Object.freeze([
    [20, 9.0, 0.1, 1.6], [-35, 5.5, 0.09, 1.3], [75, 3.4, 0.08, 1.0], [-80, 2.1, 0.07, 0.8],
    [140, 1.3, 0.06, 0.65], [-150, 0.8, 0.05, 0.5],
]);

/**
 * The underside of the sea.
 * @param {object} u
 * @param {object} [options]
 * @param {number} [options.waves=6]   how many wave trains to sum (the shortest go first)
 * @param {boolean} [options.clouds=true]  cloud in the sky seen through the window
 * @param {number} [options.light=512]  the light pattern's edge in texels (the crinkle reads it at
 *        the level whose texels are about 9 cm, so every tier draws facets of one size)
 */
export function createSurface(u, { waves = WAVES.length, clouds = true, light = 512 } = {}) {
    const reach = 260;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
        -reach, SURFACE, -reach, reach, SURFACE, -reach, reach, SURFACE, reach, -reach, SURFACE, reach,
    ], 3));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'OceanSurface';
    material.side = THREE.DoubleSide;
    material.fog = false;
    material.toneMapped = false;
    const trains = WAVES.slice(0, Math.max(1, Math.min(WAVES.length, waves)));
    material.colorNode = Fn(() => {
        const P = positionWorld;
        const rel = P.sub(cameraPosition).toVar();
        const dist = length(rel).toVar();
        const I = rel.div(max(dist, 1e-3)).toVar();
        const st = P.xz;
        const t = u.drift;
        /** Metres of surface under one pixel (along the line of sight, where it is longest). */
        const foot = max(max(fwidth(st.x), fwidth(st.y)), 1e-4).toVar();

        // ── The waves, as slopes ──
        const slope = vec2(0.0).toVar();
        trains.forEach(([bearing, wavelength, steep, speed]) => {
            const dx = Math.sin(bearing * DEG);
            const dz = -Math.cos(bearing * DEG);
            const k = TAU / wavelength;
            // A wave too short to draw at its distance settles instead of shimmering (under
            // about six pixels a wavelength).
            const settle = float(1.0).sub(smoothstep(wavelength / 12, wavelength / 5, foot));
            const phase = st.x.mul(dx * k).add(st.y.mul(dz * k)).sub(t.mul(k * speed));
            slope.addAssign(vec2(dx, dz).mul(cos(phase)).mul(settle).mul(steep));
        });
        // Chop on the swell: broad and slow, so it only moves the window, never blots it.
        const n2 = u.noise(st.mul(0.19).add(vec2(t.mul(-0.021), t.mul(0.015))));
        const n3 = u.noise(st.mul(0.61).add(vec2(t.mul(0.04), t.mul(-0.03))));
        slope.addAssign(n2.ba.sub(0.5).mul(0.16)
            .add(n3.rg.sub(0.5).mul(0.2).mul(float(1.0).sub(smoothstep(0.03, 0.1, foot)))));
        // The skin's own crinkle: the facets that focus the light into the net on the sand. The
        // surface is that net's height (its threads are ridges), so every thread is a pair of
        // facets, one turned into the window and one out of it. It is read where the sun's ray
        // through this point lands on the pattern, i.e. here, so the bright threads overhead
        // stand over the shafts and the net below them.
        const LT = 1 / LIGHT_TILE;
        const step = 0.07;
        const lvl = Math.max(0, Math.log2(light / 256));
        const h0 = texture(u.lightTex, st.mul(LT)).level(lvl).r;
        const hx = texture(u.lightTex, st.add(vec2(step, 0.0)).mul(LT)).level(lvl).r;
        const hz = texture(u.lightTex, st.add(vec2(0.0, step)).mul(LT)).level(lvl).r;
        /** What of the crinkle the pixels can still draw (its threads are a few centimetres wide). */
        const resolved = float(1.0).sub(smoothstep(0.035, 0.11, foot)).toVar();
        slope.addAssign(vec2(hx.sub(h0), hz.sub(h0)).mul(CRINKLE / step).mul(resolved));
        slope.mulAssign(u.swell);
        /** The underside's normal: it points down, at the viewer. */
        const N = normalize(vec3(slope.x, -1.0, slope.y)).toVar();
        /** What the pixel can no longer draw of the facets' tilt: it blurs the window's edge instead. */
        const blur = float(CRINKLE * 0.11).mul(float(1.0).sub(resolved)).mul(u.swell).add(0.012);

        // ── Through the surface, or back off it ──
        const cosI = clamp(dot(N, I).negate(), 0.0, 1.0).toVar();
        const sin2 = float(1.0).sub(cosI.mul(cosI)).toVar();
        // Water bends red a little less than blue, so a facet's edge of the window is fringed.
        const kOf = (n) => float(1.0).sub(sin2.mul(n * n));
        const k = kOf(WINDOW_INDEX).toVar();
        const kR = kOf(WINDOW_INDEX * (1 - DISPERSION));
        const kB = kOf(WINDOW_INDEX * (1 + DISPERSION));
        const root = sqrt(max(k, 0.0)).toVar();
        const T = normalize(I.mul(WINDOW_INDEX).add(N.mul(cosI.mul(WINDOW_INDEX).sub(root)))).toVar();

        // The sky up there: the hour's own, a little cloud, and the light itself.
        const rise = clamp(T.y, 0.0, 1.0);
        const dome = mix(u.horizon, u.zenith, smoothstep(0.0, 0.75, rise)).toVar();
        if (clouds) {
            const drift = vec2(t.mul(0.0015), t.mul(0.0006));
            const cloud = u.noise(T.xz.div(T.y.add(0.3)).mul(0.07).add(drift)).g;
            dome.assign(mix(dome, u.horizon.mul(1.15), smoothstep(0.55, 0.8, cloud).mul(0.3)));
        }
        const sunward = clamp(dot(T, u.sunAir), 0.0, 1.0);
        const s8 = ocPow8(sunward);
        const s64 = ocPow8(s8);
        const s512 = ocPow8(s64);
        const sky = dome.add(u.disc.mul(s512.add(s64.mul(0.07)).add(s8.mul(0.012))));

        // The mirror: the deep, and a little of the sand's glow from straight below.
        const R = reflect(I, N).toVar();
        const mirror = ocBackdrop(u, R).mul(0.8)
            .add(u.bounce.mul(0.55).mul(smoothstep(0.1, 0.8, R.y.negate())));
        // The window opens softly: right at its edge the light through it is all but gone (the
        // facet's Fresnel), and what the pixel cannot resolve blurs the edge.
        const fresnel = ocPow4(float(1.0).sub(root));
        const gate = (kk) => smoothstep(blur.negate(), blur.mul(2.0).add(0.15), kk);
        const open = vec3(gate(kR), gate(k), gate(kB)).mul(float(1.0).sub(fresnel)).toVar();
        const col = mix(mirror, sky, open).toVar();
        // Where a facet turns just past the edge the whole bright sky near the horizon is folded
        // into it: a thin rim of light along every thread that crosses the edge.
        const rim = ocBell(k.div(blur.mul(2.5).add(0.05))).mul(0.55);
        col.addAssign(u.horizon.mul(rim).mul(u.breath.mul(0.5).add(0.5)));
        // The surface is lit water seen through a shorter, brighter column than its distance says.
        const through = ocThrough(u, dist.mul(0.55));
        return vec4(mix(ocBackdrop(u, I), col, through), 1.0);
    })();
    return ocPart('OceanSurface', geometry, material, 20);
}

/**
 * The water behind everything: a dome that follows the eye, painted with the colour the sea has
 * along each direction. Drawn after the solid parts, so it is shaded only where it shows.
 * @param {object} u
 */
export function createBackdrop(u) {
    const geometry = new THREE.SphereGeometry(1, 32, 16);
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'OceanBackdrop';
    material.side = THREE.BackSide;
    material.depthWrite = false;
    material.fog = false;
    material.toneMapped = false;
    material.colorNode = Fn(() => {
        const dir = normalize(positionWorld.sub(cameraPosition));
        return vec4(ocBackdrop(u, dir), 1.0);
    })();
    const part = ocPart('OceanBackdrop', geometry, material, 30);
    part.mesh.scale.setScalar(380);
    /** Keep the dome round the eye. */
    part.follow = (camera) => {
        part.mesh.position.copy(camera.position);
        part.mesh.updateMatrixWorld();
    };
    return part;
}
