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
    exp,
    float,
    length,
    max,
    mix,
    normalize,
    positionWorld,
    reflect,
    smoothstep,
    sqrt,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    DEG, SURFACE, TAU, WINDOW_INDEX, ocBackdrop, ocFog, ocLightRead, ocPart, ocPow4, ocPow8,
} from './ocean-tsl.js';

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
 */
export function createSurface(u, { waves = WAVES.length, clouds = true } = {}) {
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

        // ── The waves, as slopes ──
        const slope = vec2(0.0).toVar();
        trains.forEach(([bearing, wavelength, steep, speed]) => {
            const dx = Math.sin(bearing * DEG);
            const dz = -Math.cos(bearing * DEG);
            const k = TAU / wavelength;
            // A wave too short to draw at its distance settles instead of shimmering.
            const settle = exp(dist.div(-wavelength * 22));
            const phase = st.x.mul(dx * k).add(st.y.mul(dz * k)).sub(t.mul(k * speed));
            slope.addAssign(vec2(dx, dz).mul(cos(phase)).mul(settle).mul(steep));
        });
        // Chop on the swell, at three scales; the finer it is, the sooner it settles with distance.
        const n1 = u.noise(st.mul(0.05).add(vec2(t.mul(0.009), t.mul(0.006))));
        const n2 = u.noise(st.mul(0.19).add(vec2(t.mul(-0.021), t.mul(0.015))));
        const n3 = u.noise(st.mul(0.61).add(vec2(t.mul(0.04), t.mul(-0.03))));
        slope.addAssign(n1.rg.sub(0.5).mul(0.2)
            .add(n2.ba.sub(0.5).mul(0.3).mul(exp(dist.div(-45.0))))
            .add(n3.rg.sub(0.5).mul(0.24).mul(exp(dist.div(-22.0)))));
        slope.mulAssign(u.swell);
        /** The underside's normal: it points down, at the viewer. */
        const N = normalize(vec3(slope.x, -1.0, slope.y)).toVar();

        // ── Through the surface, or back off it ──
        const cosI = clamp(dot(N, I).negate(), 0.0, 1.0).toVar();
        const k = float(1.0).sub(float(WINDOW_INDEX * WINDOW_INDEX).mul(float(1.0).sub(cosI.mul(cosI)))).toVar();
        const root = sqrt(max(k, 0.0)).toVar();
        const T = normalize(I.mul(WINDOW_INDEX).add(N.mul(cosI.mul(WINDOW_INDEX).sub(root)))).toVar();

        // The sky up there: the hour's own, a little cloud, and the light itself.
        const rise = clamp(T.y, 0.0, 1.0);
        const dome = mix(u.horizon, u.zenith, smoothstep(0.0, 0.75, rise)).toVar();
        if (clouds) {
            const drift = vec2(t.mul(0.0015), t.mul(0.0006));
            const cloud = u.noise(T.xz.div(T.y.add(0.3)).mul(0.07).add(drift)).g;
            dome.assign(mix(dome, u.horizon.mul(1.2), smoothstep(0.5, 0.78, cloud).mul(0.55)));
        }
        const sunward = clamp(dot(T, u.sunAir), 0.0, 1.0);
        const s8 = ocPow8(sunward);
        const s64 = ocPow8(s8);
        const s512 = ocPow8(s64);
        const sky = dome.add(u.disc.mul(s512.add(s64.mul(0.07)).add(s8.mul(0.012))));

        // The mirror: the deep, and a little of the sand's glow from straight below.
        const R = reflect(I, N).toVar();
        const mirror = ocBackdrop(u, R).mul(0.9)
            .add(u.bounce.mul(0.55).mul(smoothstep(0.1, 0.8, R.y.negate())));
        // The window opens softly: near its edge the surface is still mostly mirror.
        const fresnel = ocPow4(float(1.0).sub(root));
        const open = smoothstep(0.0, 0.2, k).mul(float(1.0).sub(fresnel));
        const col = mix(mirror, sky, open).toVar();
        // The net is drawn on the underside too: the light gathered just under the skin.
        const skin = ocLightRead(u, st).r;
        col.addAssign(u.sun.mul(skin.mul(skin)).mul(0.05).mul(u.breath));
        return vec4(ocFog(u, col, P), 1.0);
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
