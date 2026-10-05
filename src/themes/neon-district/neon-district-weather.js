/**
 * Neon District — the rain.
 *
 * Streaks falling through a box of air around the camera, closed form (a streak's height is a
 * function of the clock; nothing is simulated). Rain is only ever seen by the light behind it, so
 * a streak takes its colour from the glow map where it falls — rose under a rose sign, white in
 * a lamp's pool — and from the gameplay pulses: a lock's shell lights the drops it passes through
 * (the shell becomes a visible dome in the rain) and a clear's fronts arrive as walls of lit rain.
 *
 * Each streak is a camera-facing strip, never thinner than a pixel and a half, drawn additively
 * on layer 1 (the street's mirror does not render it; the puddles carry their own rain rings).
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    cameraPosition,
    cameraProjectionMatrix,
    cameraViewMatrix,
    exp,
    float,
    fract,
    length,
    max,
    mix,
    normalize,
    positionGeometry,
    smoothstep,
    uv,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    STREET,
    mulberry32,
    ndClearLight,
    ndFogAmount,
    ndFxMaterial,
    ndGlow,
    ndLockLight,
    ndQuadGeometry,
    ndWrapZ,
} from './neon-district-tsl.js';
import { LAMP_OFFSET, LAMP_SPACING } from './neon-district-street.js';

/** The box of air the rain falls through (metres, camera at the origin looking down −z). */
export const RAIN_BOX = Object.freeze({
    halfWidth: 17, top: 27, near: 3, far: -64,
});

/**
 * @param {object} u       shared district uniforms
 * @param {number} count   streaks
 * @param {object} [opts]
 * @param {number} [opts.seed]
 * @returns {{ mesh: THREE.Mesh, material: THREE.Material, geometry: THREE.BufferGeometry }}
 */
export function createRain(u, count, opts = {}) {
    const rand = mulberry32(opts.seed ?? 0x7a11);
    const aSeed = new Float32Array(count * 4);
    for (let i = 0; i < count * 4; i++) aSeed[i] = rand();
    const geometry = ndQuadGeometry(count, { aSeed: [aSeed, 4] });
    const seed = attribute('aSeed', 'vec4');

    const material = ndFxMaterial('NeonDistrictRain');
    const depth = RAIN_BOX.near - RAIN_BOX.far;

    // ── Where this streak is now ──
    const speed = seed.w.mul(5.0).add(15.0);
    const fall = fract(seed.z.add(u.time.mul(speed).div(RAIN_BOX.top)));
    const y = float(RAIN_BOX.top).mul(float(1.0).sub(fall));
    // The city flows toward the camera and the rain with it.
    const z = fract(seed.y.add(u.scroll.div(depth))).mul(depth).add(RAIN_BOX.far);
    // A light wind leans the fall.
    const x = seed.x.mul(2.0).sub(1.0).mul(RAIN_BOX.halfWidth).add(y.mul(0.07));
    const head = vec3(x, y, z);
    const lengthM = speed.mul(0.021).add(0.12);
    const along = normalize(vec3(0.07, 1.0, 0.0));
    const centre = head.add(along.mul(positionGeometry.y.mul(lengthM)));

    // Camera-facing strip, at least a pixel and a half wide.
    const clip = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(centre, 1.0));
    const tipClip = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(centre.add(along.mul(0.1)), 1.0));
    const half = u.viewport.mul(0.5);
    const s0 = clip.xy.div(clip.w).mul(half);
    const s1 = tipClip.xy.div(tipClip.w).mul(half);
    const dir = normalize(s1.sub(s0).add(vec2(1e-4, 0.0)));
    const nrm = vec2(dir.y.negate(), dir.x);
    const dist = length(centre.sub(cameraPosition));
    const pxPerMetre = u.viewport.y.mul(0.9).div(max(dist, 0.5));
    const widthPx = max(float(0.011).mul(pxPerMetre), 1.5);
    material.vertexNode = vec4(
        clip.xy.add(nrm.mul(positionGeometry.x.mul(widthPx)).div(half).mul(clip.w)),
        clip.z,
        clip.w,
    );

    // ── What lights it (per vertex: a streak is tiny) ──
    const lampZ = (offset) => fract(head.z.sub(u.scroll).sub(LAMP_OFFSET + offset).div(LAMP_SPACING).add(0.5)).sub(0.5).mul(LAMP_SPACING);
    const lzL = lampZ(0);
    const lzR = lampZ(LAMP_SPACING * 0.5);
    const dxL = head.x.add(STREET.halfRoad - 1.2);
    const dxR = head.x.sub(STREET.halfRoad - 1.2);
    // Under a lamp the rain falls through its cone: brightest near the head.
    const cone = (lz, dx) => exp(lz.mul(lz).add(dx.mul(dx)).mul(-0.11)).mul(smoothstep(8.5, 2.0, head.y));
    const lamp = vec3(0.62, 0.84, 1.0).mul(cone(lzL, dxL).add(cone(lzR, dxR))).mul(u.neon.mul(0.55).add(0.45));
    const glow = ndGlow(u, head).mul(exp(max(head.y.sub(4.0), 0.0).mul(-0.12)));
    const clear = ndClearLight(u, head.z);
    const pulse = ndLockLight(u, head).mul(2.6).add(clear.rgb.mul(1.3));
    const ambient = u.hazeLow.mul(0.5).add(u.hazeHigh.mul(1.4)).add(vec3(0.004, 0.005, 0.008));
    const fog = ndFogAmount(dist, head.y);
    // Streaks dissolve into the haze, and the nearest ones are soft and faint (out of focus).
    const visible = float(1.0).sub(fog).mul(smoothstep(0.8, 5.0, dist)).mul(mix(float(0.35), float(1.0), smoothstep(2.0, 12.0, dist)));
    const energy = ambient.add(glow.mul(0.3)).add(lamp.mul(0.55)).add(pulse)
        .mul(visible)
        .mul(u.rain)
        // A thin streak is spread over at least a pixel and a half: keep its energy.
        .mul(float(0.011).mul(pxPerMetre).div(widthPx).mul(0.75)
            .add(0.25));
    const vLight = varying(energy, 'ndRainLight');

    material.colorNode = Fn(() => {
        const st = uv();
        const across = float(1.0).sub(abs(st.x.sub(0.5)).mul(2.0));
        const alongFade = smoothstep(0.0, 0.3, st.y).mul(smoothstep(1.0, 0.55, st.y));
        const a = across.mul(across).mul(alongFade);
        return vec4(vLight.mul(a).mul(2.4), 0.0);
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'NeonDistrictRain';
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = 40;
    return { mesh, material, geometry };
}

// ── Steam ───────────────────────────────────────────────────────────────────────

/** Seconds a puff of steam lives, and how high it climbs. */
export const STEAM_LIFE = 5.5;
export const STEAM_RISE = 7.5;

/**
 * Steam from the vents in the pavement: a few soft cards per vent, each a closed-form puff that
 * rises, spreads, leans with the wind and thins out. Steam is lit by whatever it passes — the
 * glow map, the lamps' colour, the gameplay pulses — so a vent under a rose sign breathes rose.
 * @param {object} u
 * @param {object[]} vents  plan.vents
 * @param {number} puffs    cards per vent
 */
export function createSteam(u, vents, puffs) {
    const count = vents.length * puffs;
    const aPos = new Float32Array(count * 4);
    const aSeed = new Float32Array(count * 2);
    const rand = mulberry32(0x57ea);
    vents.forEach((vent, v) => {
        for (let k = 0; k < puffs; k++) {
            const i = v * puffs + k;
            aPos.set([vent.x, 0, vent.z, (k + rand() * 0.6) / puffs], i * 4);
            aSeed.set([rand(), rand()], i * 2);
        }
    });
    const geometry = ndQuadGeometry(count, { aPos: [aPos, 4], aSeed: [aSeed, 2] });
    const pos = attribute('aPos', 'vec4');
    const seed = attribute('aSeed', 'vec2');
    const material = ndFxMaterial('NeonDistrictSteam');

    const life = fract(pos.w.add(u.time.div(STEAM_LIFE)));
    const rise = life.mul(STEAM_RISE);
    // A puff wanders as it climbs and leans down-wind.
    const wander = vec3(
        seed.x.sub(0.5).mul(1.6).mul(life).add(rise.mul(0.07)),
        rise.add(0.25),
        seed.y.sub(0.5).mul(1.6).mul(life),
    );
    const centre = vec3(pos.x, 0.0, ndWrapZ(pos.z.add(u.scroll))).add(wander);
    const size = life.mul(3.4).add(0.7);
    const clip = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(centre, 1.0));
    const half = u.viewport.mul(0.5);
    const pxPerMetre = u.viewport.y.mul(0.9).div(max(clip.w, 0.3));
    material.vertexNode = vec4(
        clip.xy.add(positionGeometry.xy.mul(size.mul(pxPerMetre)).div(half).mul(clip.w)),
        clip.z,
        clip.w,
    );
    const dist = length(centre.sub(cameraPosition));
    const fog = ndFogAmount(dist, centre.y);
    const glow = ndGlow(u, centre).mul(exp(max(centre.y.sub(4.0), 0.0).mul(-0.14)));
    const clear = ndClearLight(u, centre.z);
    const light = glow.mul(0.5).add(u.hazeLow.mul(0.8)).add(vec3(0.012, 0.014, 0.02))
        .add(ndLockLight(u, centre).mul(0.9))
        .add(clear.rgb.mul(0.6));
    // Thick at the grating, gone by the time it reaches the first-floor signs; never a card in
    // the camera's face.
    const body = smoothstep(0.0, 0.12, life).mul(float(1.0).sub(life)).mul(float(1.0).sub(life));
    const density = body.mul(float(1.0).sub(fog)).mul(smoothstep(1.5, 6.0, dist)).mul(0.5);
    const vLight = varying(light.mul(density), 'ndSteamLight');
    const vSeed = varying(seed, 'ndSteamSeed');
    material.colorNode = Fn(() => {
        const st = uv();
        const p = st.sub(0.5).mul(2.0);
        // A soft disc, torn by the baked noise so no two puffs share an outline.
        const tear = u.noise(st.mul(0.6).add(vSeed.mul(7.0)).add(vec2(0.0, u.time.mul(-0.03)))).r;
        const a = smoothstep(1.0, 0.15, length(p).add(tear.sub(0.5).mul(0.7)));
        return vec4(vLight.mul(a), 0.0);
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'NeonDistrictSteam';
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = 19;
    return { mesh, material, geometry };
}
